// _worker.js — Cloudflare Pages (Safe & Simple)
// 役割：/api を Workers にプロキシ（API鍵 & tenant 自動注入）
// それ以外は ASSETS（=静的配信 + _redirects 200 Rewrite）に丸投げ。

const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";
const API_HEADER = "x-api-key";
const DEFAULT_TENANT = "salon-booking-saas";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const method = request.method;

      // Health
      if (url.pathname === "/health") {
        return json({ ok: true, where: "pages _worker.js", t: new Date().toISOString() });
      }

      // CORS preflight
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      // ---- /api → Worker proxy（API鍵 & tenant 自動注入）----
      if (url.pathname.startsWith("/api")) {
        const h = new Headers(request.headers);

        // API Key
        if (env.API_KEY) {
          if (!h.has(API_HEADER)) h.set(API_HEADER, env.API_KEY);
          if (!h.has("authorization")) h.set("authorization", `Bearer ${env.API_KEY}`);
        }

        // tenant 決定（ヘッダ → クエリ → ホスト名 → ENV → デフォルト）
        let tenant = h.get("x-tenant") || url.searchParams.get("tenant");
        if (!tenant) {
          const parts = url.hostname.split(".");
          const pagesIdx = parts.indexOf("pages");
          if (pagesIdx > 0) tenant = parts[pagesIdx - 1]; // salon-booking-saas
        }
        if (!tenant && env.TENANT) tenant = env.TENANT;
        if (!tenant) tenant = DEFAULT_TENANT;

        h.set("x-tenant", tenant);
        h.delete("host");

        // JSON ボディにも tenant を注入（未指定なら）
        let body;
        if (!["GET", "HEAD"].includes(method)) {
          const ct = (h.get("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            const txt = await request.text();
            let data = {};
            try { data = txt ? JSON.parse(txt) : {}; } catch { data = {}; }
            if (data.tenant == null) data.tenant = tenant;
            body = JSON.stringify(data);
          } else {
            body = request.body;
          }
        }

        const target = new URL(url.pathname + url.search, WORKER_API_BASE);
        const resp = await fetch(new Request(target, { method, headers: h, body, redirect: "follow" }));
        return withCors(resp, request);
      }

      // ---- ここから静的配信（_redirects を尊重）----
      let res = await env.ASSETS.fetch(request);

      // SPA fallback（拡張子なし & 404 のときだけ）
      if (res.status === 404) {
        const last = url.pathname.split("/").pop() || "";
        if (!last.includes(".")) {
          res = await env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: "GET" }));
        }
      }

      return noCacheHTML(res);
    } catch (e) {
      return json({ ok: false, error: "worker_exception", message: String(e) }, { status: 500 });
    }
  },
};

// ---- helpers ----
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
