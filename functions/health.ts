// /functions/health.ts
export const onRequestGet: PagesFunction = async () =>
  new Response("ok", { headers: { "content-type": "text/plain" } });
