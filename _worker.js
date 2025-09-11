// _worker.js  — Cloudflare Pages (Advanced) 用
// 目的: /admin → /admin.html を redirect せず "rewrite" で配信
//       SPA ルーティングは /index.html に rewrite（拡張子がないパスのみ）
//       HTMLはキャッシュ無効化（ループ/更新遅延対策）

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // GET/HEAD 以外はそのまま静的配信へ
    if (method !== "GET" && method !== "HEAD") {
      return env.ASSETS.fetch(request);
    }

    // --- /admin を /admin.html に "内部書き換え"（NO redirect）---
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      // 1) admin.html を試す
      let res = await env.ASSETS.fetch(
        new Request(new URL("/admin.html", url), request)
      );
      // 2) もし無ければ admin/index.html にフォールバック
      if (res.status === 404) {
        res = await env.ASSETS.fetch(
          new Request(new URL("/admin/index.html", url), request)
        );
      }
      return noCacheHTML(res);
    }

    // --- まずは通常の静的アセット配信 ---
    let res = await env.ASSETS.fetch(request);
    if (res.status !== 404) {
      // HTMLだけはキャッシュ無効化
      return noCacheHTML(res);
    }

    // --- SPA フォールバック（拡張子が無いパスのみ）---
    const lastSeg = url.pathname.split("/").pop() || "";
    const looksLikeFile = lastSeg.includes(".");
    if (!looksLikeFile) {
      res = await env.ASSETS.fetch(
        new Request(new URL("/index.html", url), request)
      );
      return noCacheHTML(res);
    }

    // 本当に無い静的ファイル（例: /foo.js 404）はそのまま返す
    return res;
  },
};

// HTMLのときだけ Cache-Control を no-store にする（308等の誤キャッシュ対策）
function noCacheHTML(res) {
  const headers = new Headers(res.headers);
  const ct = headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
