export async function onRequest(context) {
  const { env, request } = context;
  const noStore = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, max-age=0, must-revalidate',
    pragma: 'no-cache',
    'x-store': 'd1',
  };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }), { status: 405, headers: noStore });
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const id = crypto.randomUUID();
  const {
    tenant,
    toolId = 'tool_salon_booking_v1',
    name = '',
    email = '',
    channel = '',
    memo = body.memo ?? body.note ?? '',
  } = body;

  // 1) テーブル確保（初回のみ）
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      toolId TEXT,
      name TEXT,
      email TEXT,
      channel TEXT,
      memo TEXT,
      createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `).run();

  // 2) 追加
  await env.DB.prepare(`
    INSERT INTO leads (id,tenant,toolId,name,email,channel,memo,createdAt)
    VALUES (?1,?2,?3,?4,?5,?6,?7,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(id, tenant, toolId, name, email, channel, memo).run();

  return new Response(JSON.stringify({
    ok: true,
    item: { id, tenant, toolId, name, email, channel, createdAt: new Date().toISOString() }
  }), { status: 200, headers: noStore });
}
