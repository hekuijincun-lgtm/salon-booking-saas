// /functions/add-lead.ts
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  try {
    // ---- 0) レート制限（ゆるめ：同一IP 60秒に1回）
    await rateLimit(request, env, 60);

    // ---- 1) 入力受け取り
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    const body = await request.json().catch(() => ({} as any));
    const tenant = (body?.tenant ?? "salon-booking-saas").trim();
    const toolId = (body?.toolId ?? "tool_salon_booking_v1").trim();
    const name = (body?.name ?? "").trim();
    const emailRaw = (body?.email ?? "").trim();
    const channel = (body?.channel ?? "").trim(); // Email/LINE など
    const note = (body?.note ?? "").trim();

    if (!name || !emailRaw) {
      return json({ ok: false, error: "missing name/email" }, 400);
    }

    const email = normalizeEmail(emailRaw);

    // ---- 2) Turnstile 検証（env.TURNSTILE_SECRET が設定されている時だけ必須）
    const tsToken =
      body?.cfTurnstileResponse ??
      body?.["cf-turnstile-response"] ??
      request.headers.get("cf-turnstile-response") ??
      (await findTurnstileInputFromForm(request));

    const verified = await verifyTurnstile(env, tsToken, ip);
    if (!verified.ok) return json({ ok: false, error: verified.error ?? "turnstile_failed" }, 400);

    // ---- 3) 重複排除 & 登録/更新（email 一意）
    const now = new Date().toISOString();
    const idxKey = `idx:email:${tenant}:${email}`;
    let id = await env.LEADS.get(idxKey);

    if (!id) {
      id = crypto.randomUUID();
      const itemKey = `lead:${tenant}:${id}`;
      const item = { id, toolId, name, email, channel, note, tenant, createdAt: now };
      await Promise.all([
        env.LEADS.put(itemKey, JSON.stringify(item)),
        env.LEADS.put(idxKey, id),
      ]);
      // 通知（あれば）
      await notifySlack(env, `🆕 New lead (${tenant})\n• ${name} <${email}>\n• ch: ${channel || "-"}\n• note: ${note || "-"}`);
      return json({ ok: true, created: true, item });
    } else {
      const itemKey = `lead:${tenant}:${id}`;
      const prev = JSON.parse((await env.LEADS.get(itemKey)) || "{}");
      const item = {
        ...prev,
        id,
        toolId,
        name: name || prev?.name,
        email,
        channel: channel || prev?.channel,
        note: note || prev?.note,
        tenant,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      await env.LEADS.put(itemKey, JSON.stringify(item));
      await notifySlack(env, `✏️ Lead updated (${tenant})\n• ${name} <${email}>`);
      return json({ ok: true, created: false, item });
    }
  } catch (e: any) {
    return json({ ok: false, error: "unexpected", detail: String(e?.message ?? e) }, 500);
  }
};

// ===== ユーティリティ =====
type Env = {
  LEADS: KVNamespace;
  TURNSTILE_SECRET?: string;     // ← Turnstile（サーバ側秘密鍵）
  SLACK_WEBHOOK_URL?: string;    // ← Slack Incoming Webhook（任意）
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function normalizeEmail(e: string) {
  return e.toLowerCase();
}

async function verifyTurnstile(env: Env, token: string | null | undefined, ip: string) {
  // サーバ側秘密鍵が無ければスキップ（導入前でも動くように）
  if (!env.TURNSTILE_SECRET) return { ok: true as const };
  if (!token) return { ok: false as const, error: "missing_turnstile_token" };

  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: !!data?.success, error: data?.["error-codes"]?.[0] };
}

async function findTurnstileInputFromForm(request: Request) {
  // 送信が form-urlencoded の場合に備えた保険（基本は JSON 送信を推奨）
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const p = new URLSearchParams(text);
    return p.get("cf-turnstile-response");
  }
  return null;
}

async function rateLimit(request: Request, env: Env, ttlSec = 60) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
    const key = `rl:${ip}`;
    const hit = await env.LEADS.get(key);
    if (hit) throw new Error("rate_limited");
    await env.LEADS.put(key, "1", { expirationTtl: ttlSec });
  } catch (e) {
    if ((e as any).message === "rate_limited") throw e;
  }
}

async function notifySlack(env: Env, text: string) {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (_) {}
}
