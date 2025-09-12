// _worker.js — Cloudflare Pages (Advanced Functions)

const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";
const API_HEADER = "x-api-key";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // --- health ---
    if (url.pathname === "/health") {
      return json({ ok: true, where: "pages _worker.js", t: new Date().toISOString() });
    }

    // --- preflight ---
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // --- /api → Worker proxy（API鍵 & tenant 自動注入）---
    if (url.pathname.startsWith("/api")) {
      const target = new URL(url.pathname + url.search, WORKER_API_BASE);

      const h = new Headers(request.headers);
      if (env.API_KEY) {
        if (!h.has(API_HEADER)) h.set(API_HEADER, env.API_KEY);
        if (!h.has("authorization")) h.set("authorization", `Bearer ${env.API_KEY}`);
      }

      // tenant 決定（ヘッダ→クエリ→ホスト名→ENV）
      let tenant = h.get("x-tenant") || url.searchParams.get("tenant");
      if (!tenant) {
        const parts = url.hostname.split(".");               // e.g. 5985ad81.salon-booking-saas.pages.dev
        const pagesIdx = parts.indexOf("pages");
        if (pagesIdx > 0) tenant = parts[pagesIdx - 1];      // -> "salon-booking-saas"
      }
      if (!tenant && env.TENANT) tenant = env.TENANT;

      if (tenant && !h.has("x-tenant")) h.set("x-tenant", tenant);

      // JSONボディにも tenant を注入（未指定なら）
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

    // --- /admin を絶対に rewrite（NO redirect / HEADでもGETで取得）---
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      const getAsset = (path) =>
        env.ASSETS.fetch(new Request(new URL(path, url), { method: "GET", headers: request.headers }));
      let res = await getAsset("/admin.html");
      if (res.status === 404) res = await getAsset("/admin/index.html");
      return noCacheHTML(res);
    }

    // --- 通常アセット ---
    let res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return noCacheHTML(res);

    // --- SPA fallback（拡張子なしのみ / HEADでもGETで取得）---
    const last = url.pathname.split("/").pop() || "";
    if (!last.includes(".")) {
      res = await env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: "GET", headers: request.headers }));
      return noCacheHTML(res);
    }

    return res;
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
