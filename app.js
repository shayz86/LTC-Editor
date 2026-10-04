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
  searchToken: 0, indexing: false
};

const enc = new TextEncoder();

// Keep a local copy so an Android/Chrome reload or renderer recovery does not leave
// the UI showing stale file information while the in-memory index is gone.
const DB_NAME = "ltc-editor-fm2011";
const DB_STORE = "files";
const DB_KEY = "last-file";
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
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  // Exact FM2011 LTC layout observed in the supplied file:
  //   52-byte header
  //   178700 variable records: marker(1) + uint32le byteLength + UTF-8 text
  //   uint32 record count
  //   count × (uint32 string-id + uint32 record-offset-minus-8 + uint8 flags)
  //   uint32 zero footer
  // Header DWORD at offset 8 stores (indexStart - 12).
  if (bytes.length < 60 || bytes[0] !== 0x03 || bytes[1] !== 0x01 ||
      bytes[2] !== 0x63 || bytes[3] !== 0x74 || bytes[4] !== 0x6c || bytes[5] !== 0x2e) {
    throw new Error("Bukan struktur FM2011 LTC yang dikenali.");
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
  const newSize = newIndexStart + 4 + state.indexCount * 9 + 4;
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
  out.set(old.subarray(oldIndexStart + 4 + state.indexCount * 9, oldIndexStart + 4 + state.indexCount * 9 + 4), outPos);
  outPos += 4;
  if (outPos !== out.length) throw new Error(`Ukuran hasil tidak konsisten: ${outPos} / ${out.length}`);
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
  if (idx < 57 || idx + 4 + state.indexCount * 9 + 4 !== bytes.length) return false;
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
      toast(fromCache ? `LTC dipulihkan · ${state.markers.length.toLocaleString("id-ID")} string` : `LTC siap · ${state.markers.length.toLocaleString("id-ID")} string`);
    } catch(e) {
      console.error(e); state.indexing=false; $("progressWrap").classList.add("hidden");
      state.original=null; state.markers=[]; state.textOffsets=[]; state.lengths=[]; state.indexStart=0; state.indexCount=0; state.indexIds=[]; state.indexFlags=[]; invalidateDeltaCache(); state.page=0; state.searchMode=false; state.lastResults=[];
      setFileInfo("File belum dimuat. Silakan buka file LTC lagi."); renderResults();
      toast("File tidak cocok dengan parser LTC ini");
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
