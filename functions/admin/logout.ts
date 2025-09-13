// /functions/admin/logout.ts
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
    `<!doctype html><meta charset="utf-8"><title>Logged out</title>
     <p>OK. <a href="/admin">Back to admin</a></p>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": cookie,
        "cache-control": "no-store",
      },
    }
  );
}
