export const onRequest: PagesFunction = async ({ request, env }) => {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const ok = !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 401,
    headers: { "content-type": "application/json" },
  });
};
