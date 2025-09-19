const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...(init ?? {}),
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

export const onRequestGet: PagesFunction = async () => {
  return json({ ok: true, service: "api-root", now: new Date().toISOString() });
};

export const onRequestPost: PagesFunction = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  return json({ ok: true, echo: body });
};
