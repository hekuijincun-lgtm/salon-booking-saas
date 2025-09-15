export const onRequest: PagesFunction = async () => {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
};
