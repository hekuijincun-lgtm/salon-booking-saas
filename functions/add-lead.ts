// /functions/add-lead.ts

interface Env {
  LEADS: KVNamespace;
}

type LeadItem = {
  id: string;
  toolId: string;
  name: string;
  email: string;
  channel?: string;
  note?: string;
  tenant: string;
  createdAt: string;
};

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  // CORS
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,cf-turnstile-response",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-max-age": "86400",
} as const;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers });

/** CORS preflight */
export const onRequestOptions: PagesFunction = async () => json({ ok: true });

/** ヘルス（ブラウザ直叩き/HEAD チェック用） */
export const onRequestHead: PagesFunction = async () =>
  json({ ok: true, endpoint: "/add-lead", need: "POST" });

export const onRequestGet: PagesFunction = async () =>
  json({ ok: true, endpoint: "/add-lead", need: "POST" });

/** 本処理（リード保存） */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json().catch(() => ({} as any));
    const tenant = (body?.tenant ?? "").toString().trim();
    const name = (body?.name ?? "").toString().trim();
    const email = (body?.email ?? "").toString().toLowerCase().trim();
    const channel = (body?.channel ?? "").toString().trim();
    const note = (body?.note ?? "").toString().trim();

    if (!tenant || !name || !email)
      return json({ ok: false, error: "bad_request" }, 400);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ ok: false, error: "invalid_email" }, 400);

    if (!env.LEADS) return json({ ok: false, error: "no_kv" }, 500);

    const id = crypto.randomUUID();
    const item: LeadItem = {
      id,
      toolId: "tool_salon_booking_v1",
      name,
      email,
      channel,
      note,
      tenant,
      createdAt: new Date().toISOString(),
    };

    // 同一メールは上書き保存（重複登録しない）
    const key = `t_${tenant}:lead:${email}`;
    await env.LEADS.put(key, JSON.stringify(item), {
      metadata: { tenant, email },
    });

    return json({ ok: true, item });
  } catch {
    return json({ ok: false, error: "server_error" }, 500);
  }
};
