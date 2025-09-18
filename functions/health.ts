// functions/health.ts
export const onRequest: PagesFunction = async () => {
  return new Response("OK", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
