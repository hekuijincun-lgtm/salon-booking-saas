// _worker.js — Cloudflare Pages (Proxy-safe, v3)
const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";
const API_HEADER = "x-api-key";
const DEFAULT_TENANT = "salon-booking-saas";
const VERSION = "proxy-pass-v3";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // Health
    if (url.pathname === "/health") {
      return json({ ok: true, where: "pages _worker.js", v: VERSION, t: new Date().toISOString() });
    }

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ---- /api → Worker proxy（ボディは絶対に触らない）----
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers);

      // API Key 注入
      if (env.API_KEY) {
        if (!headers.has(API_HEADER)) headers.set(API_HEADER, env.API_KEY);
        if (!headers.has("authorization")) headers.set("authorization", `Bearer ${env.API_KEY}`);
      }

      // tenant 決定（header → query → env → default）
      const tenant =
        headers.get("x-tenant") ||
        headers.get("x-tenant-id") ||
        url.searchParams.get("tenant") ||
        env.TENANT ||
        env.TENANT_NAME ||
        DEFAULT_TENANT;

      headers.set("x-tenant", tenant);
      headers.delete("host");

      // ←←← ここが肝：body を読み取らず、そのままストリーム転送
      const init = { method, headers, redirect: "manual" };
      if (!["GET", "HEAD"].includes(method)) init.body = request.body;

      const upstream = WORKER_API_BASE + url.pathname + url.search;
      const resp = await fetch(upstream, init);
      return withCors(resp, request);
    }

    // /admin は /admin.html を 200 リライト
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      const r = new Request(new URL("/admin.html", url), request);
      const res = await env.ASSETS.fetch(r);
      return noCacheHTML(res);
    }

    // 静的 + SPA フォールバック
    let res = await env.ASSETS.fetch(request);
    if (res.status === 404) {
      const last = (url.pathname.split("/").pop() || "");
      if (!last.includes(".")) {
        const r = new Request(new URL("/index.html", url), request);
        res = await env.ASSETS.fetch(r);
      }
    }
    return noCacheHTML(res);
  },
};

// helpers
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
