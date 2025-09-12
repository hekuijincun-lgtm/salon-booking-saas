// _worker.js — Cloudflare Pages (Advanced Functions)

// === 設定（必要なら変更） =======================================
const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";
const API_HEADER = "x-api-key";
// フォールバック用のデフォルト・テナント（保険）
const DEFAULT_TENANT = "salon-booking-saas";
// ===============================================================

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

      // ---- /api → Worker proxy（API鍵 & tenant を強制注入）----
      if (url.pathname.startsWith("/api")) {
        const target = new URL(url.pathname + url.search, WORKER_API_BASE);

        const h = new Headers(request.headers);

        // APIキー（Pages 環境変数 API_KEY を使用）
        if (env.API_KEY) {
          if (!h.has(API_HEADER)) h.set(API_HEADER, env.API_KEY);
          if (!h.has("authorization")) h.set("authorization", `Bearer ${env.API_KEY}`);
        }

        // tenant の決定（ヘッダ→クエリ→ホスト名→ENV→デフォルト）
        let tenant = h.get("x-tenant") || url.searchParams.get("tenant");
        if (!tenant) {
          const parts = url.hostname.split(".");         // e.g. salon-booking-saas.pages.dev
          const pagesIdx = parts.indexOf("pages");
          if (pagesIdx > 0) tenant = parts[pagesIdx - 1]; // "salon-booking-saas"
        }
        if (!tenant && env.TENANT) tenant = env.TENANT;
        if (!tenant) tenant = DEFAULT_TENANT;

        // ヘッダに各種バリアントを注入（実装差異に耐える）
        h.set("x-tenant", tenant);
        h.set("x-tenant-id", tenant);
        h.set("x-tenant-name", tenant);
        h.set("x-project", tenant);
        // 不要ヘッダ除去
        h.delete("host");

        // JSONボディにも埋め込み（未指定なら）
        let body;
        if (!["GET", "HEAD"].includes(method)) {
          const ct = (h.get("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            const txt = await request.text();
            try {
              const data = txt ? JSON.parse(txt) : {};
              if (data.tenant == null) data.tenant = tenant;
              if (data.tenantId == null) data.tenantId = tenant;
              if (data.tenant_id == null) data.tenant_id = tenant;
              if (data.project == null) data.project = tenant;
              body = JSON.stringify(data);
            } catch {
              body = txt; // 解析失敗時は素通し
            }
          } else {
            body = request.body;
          }
        }

        const proxied = new Request(target, { method, headers: h, body, redirect: "follow" });
        const resp = await fetch(proxied);
        return withCors(resp, request);
      }

      // ---- /admin を必ず rewrite（NO redirect / HEADでもGETで取得）----
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        // ※ request.headers をそのまま渡すと禁止ヘッダで落ちることがあるので渡さない
        const getAsset = (path) => env.ASSETS.fetch(new Request(new URL(path, url), { method: "GET" }));
        let res = await getAsset("/admin.html");
        if (res.status === 404) res = await getAsset("/admin/index.html");
        return noCacheHTML(res);
      }

      // ---- 通常アセット ----
      let res = await env.ASSETS.fetch(request);
      if (res.status !== 404) return noCacheHTML(res);

      // ---- SPA fallback（拡張子なしのみ / HEADでもGETで取得）----
      const last = url.pathname.split("/").pop() || "";
      if (!last.includes(".")) {
        res = await env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: "GET" }));
        return noCacheHTML(res);
      }

      return res;
    } catch (e) {
      // 例外は 500 JSON で返してデバッグしやすく
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
    "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key,x-tenant,x-tenant-id,x-tenant-name,x-project",
    "Access-Control-Max-Age": "86400",
  };
}
function withCors(res, req) {
  const h = new Headers(res.headers);
  const c = corsHeaders(req);
  for (const k of Object.keys(c)) h.set(k, c[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
