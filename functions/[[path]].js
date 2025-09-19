export const onRequest = () =>
  new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
