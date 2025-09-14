// functions/add-lead.ts
type Env = { DB: D1Database };

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB || typeof env.DB.prepare !== "function") {
      return json({ ok:false, error:"d1_binding_missing", need:"Functions > D1 binding name=DB" }, 500);
    }

    const b = await request.json().catch(() => null) as any;
    if (!b) return json({ ok:false, error:"bad_json" }, 400);

    const tenant  = String(b.tenant || "").trim();
    const name    = String(b.name   || "").trim();
    const email   = String(b.email  || "").trim().toLowerCase();
    const channel = String(b.channel|| "Email").trim();
    const note    = String(b.note   || "").trim();
    if (!tenant || !name || !email) return json({ ok:false, error:"bad_request_missing_fields" }, 400);

    // （初回の CREATE は init-db で実施済み想定。ここでは upsert のみ）
    await env.DB.prepare(
      "INSERT INTO leads (id, tenant, name, email, channel, note, created_at) VALUES (hex(randomblob(16)), ?, ?, ?, ?, ?, unixepoch()) ON CONFLICT(tenant, email) DO UPDATE SET name=excluded.name, channel=excluded.channel, note=excluded.note, created_at=unixepoch()"
    ).bind(tenant, name, email, channel, note).run();

    return json({ ok:true });
  } catch (e:any) {
    return json({ ok:false, error:"exception", detail:String(e) }, 500);
  }
};
