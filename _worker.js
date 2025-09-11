// _worker.js — Cloudflare Pages (Advanced Mode)
// 役割：
//  - /api を専用 Worker (saas.hekuijincun.workers.dev) へプロキシ
//  - /admin を /admin.html（なければ /admin/index.html）に rewrite
//  - SPA ルーティングは /index.html に rewrite（拡張子なしのパスのみ）
//  - HTMLは no-store（リダイレクト/古キャッシュ対策）
//  - /health で稼働確認

const WORKER_API_BASE = "https://saas.hekuijincun.workers.dev";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- ヘルスチェック ---
    if (url.pathname === "/health") {
      return json({ ok: true, where: "pages _worker.js", t: new Date().toISOString() });
    }

    // --- /api を Worker へプロキシ（メソッド/ボディ/ヘッダそのまま）---
    if (url.pathname.startsWith("/api")) {
      const target = new URL(url.pathname + url.search, WORKER_API_BASE);
      const req = new Request(target, request); // メソッド/ボディ/ヘッダを引き継ぐ
      const h = new Headers(req.headers);
      h.delete("host"); // 念のため
      return fetch(new Request(target, { method: req.method, headers: h, body: req.body, redirect: "follow" }));
    }

    // --- /admin は /admin.html (なければ /admin/index.html) に rewrite（NO redirect）---
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      let res = await env.ASSETS.fetch(new Request(new URL("/admin.html", url), request));
      if (res.status === 404) {
        res = await env.ASSETS.fetch(new Request(new URL("/admin/index.html", url), request));
      }
      return noCacheHTML(res);
    }

    // --- まず通常の静的アセット ---
    let res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return noCacheHTML(res);

    // --- SPA フォールバック（拡張子が無いときだけ）---
    const last = url.pathname.split("/").pop() || "";
    if (!last.includes(".")) {
      res = await env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
      return noCacheHTML(res);
    }

    // 本当に無いファイルはそのまま 404
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
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": "no-store" }, ...init });
}
