// functions/diag-auth.ts
interface Env {
  DB: D1Database;
  API_KEY?: string;
  ADMIN_TOKEN?: string;
  ADMIN_KEY?: string; // 古い環境変数名が残っている可能性に対応
}

function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h.trim());
  return m ? m[1].trim() : null;
}

function getHeader(req: Request, name: string): string | null {
  const v = req.headers.get(name) || req.headers.get(name.toLowerCase());
  return v ? v.trim() : null;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const base = {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  };
  return new Response(JSON.stringify(data), base);
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { env, request } = ctx;
  const api = env.API_KEY ?? "";
  const adminA = env.ADMIN_TOKEN ?? "";
  const adminB = env.ADMIN_KEY ?? ""; // 存在すれば検出

  const presented =
    getBearer(request) ||
    getHeader(request, "x-api-key") ||
    getHeader(request, "x-admin-key");

  const presentedTrim = (presented || "").replace(/\s+/g, "");

  const apiMatch =
    api && presentedTrim && presentedTrim === api ? "API_KEY" : "";

  let adminMatch = "";
  if (adminA && presentedTrim === adminA) adminMatch = "ADMIN_TOKEN";
  if (!adminMatch && adminB && presentedTrim === adminB) adminMatch = "ADMIN_KEY";

  const apiVars: [string, number][] = [];
  if (api) apiVars.push(["API_KEY", api.length]);

  const adminVars: [string, number][] = [];
  if (adminA) adminVars.push(["ADMIN_TOKEN", adminA.length]);
  if (adminB) adminVars.push(["ADMIN_KEY", adminB.length]);

  return json({
    ok: true,
    hasApi: Boolean(api),
    hasAdmin: Boolean(adminA || adminB),
    authPresent: Boolean(presentedTrim),
    apiVars,
    adminVars,
    apiMatch,
    adminMatch,
  });
};
