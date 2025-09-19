export const onRequestGet: PagesFunction = async ({ env }) => {
  return new Response(
    JSON.stringify({
      ok: true,
      LINE_CHANNEL_SECRET_set: !!env.LINE_CHANNEL_SECRET,
    }),
    { headers: { "content-type": "application/json" } }
  );
};
