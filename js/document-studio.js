import { put, getAll } from "./db.js";

const $ = id => document.getElementById(id);
const state = { sourceName:"", sourceType:"", busy:false };
const editor = $("studioEditor");
const status = $("studioStatus");
const progress = $("studioProgress");
const fileInput = $("studioFile");
const languages = $("studioLanguage");

function say(message){ status.textContent=message; }
function escapeHTML(value){ return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function safeName(value){ return (value||"document").replace(/[^a-z0-9а-яё_-]+/gi,"-").replace(/^-|-$/g,"")||"document"; }
function setBusy(value){ state.busy=value; $("studioRecognize").disabled=value; $("studioFile").disabled=value; }
function setProgress(value){ progress.value=Math.max(0,Math.min(100,value)); }

async function loadScript(test,src,label){
  if(test()) return;
  await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error("Не удалось загрузить "+label+". Проверьте интернет."));document.head.append(s);});
  if(!test()) throw new Error(label+" не запустился.");
}
async function getOCRWorker(){
  await loadScript(()=>!!window.Tesseract?.createWorker,"https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js","OCR");
  return window.Tesseract.createWorker(languages.value,1,{logger:m=>{
    if(m.status==="recognizing text") setProgress(Math.round((m.progress||0)*100));
  }});
}
function appendPageHeading(number){
  const h=document.createElement("h2");h.textContent="Страница "+number;editor.append(h);
}
async function recognizeImage(file,worker){
  const result=await worker.recognize(file);
  return result.data.text||"";
}
async function recognizePDF(file,worker){
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
  let result="";
  for(let n=1;n<=pdf.numPages;n++){
    say("Обработка PDF: страница "+n+" из "+pdf.numPages);
    const page=await pdf.getPage(n);
    const text=await page.getTextContent();
    let extracted=text.items.map(x=>x.str||"").filter(Boolean).join(" ").trim();
    if(extracted.length<25){
      const base=page.getViewport({scale:1});
      const scale=Math.max(1,Math.min(2,2600/Math.max(base.width,base.height)));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement("canvas");
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      await page.render({canvasContext:ctx,viewport}).promise;
      const recognized=await worker.recognize(canvas);
      extracted=recognized.data.text||"";
      canvas.width=canvas.height=0;
    }
    appendPageHeading(n);
    const p=document.createElement("p");p.textContent=extracted||"[Текст не распознан]";editor.append(p);
    result+=((result?"\n\n":"")+"Страница "+n+"\n"+extracted);
    setProgress(n/pdf.numPages*100);
  }
  return result;
}
async function recognize(){
  const file=fileInput.files?.[0];
  if(!file){say("Сначала выберите PDF или изображение.");return;}
  setBusy(true);setProgress(0);editor.replaceChildren();
  state.sourceName=file.name;state.sourceType=file.type;
  let worker;
  try{
    worker=await getOCRWorker();
    if(file.type==="application/pdf"||/\.pdf$/i.test(file.name)) await recognizePDF(file,worker);
    else{
      say("Распознавание изображения…");
      const text=await recognizeImage(file,worker);
      const p=document.createElement("p");p.textContent=text;editor.append(p);setProgress(100);
    }
    say("Распознавание завершено. Проверьте и отредактируйте текст перед сохранением.");
  }catch(error){console.error(error);say("Ошибка: "+error.message);}
  finally{if(worker)try{await worker.terminate();}catch{}setBusy(false);}
}
function documentHTML(){
  const title=state.sourceName.replace(/\.[^.]+$/,"")||"Новый документ";
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'+escapeHTML(title)+'</title><style>body{font:12pt/1.55 Georgia,serif;color:#222;max-width:850px;margin:40px auto;padding:0 24px}h1,h2{page-break-after:avoid}p{white-space:pre-wrap;margin:0 0 1em}img{max-width:100%}@media print{body{margin:15mm auto}}</style></head><body><h1>'+escapeHTML(title)+'</h1>'+editor.innerHTML+'</body></html>';
}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function saveToLibrary(){
  const html=documentHTML(),name=safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-редакция.html";
  const books=await getAll("books");
  await put("books",{id:crypto.randomUUID?.()||String(Date.now()),name,title:state.sourceName.replace(/\.[^.]+$/,"")+" — редакция",author:"",ext:"html",type:"text/html",data:new TextEncoder().encode(html).buffer,addedAt:Date.now(),favorite:false,sourceName:state.sourceName,revisionOf:state.sourceName});
  say("Новая HTML-редакция добавлена в библиотеку. Исходный файл не изменён.");
  download(new Blob([html],{type:"text/html;charset=utf-8"}),name);
}
function printPDF(){
  const html=documentHTML(),w=window.open("","_blank");
  if(!w){say("Разрешите всплывающее окно для печати в PDF.");return;}
  w.document.open();w.document.write(html);w.document.close();
  w.onload=()=>{w.focus();w.print();};
}
function exportText(){
  const text=editor.innerText||"";
  download(new Blob([text],{type:"text/plain;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-текст.txt");
}
function insertCommand(command,value=null){editor.focus();document.execCommand(command,false,value);}
$("studioRecognize").addEventListener("click",recognize);
$("studioSave").addEventListener("click",()=>saveToLibrary().catch(e=>say("Не удалось сохранить: "+e.message)));
$("studioPDF").addEventListener("click",printPDF);
$("studioTXT").addEventListener("click",exportText);
$("studioBold").addEventListener("click",()=>insertCommand("bold"));
$("studioItalic").addEventListener("click",()=>insertCommand("italic"));
$("studioH2").addEventListener("click",()=>insertCommand("formatBlock","h2"));
$("studioParagraph").addEventListener("click",()=>insertCommand("formatBlock","p"));
$("studioUndo").addEventListener("click",()=>insertCommand("undo"));
$("studioRedo").addEventListener("click",()=>insertCommand("redo"));
$("studioClear").addEventListener("click",()=>{if(confirm("Очистить рабочее поле?"))editor.replaceChildren();});
$("studioDownloadHTML").addEventListener("click",()=>download(new Blob([documentHTML()],{type:"text/html;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+".html"));
$("openStudioBtn").addEventListener("click",()=>{ $("libraryView").classList.add("hidden");$("readerView").classList.add("hidden");$("documentStudioView").classList.remove("hidden");document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));$("openStudioBtn").classList.add("active");});
$("studioBack").addEventListener("click",()=>{ $("documentStudioView").classList.add("hidden");$("libraryView").classList.remove("hidden");$("openStudioBtn").classList.remove("active");});
fileInput.addEventListener("change",()=>{const f=fileInput.files?.[0];if(f){state.sourceName=f.name;say("Выбран файл: "+f.name+". Нажмите «Распознать»");}});
