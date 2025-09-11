// _worker.js もしくは ui/_worker.js（どちらか片方だけ置く）
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 上流（Workers 本体）
    const UPSTREAM = "https://saas.hekuijincun.workers.dev";

    // デバッグ
    if (path === "/_debug") {
      return new Response(JSON.stringify({
        ok: true,
        mode: "pages_gateway",
        upstream: UPSTREAM,
        path,
        method: req.method,
        host: url.host,
      }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" }});
    }

    // ★ ここがポイント：/admin と /admin/ は常に admin.html を返す（中継しない）
    if (path === "/admin" || path === "/admin/") {
      const r = new Request(new URL("/admin.html", url.origin), req);
      return env.ASSETS.fetch(r);
    }

    // 上流に中継するパス
    const proxy =
      path === "/api"     ||
      path === "/metrics" ||
      path === "/health"  ||
      path === "/diag"    ||
      path === "/list"    ||
      path === "/item"    ||
      path.startsWith("/admin/"); // 管理API系（/admin/_debug, /admin/tenants.create など）

    if (proxy) {
      const u = new URL(UPSTREAM + path + url.search);
      const hdr = new Headers(req.headers);
      hdr.set("x-forwarded-host", url.host);

      const init = { method: req.method, headers: hdr };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = await req.arrayBuffer(); // ボディを安全に転送
      }
      return fetch(u.toString(), init);
    }

    // それ以外は静的配信（index.html 等）
    return env.ASSETS.fetch(req);
  },
}
