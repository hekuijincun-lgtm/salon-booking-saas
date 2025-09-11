// _worker.js (Pages Gateway) — full replace
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 上流 Worker のドメイン（WorkersのOverview→Default domain）
    const UPSTREAM = (env && env.UPSTREAM) || "https://saas.<YOUR_WORKER>.workers.dev";

    // 上流に中継する関数
    const pass = async (path) => {
      const target = new URL(path + url.search, UPSTREAM);
      const h = new Headers(request.headers);

      // 互換: x-admin-token を x-admin-key にリマップ（念のため）
      if (h.get("x-admin-token") && !h.get("x-admin-key")) {
        h.set("x-admin-key", h.get("x-admin-token"));
      }

      const init = { method: request.method, headers: h };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }
      return fetch(target.toString(), init);
    };

    // 上流に中継するルート（/admin.html から使うやつ）
    if (url.pathname === "/api"    && request.method === "POST") return pass("/api");
    if (url.pathname === "/diag"   && request.method === "POST") return pass("/diag");
    if (url.pathname === "/list"   && request.method === "GET")  return pass("/list");
    if (url.pathname === "/item"   && request.method === "GET")  return pass("/item");
    if (url.pathname === "/health" && request.method === "GET")  return pass("/health"); // 疎通チェック用

    // それ以外は静的アセット（index.html, admin.html など）
    return env.ASSETS.fetch(request);
  }
}
