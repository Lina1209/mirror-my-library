function xmlParser(raw) {
  const doc = new DOMParser().parseFromString(raw, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement) {
    throw new Error("Повреждённый XML в файле книги.");
  }
  return doc;
}

function byLocalName(root, name) {
  return root.getElementsByTagNameNS?.("*", name)?.[0]
    || root.getElementsByTagName?.(name)?.[0]
    || null;
}

function textOf(root, name) {
  return byLocalName(root, name)?.textContent?.trim() || "";
}

export function extension(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".fb2.zip")) return "fb2.zip";
  return lower.split(".").pop() || "";
}

export async function extractMetadata(file, ext) {
  const fallback = {
    title: String(file.name || "Без названия").replace(/\.(fb2|epub|pdf|txt|html?|zip)$/i, ""),
    author: "Автор не указан"
  };

  try {
    if (ext === "fb2") {
      const xml = xmlParser(await file.text());
      const author = ["first-name", "middle-name", "last-name"]
        .map(name => textOf(xml, name)).filter(Boolean).join(" ");
      return {
        title: textOf(xml, "book-title") || fallback.title,
        author: author || fallback.author
      };
    }

    if (ext === "epub" && window.JSZip) {
      const zip = await window.JSZip.loadAsync(file);
      const containerFile = zip.file("META-INF/container.xml");
      if (containerFile) {
        const container = xmlParser(await containerFile.async("string"));
        const opfPath = byLocalName(container, "rootfile")?.getAttribute("full-path");
        const opfFile = opfPath && zip.file(opfPath);
        if (opfFile) {
          const opf = xmlParser(await opfFile.async("string"));
          return {
            title: textOf(opf, "title") || fallback.title,
            author: textOf(opf, "creator") || fallback.author
          };
        }
      }
    }
  } catch (error) {
    console.warn("Не удалось прочитать метаданные:", error);
  }
  return fallback;
}

export async function readFB2(file) {
  const xml = xmlParser(await file.text());
  const body = byLocalName(xml, "body");
  if (!body) throw new Error("В FB2 не найден основной текст (body).");
  return body;
}

export async function readText(file) {
  return file.text();
}

export function safeHTML(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("script, iframe, object, embed, form, base, meta, link, style, video, audio")
    .forEach(node => node.remove());

  const allowedProtocols = /^(https?:|mailto:|tel:|data:image\/)/i;
  doc.querySelectorAll("*").forEach(element => {
    [...element.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "srcdoc" || name === "style") {
        element.removeAttribute(attribute.name);
      } else if (["href", "src", "xlink:href", "formaction"].includes(name)
        && value && !value.startsWith("#") && !allowedProtocols.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return doc.body.innerHTML;
}

export function fb2ToHTML(raw) {
  const xml = xmlParser(raw);
  const body = byLocalName(xml, "body");
  if (!body) throw new Error("В FB2 отсутствует основной раздел body.");

  const allowed = new Set([
    "p", "title", "subtitle", "section", "strong", "emphasis",
    "strikethrough", "sub", "sup", "code", "poem", "stanza",
    "v", "text-author", "date", "epigraph", "cite", "annotation",
    "table", "tr", "td", "th"
  ]);

  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

    const tag = String(node.localName || node.nodeName).toLowerCase();
    if (tag === "binary") return document.createDocumentFragment();

    if (tag === "image") {
      const placeholder = document.createElement("span");
      placeholder.className = "fb2-image-placeholder";
      placeholder.textContent = "[Иллюстрация из FB2]";
      return placeholder;
    }

    if (tag === "empty-line") return document.createElement("br");

    const output = document.createElement(allowed.has(tag) ? tag : "span");
    [...node.childNodes].forEach(child => output.append(convert(child)));
    return output;
  }

  const container = document.createElement("div");
  [...body.childNodes].forEach(child => container.append(convert(child)));
  return container.innerHTML;
}
