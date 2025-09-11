// /_worker.js  ← リポジトリ直下（Pagesの配信ルート直下）
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ★ 上流（本体 Worker）— 必要なら自分の URL に変更
    const UPSTREAM = "https://saas.hekuijincun.workers.dev";

    // 便利デバッグ: /_debug でゲートウェイ状態確認
    if (url.pathname === "/_debug") {
      return new Response(JSON.stringify({
        ok: true,
        mode: "pages_gateway",
        upstream: UPSTREAM,
        path: url.pathname,
        method: req.method,
        host: url.host,
      }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    // ===== プロキシ判定 =====
    // 上流へ中継したいピンポイントのパス
    const exact = new Set(["/api", "/metrics", "/health", "/diag", "/list", "/item"]);
    const toUpstream =
      exact.has(url.pathname) ||
      // /admin/* は（POST含め）全部 上流へ
      url.pathname.startsWith("/admin/");

    if (toUpstream) {
      const upstreamURL = new URL(UPSTREAM + url.pathname + url.search);

      // 元ヘッダを引き継ぎつつ、上流で役立つ情報を付加
      const headers = new Headers(req.headers);
      headers.set("x-forwarded-host", url.host);
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for");
      if (ip) headers.set("x-forwarded-for", ip);

      // GET/HEAD 以外はボディを転送
      let body;
      if (req.method !== "GET" && req.method !== "HEAD") {
        body = await req.arrayBuffer();
      }

      try {
        return await fetch(upstreamURL, {
          method: req.method,
          headers,
          body,
          redirect: "manual",
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok:false, error:"upstream_error", detail:String(err) }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
        });
      }
    }

    // /admin トップは静的 UI（admin.html）を返す
    if (url.pathname === "/admin" && req.method === "GET") {
      const r = new Request(new URL("/admin.html", url.origin), req);
      return env.ASSETS.fetch(r);
    }

    // それ以外は普通に静的配信（index.html や画像/JS/CSSなど）
    return env.ASSETS.fetch(req);
  },
};
