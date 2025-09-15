// functions/diag-auth.ts
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = (request.headers.get("authorization") || "").trim();

  // 受け取り側は "Bearer xxx" / "xxx" 両対応（空白やゼロ幅も除去）
  const norm = (s: string) =>
    s.replace(/^\s*Bearer\s+/i, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

  const authToken = norm(auth);

  const take = (v: any) => (typeof v === "string" ? v : "");
  const strip = (v: string) => v.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

  const apiCands: [string, string][] = [
    ["API_KEY",   strip(take((env as any).API_KEY))],
    ["API",       strip(take((env as any).API))],
    ["API_TOKEN", strip(take((env as any).API_TOKEN))],
  ].filter(([_, v]) => !!v);

  const adminCands: [string, string][] = [
    ["ADMIN_TOKEN", strip(take((env as any).ADMIN_TOKEN))],
    ["ADMIN_KEY",   strip(take((env as any).ADMIN_KEY))],
  ].filter(([_, v]) => !!v);

  const matchName = (cands: [string,string][]) =>
    cands.find(([_, v]) => v && v === authToken)?.[0] || "";

  return new Response(JSON.stringify({
    ok: true,
    authPresent: !!auth,
    apiVars: apiCands.map(([n, v]) => [n, v.length]),
    adminVars: adminCands.map(([n, v]) => [n, v.length]),
    apiMatch: matchName(apiCands),
    adminMatch: matchName(adminCands),
  }), { headers: { "content-type": "application/json" }});
};
