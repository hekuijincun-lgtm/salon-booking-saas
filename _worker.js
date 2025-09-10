// _worker.js (drop-in)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- Preflight (将来別オリジンでも安心) ---
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type,authorization,x-admin-token,x-tenant-id,tenant",
          "Vary": "origin",
        },
      });
    }

    // --- Upstream pass helper ---
    const pass = async (upstreamPath) => {
      const host = env.API_HOST || "saas.hekuijincun.workers.dev";
      const forward = new URL(`https://${host}${upstreamPath}${url.search || ""}`);

      // 元リクエストのヘッダをコピーして上書き
      const h = new Headers(request.headers);

      // API_KEY は存在する時だけ付与（undefined対策）
      if (env.API_KEY) h.set("x-api-key", env.API_KEY);

      // tenant は両対応で受けて両方で中継（ズレ事故防止）
      const tenant =
        request.headers.get("x-tenant-id") || request.headers.get("tenant");
      if (tenant) {
        h.set("x-tenant-id", tenant);
        h.set("tenant", tenant);
      }

      const fwd = new Request(forward.toString(), {
        method: request.method,
        headers: h,
        body: ["GET", "HEAD", "OPTIONS"].includes(request.method)
          ? undefined
          : request.body, // ボディはそのままストリームで転送
        redirect: "manual",
      });

      const res = await fetch(fwd);
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Vary": "origin",
          "Cache-Control": "no-store",
          "Content-Type":
            res.headers.get("content-type") ||
            "application/json; charset=utf-8",
        },
      });
    };

    // --- Routes ---
    if (url.pathname === "/api" && request.method === "POST") return pass("/api");
    if (url.pathname === "/diag" && request.method === "POST") return pass("/diag");

    if (url.pathname === "/_debug" && request.method === "GET") {
      const hasKey = typeof env.API_KEY === "string" && env.API_KEY.length >= 8;
      const host = env.API_HOST || "saas.hekuijincun.workers.dev";
      return new Response(
        JSON.stringify({ ok: true, mode: "pages_gateway", hasKey, host }),
        { headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    // --- 静的アセット（index.html / admin.html 他） ---
    return env.ASSETS.fetch(request);
  },
};
