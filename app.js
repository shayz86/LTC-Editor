(() => {
"use strict";

const $ = id => document.getElementById(id);
const state = {
  fileName: "",
  original: null,
  index: [],
  selected: -1,
  filter: "",
  caseSensitive: false,
  placeholdersOnly: false,
  dirty: new Map(),
  searchToken: 0,
  lastSearchCount: 0
};

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

function u32le(view, p) { return view.getUint32(p, true); }
function decodeUtf8(bytes) { return dec.decode(bytes); }
function encodeUtf8(text) { return enc.encode(text); }
function placeholders(text) { return text.match(/\[%[^\]]+\]/g) || []; }
function stableId(index, offset) { return `#${index + 1}@${offset}`; }
function byteSlice(rec) { return new Uint8Array(state.original.buffer, rec.textOffset, rec.byteLength); }
function getText(rec) { return state.dirty.has(rec.index) ? state.dirty.get(rec.index) : decodeUtf8(byteSlice(rec)); }

function countPrintable(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) n++;
  }
  return n;
}

// Lightweight index: store ONLY offsets and lengths. Text is decoded on demand.
// This is the main mobile optimization: 178k strings no longer live in JS memory.
function buildIndex(buffer, onProgress) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const index = [];
  let p = 0;
  let lastProgress = -1;

  while (p + 5 <= bytes.length) {
    if (bytes[p] !== 0x01) { p++; continue; }
    const len = u32le(view, p + 1);
    const start = p + 5;
    const end = start + len;
    if (len === 0 || end > bytes.length) { p++; continue; }

    const slice = bytes.subarray(start, end);
    const text = decodeUtf8(slice);
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    const printable = countPrintable(text);

    if (replacementCount > 0 || printable / Math.max(text.length, 1) < 0.78) {
      p++;
      continue;
    }

    const i = index.length;
    index.push({
      index: i,
      markerOffset: p,
      textOffset: start,
      byteLength: len,
      id: stableId(i, p)
    });
    p = end;

    const progress = Math.floor((p / bytes.length) * 100);
    if (progress !== lastProgress) {
      lastProgress = progress;
      onProgress?.(progress);
    }
  }
  onProgress?.(100);
  return index;
}

function setFileInfo(msg) { $("fileInfo").textContent = msg; }
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2200);
}

function renderResults(results, scanned) {
  const box = $("results");
  box.replaceChildren();
  const frag = document.createDocumentFragment();

  for (const rec of results) {
    const text = getText(rec);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "result" + (state.selected === rec.index ? " active" : "");

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = `${rec.index + 1}. ${rec.id}`;
    if (state.dirty.has(rec.index)) {
      const d = document.createElement("span");
      d.className = "result-dirty";
      d.textContent = "● diubah";
      title.appendChild(d);
    }

    const txt = document.createElement("div");
    txt.className = "result-text-full";
    txt.textContent = text;
    el.append(title, txt);
    el.addEventListener("click", () => selectRecord(rec.index));
    frag.appendChild(el);
  }
  box.appendChild(frag);

  const total = state.index.length.toLocaleString("id-ID");
  const shown = results.length.toLocaleString("id-ID");
  if (!state.filter && !state.placeholdersOnly) {
    $("resultInfo").textContent = `File berisi ${total} string. Gunakan pencarian untuk menampilkan kalimat.`;
  } else if (scanned === false) {
    $("resultInfo").textContent = "Mencari…";
  } else {
    $("resultInfo").textContent = `${shown} hasil ditampilkan · ${total} string terindeks`;
  }
}

function searchMatches() {
  const q = state.filter.trim();
  if (!q && !state.placeholdersOnly) {
    renderResults([], true);
    return;
  }

  const token = ++state.searchToken;
  renderResults([], false);
  setTimeout(() => {
    if (token !== state.searchToken) return;

    const needle = state.caseSensitive ? q : q.toLowerCase();
    const results = [];
    let scanned = 0;

    for (const rec of state.index) {
      const text = getText(rec);
      const hay = state.caseSensitive ? text : text.toLowerCase();
      const match = !needle || hay.includes(needle);
      const ph = !state.placeholdersOnly || placeholders(text).length > 0;
      if (match && ph) {
        results.push(rec);
        if (results.length >= 50) break; // keep DOM light on phones
      }
      scanned++;
    }
    if (token !== state.searchToken) return;
    state.lastSearchCount = results.length;
    renderResults(results, true);
  }, 30);
}

function selectRecord(index) {
  const rec = state.index[index];
  if (!rec) return;
  state.selected = index;
  const text = getText(rec);

  $("recordTitle").textContent = `String #${index + 1}`;
  $("recordId").textContent = rec.id;
  $("recordOffset").textContent = rec.markerOffset.toLocaleString("id-ID");
  $("recordLength").textContent = `${encodeUtf8(text).length.toLocaleString("id-ID")} byte`;
  $("recordPlaceholders").textContent = placeholders(text).join("  ") || "Tidak ada";
  $("editorText").value = text;
  $("editorText").disabled = false;
  $("applyBtn").disabled = false;
  $("prevBtn").disabled = index <= 0;
  $("nextBtn").disabled = index >= state.index.length - 1;
  $("dirtyBadge").classList.toggle("hidden", !state.dirty.has(index));
  updateCharInfo();
  updateWarning();

  // Re-render only the current search result set, not all strings.
  searchMatches();
  setTimeout(() => {
    const active = $("results").querySelector(".active");
    active?.scrollIntoView({ block: "nearest" });
  }, 45);
}

function updateCharInfo() {
  const text = $("editorText").value;
  $("charInfo").textContent = `${text.length.toLocaleString("id-ID")} karakter · ${encodeUtf8(text).length.toLocaleString("id-ID")} byte UTF-8`;
}

function updateWarning() {
  if (state.selected < 0) { $("warning").classList.add("hidden"); return; }
  const rec = state.index[state.selected];
  const oldPh = placeholders(decodeUtf8(byteSlice(rec)));
  const newPh = placeholders($("editorText").value);
  const missing = oldPh.filter(x => !newPh.includes(x));
  const added = newPh.filter(x => !oldPh.includes(x));
  const msgs = [];
  if (missing.length) msgs.push(`Placeholder hilang: ${missing.join(", ")}`);
  if (added.length) msgs.push(`Placeholder baru: ${added.join(", ")}`);
  const newBytes = encodeUtf8($("editorText").value).length;
  if (newBytes !== rec.byteLength) msgs.push(`Panjang berubah ${rec.byteLength} → ${newBytes} byte. Length record akan diperbarui saat export.`);
  $("warning").textContent = msgs.join("  ");
  $("warning").classList.toggle("hidden", msgs.length === 0);
}

function applyCurrent() {
  if (state.selected < 0) return;
  const rec = state.index[state.selected];
  const text = $("editorText").value;
  const originalText = decodeUtf8(byteSlice(rec));

  if (text === originalText) {
    state.dirty.delete(rec.index);
  } else {
    state.dirty.set(rec.index, text);
  }

  $("dirtyBadge").classList.toggle("hidden", !state.dirty.has(rec.index));
  $("recordLength").textContent = `${encodeUtf8(text).length.toLocaleString("id-ID")} byte`;
  $("recordPlaceholders").textContent = placeholders(text).join("  ") || "Tidak ada";
  updateCharInfo();
  updateWarning();
  searchMatches();
  $("saveBtn").disabled = false;
  toast(state.dirty.has(rec.index) ? "Perubahan diterapkan" : "Kembali ke teks asli");
}

function buildFile() {
  if (!state.dirty.size) return new Uint8Array(state.original);

  const old = state.original;
  const chunks = [];
  let cursor = 0;

  for (const rec of state.index) {
    if (!state.dirty.has(rec.index)) continue;
    const textBytes = encodeUtf8(state.dirty.get(rec.index));
    chunks.push(old.slice(cursor, rec.markerOffset));
    const header = new Uint8Array(5);
    header[0] = 0x01;
    new DataView(header.buffer).setUint32(1, textBytes.length, true);
    chunks.push(header.buffer, textBytes.buffer);
    cursor = rec.textOffset + rec.byteLength;
  }
  chunks.push(old.slice(cursor));

  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(new Uint8Array(c), p); p += c.byteLength; }
  return out;
}

function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function saveFile() {
  applyCurrent();
  setTimeout(() => {
    const out = buildFile();
    const base = state.fileName.replace(/\.ltc$/i, "");
    downloadBytes(out, `${base}_edited.ltc`);
    toast(`LTC disimpan · ${state.dirty.size} string diubah`);
  }, 30);
}

function resetEditor() {
  state.selected = -1;
  state.dirty.clear();
  $("editorText").value = "";
  $("editorText").disabled = true;
  $("applyBtn").disabled = true;
  $("prevBtn").disabled = true;
  $("nextBtn").disabled = true;
  $("dirtyBadge").classList.add("hidden");
  $("recordTitle").textContent = "Belum ada string dipilih";
  $("recordId").textContent = "—";
  $("recordOffset").textContent = "—";
  $("recordLength").textContent = "—";
  $("recordPlaceholders").textContent = "—";
  $("charInfo").textContent = "0 karakter · 0 byte UTF-8";
  $("warning").classList.add("hidden");
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const buf = reader.result;
      state.fileName = file.name;
      state.original = new Uint8Array(buf);
      state.index = [];
      state.dirty.clear();
      resetEditor();

      $("progressWrap").classList.remove("hidden");
      $("progressBar").style.width = "0%";
      setFileInfo(`${file.name} · ${buf.byteLength.toLocaleString("id-ID")} byte · membuat indeks ringan…`);

      setTimeout(() => {
        const recs = buildIndex(buf, pct => {
          $("progressBar").style.width = `${pct}%`;
          $("progressText").textContent = `Menganalisis file… ${pct}%`;
        });
        if (recs.length < 2) throw new Error("Tidak cukup string LTC yang terdeteksi.");
        state.index = recs;
        $("progressWrap").classList.add("hidden");
        $("searchInput").disabled = false;
        $("clearSearch").disabled = false;
        $("saveBtn").disabled = false;
        $("revertBtn").disabled = false;
        setFileInfo(`${file.name} · ${buf.byteLength.toLocaleString("id-ID")} byte · ${recs.length.toLocaleString("id-ID")} string terindeks · mode ringan`);
        state.filter = "";
        $("searchInput").value = "";
        renderResults([], true);
        toast(`LTC siap · ${recs.length.toLocaleString("id-ID")} string`);
      }, 20);
    } catch (e) {
      console.error(e);
      $("progressWrap").classList.add("hidden");
      toast("File tidak cocok dengan parser LTC ini");
    }
  };
  reader.readAsArrayBuffer(file);
}

$("fileInput").addEventListener("change", e => {
  const f = e.target.files?.[0];
  if (f) loadFile(f);
});

let searchTimer;
$("searchInput").addEventListener("input", e => {
  state.filter = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchMatches, 220);
});
$("caseSensitive").addEventListener("change", e => { state.caseSensitive = e.target.checked; searchMatches(); });
$("placeholdersOnly").addEventListener("change", e => { state.placeholdersOnly = e.target.checked; searchMatches(); });
$("clearSearch").addEventListener("click", () => {
  $("searchInput").value = "";
  state.filter = "";
  searchMatches();
  $("searchInput").focus();
});
$("editorText").addEventListener("input", () => { updateCharInfo(); updateWarning(); });
$("applyBtn").addEventListener("click", applyCurrent);
$("saveBtn").addEventListener("click", saveFile);
$("revertBtn").addEventListener("click", () => {
  if (!state.original) return;
  if (!confirm("Batalkan semua perubahan dan kembali ke file asli?")) return;
  state.dirty.clear();
  if (state.selected >= 0) selectRecord(state.selected); else searchMatches();
  toast("Perubahan dibatalkan");
});
$("prevBtn").addEventListener("click", () => { applyCurrent(); if (state.selected > 0) selectRecord(state.selected - 1); });
$("nextBtn").addEventListener("click", () => { applyCurrent(); if (state.selected < state.index.length - 1) selectRecord(state.selected + 1); });
$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("ltc-theme", document.body.classList.contains("light") ? "light" : "dark");
});
if (localStorage.getItem("ltc-theme") === "light") document.body.classList.add("light");
window.addEventListener("beforeunload", e => { if (state.dirty.size) { e.preventDefault(); e.returnValue = ""; } });
})();
