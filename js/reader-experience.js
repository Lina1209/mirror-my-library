import { getAll, remove } from "./db.js";

const $ = id => document.getElementById(id);
const view = $("readerView");
if (!view) throw new Error("Reader view not found");

const drawer = $("readerDrawer");
const subpanel = $("readerSubpanel");
const subpanelBody = $("readerSubpanelBody");
const scrim = $("readerScrim");
const settingsSheet = $("readerSettingsSheet");
const audioDock = $("readerAudioDock");
const audioSettings = $("readerAudioSettings");
const speechVoice = $("ttsVoice");
const speechRate = $("ttsRate");
if(speechRate){
  const saved=localStorage.getItem("mirror-tts-rate")||speechRate.value||"0.9";
  speechRate.replaceChildren();
  for(let n=60;n<=150;n+=5){const value=(n/100).toFixed(2).replace(/0$/,"");speechRate.add(new Option(value.replace(".",","),value));}
  speechRate.value=saved;
}

function isReaderOpen(){ return !view.classList.contains("hidden"); }
function closeOverlays(){
  drawer.hidden = true; subpanel.hidden = true; settingsSheet.hidden = true; audioSettings.hidden = true; scrim.hidden = true;
}
function showScrim(){ scrim.hidden = false; }
function showDrawer(){
  closeOverlays();
  $("readerActionsMenu").hidden=true;$("readerActionsBtn").setAttribute("aria-expanded","false");
  drawer.hidden = false; showScrim();
  $("readerDrawerBookTitle").textContent = $("readerBookTitle").textContent || "Моя книга";
}
function showSubpanel(title, eyebrow, body){
  closeOverlays(); $("readerSubpanelTitle").textContent=title; $("readerSubpanelEyebrow").textContent=eyebrow||"©MIRROR READER";
  subpanelBody.replaceChildren(); if(body) subpanelBody.append(body);
  subpanel.hidden=false; showScrim();
}
function make(tag, cls, text){
  const node=document.createElement(tag); if(cls)node.className=cls; if(text!==undefined)node.textContent=text; return node;
}
function activeBookId(){ return view.dataset.bookId || ""; }
function toastReader(message){
  const node=$("toast"); if(!node)return; node.textContent=message; node.classList.add("show"); clearTimeout(window.__mirrorReaderToastTimer);
  window.__mirrorReaderToastTimer=setTimeout(()=>node.classList.remove("show"),2600);
}
function runLegacyAction(action){
  const item=$("readerActionsMenu")?.querySelector('[data-reader-action="'+action+'"]');
  if(item)item.click();
}
async function openBookmarks(){
  const id=activeBookId(); const all=await getAll("bookmarks");
  const marks=all.filter(mark=>mark.bookId===id).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const body=make("div","reader-bookmark-list");
  if(!marks.length){body.append(make("div","reader-panel-empty","В этой книге пока нет закладок. Добавьте закладку в нужном месте чтения."));}
  for(const mark of marks){
    const row=make("div","reader-bookmark-item");
    const main=make("button","reader-bookmark-item-main");
    const title=make("strong","",mark.label||("Место чтения · "+(Number(mark.page||0)+1)));
    const detail=make("small","",new Date(mark.createdAt||Date.now()).toLocaleString("ru-RU")+(Number.isFinite(Number(mark.percent))?" · "+Math.round(mark.percent)+"%":""));
    main.append(title,detail);
    main.addEventListener("click",()=>{
      closeOverlays();
      const range=$("readerProgressRange");
      if(range&&Number.isFinite(Number(mark.percent))){range.value=String(Math.max(0,Math.min(1000,Math.round(Number(mark.percent)*10))));range.dispatchEvent(new Event("change",{bubbles:true}));}
      else toastReader("Для этой закладки нет сохранённой позиции.");
    });
    const del=make("button","reader-bookmark-delete","×");del.type="button";del.setAttribute("aria-label","Удалить закладку");
    del.addEventListener("click",async()=>{await remove("bookmarks",mark.id);openBookmarks();});
    row.append(main,del);body.append(row);
  }
  const add=make("button","reader-panel-primary","＋ Добавить закладку здесь");add.type="button";
  add.addEventListener("click",()=>{ $("bookmarkBtn").click(); setTimeout(openBookmarks,180); });
  body.append(add);
  showSubpanel("Закладки","ЭТА КНИГА · ВСЕ МЕСТА",body);
}
function settingRow(label, value, action){
  const row=make("button","reader-settings-list");row.type="button";row.append(make("span","",label),make("b","",value||"›"));row.addEventListener("click",action);return row;
}
function openSettingPage(key){
  const body=make("div","reader-setting-controls");
  const addFontButtons=()=>{
    const row=make("div","reader-setting-buttons");
    const down=make("button","secondary","A−");const up=make("button","secondary","A＋");
    down.type=up.type="button";down.addEventListener("click",()=>$("fontDown").click());up.addEventListener("click",()=>$("fontUp").click());
    row.append(down,up);body.append(row);
  };
  const field=(label,control)=>{
    const wrap=make("label","reader-setting-field",label);wrap.append(control);body.append(wrap);
  };
  if(key==="interface"){addFontButtons();body.append(make("p","reader-setting-note","Панели управления скрываются во время чтения. Коснитесь страницы, чтобы показать их снова."));}
  if(key==="text"){
    addFontButtons();
    const font=make("select");[["Georgia, serif","Книжный (Georgia)"],["Arial, sans-serif","Современный (Arial)"],["system-ui, sans-serif","Системный"],["'Times New Roman', serif","Times New Roman"]].forEach(([v,t])=>font.add(new Option(t,v)));
    font.value=localStorage.getItem("mirror-reader-font")||"Georgia, serif";
    font.addEventListener("change",()=>{view.style.setProperty("--reader-font-family",font.value);localStorage.setItem("mirror-reader-font",font.value);});
    field("Гарнитура",font);
    const line=make("input");line.type="range";line.min="1.3";line.max="2.2";line.step=".05";line.value=localStorage.getItem("mirror-reader-line-height")||"1.8";
    const output=make("output","",Number(line.value).toLocaleString("ru-RU"));line.addEventListener("input",()=>{view.style.setProperty("--reader-line-height",line.value);output.textContent=Number(line.value).toLocaleString("ru-RU");localStorage.setItem("mirror-reader-line-height",line.value);});
    const wrap=make("label","reader-setting-field","Межстрочный интервал");wrap.append(output,line);body.append(wrap);
  }
  if(key==="layout"){
    const width=make("input");width.type="range";width.min="320";width.max="780";width.step="10";width.value=localStorage.getItem("mirror-reader-width")||"780";
    width.addEventListener("input",()=>{ $("readerContent").style.maxWidth=width.value+"px";localStorage.setItem("mirror-reader-width",width.value);});
    field("Ширина книжной страницы",width);
    const margin=make("input");margin.type="range";margin.min="12";margin.max="60";margin.value=localStorage.getItem("mirror-reader-margin")||"24";
    margin.addEventListener("input",()=>{ $("readerContent").style.paddingLeft=margin.value+"px";$("readerContent").style.paddingRight=margin.value+"px";localStorage.setItem("mirror-reader-margin",margin.value);});
    field("Поля страницы",margin);
    const columns=make("select");columns.add(new Option("Одна колонка","1"));columns.add(new Option("Две колонки","2"));columns.value=localStorage.getItem("mirror-reader-columns")||"1";
    columns.addEventListener("change",()=>{ $("readerContent").style.columnCount=columns.value;localStorage.setItem("mirror-reader-columns",columns.value);});
    field("Колонки",columns);
  }
  if(key==="colors"){
    const row=make("div","reader-setting-buttons");
    [["Светлая","light"],["Сепия","sepia"],["Тёмная","night"]].forEach(([label,mode])=>{const b=make("button","secondary",label);b.type="button";b.addEventListener("click",()=>setReaderTheme(mode));row.append(b);});
    body.append(row);
  }
  if(key==="speech"){
    const b=make("button","reader-panel-primary","Открыть настройки голоса");b.type="button";b.addEventListener("click",()=>{settingsSheet.hidden=true;openAudioSettings();});body.append(b);
    body.append(make("p","reader-setting-note","Качество и набор голосов определяются системным движком синтеза речи на устройстве."));
  }
  if(key==="progress"){
    const p=make("p","reader-setting-note","Прогресс чтения сохраняется автоматически. Шкала перехода появляется вместе с панелями управления.");body.append(p);
  }
  if(key==="gestures"){
    body.append(make("p","reader-setting-note","Вертикальная прокрутка перемещает текст внутри книжной рамки. Горизонтальный жест перелистывает страницы там, где формат поддерживает постраничное чтение."));
  }
  if(key==="translation"){
    body.append(make("p","reader-setting-note","Переводчик и словарь будут связаны с отдельными инструментами ©Mirror. Пока эта страница показывает доступность функции, но не имитирует отсутствующую офлайн-базу словарей."));
  }
  if(key==="about"){
    body.append(make("p","reader-setting-note","©Mirror Reader — часть личной библиотеки ©Mirror. Версия интерфейса: 1.0. Чтение и настройки сохраняются в браузере на этом устройстве."));
  }
  showSubpanel(({interface:"Интерфейс",text:"Текст и шрифты",layout:"Столбцы и отступы",colors:"Цвета",speech:"Синтез речи",progress:"Прогресс чтения",gestures:"Листание и жесты",translation:"Словарь и переводчик",about:"О программе"})[key]||"Настройки","НАСТРОЙКИ",body);
}
function setReaderTheme(mode){
  view.classList.remove("reader-night","reader-sepia");
  if(mode==="night")view.classList.add("reader-night");
  if(mode==="sepia")view.classList.add("reader-sepia");
  localStorage.setItem("mirror-reader-theme",mode);
  $("readerThemeToggle").textContent=mode==="night"?"☾":mode==="sepia"?"◒":"◐";
}
function syncReaderSettings(){
  const font=localStorage.getItem("mirror-reader-font");if(font)view.style.setProperty("--reader-font-family",font);
  const line=localStorage.getItem("mirror-reader-line-height");if(line)view.style.setProperty("--reader-line-height",line);
  const width=localStorage.getItem("mirror-reader-width");if(width)$("readerContent").style.maxWidth=width+"px";
  const margin=localStorage.getItem("mirror-reader-margin");if(margin){$("readerContent").style.paddingLeft=margin+"px";$("readerContent").style.paddingRight=margin+"px";}
  const columns=localStorage.getItem("mirror-reader-columns");if(columns)$("readerContent").style.columnCount=columns;
  setReaderTheme(localStorage.getItem("mirror-reader-theme")||"light");
}
function openAudioSettings(){
  closeOverlays();audioDock.hidden=false;audioSettings.hidden=false;showScrim();
  syncVoiceOptions();
  $("readerRateRange").value=speechRate?.value||"0.9";
  $("readerRateValue").textContent=Number($("readerRateRange").value).toLocaleString("ru-RU");
  $("readerPitchRange").value=localStorage.getItem("mirror-tts-pitch")||"1";
  $("readerPitchValue").textContent=Number($("readerPitchRange").value).toLocaleString("ru-RU");
}
function syncVoiceOptions(){
  const target=$("readerVoiceSelect");if(!target||!speechVoice)return;
  const current=speechVoice.value;target.replaceChildren(...[...speechVoice.options].map(o=>new Option(o.textContent,o.value)));
  target.value=current;
}
function updateAudioState(){
  const speaking=!!window.speechSynthesis?.speaking,paused=!!window.speechSynthesis?.paused;
  $("readerAudioPlay").textContent=paused?"▶":speaking?"Ⅱ":"▶";
  $("readerAudioPlay").setAttribute("aria-label",paused?"Продолжить чтение":speaking?"Пауза":"Начать чтение");
  $("readerAudioStatus").textContent=paused?"Пауза":speaking?"Идёт чтение вслух":$("ttsStatus")?.textContent||"Готово к чтению";
}
function openAudioDock(start){
  closeOverlays();audioDock.hidden=false;updateAudioState();
  if(start&&!window.speechSynthesis?.speaking&&!window.speechSynthesis?.paused)$("ttsPlayBtn").click();
}
function searchBook(){
  const term=$("readerSearchInput").value.trim();
  if(!term){$("readerSearchStatus").textContent="Введите слово или фразу.";return;}
  let found=false;
  try{found=typeof window.find==="function"&&window.find(term,false,false,true,false,false,false);}catch{}
  if(!found){
    const root=$("readerContent");const text=root.innerText||root.textContent||"";
    const idx=text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    $("readerSearchStatus").textContent=idx>=0?"Совпадение найдено в тексте. Используйте поиск браузера или прокрутку для перехода.":"Совпадений в видимом тексте не найдено.";
  }else $("readerSearchStatus").textContent="Найдено совпадение.";
}

$("readerActionsBtn").addEventListener("click",()=>{if(!drawer.hidden)closeOverlays();else showDrawer();});
$("readerDrawerClose").addEventListener("click",closeOverlays);
$("readerScrim").addEventListener("click",closeOverlays);
$("readerSubpanelBack").addEventListener("click",showDrawer);
$("readerSubpanelClose").addEventListener("click",closeOverlays);
$("readerDrawer").addEventListener("click",event=>{
  const item=event.target.closest("[data-reader-panel]");if(!item)return;
  const action=item.dataset.readerPanel;
  if(action==="info"){closeOverlays();runLegacyAction("details");}
  else if(action==="bookmarks")openBookmarks();
  else if(action==="speak")openAudioDock(true);
  else if(action==="library"){closeOverlays();runLegacyAction("library");}
  else if(action==="file"){closeOverlays();runLegacyAction("open-device");}
  else if(action==="network"){
    const body=make("div","reader-panel-empty","Сетевая библиотека пока не подключена к серверному каталогу. Личные книги уже доступны из локальной библиотеки устройства. Подключение синхронизации добавим отдельным этапом, чтобы не подвергать риску ваши файлы.");
    showSubpanel("Сетевая библиотека","ПОДКЛЮЧЕНИЕ",body);
  }
});
$("readerMenuBtn").addEventListener("click",event=>{
  event.stopPropagation();closeOverlays();
  $("readerSettingsMenu").hidden=true;$("readerMenuBtn").setAttribute("aria-expanded","false");
  settingsSheet.hidden=false;showScrim();
});
$("readerSettingsClose").addEventListener("click",closeOverlays);
$("readerSettingsSheet").addEventListener("click",event=>{const item=event.target.closest("[data-setting-page]");if(item)openSettingPage(item.dataset.settingPage);});
$("readerThemeToggle").addEventListener("click",()=>setReaderTheme(view.classList.contains("reader-night")?"light":view.classList.contains("reader-sepia")?"night":"sepia"));
$("readerSearchBtn").addEventListener("click",()=>{$("readerSearchDialog").showModal();$("readerSearchInput").focus();});
$("readerSearchNext").addEventListener("click",searchBook);
$("readerSearchInput").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();searchBook();}});
$("readerChooseBookBtn")?.addEventListener("click",()=>runLegacyAction("open-library"));
$("readerAudioSettingsBtn").addEventListener("click",openAudioSettings);
$("readerAudioSettingsClose").addEventListener("click",()=>{audioSettings.hidden=true;scrim.hidden=true;});
$("readerAudioClose").addEventListener("click",()=>{audioDock.hidden=true;audioSettings.hidden=true;scrim.hidden=true;});
$("readerAudioPlay").addEventListener("click",()=>{
  if(window.speechSynthesis?.speaking&&!window.speechSynthesis.paused)$("ttsPauseBtn").click();
  else if(window.speechSynthesis?.paused)$("ttsPauseBtn").click();
  else $("ttsPlayBtn").click();
  setTimeout(updateAudioState,120);
});
$("readerAudioPrev").addEventListener("click",()=>$("prevBtn").click());
$("readerAudioNext").addEventListener("click",()=>$("nextBtn").click());
$("readerAudioStatus").addEventListener("click",updateAudioState);
$("readerRateRange").addEventListener("input",event=>{
  const value=Number(event.target.value);$("readerRateValue").textContent=value.toLocaleString("ru-RU");
  if(speechRate){let closest=[...speechRate.options].sort((a,b)=>Math.abs(Number(a.value)-value)-Math.abs(Number(b.value)-value))[0];speechRate.value=closest.value;speechRate.dispatchEvent(new Event("change",{bubbles:true}));}
});
$("readerPitchRange").addEventListener("input",event=>{
  const value=Number(event.target.value);$("readerPitchValue").textContent=value.toLocaleString("ru-RU");localStorage.setItem("mirror-tts-pitch",String(value));
});
$("readerVoiceSelect").addEventListener("change",event=>{if(speechVoice){speechVoice.value=event.target.value;speechVoice.dispatchEvent(new Event("change",{bubbles:true}));}});
$("readerSystemTtsHelp").addEventListener("click",()=>toastReader("Android: Настройки → Специальные возможности (или Общие настройки) → Преобразование текста в речь."));
$("readerContent").addEventListener("click",event=>{
  if(event.target.closest("a,button,input,select,textarea"))return;
  if(window.getSelection?.().toString())return;
  if(!isReaderOpen())return;
  view.classList.toggle("reader-chrome-visible");
});
$("readerContent").addEventListener("scroll",()=>{if(!audioDock.hidden)updateAudioState();},{passive:true});
$("readerDrawerBookTitle").textContent=$("readerBookTitle").textContent||"Моя книга";
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"){closeOverlays();view.classList.remove("reader-chrome-visible");}
});
$("readerSettingsSheet").addEventListener("click",event=>{if(event.target===settingsSheet)closeOverlays();});
const speechObserver=new MutationObserver(()=>{updateAudioState();syncVoiceOptions();});
const frameTapObserver=new MutationObserver(()=>{
  $("readerContent").querySelectorAll("iframe").forEach(frame=>{
    if(frame.dataset.readerTapBound)return;
    frame.dataset.readerTapBound="1";
    const bind=()=>{try{
      const doc=frame.contentDocument;
      if(!doc||doc.documentElement.dataset.mirrorTapBound)return;
      doc.documentElement.dataset.mirrorTapBound="1";
      doc.addEventListener("click",()=>{
        if(!doc.getSelection?.().toString())view.classList.toggle("reader-chrome-visible");
      });
    }catch(error){console.debug("EPUB frame controls:",error);}};
    frame.addEventListener("load",bind);bind();
  });
});
frameTapObserver.observe($("readerContent"),{childList:true,subtree:true});
if($("ttsStatus"))speechObserver.observe($("ttsStatus"),{childList:true,subtree:true,characterData:true});
if($("ttsPlayBtn"))speechObserver.observe($("ttsPlayBtn"),{childList:true,subtree:true,characterData:true});
if(window.speechSynthesis?.addEventListener)window.speechSynthesis.addEventListener("voiceschanged",syncVoiceOptions);
const openObserver=new MutationObserver(()=>{
  if(isReaderOpen()){
    view.classList.remove("reader-chrome-visible");
    closeOverlays();syncReaderSettings();
    $("readerDrawerBookTitle").textContent=$("readerBookTitle").textContent||"Моя книга";
  }
});
openObserver.observe(view,{attributes:true,attributeFilter:["class"]});
syncReaderSettings();
