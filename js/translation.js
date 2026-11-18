const STORAGE_KEY = "mirror-google-translation";
const CACHE_KEY = "mirror-translation-cache-v1";
const originalNodes = new Map();
const originalAttributes = new Map();
let observer;
let activeLanguage = "ru";
let endpoint = "";
let translating = false;
let queued = false;

const languageFallback = [
  ["af","Afrikaans"],["sq","Albanian"],["am","Amharic"],["ar","Arabic"],["hy","Armenian"],["az","Azerbaijani"],
  ["eu","Basque"],["be","Belarusian"],["bn","Bengali"],["bs","Bosnian"],["bg","Bulgarian"],["ca","Catalan"],
  ["zh-CN","Chinese (Simplified)"],["zh-TW","Chinese (Traditional)"],["hr","Croatian"],["cs","Czech"],["da","Danish"],
  ["nl","Dutch"],["en","English"],["et","Estonian"],["fi","Finnish"],["fr","French"],["gl","Galician"],["ka","Georgian"],
  ["de","German"],["el","Greek"],["gu","Gujarati"],["ht","Haitian Creole"],["ha","Hausa"],["he","Hebrew"],["hi","Hindi"],
  ["hu","Hungarian"],["is","Icelandic"],["id","Indonesian"],["ga","Irish"],["it","Italian"],["ja","Japanese"],["jv","Javanese"],
  ["kn","Kannada"],["kk","Kazakh"],["km","Khmer"],["ko","Korean"],["ky","Kyrgyz"],["lo","Lao"],["lv","Latvian"],
  ["lt","Lithuanian"],["mk","Macedonian"],["ms","Malay"],["ml","Malayalam"],["mr","Marathi"],["mn","Mongolian"],
  ["my","Myanmar"],["ne","Nepali"],["no","Norwegian"],["fa","Persian"],["pl","Polish"],["pt","Portuguese"],
  ["pa","Punjabi"],["ro","Romanian"],["ru","Russian"],["sr","Serbian"],["si","Sinhala"],["sk","Slovak"],
  ["sl","Slovenian"],["so","Somali"],["es","Spanish"],["sw","Swahili"],["sv","Swedish"],["tl","Filipino"],
  ["ta","Tamil"],["te","Telugu"],["th","Thai"],["tr","Turkish"],["uk","Ukrainian"],["ur","Urdu"],["uz","Uzbek"],
  ["vi","Vietnamese"],["cy","Welsh"],["yi","Yiddish"],["zu","Zulu"]
];

function getSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ endpoint, language: activeLanguage }));
}
function getCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function setCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
  catch { /* Cache is optional when browser storage is full. */ }
}
function cleanEndpoint(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}
function isExcluded(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return true;
  return !!element.closest("script,style,noscript,textarea,input,select,option,svg,canvas,#readerView,.reader-view,.reader-content,#readerBookTitle,.book-grid,#detailsBody,[data-translate-skip]");
}
function collectTargets(root = document.body) {
  const targets = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (isExcluded(node) || !node.nodeValue.trim()) continue;
    if (!originalNodes.has(node)) originalNodes.set(node, node.nodeValue);
    targets.push({ get: () => node.nodeValue, set: value => { node.nodeValue = value; }, original: originalNodes.get(node) });
  }
  const elements = root.querySelectorAll ? [root, ...root.querySelectorAll("*")] : [];
  for (const el of elements) {
    if (!(el instanceof Element) || isExcluded(el)) continue;
    for (const attr of ["placeholder", "title", "aria-label"]) {
      if (!el.hasAttribute(attr) || !el.getAttribute(attr).trim()) continue;
      let map = originalAttributes.get(el);
      if (!map) { map = new Map(); originalAttributes.set(el, map); }
      if (!map.has(attr)) map.set(attr, el.getAttribute(attr));
      targets.push({ get: () => el.getAttribute(attr), set: value => el.setAttribute(attr, value), original: map.get(attr) });
    }
  }
  return targets;
}
function restoreOriginals() {
  for (const [node, value] of originalNodes) {
    if (node.isConnected) node.nodeValue = value;
  }
  for (const [el, attrs] of originalAttributes) {
    if (!el.isConnected) continue;
    for (const [name, value] of attrs) el.setAttribute(name, value);
  }
}
async function translateBatch(texts, targetLanguage) {
  const response = await fetch(endpoint + "/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: targetLanguage, contents: texts })
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).error || ""; } catch {}
    throw new Error(detail || `Ошибка сервиса перевода (${response.status})`);
  }
  const data = await response.json();
  if (!Array.isArray(data.translations) || data.translations.length !== texts.length) {
    throw new Error("Сервис вернул неполный перевод.");
  }
  return data.translations.map(item => item.translatedText);
}
async function translateTargets(targets, lang) {
  const cache = getCache();
  const pending = [];
  for (const item of targets) {
    const source = item.original;
    if (!source || !source.trim()) continue;
    const key = lang + "|" + source;
    if (cache[key]) item.set(cache[key]);
    else pending.push({ item, source, key });
  }
  for (let i = 0; i < pending.length; i += 80) {
    const batch = pending.slice(i, i + 80);
    const translated = await translateBatch(batch.map(item => item.source), lang);
    batch.forEach((item, index) => {
      cache[item.key] = translated[index];
      item.item.set(translated[index]);
    });
    setCache(cache);
    setStatus(`Переведено: ${Math.min(i + batch.length, pending.length)} / ${pending.length}`);
  }
}
function setStatus(message, error = false) {
  const status = document.getElementById("translationStatus");
  if (status) {
    status.textContent = message;
    status.classList.toggle("translation-error", error);
  }
}
async function getLanguages() {
  const response = await fetch(endpoint + "/languages?target=en");
  if (!response.ok) throw new Error("Не удалось получить список языков.");
  const data = await response.json();
  return Array.isArray(data.languages) ? data.languages : languageFallback.map(([code, name]) => ({ code, name }));
}
function makePanel() {
  const actions = document.querySelector(".top-actions");
  if (!actions || document.getElementById("translationToggle")) return;
  const toggle = document.createElement("button");
  toggle.id = "translationToggle";
  toggle.className = "secondary translation-toggle";
  toggle.type = "button";
  toggle.textContent = "🌐 Перевод";
  toggle.setAttribute("aria-expanded", "false");
  const panel = document.createElement("section");
  panel.id = "translationPanel";
  panel.className = "translation-panel hidden";
  panel.innerHTML = `
    <label for="translationEndpoint">Адрес защищённого сервиса</label>
    <input id="translationEndpoint" type="url" placeholder="https://ваш-сервис.workers.dev">
    <div class="translation-panel-row">
      <label for="translationLanguage">Язык интерфейса</label>
      <select id="translationLanguage"><option value="ru">Русский</option></select>
    </div>
    <button id="translationApply" class="primary" type="button">Перевести интерфейс</button>
    <button id="translationReset" class="secondary" type="button">Вернуть исходный язык</button>
    <p id="translationStatus" role="status">Книги в читалке не переводятся.</p>`;
  actions.append(toggle);
  document.querySelector(".topbar").append(panel);
  toggle.addEventListener("click", async () => {
    panel.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", String(!panel.classList.contains("hidden")));
    if (!panel.classList.contains("hidden")) await populateLanguages();
  });
  $("translationEndpoint").addEventListener("change", async () => {\n    endpoint = cleanEndpoint($("translationEndpoint").value);\n    $("translationLanguage").dataset.loaded = "";\n    await populateLanguages();\n  });\n  $("translationApply").addEventListener("click", applyTranslation);
  $("translationReset").addEventListener("click", () => {
    restoreOriginals();
    activeLanguage = "ru";
    document.documentElement.lang = "ru";
    saveSettings();
    setStatus("Исходный язык восстановлен.");
  });
  $("translationEndpoint").value = endpoint;
  $("translationLanguage").value = activeLanguage;
}
function $(id) { return document.getElementById(id); }
async function populateLanguages() {
  const select = $("translationLanguage");
  if (select.dataset.loaded === "yes") return;
  select.replaceChildren();
  try {
    const languages = endpoint ? await getLanguages() : languageFallback.map(([code, name]) => ({ code, name }));
    languages.sort((a, b) => a.name.localeCompare(b.name));
    for (const language of languages) {
      const option = document.createElement("option");
      option.value = language.code;
      option.textContent = language.name;
      select.append(option);
    }
    select.value = activeLanguage;
    select.dataset.loaded = "yes";
    if (!endpoint) setStatus("Сначала укажите адрес сервиса Google Cloud Translation.");
  } catch (error) {
    select.replaceChildren(...languageFallback.map(([code, name]) => {
      const option = document.createElement("option"); option.value = code; option.textContent = name; return option;
    }));
    select.value = activeLanguage;
    setStatus(error.message, true);
  }
}
async function applyTranslation() {
  endpoint = cleanEndpoint($("translationEndpoint").value);
  activeLanguage = $("translationLanguage").value;
  if (!endpoint) { setStatus("Введите адрес защищённого сервиса перевода.", true); return; }
  if (!/^https:\/\//i.test(endpoint)) { setStatus("Адрес сервиса должен начинаться с https://", true); return; }
  if (activeLanguage === "ru") {
    restoreOriginals();
    document.documentElement.lang = "ru";
    saveSettings();
    setStatus("Русский язык включён.");
    return;
  }
  if (translating) return;
  translating = true;
  $("translationApply").disabled = true;
  setStatus("Подготавливаем перевод…");
  try {
    restoreOriginals();
    const targets = collectTargets();
    await translateTargets(targets, activeLanguage);
    document.documentElement.lang = activeLanguage;
    saveSettings();
    setStatus("Интерфейс переведён. Тексты книг не затронуты.");
  } catch (error) {
    console.error("Google translation:", error);
    setStatus(error.message || "Не удалось перевести интерфейс.", true);
  } finally {
    translating = false;
    $("translationApply").disabled = false;
  }
}
function queueDynamicTranslation() {
  if (queued || activeLanguage === "ru" || !endpoint) return;
  queued = true;
  setTimeout(async () => {
    queued = false;
    if (translating) return;
    translating = true;
    try { await translateTargets(collectTargets(), activeLanguage); }
    catch (error) { setStatus(error.message, true); }
    finally { translating = false; }
  }, 120);
}
function init() {
  const settings = getSettings();
  endpoint = cleanEndpoint(settings.endpoint);
  activeLanguage = settings.language || "ru";
  makePanel();
  if (activeLanguage !== "ru" && endpoint) {
    document.documentElement.lang = "ru";
    setTimeout(async () => { await populateLanguages(); $("translationLanguage").value = activeLanguage; await applyTranslation(); }, 250);
  }
  observer = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node =>
      node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim())
    ))) queueDynamicTranslation();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
