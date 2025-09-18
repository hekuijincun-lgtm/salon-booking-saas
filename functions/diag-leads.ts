interface Env {
  DB: D1Database;
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

function getAdminSecret(env: Env): string | null {
  return env.ADMIN_TOKEN || env.ADMIN_KEY || env.ADMIN || null;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const token = readToken(request);
  const admin = getAdminSecret(env);
  if (!token || !admin || token !== admin) return json({ ok: false, error: "unauthorized", need: "admin" }, 401);

  const url = new URL(request.url);
  const tenant = url.searchParams.get("tenant") || "";

  const { results } = await env.DB.prepare(
    `SELECT id, tenant, name, email, channel, note, created_at
       FROM leads
      WHERE (?1 = '' OR tenant = ?1)
      ORDER BY created_at DESC`
  ).bind(tenant).all();

  return json({ ok: true, items: results || [] });
};
