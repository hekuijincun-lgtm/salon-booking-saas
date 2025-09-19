export const onRequestOptions: PagesFunction = async ({ request }) => {
  // Preflight
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
};

export const onRequest: PagesFunction = async ({ request, next }) => {
  const resp = await next();
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", request.headers.get("Origin") ?? "*");
  h.append("Vary", "Origin");
  return new Response(resp.body, { status: resp.status, headers: h });
};

