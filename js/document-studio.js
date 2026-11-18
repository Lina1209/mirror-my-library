import { put } from "./db.js";

const $ = id => document.getElementById(id);
const state = { sourceName:"", sourceType:"", busy:false, format:"text" };
const editor = $("studioEditor");
const status = $("studioStatus");
const progress = $("studioProgress");
const fileInput = $("studioFile");
const languages = $("studioLanguage");

function say(message){ status.textContent=message; }
function escapeHTML(value){ return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function safeName(value){ return (value||"document").replace(/[^a-z0-9а-яё_-]+/gi,"-").replace(/^-|-$/g,"")||"document"; }
function setBusy(value){ state.busy=value; $("studioRecognize").disabled=value; $("studioFile").disabled=value; }
function setProgress(value){ progress.value=Math.max(0,Math.min(100,value)); }
function extOf(file){ return (file.name.split(".").pop()||"").toLowerCase(); }

async function loadScript(test,src,label){
  if(test()) return;
  await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error("Не удалось загрузить "+label+". Проверьте интернет."));document.head.append(s);});
  if(!test()) throw new Error(label+" не запустился.");
}
async function getOCRWorker(){
  await loadScript(()=>!!window.Tesseract?.createWorker,"https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js","OCR");
  return window.Tesseract.createWorker(languages.value,1,{logger:m=>{if(m.status==="recognizing text")setProgress(Math.round((m.progress||0)*100));}});
}
function appendPageHeading(number){const h=document.createElement("h2");h.textContent="Страница "+number;editor.append(h);}
async function recognizeImage(file,worker){const result=await worker.recognize(file);return result.data.text||"";}
async function recognizePDF(file,worker){
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
  for(let n=1;n<=pdf.numPages;n++){
    say("Обработка PDF: страница "+n+" из "+pdf.numPages);
    const page=await pdf.getPage(n),text=await page.getTextContent();
    let extracted=text.items.map(x=>x.str||"").filter(Boolean).join(" ").trim();
    if(extracted.length<25){
      const base=page.getViewport({scale:1}),scale=Math.max(1,Math.min(2,2600/Math.max(base.width,base.height)));
      const viewport=page.getViewport({scale}),canvas=document.createElement("canvas");
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      await page.render({canvasContext:ctx,viewport}).promise;
      const recognized=await worker.recognize(canvas);extracted=recognized.data.text||"";
      canvas.width=canvas.height=0;
    }
    appendPageHeading(n);const p=document.createElement("p");p.textContent=extracted||"[Текст не распознан]";editor.append(p);
    setProgress(n/pdf.numPages*100);
  }
}
function sanitizeImportedHTML(markup){
  const doc=new DOMParser().parseFromString(String(markup||""),"text/html");
  const allowed=new Set(["P","DIV","H1","H2","H3","H4","STRONG","B","EM","I","U","UL","OL","LI","TABLE","THEAD","TBODY","TR","TD","TH","BR","BLOCKQUOTE","PRE"]);
  doc.querySelectorAll("script,style,iframe,object,embed,form,svg,math,video,audio,img,link,meta").forEach(n=>n.remove());
  doc.body.querySelectorAll("*").forEach(node=>{
    if(!allowed.has(node.tagName)){node.replaceWith(...node.childNodes);return;}
    [...node.attributes].forEach(a=>node.removeAttribute(a.name));
  });
  return doc.body.innerHTML;
}
async function importDOCX(file){
  await loadScript(()=>!!window.mammoth,"https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js","Импорт DOCX");
  const result=await window.mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});
  editor.innerHTML=sanitizeImportedHTML(result.value);
  const notes=result.messages?.length?(" Замечания импорта: "+result.messages.length+"."): "";
  state.format="docx";say("DOCX загружен. Проверьте оформление и содержимое перед экспортом."+notes);
  setProgress(100);
}
async function loadSheetJS(){
  await loadScript(()=>!!window.XLSX,"https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","Импорт/экспорт таблиц");
}
async function importSpreadsheet(file){
  await loadSheetJS();
  const workbook=window.XLSX.read(await file.arrayBuffer(),{type:"array"});
  const first=workbook.SheetNames[0];
  if(!first) throw new Error("В файле не найден лист.");
  const rows=window.XLSX.utils.sheet_to_json(workbook.Sheets[first],{header:1,raw:false,defval:""});
  if(!rows.length) throw new Error("Первый лист таблицы пуст.");
  const table=document.createElement("table");table.className="studio-data-table";
  rows.forEach((row,index)=>{
    const tr=document.createElement("tr");
    row.forEach(value=>{const cell=document.createElement(index===0?"th":"td");cell.textContent=String(value??"");tr.append(cell);});
    table.append(tr);
  });
  editor.replaceChildren(table);state.format="sheet";
  say("Загружен лист «"+first+"». Можно редактировать ячейки прямо в таблице. Другие листы исходной книги не изменяются и не включены в редактор.");
  setProgress(100);
}
async function recognize(){
  const file=fileInput.files?.[0];if(!file){say("Сначала выберите документ.");return;}
  setBusy(true);setProgress(0);editor.replaceChildren();state.sourceName=file.name;state.sourceType=file.type;
  const ext=extOf(file);let worker;
  try{
    if(ext==="docx"){say("Импорт DOCX…");await importDOCX(file);}
    else if(["xlsx","xls","csv"].includes(ext)){say("Импорт таблицы…");await importSpreadsheet(file);}
    else if(file.type==="application/pdf"||ext==="pdf"){
      worker=await getOCRWorker();await recognizePDF(file,worker);state.format="text";say("Обработка PDF завершена. Проверьте и отредактируйте распознанный текст.");
    }else if(file.type.startsWith("image/")){
      worker=await getOCRWorker();say("Распознавание изображения…");
      const text=await recognizeImage(file,worker),p=document.createElement("p");p.textContent=text;editor.append(p);
      state.format="text";setProgress(100);say("Распознавание завершено. Проверьте и отредактируйте текст.");
    }else throw new Error("Этот формат пока не поддерживается. Выберите PDF, изображение, DOCX, XLSX, XLS или CSV.");
  }catch(error){console.error(error);say("Ошибка: "+error.message);}
  finally{if(worker)try{await worker.terminate();}catch{}setBusy(false);}
}
function cleanEditorHTML(){
  const copy=editor.cloneNode(true);
  copy.querySelectorAll("script,iframe,object,embed,form,button,input,textarea,select").forEach(node=>node.remove());
  copy.querySelectorAll("*").forEach(node=>[...node.attributes].forEach(attr=>{
    if(/^on/i.test(attr.name)||((attr.name==="href"||attr.name==="src")&&/^\s*javascript:/i.test(attr.value)))node.removeAttribute(attr.name);
  }));
  return copy.innerHTML;
}
function documentHTML(){
  const title=state.sourceName.replace(/\.[^.]+$/,"")||"Новый документ";
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'+escapeHTML(title)+'</title><style>body{font:12pt/1.55 Georgia,serif;color:#222;max-width:850px;margin:40px auto;padding:0 24px}h1,h2{page-break-after:avoid}p{white-space:pre-wrap;margin:0 0 1em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px}@media print{body{margin:15mm auto}}</style></head><body><h1>'+escapeHTML(title)+'</h1>'+cleanEditorHTML()+'</body></html>';
}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function saveToLibrary(){
  const html=documentHTML(),base=safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document"),name=base+"-редакция.html";
  await put("books",{id:crypto.randomUUID?.()||String(Date.now()),name,title:(state.sourceName.replace(/\.[^.]+$/,"")||"Документ")+" — редакция",author:"",ext:"html",type:"text/html",data:new TextEncoder().encode(html).buffer,addedAt:Date.now(),favorite:false,sourceName:state.sourceName,revisionOf:state.sourceName});
  say("Новая HTML-редакция добавлена в библиотеку. Исходный файл не изменён.");
  download(new Blob([html],{type:"text/html;charset=utf-8"}),name);
}
function printPDF(){
  const w=window.open("","_blank");if(!w){say("Разрешите всплывающее окно для печати в PDF.");return;}
  w.document.open();w.document.write(documentHTML());w.document.close();w.onload=()=>{w.focus();w.print();};
}
function exportText(){download(new Blob([editor.innerText||""],{type:"text/plain;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-текст.txt");}
function insertCommand(command,value=null){editor.focus();document.execCommand(command,false,value);}
function htmlRuns(node,TextRun){
  const runs=[];
  function walk(n,style={}){
    if(n.nodeType===Node.TEXT_NODE){if(n.nodeValue)runs.push(new TextRun({text:n.nodeValue,bold:!!style.bold,italics:!!style.italics,underline:style.underline?{}:undefined}));return;}
    if(n.nodeType!==Node.ELEMENT_NODE)return;
    const next={bold:style.bold||["B","STRONG"].includes(n.tagName),italics:style.italics||["I","EM"].includes(n.tagName),underline:style.underline||n.tagName==="U"};
    n.childNodes.forEach(child=>walk(child,next));
    if(n.tagName==="BR")runs.push(new TextRun({text:"\n"}));
  }
  walk(node);return runs.length?runs:[new TextRun({text:""})];
}
async function exportDOCX(){
  if(!editor.innerText.trim()){say("Сначала загрузите или введите документ.");return;}
  say("Подготовка DOCX…");
  const d=await import("https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm");
  const {Document,Packer,Paragraph,TextRun,HeadingLevel,Table,TableRow,TableCell,WidthType}=d;
  const children=[];
  function addBlock(node){
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    if(node.tagName==="TABLE"){
      const rows=[...node.rows].map(row=>new TableRow({children:[...row.cells].map(cell=>new TableCell({children:[new Paragraph({children:htmlRuns(cell,TextRun)})]}))}));
      if(rows.length)children.push(new Table({rows,width:{size:100,type:WidthType.PERCENTAGE}}));
    }else if(["P","DIV","H1","H2","H3","H4","LI","BLOCKQUOTE","PRE"].includes(node.tagName)){
      const opts={children:htmlRuns(node,TextRun)};
      if(node.tagName==="H1")opts.heading=HeadingLevel.HEADING_1;
      if(node.tagName==="H2")opts.heading=HeadingLevel.HEADING_2;
      if(node.tagName==="H3"||node.tagName==="H4")opts.heading=HeadingLevel.HEADING_3;
      if(node.tagName==="LI")opts.bullet={indent:360};
      children.push(new Paragraph(opts));
    }else [...node.children].forEach(addBlock);
  }
  [...editor.children].forEach(addBlock);
  if(!children.length)children.push(new Paragraph({text:editor.innerText}));
  const doc=new Document({sections:[{children}]});
  const blob=await Packer.toBlob(doc);
  download(blob,safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-редакция.docx");
  say("DOCX создан. Сохранены основные абзацы, заголовки, списки, жирный/курсив/подчёркивание и простые таблицы. Сложная вёрстка и специальные элементы могут отличаться от оригинала.");
}
async function exportXLSX(){
  const table=editor.querySelector("table");if(!table){say("В редакторе нет таблицы для экспорта XLSX.");return;}
  await loadSheetJS();
  const workbook=window.XLSX.utils.book_new(),sheet=window.XLSX.utils.table_to_sheet(table);
  window.XLSX.utils.book_append_sheet(workbook,sheet,"Лист1");
  window.XLSX.writeFile(workbook,safeName(state.sourceName.replace(/\.[^.]+$/,"")||"таблица")+"-редакция.xlsx");
  say("XLSX создан из редактируемой таблицы.");
}
$("studioRecognize").addEventListener("click",recognize);
$("studioSave").addEventListener("click",()=>saveToLibrary().catch(e=>say("Не удалось сохранить: "+e.message)));
$("studioPDF").addEventListener("click",printPDF);
$("studioTXT").addEventListener("click",exportText);
$("studioDOCX").addEventListener("click",()=>exportDOCX().catch(e=>{console.error(e);say("Не удалось создать DOCX: "+e.message);}));
$("studioXLSX").addEventListener("click",()=>exportXLSX().catch(e=>{console.error(e);say("Не удалось создать XLSX: "+e.message);}));
$("studioBold").addEventListener("click",()=>insertCommand("bold"));
$("studioItalic").addEventListener("click",()=>insertCommand("italic"));
$("studioH2").addEventListener("click",()=>insertCommand("formatBlock","h2"));
$("studioParagraph").addEventListener("click",()=>insertCommand("formatBlock","p"));
$("studioUndo").addEventListener("click",()=>insertCommand("undo"));
$("studioRedo").addEventListener("click",()=>insertCommand("redo"));
$("studioClear").addEventListener("click",()=>{if(confirm("Очистить рабочее поле?"))editor.replaceChildren();});
$("studioDownloadHTML").addEventListener("click",()=>download(new Blob([documentHTML()],{type:"text/html;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+".html"));
$("openStudioBtn").addEventListener("click",()=>{$("libraryView").classList.add("hidden");$("readerView").classList.add("hidden");$("documentStudioView").classList.remove("hidden");document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));$("openStudioBtn").classList.add("active");});
$("studioBack").addEventListener("click",()=>{$("documentStudioView").classList.add("hidden");$("libraryView").classList.remove("hidden");$("openStudioBtn").classList.remove("active");});
fileInput.addEventListener("change",()=>{const f=fileInput.files?.[0];if(f){state.sourceName=f.name;say("Выбран файл: "+f.name+". Нажмите «Открыть документ / распознать».");}});
