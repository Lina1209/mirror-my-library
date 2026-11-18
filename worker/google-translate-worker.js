const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";

function corsHeaders(origin, allowedOrigin) {
  const allowed = allowedOrigin === "*" ? "*" : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}
function json(data, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin, allowedOrigin) }
  });
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";
    if (!env.GOOGLE_TRANSLATE_API_KEY) return json({ error: "Translation service is not configured." }, 503, origin || "*", allowedOrigin || "*");
    if (!allowedOrigin) return json({ error: "Configure the ALLOWED_ORIGIN variable in your Worker." }, 503, origin || "*", "*");
    if (allowedOrigin !== "*" && origin !== allowedOrigin) {
      return json({ error: "Origin is not allowed." }, 403, origin, allowedOrigin);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
    }
    const url = new URL(request.url);
    if (url.pathname === "/languages" && request.method === "GET") {
      const target = url.searchParams.get("target") || "en";
      const google = new URL(GOOGLE_TRANSLATE_URL + "/languages");
      google.searchParams.set("key", env.GOOGLE_TRANSLATE_API_KEY);
      google.searchParams.set("target", target);
      const response = await fetch(google);
      const data = await response.json();
      if (!response.ok) return json({ error: "Google Cloud Translation could not return languages." }, response.status, origin, allowedOrigin);
      return json({ languages: (data.data?.languages || []).map(item => ({ code: item.language, name: item.name })) }, 200, origin, allowedOrigin);
    }
    if (url.pathname !== "/translate" || request.method !== "POST") {
      return json({ error: "Not found." }, 404, origin, allowedOrigin);
    }
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON body." }, 400, origin, allowedOrigin); }
    const target = String(body.target || "");
    const contents = body.contents;
    if (!/^[a-zA-Z-]{2,12}$/.test(target) || !Array.isArray(contents) || contents.length < 1 || contents.length > 80 ||
        contents.some(value => typeof value !== "string" || value.length > 5000) ||
        contents.reduce((sum, value) => sum + value.length, 0) > 30000) {
      return json({ error: "Invalid translation request or text batch is too large." }, 400, origin, allowedOrigin);
    }
    const response = await fetch(GOOGLE_TRANSLATE_URL + "?key=" + encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ q: contents, target, format: "text" })
    });
    const data = await response.json();
    if (!response.ok) {
      return json({ error: data.error?.message || "Google Cloud Translation request failed." }, response.status, origin, allowedOrigin);
    }
    return json({ translations: (data.data?.translations || []).map(item => ({ translatedText: item.translatedText })) }, 200, origin, allowedOrigin);
  }
};
