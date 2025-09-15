// functions/api.ts
export const onRequestPost: PagesFunction = async (ctx) => {
  const { env, request } = ctx;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  // === Auth normalize ===
  const h = request.headers;
  const rawAuth =
    h.get("authorization") ||
    h.get("x-api-key") ||
    h.get("x-admin-key") || "";

  const norm = (s: string) =>
    (s || "")
      .replace(/^\s*Bearer\s+/i, "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();

  const token = norm(rawAuth);

  const pick = (k: string) => {
    const v = (env as any)[k];
    return typeof v === "string" ? norm(v) : "";
  };

  const apiCandidates = ["API_KEY", "API", "API_TOKEN"].map(pick).filter(Boolean);
  const adminCandidates = ["ADMIN_TOKEN", "ADMIN_KEY"].map(pick).filter(Boolean);

  const isApi   = apiCandidates.some((k) => token === k);
  const isAdmin = adminCandidates.some((k) => token === k);

  const PUBLIC = new Set(["__actions__", "__help__", "__info__"]);
  if (!PUBLIC.has(action) && !(isApi || isAdmin)) {
    return j({ ok:false, error:"unauthorized", need:"api" }, 401);
  }
  if (action.startsWith("admin.") && !isAdmin) {
    return j({ ok:false, error:"unauthorized", need:"admin" }, 401);
  }

  // === Actions ===
  if (action === "__actions__") {
    return j({ ok:true, actions:["__echo__","lead.add","lead.list","admin.d1.tables","admin.d1.migrate"] });
  }

  if (action === "__echo__") {
    const raw = await safeJson(request).catch(()=>null);
    return j({ ok:true, action, payload:null, raw, tenant: url.hostname.split(".")[0] });
  }

  if (action === "lead.add") {
    const b = await safeJson(request);
    const { tenant, name, email, channel, note } = b || {};
    if (!tenant || !name || !email) return j({ ok:false, error:"bad_request" }, 400);
    const id  = crypto.randomUUID().replace(/-/g,"").toUpperCase();
    const now = Math.floor(Date.now()/1000);
    await ctx.env.DB.prepare(
      "INSERT OR REPLACE INTO leads (id, tenant, name, email, channel, note, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    ).bind(id, tenant, name, email, channel||null, note||null, now).run();
    return j({ ok:true, id });
  }

  if (action === "lead.list") {
    const b = await safeJson(request);
    const { tenant } = b || {};
    if (!tenant) return j({ ok:false, error:"bad_request" }, 400);
    const { results } = await ctx.env.DB.prepare(
      "SELECT id,tenant,name,email,channel,note,created_at FROM leads WHERE tenant=?1 ORDER BY created_at DESC"
    ).bind(tenant).all();
    return j({ ok:true, items: results || [] });
  }

  if (action === "admin.d1.tables") {
    const tables = await ctx.env.DB.prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name"
    ).all();
    const indexes = await ctx.env.DB.prepare(
      "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name"
    ).all();
    return j({ ok:true, tables: tables.results, indexes: indexes.results });
  }

  if (action === "admin.d1.migrate") {
    return j({ ok:true, migrated:true });
  }

  return j({ ok:false, error:"unknown_action", action }, 404);
};

function j(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type":"application/json; charset=utf-8" }
  });
}
async function safeJson(req: Request) { try { return await req.json(); } catch { return null; } }
