export const onRequestGet: PagesFunction = async ({ env }) => {
  const safeEnv = {
    has_LINE_CHANNEL_SECRET: Boolean(env.LINE_CHANNEL_SECRET),
    has_ADMIN_TOKEN: Boolean(env.ADMIN_TOKEN),
  };
  return new Response(JSON.stringify({ ok: true, env: safeEnv, now: new Date().toISOString() }), {
    headers: { "content-type": "application/json" },
  });
};

