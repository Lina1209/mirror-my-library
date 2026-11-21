import { put, getAll } from "./db.js";

const $ = id => document.getElementById(id);
const state = { sourceName:"", sourceType:"", busy:false, format:"text" };
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
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  studioPreview.pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
  studioPreview.page=1;previewControls.hidden=false;await previewRenderPDF();
  previewSay("PDF · "+studioPreview.pdf.numPages+" страниц · оригинал отображается без OCR.");
}
async function previewRenderPDF(){
  if(!studioPreview.pdf)return;
  const page=await studioPreview.pdf.getPage(studioPreview.page),base=page.getViewport({scale:1});
  const surfaceW=Math.max(300,previewSurface.clientWidth-24);
  const zoom=studioPreview.zoom==="fit"?Math.min(1.6,surfaceW/base.width):Number(studioPreview.zoom);
  const viewport=page.getViewport({scale:zoom}),canvas=document.createElement("canvas"),ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(viewport.width*ratio);canvas.height=Math.round(viewport.height*ratio);
  canvas.style.width=Math.round(viewport.width)+"px";canvas.style.height=Math.round(viewport.height)+"px";
  await page.render({canvasContext:canvas.getContext("2d"),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
  previewSurface.replaceChildren(canvas);previewSetPageLabel();
  $("studioPreviewPrev").disabled=studioPreview.page<=1;$("studioPreviewNext").disabled=studioPreview.page>=studioPreview.pdf.numPages;
}
async function openStudioPreview(file){
  if(!file)return;
  studioPreview.file=file;studioPreview.pdf=null;studioPreview.page=1;studioPreview.zoom=previewZoom.value;
  previewDownload.disabled=false;previewControls.hidden=true;previewSurface.replaceChildren();previewSay("Открываем "+file.name+"…");
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
      const pre=document.createElement("pre");pre.className="studio-preview-text";pre.textContent=await file.text();previewSurface.replaceChildren(pre);previewSay(file.name+" · текстовый просмотр");return;
    }
    if(["html","htm"].includes(ext)){
      const content=sanitizeImportedHTML(await file.text()),frame=document.createElement("iframe");frame.className="studio-preview-frame";frame.setAttribute("sandbox","");frame.srcdoc=content;previewSurface.replaceChildren(frame);previewSay(file.name+" · безопасный HTML-предпросмотр");return;
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
$("studioPreviewOpen")?.addEventListener("click",()=>openStudioPreview($("studioPreviewFile").files?.[0]));
$("studioPreviewFile")?.addEventListener("change",event=>{const file=event.target.files?.[0];if(file)openStudioPreview(file);});
$("studioFile")?.addEventListener("change",event=>{const file=event.target.files?.[0];if(file)openStudioPreview(file);});
previewDownload?.addEventListener("click",previewDownloadOriginal);
$("studioPreviewPrev")?.addEventListener("click",()=>{if(studioPreview.pdf&&studioPreview.page>1){studioPreview.page--;previewRenderPDF();}});
$("studioPreviewNext")?.addEventListener("click",()=>{if(studioPreview.pdf&&studioPreview.page<studioPreview.pdf.numPages){studioPreview.page++;previewRenderPDF();}});
previewZoom?.addEventListener("change",()=>{studioPreview.zoom=previewZoom.value;if(studioPreview.pdf)previewRenderPDF();else{const img=previewSurface.querySelector("img");if(img)img.style.maxWidth=studioPreview.zoom==="fit"?"100%":(Number(studioPreview.zoom)*100)+"%";}});
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
    say("Обработка PDF: страница "+n+" из "+pdf.numPages+" — сохраняем исходный вид и извлекаем текст…");
    const page=await pdf.getPage(n);
    const textContent=await page.getTextContent();
    // Восстанавливаем строки по вертикальным координатам PDF, а не склеиваем всю страницу в одну строку.
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

    // Встраиваем изображение исходной страницы: иллюстрации, таблицы и расположение остаются видимыми в редакции.
    const base=page.getViewport({scale:1});
    const previewScale=Math.min(1.45,1800/Math.max(base.width,base.height));
    const previewViewport=page.getViewport({scale:previewScale});
    const canvas=document.createElement("canvas");
    canvas.width=Math.ceil(previewViewport.width);canvas.height=Math.ceil(previewViewport.height);
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    await page.render({canvasContext:ctx,viewport:previewViewport}).promise;
    const pageImage=document.createElement("img");
    pageImage.className="studio-source-page-image";
    pageImage.alt="Оригинальный вид страницы "+n+" из PDF";
    pageImage.src=canvas.toDataURL("image/jpeg",0.86);
    canvas.width=canvas.height=0;

    if(extracted.length<25){
      say("Страница "+n+" из "+pdf.numPages+": распознаём текст по изображению…");
      const ocrCanvas=document.createElement("canvas");
      const ocrScale=Math.max(1,Math.min(2,2600/Math.max(base.width,base.height)));
      const ocrViewport=page.getViewport({scale:ocrScale});
      ocrCanvas.width=Math.ceil(ocrViewport.width);ocrCanvas.height=Math.ceil(ocrViewport.height);
      await page.render({canvasContext:ocrCanvas.getContext("2d",{willReadFrequently:true}),viewport:ocrViewport}).promise;
      const recognized=await worker.recognize(ocrCanvas);
      extracted=recognized.data.text||"";
      ocrCanvas.width=ocrCanvas.height=0;
    }

    const pageBlock=document.createElement("div");
    pageBlock.className="studio-source-page";
    const heading=document.createElement("h2");heading.textContent="Страница "+n;
    const imageCaption=document.createElement("p");imageCaption.className="studio-source-caption";imageCaption.textContent="Оригинальный вид страницы";
    const textCaption=document.createElement("p");textCaption.className="studio-source-caption";textCaption.textContent="Извлечённый текст — можно редактировать";
    const textBlock=document.createElement("div");textBlock.className="studio-recognized-text";textBlock.contentEditable="true";
    textBlock.textContent=extracted||"[Текст не распознан]";
    pageBlock.append(heading,imageCaption,pageImage,textCaption,textBlock);
    editor.append(pageBlock);
    setProgress(n/pdf.numPages*100);
  }
}
function safeImportedStyle(value){
  const allowed=new Set(["font-family","font-size","font-weight","font-style","text-decoration","text-align","color","background-color","margin-top","margin-bottom","width","height","min-height","vertical-align","border","border-top","border-right","border-bottom","border-left","border-color","border-width","border-style","padding","padding-top","padding-right","padding-bottom","padding-left","table-layout"]);
  const safe=[];
  String(value||"").split(";").forEach(part=>{
    const i=part.indexOf(":");if(i<1)return;
    const key=part.slice(0,i).trim().toLowerCase(),val=part.slice(i+1).trim();
    if(!allowed.has(key)||!val||/url\s*\(|expression|javascript:/i.test(val))return;
    if(key==="text-align"&&!/^(left|right|center|justify)$/i.test(val))return;
    if(key==="vertical-align"&&!/^(top|middle|bottom|baseline)$/i.test(val))return;
    if(key==="font-weight"&&!/^(normal|bold|[1-9]00)$/i.test(val))return;
    if(key==="font-style"&&!/^(normal|italic|oblique)$/i.test(val))return;
    if(key==="table-layout"&&!/^(fixed|auto)$/i.test(val))return;
    if(["color","background-color","border-color"].includes(key)&&!(/^(#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]{3,20})$/i.test(val)))return;
    if(["width","height","min-height","margin-top","margin-bottom","padding","padding-top","padding-right","padding-bottom","padding-left","border-width"].includes(key)&&!/^-?\d+(?:\.\d+)?(?:px|pt|mm|cm|in|%)?$/.test(val))return;
    if(key==="border-style"&&!/^(none|solid|double|dotted|dashed|groove|ridge|inset|outset)$/i.test(val))return;
    safe.push(key+":"+val);
  });
  return safe.join(";");
}
function sanitizeImportedHTML(markup){
  const doc=new DOMParser().parseFromString(String(markup||""),"text/html");
  const allowed=new Set(["P","DIV","SPAN","H1","H2","H3","H4","STRONG","B","EM","I","U","UL","OL","LI","TABLE","THEAD","TBODY","TR","TD","TH","COLGROUP","COL","BR","BLOCKQUOTE","PRE","IMG"]);
  doc.querySelectorAll("script,style,iframe,object,embed,form,svg,math,video,audio,link,meta").forEach(n=>n.remove());
  doc.body.querySelectorAll("*").forEach(node=>{
    if(!allowed.has(node.tagName)){node.replaceWith(...node.childNodes);return;}
    const attrs=[...node.attributes];attrs.forEach(a=>node.removeAttribute(a.name));
    const style=safeImportedStyle(attrs.find(a=>a.name.toLowerCase()==="style")?.value);
    if(style)node.setAttribute("style",style);
    const classValue=attrs.find(a=>a.name.toLowerCase()==="class")?.value||"";
    const safeClasses=new Set(["studio-source-page","studio-source-page-image","studio-source-caption","studio-recognized-text","studio-page-break","studio-data-table"]);
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
    const safeDataAttributes=new Set(["data-docx-table","data-docx-width-type","data-docx-width","data-docx-height","data-docx-height-rule","data-docx-header","data-docx-cant-split","data-page-break"]);
    attrs.forEach(attr=>{
      const key=attr.name.toLowerCase(),value=String(attr.value||"").trim();
      if(!safeDataAttributes.has(key))return;
      if(["data-docx-table","data-docx-header","data-docx-cant-split","data-page-break"].includes(key)){if(value==="true")node.setAttribute(key,"true");}
      else if(key==="data-docx-width-type"&&["pct","dxa"].includes(value))node.setAttribute(key,value);
      else if(key==="data-docx-height-rule"&&["exact","atLeast","auto"].includes(value))node.setAttribute(key,value);
      else if(["data-docx-width","data-docx-height"].includes(key)&&/^\d+(?:\.\d+)?$/.test(value))node.setAttribute(key,value);
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
    if(documentXml){const count=restoreDocxTableGeometry(documentXml);tableNote=" Таблиц обработано: "+count+".";}
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
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'+escapeHTML(title)+'</title><style>body{font:12pt/1.55 Georgia,serif;color:#222;max-width:850px;margin:40px auto;padding:0 24px}h1,h2{page-break-after:avoid}p{white-space:pre-wrap;margin:0 0 1em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px}img{max-width:100%;height:auto;object-fit:contain}.studio-source-page{break-inside:avoid;page-break-inside:avoid;margin:0 auto 24px;padding:14px;border:1px solid #ddd}.studio-source-page-image{display:block;width:auto;max-width:100%;height:auto;margin:8px auto 14px}.studio-source-caption{font-size:9pt;color:#666;margin:8px 0 4px}.studio-recognized-text{white-space:pre-wrap;line-height:1.55;padding:10px;border:1px dashed #bbb}.studio-page-break{break-before:page;page-break-before:always;border-top:1px dashed #aaa;margin:24px 0;height:1px;overflow:hidden;color:transparent}@media print{body{margin:15mm auto}.studio-page-break{border:0;margin:0}}</style></head><body><h1>'+escapeHTML(title)+'</h1>'+cleanEditorHTML()+'</body></html>';
}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
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
    state.sourceName=book.sourceName||book.revisionOf||book.name||"document.html";
    state.sourceType=book.type||"text/html";state.format=book.format||"docx";
    setProgress(100);
    say("Сохранённая редакция открыта. Таблицы и поддерживаемые параметры оформления восстановлены. Можно продолжить редактирование или экспортировать DOCX.");
  }catch(error){console.error(error);say("Не удалось открыть редакцию: "+error.message);}
}
async function saveToLibrary(){
  const html=documentHTML(),base=safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document"),name=base+"-редакция.html";
  const id=crypto.randomUUID?.()||String(Date.now());
  await put("books",{id,name,title:(state.sourceName.replace(/\.[^.]+$/,"")||"Документ")+" — редакция",author:"",ext:"html",type:"text/html",data:new TextEncoder().encode(html).buffer,addedAt:Date.now(),favorite:false,sourceName:state.sourceName,revisionOf:state.sourceName,format:state.format,revisionSchema:2});
  await refreshSavedRevisions(id);
  say("Новая HTML-редакция добавлена в библиотеку и доступна для повторного открытия. Исходный файл не изменён.");
  download(new Blob([html],{type:"text/html;charset=utf-8"}),name);
}
function printPDF(){
  const w=window.open("about:blank","_blank");
  if(!w){say("Браузер заблокировал окно печати. Разрешите всплывающие окна для ©Mirror и повторите попытку.");return;}
  const html=documentHTML();let started=false;
  const runPrint=async()=>{
    if(started)return;started=true;
    try{
      const images=[...w.document.images];
      await Promise.all(images.map(image=>image.decode?image.decode().catch(()=>{}):new Promise(resolve=>{if(image.complete)resolve();else{image.onload=resolve;image.onerror=resolve;}})));
      if(w.document.fonts?.ready)await w.document.fonts.ready;
      w.focus();setTimeout(()=>{try{w.print();}catch(error){say("Не удалось открыть печать: "+error.message);}},250);
    }catch(error){say("Не удалось подготовить документ к печати: "+error.message);}
  };
  w.addEventListener("load",runPrint,{once:true});
  w.document.open();w.document.write(html);w.document.close();
  setTimeout(()=>{if(!started)runPrint();},1200);
}
function exportText(){download(new Blob([editor.innerText||""],{type:"text/plain;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-текст.txt");}
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
      if(n.nodeValue)runs.push(new TextRun({text:n.nodeValue,bold:!!style.bold,italics:!!style.italics,underline:style.underline?{}:undefined,font:style.font||undefined,size:style.size||undefined,color:style.color||undefined,highlight:style.highlight||undefined}));
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
      font:(css.fontFamily||n.getAttribute?.("face"))?.split(",")[0]?.replace(/["']/g,"")||style.font,
      size:px?Math.max(16,Math.min(72,Math.round(px*1.5))):(fontSizeMap[htmlSize]||style.size),color:color||style.color,highlight:bg||style.highlight};
    n.childNodes.forEach(child=>walk(child,next));
    if(n.tagName==="BR")runs.push(new TextRun({text:"\n"}));
  }
  walk(node);return runs.length?runs:[new TextRun({text:""})];
}
async function exportDOCX(){
  if(!editor.innerText.trim()){say("Сначала загрузите или введите документ.");return;}
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
    if(node.dataset?.pageBreak==="true"){children.push(new Paragraph({children:[new PageBreak()]}));return;}
    if(node.tagName==="TABLE"){
      const colgroup=node.querySelector(":scope > colgroup");
      const gridWidths=colgroup?[...colgroup.children].map(col=>Math.round((parseFloat(col.style.width)||0)*15)): [];
      const rows=[...node.rows].map(row=>{
        const rowHeight=parseFloat(row.style.height||row.style.minHeight||""),storedRowHeight=Number(row.dataset.docxHeight)||0;
        const rowOptions={children:[...row.cells].map(cell=>{
          const bg=cssColor(cell.style.backgroundColor);
          const cellOptions={
            children:[new Paragraph({children:htmlRuns(cell,TextRun,ImageRun),alignment:blockAlignment(cell)})],
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
      if(Number.isFinite(marginBottom)&&marginBottom>0)opts.spacing={after:Math.min(1200,Math.round(marginBottom*15))};
      children.push(new Paragraph(opts));
    }else [...node.children].forEach(addBlock);
  }
  [...editor.children].forEach(addBlock);
  if(!children.length)children.push(new Paragraph({text:editor.innerText}));
  const doc=new Document({sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:850,bottom:1134,left:850}}},children}]});
  const blob=await Packer.toBlob(doc);
  download(blob,safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+"-редакция.docx");
  say("DOCX создан. Перенесены объединённые ячейки, размеры столбцов и строк, заливка, границы, отступы и вертикальное выравнивание таблиц, а также текст и встроенные изображения. Проверьте итоговый файл: сложные вложенные таблицы и нестандартные стили могут отличаться.");
}
async function exportXLSX(){
  const table=editor.querySelector("table");if(!table){say("В редакторе нет таблицы для экспорта XLSX.");return;}
  await loadSheetJS();
  const workbook=window.XLSX.utils.book_new(),sheet=window.XLSX.utils.table_to_sheet(table);
  window.XLSX.utils.book_append_sheet(workbook,sheet,"Лист1");
  window.XLSX.writeFile(workbook,safeName(state.sourceName.replace(/\.[^.]+$/,"")||"таблица")+"-редакция.xlsx");
  say("XLSX создан из редактируемой таблицы.");
}
async function exportSelectedFormat(){
  const format=$("studioExportFormat").value;
  try{
    if(format==="pdf"){printPDF();return;}
    if(format==="docx"){await exportDOCX();return;}
    if(format==="xlsx"){await exportXLSX();return;}
    if(format==="txt"){exportText();return;}
    if(format==="html"){
      download(new Blob([documentHTML()],{type:"text/html;charset=utf-8"}),safeName(state.sourceName.replace(/\\.[^.]+$/,"")||"document")+"-редакция.html");
      say("HTML-копия редакции подготовлена.");
      return;
    }
    say("Выберите формат сохранения.");
  }catch(error){
    console.error("Export:",error);
    say("Не удалось подготовить файл: "+error.message);
  }
}
$("studioExportSelected").addEventListener("click",exportSelectedFormat);
$("studioRecognize").addEventListener("click",recognize);
$("studioSave").addEventListener("click",()=>saveToLibrary().catch(e=>say("Не удалось сохранить: "+e.message)));
$("studioLoadRevision").addEventListener("click",()=>loadSavedRevision());
$("studioPDF").addEventListener("click",printPDF);
$("studioTXT").addEventListener("click",exportText);
$("studioDOCX").addEventListener("click",()=>exportDOCX().catch(e=>{console.error(e);say("Не удалось создать DOCX: "+e.message);}));
$("studioXLSX").addEventListener("click",()=>exportXLSX().catch(e=>{console.error(e);say("Не удалось создать XLSX: "+e.message);}));
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
$("studioDownloadHTML").addEventListener("click",()=>download(new Blob([documentHTML()],{type:"text/html;charset=utf-8"}),safeName(state.sourceName.replace(/\.[^.]+$/,"")||"document")+".html"));
$("openStudioBtn").addEventListener("click",()=>{$("libraryView").classList.add("hidden");$("readerView").classList.add("hidden");$("documentStudioView").classList.remove("hidden");document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));$("openStudioBtn").classList.add("active");refreshSavedRevisions().catch(e=>say("Не удалось загрузить список редакций: "+e.message));});
$("studioBack").addEventListener("click",()=>{$("documentStudioView").classList.add("hidden");$("libraryView").classList.remove("hidden");$("openStudioBtn").classList.remove("active");});
fileInput.addEventListener("change",()=>{const f=fileInput.files?.[0];if(f){state.sourceName=f.name;say("Выбран файл: "+f.name+". Нажмите «Открыть документ / распознать».");}});
