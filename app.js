(() => {
"use strict";

const $ = id => document.getElementById(id);
const state = {
  fileName: "",
  original: null,
  markers: [],
  textOffsets: [],
  lengths: [],
  selected: -1,
  filter: "",
  caseSensitive: false,
  placeholdersOnly: false,
  dirty: new Map(),
  lastResults: [],
  searchToken: 0,
  indexing: false
};

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

function decodeAt(i) {
  if (state.dirty.has(i)) return state.dirty.get(i);
  const start = state.textOffsets[i], len = state.lengths[i];
  return dec.decode(new Uint8Array(state.original.buffer, start, len));
}
function originalTextAt(i) {
  return dec.decode(new Uint8Array(state.original.buffer, state.textOffsets[i], state.lengths[i]));
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

// Compact metadata only. Unlike v2, this stores no 178k record objects and no IDs/strings.
async function buildIndexAsync(buffer, onProgress) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const markers = [], textOffsets = [], lengths = [];
  let p = 0, lastProgress = -1;
  const yieldEvery = 1200;

  while (p + 5 <= bytes.length) {
    if (bytes[p] !== 0x01) { p++; continue; }
    const len = view.getUint32(p + 1, true);
    const start = p + 5, end = start + len;
    if (len === 0 || end > bytes.length) { p++; continue; }

    const text = dec.decode(bytes.subarray(start, end));
    let valid = !text.includes("\uFFFD");
    if (valid) valid = countPrintable(text) / Math.max(text.length, 1) >= 0.78;

    if (valid) {
      markers.push(p); textOffsets.push(start); lengths.push(len);
      p = end;
    } else {
      p++;
    }

    const progress = Math.floor((p / bytes.length) * 100);
    if (progress !== lastProgress) {
      lastProgress = progress;
      onProgress?.(progress, markers.length);
    }
    if (markers.length % yieldEvery === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  onProgress?.(100, markers.length);
  return { markers, textOffsets, lengths };
}

function setFileInfo(msg) { $("fileInfo").textContent = msg; }
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2200);
}
function idFor(i) { return `#${i + 1}@${state.markers[i].toLocaleString("id-ID")}`; }
function resultRecord(i) { return { index: i, id: idFor(i) }; }

function renderResults(results, searching = false) {
  const box = $("results");
  box.replaceChildren();
  if (searching) {
    $("resultInfo").textContent = "Mencari…";
    return;
  }
  const frag = document.createDocumentFragment();
  for (const i of results) {
    const text = decodeAt(i);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "result" + (state.selected === i ? " active" : "");
    el.dataset.index = i;

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = `${i + 1}. ${idFor(i)}`;
    if (state.dirty.has(i)) {
      const d = document.createElement("span"); d.className = "result-dirty"; d.textContent = "● diubah"; title.appendChild(d);
    }
    const txt = document.createElement("div");
    txt.className = "result-text-full";
    txt.textContent = text;
    el.append(title, txt);
    frag.appendChild(el);
  }
  box.appendChild(frag);
  $("resultInfo").textContent = results.length
    ? `${results.length.toLocaleString("id-ID")} hasil ditampilkan · dari ${state.markers.length.toLocaleString("id-ID")} string`
    : "Tidak ada hasil.";
}

async function searchMatches() {
  if (state.indexing) return;
  const q = state.filter.trim();
  if (!q && !state.placeholdersOnly) {
    state.lastResults = [];
    renderResults([]);
    return;
  }

  const token = ++state.searchToken;
  renderResults([], true);
  await new Promise(resolve => setTimeout(resolve, 0));
  const needle = state.caseSensitive ? q : q.toLocaleLowerCase();
  const results = [];
  const maxResults = 12; // deliberately small for Android browsers

  for (let i = 0; i < state.markers.length; i++) {
    if (token !== state.searchToken) return;
    const text = decodeAt(i);
    const hay = state.caseSensitive ? text : text.toLocaleLowerCase();
    const match = !needle || hay.includes(needle);
    const ph = !state.placeholdersOnly || placeholders(text).length > 0;
    if (match && ph) {
      results.push(i);
      if (results.length >= maxResults) break;
    }
    if (i % 1000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (token !== state.searchToken) return;
  state.lastResults = results;
  renderResults(results);
}

function selectRecord(index) {
  if (index < 0 || index >= state.markers.length) return;
  state.selected = index;
  const text = decodeAt(index);
  $("recordTitle").textContent = `String #${index + 1}`;
  $("recordId").textContent = idFor(index);
  $("recordOffset").textContent = state.markers[index].toLocaleString("id-ID");
  $("recordLength").textContent = `${enc.encode(text).length.toLocaleString("id-ID")} byte`;
  $("recordPlaceholders").textContent = placeholders(text).join("  ") || "Tidak ada";
  $("editorText").value = text;
  $("editorText").disabled = false;
  $("applyBtn").disabled = false;
  $("prevBtn").disabled = index <= 0;
  $("nextBtn").disabled = index >= state.markers.length - 1;
  $("dirtyBadge").classList.toggle("hidden", !state.dirty.has(index));
  updateCharInfo(); updateWarning();
  document.querySelectorAll(".result.active").forEach(x => x.classList.remove("active"));
  const active = document.querySelector(`.result[data-index="${index}"]`);
  if (active) { active.classList.add("active"); active.scrollIntoView({ block: "nearest" }); }
}

function updateCharInfo() {
  const text = $("editorText").value;
  $("charInfo").textContent = `${text.length.toLocaleString("id-ID")} karakter · ${enc.encode(text).length.toLocaleString("id-ID")} byte UTF-8`;
}
function updateWarning() {
  if (state.selected < 0) { $("warning").classList.add("hidden"); return; }
  const oldPh = placeholders(originalTextAt(state.selected));
  const newPh = placeholders($("editorText").value);
  const missing = oldPh.filter(x => !newPh.includes(x));
  const added = newPh.filter(x => !oldPh.includes(x));
  const msgs = [];
  if (missing.length) msgs.push(`Placeholder hilang: ${missing.join(", ")}`);
  if (added.length) msgs.push(`Placeholder baru: ${added.join(", ")}`);
  const newBytes = enc.encode($("editorText").value).length;
  if (newBytes !== state.lengths[state.selected]) msgs.push(`Panjang berubah ${state.lengths[state.selected]} → ${newBytes} byte. Length record akan diperbarui saat export.`);
  $("warning").textContent = msgs.join("  ");
  $("warning").classList.toggle("hidden", msgs.length === 0);
}

function refreshVisibleResult(index) {
  const el = document.querySelector(`.result[data-index="${index}"] .result-text-full`);
  if (el) el.textContent = decodeAt(index);
  const result = document.querySelector(`.result[data-index="${index}"]`);
  if (result) {
    const title = result.querySelector(".result-title");
    const old = title.querySelector(".result-dirty");
    if (state.dirty.has(index) && !old) { const d = document.createElement("span"); d.className="result-dirty"; d.textContent="● diubah"; title.appendChild(d); }
    if (!state.dirty.has(index) && old) old.remove();
  }
}

function applyCurrent() {
  if (state.selected < 0) return;
  const i = state.selected, text = $("editorText").value;
  const original = originalTextAt(i);
  if (text === original) state.dirty.delete(i); else state.dirty.set(i, text);
  $("dirtyBadge").classList.toggle("hidden", !state.dirty.has(i));
  $("recordLength").textContent = `${enc.encode(text).length.toLocaleString("id-ID")} byte`;
  $("recordPlaceholders").textContent = placeholders(text).join("  ") || "Tidak ada";
  updateCharInfo(); updateWarning(); refreshVisibleResult(i);
  $("saveBtn").disabled = false;
  toast(state.dirty.has(i) ? "Perubahan diterapkan" : "Kembali ke teks asli");
}

function buildFile() {
  if (!state.dirty.size) return new Uint8Array(state.original);
  const old = state.original, changes = [...state.dirty.keys()].sort((a,b)=>a-b);
  const chunks = [], totalOld = old.byteLength;
  let cursor = 0, total = 0;
  for (const i of changes) {
    const marker = state.markers[i], start = state.textOffsets[i], len = state.lengths[i];
    const textBytes = enc.encode(state.dirty.get(i));
    const prefix = old.slice(cursor, marker);
    chunks.push(prefix); total += prefix.byteLength;
    const header = new Uint8Array(5); header[0] = 0x01; new DataView(header.buffer).setUint32(1, textBytes.length, true);
    chunks.push(header, textBytes); total += 5 + textBytes.byteLength;
    cursor = start + len;
  }
  const tail = old.slice(cursor); chunks.push(tail); total += tail.byteLength;
  const out = new Uint8Array(total);
  let p = 0; for (const c of chunks) { out.set(new Uint8Array(c), p); p += c.byteLength; }
  return out;
}

function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], {type:"application/octet-stream"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function saveFile() {
  applyCurrent();
  setTimeout(() => {
    const out = buildFile();
    const base = state.fileName.replace(/\.ltc$/i, "");
    downloadBytes(out, `${base}_edited.ltc`);
    toast(`LTC disimpan · ${state.dirty.size} string diubah`);
  }, 20);
}
function resetEditor() {
  state.selected=-1; state.dirty.clear(); $("editorText").value=""; $("editorText").disabled=true; $("applyBtn").disabled=true;
  $("prevBtn").disabled=true; $("nextBtn").disabled=true; $("dirtyBadge").classList.add("hidden"); $("recordTitle").textContent="Belum ada string dipilih";
  $("recordId").textContent=$("recordOffset").textContent=$("recordLength").textContent=$("recordPlaceholders").textContent="—"; $("charInfo").textContent="0 karakter · 0 byte UTF-8"; $("warning").classList.add("hidden");
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const buf = reader.result;
      state.fileName=file.name; state.original=new Uint8Array(buf); state.markers=[]; state.textOffsets=[]; state.lengths=[]; state.lastResults=[]; state.dirty.clear(); state.indexing=true; resetEditor();
      $("progressWrap").classList.remove("hidden"); $("progressBar").style.width="0%";
      setFileInfo(`${file.name} · ${buf.byteLength.toLocaleString("id-ID")} byte · membuat indeks hemat memori…`);
      const result = await buildIndexAsync(buf, (pct,count)=>{ $("progressBar").style.width=`${pct}%`; $("progressText").textContent=`Menganalisis… ${pct}% · ${count.toLocaleString("id-ID")} string`; });
      if (result.markers.length < 2) throw new Error("Tidak cukup string LTC yang terdeteksi.");
      state.markers=result.markers; state.textOffsets=result.textOffsets; state.lengths=result.lengths; state.indexing=false;
      $("progressWrap").classList.add("hidden"); $("searchInput").disabled=false; $("clearSearch").disabled=false; $("saveBtn").disabled=false; $("revertBtn").disabled=false;
      setFileInfo(`${file.name} · ${buf.byteLength.toLocaleString("id-ID")} byte · ${state.markers.length.toLocaleString("id-ID")} string · memori rendah`);
      state.filter=""; $("searchInput").value=""; renderResults([]); toast(`LTC siap · ${state.markers.length.toLocaleString("id-ID")} string`);
    } catch(e) {
      console.error(e); state.indexing=false; $("progressWrap").classList.add("hidden"); toast("File tidak cocok dengan parser LTC ini");
    }
  };
  reader.readAsArrayBuffer(file);
}

$("fileInput").addEventListener("change", e => { const f=e.target.files?.[0]; if(f) loadFile(f); });
let searchTimer;
$("searchInput").addEventListener("input", e => { state.filter=e.target.value; clearTimeout(searchTimer); searchTimer=setTimeout(searchMatches,280); });
$("caseSensitive").addEventListener("change", e => { state.caseSensitive=e.target.checked; searchMatches(); });
$("placeholdersOnly").addEventListener("change", e => { state.placeholdersOnly=e.target.checked; searchMatches(); });
$("clearSearch").addEventListener("click", () => { $("searchInput").value=""; state.filter=""; state.searchToken++; renderResults([]); $("searchInput").focus(); });
$("results").addEventListener("click", e => { const btn=e.target.closest(".result"); if(btn) selectRecord(Number(btn.dataset.index)); });
$("editorText").addEventListener("input", () => { updateCharInfo(); updateWarning(); });
$("applyBtn").addEventListener("click", applyCurrent); $("saveBtn").addEventListener("click", saveFile);
$("revertBtn").addEventListener("click", () => { if(!state.original) return; if(!confirm("Batalkan semua perubahan dan kembali ke file asli?")) return; state.dirty.clear(); if(state.selected>=0) selectRecord(state.selected); refreshVisibleResult(state.selected); toast("Perubahan dibatalkan"); });
$("prevBtn").addEventListener("click", () => { applyCurrent(); if(state.selected>0) selectRecord(state.selected-1); });
$("nextBtn").addEventListener("click", () => { applyCurrent(); if(state.selected<state.markers.length-1) selectRecord(state.selected+1); });
$("themeBtn").addEventListener("click", () => { document.body.classList.toggle("light"); localStorage.setItem("ltc-theme", document.body.classList.contains("light")?"light":"dark"); });
if(localStorage.getItem("ltc-theme")==="light") document.body.classList.add("light");
window.addEventListener("beforeunload", e => { if(state.dirty.size){e.preventDefault();e.returnValue="";} });
})();
