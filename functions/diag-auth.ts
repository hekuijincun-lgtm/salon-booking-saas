// /functions/diag-auth.ts
export interface Env {
  API_KEY?: string; API?: string; API_TOKEN?: string;
  ADMIN_TOKEN?: string; ADMIN_KEY?: string;
}

const cors = (req: Request) => ({
  "access-control-allow-origin": req.headers.get("origin") || "*",
  "access-control-allow-headers": "authorization,content-type,x-api-key",
  "access-control-allow-methods": "GET,OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(req) } });

const vals = (env: Env, ks: string[]) => ks.map(k => (env as any)[k] as string | undefined).filter(Boolean).map(s => s!.trim());
const apiVars   = (env: Env) => vals(env, ["API_KEY","API","API_TOKEN"]);
const adminVars = (env: Env) => vals(env, ["ADMIN_TOKEN","ADMIN_KEY"]);

const readToken = (req: Request) => {
  const a = req.headers.get("authorization");
  if (a && /^bearer\s+/i.test(a)) return a.replace(/^bearer\s+/i,'').trim();
  const x = req.headers.get("x-api-key");
  return (x && x.trim()) || null;
};

export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: cors(request) });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const REQUIRE_ADMIN = true; // ← 必須
  const token = readToken(request);
  const hasApi = apiVars(env).length > 0;
  const hasAdmin = adminVars(env).length > 0;

  if (REQUIRE_ADMIN) {
    const ok = token && adminVars(env).some(v => v === token);
    if (!ok) return json(request, { ok: false, error: "unauthorized", need: "admin" }, 401);
  }

  // ここまで来たら表示
  const apiList   = apiVars(env).map(v => ["API_KEY", v.length] as [string, number]);
  const adminList = adminVars(env).map(v => ["ADMIN_TOKEN", v.length] as [string, number]);
  const apiMatch   = token && apiVars(env).some(v => v === token) ? "API_KEY" : "";
  const adminMatch = token && adminVars(env).some(v => v === token) ? "ADMIN_TOKEN" : "";

  return json(request, {
    ok: true,
    hasApi, hasAdmin,
    authPresent: Boolean(token),
    apiVars: apiList,
    adminVars: adminList,
    apiMatch, adminMatch,
  });
};
