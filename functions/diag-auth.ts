// functions/diag-auth.ts
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = request.headers.get("authorization") || "";
  const apis = [
    ["API_KEY",   (env as any).API_KEY],
    ["API",       (env as any).API],
    ["API_TOKEN", (env as any).API_TOKEN],
  ].filter(([,v]) => !!v);
  const admins = [
    ["ADMIN_TOKEN", (env as any).ADMIN_TOKEN],
    ["ADMIN_KEY",   (env as any).ADMIN_KEY],
  ].filter(([,v]) => !!v);

  const match = (cands: [string,string][]) =>
    cands.find(([n,v]) => v && auth === `Bearer ${v}`)?.[0] || "";

  const apiMatch   = match(apis);
  const adminMatch = match(admins);

  return new Response(JSON.stringify({
    ok: true,
    authPresent: !!auth,
    apiMatch,          // ← "API_KEY" / "API" / "API_TOKEN" のどれに一致したか
    adminMatch,        // ← "ADMIN_TOKEN" / "ADMIN_KEY"
    apiVars:   apis.map(([n,v])=>[n, String(v).length]),
    adminVars: admins.map(([n,v])=>[n, String(v).length]),
  }), { headers: { "content-type":"application/json" }});
};
