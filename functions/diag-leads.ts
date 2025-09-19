// functions/diag-leads.ts
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

const isAuthed = (req: Request, env: Env) => {
  const cookie = req.headers.get("cookie") ?? "";
  const hasCookie = /(?:^|;\s*)admin_session=ok(?:;|$)/i.test(cookie);
  const headerKey = req.headers.get("x-admin-key") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const expected = (env.ADMIN_KEY || env.ADMIN_TOKEN || "").trim();
  return hasCookie || (!!expected && (headerKey === expected || bearer === expected));
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (!isAuthed(request, env)) return json({ ok:false, error:"unauthorized", need:"admin" }, 401);
  return json({ ok:true, total:0, note:"dummy" }, 200);
};
