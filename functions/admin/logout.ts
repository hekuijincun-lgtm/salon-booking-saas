// /functions/admin/logout.ts — セッションCookie破棄
export async function onRequestGet() {
  const cookie = [
    "admin_session=;",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");

  return new Response(
    `<!doctype html><meta charset="utf-8"><p>Logged out. <a href="/admin">Back</a></p>`,
    { status: 200, headers: { "set-cookie": cookie, "content-type": "text/html; charset=utf-8" } }
  );
}
