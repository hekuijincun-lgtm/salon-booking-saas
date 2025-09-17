// functions/debug/line-env.ts
export const onRequest: PagesFunction<{ LINE_CHANNEL_SECRET:string; LINE_CHANNEL_ACCESS_TOKEN:string; }> = async ({ env }) => {
  const s = env.LINE_CHANNEL_SECRET || "";
  const t = env.LINE_CHANNEL_ACCESS_TOKEN || "";
  const json = { secretLen: s.length, secretHead: s.slice(0,4), secretTail: s.slice(-4), tokenLen: t.length };
  return new Response(JSON.stringify(json), { headers: { "content-type":"application/json" }});
};
