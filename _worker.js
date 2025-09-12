// _worker.js — Cloudflare Pages (Proxy-safe)
// /api を Workers にプロキシ（API鍵 & tenant をヘッダ注入だけ）
// 静的は ASSETS へ。/admin は 200 rewrite、SPA は index.html へフォールバック。

const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";
const API_HEADER = "x-api-key";
const DEFAULT_TENANT = "salon-booking-saas";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const method = request.method;

      // Health (for sanity checks)
      if (url.pathname === "/health") {
        return json({ ok: true, where: "pages _worker.js", t: new Date().toISOString() });
      }

      // CORS preflight
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      // ---- /api → Worker proxy（ボディは触らない！）----
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        const headers = new Headers(request.headers);

        // API Key
        if (env.API_KEY) {
          if (!headers.has(API_HEADER)) headers.set(API_HEADER, env.API_KEY);
          if (!headers.has("authorization")) headers.set("authorization", `Bearer ${env.API_KEY}`);
        }

        // tenant 決定：header → query → host → env → default
        let tenant =
          headers.get("x-tenant") ||
          headers.get("x-tenant-id") ||
          headers.get("x-tenant-name") ||
          headers.get("x-project") ||
          url.searchParams.get("tenant") ||
          env.TENANT ||
          env.TENANT_NAME ||
          DEFAULT_TENANT;

        headers.set("x-tenant", tenant);
        headers.delete("host"); // 余計な Host を除去

        // 重要：ボディはそのまま流す（読み取らない）
        const init = { method, headers, redirect: "manual" };
        if (!["GET", "HEAD"].includes(method)) init.body = request.body;

        const target = WORKER_API_BASE + url.pathname + url.search;
        const resp = await fetch(target, init);
        return withCors(resp, request);
      }

      // ---- /admin は /admin.html を 200 リライト（redirect しない）----
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        const r = new Request(new URL("/admin.html", url), request);
        const res = await env.ASSETS.fetch(r);
        return noCacheHTML(res);
      }

      // ---- 静的配信（_redirects も尊重）+ SPA フォールバック ----
      let res = await env.ASSETS.fetch(request);

      if (res.status === 404) {
        const last = (url.pathname.split("/").pop() || "");
        if (!last.includes(".")) {
          const r = new Request(new URL("/index.html", url), request);
          res = await env.ASSETS.fetch(r);
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
  const h = new Headers(res.headers);
  const ct = (h.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html")) h.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
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
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization,x-api-key,x-admin-key,x-metrics-key,x-tenant,x-tenant-id,x-tenant-name,x-project",
    "Access-Control-Max-Age": "86400",
  };
}
function withCors(res, req) {
  const h = new Headers(res.headers);
  const c = corsHeaders(req);
  for (const k of Object.keys(c)) h.set(k, c[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
