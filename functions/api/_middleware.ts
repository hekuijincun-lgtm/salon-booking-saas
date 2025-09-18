// functions/api/_middleware.ts
const BUILD = "v2025-09-16-api-mw-cors-01";

function corsHeaders(req: Request): Record<string,string> {
  const reqHdr = req.headers.get("access-control-request-headers") || "content-type,cf-turnstile-response";
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": reqHdr,
    "access-control-max-age": "86400",
    "vary": "origin, access-control-request-method, access-control-request-headers",
  };
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: { ...corsHeaders(request) } });

export const onRequest: PagesFunction = async ({ request, next }) => {
  const res = await next();
  const hdr = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) hdr.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: hdr });
};
