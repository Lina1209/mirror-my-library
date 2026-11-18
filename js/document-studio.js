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
function safeImportedStyle(value){
  const allowed=new Set(["font-family","font-size","font-weight","font-style","text-decoration","text-align","color","background-color","margin-top","margin-bottom","width","height","vertical-align","border","border-top","border-right","border-bottom","border-left","padding"]);
  const safe=[];
  String(value||"").split(";").forEach(part=>{
    const i=part.indexOf(":");if(i<1)return;
    const key=part.slice(0,i).trim().toLowerCase(),val=part.slice(i+1).trim();
    if(!allowed.has(key)||!val||/url\s*\(|expression|javascript:/i.test(val))return;
    if(key==="text-align"&&!/^(left|right|center|justify)$/i.test(val))return;
    if(key==="font-weight"&&!/^(normal|bold|[1-9]00)$/i.test(val))return;
    if(key==="font-style"&&!/^(normal|italic|oblique)$/i.test(val))return;
    if(["color","background-color"].includes(key)&&!(/^(#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]{3,20})$/i.test(val)))return;
    if(["width","height","margin-top","margin-bottom","padding"].includes(key)&&!/^-?\d+(?:\.\d+)?(?:px|pt|mm|cm|in|%)?$/.test(val))return;
    safe.push(key+":"+val);
  });
  return safe.join(";");
}
function sanitizeImportedHTML(markup){
  const doc=new DOMParser().parseFromString(String(markup||""),"text/html");
  const allowed=new Set(["P","DIV","SPAN","H1","H2","H3","H4","STRONG","B","EM","I","U","UL","OL","LI","TABLE","THEAD","TBODY","TR","TD","TH","BR","BLOCKQUOTE","PRE","IMG"]);
  doc.querySelectorAll("script,style,iframe,object,embed,form,svg,math,video,audio,link,meta").forEach(n=>n.remove());
  doc.body.querySelectorAll("*").forEach(node=>{
    if(!allowed.has(node.tagName)){node.replaceWith(...node.childNodes);return;}
    const attrs=[...node.attributes];attrs.forEach(a=>node.removeAttribute(a.name));
    const style=safeImportedStyle(attrs.find(a=>a.name.toLowerCase()==="style")?.value);
    if(style)node.setAttribute("style",style);
    if(node.tagName==="IMG"){
      const src=attrs.find(a=>a.name.toLowerCase()==="src")?.value||"";
      if(!/^data:image\/(png|jpeg|gif);base64,[a-z0-9+/=]+$/i.test(src)){node.remove();return;}
      node.setAttribute("src",src);
      const alt=attrs.find(a=>a.name.toLowerCase()==="alt")?.value;if(alt)node.setAttribute("alt",alt.slice(0,300));
      ["width","height"].forEach(key=>{const n=Number(attrs.find(a=>a.name.toLowerCase()===key)?.value);if(Number.isFinite(n)&&n>0&&n<=2400)node.setAttribute(key,String(Math.round(n)));});
    }
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
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'+escapeHTML(title)+'</title><style>body{font:12pt/1.55 Georgia,serif;color:#222;max-width:850px;margin:40px auto;padding:0 24px}h1,h2{page-break-after:avoid}p{white-space:pre-wrap;margin:0 0 1em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px}img{max-width:100%;height:auto;object-fit:contain}.studio-page-break{break-before:page;page-break-before:always;border-top:1px dashed #aaa;margin:24px 0;height:1px;overflow:hidden;color:transparent}@media print{body{margin:15mm auto}.studio-page-break{border:0;margin:0}}</style></head><body><h1>'+escapeHTML(title)+'</h1>'+cleanEditorHTML()+'</body></html>';
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
    if(n.tagName==="BR")runs.push(new TextRun({text:"\\n"}));
  }
  walk(node);return runs.length?runs:[new TextRun({text:""})];
}
async function exportDOCX(){
  if(!editor.innerText.trim()){say("Сначала загрузите или введите документ.");return;}
  say("Подготовка DOCX…");
  const d=await import("https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm");
  const {Document,Packer,Paragraph,TextRun,ImageRun,PageBreak,HeadingLevel,Table,TableRow,TableCell,WidthType,AlignmentType,ShadingType,BorderStyle}=d;
  const children=[];
  const borders={top:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"},bottom:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"},left:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"},right:{style:BorderStyle.SINGLE,size:4,color:"A0A0A0"}};
  function blockAlignment(node){
    const align=node.style?.textAlign;
    return align==="center"?AlignmentType.CENTER:align==="right"?AlignmentType.RIGHT:align==="justify"?AlignmentType.JUSTIFIED:AlignmentType.LEFT;
  }
  function addBlock(node){
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    if(node.dataset?.pageBreak==="true"){children.push(new Paragraph({children:[new PageBreak()]}));return;}
    if(node.tagName==="TABLE"){
      const rows=[...node.rows].map(row=>new TableRow({children:[...row.cells].map(cell=>{
        const bg=(cell.style.backgroundColor||"").match(/#([0-9a-f]{6})/i)?.[1]?.toUpperCase();
        return new TableCell({children:[new Paragraph({children:htmlRuns(cell,TextRun,ImageRun),alignment:blockAlignment(cell)})],
          borders,shading:bg?{fill:bg,type:ShadingType.CLEAR}:undefined,verticalAlign:"center"});
      })}));
      if(rows.length)children.push(new Table({rows,width:{size:100,type:WidthType.PERCENTAGE},borders}));
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
  say("DOCX создан. Перенесены абзацы, выравнивание, заголовки, списки, базовые выделения, шрифт/цвет текста и простые таблицы с границами и фоном ячеек. Сложная вёрстка и специальные элементы могут отличаться от оригинала.");
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
$("openStudioBtn").addEventListener("click",()=>{$("libraryView").classList.add("hidden");$("readerView").classList.add("hidden");$("documentStudioView").classList.remove("hidden");document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));$("openStudioBtn").classList.add("active");});
$("studioBack").addEventListener("click",()=>{$("documentStudioView").classList.add("hidden");$("libraryView").classList.remove("hidden");$("openStudioBtn").classList.remove("active");});
fileInput.addEventListener("change",()=>{const f=fileInput.files?.[0];if(f){state.sourceName=f.name;say("Выбран файл: "+f.name+". Нажмите «Открыть документ / распознать».");}});
