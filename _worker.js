// ui/_worker.js
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // ★ 上流（Cloudflare Workers 本体）
    const UPSTREAM = "https://saas.hekuijincun.workers.dev";

    // 便利なデバッグ: /_debug でゲートウェイの状態を確認
    if (url.pathname === "/_debug") {
      const j = {
        ok: true,
        mode: "pages_gateway",
        upstream: UPSTREAM,
        path: url.pathname,
        method: req.method,
        host: url.host,
      };
      return new Response(JSON.stringify(j, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // ===== ここからプロキシ判定 =====
    // 上流へ中継したいパスたち
    const proxyToUpstream =
      url.pathname === "/api" ||
      url.pathname === "/metrics" ||
      url.pathname === "/health" ||
      url.pathname === "/diag" ||
      url.pathname === "/list" ||
      url.pathname === "/item" ||
      // ← ここが今回の要：/admin/*（POST を含むすべてのメソッド）を上流に渡す
      url.pathname.startsWith("/admin/");

    if (proxyToUpstream) {
      const u = new URL(UPSTREAM + url.pathname + url.search);
      const hdr = new Headers(req.headers);
      hdr.set("x-forwarded-host", url.host);

      // POST/PUT などのボディを確実に転送
      let body;
      if (req.method !== "GET" && req.method !== "HEAD") {
        // arrayBuffer で安全に引き継ぐ
        body = await req.arrayBuffer();
      }

      return fetch(u.toString(), {
        method: req.method,
        headers: hdr,
        body,
      });
    }

    // /admin のトップ（UI）は静的ファイル admin.html を返す
    if (url.pathname === "/admin" && req.method === "GET") {
      const r = new Request(new URL("/admin.html", url.origin), req);
      return env.ASSETS.fetch(r);
    }

    // それ以外はふつうに静的配信（index.html, 画像, JS など）
    return env.ASSETS.fetch(req);
  },
};
