interface Env {
  DB: D1Database;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const tenant = String(body?.tenant || "").trim();
  const name   = String(body?.name   || "").trim();
  const email  = String(body?.email  || "").trim().toLowerCase();
  const channel= String(body?.channel|| "").trim() || null;
  const note   = String(body?.note   || "").trim() || null;

  if (!tenant || !name || !email) return json({ ok: false, error: "missing_params" }, 400);

  // スキーマ前提：/init-db または /api?action=admin.d1.migrate で作成済み
  const now = Math.floor(Date.now() / 1000);
  const id  = newId();

  // UPSERT（tenant,email 一意）
  await env.DB.prepare(
    `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(tenant, email) DO UPDATE SET
       name=excluded.name,
       channel=excluded.channel,
       note=excluded.note,
       created_at=excluded.created_at`
  ).bind(id, tenant, name, email, channel, note, now).run();

  const row = await env.DB.prepare(
    `SELECT id FROM leads WHERE tenant=?1 AND email=?2`
  ).bind(tenant, email).first<{ id: string }>();

  return json({ ok: true, id: row?.id || id });
};
