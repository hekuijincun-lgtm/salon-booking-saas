// _worker.js (Cloudflare Pages gateway)
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 上流（本体 Workers）
    const UPSTREAM = "https://saas.hekuijincun.workers.dev";

    // デバッグ
    if (url.pathname === "/_debug") {
      return new Response(JSON.stringify({
        ok: true,
        mode: "pages_gateway",
        upstream: UPSTREAM,
        path: url.pathname,
        method: req.method,
        host: url.host,
      }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // --- 管理UIは /admin と /admin/ の両方で常に静的 admin.html を返す（ループ防止）
    if ((url.pathname === "/admin" || url.pathname === "/admin/") && req.method === "GET") {
      const r = new Request(new URL("/admin.html", url.origin), req);
      return env.ASSETS.fetch(r);
    }

    // --- 上流に中継するパス（管理APIや各種JSON系）
    const shouldProxy =
      url.pathname === "/api" ||
      url.pathname === "/metrics" ||
      url.pathname === "/health" ||
      url.pathname === "/diag" ||
      url.pathname === "/list" ||
      url.pathname === "/item" ||
      // /admin/以下の“深い”パスのみ上流へ（/admin と /admin/ は除外済み）
      (url.pathname.startsWith("/admin/") && url.pathname !== "/admin/");

    if (shouldProxy) {
      const upstreamURL = new URL(UPSTREAM + url.pathname + url.search);
      const hdr = new Headers(req.headers);
      hdr.set("x-forwarded-host", url.host);

      const init = { method: req.method, headers: hdr };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = await req.arrayBuffer();
      }
      return fetch(upstreamURL, init);
    }

    // それ以外は通常の静的配信（index.html など）
    return env.ASSETS.fetch(req);
  },
}
