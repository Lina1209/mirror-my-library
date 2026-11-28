import { put, getAll } from "./db.js";
import { decodeFB2, decodeText, fb2ToHTML } from "./parsers.js";

const $ = id => document.getElementById(id);
const state = { sourceName:"", sourceType:"", busy:false, format:"text", sourceBookId:null, documentReady:false, pendingFile:null };
const editor = $("studioEditor");
const status = $("studioStatus");
const progress = $("studioProgress");
const fileInput = $("studioFile");
const studioPreview = {file:null,pdf:null,page:1,zoom:"fit",renderTask:null,objectUrl:null};
const previewSurface=$("studioPreviewSurface");
const previewMeta=$("studioPreviewMeta");
const previewControls=$("studioPreviewControls");
const previewDownload=$("studioPreviewDownload");
const previewZoom=$("studioPreviewZoom");
function previewSay(message){if(previewMeta)previewMeta.textContent=message;}
function previewSetPageLabel(){const total=studioPreview.pdf?.numPages||1;$("studioPreviewPage").textContent=studioPreview.pdf?"Страница "+studioPreview.page+" из "+total:"";}
function previewDownloadOriginal(){
  const file=studioPreview.file;if(!file)return;
  const url=URL.createObjectURL(file),a=document.createElement("a");a.href=url;a.download=file.name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function previewLoadPDF(file){
  const pdfjs=await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs";
  studioPreview.pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()).slice(),useWorkerFetch:false}).promise;
  studioPreview.page=1;previewControls.hidden=false;await previewRenderPDF();
  previewSay("PDF · "+studioPreview.pdf.numPages+" страниц · оригинал отображается без OCR.");
}
async function previewRenderPDF(){
  if(!studioPreview.pdf)return;
  const renderVersion=(studioPreview.renderVersion=(studioPreview.renderVersion||0)+1);
  if(studioPreview.renderTask){try{studioPreview.renderTask.cancel();}catch{}studioPreview.renderTask=null;}
  const page=await studioPreview.pdf.getPage(studioPreview.page);
  if(renderVersion!==studioPreview.renderVersion||!studioPreview.pdf)return;
  const base=page.getViewport({scale:1});
  const surfaceW=Math.max(300,previewSurface.clientWidth-24);
  const zoom=studioPreview.zoom==="fit"?Math.min(1.6,surfaceW/base.width):Number(studioPreview.zoom);
  const viewport=page.getViewport({scale:zoom}),canvas=document.createElement("canvas"),ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(viewport.width*ratio);canvas.height=Math.round(viewport.height*ratio);
  canvas.style.width=Math.round(viewport.width)+"px";canvas.style.height=Math.round(viewport.height)+"px";
  const context=canvas.getContext("2d",{alpha:false});
  if(!context)throw new Error("Браузер не смог создать Canvas для отображения PDF.");
  const task=page.render({canvasContext:context,viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0],intent:"display"});
  studioPreview.renderTask=task;
  try{await task.promise;}
  catch(error){if(error?.name==="RenderingCancelledException"||renderVersion!==studioPreview.renderVersion)return;throw error;}
  finally{if(studioPreview.renderTask===task)studioPreview.renderTask=null;}
  if(renderVersion!==studioPreview.renderVersion||!studioPreview.pdf)return;
  previewSurface.replaceChildren(canvas);previewSetPageLabel();
  $("studioPreviewPrev").disabled=studioPreview.page<=1;$("studioPreviewNext").disabled=studioPreview.page>=studioPreview.pdf.numPages;
}
async function openStudioPreview(file){
  if(!file)return;
  studioPreview.renderVersion=(studioPreview.renderVersion||0)+1;
  if(studioPreview.renderTask){try{studioPreview.renderTask.cancel();}catch{}studioPreview.renderTask=null;}
  if(studioPreview.objectUrl){URL.revokeObjectURL(studioPreview.objectUrl);studioPreview.objectUrl=null;}
  if(studioPreview.pdf){try{await studioPreview.pdf.destroy();}catch(error){console.warn("PDF preview cleanup:",error);}}
  studioPreview.file=file;studioPreview.pdf=null;studioPreview.page=1;studioPreview.zoom=previewZoom.value;
  previewDownload.disabled=false;
  if (!state.sourceBookId) $("studioSaveSourceToLibrary").disabled = false;previewControls.hidden=true;previewSurface.replaceChildren();previewSay("Открываем "+file.name+"…");
  const ext=extOf(file),type=file.type||"";
  try{
    if(ext==="pdf"||type==="application/pdf"){await previewLoadPDF(file);return;}
    if(type.startsWith("image/")||["png","jpg","jpeg","webp","gif","bmp","tif","tiff"].includes(ext)){
      const img=document.createElement("img");img.className="studio-preview-image";img.alt=file.name;
      studioPreview.objectUrl=URL.createObjectURL(file);img.src=studioPreview.objectUrl;
      img.style.maxWidth=studioPreview.zoom==="fit"?"100%":(Number(studioPreview.zoom)*100)+"%";
      img.onload=()=>previewSay(file.name+" · "+img.naturalWidth+" × "+img.naturalHeight+" · оригинальное изображение");
      previewSurface.replaceChildren(img);return;
    }
    if(["txt","md","csv","log","json","xml"].includes(ext)||type.startsWith("text/")){
      const pre=document.createElement("pre");pre.className="studio-preview-text";pre.textContent=decodeText(await file.arrayBuffer());previewSurface.replaceChildren(pre);previewSay(file.name+" · текстовый просмотр");return;
    }
    if(ext==="fb2"||file.name.toLowerCase().endsWith(".fb2.zip")){
      let bytes=await file.arrayBuffer();
      if(file.name.toLowerCase().endsWith(".fb2.zip")){
        await loadScript(()=>!!window.JSZip,"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js","чтение FB2.ZIP");
        const archive=await window.JSZip.loadAsync(bytes);
        const entry=Object.values(archive.files).find(item=>!item.dir&&/\.fb2$/i.test(item.name));
        if(!entry)throw new Error("В ZIP-архиве не найден файл FB2.");
        bytes=await entry.async("arraybuffer");
      }
      previewSurface.innerHTML=sanitizeImportedHTML(fb2ToHTML(decodeFB2(bytes)));
      previewSay(file.name+" · предпросмотр FB2");return;
    }
    if(ext==="epub"){
      await loadScript(()=>!!window.JSZip,"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js","чтение EPUB");
      const archive=await window.JSZip.loadAsync(await file.arrayBuffer()),container=archive.file("META-INF/container.xml");
      if(!container)throw new Error("В EPUB отсутствует META-INF/container.xml.");
      const containerDoc=new DOMParser().parseFromString(await container.async("string"),"application/xml");
      const opfPath=containerDoc.getElementsByTagNameNS("*","rootfile")[0]?.getAttribute("full-path");
      const opfFile=opfPath&&archive.file(opfPath);if(!opfFile)throw new Error("В EPUB не найден OPF.");
      const opf=new DOMParser().parseFromString(await opfFile.async("string"),"application/xml");
      const base=opfPath.includes("/")?opfPath.slice(0,opfPath.lastIndexOf("/") + 1):"";
      const manifest=new Map([...opf.getElementsByTagNameNS("*","item")].map(item=>[item.getAttribute("id"),item.getAttribute("href")]));
      const content=document.createElement("div");let count=0;
      for(const item of [...opf.getElementsByTagNameNS("*","itemref")]){
        const href=manifest.get(item.getAttribute("idref"));if(!href)continue;
        const path=(base+decodeURIComponent(href.split("#")[0])).split("/").reduce((parts,part)=>{if(!part||part===".")return parts;if(part==="..")parts.pop();else parts.push(part);return parts;},[]).join("/");
        const chapter=archive.file(path);if(!chapter)continue;
        const doc=new DOMParser().parseFromString(await chapter.async("string"),"text/html");
        const section=document.createElement("section");section.innerHTML=sanitizeImportedHTML((doc.querySelector("body")||doc.documentElement).innerHTML);content.append(section);count++;
      }
      if(!count)throw new Error("В EPUB не найдены главы.");
      previewSurface.replaceChildren(content);previewSay(file.name+" · предпросмотр EPUB · глав: "+count);return;
    }
    if(["html","htm"].includes(ext)){
      const content=sanitizeImportedHTML(decodeText(await file.arrayBuffer())),frame=document.createElement("iframe");frame.className="studio-preview-frame";frame.setAttribute("sandbox","");frame.srcdoc=content;previewSurface.replaceChildren(frame);previewSay(file.name+" · безопасный HTML-предпросмотр");return;
    }
    if(ext==="docx"){
      await loadScript(()=>!!window.mammoth,"https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js","DOCX viewer");
      const result=await window.mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});
      previewSurface.innerHTML=sanitizeImportedHTML(result.value);previewSay(file.name+" · предпросмотр DOCX (возможны отличия от Word)");return;
    }
    if(["xlsx","xls","csv"].includes(ext)){
      await loadScript(()=>!!window.XLSX,"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js","табличный просмотр");
      const workbook=window.XLSX.read(await file.arrayBuffer(),{type:"array"}),tabs=document.createElement("div");tabs.className="studio-preview-sheet-tabs";
      const sheetArea=document.createElement("div");sheetArea.className="studio-preview-sheet";
      const showSheet=name=>{sheetArea.innerHTML=window.XLSX.utils.sheet_to_html(workbook.Sheets[name],{editable:false});};
      workbook.SheetNames.forEach((name,index)=>{const b=document.createElement("button");b.type="button";b.className="secondary";b.textContent=name;b.onclick=()=>showSheet(name);tabs.append(b);if(index===0)showSheet(name);});
      previewSurface.replaceChildren(tabs,sheetArea);previewSay(file.name+" · "+workbook.SheetNames.length+" лист(ов)");return;
    }
    if(["pptx","odt","odp","zip"].includes(ext)){
      await loadScript(()=>!!window.JSZip,"https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js","ZIP/Office preview");
      const archive=await window.JSZip.loadAsync(file),listing=document.createElement("div");
      if(ext==="zip"){
        const files=Object.values(archive.files).filter(entry=>!entry.dir);
        const list=document.createElement("div");list.className="studio-archive-list";
        files.forEach(entry=>{
          const row=document.createElement("div"),name=document.createElement("span"),button=document.createElement("button");
          row.className="studio-archive-item";name.textContent=entry.name;button.type="button";button.className="secondary";button.textContent="Скачать";
          button.onclick=async()=>{const blob=await entry.async("blob"),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=entry.name.split("/").pop()||"file";a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
          row.append(name,button);list.append(row);
        });
        previewSurface.replaceChildren(list);previewSay("ZIP-архив · "+files.length+" файлов. Оригинальный архив не изменяется.");return;
      }
      const textParts=[];
      if(ext==="pptx"){
        const slides=Object.keys(archive.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/i)[1])-Number(b.match(/slide(\d+)/i)[1]));
        for(const name of slides){
          const xml=await archive.file(name).async("string"),doc=new DOMParser().parseFromString(xml,"application/xml");
          const heading=document.createElement("h3");heading.textContent="Слайд "+name.match(/slide(\d+)/i)[1];
          const body=document.createElement("div");body.className="studio-preview-slide-text";
          const paragraphs=[...doc.getElementsByTagNameNS("*","p")].map(p=>[...p.getElementsByTagNameNS("*","t")].map(t=>t.textContent).join("")).filter(Boolean);
          body.textContent=paragraphs.join("\n");
          listing.append(heading,body);textParts.push(body.textContent);
        }
        previewSurface.replaceChildren(listing);previewSay(file.name+" · текстовый предпросмотр "+slides.length+" слайдов (не отображает исходный дизайн)");return;
      }
      const contentFile=archive.file("content.xml");
      if(!contentFile)throw new Error("В архиве не найден content.xml");
      const xml=await contentFile.async("string"),doc=new DOMParser().parseFromString(xml,"application/xml");
      if(doc.querySelector("parsererror"))throw new Error("XML внутри документа повреждён");
      const paragraphs=[...doc.getElementsByTagNameNS("*","p"),...doc.getElementsByTagNameNS("*","h")];
      paragraphs.forEach(p=>{const line=document.createElement(p.localName==="h"?"h3":"p");line.textContent=p.textContent||"";listing.append(line);});
      previewSurface.replaceChildren(listing);previewSay(file.name+" · текстовый просмотр ODF; оригинальное форматирование не полностью воспроизводится");return;
    }
    if(ext==="rtf"){
      const raw=await file.text(),plain=raw.replace(/\\'[0-9a-f]{2}/gi,"").replace(/\\[a-z]+-?\d* ?/gi,"").replace(/[{}]/g,"").replace(/\\\\/g,"\\");
      const pre=document.createElement("pre");pre.className="studio-preview-text";pre.textContent=plain;previewSurface.replaceChildren(pre);previewSay(file.name+" · упрощённый просмотр RTF");return;
    }
    previewSurface.innerHTML='<div class="studio-preview-empty">Формат '+escapeHTML(ext.toUpperCase()||"неизвестен")+' пока нельзя визуально открыть в браузере. Оригинал можно скачать; доступные инструменты обработки — ниже.</div>';
    previewSay(file.name+" · формат не поддерживается для визуального просмотра.");
  }catch(error){console.error("Document preview:",error);previewSurface.textContent="Ошибка просмотра: "+error.message;previewSay("Не удалось открыть файл. Оригинал доступен для скачивания.");}
}

// Accept a book already stored in the local library and open it in the separate editor workspace.
window.openMirrorBookInStudio = async function(file, bookId = null) {
  if (!(file instanceof File)) throw new TypeError("Не удалось получить файл из библиотеки.");
  const previewInput = $("studioPreviewFile");
  if (previewInput) {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      previewInput.files = transfer.files;
    } catch (error) {
      console.warn("Не удалось заполнить поле предпросмотра; файл всё равно будет открыт напрямую:", error);
    }
  }
  state.sourceName = file.name;
  state.sourceType = file.type || "";
  state.pendingFile = file;
  const editorInput = $("studioFile");
  if(editorInput){
    try{const transfer=new DataTransfer();transfer.items.add(file);editorInput.files=transfer.files;}
    catch(error){console.warn("Не удалось заполнить поле редактирования; используется прямая передача файла:",error);}
  }
  setStudioReady(false);
  state.sourceBookId = bookId;
  $("studioSaveSourceToLibrary").disabled = Boolean(bookId);
  $("studioSaveSourceToLibrary").textContent = bookId ? "✓ Уже в библиотеке" : "＋ В библиотеку";
  $("openStudioBtn")?.click();
  await openStudioPreview(file);
  await recognize();
  previewDownload.disabled = false;
  previewSay(file.name + " · файл из библиотеки. Оригинал сохранён в библиотеке; повторный импорт не выполняется.");
  $("studioPreviewMeta")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
};

$("studioPreviewOpen")?.addEventListener("click",()=>openStudioPreview($("studioPreviewFile").files?.[0]));
$("studioPreviewFile")?.addEventListener("change",event=>{const file=event.target.files?.[0];if(file){state.sourceBookId=null;state.sourceName=file.name;state.sourceType=file.type||"";$("studioSaveSourceToLibrary").disabled=false;$("studioSaveSourceToLibrary").textContent="＋ В библиотеку";openStudioPreview(file);}});
$("studioFile")?.addEventListener("change",event=>{const file=event.target.files?.[0];if(file){if(event.isTrusted){state.sourceBookId=null;state.sourceName=file.name;state.sourceType=file.type||"";$("studioSaveSourceToLibrary").disabled=false;$("studioSaveSourceToLibrary").textContent="＋ В библиотеку";}openStudioPreview(file);}});
previewDownload?.addEventListener("click",previewDownloadOriginal);
async function saveStudioSourceToLibrary() {
  const file = studioPreview.file;
  if (!file) { say("Сначала откройте документ для просмотра."); return; }
  if (state.sourceBookId) { say("Этот оригинал уже находится в библиотеке."); return; }
  if (typeof window.addMirrorFileToLibrary !== "function") {
    say("Библиотека ещё загружается. Повторите попытку через мгновение.");
    return;
  }
  try {
    const savedId = await window.addMirrorFileToLibrary(file);
    if (!savedId) {
      say("Не удалось добавить файл. Проверьте, поддерживается ли его формат.");
      return;
    }
    state.sourceBookId = savedId;
    $("studioSaveSourceToLibrary").disabled = true;
    $("studioSaveSourceToLibrary").textContent = "✓ Сохранено в библиотеке";
    say("Оригинал добавлен в библиотеку вместе с доступными метаданными и обложкой. Исходный файл не изменён.");
  } catch (error) {
    say("Не удалось сохранить файл в библиотеку: " + error.message);
  }
}
$("studioSaveSourceToLibrary")?.addEventListener("click",saveStudioSourceToLibrary);
$("studioPreviewPrev")?.addEventListener("click",()=>{if(studioPreview.pdf&&studioPreview.page>1){studioPreview.page--;previewRenderPDF();}});
$("studioPreviewNext")?.addEventListener("click",()=>{if(studioPreview.pdf&&studioPreview.page<studioPreview.pdf.numPages){studioPreview.page++;previewRenderPDF();}});
previewZoom?.addEventListener("change",()=>{studioPreview.zoom=previewZoom.value;if(studioPreview.pdf)previewRenderPDF();else{const img=previewSurface.querySelector("img");if(img)img.style.maxWidth=studioPreview.zoom==="fit"?"100%":(Number(studioPreview.zoom)*100)+"%";}});
function adjustStudioPreviewZoom(direction){
  if(!previewZoom)return;
  const steps=[0.75,1,1.25,1.5,2];
  const current=studioPreview.zoom==="fit"?1:Number(studioPreview.zoom)||1;
  let index=steps.findIndex(value=>value>=current-0.001);
  if(index<0)index=steps.length-1;
  index=Math.max(0,Math.min(steps.length-1,index+direction));
  previewZoom.value=String(steps[index]);
  previewZoom.dispatchEvent(new Event("change"));
}
$("studioPreviewZoomOut")?.addEventListener("click",()=>adjustStudioPreviewZoom(-1));
$("studioPreviewZoomIn")?.addEventListener("click",()=>adjustStudioPreviewZoom(1));
$("studioPreviewFullscreen")?.addEventListener("click",async()=>{
  const box=$("studioPreviewSurface").closest(".studio-preview-card");
  try{if(document.fullscreenElement===box)await document.exitFullscreen();else if(box.requestFullscreen)await box.requestFullscreen();else box.classList.toggle("studio-preview-expanded");}
  catch{box.classList.toggle("studio-preview-expanded");}
});
window.addEventListener("resize",()=>{if(studioPreview.pdf&&studioPreview.zoom==="fit")previewRenderPDF();});
const languages = $("studioLanguage");
const savedOCRLanguage = localStorage.getItem("mirror-studio-language");
if (savedOCRLanguage && [...languages.options].some(option => option.value === savedOCRLanguage)) languages.value = savedOCRLanguage;
languages.addEventListener("change", () => localStorage.setItem("mirror-studio-language", languages.value));


// Page navigation for the fixed document preview window.
const studioPageNavigation = (() => {
  const previous = $("studioPrevPage");
  const next = $("studioNextPage");
  const counter = $("studioPageCounter");
  let current = 0;
  let touchStart = null;
  const pages = () => [...editor.querySelectorAll(".studio-source-page")];
  function goTo(index) {
    const list = pages();
    if (!list.length) { if(counter) counter.textContent="Страниц пока нет"; return; }
    current = Math.max(0, Math.min(list.length - 1, index));
    const page = list[current];
    editor.scrollTo({top:Math.max(0,page.offsetTop-editor.offsetTop-8),behavior:"smooth"});
    if(counter) counter.textContent="Страница "+(current+1)+" из "+list.length;
    if(previous) previous.disabled=current===0;
    if(next) next.disabled=current===list.length-1;
  }
  function refresh(){const list=pages();if(!list.length){if(counter)counter.textContent="Страниц пока нет";return;}goTo(Math.min(current,list.length-1));}
  previous?.addEventListener("click",()=>goTo(current-1));
  next?.addEventListener("click",()=>goTo(current+1));
  editor.addEventListener("touchstart",event=>{
    if(event.touches.length!==1)return;
    touchStart={x:event.touches[0].clientX,y:event.touches[0].clientY};
  },{passive:true});
  editor.addEventListener("touchend",event=>{
    if(!touchStart||!event.changedTouches.length)return;
    const dx=event.changedTouches[0].clientX-touchStart.x;
    const dy=event.changedTouches[0].clientY-touchStart.y;
    touchStart=null;
    if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.25)goTo(current+(dx<0?1:-1));
  },{passive:true});
  editor.addEventListener("keydown",event=>{
    if(event.altKey&&(event.key==="ArrowRight"||event.key==="ArrowLeft")){
      event.preventDefault();goTo(current+(event.key==="ArrowRight"?1:-1));
    }
    if(event.key==="PageDown"||event.key==="PageUp"){
      event.preventDefault();goTo(current+(event.key==="PageDown"?1:-1));
    }
  });
  const observer=new MutationObserver(()=>refresh());
  observer.observe(editor,{childList:true,subtree:true});
  return {refresh,goTo};
})();
function say(message){ status.textContent=message; }
function escapeHTML(value){ return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function safeName(value){ return (value||"document").replace(/[^a-z0-9а-яё_-]+/gi,"-").replace(/^-|-$/g,"")||"document"; }
function setBusy(value){ state.busy=value; $("studioRecognize").disabled=value; $("studioFile").disabled=value; }
function setStudioReady(value){
  state.documentReady=Boolean(value);
  editor.contentEditable="true";
  $("studioSave").disabled=!state.documentReady;
  $("studioExportToggle").disabled=!state.documentReady;
  $("studioPrintPDF").disabled=!state.documentReady;
  const xlsxButton=document.querySelector('[data-export-format="xlsx"]');
  if(xlsxButton)xlsxButton.hidden=!editor.querySelector("table");
  if(!state.documentReady){$("studioFormatPanel").hidden=true;$("studioExportToggle").setAttribute("aria-expanded","false");}
}
function setProgress(value){ progress.value=Math.max(0,Math.min(100,value)); }
setStudioReady(false);
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
async function recognizePDF(file){
  let worker=null;
  const pdfjs=await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs";
  const pdf=await pdfjs.getDocument({
    data:new Uint8Array(await file.arrayBuffer()).slice(),
    isEvalSupported:false,
    useWorkerFetch:false
  }).promise;
  try{
    for(let n=1;n<=pdf.numPages;n++){
      say("Обработка PDF: страница "+n+" из "+pdf.numPages+" — сохраняем исходный вид и извлекаем текст…");
      const page=await pdf.getPage(n);
      const textContent=await page.getTextContent();
      const textItems=textContent.items.filter(item=>typeof item.str==="string"&&item.str.trim());
      const lines=[];
      textItems.forEach(item=>{
        const y=Number(item.transform?.[5]||0);
        let line=lines.find(entry=>Math.abs(entry.y-y)<3);
        if(!line){line={y,items:[]};lines.push(line);}
        line.items.push(item);
      });
      lines.sort((x,y)=>y.y-x.y);
      let extracted=lines.map(line=>line.items.sort((x,y)=>(x.transform?.[4]||0)-(y.transform?.[4]||0)).map(item=>item.str).join(" ").replace(/\s+/g," ").trim()).filter(Boolean).join("\n").trim();
      const base=page.getViewport({scale:1});
      const previewScale=Math.min(1.45,1800/Math.max(base.width,base.height));
      const previewViewport=page.getViewport({scale:previewScale});
      const canvas=document.createElement("canvas");
      canvas.width=Math.ceil(previewViewport.width);canvas.height=Math.ceil(previewViewport.height);
      await page.render({canvasContext:canvas.getContext("2d"),viewport:previewViewport}).promise;
      if(extracted.length<25){
        say("Страница "+n+" из "+pdf.numPages+": распознаём текст…");
        if(!worker)worker=await getOCRWorker();
        const ocrCanvas=document.createElement("canvas");
        const ocrScale=Math.max(1,Math.min(2,2600/Math.max(base.width,base.height)));
        const ocrViewport=page.getViewport({scale:ocrScale});
        ocrCanvas.width=Math.ceil(ocrViewport.width);ocrCanvas.height=Math.ceil(ocrViewport.height);
        await page.render({canvasContext:ocrCanvas.getContext("2d",{willReadFrequently:true}),viewport:ocrViewport}).promise;
        const recognized=await worker.recognize(ocrCanvas);
        extracted=String(recognized.data.text||"").trim();
        ocrCanvas.width=ocrCanvas.height=0;
      }
      const pageBlock=document.createElement("div");
      pageBlock.className="studio-source-page studio-pdf-page";
      pageBlock.dataset.pageWidth=String(Math.round(base.width));
      pageBlock.dataset.pageHeight=String(Math.round(base.height));
      pageBlock.style.cssText="position:relative;width:100%;max-width:700px;aspect-ratio:"+base.width+"/"+base.height+";margin:14px auto 22px;padding:0;overflow:hidden;background:#fff;box-sizing:border-box;border:1px solid #d8d2c7;";
      const pageImage=document.createElement("img");
      pageImage.className="studio-source-page-image";
      pageImage.alt="Страница "+n+" из исходного PDF";
      pageImage.src=canvas.toDataURL("image/jpeg",0.96);
      pageImage.style.cssText="display:block;width:100%;height:100%;max-width:none;max-height:none;margin:0;object-fit:contain;";
      pageBlock.append(pageImage);
      editor.append(pageBlock);
      const textDetails=document.createElement("details");
      textDetails.className="studio-ocr-details";
      textDetails.open=true;
      const summary=document.createElement("summary");
      summary.textContent="Распознанный текст страницы "+n+" — нажмите, чтобы открыть и исправить";
      const textBlock=document.createElement("div");
      textBlock.className="studio-recognized-text";
      textBlock.contentEditable="true";textBlock.spellcheck=true;textBlock.tabIndex=0;
      textBlock.setAttribute("role","textbox");textBlock.setAttribute("aria-multiline","true");
      textBlock.textContent=extracted||"[Текст на странице не распознан]";
      textDetails.append(summary,textBlock);editor.append(textDetails);
      canvas.width=canvas.height=0;
      setProgress(n/pdf.numPages*100);
    }
  }finally{
    if(worker)try{await worker.terminate();}catch(error){console.warn("OCR worker cleanup:",error);}
    try{await pdf.destroy();}catch(error){console.warn("OCR PDF cleanup:",error);}
  }
}
function safeImportedStyle(value){
  const allowed=new Set(["font-family","font-size","font-weight","font-style","text-decoration","text-align","text-indent","line-height","letter-spacing","color","background-color","margin-top","margin-right","margin-bottom","margin-left","width","height","min-height","vertical-align","border","border-top","border-right","border-bottom","border-left","border-color","border-width","border-style","padding","padding-top","padding-right","padding-bottom","padding-left","table-layout","position","left","top","z-index","white-space","overflow","object-fit"]);
  const safe=[];
  String(value||"").split(";").forEach(part=>{
    const i=part.indexOf(":");if(i<1)return;
    const key=part.slice(0,i).trim().toLowerCase(),val=part.slice(i+1).trim();
    if(!allowed.has(key)||!val||/url\s*\(|expression|javascript:/i.test(val))return;
    if(key==="text-align"&&!/^(left|right|center|justify)$/i.test(val))return;
    if(key==="position"&&!/^(absolute|relative|static)$/i.test(val))return;
    if(key==="white-space"&&!/^(normal|pre|pre-wrap|nowrap)$/i.test(val))return;
    if(key==="overflow"&&!/^(hidden|visible|auto)$/i.test(val))return;
    if(key==="object-fit"&&!/^(contain|cover|fill)$/i.test(val))return;
    if(key==="z-index"&&!/^-?\d{1,4}$/.test(val))return;
    if(key==="vertical-align"&&!/^(top|middle|bottom|baseline)$/i.test(val))return;
    if(key==="font-weight"&&!/^(normal|bold|[1-9]00)$/i.test(val))return;
    if(key==="font-style"&&!/^(normal|italic|oblique)$/i.test(val))return;
    if(key==="table-layout"&&!/^(fixed|auto)$/i.test(val))return;
    if(key==="line-height"&&!/^(normal|\\d+(?:\\.\\d+)?(?:px|pt|%)?)$/i.test(val))return;
    if(["color","background-color","border-color"].includes(key)&&!(/^(#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]{3,20})$/i.test(val)))return;
    if(["width","height","min-height","left","top","margin-top","margin-right","margin-bottom","margin-left","text-indent","letter-spacing","padding","padding-top","padding-right","padding-bottom","padding-left","border-width"].includes(key)&&!/^-?\d+(?:\.\d+)?(?:px|pt|mm|cm|in|%)?$/.test(val))return;
    if(key==="border-style"&&!/^(none|solid|double|dotted|dashed|groove|ridge|inset|outset)$/i.test(val))return;
    safe.push(key+":"+val);
  });
  return safe.join(";");
}
function sanitizeImportedHTML(markup){
  const doc=new DOMParser().parseFromString(String(markup||""),"text/html");
  const allowed=new Set(["P","DIV","SPAN","H1","H2","H3","H4","STRONG","B","EM","I","U","UL","OL","LI","TABLE","THEAD","TBODY","TR","TD","TH","COLGROUP","COL","BR","BLOCKQUOTE","PRE","IMG","DETAILS","SUMMARY"]);
  doc.querySelectorAll("script,style,iframe,object,embed,form,svg,math,video,audio,link,meta").forEach(n=>n.remove());
  doc.body.querySelectorAll("*").forEach(node=>{
    if(!allowed.has(node.tagName)){node.replaceWith(...node.childNodes);return;}
    const attrs=[...node.attributes];attrs.forEach(a=>node.removeAttribute(a.name));
    const style=safeImportedStyle(attrs.find(a=>a.name.toLowerCase()==="style")?.value);
    if(style)node.setAttribute("style",style);
    const classValue=attrs.find(a=>a.name.toLowerCase()==="class")?.value||"";
    const safeClasses=new Set(["studio-docx-page-settings","studio-source-page","studio-pdf-page","studio-source-page-image","studio-source-caption","studio-ocr-details","studio-recognized-text","studio-reconstructed-page","studio-reconstructed-text-layer","studio-reconstructed-line","studio-page-break","studio-data-table"]);
    const keptClasses=classValue.split(/\s+/).filter(name=>safeClasses.has(name));
    if(keptClasses.length)node.className=keptClasses.join(" ");
    if(node.tagName==="IMG"){
      const src=attrs.find(a=>a.name.toLowerCase()==="src")?.value||"";
      if(!/^data:image\/(png|jpeg|gif);base64,[a-z0-9+/=]+$/i.test(src)){node.remove();return;}
      node.setAttribute("src",src);
      const alt=attrs.find(a=>a.name.toLowerCase()==="alt")?.value;if(alt)node.setAttribute("alt",alt.slice(0,300));
      ["width","height"].forEach(key=>{const n=Number(attrs.find(a=>a.name.toLowerCase()===key)?.value);if(Number.isFinite(n)&&n>0&&n<=2400)node.setAttribute(key,String(Math.round(n)));});
    }
    if(["TD","TH"].includes(node.tagName)){
      ["rowspan","colspan"].forEach(key=>{const n=Number(attrs.find(a=>a.name.toLowerCase()===key)?.value);if(Number.isInteger(n)&&n>=1&&n<=100)node.setAttribute(key,String(n));});
    }
    const safeDataAttributes=new Set(["data-page-width","data-page-height","data-page-top","data-page-right","data-page-bottom","data-page-left","data-page-header","data-page-footer","data-sheet-name","data-xlsx-type","data-xlsx-value","data-xlsx-formula","data-xlsx-format","data-xlsx-display","data-docx-table","data-docx-width-type","data-docx-width","data-docx-height","data-docx-height-rule","data-docx-header","data-docx-cant-split","data-page-break"]);
    attrs.forEach(attr=>{
      const key=attr.name.toLowerCase(),rawValue=String(attr.value||""),value=rawValue.trim();
      if(!safeDataAttributes.has(key))return;
      if(["data-docx-table","data-docx-header","data-docx-cant-split","data-page-break"].includes(key)){if(value==="true")node.setAttribute(key,"true");}
      else if(key==="data-docx-width-type"&&["pct","dxa"].includes(value))node.setAttribute(key,value);
      else if(key==="data-docx-height-rule"&&["exact","atLeast","auto"].includes(value))node.setAttribute(key,value);
      else if(key==="data-sheet-name"&&value.length<=100)node.setAttribute(key,value);
      else if(key==="data-xlsx-type"&&["n","s","str","b","d","e"].includes(value))node.setAttribute(key,value);
      else if(["data-xlsx-value","data-xlsx-formula","data-xlsx-display"].includes(key)&&rawValue.length<=2000)node.setAttribute(key,rawValue);
      else if(key==="data-xlsx-format"&&value.length<=120)node.setAttribute(key,value);
      else if((["data-docx-width","data-docx-height"].includes(key)||key.startsWith("data-page-"))&&/^\d+(?:\.\d+)?$/.test(value))node.setAttribute(key,value);
    });
  });
  return doc.body.innerHTML;
}
const WORD_NS="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function xmlKids(node,name){return Array.from(node?.children||[]).filter(child=>child.localName===name);}
function xmlKid(node,name){return xmlKids(node,name)[0]||null;}
function xmlAttr(node,name){return node?.getAttribute("w:"+name)||node?.getAttributeNS(WORD_NS,name)||"";}
function xmlNumber(node,name){const value=Number(xmlAttr(node,name));return Number.isFinite(value)?value:0;}
function twipsToPx(value){return Math.round(value/15*100)/100;}
function setDocxBorder(element,side,xmlBorder){
  if(!xmlBorder)return;
  const val=xmlAttr(xmlBorder,"val"),cssSide=side.toLowerCase();
  if(val==="nil"||val==="none"){element.style["border"+cssSide]="none";return;}
  const styleMap={single:"solid",double:"double",dotted:"dotted",dashed:"dashed",dashSmallGap:"dashed",dotDash:"dashed",dotDotDash:"dashed",thick:"solid"};
  const cssStyle=styleMap[val]||"solid",sz=xmlNumber(xmlBorder,"sz");
  const width=sz?Math.max(.5,Math.min(8,sz/6)):1;
  let color=xmlAttr(xmlBorder,"color");if(!/^[0-9a-f]{6}$/i.test(color))color="777777";
  element.style["border"+cssSide]=width+"px "+cssStyle+" #"+color;
}
function restoreDocxPageSettings(xmlText){
  const xml=new DOMParser().parseFromString(xmlText,"application/xml");
  if(xml.querySelector("parsererror"))throw new Error("Некорректные настройки страницы DOCX");
  const sectPr=xml.getElementsByTagNameNS(WORD_NS,"sectPr")[0];
  if(!sectPr)return false;
  const pgSz=xmlKid(sectPr,"pgSz"),pgMar=xmlKid(sectPr,"pgMar");
  const twips=(node,key,fallback)=>{const raw=xmlAttr(node,key);const value=raw===""?fallback:Number(raw);return Number.isFinite(value)&&value>=0?Math.round(value):fallback;};
  const settings={
    width:twips(pgSz,"w",11906),height:twips(pgSz,"h",16838),
    top:twips(pgMar,"top",1134),right:twips(pgMar,"right",850),
    bottom:twips(pgMar,"bottom",1134),left:twips(pgMar,"left",850),
    header:twips(pgMar,"header",567),footer:twips(pgMar,"footer",567)
  };
  let marker=editor.querySelector(".studio-docx-page-settings");
  if(!marker){marker=document.createElement("div");marker.className="studio-docx-page-settings";editor.prepend(marker);}
  Object.entries(settings).forEach(([key,value])=>marker.dataset["page"+key[0].toUpperCase()+key.slice(1)]=String(value));
  return true;
}
function readDocxPageSettings(){
  const marker=editor.querySelector(".studio-docx-page-settings");
  const number=(key,fallback)=>{const raw=marker?.dataset[key];if(raw===undefined||raw==="")return fallback;const value=Number(raw);return Number.isFinite(value)&&value>=0?Math.round(value):fallback;};
  return {width:number("pageWidth",11906),height:number("pageHeight",16838),
    top:number("pageTop",1134),right:number("pageRight",850),bottom:number("pageBottom",1134),left:number("pageLeft",850),header:number("pageHeader",567),footer:number("pageFooter",567)};
}
function restoreDocxTableGeometry(xmlText){
  const xml=new DOMParser().parseFromString(xmlText,"application/xml");
  if(xml.querySelector("parsererror"))throw new Error("Некорректный XML таблиц DOCX");
  const xmlTables=Array.from(xml.getElementsByTagNameNS(WORD_NS,"tbl"));
  const htmlTables=[...editor.querySelectorAll("table")];
  let restored=0;
  xmlTables.forEach((xmlTable,tableIndex)=>{
    const table=htmlTables[tableIndex];if(!table)return;
    const tblPr=xmlKid(xmlTable,"tblPr"),grid=xmlKid(xmlTable,"tblGrid");
    const gridWidths=xmlKids(grid,"gridCol").map(col=>xmlNumber(col,"w"));
    const positiveWidths=gridWidths.filter(n=>n>0),averageWidth=positiveWidths.length?Math.round(positiveWidths.reduce((a,b)=>a+b,0)/positiveWidths.length):0;
    gridWidths.forEach((width,index)=>{if(!width)gridWidths[index]=averageWidth;});
    if(gridWidths.some(n=>n>0)){
      const colgroup=document.createElement("colgroup");
      gridWidths.forEach(width=>{const col=document.createElement("col");col.style.width=twipsToPx(width)+"px";colgroup.append(col);});
      table.querySelector(":scope > colgroup")?.remove();table.insertBefore(colgroup,table.firstChild);
      table.style.tableLayout="fixed";table.style.width=twipsToPx(gridWidths.reduce((a,b)=>a+b,0))+"px";
    }
    const tblW=xmlKid(tblPr,"tblW");
    if(tblW){
      const width=xmlNumber(tblW,"w"),type=xmlAttr(tblW,"type");
      if(type==="pct"&&width>0){table.style.width=Math.min(100,width/50)+"%";table.dataset.docxWidthType="pct";table.dataset.docxWidth=String(width/50);}
      else if(type==="dxa"&&width>0){table.style.width=twipsToPx(width)+"px";table.dataset.docxWidthType="dxa";table.dataset.docxWidth=String(width);}
    }
    const tableBorders=xmlKid(tblPr,"tblBorders");
    const xmlRows=xmlKids(xmlTable,"tr"),htmlRows=[...table.rows],activeVertical=new Map();
    xmlRows.forEach((xmlRow,rowIndex)=>{
      const row=htmlRows[rowIndex];if(!row)return;
      const trPr=xmlKid(xmlRow,"trPr"),height=xmlKid(trPr,"trHeight");
      if(height&&xmlNumber(height,"val")>0){
        const rawHeight=xmlNumber(height,"val"),rule=xmlAttr(height,"hRule")||"atLeast";
        if(rule!=="auto")row.style.height=twipsToPx(rawHeight)+"px";
        row.dataset.docxHeight=String(rawHeight);
        row.dataset.docxHeightRule=rule;
      }
      if(xmlKid(trPr,"tblHeader"))row.dataset.docxHeader="true";
      if(xmlKid(trPr,"cantSplit"))row.dataset.docxCantSplit="true";
      const xmlCells=xmlKids(xmlRow,"tc"),htmlCells=[...row.cells];let gridIndex=0;
      xmlCells.forEach((xmlCell,cellIndex)=>{
        const cell=htmlCells[cellIndex];if(!cell)return;
        const tcPr=xmlKid(xmlCell,"tcPr"),span=Math.max(1,Math.min(100,xmlNumber(xmlKid(tcPr,"gridSpan"),"val")||1));
        if(span>1)cell.colSpan=span;
        const tcW=xmlKid(tcPr,"tcW");
        if(tcW&&xmlNumber(tcW,"w")>0){
          const cellWidth=xmlNumber(tcW,"w"),widthType=xmlAttr(tcW,"type");
          if(widthType==="dxa")cell.style.width=twipsToPx(cellWidth)+"px";
          else if(widthType==="pct")cell.style.width=Math.min(100,cellWidth/50)+"%";
        }
        const shade=xmlKid(tcPr,"shd"),fill=xmlAttr(shade,"fill");
        if(/^[0-9a-f]{6}$/i.test(fill))cell.style.backgroundColor="#"+fill;
        const valign=xmlAttr(xmlKid(tcPr,"vAlign"),"val");
        if(["top","center","bottom"].includes(valign))cell.style.verticalAlign=valign==="center"?"middle":valign;
        const margins=xmlKid(tcPr,"tcMar");
        ["top","right","bottom","left"].forEach(side=>{const m=xmlKid(margins,side);if(m&&xmlNumber(m,"w")>=0)cell.style["padding"+side[0].toUpperCase()+side.slice(1)]=twipsToPx(xmlNumber(m,"w"))+"px";});
        const borders=xmlKid(tcPr,"tcBorders");
        const isFirstRow=rowIndex===0,isLastRow=rowIndex===xmlRows.length-1;
        const gridTotal=gridWidths.length||Math.max(1,...xmlRows.map(r=>xmlKids(r,"tc").reduce((sum,tc)=>sum+Math.max(1,xmlNumber(xmlKid(xmlKid(tc,"tcPr"),"gridSpan"),"val")||1),0)));
        const borderFallback={
          top:isFirstRow?xmlKid(tableBorders,"top"):xmlKid(tableBorders,"insideH"),
          bottom:isLastRow?xmlKid(tableBorders,"bottom"):xmlKid(tableBorders,"insideH"),
          left:gridIndex===0?xmlKid(tableBorders,"left"):xmlKid(tableBorders,"insideV"),
          right:gridIndex+span>=gridTotal?xmlKid(tableBorders,"right"):xmlKid(tableBorders,"insideV")
        };
        ["top","right","bottom","left"].forEach(side=>setDocxBorder(cell,side,xmlKid(borders,side)||borderFallback[side]));
        const paragraph=xmlKids(xmlCell,"p")[0],jc=xmlAttr(xmlKid(xmlKid(paragraph,"pPr"),"jc"),"val");
        if(jc)cell.style.textAlign=jc==="both"?"justify":jc;
        const merge=xmlKid(tcPr,"vMerge"),mergeValue=xmlAttr(merge,"val");
        if(merge){
          if(!mergeValue||mergeValue==="continue"){
            const start=activeVertical.get(gridIndex);
            if(start){start.rowSpan=(start.rowSpan||1)+1;cell.remove();}
            else activeVertical.set(gridIndex,cell);
          }else{
            for(let col=0;col<span;col++)activeVertical.set(gridIndex+col,cell);
          }
        }else{
          for(let col=0;col<span;col++)activeVertical.delete(gridIndex+col);
        }
        gridIndex+=span;
      });
      restored++;
    });
    table.dataset.docxTable="true";
  });
  return restored;
}
async function importDOCX(file){
  await loadScript(()=>!!window.mammoth,"https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js","Импорт DOCX");
  const bytes=await file.arrayBuffer();
  const result=await window.mammoth.convertToHtml({arrayBuffer:bytes.slice(0)});
  editor.innerHTML=sanitizeImportedHTML(result.value);
  let tableNote="";
  try{
    await loadScript(()=>!!window.JSZip,"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js","чтение структуры таблиц DOCX");
    const zip=await window.JSZip.loadAsync(bytes.slice(0)),documentXml=await zip.file("word/document.xml")?.async("text");
    if(documentXml){const count=restoreDocxTableGeometry(documentXml);tableNote=" Таблиц обработано: "+count+".";if(restoreDocxPageSettings(documentXml))tableNote+=" Размер страницы и поля документа восстановлены."; }
  }catch(error){
    console.warn("Не удалось восстановить геометрию таблиц DOCX:",error);
    tableNote=" Геометрия таблиц не восстановлена: "+error.message;
  }
  const notes=result.messages?.length?(" Замечания импорта Mammoth: "+result.messages.length+"."): "";
  state.format="docx";say("DOCX загружен. Сохранены доступные объединения ячеек, размеры столбцов/строк и оформление таблиц."+tableNote+notes+" Проверьте документ перед экспортом.");
  setProgress(100);
}
async function loadSheetJS(){
  await loadScript(()=>!!window.XLSX,"https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","Импорт/экспорт таблиц");
}
async function importSpreadsheet(file){
  await loadSheetJS();
  const workbook=window.XLSX.read(await file.arrayBuffer(),{type:"array"});
  if(!workbook.SheetNames.length)throw new Error("В файле не найдено листов.");
  const fragment=document.createDocumentFragment();
  let imported=0,empty=0,merged=0;
  workbook.SheetNames.forEach(name=>{
    const sheet=workbook.Sheets[name],ref=sheet["!ref"];
    if(!ref){empty++;return;}
    const range=window.XLSX.utils.decode_range(ref);
    const heading=document.createElement("h3");heading.textContent=name;fragment.append(heading);
    const table=document.createElement("table");table.className="studio-data-table";
    table.dataset.sheetName=name;table.setAttribute("aria-label",name);
    const colgroup=document.createElement("colgroup");
    for(let col=range.s.c;col<=range.e.c;col++){
      const colNode=document.createElement("col"),meta=sheet["!cols"]?.[col];
      const px=Number(meta?.wpx)||((Number(meta?.wch)||Number(meta?.width)||0)*7);
      if(px>0)colNode.style.width=Math.max(12,Math.min(1200,Math.round(px)))+"px";
      colgroup.append(colNode);
    }
    if(colgroup.children.length)table.append(colgroup);
    const merges=sheet["!merges"]||[],covered=new Set(),starts=new Map();
    merges.forEach(m=>{
      if(m.s.r<range.s.r||m.s.c<range.s.c||m.e.r>range.e.r||m.e.c>range.e.c)return;
      starts.set(m.s.r+":"+m.s.c,m);
      for(let r=m.s.r;r<=m.e.r;r++)for(let col=m.s.c;col<=m.e.c;col++)if(r!==m.s.r||col!==m.s.c)covered.add(r+":"+col);
      merged++;
    });
    for(let r=range.s.r;r<=range.e.r;r++){
      const tr=document.createElement("tr"),rowMeta=sheet["!rows"]?.[r];
      const rowPx=Number(rowMeta?.hpx)||((Number(rowMeta?.hpt)||0)*96/72);
      if(rowPx>0)tr.style.height=Math.max(8,Math.min(1000,Math.round(rowPx)) )+"px";
      for(let col=range.s.c;col<=range.e.c;col++){
        if(covered.has(r+":"+col))continue;
        const cellData=sheet[window.XLSX.utils.encode_cell({r,c:col})];
        const cell=document.createElement(r===range.s.r?"th":"td");
        let value="";
        if(cellData){try{value=cellData.w??window.XLSX.utils.format_cell(cellData);}catch{value=cellData.v??"";}}
        cell.textContent=String(value??"");
        if(cellData){
          if(["n","s","str","b","d","e"].includes(cellData.t))cell.dataset.xlsxType=cellData.t;
          if(cellData.v!==undefined&&cellData.v!==null&&["number","string","boolean"].includes(typeof cellData.v))cell.dataset.xlsxValue=String(cellData.v).slice(0,2000);
          if(typeof cellData.f==="string"&&cellData.f.length<=2000)cell.dataset.xlsxFormula=cellData.f;
          if(typeof cellData.z==="string"&&cellData.z.length<=120)cell.dataset.xlsxFormat=cellData.z;
          cell.dataset.xlsxDisplay=String(value??"").slice(0,2000);
        }
        const merge=starts.get(r+":"+col);
        if(merge){if(merge.e.r>merge.s.r)cell.rowSpan=merge.e.r-merge.s.r+1;if(merge.e.c>merge.s.c)cell.colSpan=merge.e.c-merge.s.c+1;}
        tr.append(cell);
      }
      table.append(tr);
    }
    fragment.append(table);imported++;
  });
  if(!imported)throw new Error("Все листы книги пусты.");
  editor.replaceChildren(fragment);state.format="sheet";
  say("Загружено листов: "+imported+". Сохранены объединения ячеек: "+merged+". Ширины столбцов и высоты строк восстановлены там, где они указаны. Формулы и сложное оформление могут отличаться; исходный файл остаётся доступен отдельно."+(empty?" Пустых листов пропущено: "+empty+".":""));
  setProgress(100);
}
async function recognize(){
  const file=state.pendingFile||fileInput.files?.[0];if(!file){say("Сначала выберите документ.");return;}
  setStudioReady(false);setBusy(true);setProgress(0);editor.replaceChildren();state.sourceName=file.name;state.sourceType=file.type;
  const ext=extOf(file);let worker;
  try{
    if(ext==="docx"){say("Импорт DOCX…");await importDOCX(file);}
    else if(["xlsx","xls","csv"].includes(ext)){say("Импорт таблицы…");await importSpreadsheet(file);}
    else if(file.type==="application/pdf"||ext==="pdf"){
      await recognizePDF(file);state.format="text";say("Обработка PDF завершена. Проверьте и отредактируйте извлечённый/распознанный текст.");
    }else if(file.type.startsWith("image/")||["png","jpg","jpeg","webp","gif","bmp","tif","tiff"].includes(ext)){
      worker=await getOCRWorker();say("Распознавание изображения…");
      const text=await recognizeImage(file,worker),p=document.createElement("p");p.textContent=text;editor.append(p);
      state.format="text";setProgress(100);say("Распознавание завершено. Проверьте и отредактируйте текст.");
    }else if(["txt","md","log","json","xml"].includes(ext)||file.type.startsWith("text/")){
      const text=decodeText(await file.arrayBuffer());
      const pre=document.createElement("pre");pre.textContent=text;editor.replaceChildren(pre);
      state.format="text";setProgress(100);say("Текстовый документ открыт. Можно редактировать, сохранять и экспортировать.");
    }else if(["html","htm"].includes(ext)){
      editor.innerHTML=sanitizeImportedHTML(decodeText(await file.arrayBuffer()));
      state.format="html";setProgress(100);say("HTML-документ открыт с безопасной очисткой разметки. Можно редактировать и экспортировать.");
    }else if(["fb2","zip"].includes(ext)){
      let bytes=await file.arrayBuffer();
      if(ext==="zip"||file.name.toLowerCase().endsWith(".fb2.zip")){
        await loadScript(()=>!!window.JSZip,"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js","чтение FB2.ZIP");
        const zip=await window.JSZip.loadAsync(bytes);
        const entry=Object.values(zip.files).find(item=>!item.dir&&/\.fb2$/i.test(item.name));
        if(!entry)throw new Error("В ZIP-архиве не найден файл FB2.");
        bytes=await entry.async("arraybuffer");
      }
      editor.innerHTML=sanitizeImportedHTML(fb2ToHTML(decodeFB2(bytes)));
      state.format="fb2";setProgress(100);say("Книга FB2 открыта. Текст и встроенные иллюстрации доступны для редактирования.");
    }else if(ext==="epub"){
      await loadScript(()=>!!window.JSZip,"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js","чтение EPUB");
      const zip=await window.JSZip.loadAsync(await file.arrayBuffer());
      const container=zip.file("META-INF/container.xml");
      if(!container)throw new Error("В EPUB отсутствует META-INF/container.xml.");
      const containerDoc=new DOMParser().parseFromString(await container.async("string"),"application/xml");
      const opfPath=containerDoc.getElementsByTagNameNS("*","rootfile")[0]?.getAttribute("full-path");
      const opfFile=opfPath&&zip.file(opfPath);
      if(!opfFile)throw new Error("В EPUB не найден файл содержания OPF.");
      const opf=new DOMParser().parseFromString(await opfFile.async("string"),"application/xml");
      const base=opfPath.includes("/")?opfPath.slice(0,opfPath.lastIndexOf("/")+1):"";
      const manifest=new Map([...opf.getElementsByTagNameNS("*","item")].map(item=>[item.getAttribute("id"),item.getAttribute("href")]));
      const spine=[...opf.getElementsByTagNameNS("*","itemref")];
      const fragment=document.createDocumentFragment();let chapters=0;
      for(const item of spine){
        const href=manifest.get(item.getAttribute("idref"));if(!href)continue;
        const path=(base+decodeURIComponent(href.split("#")[0])).split("/").reduce((parts,part)=>{if(!part||part===".")return parts;if(part==="..")parts.pop();else parts.push(part);return parts;},[]).join("/");
        const chapter=zip.file(path);if(!chapter)continue;
        const doc=new DOMParser().parseFromString(await chapter.async("string"),"text/html");
        const content=doc.querySelector("body")||doc.documentElement;
        const section=document.createElement("section");section.className="studio-epub-chapter";
        section.innerHTML=sanitizeImportedHTML(content.innerHTML);fragment.append(section);chapters++;
      }
      if(!chapters)throw new Error("В EPUB не найдены главы для чтения.");
      editor.replaceChildren(fragment);state.format="epub";setProgress(100);say("EPUB открыт: глав загружено "+chapters+". Иллюстрации по внешним путям и сложная вёрстка могут отображаться упрощённо.");
    }else if(ext==="rtf"){
      const raw=decodeText(await file.arrayBuffer());
      const plain=raw.replace(/\\'[0-9a-f]{2}/gi,"").replace(/\\[a-z]+-?\d* ?/gi,"").replace(/[{}]/g,"").replace(/\\\\/g,"\\");
      const pre=document.createElement("pre");pre.textContent=plain;editor.replaceChildren(pre);
      state.format="text";setProgress(100);say("RTF открыт в упрощённом текстовом виде. Исходное форматирование можно сохранить в оригинале.");
    }else throw new Error("Формат не поддерживается для редактирования в Студии. Оригинал можно просмотреть и скачать в первом блоке.");
    setStudioReady(true);
    editor.focus({preventScroll:true});
    $("studioEditor").scrollIntoView({behavior:"smooth",block:"center"});
    say("Документ готов к редактированию. Изменения можно сохранить в библиотеку или скачать в выбранном формате.");
  }catch(error){console.error(error);say("Ошибка: "+error.message);}
  finally{if(worker)try{await worker.terminate();}catch{}setBusy(false);}
}
function cleanEditorHTML({includeOCRText=true}={}){
  const copy=editor.cloneNode(true);
  if(!includeOCRText)copy.querySelectorAll(".studio-ocr-details").forEach(node=>node.remove());
  copy.querySelectorAll("script,iframe,object,embed,form,button,input,textarea,select").forEach(node=>node.remove());
  copy.querySelectorAll("*").forEach(node=>[...node.attributes].forEach(attr=>{
    if(/^on/i.test(attr.name)||((attr.name==="href"||attr.name==="src")&&/^\s*javascript:/i.test(attr.value)))node.removeAttribute(attr.name);
  }));
  return copy.innerHTML;
}
function documentHTML({includeOCRText=true}={}){
  const title=state.sourceName.replace(/\.[^.]+$/,"")||"Новый документ";
  const hasPDFPages=Boolean(editor.querySelector(".studio-pdf-page"));
  const heading=hasPDFPages?"":"<h1>"+escapeHTML(title)+"</h1>";
  const pageStyles=hasPDFPages?".studio-pdf-page{width:210mm;height:297mm;max-width:none;margin:0;padding:8mm;display:flex;align-items:center;justify-content:center;box-sizing:border-box;overflow:hidden;break-after:page;page-break-after:always;border:0;border-radius:0;background:#fff}.studio-pdf-page .studio-source-page-image{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;margin:0}":"html,body{width:auto}body{max-width:850px;margin:40px auto;padding:0 24px}";
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'+escapeHTML(title)+'</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:210mm;max-width:none;background:#fff;color:#222}body{font:12pt/1.55 Georgia,serif}h1,h2{page-break-after:avoid}p{white-space:pre-wrap;margin:0 0 1em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px}img{max-width:100%;height:auto;object-fit:contain}.studio-source-page{break-inside:avoid;page-break-inside:avoid;margin:0 auto 24px;padding:14px;border:1px solid #ddd}.studio-reconstructed-page{break-after:page;page-break-after:always;position:relative;overflow:hidden;margin:0 auto;padding:0;border:0;box-sizing:border-box}.studio-reconstructed-text-layer{position:absolute;left:0;top:0;width:100%;height:100%}.studio-reconstructed-line{display:block;position:absolute;overflow:hidden;white-space:pre}.studio-source-page-image{display:block;width:auto;max-width:100%;height:auto;margin:8px auto 14px}.studio-source-caption{font-size:9pt;color:#666;margin:8px 0 4px}.studio-recognized-text{white-space:pre-wrap;line-height:1.55;padding:10px;border:1px dashed #bbb}.studio-page-break{break-before:page;page-break-before:always;border-top:1px dashed #aaa;margin:24px 0;height:1px;overflow:hidden;color:transparent}@media print{.studio-ocr-details{display:none!important}}'+pageStyles+'</style></head><body>'+heading+cleanEditorHTML({includeOCRText})+'</body></html>';
}
function download(blob,name){
  if(!(blob instanceof Blob)||blob.size===0)throw new Error("Файл пустой — скачивание отменено.");
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;a.rel="noopener";a.style.display="none";
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function getStudioPlainText(){
  const recognized=[...editor.querySelectorAll(".studio-recognized-text")];
  if(recognized.length)return recognized.map(node=>(node.innerText||node.textContent||"").trim()).filter(Boolean).join("\n\n");
  const copy=editor.cloneNode(true);
  copy.querySelectorAll(".studio-ocr-details summary").forEach(node=>node.remove());
  return (copy.innerText||copy.textContent||"").trim();
}
async function refreshSavedRevisions(selectedId=""){
  const select=$("studioSavedRevision");if(!select)return;
  const books=await getAll("books");
  const revisions=books.filter(book=>book.revisionOf||book.revisionSchema===2).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  select.replaceChildren(new Option("Выберите сохранённую редакцию…",""));
  revisions.forEach(book=>select.add(new Option(book.title||book.name||"Редакция",book.id)));
  if(selectedId&&revisions.some(book=>book.id===selectedId))select.value=selectedId;
}
async function loadSavedRevision(){
  const id=$("studioSavedRevision")?.value;if(!id){say("Выберите сохранённую редакцию.");return;}
  const books=await getAll("books"),book=books.find(item=>item.id===id);
  if(!book?.data){say("Не удалось найти содержимое редакции в локальной библиотеке.");return;}
  try{
    const htmlText=typeof book.data==="string"?book.data:new TextDecoder().decode(book.data instanceof ArrayBuffer?book.data:new Uint8Array(book.data));
    const parsed=new DOMParser().parseFromString(htmlText,"text/html");
    editor.innerHTML=sanitizeImportedHTML(parsed.body?.innerHTML||htmlText);
    editor.querySelectorAll(".studio-ocr-details").forEach(node=>{node.open=true;});
    editor.querySelectorAll(".studio-recognized-text").forEach(node=>{node.contentEditable="true";node.spellcheck=true;});
    state.sourceName=book.sourceName||book.revisionOf||book.name||"document.html";
    state.sourceType=book.type||"text/html";state.format=book.format||"docx";
    setStudioReady(true);
    setProgress(100);
    say("Сохранённая редакция открыта. Таблицы и поддерживаемые параметры оформления восстановлены. Можно продолжить редактирование или экспортировать DOCX.");
  }catch(error){console.error(error);say("Не удалось открыть редакцию: "+error.message);}
}
async function saveToLibrary(){
  if(!state.documentReady){say("Сначала откройте документ и дождитесь завершения распознавания.");return;}
  const html=documentHTML(),base=safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document"),name=base+"-редакция.html";
  const id=crypto.randomUUID?.()||String(Date.now());
  await put("books",{id,name,title:(state.sourceName.replace(/\.[^.]+$/,"")||"Документ")+" — редакция",author:"",ext:"html",type:"text/html",data:new TextEncoder().encode(html).buffer,addedAt:Date.now(),favorite:false,sourceName:state.sourceName,revisionOf:state.sourceName,format:state.format,revisionSchema:2});
  await refreshSavedRevisions(id);
  say("Новая HTML-редакция добавлена в библиотеку и доступна для повторного открытия. Исходный файл не изменён.");
  download(new Blob([html],{type:"text/html;charset=utf-8"}),name);
}
function printPDF(){
  if(!state.documentReady){say("Сначала откройте документ и дождитесь завершения обработки.");return;}
  const html=documentHTML({includeOCRText:false});
  let w=window.open("about:blank","_blank");
  const printInWindow=target=>{
    let started=false;
    const runPrint=async()=>{
      if(started)return;started=true;
      try{
        await Promise.all([...target.document.images].map(image=>image.decode?image.decode().catch(()=>{}):Promise.resolve()));
        if(target.document.fonts?.ready)await target.document.fonts.ready;
        target.focus();setTimeout(()=>{try{target.print();}catch(error){say("Не удалось открыть печать: "+error.message);}},250);
      }catch(error){say("Не удалось подготовить документ к печати: "+error.message);}
    };
    target.addEventListener("load",runPrint,{once:true});
    target.document.open();target.document.write(html);target.document.close();
    setTimeout(()=>{if(!started)runPrint();},1200);
  };
  if(w){printInWindow(w);return;}
  say("Окно печати заблокировано. Открываем встроенную печать…");
  const frame=document.createElement("iframe");
  frame.title="Печать документа";frame.style.cssText="position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:.01";
  document.body.append(frame);
  frame.onload=async()=>{
    try{
      await Promise.all([...frame.contentDocument.images].map(image=>image.decode?image.decode().catch(()=>{}):Promise.resolve()));
      frame.contentWindow.focus();frame.contentWindow.print();
    }catch(error){say("Не удалось открыть печать: "+error.message);}
  };
  frame.srcdoc=html;
}
async function exportPDFDownload(){
  if(!state.documentReady){say("Сначала откройте документ и дождитесь завершения обработки.");return;}
  const base=safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document");
  const scanPages=[...editor.querySelectorAll(".studio-pdf-page")];
  let blob;
  if(scanPages.length){
    await loadScript(()=>!!window.jspdf?.jsPDF,"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js","PDF export");
    const pdf=new window.jspdf.jsPDF({unit:"mm",format:"a4",orientation:"portrait",compress:true});
    for(let index=0;index<scanPages.length;index++){
      const image=scanPages[index].querySelector(".studio-source-page-image");
      if(!image)throw new Error("Не найдена исходная страница PDF №"+(index+1)+".");
      if(image.decode)await image.decode();
      if(!image.naturalWidth||!image.naturalHeight)throw new Error("Не удалось загрузить изображение страницы №"+(index+1)+".");
      if(index)pdf.addPage("a4","portrait");
      const scale=Math.min(210/image.naturalWidth,297/image.naturalHeight);
      const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
      pdf.addImage(image.src,"JPEG",(210-width)/2,(297-height)/2,width,height,undefined,"FAST");
    }
    blob=pdf.output("blob");
  }else{
    await loadScript(()=>!!window.html2pdf,"https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.3/html2pdf.bundle.min.js","PDF export");
    const frame=document.createElement("iframe");
    frame.setAttribute("aria-hidden","true");
    frame.style.cssText="position:fixed;left:-12000px;top:0;width:900px;height:1200px;border:0;opacity:0;pointer-events:none";
    document.body.append(frame);
    try{
      const html=documentHTML();
      await new Promise((resolve,reject)=>{
        frame.onload=resolve;frame.onerror=()=>reject(new Error("Не удалось подготовить страницу для PDF."));
        frame.srcdoc=html;
      });
      const doc=frame.contentDocument;
      if(!doc?.body)throw new Error("Не удалось прочитать подготовленную редакцию.");
      if(doc.fonts?.ready)await doc.fonts.ready;
      await Promise.all([...doc.images].map(img=>img.decode?img.decode().catch(()=>{}):Promise.resolve()));
      blob=await window.html2pdf().set({
        margin:[12,12,14,12],filename:base+"-редакция.pdf",
        image:{type:"jpeg",quality:0.96},
        html2canvas:{scale:1.5,useCORS:true,backgroundColor:"#ffffff",logging:false},
        jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},
        pagebreak:{mode:["css","legacy"],avoid:".studio-pdf-page"}
      }).from(doc.body).outputPdf("blob");
    }finally{frame.remove();}
  }
  if(!(blob instanceof Blob)||blob.size<1000)throw new Error("PDF получился пустым или повреждённым. Скачивание отменено.");
  const name=base+"-редакция.pdf",id=crypto.randomUUID?.()||String(Date.now());
  await put("books",{id,name,title:(state.sourceName.replace(/\.[^.]+$/,"")||"Документ")+" — PDF-редакция",author:"",ext:"pdf",type:"application/pdf",data:await blob.arrayBuffer(),addedAt:Date.now(),favorite:false,sourceName:state.sourceName,revisionOf:state.sourceName,revisionKind:"pdf-export",generatedFrom:"document-studio"});
  download(blob,name);
  say(scanPages.length?"PDF создан из "+scanPages.length+" исходных страниц, проверен на наличие содержимого и скачан.":"PDF-редакция создана и скачана. Оригинал не изменён.");
}
function exportText(){
  const text=getStudioPlainText();
  if(!text){say("В документе пока нет текста для TXT. Для сканированного PDF сначала выполните OCR.");return;}
  download(new Blob([text],{type:"text/plain;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-текст.txt");
}
let savedEditorRange=null;
document.addEventListener("selectionchange",()=>{
  const selection=window.getSelection();
  if(selection?.rangeCount&&editor.contains(selection.anchorNode))savedEditorRange=selection.getRangeAt(0).cloneRange();
});
function restoreEditorSelection(){
  editor.focus();
  if(!savedEditorRange)return;
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(savedEditorRange);
}
function insertCommand(command,value=null){restoreEditorSelection();document.execCommand(command,false,value);}
function currentTableCell(){
  restoreEditorSelection();
  const selection=window.getSelection();let node=selection?.anchorNode;
  if(node?.nodeType===Node.TEXT_NODE)node=node.parentElement;
  const cell=node?.closest?.("td,th");
  return cell&&editor.contains(cell)?cell:null;
}
function insertStudioTable(){
  restoreEditorSelection();
  const table=document.createElement("table");table.className="studio-data-table";
  for(let r=0;r<3;r++){const row=table.insertRow();for(let c=0;c<3;c++){const cell=document.createElement(r===0?"th":"td");cell.textContent=r===0?"Заголовок":"";row.append(cell);}}
  const range=savedEditorRange;
  if(range&&editor.contains(range.commonAncestorContainer)){
    const node=range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer.parentElement:range.startContainer;
    const block=node.closest?.("p,div,table,h1,h2,h3,h4,ul,ol,blockquote,pre");
    if(block&&block!==editor)block.after(table);else editor.append(table);
  }else editor.append(table);
  const first=table.rows[0]?.cells[0];
  if(first){const nextRange=document.createRange();nextRange.selectNodeContents(first);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(nextRange);savedEditorRange=nextRange.cloneRange();}
  say("Добавлена таблица 3×3. Щёлкните по ячейке, чтобы редактировать её.");
}
function insertStudioPageBreak(){
  restoreEditorSelection();
  const marker=document.createElement("div");marker.className="studio-page-break";marker.dataset.pageBreak="true";marker.contentEditable="false";marker.textContent="Разрыв страницы";
  const range=savedEditorRange;
  if(range&&editor.contains(range.commonAncestorContainer)){
    const node=range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer.parentElement:range.startContainer;
    const block=node.closest?.("p,div,h1,h2,h3,h4,ul,ol,blockquote,pre");
    if(block&&block!==editor)block.after(marker);else editor.append(marker);
  }else editor.append(marker);
  const p=document.createElement("p");p.innerHTML="<br>";marker.after(p);
  const nextRange=document.createRange();nextRange.selectNodeContents(p);nextRange.collapse(true);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(nextRange);savedEditorRange=nextRange.cloneRange();
  say("Добавлен разрыв страницы. Он сохранится в DOCX и при печати в PDF.");
}
function modifyStudioTable(action){
  const cell=currentTableCell();if(!cell){say("Поставьте курсор внутрь ячейки таблицы.");return;}
  const row=cell.parentElement,table=cell.closest("table"),index=cell.cellIndex;
  if(table.querySelector('td[rowspan]:not([rowspan="1"]),th[rowspan]:not([rowspan="1"]),td[colspan]:not([colspan="1"]),th[colspan]:not([colspan="1"])')){
    say("В этой таблице есть объединённые ячейки. Чтобы не нарушить их структуру, добавление и удаление строк/столбцов пока отключено. Текст и оформление ячеек редактировать можно.");
    return;
  }
  if(action==="addRow"){
    const newRow=table.insertRow(row.rowIndex+1);
    [...row.cells].forEach(()=>newRow.insertCell());
  }else if(action==="addColumn"){
    [...table.rows].forEach(r=>r.insertCell(index+1));
  }else if(action==="deleteRow"){
    if(table.rows.length<=1){table.remove();say("Таблица удалена: в ней не осталось строк.");return;}
    table.deleteRow(row.rowIndex);
  }else if(action==="deleteColumn"){
    if(row.cells.length<=1){table.remove();say("Таблица удалена: в ней не осталось столбцов.");return;}
    [...table.rows].forEach(r=>r.cells[index]?.remove());
  }
  say("Структура таблицы обновлена. Изменения войдут в экспорт.");
}
function htmlRuns(node,TextRun,ImageRun){
  const runs=[];
  function imageBytes(dataUrl){
    const match=String(dataUrl||"").match(/^data:image\/(png|jpeg|gif);base64,([a-z0-9+/=]+)$/i);
    if(!match)return null;
    try{return Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{return null;}
  }
  function walk(n,style={}){
    if(n.nodeType===Node.TEXT_NODE){
      if(n.nodeValue)runs.push(new TextRun({text:n.nodeValue,bold:!!style.bold,italics:!!style.italics,underline:style.underline?{}:undefined,strike:!!style.strike,superScript:!!style.superScript,subScript:!!style.subScript,font:style.font||undefined,size:style.size||undefined,color:style.color||undefined,highlight:style.highlight||undefined}));
      return;
    }
    if(n.nodeType!==Node.ELEMENT_NODE)return;
    if(n.tagName==="IMG"){
      const data=imageBytes(n.getAttribute("src"));
      if(data){
        const rawW=Number(n.getAttribute("width"))||n.naturalWidth||450,rawH=Number(n.getAttribute("height"))||n.naturalHeight||300;
        const factor=Math.min(1,600/Math.max(rawW,rawH));
        runs.push(new ImageRun({data,transformation:{width:Math.max(1,Math.round(rawW*factor)),height:Math.max(1,Math.round(rawH*factor))}}));
      }
      return;
    }
    const css=n.style||{},fontSizeMap={"1":16,"2":18,"3":20,"4":24,"5":32,"6":48,"7":72};
    const px=parseFloat(css.fontSize||""),fontColor=n.getAttribute?.("color");
    const color=(css.color||fontColor||"").match(/#([0-9a-f]{6})/i)?.[1]?.toUpperCase();
    const bg=(css.backgroundColor||"").match(/#([0-9a-f]{6})/i)?.[1]?.toUpperCase(),htmlSize=n.getAttribute?.("size");
    const next={bold:style.bold||["B","STRONG"].includes(n.tagName)||css.fontWeight==="bold"||Number(css.fontWeight)>=600,
      italics:style.italics||["I","EM"].includes(n.tagName)||css.fontStyle==="italic",
      underline:style.underline||n.tagName==="U"||(css.textDecoration||"").includes("underline"),
      strike:style.strike||n.tagName==="S"||n.tagName==="DEL"||(css.textDecoration||"").includes("line-through"),
      superScript:style.superScript||n.tagName==="SUP",subScript:style.subScript||n.tagName==="SUB",
      font:(css.fontFamily||n.getAttribute?.("face"))?.split(",")[0]?.replace(/["']/g,"")||style.font,
      size:px?Math.max(1,Math.min(144,Math.round(px*1.5))):(fontSizeMap[htmlSize]||style.size),color:color||style.color,highlight:bg||style.highlight};
    n.childNodes.forEach(child=>walk(child,next));
    if(n.tagName==="BR")runs.push(new TextRun({text:"\n"}));
  }
  walk(node);return runs.length?runs:[new TextRun({text:""})];
}
async function exportDOCX(){
  if(!getStudioPlainText()){say("Сначала загрузите документ и выполните распознавание текста.");return;}
  say("Подготовка DOCX…");
  const d=await import("https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm");
  const {Document,Packer,Paragraph,TextRun,ImageRun,PageBreak,HeadingLevel,Table,TableRow,TableCell,WidthType,AlignmentType,ShadingType,BorderStyle,HeightRule}=d;
  const children=[];
  const defaultBorders={top:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"},bottom:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"},left:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"},right:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"}};
  function blockAlignment(node){
    const align=node.style?.textAlign;
    return align==="center"?AlignmentType.CENTER:align==="right"?AlignmentType.RIGHT:align==="justify"?AlignmentType.JUSTIFIED:AlignmentType.LEFT;
  }
  function cssColor(value){
    const hex=String(value||"").match(/#([0-9a-f]{6})/i)?.[1];if(hex)return hex.toUpperCase();
    const rgb=String(value||"").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return rgb?[...rgb.slice(1,4)].map(v=>Number(v).toString(16).padStart(2,"0")).join("").toUpperCase():null;
  }
  function docxBorder(value){
    if(!value)return null;
    if(value==="none"||value==="hidden")return {style:BorderStyle.NONE,size:0,color:"FFFFFF"};
    const match=String(value).match(/(\d+(?:\.\d+)?)px\s+(solid|double|dotted|dashed)\s+(.+)/i);
    if(!match)return null;
    const style=match[2].toLowerCase()==="double"?BorderStyle.DOUBLE:match[2].toLowerCase()==="dotted"?BorderStyle.DOTTED:match[2].toLowerCase()==="dashed"?BorderStyle.DASHED:BorderStyle.SINGLE;
    return {style,size:Math.max(2,Math.min(24,Math.round(Number(match[1])*6))),color:cssColor(match[3])||"A0A0A0"};
  }
  function cellBorders(cell,isImported){
    const out={};
    [["top","Top"],["right","Right"],["bottom","Bottom"],["left","Left"]].forEach(([key,cap])=>{
      const border=docxBorder(cell.style["border"+cap]||cell.style.border);
      if(border)out[key]=border;
    });
    return Object.keys(out).length?out:(isImported?{}:defaultBorders);
  }
  function cellMargins(cell){
    const px=(side,fallback)=>{const v=parseFloat(cell.style["padding"+side]||cell.style.padding||"");return Number.isFinite(v)?Math.max(0,Math.min(80,Math.round(v*15))):fallback;};
    return {top:px("Top",80),right:px("Right",100),bottom:px("Bottom",80),left:px("Left",100)};
  }
  function addBlock(node){
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    if(node.classList?.contains("studio-docx-page-settings"))return;
    if(node.classList?.contains("studio-pdf-page"))return;
    if(node.classList?.contains("studio-ocr-details")){
      const recognized=node.querySelector(".studio-recognized-text");
      if(recognized)children.push(new Paragraph({children:htmlRuns(recognized,TextRun,ImageRun)}));
      return;
    }
    if(node.dataset?.pageBreak==="true"){children.push(new Paragraph({children:[new PageBreak()]}));return;}
    if(node.tagName==="TABLE"){
      const colgroup=node.querySelector(":scope > colgroup");
      const gridWidths=colgroup?[...colgroup.children].map(col=>Math.round((parseFloat(col.style.width)||0)*15)): [];
      const rows=[...node.rows].map(row=>{
        const rowHeight=parseFloat(row.style.height||row.style.minHeight||""),storedRowHeight=Number(row.dataset.docxHeight)||0;
        const rowOptions={children:[...row.cells].map(cell=>{
          const bg=cssColor(cell.style.backgroundColor);
          const cellBlocks=[...cell.children].filter(child=>["P","DIV","PRE"].includes(child.tagName));
          const cellParagraphs=cellBlocks.length?cellBlocks.map(block=>{
            const paragraphOptions={children:htmlRuns(block,TextRun,ImageRun),alignment:blockAlignment(block)};
            const before=parseFloat(block.style?.marginTop||""),after=parseFloat(block.style?.marginBottom||"");
            const spacing={};
            if(Number.isFinite(before)&&before>0)spacing.before=Math.min(1200,Math.round(before*15));
            if(Number.isFinite(after)&&after>0)spacing.after=Math.min(1200,Math.round(after*15));
            if(Object.keys(spacing).length)paragraphOptions.spacing=spacing;
            return new Paragraph(paragraphOptions);
          }):[new Paragraph({children:htmlRuns(cell,TextRun,ImageRun),alignment:blockAlignment(cell)})];
          const cellOptions={
            children:cellParagraphs,
            borders:cellBorders(cell,node.dataset.docxTable==="true"),margins:cellMargins(cell),
            verticalAlign:cell.style.verticalAlign==="middle"?"center":(cell.style.verticalAlign||"top")
          };
          if(cell.colSpan>1)cellOptions.columnSpan=cell.colSpan;
          if(cell.rowSpan>1)cellOptions.rowSpan=cell.rowSpan;
          if(bg)cellOptions.shading={fill:bg,type:ShadingType.CLEAR};
          const cellWidthValue=cell.style.width||"",cellWidth=parseFloat(cellWidthValue);
          if(cellWidth>0)cellOptions.width=cellWidthValue.includes("%")?{size:Math.min(100,cellWidth),type:WidthType.PERCENTAGE}:{size:Math.round(cellWidth*15),type:WidthType.DXA};
          return new TableCell(cellOptions);
        })};
        if(storedRowHeight>0||rowHeight>0){const rule=row.dataset.docxHeightRule;rowOptions.height={value:storedRowHeight||Math.round(rowHeight*15),rule:rule==="exact"?HeightRule.EXACT:rule==="auto"?HeightRule.AUTO:HeightRule.ATLEAST};}
        if(row.dataset.docxCantSplit==="true")rowOptions.cantSplit=true;
        if(row.dataset.docxHeader==="true")rowOptions.tableHeader=true;
        return new TableRow(rowOptions);
      });
      if(rows.length){
        const totalWidth=gridWidths.length?gridWidths.reduce((a,b)=>a+b,0):0;
        const isImported=node.dataset.docxTable==="true";
        const storedWidth=Number(node.dataset.docxWidth)||0,storedType=node.dataset.docxWidthType;
        const tableWidth=storedWidth&&storedType==="pct"?{size:Math.min(5000,storedWidth),type:WidthType.PERCENTAGE}:storedWidth&&storedType==="dxa"?{size:storedWidth,type:WidthType.DXA}:totalWidth?{size:totalWidth,type:WidthType.DXA}:{size:100,type:WidthType.PERCENTAGE};
        const tableOptions={rows,width:tableWidth,borders:isImported?{}:defaultBorders};
        if(gridWidths.length)tableOptions.columnWidths=gridWidths;
        children.push(new Table(tableOptions));
      }
    }else if(["P","DIV","H1","H2","H3","H4","LI","BLOCKQUOTE","PRE"].includes(node.tagName)){
      const opts={children:htmlRuns(node,TextRun,ImageRun),alignment:blockAlignment(node)};
      if(node.tagName==="H1")opts.heading=HeadingLevel.HEADING_1;
      if(node.tagName==="H2")opts.heading=HeadingLevel.HEADING_2;
      if(node.tagName==="H3"||node.tagName==="H4")opts.heading=HeadingLevel.HEADING_3;
      if(node.tagName==="LI")opts.bullet={indent:360};
      if(node.tagName==="BLOCKQUOTE")opts.indent={left:360};
      const marginBottom=parseFloat(node.style?.marginBottom||"");
      const marginTop=parseFloat(node.style?.marginTop||"");
      const indentLeft=parseFloat(node.style?.marginLeft||"");
      const indentRight=parseFloat(node.style?.marginRight||"");
      const firstLine=parseFloat(node.style?.textIndent||"");
      const lineHeight=parseFloat(node.style?.lineHeight||"");
      const spacing={};
      if(Number.isFinite(marginBottom)&&marginBottom>0)spacing.after=Math.min(1200,Math.round(marginBottom*15));
      if(Number.isFinite(marginTop)&&marginTop>0)spacing.before=Math.min(1200,Math.round(marginTop*15));
      if(Number.isFinite(lineHeight)&&lineHeight>0)spacing.line=Math.min(2400,Math.max(120,Math.round(lineHeight*240)));
      if(Object.keys(spacing).length)opts.spacing=spacing;
      if((Number.isFinite(indentLeft)&&indentLeft>0)||(Number.isFinite(indentRight)&&indentRight>0)||(Number.isFinite(firstLine)&&firstLine!==0))opts.indent={...(indentLeft>0?{left:Math.round(indentLeft*15)}:{}),...(indentRight>0?{right:Math.round(indentRight*15)}:{}),...(Number.isFinite(firstLine)&&firstLine!==0?{firstLine:Math.round(firstLine*15)}:{})};
      children.push(new Paragraph(opts));
    }else [...node.children].forEach(addBlock);
  }
  [...editor.children].forEach(addBlock);
  if(!children.length)children.push(new Paragraph({text:editor.innerText}));
  const page=readDocxPageSettings();
  const doc=new Document({sections:[{properties:{page:{size:{width:page.width,height:page.height},margin:{top:page.top,right:page.right,bottom:page.bottom,left:page.left,header:page.header,footer:page.footer}}},children}]});
  const blob=await Packer.toBlob(doc);
  download(blob,safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-редакция.docx");
  say("DOCX создан. Перенесены объединённые ячейки, размеры столбцов и строк, заливка, границы, отступы и вертикальное выравнивание таблиц, а также текст и встроенные изображения. Проверьте итоговый файл: сложные вложенные таблицы и нестандартные стили могут отличаться.");
}
async function exportXLSX(){
  const tables=[...editor.querySelectorAll("table")];
  if(!tables.length){say("В редакторе нет таблиц для экспорта XLSX.");return;}
  await loadSheetJS();
  const workbook=window.XLSX.utils.book_new();
  tables.forEach((table,index)=>{
    const sheet=window.XLSX.utils.table_to_sheet(table,{raw:true});
    // Restore original cell types, number formats and formulas only when displayed content is unchanged.
    const occupied=new Set();
    [...table.rows].forEach((row,r)=>{
      let col=0;
      [...row.cells].forEach(cell=>{
        while(occupied.has(r+":"+col))col++;
        const rowSpan=Math.max(1,cell.rowSpan||1),colSpan=Math.max(1,cell.colSpan||1);
        const unchanged=cell.dataset.xlsxDisplay!==undefined&&cell.textContent===cell.dataset.xlsxDisplay;
        if(unchanged){
          const address=window.XLSX.utils.encode_cell({r,c:col}),target=sheet[address];
          if(target){
            const type=cell.dataset.xlsxType,value=cell.dataset.xlsxValue,formula=cell.dataset.xlsxFormula,format=cell.dataset.xlsxFormat;
            if(value!==undefined&&type){
              if(type==="n"&&value.trim()!==""&&Number.isFinite(Number(value))){target.v=Number(value);target.t="n";}
              else if(type==="b"){target.v=value==="true"||value==="1";target.t="b";}
              else if(type==="d"){const date=new Date(value);if(!Number.isNaN(date.getTime())){target.v=date;target.t="d";}}
              else if(["s","str"].includes(type)){target.v=value;target.t=type;}
              else if(type==="e"){target.v=value;target.t="e";}
            }
            if(formula!==undefined)target.f=formula;
            if(format!==undefined)target.z=format;
          }
        }
        for(let rr=r;rr<r+rowSpan;rr++)for(let cc=col;cc<col+colSpan;cc++)if(rr!==r||cc!==col)occupied.add(rr+":"+cc);
        col+=colSpan;
      });
    });
    const cols=[...table.querySelectorAll(":scope > colgroup > col")];
    if(cols.length)sheet["!cols"]=cols.map(col=>{
      const px=parseFloat(col.style.width||"");
      return Number.isFinite(px)&&px>0?{wpx:Math.max(12,Math.min(1200,Math.round(px)))}:{};
    });
    const rows=[...table.rows];
    if(rows.some(row=>parseFloat(row.style.height||"")>0))sheet["!rows"]=rows.map(row=>{
      const px=parseFloat(row.style.height||"");
      return Number.isFinite(px)&&px>0?{hpx:Math.max(8,Math.min(1000,Math.round(px)))}:{};
    });
    let name=table.dataset.sheetName||table.getAttribute("aria-label")||"Таблица "+(index+1);
    name=String(name).replace(/[\\\\/?*:[\\]]/g," ").trim().slice(0,31)||"Лист "+(index+1);
    let unique=name,suffix=2;
    while(workbook.SheetNames.includes(unique)){
      const tail=" ("+suffix+++ ")";
      unique=name.slice(0,31-tail.length)+tail;
    }
    window.XLSX.utils.book_append_sheet(workbook,sheet,unique);
  });
  window.XLSX.writeFile(workbook,safeName(state.sourceName.replace(/\.[^.]+$/,"")||"таблица")+"-редакция.xlsx");
  say("XLSX создан: "+tables.length+" листов. Сохранены данные, объединения ячеек и доступные размеры столбцов/строк. Формулы, стили и сложные настройки проверьте в Excel.");
}
async function exportSelectedFormat(formatOverride){
  if(!state.documentReady){say("Сначала откройте документ и дождитесь завершения обработки.");return;}
  const format=formatOverride||"pdf";
  try{
    if(format==="pdf"){await exportPDFDownload();return;}
    if(format==="docx"){await exportDOCX();return;}
    if(format==="xlsx"){await exportXLSX();return;}
    if(format==="txt"){exportText();return;}
    if(format==="html"){
      download(new Blob([documentHTML()],{type:"text/html;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-редакция.html");
      say("HTML-копия редакции подготовлена.");
      return;
    }
    say("Выберите формат сохранения.");
  }catch(error){
    console.error("Export:",error);
    say("Не удалось подготовить файл: "+error.message);
  }
}
const studioExportToggle=$("studioExportToggle"),studioFormatPanel=$("studioFormatPanel");
studioExportToggle?.addEventListener("click",()=>{
  if(!state.documentReady){say("Сначала откройте документ и дождитесь завершения обработки.");return;}
  studioFormatPanel.hidden=!studioFormatPanel.hidden;
  studioExportToggle.setAttribute("aria-expanded",String(!studioFormatPanel.hidden));
});
studioFormatPanel?.addEventListener("click",event=>{
  const button=event.target.closest("[data-export-format]");if(!button)return;
  studioFormatPanel.hidden=true;studioExportToggle.setAttribute("aria-expanded","false");
  exportSelectedFormat(button.dataset.exportFormat);
});
$("studioRecognize").addEventListener("click",recognize);
$("studioSave").addEventListener("click",()=>saveToLibrary().catch(e=>say("Не удалось сохранить: "+e.message)));
$("studioLoadRevision").addEventListener("click",()=>loadSavedRevision());
$("studioPrintPDF")?.addEventListener("click",printPDF);
$("studioBold").addEventListener("click",()=>insertCommand("bold"));
$("studioAlignLeft").addEventListener("click",()=>insertCommand("justifyLeft"));
$("studioAlignCenter").addEventListener("click",()=>insertCommand("justifyCenter"));
$("studioAlignRight").addEventListener("click",()=>insertCommand("justifyRight"));
$("studioAlignJustify").addEventListener("click",()=>insertCommand("justifyFull"));
$("studioBullet").addEventListener("click",()=>insertCommand("insertUnorderedList"));
$("studioNumber").addEventListener("click",()=>insertCommand("insertOrderedList"));
$("studioFont").addEventListener("change",e=>insertCommand("fontName",e.target.value));
$("studioFontSize").addEventListener("change",e=>insertCommand("fontSize",e.target.value));
$("studioTextColor").addEventListener("input",e=>insertCommand("foreColor",e.target.value));
$("studioHighlight").addEventListener("input",e=>insertCommand("hiliteColor",e.target.value));
$("studioInsertTable").addEventListener("click",insertStudioTable);
$("studioPageBreak").addEventListener("click",insertStudioPageBreak);
$("studioAddRow").addEventListener("click",()=>modifyStudioTable("addRow"));
$("studioAddColumn").addEventListener("click",()=>modifyStudioTable("addColumn"));
$("studioDeleteRow").addEventListener("click",()=>modifyStudioTable("deleteRow"));
$("studioDeleteColumn").addEventListener("click",()=>modifyStudioTable("deleteColumn"));

$("studioItalic").addEventListener("click",()=>insertCommand("italic"));
$("studioH2").addEventListener("click",()=>insertCommand("formatBlock","h2"));
$("studioParagraph").addEventListener("click",()=>insertCommand("formatBlock","p"));
$("studioUndo").addEventListener("click",()=>insertCommand("undo"));
$("studioRedo").addEventListener("click",()=>insertCommand("redo"));
$("studioClear").addEventListener("click",()=>{if(confirm("Очистить рабочее поле?"))editor.replaceChildren();});
$("openStudioBtn").addEventListener("click",()=>{$("libraryView").classList.add("hidden");$("readerView").classList.add("hidden");$("documentStudioView").classList.remove("hidden");document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));$("openStudioBtn").classList.add("active");refreshSavedRevisions().catch(e=>say("Не удалось загрузить список редакций: "+e.message));});
$("studioBack").addEventListener("click",()=>{$("documentStudioView").classList.add("hidden");$("libraryView").classList.remove("hidden");$("openStudioBtn").classList.remove("active");});
fileInput.addEventListener("change",()=>{const f=fileInput.files?.[0];if(f){state.pendingFile=f;setStudioReady(false);state.sourceName=f.name;say("Выбран файл: "+f.name+". Нажмите «Открыть документ / распознать».");}});