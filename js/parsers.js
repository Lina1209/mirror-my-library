function decodeFB2Bytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 256));
  const declared = prefix.match(/encoding\s*=\s*["']([^"']+)["']/i)?.[1];
  const candidates = [declared, "utf-8", "windows-1251", "koi8-r", "utf-16le", "utf-16be"].filter(Boolean);
  const tried = new Set();
  for (const label of candidates) {
    const normalized = label.toLowerCase();
    if (tried.has(normalized)) continue;
    tried.add(normalized);
    try {
      const text = new TextDecoder(label, { fatal: true }).decode(bytes);
      if (text.includes("<FictionBook") || /<\s*FictionBook\b/i.test(text)) return text;
      if (!text.includes("\uFFFD")) return text;
    } catch {}
  }
  try { return new TextDecoder("windows-1251").decode(bytes); }
  catch { return new TextDecoder().decode(bytes); }
}

export function decodeFB2(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  let text = decodeFB2Bytes(bytes);
  try {
    xmlParser(text);
    return text;
  } catch (firstError) {
    const fallback = new TextDecoder("windows-1251").decode(bytes);
    if (fallback !== text) {
      try { xmlParser(fallback); return fallback; } catch {}
    }
    throw firstError;
  }
}

export function decodeText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 512));
  const declared = prefix.match(/(?:charset\s*=\s*|encoding\s*=\s*)["']?([\w.-]+)/i)?.[1];
  const candidates = [declared, "utf-8", "windows-1251", "koi8-r"].filter(Boolean);
  const tried = new Set();
  for (const label of candidates) {
    const key = label.toLowerCase();
    if (tried.has(key)) continue;
    tried.add(key);
    try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch {}
  }
  return new TextDecoder("windows-1251").decode(bytes);
}

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

async function epubCoverData(zip, opf, opfPath) {
  const manifest = [...opf.getElementsByTagNameNS("*", "item")];
  const coverMeta = [...opf.getElementsByTagNameNS("*", "meta")]
    .find(node => node.getAttribute("name")?.toLowerCase() === "cover")?.getAttribute("content");
  const item = manifest.find(node =>
    /cover-image/i.test(node.getAttribute("properties") || "") ||
    (coverMeta && node.getAttribute("id") === coverMeta)
  );
  if (!item) return "";
  const href = item.getAttribute("href") || "";
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const path = (base + href).split("/").reduce((parts, part) => {
    if (!part || part === ".") return parts;
    if (part === "..") parts.pop(); else parts.push(part);
    return parts;
  }, []).join("/");
  const file = zip.file(path);
  if (!file) return "";
  const bytes = await file.async("uint8array");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const mime = item.getAttribute("media-type") || (/\.png$/i.test(path) ? "image/png" : /\.gif$/i.test(path) ? "image/gif" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg");
  return "data:" + mime + ";base64," + btoa(binary);
}

export async function extractMetadata(file, ext) {
  const fallback = {
    title: String(file.name || "Без названия").replace(/\.(fb2|epub|pdf|txt|html?|zip|docx?|xlsx?|csv)$/i, ""),
    author: "Автор не указан"
  };

  try {
    if (ext === "fb2") {
      const xml = xmlParser(decodeFB2(await file.arrayBuffer()));
      const author = ["first-name", "middle-name", "last-name"]
        .map(name => textOf(xml, name)).filter(Boolean).join(" ");
      const coverRef = byLocalName(byLocalName(xml, "coverpage") || xml, "image");
      const coverId = (coverRef?.getAttributeNS("http://www.w3.org/1999/xlink", "href")
        || coverRef?.getAttribute("href") || "").replace(/^#/, "");
      const binary = [...xml.getElementsByTagNameNS("*", "binary")]
        .find(node => node.getAttribute("id") === coverId);
      const mime = String(binary?.getAttribute("content-type") || "image/jpeg").toLowerCase();
      const encoded = String(binary?.textContent || "").replace(/\s+/g, "");
      const coverData = binary && /^image\/(png|jpeg|gif|webp)$/.test(mime) && /^[a-z0-9+/=]+$/i.test(encoded)
        ? "data:" + mime + ";base64," + encoded : "";
      return {
        title: textOf(xml, "book-title") || fallback.title,
        author: author || fallback.author,
        ...(coverData ? { coverData } : {})
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
          const coverData = await epubCoverData(zip, opf, opfPath);
          return {
            title: textOf(opf, "title") || fallback.title,
            author: textOf(opf, "creator") || fallback.author,
            ...(coverData ? { coverData } : {})
          };
        }
      }
    }
  } catch (error) {
    console.warn("Не удалось прочитать метаданные или обложку:", error);
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

  const binaries = new Map();
  [...xml.getElementsByTagNameNS("*", "binary")].forEach(binary => {
    const id = binary.getAttribute("id");
    const mime = String(binary.getAttribute("content-type") || "").toLowerCase();
    const base64 = String(binary.textContent || "").replace(/\s+/g, "");
    if (id && /^image\/(png|jpeg|gif|webp)$/.test(mime) && /^[a-z0-9+/=]+$/i.test(base64)) {
      binaries.set(id, { mime, base64 });
    }
  });

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
      const reference = node.getAttributeNS("http://www.w3.org/1999/xlink", "href")
        || node.getAttribute("href") || "";
      const binary = binaries.get(reference.replace(/^#/, ""));
      if (binary) {
        const image = document.createElement("img");
        image.className = "fb2-image";
        image.loading = "lazy";
        image.alt = node.getAttribute("alt") || "Иллюстрация из FB2";
        image.src = "data:" + binary.mime + ";base64," + binary.base64;
        return image;
      }
      const placeholder = document.createElement("span");
      placeholder.className = "fb2-image-placeholder";
      placeholder.textContent = "[Иллюстрация не найдена в файле FB2]";
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
