export const onRequestGet: PagesFunction = async () => {
  const h = new Headers({ "content-type": "application/json" });
  h.append("Set-Cookie", "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
};
