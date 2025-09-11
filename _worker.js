// _worker.js — Cloudflare Pages (Advanced)
// 役割：
//  - /api → saas.hekuijincun.workers.dev へプロキシしつつ APIキー自動付与
//  - /admin → /admin.html（無ければ /admin/index.html）に rewrite（NO redirect）
//  - SPA ルーティング → /index.html に rewrite（拡張子なしのとき）
//  - HTMLは no-store（古キャッシュ＆誤リダイレ対策）
//  - CORS: 同一オリジンなら影響なし、外部からでも通るよう許可
//  - /health で稼働確認

const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";
const API_HEADER = "x-api-key";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // -------- Health --------
    if (url.pathname === "/health") {
      return json({ ok: true, where: "pages _worker.js", t: new Date().toISOString() });
    }

    // -------- CORS preflight --------
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // -------- /api → Worker proxy（APIキー自動注入） --------
    if (url.pathname.startsWith("/api")) {
      const target = new URL(url.pathname + url.search, WORKER_API_BASE);

      // 元のヘッダをコピーしてAPIキーを注入
      const h = new Headers(request.headers);
      if (!h.has(API_HEADER) && env.API_KEY) h.set(API_HEADER, env.API_KEY);
      if (!h.has("authorization") && env.API_KEY) h.set("authorization", `Bearer ${env.API_KEY}`);

      // host等は不要
      h.delete("host");

      const proxied = new Request(target, {
        method,
        headers: h,
        body: ["GET", "HEAD"].includes(method) ? undefined : request.body,
        redirect: "follow",
      });

      const resp = await fetch(proxied);
      return withCors(resp, request);
    }

    // -------- /admin rewrite（NO redirect）--------
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      // まず /admin.html
      let res = await env.ASSETS.fetch(new Request(new URL("/admin.html", url), request));
      // 無ければ /admin/index.html
      if (res.status === 404) {
        res = await env.ASSETS.fetch(new Request(new URL("/admin/index.html", url), request));
      }
      return noCacheHTML(res);
    }

    // -------- 通常の静的アセット --------
    let res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return noCacheHTML(res);

    // -------- SPA fallback（拡張子なしのときだけ）--------
    const last = url.pathname.split("/").pop() || "";
    if (!last.includes(".")) {
      res = await env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
      return noCacheHTML(res);
    }

    // 本当に無いファイルはそのまま返す
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
    "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key",
    "Access-Control-Max-Age": "86400",
  };
}

function withCors(res, req) {
  const h = new Headers(res.headers);
  const c = corsHeaders(req);
  for (const k of Object.keys(c)) h.set(k, c[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
