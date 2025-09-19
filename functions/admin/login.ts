// functions/admin/login.ts
type LoginReq = { username?: string; password?: string };

const json = (d: unknown, s = 200, h: Record<string,string> = {}) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", ...h } });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const headers = request.headers;
  const fromHeader = headers.get("x-admin-key") ?? "";
  const bearer = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const body: LoginReq = await request.json().catch(() => ({}));
  const candidate = fromHeader || bearer || body.password || "";

  const expected = (env.ADMIN_KEY || env.ADMIN_TOKEN || "").trim();
  if (!expected) return json({ ok:false, error:"missing ADMIN_KEY/ADMIN_TOKEN" }, 400);
  if (!candidate) return json({ ok:false, error:"missing credential" }, 400);
  if (candidate !== expected) return json({ ok:false, error:"invalid credential" }, 401);

  const cookie = `admin_session=ok; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  return json({ ok:true, user: body.username ?? "admin" }, 200, { "Set-Cookie": cookie });
};
