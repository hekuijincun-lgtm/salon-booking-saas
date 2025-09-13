export async function onRequest() {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append("set-cookie", `admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
