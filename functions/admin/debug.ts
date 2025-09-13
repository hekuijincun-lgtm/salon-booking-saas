export async function onRequest({ env }: { env: any }) {
  const out = {
    has_ADMIN_KEY: !!env.ADMIN_KEY,
    len_ADMIN_KEY: env.ADMIN_KEY ? String(env.ADMIN_KEY).length : 0,
    has_ADMIN_JWT_SECRET: !!env.ADMIN_JWT_SECRET,
    len_ADMIN_JWT_SECRET: env.ADMIN_JWT_SECRET ? String(env.ADMIN_JWT_SECRET).length : 0,
  };
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
}
