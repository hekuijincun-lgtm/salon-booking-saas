// functions/diag-leads.ts
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

const isAuthed = (req: Request, env: any) => {
  const expected = ((env.ADMIN_KEY ?? env.ADMIN_TOKEN ?? "") as string).trim();

  // 1) x-admin-key / Bearer
  const headerKey = (req.headers.get("x-admin-key") ?? "").trim();
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (expected && (headerKey === expected || bearer === expected)) return true;

  // 2) Cookie（値は存在チェックのみ：開発～内製ツール用途）
  const cookie = req.headers.get("cookie") ?? "";
  const hasCookie = /(?:^|;\s*)admin_session=([^;]+)/i.test(cookie);
  return hasCookie;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (!isAuthed(request, env)) return json({ ok:false, error:"unauthorized", need:"admin" }, 401);
  // TODO: 実データに差し替え
  return json({ ok:true, items: [], total: 0 }, 200);
};
