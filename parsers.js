const decoder = new TextDecoder("utf-8");
export function extension(name) {
  const n = name.toLowerCase();
  if (n.endsWith(".fb2.zip")) return "fb2.zip";
  return n.split(".").pop();
}
export async function extractMetadata(file, ext) {
  const fallback = { title: file.name.replace(/\.(fb2|epub|pdf|txt|html?|zip)$/i, ""), author: "Автор не указан" };
  try {
    if (ext === "fb2") {
      const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
      return {
        title: xml.querySelector("book-title")?.textContent?.trim() || fallback.title,
        author: [xml.querySelector("first-name")?.textContent, xml.querySelector("middle-name")?.textContent, xml.querySelector("last-name")?.textContent].filter(Boolean).join(" ") || fallback.author
      };
    }
    if (ext === "epub" && window.JSZip) {
      const zip = await JSZip.loadAsync(file);
      const container = await zip.file("META-INF/container.xml")?.async("string");
      if (container) {
        const doc = new DOMParser().parseFromString(container, "application/xml");
        const opfPath = doc.querySelector("rootfile")?.getAttribute("full-path");
        const opf = opfPath && await zip.file(opfPath)?.async("string");
        if (opf) {
          const meta = new DOMParser().parseFromString(opf, "application/xml");
          return { title: meta.querySelector("title")?.textContent?.trim() || fallback.title, author: meta.querySelector("creator")?.textContent?.trim() || fallback.author };
        }
      }
    }
  } catch (e) { console.warn("Metadata extraction:", e); }
  return fallback;
}
export async function readFB2(file) {
  const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Не удалось прочитать XML внутри FB2.");
  const body = xml.querySelector("body");
  if (!body) throw new Error("В FB2 не найден основной текст.");
  return body.innerHTML;
}
export async function readText(file) { return await file.text(); }
export function safeHTML(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,form,base,meta[http-equiv]").forEach(el => el.remove());
  doc.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(a => {
      if (/^on/i.test(a.name) || ((a.name === "href" || a.name === "src") && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}
export function fb2ToHTML(raw) {
  const xml = new DOMParser().parseFromString(raw, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Повреждённый FB2/XML.");
  const body = xml.querySelector("body");
  if (!body) throw new Error("В FB2 отсутствует body.");
  const allowed = new Set(["p","title","subtitle","section","strong","emphasis","strikethrough","sub","sup","code","empty-line","poem","stanza","v","text-author","date","epigraph","cite","annotation","table","tr","td","th","image"]);
  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const tag = node.localName.toLowerCase();
    if (tag === "binary") return document.createDocumentFragment();
    const out = document.createElement(allowed.has(tag) && tag !== "image" ? (tag === "empty-line" ? "br" : tag) : "span");
    if (tag === "image") { out.textContent = "[Иллюстрация из FB2]"; out.className = "fb2-image-placeholder"; return out; }
    [...node.childNodes].forEach(child => out.append(convert(child)));
    return out;
  }
  const container = document.createElement("div");
  [...body.childNodes].forEach(n => container.append(convert(n)));
  return container.innerHTML;
}
