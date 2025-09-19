export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const { username, password } = await request.json().catch(() => ({}));
  // 超簡易：ENVのADMIN_TOKENが一致したらログインOKにするダミー
  if (!username || !password) return new Response("Bad Request", { status: 400 });

  if (env.ADMIN_TOKEN && password === env.ADMIN_TOKEN) {
    const h = new Headers({ "content-type": "application/json" });
    // ダミーCookie（Secure属性は本番で付与推奨）
    h.append("Set-Cookie", `admin_session=ok; Path=/; HttpOnly; SameSite=Lax`);
    return new Response(JSON.stringify({ ok: true, user: username }), { status: 200, headers: h });
  }
  return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { "content-type": "application/json" } });
};
