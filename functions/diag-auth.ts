// functions/diag-auth.ts
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const norm = (s: string) =>
    (s || "").replace(/^\s*Bearer\s+/i, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

  const authRaw = request.headers.get("authorization") || request.headers.get("x-api-key") || "";
  const auth = norm(authRaw);

  const get = (k: string) => {
    const v = (env as any)[k];
    return typeof v === "string" ? norm(v) : "";
  };

  const apiVars   = ["API_KEY", "API", "API_TOKEN"].map(k => [k, get(k)]).filter(([,v]) => v);
  const adminVars = ["ADMIN_TOKEN", "ADMIN_KEY"].map(k => [k, get(k)]).filter(([,v]) => v);

  const match = (vars: [string,string][]) => (vars.find(([,v]) => v === auth)?.[0] || "");

  return new Response(JSON.stringify({
    ok: true,
    hasApi:   apiVars.length > 0,
    hasAdmin: adminVars.length > 0,
    authPresent: !!auth,
    apiVars:   apiVars.map(([k,v]) => [k, v.length]),
    adminVars: adminVars.map(([k,v]) => [k, v.length]),
    apiMatch:   match(apiVars),
    adminMatch: match(adminVars),
  }), { headers: { "content-type": "application/json" }});
};
