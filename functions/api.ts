// functions/api.ts
export const onRequestPost: PagesFunction = async (ctx) => {
  const { env, request } = ctx;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  // ===== Auth =====
  const auth = request.headers.get("authorization") || "";

  const apiCandidates = [
    (env as any).API_KEY,
    (env as any).API,
    (env as any).API_TOKEN,
  ].filter(Boolean);

  const adminCandidates = [
    (env as any).ADMIN_TOKEN,
    (env as any).ADMIN_KEY,
  ].filter(Boolean);

  const isApi   = apiCandidates.some((k: string) => auth === `Bearer ${k}`);
  const isAdmin = adminCandidates.some((k: string) => auth === `Bearer ${k}`);

  // Admin は API の上位互換として許可
  const hasApi = isApi || isAdmin;

  // 公開アクション（ヘルプ系）
  const PUBLIC = new Set(["__actions__","__help__","__info__"]);
  if (!PUBLIC.has(action) && !hasApi) {
    return json({ ok:false, error:"unauthorized", need:"api" }, 401);
  }
  if (action.startsWith("admin.") && !isAdmin) {
    return json({ ok:false, error:"unauthorized", need:"admin" }, 401);
  }

  // ===== Actions =====
  if (action === "__actions__") {
    return json({ ok:true, actions:["__echo__","lead.add","lead.list","admin.d1.tables","admin.d1.migrate"] });
  }

  if (action === "__echo__") {
    const raw = await safeJson(request).catch(()=>null);
    return json({ ok:true, action, payload:null, raw, tenant: url.hostname.split(".")[0] });
  }

  if (action === "lead.add") {
    const body = await safeJson(request);
    const { tenant, name, email, channel, note } = body || {};
    if (!tenant || !name || !email) return json({ ok:false, error:"bad_request" }, 400);
    const id  = crypto.randomUUID().replace(/-/g,"").toUpperCase();
    const now = Math.floor(Date.now()/1000);
    await ctx.env.DB.prepare(
      "INSERT OR REPLACE INTO leads (id, tenant, name, email, channel, note, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    ).bind(id, tenant, name, email, channel||null, note||null, now).run();
    return json({ ok:true, id });
  }

  if (action === "lead.list") {
    const body = await safeJson(request);
    const { tenant } = body || {};
    if (!tenant) return json({ ok:false, error:"bad_request" }, 400);
    const { results } = await ctx.env.DB.prepare(
      "SELECT id,tenant,name,email,channel,note,created_at FROM leads WHERE tenant=?1 ORDER BY created_at DESC"
    ).bind(tenant).all();
    return json({ ok:true, items: results || [] });
  }

  if (action === "admin.d1.tables") {
    const tables = await ctx.env.DB.prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name"
    ).all();
    const indexes = await ctx.env.DB.prepare(
      "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name"
    ).all();
    return json({ ok:true, tables: tables.results, indexes: indexes.results });
  }

  if (action === "admin.d1.migrate") {
    return json({ ok:true, migrated:true });
  }

  return json({ ok:false, error:"unknown_action", action }, 404);
};

// helpers
function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type":"application/json; charset=utf-8" }
  });
}
async function safeJson(req: Request) {
  try { return await req.json(); } catch { return null; }
}
