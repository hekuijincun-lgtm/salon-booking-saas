// _worker.js — Cloudflare Pages から上流 Worker へ中継
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ←← ここを必ず自分の Worker ドメインに！
    const UPSTREAM = "https://saas.hekuijincun.workers.dev";

    // 上流にパスする共通関数
    const pass = async (path) => {
      const target = new URL(path + url.search, UPSTREAM);
      const h = new Headers(request.headers);

      // 互換: x-admin-token → x-admin-key
      const t = h.get("x-admin-token");
      if (t && !h.has("x-admin-key")) h.set("x-admin-key", t);

      // （任意）Pages の Secret をヘッダへ
      if (env.API_KEY && !h.has("x-api-key")) h.set("x-api-key", env.API_KEY);
      if (env.METRICS_KEY && !h.has("x-metrics-key")) h.set("x-metrics-key", env.METRICS_KEY);
      if (env.ADMIN_KEY && !h.has("x-admin-key")) h.set("x-admin-key", env.ADMIN_KEY);

      const init = { method: request.method, headers: h };
      if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
      return fetch(target.toString(), init);
    };

    // 中継したいルート
    if (url.pathname === "/api"    && request.method === "POST") return pass("/api");
    if (url.pathname === "/diag"   && request.method === "POST") return pass("/diag");
    if (url.pathname === "/list"   && request.method === "GET")  return pass("/list");
    if (url.pathname === "/item"   && request.method === "GET")  return pass("/item");
    if (url.pathname === "/health" && request.method === "GET")  return pass("/health");
    if (url.pathname === "/metrics")                              return pass("/metrics"); // 追加

    // デバッグ用
    if (url.pathname === "/_debug" && request.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        mode: "pages_gateway",
        upstream: UPSTREAM,
        hasApiKey: typeof env.API_KEY === "string" && env.API_KEY.length >= 16
      }), { headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store" }});
    }

    // それ以外は静的アセット（index.html / admin.html）
    return env.ASSETS.fetch(request);
  }
}
