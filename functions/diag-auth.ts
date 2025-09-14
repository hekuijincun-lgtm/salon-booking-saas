export const onRequestGet: PagesFunction<any> = async ({ env, request }) => {
  const auth = request.headers.get("authorization") || "";
  const hasApi   = !!(env.API_KEY || (env as any).API || env.API_TOKEN);
  const hasAdmin = !!(env.ADMIN_TOKEN || env.ADMIN_KEY);
  return new Response(JSON.stringify({ ok:true, hasApi, hasAdmin, authPresent: !!auth }), {
    headers: { "content-type": "application/json" }
  });
};
