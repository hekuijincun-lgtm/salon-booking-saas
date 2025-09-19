export const onRequestGet: PagesFunction = async () => {
  return new Response("pong", { status: 200, headers: { "Cache-Control": "no-store" } });
};

