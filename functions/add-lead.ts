// /functions/add-lead.ts
export interface Env { DB: D1Database; }

const cors = (req: Request) => ({
  "access-control-allow-origin": req.headers.get("origin") || "*",
  "access-control-allow-headers": "content-type,cf-turnstile-response",
  "access-control-allow-methods": "POST,OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(req) } });

const hexId = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: cors(request) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const p = (await request.json().catch(() => ({}))) as any;
    const tenant = String(p.tenant || "").trim();
    const name = String(p.name || "").trim();
    const email = String(p.email || "").trim().toLowerCase();
    const channel = (p.channel ? String(p.channel) : "") || null;
    const note = (p.note ? String(p.note) : "") || null;

    if (!tenant || !name || !email) {
      return json(request, { ok: false, error: "bad_request", need: "tenant,name,email" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(request, { ok: false, error: "invalid_email" }, 400);
    }

    const id = hexId();
    const now = Math.floor(Date.now() / 1000);

    await env.DB
      .prepare(
        `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(tenant, email) DO UPDATE SET
           name=excluded.name, channel=excluded.channel, note=excluded.note`
      )
      .bind(id, tenant, name, email, channel, note, now)
      .run();

    return json(request, { ok: true });
  } catch (e: any) {
    return json(request, { ok: false, error: "exception", detail: String(e?.message || e) }, 500);
  }
};
