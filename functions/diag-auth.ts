interface Env {
  API_KEY?: string; API?: string; API_TOKEN?: string;
  ADMIN_TOKEN?: string; ADMIN_KEY?: string; ADMIN?: string;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function readToken(req: Request): string | null {
  const h = req.headers;
  const auth = h.get("authorization") || h.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return h.get("x-api-key") || h.get("X-API-KEY");
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const t = readToken(request);

  const apiVars: [string, number][] = [];
  for (const k of ["API_KEY", "API", "API_TOKEN"] as const) {
    const v = env[k];
    if (v) apiVars.push([k, v.length]);
  }

  const adminVars: [string, number][] = [];
  for (const k of ["ADMIN_TOKEN", "ADMIN_KEY", "ADMIN"] as const) {
    const v = env[k];
    if (v) adminVars.push([k, v.length]);
  }

  let apiMatch = "", adminMatch = "";
  if (t) {
    for (const [k] of apiVars) if ((env as any)[k] === t) apiMatch = k;
    for (const [k] of adminVars) if ((env as any)[k] === t) adminMatch = k;
  }

  return json({
    ok: true,
    hasApi: apiVars.length > 0,
    hasAdmin: adminVars.length > 0,
    authPresent: !!t,
    apiVars,
    adminVars,
    apiMatch,
    adminMatch,
  });
};
