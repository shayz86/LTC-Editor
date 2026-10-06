import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";

(() => {
"use strict";

const $ = id => document.getElementById(id);
const state = {
  fileName: "", original: null,
  markers: [], textOffsets: [], lengths: [],
  indexStart: 0, indexCount: 0, indexEntrySize: 9, indexIds: [], indexFlags: [],
  selected: -1, page: 0, pageSize: 20,
  filter: "", caseSensitive: false, placeholdersOnly: false,
  dirty: new Map(), lastResults: [], searchMode: false,
  searchToken: 0, indexing: false,
  translationPaused: false, translationRunning: false, translationDone: 0, translationTotal: 0,
  translationCache: new Map(), translationQueue: [], translationDb: null,
  translator: null, translatorLoading: false, translatorDevice: "wasm", translatorModel: "Xenova/opus-mt-en-id", onlineUsed: 0, onlineBudget: 178700, onlineBlocked: false, onlineLastAt: 0, onlineLastEndpoint: "", onlineLastError: "", fallbackUsed: 0
};

const enc = new TextEncoder();

// Keep a local copy so an Android/Chrome reload or renderer recovery does not leave
// the UI showing stale file information while the in-memory index is gone.
const DB_NAME = "ltc-editor-fm2021";
const DB_STORE = "files";
const DB_KEY = "last-file";
const TDB_NAME = "ltc-editor-fm2021-translations";
const TDB_STORE = "translations";
function openTranslationDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TDB_NAME, 1);
    req.onupgradeneeded = () => { const db=req.result; if(!db.objectStoreNames.contains(TDB_STORE)) db.createObjectStore(TDB_STORE); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function getTranslationCache(key) {
  if (state.translationCache.has(key)) return state.translationCache.get(key);
  try { const db=await openTranslationDB(); const v=await new Promise((res,rej)=>{const tx=db.transaction(TDB_STORE,"readonly"),r=tx.objectStore(TDB_STORE).get(key);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)}); db.close(); if(v){state.translationCache.set(key,v); return v;} } catch(e){}
  return null;
}
async function putTranslationCache(key,value) {
  state.translationCache.set(key,value);
  try { const db=await openTranslationDB(); await new Promise((res,rej)=>{const tx=db.transaction(TDB_STORE,"readwrite");tx.objectStore(TDB_STORE).put(value,key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); } catch(e){}
}
async function clearTranslationCache() {
  state.translationCache.clear();
  try { const db=await openTranslationDB(); await new Promise((res,rej)=>{const tx=db.transaction(TDB_STORE,"readwrite");tx.objectStore(TDB_STORE).clear();tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); } catch(e){}
}
function hashText(s) {
  let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(16);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function cacheFile(file) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put({name:file.name, buffer:file.slice(0)} , DB_KEY);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch(e) { console.warn("Cache file gagal", e); }
}
async function getCachedFile() {
  try {
    const db = await openDB();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!data?.buffer) return null;
    const blob = data.buffer instanceof Blob ? data.buffer : new Blob([data.buffer]);
    return new File([blob], data.name || "english.ltc", {type:"application/octet-stream"});
  } catch(e) { console.warn("Cache read gagal", e); return null; }
}
async function clearCachedFile() {
  try { const db=await openDB(); await new Promise((resolve,reject)=>{ const tx=db.transaction(DB_STORE,"readwrite"); tx.objectStore(DB_STORE).delete(DB_KEY); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); db.close(); } catch(e) {}
}
const dec = new TextDecoder("utf-8", { fatal: false });

function originalTextAt(i) {
  return dec.decode(new Uint8Array(state.original.buffer, state.textOffsets[i], state.lengths[i]));
}
function decodeAt(i) {
  return state.dirty.has(i) ? state.dirty.get(i) : originalTextAt(i);
}
function placeholders(text) { return text.match(/\[%[^\]]+\]/g) || []; }
function countPrintable(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) n++;
  }
  return n;
}

async function buildIndexAsync(buffer, onProgress) {
  // Accept both ArrayBuffer and Uint8Array. The round-trip validator passes
  // the generated Uint8Array directly; DataView requires an ArrayBuffer.
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Exact FM2021 LTC layout observed in the supplied file:
  //   52-byte header
  //   178700 variable records: marker(1) + uint32le byteLength + UTF-8 text
  //   uint32 record count
  //   count × (uint32 string-id + uint32 record-offset-minus-8 + uint8 flags)
  //   uint32 zero footer
  // Header DWORD at offset 8 stores (indexStart - 12).
  if (bytes.length < 60 || bytes[0] !== 0x03 || bytes[1] !== 0x01 ||
      bytes[2] !== 0x63 || bytes[3] !== 0x74 || bytes[4] !== 0x6c || bytes[5] !== 0x2e) {
    throw new Error("Bukan struktur FM2021 LTC yang dikenali.");
  }

  const headerIndexValue = view.getUint32(8, true);
  const indexStart = headerIndexValue + 12;
  if (indexStart < 57 || indexStart + 4 > bytes.length) throw new Error("Posisi index LTC tidak valid.");

  // Four bytes immediately before the index are the record count.
  const countPos = indexStart - 4;
  const count = view.getUint32(countPos, true);
  if (!count || count > 1000000) throw new Error("Jumlah record LTC tidak valid.");
  const indexBytes = count * 9;
  const footerPos = indexStart + indexBytes;
  if (footerPos + 4 !== bytes.length) throw new Error("Ukuran tabel index LTC tidak cocok.");
  if (view.getUint32(footerPos, true) !== 0) throw new Error("Footer index LTC tidak valid.");

  const markers = new Array(count), textOffsets = new Array(count), lengths = new Array(count);
  const ids = new Array(count), flags = new Uint8Array(count);
  let previousMarker = -1, previousId = -1;

  // The index gives the authoritative record locations. This is important:
  // some records use marker bytes other than 0x01, so a naive forward scanner
  // can stop early and miss valid strings.
  for (let i = 0; i < count; i++) {
    const ep = indexStart + i * 9;
    const id = view.getUint32(ep, true);
    const off = view.getUint32(ep + 4, true);
    const flag = bytes[ep + 8];
    const marker = off + 8;
    if (marker <= previousMarker || marker + 5 > countPos) throw new Error(`Posisi string #${i + 1} tidak valid.`);
    if (i && id <= previousId) throw new Error(`ID string #${i + 1} tidak berurutan.`);
    const len = view.getUint32(marker + 1, true);
    const textStart = marker + 5;
    const textEnd = textStart + len;
    if (textEnd > countPos) throw new Error(`Panjang string #${i + 1} melewati area data.`);
    if (i && marker < markers[i - 1] + 5 + lengths[i - 1]) {
      throw new Error(`Record string #${i + 1} bertumpuk dengan record sebelumnya.`);
    }
    // Do not reject based on printable ratio. The index is authoritative and
    // LTC legitimately contains records with control-like bytes/formatting.
    markers[i] = marker;
    textOffsets[i] = textStart;
    lengths[i] = len;
    ids[i] = id;
    flags[i] = flag;
    previousMarker = marker;
    previousId = id;
    if ((i & 4095) === 0) {
      onProgress?.(Math.floor((i / count) * 99), i + 1);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const lastEnd = markers[count - 1] + 5 + lengths[count - 1];
  if (lastEnd !== countPos) throw new Error("Akhir area string LTC tidak cocok dengan index.");
  onProgress?.(100, count);
  return { markers, textOffsets, lengths, indexStart, indexCount: count, ids, flags };
}
function setFileInfo(msg) { $("fileInfo").textContent = msg; }
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2200);
}
function originalOffset(i) { return state.markers[i] || 0; }
function byteDelta(i) {
  if (!state.dirty.has(i)) return 0;
  return enc.encode(state.dirty.get(i)).length - state.lengths[i];
}
// Effective offset: every string after a changed-length record follows the new position.
function effectiveOffset(i) {
  if (i < 0) return 0;
  let delta = 0;
  for (const [idx] of state.dirty) {
    if (idx < i) delta += byteDelta(idx);
  }
  return originalOffset(i) + delta;
}
function effectiveLength(i) { return enc.encode(decodeAt(i)).length; }
function idFor(i) { return `#${i + 1}@${effectiveOffset(i).toLocaleString("id-ID")}`; }

function pageCount() {
  const total = state.searchMode ? state.lastResults.length : state.markers.length;
  return total ? Math.ceil(total / state.pageSize) : 0;
}
function pageItems() {
  const source = state.searchMode ? state.lastResults : null;
  const start = state.page * state.pageSize;
  if (source) return source.slice(start, start + state.pageSize);
  const end = Math.min(start + state.pageSize, state.markers.length);
  const arr = new Array(Math.max(0, end - start));
  for (let n = 0; n < arr.length; n++) arr[n] = start + n;
  return arr;
}
function updatePagination() {
  const totalPages = pageCount();
  if (!totalPages) {
    state.page = 0;
  } else if (state.page >= totalPages) {
    state.page = totalPages - 1;
  }
  const label = totalPages ? `Halaman ${(state.page + 1).toLocaleString("id-ID")} / ${totalPages.toLocaleString("id-ID")}` : "Halaman 0 / 0";
  ["pageInfo", "pageInfoBottom"].forEach(id => $(id).textContent = label);
  const prev = state.page > 0, next = totalPages > 0 && state.page < totalPages - 1;
  ["prevPageBtn", "prevPageBtnBottom"].forEach(id => $(id).disabled = !prev);
  ["nextPageBtn", "nextPageBtnBottom"].forEach(id => $(id).disabled = !next);
}

function renderResults() {
  const box = $("results");
  box.replaceChildren();
  const items = pageItems();
  const frag = document.createDocumentFragment();
  for (const i of items) {
    const text = decodeAt(i);
    const el = document.createElement("button");
    el.type = "button"; el.className = "result" + (state.selected === i ? " active" : ""); el.dataset.index = i;
    const title = document.createElement("div"); title.className = "result-title";
    title.textContent = `${i + 1}. ${idFor(i)}`;
    if (state.dirty.has(i)) { const d = document.createElement("span"); d.className = "result-dirty"; d.textContent = "● diubah"; title.appendChild(d); }
    const txt = document.createElement("div"); txt.className = "result-text-full"; txt.textContent = text;
    el.append(title, txt); frag.appendChild(el);
  }
  box.appendChild(frag);
  const total = state.searchMode ? state.lastResults.length : state.markers.length;
  if (!total) $("resultInfo").textContent = state.searchMode ? "Tidak ada hasil." : "Belum ada file.";
  else {
    const first = state.page * state.pageSize + 1, last = Math.min(first + items.length - 1, total);
    $("resultInfo").textContent = `${first.toLocaleString("id-ID")}–${last.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")} string`;
  }
  updatePagination();
}

function goPage(page) {
  const total = pageCount();
  if (!total) return;
  state.page = Math.max(0, Math.min(page, total - 1));
  renderResults();
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function searchMatches() {
  if (state.indexing) return;
  const q = state.filter.trim();
  const token = ++state.searchToken;
  if (!q && !state.placeholdersOnly) {
    state.searchMode = false; state.lastResults = []; state.page = 0; renderResults(); return;
  }
  state.searchMode = true; state.page = 0;
  $("resultInfo").textContent = "Mencari…"; $("results").replaceChildren(); updatePagination();
  await new Promise(r => setTimeout(r, 0));
  const needle = state.caseSensitive ? q : q.toLocaleLowerCase();
  const results = [];
  for (let i = 0; i < state.markers.length; i++) {
    if (token !== state.searchToken) return;
    const text = decodeAt(i), hay = state.caseSensitive ? text : text.toLocaleLowerCase();
    const match = !needle || hay.includes(needle), ph = !state.placeholdersOnly || placeholders(text).length > 0;
    if (match && ph) results.push(i);
    if (i % 800 === 0) await new Promise(r => setTimeout(r, 0));
  }
  if (token !== state.searchToken) return;
  state.lastResults = results; state.page = 0; renderResults();
}

function selectRecord(index) {
  if (index < 0 || index >= state.markers.length) return;
  state.selected = index;
  const text = decodeAt(index);
  $("recordTitle").textContent = `String #${index + 1}`;
  $("recordId").textContent = idFor(index);
  $("recordOffset").textContent = effectiveOffset(index).toLocaleString("id-ID");
  $("recordLength").textContent = `${effectiveLength(index).toLocaleString("id-ID")} byte`;
  $("recordPlaceholders").textContent = placeholders(text).join("  ") || "Tidak ada";
  $("editorText").value = text; $("editorText").disabled = false; $("applyBtn").disabled = false;
  $("prevBtn").disabled = index <= 0; $("nextBtn").disabled = index >= state.markers.length - 1;
  $("dirtyBadge").classList.toggle("hidden", !state.dirty.has(index));
  updateCharInfo(); updateWarning();
  document.querySelectorAll(".result.active").forEach(x => x.classList.remove("active"));
  const active = document.querySelector(`.result[data-index="${index}"]`);
  if (active) { active.classList.add("active"); active.scrollIntoView({ block: "nearest" }); }
}

function updateSelectedMetaAfterShift() {
  if (state.selected >= 0) {
    $("recordOffset").textContent = effectiveOffset(state.selected).toLocaleString("id-ID");
    $("recordLength").textContent = `${effectiveLength(state.selected).toLocaleString("id-ID")} byte`;
  }
}
function updateCharInfo() {
  const text = $("editorText").value;
  $("charInfo").textContent = `${text.length.toLocaleString("id-ID")} karakter · ${enc.encode(text).length.toLocaleString("id-ID")} byte UTF-8`;
}
function updateWarning() {
  if (state.selected < 0) { $("warning").classList.add("hidden"); return; }
  const oldPh = placeholders(originalTextAt(state.selected)), newPh = placeholders($("editorText").value);
  const missing = oldPh.filter(x => !newPh.includes(x)), added = newPh.filter(x => !oldPh.includes(x)), msgs = [];
  if (missing.length) msgs.push(`Placeholder hilang: ${missing.join(", ")}`);
  if (added.length) msgs.push(`Placeholder baru: ${added.join(", ")}`);
  const oldBytes = state.lengths[state.selected], newBytes = enc.encode($("editorText").value).length;
  if (newBytes !== oldBytes) msgs.push(`Panjang berubah ${oldBytes} → ${newBytes} byte. String setelahnya akan bergeser mengikuti perubahan ini saat export.`);
  $("warning").textContent = msgs.join("  "); $("warning").classList.toggle("hidden", msgs.length === 0);
}
function refreshVisibleResult(index) {
  const el = document.querySelector(`.result[data-index="${index}"] .result-text-full`);
  if (el) el.textContent = decodeAt(index);
  const result = document.querySelector(`.result[data-index="${index}"]`);
  if (result) {
    const title = result.querySelector(".result-title"), old = title.querySelector(".result-dirty");
    if (state.dirty.has(index) && !old) { const d = document.createElement("span"); d.className="result-dirty"; d.textContent="● diubah"; title.appendChild(d); }
    if (!state.dirty.has(index) && old) old.remove();
    title.firstChild.textContent = `${index + 1}. ${idFor(index)}`;
  }
}
function refreshPageOffsets() { renderResults(); updateSelectedMetaAfterShift(); }

function applyCurrent() {
  if (state.selected < 0) return;
  const i = state.selected, text = $("editorText").value, original = originalTextAt(i);
  if (text === original) state.dirty.delete(i); else state.dirty.set(i, text);
  invalidateDeltaCache();
  $("dirtyBadge").classList.toggle("hidden", !state.dirty.has(i));
  updateCharInfo(); updateWarning();
  $("saveBtn").disabled = false;
  // Re-render only the current page. This updates every later offset visible on the page
  // without creating DOM nodes for other pages.
  refreshPageOffsets();
  toast(state.dirty.has(i) ? "Perubahan diterapkan · posisi string setelahnya ikut bergeser" : "Kembali ke teks asli");
}

function computeNewSize() {
  let delta = 0;
  for (const [i, text] of state.dirty) delta += enc.encode(text).length - state.lengths[i];
  return state.original.byteLength + delta;
}

async function buildFileAsync(onProgress) {
  if (!state.dirty.size) return new Uint8Array(state.original);
  const old = state.original;
  const oldIndexStart = state.indexStart;
  const oldCountPos = oldIndexStart - 4;
  const changed = state.dirty;

  // Rebuild only the record area, then regenerate the count + index table.
  // The original 52-byte header is preserved except DWORD @ 8, which stores
  // (indexStart - 12) and therefore must follow a size change.
  let delta = 0;
  for (const [i, text] of changed) delta += enc.encode(text).length - state.lengths[i];
  const newIndexStart = oldIndexStart + delta;
  // The output must be exactly original size + total UTF-8 byte delta.
  const newSize = old.byteLength + delta;
  const out = new Uint8Array(newSize);
  const outView = new DataView(out.buffer);

  out.set(old.subarray(0, 52), 0);
  outView.setUint32(8, newIndexStart - 12, true);

  let outPos = 52;
  let oldPos = 52;
  const prefix = cumulativeDeltaForIndex.prefix || buildDeltaPrefix();

  for (let i = 0; i < state.indexCount; i++) {
    const marker = state.markers[i], oldEnd = state.textOffsets[i] + state.lengths[i];
    // Preserve any non-indexed bytes/gaps exactly as they occur in the source.
    if (oldPos < marker) {
      const gap = old.subarray(oldPos, marker);
      out.set(gap, outPos);
      outPos += gap.length;
    }
    if (changed.has(i)) {
      const textBytes = enc.encode(changed.get(i));
      out[outPos] = old[marker]; // preserve record marker/type (not always 0x01)
      outView.setUint32(outPos + 1, textBytes.length, true);
      out.set(textBytes, outPos + 5);
      outPos += 5 + textBytes.length;
    } else {
      const recordBytes = old.subarray(marker, oldEnd);
      out.set(recordBytes, outPos);
      outPos += recordBytes.length;
    }
    oldPos = oldEnd;
    if ((i & 4095) === 0) {
      onProgress?.(Math.floor((i / state.indexCount) * 70), i + 1);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Preserve any trailing bytes before the count, then write the count.
  if (oldPos < oldCountPos) {
    const tail = old.subarray(oldPos, oldCountPos);
    out.set(tail, outPos);
    outPos += tail.length;
  }
  // The 4-byte count sits immediately before the 9-byte index entries.
  outView.setUint32(outPos, state.indexCount, true);
  outPos += 4;
  if (outPos !== newIndexStart) throw new Error(`Posisi index baru tidak konsisten: ${outPos} / ${newIndexStart}`);

  for (let i = 0; i < state.indexCount; i++) {
    const oldEntry = oldIndexStart + i * 9;
    const newEntry = outPos;
    out.set(old.subarray(oldEntry, oldEntry + 4), newEntry); // ID
    const newMarker = state.markers[i] + prefix[i];
    outView.setUint32(newEntry + 4, newMarker - 8, true);
    out[newEntry + 8] = old[oldEntry + 8];
    outPos += 9;
    if ((i & 8191) === 0) {
      onProgress?.(70 + Math.floor((i / state.indexCount) * 29), i + 1);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Preserve the original 4-byte zero footer.
  const oldFooterStart = oldIndexStart + state.indexCount * 9;
  const footer = old.subarray(oldFooterStart, oldFooterStart + 4);
  if (footer.length !== 4) throw new Error("Footer LTC asli tidak lengkap.");
  out.set(footer, outPos);
  outPos += footer.length;
  if (outPos !== out.length) {
    throw new Error(`Ukuran hasil tidak konsisten: ${outPos} / ${out.length} (delta ${delta}, index baru ${newIndexStart})`);
  }
  onProgress?.(100, state.indexCount);
  return out;
}

function buildDeltaPrefix() {
  const prefix = new Int32Array(state.markers.length + 1);
  for (let n = 0; n < state.markers.length; n++) prefix[n + 1] = prefix[n] + byteDelta(n);
  cumulativeDeltaForIndex.prefix = prefix;
  return prefix;
}
// Cache prefix byte-deltas so rebuilding the 178k-entry index stays linear,
// not quadratic. The cache is invalidated whenever an edit is applied.
function cumulativeDeltaForIndex(i) {
  if (!cumulativeDeltaForIndex.prefix || cumulativeDeltaForIndex.prefix.length !== state.markers.length + 1) {
    const prefix = new Int32Array(state.markers.length + 1);
    for (let n = 0; n < state.markers.length; n++) {
      prefix[n + 1] = prefix[n] + byteDelta(n);
    }
    cumulativeDeltaForIndex.prefix = prefix;
  }
  return cumulativeDeltaForIndex.prefix[i];
}
cumulativeDeltaForIndex.prefix = null;

function invalidateDeltaCache() { cumulativeDeltaForIndex.prefix = null; }

function validateBuiltFile(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 60 || bytes[0] !== 0x03 || bytes[1] !== 0x01 || bytes[2] !== 0x63 || bytes[3] !== 0x74 || bytes[4] !== 0x6c || bytes[5] !== 0x2e) return false;
  const idx = view.getUint32(8, true) + 12;
  if (idx < 57 || idx + state.indexCount * 9 + 4 !== bytes.length) return false;
  const countPos = idx - 4;
  if (view.getUint32(countPos, true) !== state.indexCount) return false;
  const prefix = cumulativeDeltaForIndex.prefix || buildDeltaPrefix();
  let previousMarker = -1;
  for (let i = 0; i < state.indexCount; i++) {
    const ep = idx + i * 9;
    if (view.getUint32(ep, true) !== state.indexIds[i]) return false;
    const marker = view.getUint32(ep + 4, true) + 8;
    const expectedMarker = state.markers[i] + prefix[i];
    if (marker !== expectedMarker || marker <= previousMarker) return false;
    if (bytes[marker] !== state.original[state.markers[i]]) return false;
    const len = view.getUint32(marker + 1, true);
    const expectedLen = effectiveLength(i);
    if (len !== expectedLen) return false;
    if (marker + 5 + len > countPos) return false;
    if (bytes[ep + 8] !== state.indexFlags[i]) return false;
    previousMarker = marker;
  }
  const lastMarker = view.getUint32(idx + (state.indexCount - 1) * 9 + 4, true) + 8;
  if (lastMarker + 5 + view.getUint32(lastMarker + 1, true) > countPos) return false;
  return view.getUint32(idx + state.indexCount * 9, true) === 0;
}
async function verifyRoundTrip(bytes) {
  const parsed = await buildIndexAsync(bytes, null);
  if (parsed.indexCount !== state.indexCount) throw new Error("Round-trip: jumlah string berubah.");
  for (let i = 0; i < state.indexCount; i++) {
    if (parsed.ids[i] !== state.indexIds[i]) throw new Error(`Round-trip: ID string #${i + 1} berubah.`);
    if (parsed.flags[i] !== state.indexFlags[i]) throw new Error(`Round-trip: flag string #${i + 1} berubah.`);
    const expected = decodeAt(i);
    const got = dec.decode(new Uint8Array(bytes.buffer, bytes.byteOffset + parsed.textOffsets[i], parsed.lengths[i]));
    if (got !== expected) throw new Error(`Round-trip: isi string #${i + 1} berubah.`);
  }
  return true;
}

// ---------- Offline AI bulk translation (MarianMT / OPUS-MT EN→ID + FM2021 smart post-processing) ----------
// The model is hosted on Hugging Face and executed locally in the browser via ONNX.
// Transformers.js supports browser-side translation and quantized dtypes for smaller downloads.
const TRANSFORMERS_MODEL = "Xenova/opus-mt-en-id";
let transformersReady = true;
try {
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
} catch(e) { console.warn("Transformers env", e); }

function getTranslationDevice() {
  const selected = $("translateDevice")?.value || "auto";
  if (selected === "webgpu") return navigator.gpu ? "webgpu" : "wasm";
  return "wasm";
}
function getTranslationDType(device) { return device === "webgpu" ? "q4f16" : "q8"; }
function getModelSpec(model) {
  if (/opus-mt-en-id/i.test(model)) return {name:"MarianMT / OPUS-MT EN→ID", src:null, tgt:null, heavy:false};
  return {name:model, src:null, tgt:null, heavy:false};
}
function modelGenerationArgs(model) {
  const spec=getModelSpec(model), q=getTranslationQuality();
  return spec.src ? {src_lang:spec.src,tgt_lang:spec.tgt,...q} : {...q};
}
function translationProgress(info) {
  const wrap=$("translateModelProgressWrap"), bar=$("translateModelProgressBar"), txt=$("translateModelProgressText");
  if (!wrap || !bar || !txt) return;
  wrap.classList.remove("hidden");
  if (typeof info?.progress === "number") bar.style.width=Math.max(0,Math.min(100,info.progress))+"%";
  const file=info?.file ? String(info.file).split("/").pop() : "";
  if (info?.status === "progress") txt.textContent=`Mengunduh model… ${Math.round(info.progress||0)}%${file?" · "+file:""}`;
  else if (info?.status === "initiate") txt.textContent=`Menyiapkan ${file||"model"}…`;
  else if (info?.status === "done") txt.textContent=`Selesai memuat ${file||"model"}.`;
  else if (info?.status === "ready") txt.textContent="Model siap.";
  else if (info?.status === "download") txt.textContent=`Mengunduh ${file||"model"}…`;
}
function maskPlaceholders(text) {
  const map=[];
  const masked=text.replace(/\[%[^\]]+\]/g,m=>{const n=map.length;map.push(m);return ` LTCPLACEHOLDER${n} `;});
  return {masked,map};
}
function restorePlaceholders(text,map) {
  for(let i=0;i<map.length;i++) {
    const exact=`LTCPLACEHOLDER${i}`;
    const re=new RegExp(`\\bLTC\\s*PLACEHOLDER\\s*${i}\\b|\\bLTCPLACEHOLDER${i}\\b|\\[\\[?\\s*LTCPLACEHOLDER${i}\\s*\\]?\\]`,"gi");
    if(!re.test(text)) return null;
    text=text.replace(re,map[i]);
  }
  return text;
}
function shouldTranslateText(text) {
  const t=text.trim(); if(!t || t.length<2) return false;
  if(!/[A-Za-z]/.test(t)) return false;
  if(/^(https?:\/\/|www\.|[A-Z0-9_./:-]+$)/.test(t) && !/\s/.test(t)) return false;
  if(/^[%$#@{}<>\[\]()+=*0-9._\-\/\\]+$/.test(t)) return false;
  // Skip very obvious file/code identifiers.
  if(/^(?:[a-zA-Z]:\\|[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|xml|json|ini|cfg|dat|ltc))$/i.test(t)) return false;
  return true;
}
function normalizeForMemory(text) { return text.replace(/\s+/g," ").trim(); }
async function loadLocalTranslator() {
  if (state.translator) return state.translator;
  if (state.translatorLoading) return state.translatorLoading;
  if (!transformersReady) throw new Error("Library AI browser gagal dimuat.");
  const model=$("translateModel")?.value || TRANSFORMERS_MODEL;
  const spec=getModelSpec(model);
  const requested=getTranslationDevice();
  state.translatorDevice=requested; state.translatorModel=model;
  state.translatorLoading=(async()=>{
    $("translateLoadBtn").disabled=true;
    $("translateModelProgressWrap").classList.remove("hidden");
    $("translateModelProgressBar").style.width="0%";
    let device=requested, dtype=getTranslationDType(device);
    try {
      let pipe;
      try {
        $("translateModelProgressText").textContent=`Menyiapkan ${spec.name} (${device.toUpperCase()}, ${dtype})…`;
        pipe=await pipeline("translation", model, {device, dtype, progress_callback:translationProgress});
      } catch(firstError) {
        if ($("translateDevice")?.value === "auto" && device === "webgpu") {
          $("translateModelProgressText").textContent="WebGPU gagal, beralih ke CPU/WASM…";
          device="wasm"; dtype="q8";
          pipe=await pipeline("translation", model, {device, dtype, progress_callback:translationProgress});
        } else throw firstError;
      }
      state.translatorDevice=device; state.translator=pipe;
      $("translateModelProgressBar").style.width="100%";
      $("translateModelProgressText").textContent=`${spec.name} siap · ${device.toUpperCase()} · ${dtype}`;
      $("translateLoadBtn").textContent="✓ Marian Fallback Siap";
      toast(`${spec.name} siap · ${device.toUpperCase()}`);
      return pipe;
    } catch(e) {
      state.translator=null; $("translateLoadBtn").disabled=false;
      $("translateLoadBtn").textContent="⬇ Muat Marian Fallback";
      $("translateModelProgressText").textContent=`Gagal memuat ${spec.name}: ${e.message}`;
      throw e;
    } finally { state.translatorLoading=null; }
  })();
  return state.translatorLoading;
}
function prepareForTranslation(text) {
  const {masked,map}=maskPlaceholders(text);
  // Preserve newlines as a stable token so the model cannot collapse them unpredictably.
  return {masked:masked.replace(/\r?\n/g," LTCNEWLINE "), map};
}
function restoreTranslation(text,map) {
  let out=text.replace(/\bLTCNEWLINE\b/gi,"\n");
  const restored=restorePlaceholders(out,map);
  return restored===null ? null : restored.replace(/[ \t]+\n/g,"\n").trim();
}
function splitOuterWhitespace(text) {
  const m=text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return m ? {leading:m[1], core:m[2], trailing:m[3]} : {leading:"",core:text,trailing:""};
}
function getTranslationQuality() {
  const v=$("translateQuality")?.value || "balanced";
  if(v==="high") return {num_beams:4, max_new_tokens:192};
  if(v==="fast") return {num_beams:1, max_new_tokens:128};
  return {num_beams:2, max_new_tokens:160};
}

// Deterministic Football Manager 2021 terminology corrections.
const FM2021_GLOSSARY = [
  [/\bkaki pertama\b/gi,"leg pertama"],[/\bkaki kedua\b/gi,"leg kedua"],[/\bkaki ketiga\b/gi,"leg ketiga"],
  [/\bkaki kandang\b/gi,"leg kandang"],[/\bkaki tandang\b/gi,"leg tandang"],[/\bpelatih kepala\b/gi,"manajer"],
  [/\bpelatih\b/gi,"manajer"],[/\bpertandingan persahabatan\b/gi,"laga persahabatan"],
  [/\banggaran pemindahan\b/gi,"anggaran transfer"],[/\bbujet transfer\b/gi,"anggaran transfer"],
  [/\bpertandingan kandang\b/gi,"laga kandang"],[/\bpertandingan tandang\b/gi,"laga tandang"],
  [/\bpermainan kandang\b/gi,"laga kandang"],[/\bpermainan tandang\b/gi,"laga tandang"],
  [/\bpenjaga gawang\b/gi,"kiper"],[/\bpasar transfer\b/gi,"bursa transfer"],[/\bpasar pemain\b/gi,"bursa transfer"],
  [/\bklub sepak bola\b/gi,"klub"],[/\btransfer budget\b/gi,"anggaran transfer"],[/\btarget transfer\b/gi,"target transfer"],
  [/\bjendela transfer\b/gi,"bursa transfer"],[/\btransfer window\b/gi,"bursa transfer"],
  [/\btransfer market\b/gi,"bursa transfer"],[/\btransfer list\b/gi,"daftar transfer"],
  [/\bstarting eleven\b/gi,"sebelas pemain utama"],[/\bstarting line-up\b/gi,"susunan pemain utama"],
  [/\bstarting lineup\b/gi,"susunan pemain utama"],[/\bsubstitute\b/gi,"pemain pengganti"],
  [/\bsubstitutes\b/gi,"pemain pengganti"],[/\bfirst team\b/gi,"tim utama"],
  [/\breserve team\b/gi,"tim cadangan"],[/\byouth team\b/gi,"tim junior"],
  [/\bmatch day\b/gi,"hari pertandingan"],[/\bmatchday\b/gi,"hari pertandingan"],
  [/\bhome team\b/gi,"tim kandang"],[/\baway team\b/gi,"tim tandang"],
  [/\bhome fixture\b/gi,"laga kandang"],[/\baway fixture\b/gi,"laga tandang"],
  [/\bcontract offer\b/gi,"tawaran kontrak"],[/\bcontract renewal\b/gi,"perpanjangan kontrak"],
  [/\btransfer offer\b/gi,"tawaran transfer"],[/\bloan offer\b/gi,"tawaran peminjaman"],
  [/\bloan move\b/gi,"peminjaman"],[/\bscouting report\b/gi,"laporan pencari bakat"],
  [/\bscout report\b/gi,"laporan pencari bakat"],[/\bmedical report\b/gi,"laporan medis"],
  [/\btraining session\b/gi,"sesi latihan"],[/\btraining schedule\b/gi,"jadwal latihan"],
  [/\bteam talk\b/gi,"pembicaraan tim"],[/\bteam meeting\b/gi,"rapat tim"],
  [/\bpress conference\b/gi,"konferensi pers"],[/\bpress conference\b/gi,"konferensi pers"],
  [/\bboard meeting\b/gi,"rapat direksi"],[/\bclub vision\b/gi,"visi klub"],
  [/\btransfer deadline\b/gi,"batas akhir transfer"],[/\btransfer listed\b/gi,"dimasukkan daftar transfer"],
];
function cleanMarianArtifacts(text) {
  let out=text;
  const fixes=[
    [/\bnyala\b/gi,"pada"],[/\bakan\s+akan\b/gi,"akan"],[/\buntuk\s+untuk\b/gi,"untuk"],
    [/\bdari\s+dari\b/gi,"dari"],[/\bdengan\s+dengan\b/gi,"dengan"],[/\bke\s+ke\b/gi,"ke"],
    [/\bdi\s+di\b/gi,"di"],[/\bpada\s+pada\b/gi,"pada"],[/\bsebuah\s+sebuah\b/gi,"sebuah"],
    [/\bjendela\s+transfer\b/gi,"bursa transfer"],[/\bpasar\s+transfer\b/gi,"bursa transfer"],
    [/\bdaftar\s+pinjaman\b/gi,"daftar peminjaman"],[/\bpinjaman\b/gi,"peminjaman"],
  ];
  for(const [re,repl] of fixes) out=out.replace(re,repl);
  for(const [re,repl] of FM2021_GLOSSARY) out=out.replace(re,repl);
  return out;
}
function applyFootballGrammar(text) {
  let out=cleanMarianArtifacts(text);
  out=out.replace(/\b(?:di|pada|ke|dari|oleh|dengan)\s+(\[%[^\]]+\])/gi,(m,p)=>{
    const low=p.toLowerCase();
    if(/date|tanggal/.test(low)) return `pada ${p}`;
    if(/time|waktu/.test(low)) return `pukul ${p}`;
    if(/stadium|venue|ground/.test(low)) return `di ${p}`;
    return m;
  });
  return out.replace(/\s{2,}/g," ").trim();
}


// ---------- V21 Google-first Quality Engine ----------
// Google Translate experimental/unofficial endpoint is the PRIMARY translator.
// MarianMT remains an optional fallback for network/CORS/rate-limit failures.
// This is NOT Google Cloud Translation API and is not guaranteed to be available.
const GOOGLE_ENDPOINTS = [
  {name:"Google Translate GTX", url:"https://translate.googleapis.com/translate_a/single", type:"gtx"},
  {name:"Google Chrome Translate", url:"https://clients5.google.com/translate_a/t", type:"chrome"}
];
const ONLINE_DELAY_MS = 700;
const ONLINE_MAX_CHARS = 4500;
const ONLINE_RETRIES = 2;

function getTranslationEngine() { return $("translateEngine")?.value || "google"; }
function getOnlineBudget() { return Math.max(1, Number($("translateOnlineBudget")?.value) || 178700); }
function getOnlineDelay() { return Math.max(350, Number($("translateOnlineDelay")?.value) || ONLINE_DELAY_MS); }
function getOnlineRetries() { const n=Number($("translateOnlineRetries")?.value); return Math.max(0, Math.min(4, Number.isFinite(n)?n:ONLINE_RETRIES)); }
function getFallbackEnabled() { return $("translateFallbackMarian")?.checked !== false; }

function englishWordSet(text) {
  const words = (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []);
  return new Set(words);
}
const COMMON_EN_WORDS = new Set([
  "the","and","or","but","with","without","from","into","for","your","you","are","will","would","should","could","can","cannot","has","have","had","this","that","these","those","new","old","next","previous","current","manager","player","players","club","team","match","matches","competition","transfer","budget","contract","offer","offers","league","cup","season","training","staff","board","squad","tactic","tactics","role","roles","position","injury","injured","available","unavailable","stadium","home","away","goal","goals","assist","assists","score","scored","wins","win","lost","loss","draw","drawn","fixture","fixtures"
]);
function qualityIssues(source, output) {
  const issues=[];
  const srcPh=placeholders(source), outPh=placeholders(output);
  if (srcPh.length !== outPh.length || srcPh.some((x,i)=>x!==outPh[i])) issues.push("placeholder");
  if (!output || output.trim().length < 2) issues.push("empty");
  const s=source.trim().toLowerCase(), o=output.trim().toLowerCase();
  if (s && o===s) issues.push("unchanged");
  if (/\b(?:kaki pertama|kaki kedua|kaki ketiga|pelatih kepala|anggaran pemindahan|bujet transfer|nyala)\b/i.test(output)) issues.push("glossary");
  if (/\b(?:akan\s+akan|untuk\s+untuk|dari\s+dari|dengan\s+dengan|ke\s+ke|di\s+di|pada\s+pada)\b/i.test(output)) issues.push("duplicate");
  const srcWords=englishWordSet(source), outWords=englishWordSet(output);
  let overlap=0;
  for(const w of outWords) if(COMMON_EN_WORDS.has(w) && srcWords.has(w)) overlap++;
  if (outWords.size && overlap>=3) issues.push("english");
  if (/[\uFFFD]/.test(output)) issues.push("encoding");
  if (source.length>40 && output.length<Math.max(8, source.length*0.18)) issues.push("too-short");
  return [...new Set(issues)];
}
function isValidGoogleResult(source, output) {
  const issues=qualityIssues(source,output);
  return !!output && !issues.includes("placeholder") && !issues.includes("empty") && !issues.includes("encoding");
}
function parseGoogleTranslateResponse(data, type="gtx") {
  if(type==="chrome") {
    if(Array.isArray(data)) {
      if(Array.isArray(data[0]) && typeof data[0][0]==="string") return data[0][0].trim();
      if(Array.isArray(data[0]) && Array.isArray(data[0][0]) && typeof data[0][0][0]==="string") return data[0][0][0].trim();
    }
    if(data?.sentences) return data.sentences.map(x=>x?.trans||"").join("").trim();
    throw new Error("Format respons Google Chrome Translate tidak dikenali.");
  }
  if(!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("Format respons Google Translate tidak dikenali.");
  return data[0].filter(x=>Array.isArray(x)&&typeof x[0]==="string").map(x=>x[0]).join("").trim();
}
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
async function fetchGoogleEndpoint(endpoint, text) {
  const params = endpoint.type === "chrome"
    ? `?client=dict-chrome-ex&sl=en&tl=id&q=${encodeURIComponent(text)}`
    : `?client=gtx&sl=en&tl=id&dt=t&q=${encodeURIComponent(text)}`;
  const response=await fetch(endpoint.url+params,{method:"GET",mode:"cors",cache:"no-store",headers:{"Accept":"application/json,text/plain,*/*"}});
  if(!response.ok) {
    const e=new Error(`HTTP ${response.status}`); e.httpStatus=response.status; throw e;
  }
  const data=await response.json();
  return parseGoogleTranslateResponse(data,endpoint.type);
}
async function translateOnlineFragment(text) {
  const core=String(text||"").trim();
  if(!shouldTranslateText(core)) return text;
  if(core.length>ONLINE_MAX_CHARS) throw new Error(`String Google terlalu panjang (${core.length} karakter).`);
  if(state.onlineUsed>=state.onlineBudget) throw new Error("Batas Google sesi sudah tercapai.");
  if(state.onlineBlocked) throw new Error("Akses Google sedang dibatasi pada sesi ini.");
  const wait=Math.max(0,getOnlineDelay()-(Date.now()-state.onlineLastAt));
  if(wait) await sleep(wait);
  let lastError=null;
  const retries=getOnlineRetries();
  for(let attempt=0;attempt<=retries;attempt++) {
    for(const endpoint of GOOGLE_ENDPOINTS) {
      try {
        const out=await fetchGoogleEndpoint(endpoint,core);
        if(!out) throw new Error("Google mengembalikan terjemahan kosong.");
        state.onlineUsed++;
        state.onlineLastAt=Date.now();
        state.onlineLastEndpoint=endpoint.name;
        return out;
      } catch(e) {
        lastError=e;
        // Try the second Google endpoint before declaring the whole service blocked.
      }
    }
    if(attempt<retries) await sleep(Math.min(8000,1200*Math.pow(2,attempt)));
  }
  if(lastError?.httpStatus===403 || lastError?.httpStatus===429 || lastError?.name==="TypeError") state.onlineBlocked=true;
  throw new Error(`Google tidak dapat diakses: ${lastError?.httpStatus?`HTTP ${lastError.httpStatus} · `:""}${lastError?.message||"jaringan/CORS"}`);
}
function googleMaskPlaceholders(text) {
  const map=[];
  const masked=text.replace(/\[%[^\]]+\]/g, m=>{
    const token=`ZZLTCVAR${map.length}Q`;
    map.push({token,value:m});
    return token;
  });
  return {masked,map};
}
function restoreGooglePlaceholders(text,map) {
  let out=String(text||"");
  for(const item of map) {
    const escaped=item.token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const re=new RegExp(escaped.replace(/ZZLTCVAR(\d+)Q/i,"ZZ\\s*LTC\\s*VAR\\s*$1\\s*Q"),"gi");
    if(!re.test(out)) return null;
    out=out.replace(re,item.value);
  }
  return out;
}
async function translateTextOnlineKeepingPlaceholders(text) {
  const originalPh=placeholders(text);
  if(!originalPh.length) return applyFootballGrammar(await translateOnlineFragment(text));
  const {masked,map}=googleMaskPlaceholders(text);
  const translated=await translateOnlineFragment(masked);
  const restored=restoreGooglePlaceholders(translated,map);
  if(restored===null) throw new Error("Google mengubah placeholder LTC.");
  const out=applyFootballGrammar(restored);
  const outPh=placeholders(out);
  if(outPh.length!==originalPh.length || outPh.some((x,i)=>x!==originalPh[i])) throw new Error("Placeholder Google tidak identik dengan sumber.");
  return out;
}
async function maybeOnlineImprove(source, localOutput) {
  if(getTranslationEngine()==="marian") return localOutput;
  if(state.onlineBlocked || state.onlineUsed>=state.onlineBudget) return localOutput;
  try {
    const improved=await translateTextOnlineKeepingPlaceholders(source);
    return isValidGoogleResult(source,improved) ? improved : localOutput;
  } catch(e) {
    state.onlineLastError=e.message;
    return localOutput;
  }
}

function placeholderParts(text) {
  const re=/\[%[^\]]+\]/g;
  const parts=[]; let last=0, m;
  while((m=re.exec(text))){
    if(m.index>last) parts.push({type:"text",value:text.slice(last,m.index)});
    parts.push({type:"placeholder",value:m[0]});
    last=m.index+m[0].length;
  }
  if(last<text.length) parts.push({type:"text",value:text.slice(last)});
  return parts;
}

// Translate around placeholders instead of replacing them with artificial tokens.
// The model may split or omit synthetic tokens. Splitting the sentence at the exact
// [%...] markers and validating every marker guarantees the original FM2021 placeholders survive byte-for-byte.
async function translateTextKeepingPlaceholders(pipe, text) {
  const parts=placeholderParts(text);
  let out="";
  for(const part of parts){
    if(part.type==="placeholder") { out+=part.value; continue; }
    if(!shouldTranslateText(part.value)) { out+=part.value; continue; }
    const lines=part.value.split(/(\r?\n)/);
    for(const line of lines){
      if(/^\r?\n$/.test(line) || !line) { out+=line; continue; }
      const {leading,core,trailing}=splitOuterWhitespace(line);
      if(!shouldTranslateText(core)) { out+=line; continue; }
      const r=await pipe([core],modelGenerationArgs(state.translatorModel));
      const x=Array.isArray(r)?r[0]:r, translated=typeof x==="string"?x:x?.translation_text;
      if(!translated) throw new Error("Model tidak mengembalikan teks terjemahan.");
      out+=leading+translated.trim()+trailing;
    }
  }
  return applyFootballGrammar(out);
}

async function translateBatchLocal(items) {
  const engine=getTranslationEngine();
  const outputs=new Array(items.length);
  if(engine==="marian") {
    const pipe=await loadLocalTranslator();
    const simple=[], placeholder=[];
    items.forEach((it,i)=>(/\[%[^\]]+\]/.test(it.text)?placeholder:simple).push(i));
    if(simple.length){
      const result=await pipe(simple.map(i=>items[i].text),modelGenerationArgs(state.translatorModel));
      for(let j=0;j<simple.length;j++){ const x=result[j]; outputs[simple[j]]=applyFootballGrammar(typeof x==="string"?x:x?.translation_text||""); }
    }
    for(const i of placeholder) outputs[i]=await translateTextKeepingPlaceholders(pipe,items[i].text);
    return outputs;
  }

  // V21 Google-first: every new string is sent to Google first. Marian is used
  // only when explicitly enabled and Google is unavailable/blocked.
  for(let i=0;i<items.length;i++) {
    const item=items[i];
    try {
      outputs[i]=await translateTextOnlineKeepingPlaceholders(item.text);
    } catch(e) {
      state.onlineLastError=e.message;
      if(getFallbackEnabled()) {
        try {
          const pipe=await loadLocalTranslator();
          outputs[i]=await translateTextKeepingPlaceholders(pipe,item.text);
          state.fallbackUsed++;
        } catch(fallbackError) {
          throw new Error(`Google gagal (${e.message}) dan Marian fallback juga gagal: ${fallbackError.message}`);
        }
      } else {
        throw e;
      }
    }
    await new Promise(r=>setTimeout(r,0));
  }
  return outputs;
}
async function testLocalTranslation() {
  try {
    const engine=getTranslationEngine();
    const fmSample="The first leg will be played at [%stadium#1-short] on [%date#1-long].";
    let lines=`Engine utama: ${engine}\n`;
    let fmOut;
    if(engine==="marian") {
      const pipe=await loadLocalTranslator();
      const samples=["Hello, this is a test.","Are you sure you want to continue?","Manager","Transfer budget"];
      const result=await pipe(samples,modelGenerationArgs(state.translatorModel));
      lines+=result.map((x,i)=>`${samples[i]} → ${x.translation_text}`).join("\n");
      fmOut=await translateTextKeepingPlaceholders(pipe,fmSample);
    } else {
      fmOut=await translateTextOnlineKeepingPlaceholders(fmSample);
      lines+=`Google endpoint: ${state.onlineLastEndpoint||"—"}`;
      if(state.onlineLastError) lines+=`\nPeringatan terakhir: ${state.onlineLastError}`;
    }
    $("translateStats").textContent=`Tes engine V21\n\n${lines}\n\nTes FM2021:\n${fmSample}\n→ ${fmOut}`;
    toast("Tes terjemahan berhasil");
  } catch(e) {
    console.error(e); toast(`Tes AI gagal: ${e.message}`); $("translateStats").textContent=`Gagal menjalankan tes: ${e.message}`;
  }
}
async function buildTranslationQueue() {
  const mode=$("translateMode")?.value||"all"; let indices=[];
  if(mode==="page") indices=pageItems();
  else { const limit=mode==="1000"?1000:Infinity; for(let i=0;i<state.indexCount && indices.length<limit;i++) indices.push(i); }
  const unique=new Map(), queue=[]; let cached=0, skipped=0;
  const useCache=$("translateUseCache")?.checked!==false;
  for(const i of indices){
    const text=decodeAt(i); if(!shouldTranslateText(text)){skipped++;continue;}
    if(state.dirty.has(i)) { skipped++; continue; }
    // V21 cache namespace prevents old Marian/V20 results from being mistaken
    // for Google-first translations.
    const norm=normalizeForMemory(text), key=`v21-google-en-id:${hashText(norm)}`;
    if(useCache){ const cachedVal=await getTranslationCache(key); if(cachedVal){state.dirty.set(i,cachedVal);cached++;continue;} }
    if(unique.has(key)) unique.get(key).indices.push(i);
    else { const item={key,text,indices:[i]}; unique.set(key,item); queue.push(item); }
    if((i&255)===0) await new Promise(r=>setTimeout(r,0));
  }
  return {queue,cached,skipped,total:indices.length};
}
async function startTranslation() {
  if(state.translationRunning || !state.original) return;
  state.translationPaused=false; state.translationRunning=true;
  state.onlineBudget=getOnlineBudget(); state.onlineUsed=0; state.onlineBlocked=false; state.onlineLastError=""; state.fallbackUsed=0;
  $("translateStartBtn").disabled=true; $("translatePauseBtn").disabled=false;
  $("translateProgressWrap").classList.remove("hidden");
  try {
    const engine=getTranslationEngine();
    if(engine==="marian") await loadLocalTranslator();
    const plan=await buildTranslationQueue(); state.translationQueue=plan.queue; state.translationTotal=plan.queue.length; state.translationDone=0;
    $("translateStats").textContent=`Engine: ${engine} · Antrian unik: ${plan.queue.length.toLocaleString("id-ID")} · cache: ${plan.cached.toLocaleString("id-ID")} · dilewati: ${plan.skipped.toLocaleString("id-ID")} · batas Google: ${state.onlineBudget.toLocaleString("id-ID")}`;
    if(!plan.queue.length){ refreshPageOffsets(); toast("Tidak ada string baru yang perlu diterjemahkan"); return; }
    const batchSize=Math.max(1,Math.min(20,Number($("translateBatch").value)||5)); let cursor=0;
    while(cursor<plan.queue.length){
      if(state.translationPaused){ toast("Terjemahan dijeda. Hasil yang sudah selesai tetap tersimpan di cache."); return; }
      const batch=plan.queue.slice(cursor,cursor+batchSize);
      const outputs=await translateBatchLocal(batch);
      for(let j=0;j<batch.length;j++){
        const item=batch[j], out=(outputs[j]||item.text).trim();
        if($("translateUseCache")?.checked!==false) await putTranslationCache(item.key,out);
        for(const idx of item.indices) state.dirty.set(idx,out);
      }
      cursor+=batch.length; state.translationDone=cursor;
      const pct=Math.floor(cursor/plan.queue.length*100);
      $("translateProgressBar").style.width=pct+"%";
      const googleNote=` · Google ${state.onlineUsed}/${state.onlineBudget}${state.onlineBlocked?" · dibatasi":""}`;
      const fallbackNote=state.fallbackUsed?` · fallback Marian ${state.fallbackUsed}`:"";
      $("translateProgressText").textContent=`Menerjemahkan ${cursor.toLocaleString("id-ID")} / ${plan.queue.length.toLocaleString("id-ID")} · ${pct}%${googleNote}${fallbackNote}`;
      $("translateStats").textContent=`Google-first · selesai: ${cursor.toLocaleString("id-ID")} · Google: ${state.onlineUsed.toLocaleString("id-ID")}/${state.onlineBudget.toLocaleString("id-ID")}${state.onlineBlocked?" · akses dibatasi":""} · fallback Marian: ${state.fallbackUsed.toLocaleString("id-ID")}${state.onlineLastError?`\nPesan terakhir: ${state.onlineLastError}`:""}`;
      refreshPageOffsets(); await new Promise(r=>setTimeout(r,0));
    }
    toast(`Terjemahan selesai · ${plan.queue.length.toLocaleString("id-ID")} teks unik`);
  } catch(e){ console.error(e); toast(`Terjemahan berhenti: ${e.message}`); $("translateProgressText").textContent=e.message; }
  finally { state.translationRunning=false; updateTranslationUI(); $("translatePauseBtn").disabled=true; }
}
function pauseTranslation(){ if(state.translationRunning){state.translationPaused=true; $("translatePauseBtn").disabled=true;} }
function updateTranslationUI(){
  const ok=!!state.original, engine=getTranslationEngine();
  $("translateLoadBtn").disabled=!ok || engine!=="marian" || !!state.translator || !!state.translatorLoading;
  $("translateTestBtn").disabled=!ok || !!state.translatorLoading;
  $("translateStartBtn").disabled=!ok || state.translationRunning || (engine==="marian" && !state.translator);
  $("translateClearCacheBtn").disabled=!ok || state.translationRunning;
}

function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], {type:"application/octet-stream"}), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function saveFile() {
  applyCurrent();
  if (!state.original) return;
  if (!state.dirty.size) { toast("Belum ada perubahan untuk disimpan"); return; }
  const saveBtn = $("saveBtn");
  saveBtn.disabled = true;
  $("progressWrap").classList.remove("hidden"); $("progressBar").style.width = "0%";
  try {
    const out = await buildFileAsync((pct) => { $("progressBar").style.width = `${pct}%`; $("progressText").textContent = `Membangun LTC aman… ${pct}%`; });
    if (!validateBuiltFile(out)) throw new Error("Validasi struktur hasil gagal.");
    $("progressText").textContent = "Memeriksa ulang file hasil…";
    await verifyRoundTrip(out);
    const base = state.fileName.replace(/\.ltc$/i, "");
    downloadBytes(out, `${base}_edited.ltc`);
    toast(`LTC valid disimpan · ${state.dirty.size} string diubah · ${out.byteLength.toLocaleString("id-ID")} byte`);
  } catch (e) { console.error(e); toast(`Gagal membuat LTC: ${e.message}`); }
  finally { $("progressWrap").classList.add("hidden"); saveBtn.disabled = false; }
}
function resetEditor() {
  state.selected=-1; state.dirty.clear(); $("editorText").value=""; $("editorText").disabled=true; $("applyBtn").disabled=true;
  $("prevBtn").disabled=true; $("nextBtn").disabled=true; $("dirtyBadge").classList.add("hidden"); $("recordTitle").textContent="Belum ada string dipilih";
  $("recordId").textContent=$("recordOffset").textContent=$("recordLength").textContent=$("recordPlaceholders").textContent="—";
  $("charInfo").textContent="0 karakter · 0 byte UTF-8"; $("warning").classList.add("hidden");
}
async function loadFile(file, fromCache=false) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const buf = reader.result;
      state.fileName=file.name; state.original=new Uint8Array(buf); state.markers=[]; state.textOffsets=[]; state.lengths=[]; state.indexStart=0; state.indexCount=0; state.indexIds=[]; state.indexFlags=[]; invalidateDeltaCache();
      state.lastResults=[]; state.dirty.clear(); state.searchMode=false; state.page=0; state.indexing=true; resetEditor();
      $("progressWrap").classList.remove("hidden"); $("progressBar").style.width="0%";
      setFileInfo(`${file.name} · ${buf.byteLength.toLocaleString("id-ID")} byte · membuat indeks ringan…`);
      const result = await buildIndexAsync(buf, (pct,count)=>{ $("progressBar").style.width=`${pct}%`; $("progressText").textContent=`Menganalisis… ${pct}% · ${count.toLocaleString("id-ID")} string`; });
      if (result.markers.length < 2) throw new Error("Tidak cukup string LTC yang terdeteksi.");
      state.markers=result.markers; state.textOffsets=result.textOffsets; state.lengths=result.lengths; state.indexStart=result.indexStart; state.indexCount=result.indexCount; state.indexIds=result.ids; state.indexFlags=result.flags; state.indexing=false; invalidateDeltaCache();
      $("progressWrap").classList.add("hidden"); $("searchInput").disabled=false; $("clearSearch").disabled=false; $("saveBtn").disabled=false; $("revertBtn").disabled=false;
      setFileInfo(`${file.name} · ${buf.byteLength.toLocaleString("id-ID")} byte · ${state.markers.length.toLocaleString("id-ID")} string · ${state.pageSize}/halaman`);
      state.filter=""; $("searchInput").value="";
      // Always show the first sequential page immediately after indexing.
      state.searchMode=false; state.lastResults=[]; state.page=0; renderResults();
      updateTranslationUI();
      toast(fromCache ? `LTC dipulihkan · ${state.markers.length.toLocaleString("id-ID")} string` : `LTC siap · ${state.markers.length.toLocaleString("id-ID")} string`);
    } catch(e) {
      console.error(e); state.indexing=false; $("progressWrap").classList.add("hidden");
      state.original=null; state.markers=[]; state.textOffsets=[]; state.lengths=[]; state.indexStart=0; state.indexCount=0; state.indexIds=[]; state.indexFlags=[]; invalidateDeltaCache(); state.page=0; state.searchMode=false; state.lastResults=[];
      setFileInfo("File belum dimuat. Silakan buka file LTC lagi."); renderResults();
      updateTranslationUI(); toast("File tidak cocok dengan parser LTC ini");
    }
  };
  reader.readAsArrayBuffer(file);
  if (!fromCache) await cacheFile(file);
}

async function restoreCachedFile() {
  const cached = await getCachedFile();
  if (!cached) return;
  setFileInfo(`File terakhir ditemukan di penyimpanan lokal · ${cached.name} · memulihkan…`);
  loadFile(cached, true);
}

function changePageSize(value) {
  const n = Number(value); if (![10,20,50].includes(n)) return;
  const firstIndex = state.page * state.pageSize; state.pageSize = n; state.page = Math.floor(firstIndex / n); renderResults();
}
function jumpPage() {
  const n = Number($("pageJump").value); if (!Number.isFinite(n)) return;
  goPage(n - 1); $("pageJump").value = "";
}

$("translateSettingsBtn").addEventListener("click", () => { $("translateSettingsExtra").classList.toggle("hidden"); });
$("translateEngine").addEventListener("change", () => { updateTranslationUI(); });
$("translateOnlineBudget").addEventListener("change", () => { state.onlineBudget=getOnlineBudget(); });
$("translateOnlineDelay").addEventListener("change", () => {});
$("translateDevice").addEventListener("change", () => { if(state.translator){ toast("Perangkat berubah. Muat ulang model untuk memakai mode baru."); } });
$("translateModel")?.addEventListener("change", () => {
  if(state.translator || state.translatorLoading){
    state.translator=null; state.translatorLoading=null;
    $("translateLoadBtn").disabled=false; $("translateLoadBtn").textContent="⬇ Muat Marian Fallback";
    $("translateTestBtn").disabled=true; $("translateStartBtn").disabled=true;
    $("translateModelProgressText").textContent="Model berubah. Muat model yang baru.";
  }
});
$("translateLoadBtn").addEventListener("click", async()=>{ try { await loadLocalTranslator(); updateTranslationUI(); } catch(e){ updateTranslationUI(); } });
$("translateTestBtn").addEventListener("click", testLocalTranslation);
$("translateStartBtn").addEventListener("click", startTranslation);
$("translatePauseBtn").addEventListener("click", pauseTranslation);
$("translateClearCacheBtn").addEventListener("click", async()=>{ if(confirm("Hapus semua cache terjemahan yang tersimpan di browser?")){await clearTranslationCache(); toast("Cache terjemahan dihapus");} });
$("fileInput").addEventListener("change", e => { const f=e.target.files?.[0]; if(f) loadFile(f); });
let searchTimer;
$("searchInput").addEventListener("input", e => { state.filter=e.target.value; clearTimeout(searchTimer); searchTimer=setTimeout(searchMatches,280); });
$("caseSensitive").addEventListener("change", e => { state.caseSensitive=e.target.checked; searchMatches(); });
$("placeholdersOnly").addEventListener("change", e => { state.placeholdersOnly=e.target.checked; searchMatches(); });
$("clearSearch").addEventListener("click", () => { $("searchInput").value=""; state.filter=""; state.searchToken++; state.searchMode=false; state.lastResults=[]; state.page=0; renderResults(); $("searchInput").focus(); });
$("results").addEventListener("click", e => { const btn=e.target.closest(".result"); if(btn) selectRecord(Number(btn.dataset.index)); });
$("editorText").addEventListener("input", () => { updateCharInfo(); updateWarning(); });
$("applyBtn").addEventListener("click", applyCurrent); $("saveBtn").addEventListener("click", saveFile);
$("revertBtn").addEventListener("click", () => { if(!state.original) return; if(!confirm("Batalkan semua perubahan dan kembali ke file asli?")) return; state.dirty.clear(); refreshPageOffsets(); if(state.selected>=0) selectRecord(state.selected); toast("Perubahan dibatalkan"); });
$("prevBtn").addEventListener("click", () => { applyCurrent(); if(state.selected>0) { const n=state.selected-1; if(state.searchMode) { const pos=state.lastResults.indexOf(n); if(pos>=0) state.page=Math.floor(pos/state.pageSize); } else state.page=Math.floor(n/state.pageSize); renderResults(); selectRecord(n); } });
$("nextBtn").addEventListener("click", () => { applyCurrent(); if(state.selected<state.markers.length-1) { const n=state.selected+1; if(state.searchMode) { const pos=state.lastResults.indexOf(n); if(pos>=0) state.page=Math.floor(pos/state.pageSize); } else state.page=Math.floor(n/state.pageSize); renderResults(); selectRecord(n); } });
["prevPageBtn","prevPageBtnBottom"].forEach(id => $(id).addEventListener("click", () => goPage(state.page-1)));
["nextPageBtn","nextPageBtnBottom"].forEach(id => $(id).addEventListener("click", () => goPage(state.page+1)));
$("pageSize").addEventListener("change", e => changePageSize(e.target.value));
$("pageJumpBtn").addEventListener("click", jumpPage); $("pageJump").addEventListener("keydown", e => { if(e.key === "Enter") jumpPage(); });
$("themeBtn").addEventListener("click", () => { document.body.classList.toggle("light"); localStorage.setItem("ltc-theme", document.body.classList.contains("light")?"light":"dark"); });
if(localStorage.getItem("ltc-theme")==="light") document.body.classList.add("light");
restoreCachedFile();
window.addEventListener("beforeunload", e => { if(state.dirty.size){e.preventDefault();e.returnValue="";} });
})();
