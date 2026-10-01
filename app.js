(() => {
"use strict";

const $ = id => document.getElementById(id);
const state = {
  fileName: "",
  original: null,
  working: null,
  records: [],
  visible: [],
  selected: -1,
  filter: "",
  caseSensitive: false,
  placeholdersOnly: false,
  dirty: new Set()
};

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", {fatal:false});

function u32le(view, p){ return view.getUint32(p, true); }
function putU32le(view, p, n){ view.setUint32(p, n, true); }

function decodeUtf8(bytes){ return dec.decode(bytes); }
function encodeUtf8(text){ return enc.encode(text); }

function placeholders(text){
  return text.match(/\[%[^\]]+\]/g) || [];
}

function stableId(index, offset){
  return `#${index + 1}@${offset}`;
}

/*
  FM LTC files observed in the supplied FM2011 language file use records:
  0x01 + uint32LE(byteLength) + UTF-8 text
  The parser is deliberately conservative: a candidate must have a valid
  length and decode to text containing printable characters. Unknown binary
  regions are preserved byte-for-byte.
*/
function parseLtc(buffer){
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const records = [];
  let p = 0;

  while(p + 5 <= bytes.length){
    if(bytes[p] !== 0x01){ p++; continue; }

    const len = u32le(view, p + 1);
    const start = p + 5;
    const end = start + len;

    if(len === 0 || end > bytes.length){ p++; continue; }

    const slice = bytes.subarray(start, end);
    const text = decodeUtf8(slice);
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    const printable = countPrintable(text);

    // Avoid treating arbitrary binary as a string record.
    if(replacementCount > 0 || printable / Math.max(text.length,1) < 0.78){
      p++;
      continue;
    }

    records.push({
      index: records.length,
      markerOffset: p,
      textOffset: start,
      byteLength: len,
      text,
      originalText: text,
      id: stableId(records.length, p)
    });
    p = end;
  }
  return records;
}

function countPrintable(s){
  let n=0;
  for(const ch of s){
    const c=ch.charCodeAt(0);
    if(c===9||c===10||c===13||(c>=32&&c!==127)) n++;
  }
  return n;
}

function setFileInfo(msg){ $("fileInfo").textContent = msg; }
function toast(msg){
  const el=$("toast"); el.textContent=msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),2200);
}

function renderResults(){
  const box=$("results"); box.innerHTML="";
  const frag=document.createDocumentFragment();
  state.visible.forEach((rec, i)=>{
    const el=document.createElement("div");
    el.className="result"+(state.selected===rec.index?" active":"");
    const title=document.createElement("div");
    title.className="result-title";
    title.textContent=`${rec.index+1}. ${rec.id}`;
    if(state.dirty.has(rec.index)){
      const d=document.createElement("span"); d.className="result-dirty"; d.textContent="● diubah"; title.appendChild(d);
    }
    const txt=document.createElement("div"); txt.className="result-text";
    txt.textContent=rec.text.replace(/\s+/g," ");
    el.append(title,txt);
    el.addEventListener("click",()=>selectRecord(rec.index));
    frag.appendChild(el);
  });
  box.appendChild(frag);
  $("resultInfo").textContent = `${state.visible.length.toLocaleString("id-ID")} hasil dari ${state.records.length.toLocaleString("id-ID")} string`;
}

function applyFilter(){
  const q=state.filter;
  const needle=state.caseSensitive?q:q.toLowerCase();
  state.visible=state.records.filter(r=>{
    const text=state.caseSensitive?r.text:r.text.toLowerCase();
    const match=!needle || text.includes(needle);
    const ph=!state.placeholdersOnly || placeholders(r.text).length>0;
    return match && ph;
  });
  renderResults();
}

function selectRecord(index){
  const rec=state.records[index]; if(!rec) return;
  state.selected=index;
  $("recordTitle").textContent=`String #${index+1}`;
  $("recordId").textContent=rec.id;
  $("recordOffset").textContent=rec.markerOffset.toLocaleString("id-ID");
  $("recordLength").textContent=`${rec.byteLength.toLocaleString("id-ID")} byte`;
  $("recordPlaceholders").textContent=placeholders(rec.text).join("  ") || "Tidak ada";
  $("editorText").value=rec.text;
  $("editorText").disabled=false;
  $("applyBtn").disabled=false;
  $("prevBtn").disabled=index<=0;
  $("nextBtn").disabled=index>=state.records.length-1;
  $("dirtyBadge").classList.toggle("hidden",!state.dirty.has(index));
  updateCharInfo();
  updateWarning();
  renderResults();
  const active=[...$("results").children].find(el=>el.classList.contains("active"));
  active?.scrollIntoView({block:"nearest"});
}

function updateCharInfo(){
  const text=$("editorText").value;
  $("charInfo").textContent=`${text.length.toLocaleString("id-ID")} karakter · ${encodeUtf8(text).length.toLocaleString("id-ID")} byte UTF-8`;
}

function updateWarning(){
  if(state.selected<0){$("warning").classList.add("hidden");return;}
  const rec=state.records[state.selected];
  const oldPh=placeholders(rec.text);
  const newPh=placeholders($("editorText").value);
  const missing=oldPh.filter(x=>!newPh.includes(x));
  const added=newPh.filter(x=>!oldPh.includes(x));
  const msgs=[];
  if(missing.length) msgs.push(`Placeholder hilang: ${missing.join(", ")}`);
  if(added.length) msgs.push(`Placeholder baru: ${added.join(", ")}`);
  const newBytes=encodeUtf8($("editorText").value).length;
  if(newBytes!==rec.byteLength) msgs.push(`Panjang berubah ${rec.byteLength} → ${newBytes} byte. Parser akan memperbarui length record saat export.`);
  $("warning").textContent=msgs.join("  ");
  $("warning").classList.toggle("hidden",msgs.length===0);
}

function applyCurrent(){
  if(state.selected<0) return;
  const rec=state.records[state.selected];
  const text=$("editorText").value;
  if(text===rec.text) return;
  rec.text=text;
  state.dirty.add(rec.index);
  $("dirtyBadge").classList.remove("hidden");
  $("recordLength").textContent=`${encodeUtf8(text).length.toLocaleString("id-ID")} byte`;
  $("recordPlaceholders").textContent=placeholders(text).join("  ") || "Tidak ada";
  updateCharInfo(); updateWarning(); renderResults();
  $("saveBtn").disabled=false;
  toast("Perubahan diterapkan");
}

function buildFile(){
  const old=state.working;
  const chunks=[];
  let cursor=0;
  const view=new DataView(old);
  for(const rec of state.records){
    const textBytes=encodeUtf8(rec.text);
    chunks.push(new Uint8Array(old.slice(cursor, rec.markerOffset)));
    const header=new Uint8Array(5);
    header[0]=0x01;
    new DataView(header.buffer).setUint32(1,textBytes.length,true);
    chunks.push(header,textBytes);
    cursor=rec.textOffset+rec.byteLength;
  }
  chunks.push(new Uint8Array(old.slice(cursor)));
  let total=0; for(const c of chunks) total+=c.length;
  const out=new Uint8Array(total); let p=0;
  for(const c of chunks){out.set(c,p);p+=c.length;}
  return out;
}

function downloadBytes(bytes,name){
  const blob=new Blob([bytes],{type:"application/octet-stream"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function saveFile(){
  applyCurrent();
  const out=buildFile();
  const base=state.fileName.replace(/\.ltc$/i,"");
  downloadBytes(out,`${base}_edited.ltc`);
  toast("File LTC berhasil dibuat");
}

function loadFile(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const buf=reader.result;
      const recs=parseLtc(buf);
      if(recs.length<2) throw new Error("Tidak cukup string LTC yang terdeteksi.");
      state.fileName=file.name; state.original=new Uint8Array(buf); state.working=new Uint8Array(buf);
      state.records=recs; state.dirty.clear(); state.selected=-1;
      $("searchInput").disabled=false;$("clearSearch").disabled=false;$("saveBtn").disabled=false;$("revertBtn").disabled=false;
      $("editorText").disabled=true;$("applyBtn").disabled=true;$("prevBtn").disabled=true;$("nextBtn").disabled=true;
      setFileInfo(`${file.name} · ${buf.byteLength.toLocaleString("id-ID")} byte · ${recs.length.toLocaleString("id-ID")} string terdeteksi`);
      state.filter=""; $("searchInput").value="";
      applyFilter(); toast(`LTC dibuka: ${recs.length.toLocaleString("id-ID")} string`);
    }catch(e){ console.error(e); toast("File tidak cocok dengan parser LTC ini"); }
  };
  reader.readAsArrayBuffer(file);
}

$("fileInput").addEventListener("change",e=>{const f=e.target.files?.[0];if(f)loadFile(f);});
$("searchInput").addEventListener("input",e=>{state.filter=e.target.value;applyFilter();});
$("caseSensitive").addEventListener("change",e=>{state.caseSensitive=e.target.checked;applyFilter();});
$("placeholdersOnly").addEventListener("change",e=>{state.placeholdersOnly=e.target.checked;applyFilter();});
$("clearSearch").addEventListener("click",()=>{$("searchInput").value="";state.filter="";applyFilter();$("searchInput").focus();});
$("editorText").addEventListener("input",()=>{updateCharInfo();updateWarning();});
$("applyBtn").addEventListener("click",applyCurrent);
$("saveBtn").addEventListener("click",saveFile);
$("revertBtn").addEventListener("click",()=>{
  if(!state.original)return;
  if(!confirm("Batalkan semua perubahan dan kembali ke file asli?"))return;
  const recs=parseLtc(state.original.buffer);
  state.working=new Uint8Array(state.original);state.records=recs;state.dirty.clear();
  applyFilter(); if(state.selected>=0)selectRecord(state.selected); $("saveBtn").disabled=false; toast("Perubahan dibatalkan");
});
$("prevBtn").addEventListener("click",()=>{applyCurrent();if(state.selected>0)selectRecord(state.selected-1);});
$("nextBtn").addEventListener("click",()=>{applyCurrent();if(state.selected<state.records.length-1)selectRecord(state.selected+1);});
$("themeBtn").addEventListener("click",()=>{document.body.classList.toggle("light");localStorage.setItem("ltc-theme",document.body.classList.contains("light")?"light":"dark");});
if(localStorage.getItem("ltc-theme")==="light")document.body.classList.add("light");

window.addEventListener("beforeunload",e=>{if(state.dirty.size){e.preventDefault();e.returnValue="";}});
})();