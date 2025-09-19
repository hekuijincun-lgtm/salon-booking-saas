type Lead = { name?: string; tel?: string; email?: string; note?: string };

const json = (data: unknown, init?: number | ResponseInit) =>
  new Response(JSON.stringify(data), {
    status: typeof init === "number" ? init : init?.status ?? 200,
    headers: { "content-type": "application/json", ...(typeof init === "object" ? init.headers : {}) },
  });

export const onRequestGet: PagesFunction = async () => {
  return json({ ok: true, usage: "POST /api/add-lead {name,tel,email?,note?}" });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const lead = (await request.json().catch(() => ({}))) as Lead;

  if (!lead.name || !(lead.tel || lead.email)) {
    return json({ ok: false, error: "name と tel/email のどちらか必須" }, 400);
  }

  // TODO: ここでDB/KV/Queueに保存。まずはダミー応答。
  // 例: await env.LEADS.put(`lead:${Date.now()}`, JSON.stringify(lead));
  return json({ ok: true, received: lead, id: Date.now() });
};

export const onRequestOptions = () => new Response(null, { status: 204 });
