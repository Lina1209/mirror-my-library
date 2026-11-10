import { put, getAll, getOne, remove } from "./db.js";
import { extension, extractMetadata, safeHTML, fb2ToHTML } from "./parsers.js";

const $ = id => document.getElementById(id);
const state = { books: [], filter: "all", activeBook: null, epub: null, pdf: null, pdfPage: 1, fontSize: 18, currentTextPages: [], textPage: 0 };
const filters = { all: "Все книги", reading: "Читаю сейчас", finished: "Прочитано", favorites: "Избранное" };
let toastTimer;
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600); }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function fileFromBook(book) { return new File([book.data], book.name, {type:book.type||""}); }
function progressPercent(p) { return Math.max(0,Math.min(100,Math.round(p||0))); }

async function refresh() {
  state.books = await getAll("books");
  const progress = await getAll("progress");
  const pmap = new Map(progress.map(p=>[p.bookId,p]));
  state.books = state.books.map(b=>({...b, progress:pmap.get(b.id)||{percent:0,status:"new"}}));
  renderBooks();
}
function renderBooks() {
  const term=$("searchInput").value.trim().toLowerCase();
  const filtered=state.books.filter(b=>{
    const p=b.progress;
    const match=state.filter==="all" || (state.filter==="reading" && p.status==="reading") || (state.filter==="finished" && p.status==="finished") || (state.filter==="favorites" && b.favorite);
    return match && (!term || `${b.title} ${b.author} ${b.name}`.toLowerCase().includes(term));
  });
  $("sectionTitle").textContent=filters[state.filter];
  $("sectionSubtitle").textContent=`${filtered.length} ${plural(filtered.length)} в подборке`;
  $("allCount").textContent=state.books.length;
  $("readingCount").textContent=state.books.filter(b=>b.progress.status==="reading").length;
  $("finishedCount").textContent=state.books.filter(b=>b.progress.status==="finished").length;
  $("favoriteCount").textContent=state.books.filter(b=>b.favorite).length;
  $("bookGrid").innerHTML="";
  filtered.forEach(book=>{
    const card=document.createElement("article"); card.className="book-card";
    const cover=document.createElement("div"); cover.className=`cover ${book.ext.startsWith("fb2")?"fb2":book.ext==="epub"?"epub":book.ext==="pdf"?"pdf":book.ext==="txt"?"txt":""}`;
    const title=document.createElement("span"); title.textContent=book.title; cover.append(title);
    const row=document.createElement("div"); row.className="card-row";
    const name=document.createElement("div"); name.className="book-title"; name.textContent=book.title; name.title=book.title; row.append(name);
    const actions=document.createElement("div"); actions.className="card-actions";
    const fav=document.createElement("button"); fav.className="mini-btn"; fav.textContent=book.favorite?"♥":"♡"; fav.title="Избранное"; fav.onclick=async()=>{book.favorite=!book.favorite;await put("books",book);refresh();};
    const more=document.createElement("button"); more.className="mini-btn"; more.textContent="···"; more.title="Действия"; more.onclick=()=>showDetails(book);
    actions.append(fav,more); row.append(actions);
    const author=document.createElement("div"); author.className="book-author"; author.textContent=book.author;
    const track=document.createElement("div"); track.className="progress-track"; const fill=document.createElement("div"); fill.className="progress-fill"; fill.style.width=`${progressPercent(book.progress.percent)}%`; track.append(fill);
    const label=document.createElement("div"); label.className="progress-label"; label.textContent=book.progress.status==="finished"?"Прочитано":book.progress.percent?`Прочитано ${progressPercent(book.progress.percent)}%`:"Ещё не открывали";
    card.append(cover,row,author,track,label); card.onclick=e=>{if(!e.target.closest("button"))openBook(book.id);}; $("bookGrid").append(card);
  });
  $("emptyState").classList.toggle("hidden",state.books.length>0);
}
function plural(n){return n===1?"книга":n>1&&n<5?"книги":"книг";}
function showDetails(book) {
  const body=$("detailsBody"); body.innerHTML="";
  const h=document.createElement("h3");h.textContent=book.title;
  const p=document.createElement("p");p.textContent=`${book.author} · ${book.name}`;
  const actions=document.createElement("div");actions.className="modal-actions";
  const open=document.createElement("button");open.className="primary";open.textContent="Открыть";open.onclick=()=>{$("detailsDialog").close();openBook(book.id);};
  const download=document.createElement("button");download.className="secondary";download.textContent="Скачать оригинал";download.onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(book.data);a.download=book.name;a.click();URL.revokeObjectURL(a.href);};
  const del=document.createElement("button");del.className="secondary";del.textContent="Удалить";del.onclick=async()=>{if(confirm("Удалить книгу из библиотеки?")){await remove("books",book.id);await remove("progress",book.id);const marks=await getAll("bookmarks");for(const m of marks.filter(x=>x.bookId===book.id))await remove("bookmarks",m.id);$("detailsDialog").close();refresh();toast("Книга удалена");}};
  actions.append(open,download,del);body.append(h,p,actions);$("detailsDialog").showModal();
}
async function importFiles(fileList) {
  let added=0;
  for(const file of fileList){
    let ext=extension(file.name);
    if(ext==="zip" && file.name.toLowerCase().endsWith(".fb2.zip")) ext="fb2.zip";
    if(!["fb2","fb2.zip","epub","pdf","txt","html","htm"].includes(ext)){toast(`Формат не поддерживается: ${file.name}`);continue;}
    try{
      let data=file;
      if(ext==="fb2.zip"){
        if(!window.JSZip)throw new Error("ZIP-библиотека ещё загружается. Попробуйте снова.");
        const zip=await JSZip.loadAsync(file);const entry=Object.values(zip.files).find(x=>!x.dir&&x.name.toLowerCase().endsWith(".fb2"));
        if(!entry)throw new Error("В ZIP не найден FB2-файл.");
        data=new Blob([await entry.async("uint8array")],{type:"application/xml"});ext="fb2";
      }
      const meta=await extractMetadata(data,ext);
      await put("books",{id:id(),name:file.name,title:meta.title,author:meta.author,ext,type:file.type,data:await data.arrayBuffer(),addedAt:Date.now(),favorite:false});
      added++;
    }catch(e){console.error(e);toast(`${file.name}: ${e.message}`);}
  }
  await refresh(); if(added)toast(`Добавлено: ${added} ${plural(added)}`);
}
async function saveProgress(bookId, percent, locator={}) {
  const status=percent>=99?"finished":percent>0?"reading":"new";
  await put("progress",{bookId,percent,status,...locator,updatedAt:Date.now()});
  const b=state.books.find(x=>x.id===bookId); if(b)b.progress={percent,status,...locator};
}
async function openBook(bookId) {
  const book=await getOne("books",bookId);if(!book)return;
  state.activeBook=book;state.epub=null;state.pdf=null;
  $("libraryView").classList.add("hidden");$("readerView").classList.remove("hidden");
  $("readerBookTitle").textContent=book.title;$("readerMeta").textContent=`${book.author} · ${book.ext.toUpperCase()}`;
  const content=$("readerContent");content.innerHTML="Загружаем книгу…";content.style.fontSize=`${state.fontSize}px`;
  const progress=await getOne("progress",bookId);
  try{
    if(book.ext==="epub")await openEPUB(book,progress);
    else if(book.ext==="pdf")await openPDF(book,progress);
    else if(book.ext==="fb2")await openFB2(book,progress);
    else if(book.ext==="txt")await openTXT(book,progress);
    else if(["html","htm"].includes(book.ext))await openHTML(book,progress);
  }catch(e){console.error(e);content.textContent=`Не удалось открыть файл: ${e.message}`;toast("Ошибка чтения файла");}
  await refresh();
}
async function openFB2(book,progress){
  const html=fb2ToHTML(new TextDecoder().decode(book.data));const content=$("readerContent");content.innerHTML=html;
  const sections=[...content.querySelectorAll("section")];state.currentTextPages=sections.length?sections.map(s=>s.outerHTML):[html];state.textPage=Math.min(progress?.page||0,state.currentTextPages.length-1);
  renderTextPage();$("pageStatus").textContent=`Раздел ${state.textPage+1} из ${state.currentTextPages.length}`;
  $("prevBtn").disabled=state.textPage===0;$("nextBtn").disabled=state.textPage>=state.currentTextPages.length-1;
}
async function openTXT(book,progress){
  const text=new TextDecoder().decode(book.data);state.currentTextPages=splitText(text,2600);state.textPage=Math.min(progress?.page||0,state.currentTextPages.length-1);renderTextPage();updateTextNav();
}
async function openHTML(book,progress){
  $("readerContent").innerHTML=safeHTML(new TextDecoder().decode(book.data));state.currentTextPages=[];$("pageStatus").textContent="HTML-документ";
  $("prevBtn").disabled=true;$("nextBtn").disabled=true;await saveProgress(book.id,100,{page:0});
}
function splitText(text,max){const chunks=[];let pos=0;while(pos<text.length){let end=Math.min(pos+max,text.length);if(end<text.length){const cut=text.lastIndexOf("\n",end);if(cut>pos+max*.55)end=cut;}chunks.push(text.slice(pos,end));pos=end;}return chunks.length?chunks:[""]; }
function renderTextPage(){const content=$("readerContent");const chunk=state.currentTextPages[state.textPage]||"";content.innerHTML="";const pre=document.createElement("pre");pre.textContent=chunk;content.append(pre);$("pageStatus").textContent=`Страница ${state.textPage+1} из ${state.currentTextPages.length}`;if(state.activeBook)saveProgress(state.activeBook.id,(state.textPage+1)/state.currentTextPages.length*100,{page:state.textPage});}
function updateTextNav(){$("prevBtn").disabled=state.textPage<=0;$("nextBtn").disabled=state.textPage>=state.currentTextPages.length-1;$("pageStatus").textContent=`Страница ${state.textPage+1} из ${state.currentTextPages.length}`;}
async function openEPUB(book,progress){
  if(!window.ePub)throw new Error("Не загрузилась библиотека EPUB. Проверьте подключение к интернету.");
  const content=$("readerContent");content.innerHTML="";state.epub=window.ePub(book.data);const rendition=state.epub.renderTo(content,{width:"100%",height:"65vh",flow:"paginated",spread:"none",allowScriptedContent:false});
  await rendition.display(progress?.cfi||undefined);rendition.themes.fontSize(`${state.fontSize}px`);
  rendition.on("relocated",loc=>{const pct=loc.start?.percentage||0;saveProgress(book.id,pct*100,{cfi:loc.start?.cfi||""});$("pageStatus").textContent=`Прочитано ${Math.round(pct*100)}%`;});
  $("prevBtn").disabled=false;$("nextBtn").disabled=false;$("pageStatus").textContent="EPUB";
}
async function openPDF(book,progress){
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  state.pdf=await pdfjs.getDocument({data:book.data.slice(0)}).promise;state.pdfPage=Math.min(progress?.page||1,state.pdf.numPages);await renderPDFPage();$("prevBtn").disabled=false;$("nextBtn").disabled=false;
}
async function renderPDFPage(){
  const page=await state.pdf.getPage(state.pdfPage);const viewport=page.getViewport({scale:1.35});const canvas=document.createElement("canvas");const ctx=canvas.getContext("2d");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:ctx,viewport}).promise;
  const content=$("readerContent");content.innerHTML="";content.append(canvas);$("pageStatus").textContent=`Страница ${state.pdfPage} из ${state.pdf.numPages}`;$("prevBtn").disabled=state.pdfPage<=1;$("nextBtn").disabled=state.pdfPage>=state.pdf.numPages;saveProgress(state.activeBook.id,state.pdfPage/state.pdf.numPages*100,{page:state.pdfPage});
}
$("prevBtn").onclick=async()=>{if(state.epub){state.epub.rendition.prev();return;}if(state.pdf){if(state.pdfPage>1){state.pdfPage--;await renderPDFPage();}return;}if(state.textPage>0){state.textPage--;renderTextPage();updateTextNav();}};
$("nextBtn").onclick=async()=>{if(state.epub){state.epub.rendition.next();return;}if(state.pdf){if(state.pdfPage<state.pdf.numPages){state.pdfPage++;await renderPDFPage();}return;}if(state.textPage<state.currentTextPages.length-1){state.textPage++;renderTextPage();updateTextNav();}};
$("backBtn").onclick=()=>{$("readerView").classList.add("hidden");$("libraryView").classList.remove("hidden");state.activeBook=null;refresh();};
$("fontUp").onclick=()=>{state.fontSize=Math.min(30,state.fontSize+1);$("readerContent").style.fontSize=`${state.fontSize}px`;if(state.epub)state.epub.rendition.themes.fontSize(`${state.fontSize}px`);};
$("fontDown").onclick=()=>{state.fontSize=Math.max(13,state.fontSize-1);$("readerContent").style.fontSize=`${state.fontSize}px`;if(state.epub)state.epub.rendition.themes.fontSize(`${state.fontSize}px`);};
$("bookmarkBtn").onclick=async()=>{if(!state.activeBook)return;const mark={id:id(),bookId:state.activeBook.id,page:state.pdf?state.pdfPage:state.textPage,cfi:state.epub?.currentLocation()?.start?.cfi||"",createdAt:Date.now()};await put("bookmarks",mark);toast("Закладка сохранена");};
$("chooseFiles").onclick=()=>$("fileInput").click();$("addTopBtn").onclick=()=>$("fileInput").click();$("emptyAddBtn").onclick=()=>$("fileInput").click();$("fileInput").onchange=e=>importFiles([...e.target.files]);
$("searchInput").oninput=renderBooks;
document.querySelectorAll(".nav-item").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));btn.classList.add("active");state.filter=btn.dataset.filter;renderBooks();});
const drop=$("dropZone");["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("dragging");}));["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("dragging");}));drop.addEventListener("drop",e=>importFiles([...e.dataTransfer.files]));
$("themeBtn").onclick=()=>document.body.classList.toggle("dark");
if("serviceWorker" in navigator && location.protocol.startsWith("http"))window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.warn));
refresh().catch(e=>{console.error(e);toast("Браузер не разрешил локальное хранилище");});
