// /functions/health.ts
export async function onRequest() {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}
