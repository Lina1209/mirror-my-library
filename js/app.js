import { put, getAll, getOne, remove } from "./db.js";
import { extension, extractMetadata, safeHTML, fb2ToHTML } from "./parsers.js";

const $ = id => document.getElementById(id);
const state = {
  books: [], filter: "all", activeBook: null,
  epub: null, rendition: null, pdf: null, pdfPage: 1,
  fontSize: 18, currentTextPages: [], textPage: 0
};
const filters = {
  all: "Все книги", reading: "Читаю сейчас",
  finished: "Прочитано", favorites: "Избранное"
};
let toastTimer;

function toast(message) {
  const element = $("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2800);
}
function makeId() {
  return crypto.randomUUID ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function percent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}
function plural(n) {
  return n === 1 ? "книга" : n > 1 && n < 5 ? "книги" : "книг";
}
function setReaderStatus(text) { $("pageStatus").textContent = text; }

async function refresh() {
  const [books, progress] = await Promise.all([getAll("books"), getAll("progress")]);
  const progressByBook = new Map(progress.map(item => [item.bookId, item]));
  state.books = books.map(book => ({
    ...book,
    progress: progressByBook.get(book.id) || { percent: 0, status: "new" }
  }));
  renderBooks();
}

function renderBooks() {
  const term = $("searchInput").value.trim().toLowerCase();
  const filtered = state.books.filter(book => {
    const p = book.progress || {};
    const matchesFilter = state.filter === "all"
      || (state.filter === "reading" && p.status === "reading")
      || (state.filter === "finished" && p.status === "finished")
      || (state.filter === "favorites" && book.favorite);
    const matchesSearch = !term
      || `${book.title} ${book.author} ${book.name}`.toLowerCase().includes(term);
    return matchesFilter && matchesSearch;
  });

  $("sectionTitle").textContent = filters[state.filter];
  $("sectionSubtitle").textContent = `${filtered.length} ${plural(filtered.length)} в подборке`;
  $("allCount").textContent = state.books.length;
  $("readingCount").textContent = state.books.filter(b => b.progress.status === "reading").length;
  $("finishedCount").textContent = state.books.filter(b => b.progress.status === "finished").length;
  $("favoriteCount").textContent = state.books.filter(b => b.favorite).length;

  const grid = $("bookGrid");
  grid.replaceChildren();
  filtered.forEach(book => {
    const card = document.createElement("article");
    card.className = "book-card";

    const cover = document.createElement("div");
    const extClass = book.ext.startsWith("fb2") ? "fb2" : book.ext;
    cover.className = `cover ${["fb2", "epub", "pdf", "txt"].includes(extClass) ? extClass : ""}`;
    const coverTitle = document.createElement("span");
    coverTitle.textContent = book.title;
    cover.append(coverTitle);

    const row = document.createElement("div");
    row.className = "card-row";
    const title = document.createElement("div");
    title.className = "book-title";
    title.textContent = book.title;
    title.title = book.title;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const favorite = document.createElement("button");
    favorite.className = "mini-btn";
    favorite.textContent = book.favorite ? "♥" : "♡";
    favorite.title = "Избранное";
    favorite.onclick = async () => {
      book.favorite = !book.favorite;
      await put("books", book);
      await refresh();
    };
    const more = document.createElement("button");
    more.className = "mini-btn";
    more.textContent = "···";
    more.title = "Действия";
    more.onclick = () => showDetails(book);
    actions.append(favorite, more);
    row.append(title, actions);

    const author = document.createElement("div");
    author.className = "book-author";
    author.textContent = book.author || "Автор не указан";

    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${percent(book.progress.percent)}%`;
    track.append(fill);

    const label = document.createElement("div");
    label.className = "progress-label";
    label.textContent = book.progress.status === "finished" ? "Прочитано"
      : book.progress.percent ? `Прочитано ${percent(book.progress.percent)}%` : "Ещё не открывали";

    card.append(cover, row, author, track, label);
    card.onclick = event => {
      if (!event.target.closest("button")) openBook(book.id);
    };
    grid.append(card);
  });
  $("emptyState").classList.toggle("hidden", filtered.length > 0);
}

function showDetails(book) {
  const body = $("detailsBody");
  body.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = book.title;
  const info = document.createElement("p");
  info.textContent = `${book.author || "Автор не указан"} · ${book.name}`;
  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const open = document.createElement("button");
  open.className = "primary";
  open.textContent = "Открыть";
  open.onclick = () => { $("detailsDialog").close(); openBook(book.id); };

  const download = document.createElement("button");
  download.className = "secondary";
  download.textContent = "Скачать оригинал";
  download.onclick = () => downloadBook(book);

  const del = document.createElement("button");
  del.className = "secondary";
  del.textContent = "Удалить";
  del.onclick = async () => {
    if (!confirm("Удалить книгу из библиотеки?")) return;
    await remove("books", book.id);
    await remove("progress", book.id);
    const marks = await getAll("bookmarks");
    for (const mark of marks.filter(item => item.bookId === book.id)) {
      await remove("bookmarks", mark.id);
    }
    $("detailsDialog").close();
    await refresh();
    toast("Книга удалена");
  };

  actions.append(open, download, del);
  body.append(heading, info, actions);
  $("detailsDialog").showModal();
}

function downloadBook(book) {
  const blob = new Blob([book.data], { type: book.type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = book.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function ensureScript(test, src, label) {
  if (test()) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Не удалось загрузить библиотеку ${label}. Проверьте интернет.`));
    document.head.append(script);
  });
  if (!test()) throw new Error(`Библиотека ${label} не запустилась.`);
}

async function importFiles(fileList) {
  let added = 0;
  for (const file of fileList) {
    let ext = extension(file.name);
    if (!["fb2", "fb2.zip", "epub", "pdf", "txt", "html", "htm", "docx", "xlsx", "xls", "csv"].includes(ext)) {
      toast(`Формат не поддерживается: ${file.name}`);
      continue;
    }
    try {
      let data = file;
      if (ext === "fb2.zip") {
        await ensureScript(() => !!window.JSZip,
          "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "ZIP");
        const archive = await window.JSZip.loadAsync(file);
        const entry = Object.values(archive.files)
          .find(item => !item.dir && item.name.toLowerCase().endsWith(".fb2"));
        if (!entry) throw new Error("В ZIP-архиве не найден файл FB2.");
        data = new Blob([await entry.async("uint8array")], { type: "application/xml" });
        ext = "fb2";
      }
      if (["epub", "docx", "xlsx", "xls"].includes(ext)) {
        await ensureScript(() => !!window.JSZip,
          "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "ZIP");
      }
      const metadata = await extractMetadata(data, ext);
      await put("books", {
        id: makeId(), name: file.name, title: metadata.title,
        author: metadata.author, ext, type: file.type,
        data: await data.arrayBuffer(), addedAt: Date.now(), favorite: false
      });
      added++;
    } catch (error) {
      console.error(error);
      toast(`${file.name}: ${error.message}`);
    }
  }
  await refresh();
  if (added) toast(`Добавлено: ${added} ${plural(added)}`);
}

async function saveProgress(bookId, value, locator = {}) {
  const valuePercent = percent(value);
  const status = valuePercent >= 99 ? "finished" : valuePercent > 0 ? "reading" : "new";
  await put("progress", {
    bookId, percent: valuePercent, status, ...locator, updatedAt: Date.now()
  });
  const book = state.books.find(item => item.id === bookId);
  if (book) book.progress = { percent: valuePercent, status, ...locator };
}

function splitText(text, maxLength = 2800) {
  const pages = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const lineBreak = text.lastIndexOf("\n", end);
      if (lineBreak > start + maxLength * 0.55) end = lineBreak + 1;
    }
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages.length ? pages : [""];
}

function updateTextNav(label = "Страница") {
  $("prevBtn").disabled = state.textPage <= 0;
  $("nextBtn").disabled = state.textPage >= state.currentTextPages.length - 1;
  setReaderStatus(`${label} ${state.textPage + 1} из ${state.currentTextPages.length}`);
}

function renderTextPage() {
  const content = $("readerContent");
  const pre = document.createElement("pre");
  pre.textContent = state.currentTextPages[state.textPage] || "";
  content.replaceChildren(pre);
  updateTextNav();
  if (state.activeBook) {
    saveProgress(state.activeBook.id,
      (state.textPage + 1) / state.currentTextPages.length * 100,
      { page: state.textPage });
  }
}

function renderFB2Page() {
  $("readerContent").innerHTML = state.currentTextPages[state.textPage] || "";
  updateTextNav("Раздел");
  if (state.activeBook) {
    saveProgress(state.activeBook.id,
      (state.textPage + 1) / state.currentTextPages.length * 100,
      { page: state.textPage });
  }
}

async function openFB2(book, progress) {
  const html = fb2ToHTML(new TextDecoder("utf-8").decode(book.data));
  const staging = document.createElement("div");
  staging.innerHTML = html;
  const topSections = [...staging.children].filter(node => node.tagName.toLowerCase() === "section");
  state.currentTextPages = topSections.length
    ? topSections.map(section => section.outerHTML)
    : [staging.innerHTML];
  state.textPage = Math.max(0, Math.min(Number(progress?.page) || 0, state.currentTextPages.length - 1));
  renderFB2Page();
}

async function openTXT(book, progress) {
  const text = new TextDecoder("utf-8").decode(book.data);
  state.currentTextPages = splitText(text);
  state.textPage = Math.max(0, Math.min(Number(progress?.page) || 0, state.currentTextPages.length - 1));
  renderTextPage();
}

async function openHTML(book, progress) {
  $("readerContent").innerHTML = safeHTML(new TextDecoder("utf-8").decode(book.data));
  state.currentTextPages = [];
  $("prevBtn").disabled = true;
  $("nextBtn").disabled = true;
  setReaderStatus("HTML-документ");
  await saveProgress(book.id, progress?.percent || 0, { page: progress?.page || 0 });
}

async function openEPUB(book, progress) {
  await ensureScript(() => !!window.ePub,
    "https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js", "EPUB");
  const content = $("readerContent");
  content.replaceChildren();
  state.epub = window.ePub(book.data);
  state.rendition = state.epub.renderTo(content, {
    width: "100%", height: "65vh", flow: "paginated",
    spread: "none", allowScriptedContent: false
  });
  state.rendition.on("relocated", location => {
    const percentage = location.start?.percentage || 0;
    saveProgress(book.id, percentage * 100, { cfi: location.start?.cfi || "" });
    setReaderStatus(`Прочитано ${Math.round(percentage * 100)}%`);
  });
  await state.rendition.display(progress?.cfi || undefined);
  state.rendition.themes.fontSize(`${state.fontSize}px`);
  $("prevBtn").disabled = false;
  $("nextBtn").disabled = false;
  setReaderStatus("EPUB");
}

async function openPDF(book, progress) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  state.pdf = await pdfjs.getDocument({ data: book.data.slice(0) }).promise;
  state.pdfPage = Math.max(1, Math.min(Number(progress?.page) || 1, state.pdf.numPages));
  await renderPDFPage();
}

async function renderPDFPage() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.pdfPage);
  const base = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(280, Math.min(760, window.innerWidth - 64));
  const scale = Math.min(1.5, availableWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
  }).promise;
  $("readerContent").replaceChildren(canvas);
  if(!$("pdfTextBtn")){const b=document.createElement("button");b.id="pdfTextBtn";b.className="secondary";b.textContent="Извлечь текст / OCR";b.onclick=extractPDFText;$("readerMeta").append(" ",b);}
  $("prevBtn").disabled = state.pdfPage <= 1;
  $("nextBtn").disabled = state.pdfPage >= state.pdf.numPages;
  setReaderStatus(`Страница ${state.pdfPage} из ${state.pdf.numPages}`);
  await saveProgress(state.activeBook.id, state.pdfPage / state.pdf.numPages * 100,
    { page: state.pdfPage });
}

async function loadGlobalScript(test,src,name){
 if(test())return;
 await new Promise((resolve,reject)=>{const el=document.createElement("script");el.src=src;el.onload=resolve;el.onerror=()=>reject(new Error("Не удалось загрузить модуль "+name+". Нужен интернет."));document.head.append(el);});
 if(!test())throw new Error("Модуль "+name+" недоступен.");
}
async function openDOCX(book){
 await loadGlobalScript(()=>!!window.mammoth,"https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js","DOCX");
 const result=await window.mammoth.convertToHtml({arrayBuffer:book.data.slice(0)});$("readerContent").innerHTML=safeHTML(result.value);$("prevBtn").disabled=$("nextBtn").disabled=true;setReaderStatus("Документ Word");
}
async function openSpreadsheet(book){
 await loadGlobalScript(()=>!!window.XLSX,"https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","Excel");
 const wb=window.XLSX.read(book.data,{type:"array"}),root=document.createElement("div");
 wb.SheetNames.forEach(name=>{const h=document.createElement("h3");h.textContent=name;root.append(h);const table=document.createElement("div");table.className="sheet-table";table.innerHTML=window.XLSX.utils.sheet_to_html(wb.Sheets[name]);root.append(table);});
 $("readerContent").replaceChildren(root);$("prevBtn").disabled=$("nextBtn").disabled=true;setReaderStatus("Таблица · "+wb.SheetNames.length+" лист(ов)");
}
async function loadOCR(){await loadGlobalScript(()=>!!window.Tesseract,"https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js","OCR");return window.Tesseract;}
async function extractPDFText(){
 if(!state.pdf)return;
 try{let T=null;const pages=[];for(let n=1;n<=state.pdf.numPages;n++){setReaderStatus("Обработка PDF "+n+" / "+state.pdf.numPages);const page=await state.pdf.getPage(n),tc=await page.getTextContent();let value=tc.items.map(x=>x.str).join(" ").trim();if(value.length<20){if(!T)T=await loadOCR();const vp=page.getViewport({scale:1.5}),c=document.createElement("canvas"),ctx=c.getContext("2d");c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);await page.render({canvasContext:ctx,viewport:vp}).promise;const result=await T.recognize(c,"rus+eng");value=result.data.text||"[Текст не распознан]";}pages.push("Страница "+n+"\n"+value);}const text=pages.join("\n\n");state.currentTextPages=splitText(text);state.textPage=0;state.pdf=null;renderTextPage();setReaderStatus("Текст PDF извлечён");const blob=new Blob([text],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="pdf-text.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){console.error(e);toast("Ошибка OCR: "+e.message);}
}

async function openBook(bookId) {
  const book = await getOne("books", bookId);
  if (!book) return;
  state.activeBook = book;
  state.epub = null;
  state.rendition = null;
  state.pdf = null;
  state.currentTextPages = [];
  state.textPage = 0;

  $("libraryView").classList.add("hidden");
  $("readerView").classList.remove("hidden");
  $("readerBookTitle").textContent = book.title;
  $("readerMeta").textContent = `${book.author || "Автор не указан"} · ${book.ext.toUpperCase()}`;
  $("readerContent").textContent = "Загружаем книгу…";
  $("readerContent").style.fontSize = `${state.fontSize}px`;

  const progress = await getOne("progress", bookId);
  try {
    if (book.ext === "epub") await openEPUB(book, progress);
    else if (book.ext === "pdf") await openPDF(book, progress);
    else if (book.ext === "fb2") await openFB2(book, progress);
    else if (book.ext === "txt" || book.ext === "csv") await openTXT(book, progress);
    else if (book.ext === "docx") await openDOCX(book);
    else if (["xlsx", "xls"].includes(book.ext)) await openSpreadsheet(book);
    else if (["html", "htm"].includes(book.ext)) await openHTML(book, progress);
    else throw new Error("Этот формат пока не поддерживается.");
  } catch (error) {
    console.error(error);
    $("readerContent").textContent = `Не удалось открыть файл: ${error.message}`;
    $("prevBtn").disabled = true;
    $("nextBtn").disabled = true;
    toast("Ошибка чтения файла");
  }
}

$("prevBtn").onclick = async () => {
  if (state.rendition) { state.rendition.prev(); return; }
  if (state.pdf) {
    if (state.pdfPage > 1) { state.pdfPage--; await renderPDFPage(); }
    return;
  }
  if (state.textPage > 0) {
    state.textPage--;
    if (state.activeBook?.ext === "fb2") renderFB2Page();
    else renderTextPage();
  }
};
$("nextBtn").onclick = async () => {
  if (state.rendition) { state.rendition.next(); return; }
  if (state.pdf) {
    if (state.pdfPage < state.pdf.numPages) { state.pdfPage++; await renderPDFPage(); }
    return;
  }
  if (state.textPage < state.currentTextPages.length - 1) {
    state.textPage++;
    if (state.activeBook?.ext === "fb2") renderFB2Page();
    else renderTextPage();
  }
};
$("backBtn").onclick = async () => {
  state.rendition?.destroy?.();
  state.epub?.destroy?.();
  state.rendition = null;
  state.epub = null;
  state.pdf = null;
  state.activeBook = null;
  $("readerView").classList.add("hidden");
  $("libraryView").classList.remove("hidden");
  await refresh();
};
$("fontUp").onclick = () => {
  state.fontSize = Math.min(30, state.fontSize + 1);
  $("readerContent").style.fontSize = `${state.fontSize}px`;
  state.rendition?.themes.fontSize(`${state.fontSize}px`);
};
$("fontDown").onclick = () => {
  state.fontSize = Math.max(13, state.fontSize - 1);
  $("readerContent").style.fontSize = `${state.fontSize}px`;
  state.rendition?.themes.fontSize(`${state.fontSize}px`);
};
function getSelectedReaderText() {
  const selection = window.getSelection?.();
  const selected = selection?.toString().trim() || "";
  if (!selected || !$("readerContent").contains(selection.anchorNode)) return "";
  return selected;
}
async function copySelectedText() {
  const selected = getSelectedReaderText();
  if (!selected) { toast("Сначала выделите текст в документе"); return; }
  try { await navigator.clipboard.writeText(selected); toast("Выделенный текст скопирован"); }
  catch { const area=document.createElement("textarea"); area.value=selected; document.body.append(area); area.select(); const ok=document.execCommand("copy"); area.remove(); toast(ok ? "Выделенный текст скопирован" : "Не удалось скопировать текст"); }
}
async function shareSelectedText() {
  const selected=getSelectedReaderText();
  if (!selected) { toast("Сначала выделите текст в документе"); return; }
  try { if(navigator.share) await navigator.share({title:state.activeBook?.title || "Текст из ©Mirror",text:selected}); else { await navigator.clipboard.writeText(selected); toast("Текст скопирован — вставьте его в нужное приложение"); } }
  catch(error) { if(error.name!=="AbortError") toast("Не удалось открыть меню отправки"); }
}
async function shareCurrentBook() {
  const book=state.activeBook; if(!book) return;
  const file=new File([book.data],book.name,{type:book.type || "application/octet-stream"});
  try { if(navigator.share && navigator.canShare?.({files:[file]})) await navigator.share({title:book.title,text:"Файл из моей библиотеки ©Mirror",files:[file]}); else { downloadBook(book); toast("Файл скачан. Теперь его можно прикрепить к сообщению"); } }
  catch(error) { if(error.name!=="AbortError") toast("Не удалось поделиться файлом"); }
}
$("copySelectionBtn").onclick=copySelectedText;
$("shareSelectionBtn").onclick=shareSelectedText;
$("shareBookBtn").onclick=shareCurrentBook;
$("bookmarkBtn").onclick = async () => {
  if (!state.activeBook) return;
  const mark = {
    id: makeId(), bookId: state.activeBook.id,
    page: state.pdf ? state.pdfPage : state.textPage,
    cfi: state.rendition?.currentLocation()?.start?.cfi || "",
    createdAt: Date.now()
  };
  await put("bookmarks", mark);
  toast("Закладка сохранена");
};

$("chooseFiles").onclick = () => $("fileInput").click();
$("addTopBtn").onclick = () => $("fileInput").click();
$("emptyAddBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = event => {
  importFiles([...event.target.files]);
  event.target.value = "";
};
$("searchInput").oninput = renderBooks;

document.querySelectorAll(".nav-item[data-filter]").forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderBooks();
  };
});

const dropZone = $("dropZone");
["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => {
  event.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
}));
dropZone.addEventListener("drop", event => importFiles([...event.dataTransfer.files]));
$("themeBtn").onclick=()=>{document.body.classList.toggle("dark");localStorage.setItem("mirror-theme",document.body.classList.contains("dark")?"dark":"light");};
if(localStorage.getItem("mirror-theme")==="dark")document.body.classList.add("dark");
$("fullscreenBtn").onclick=async()=>{try{if(!document.fullscreenElement)await $("readerView").requestFullscreen();else await document.exitFullscreen();}catch(e){toast("Полноэкранный режим недоступен");}};
let touchX=0,touchY=0;$("readerContent").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY;},{passive:true});$("readerContent").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25){if(dx<0)$("nextBtn").click();else $("prevBtn").click();}},{passive:true});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
  });
}
refresh().catch(error => {
  console.error(error);
  toast("Браузер не разрешил локальное хранилище");
});
