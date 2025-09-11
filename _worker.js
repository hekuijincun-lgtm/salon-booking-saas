// _worker.js — Cloudflare Pages (Advanced Functions)
// /api → https://saas.hekuijincun.workers.dev にプロキシ（APIキー＆tenant自動注入）
// /admin → /admin.html（or /admin/index.html）へ rewrite（NO redirect）
// SPA fallback → /index.html（拡張子なしのとき）
// HTMLは no-store、/api 応答は CORS 付与、/health あり

const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";
const API_HEADER = "x-api-key";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // ---- Health check ----
    if (url.pathname === "/health") {
      return json({ ok: true, where: "pages _worker.js", t: new Date().toISOString() });
    }

    // ---- CORS preflight ----
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ---- /api proxy → Worker ----
    if (url.pathname.startsWith("/api")) {
      const target = new URL(url.pathname + url.search, WORKER_API_BASE);
      const h = new Headers(request.headers);

      // API key 自動付与（Pagesの環境変数 API_KEY を使う）
      if (env.API_KEY) {
        if (!h.has(API_HEADER)) h.set(API_HEADER, env.API_KEY);
        if (!h.has("authorization")) h.set("authorization", `Bearer ${env.API_KEY}`);
      }

      // --- tenant 決定 ---
      let tenant = h.get("x-tenant") || url.searchParams.get("tenant");
      if (!tenant) {
        // 例: 9bd3c776.salon-booking-saas.pages.dev → "salon-booking-saas"
        const parts = url.hostname.split(".");
        const pagesIdx = parts.indexOf("pages");
        if (pagesIdx > 0) tenant = parts[pagesIdx - 1];
      }
      if (!tenant && env.TENANT) tenant = env.TENANT; // カスタムドメイン用フォールバック
      if (tenant && !h.has("x-tenant")) h.set("x-tenant", tenant);

      // JSONボディに tenant を注入（未指定なら）
      let body;
      if (!["GET", "HEAD"].includes(method)) {
        const ct = (h.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          const txt = await request.text();
          try {
            const data = txt ? JSON.parse(txt) : {};
            if (tenant != null && data.tenant == null) data.tenant = tenant;
            body = JSON.stringify(data);
          } catch {
            body = txt;
          }
        } else {
          body = request.body;
        }
      }

      h.delete("host");
      const proxied = new Request(target, { method, headers: h, body, redirect: "follow" });
      const resp = await fetch(proxied);
      return withCors(resp, request);
    }

    // ---- /admin rewrite（NO redirect）----
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      let res = await env.ASSETS.fetch(new Request(new URL("/admin.html", url), request));
      if (res.status === 404) {
        res = await env.ASSETS.fetch(new Request(new URL("/admin/index.html", url), request));
      }
      return noCacheHTML(res);
    }

    // ---- 通常静的アセット ----
    let res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return noCacheHTML(res);

    // ---- SPA fallback（拡張子なしのURLのみ）----
    const last = url.pathname.split("/").pop() || "";
    if (!last.includes(".")) {
      res = await env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
      return noCacheHTML(res);
    }

    return res;
  },
};

function noCacheHTML(res) {
  const headers = new Headers(res.headers);
  const ct = (headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html")) headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
function json(data, init) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    ...init,
  });
}
function corsHeaders(req) {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key,x-tenant",
    "Access-Control-Max-Age": "86400",
  };
}
function withCors(res, req) {
  const h = new Headers(res.headers);
  const c = corsHeaders(req);
  for (const k of Object.keys(c)) h.set(k, c[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
