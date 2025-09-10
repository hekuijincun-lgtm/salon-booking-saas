export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id",
      "Vary": "origin",
    };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });

    const WORKER = "https://saas.hekuijincun.workers.dev";

    const pass = async (upstreamPath) => {
      const body = await request.arrayBuffer();
      let ct = request.headers.get("content-type") || "application/json; charset=utf-8";
      if (ct.startsWith("application/json") && !/charset=/i.test(ct)) ct += "; charset=utf-8";

      const h = new Headers();
      h.set("content-type", ct);
      h.set("x-api-key", env.API_KEY);           // ← Pages Secret(API_KEY) を使う
      const tenant = request.headers.get("x-tenant-id");
      if (tenant) h.set("x-tenant-id", tenant);  // ← テナントを転送

      const res = await fetch(WORKER + upstreamPath + (url.search || ""), { method: "POST", headers: h, body });
      const out = new Response(res.body, { status: res.status, statusText: res.statusText });
      out.headers.set("Access-Control-Allow-Origin", "*");
      out.headers.append("Vary", "origin");
      out.headers.set("content-type", res.headers.get("content-type") || "application/json; charset=utf-8");
      out.headers.set("Cache-Control", "no-store");
      return out;
    };

    if (url.pathname === "/api"  && request.method === "POST") return pass("/api");
    if (url.pathname === "/diag" && request.method === "POST") return pass("/diag");

    if (url.pathname === "/_debug" && request.method === "GET") {
      const hasKey = typeof env.API_KEY === "string" && env.API_KEY.length >= 16;
      return new Response(JSON.stringify({ ok:true, mode:"_worker.js_active", has_api_key:hasKey }), {
        headers: { "content-type": "application/json; charset=utf-8", ...cors }
      });
    }

    return env.ASSETS.fetch(request);
  }
}