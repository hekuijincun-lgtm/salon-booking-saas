export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- 簡易デバッグ: env を確認
    if (url.pathname === "/debug/line-env") {
      const s = env.LINE_CHANNEL_SECRET || "";
      const t = env.LINE_CHANNEL_ACCESS_TOKEN || "";
      const json = { secretLen: s.length, secretHead: s.slice(0,4), secretTail: s.slice(-4), tokenLen: t.length };
      return new Response(JSON.stringify(json), { headers: { "content-type": "application/json" } });
    }

    // --- LINE webhook
    if (url.pathname === "/line/webhook") {
      if (request.method !== "POST") return new Response("ok", { status: 200 });

      const bodyText = await request.text();
      const signature = request.headers.get("x-line-signature") || "";
      const ok = await verify(bodyText, signature, env.LINE_CHANNEL_SECRET);
      if (!ok) return new Response("signature mismatch", { status: 403 });

      // 署名OKなら即200返す（返信は裏で）
      try {
        const payload = JSON.parse(bodyText);
        for (const ev of payload?.events ?? []) {
          if (ev?.type === "message" && ev?.message?.type === "text" && ev?.replyToken) {
            const body = { replyToken: ev.replyToken, messages: [{ type:"text", text:`受け付けたよ 👉 ${ev.message.text}` }] };
            ctx.waitUntil(fetch("https://api.line.me/v2/bot/message/reply", {
              method:"POST",
              headers:{ "Content-Type":"application/json", Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
              body: JSON.stringify(body),
            }));
          }
        }
      } catch {}
      return new Response("OK", { status: 200 });
    }

    // 静的資産へ
    return env.ASSETS.fetch(request);
  }
};

async function verify(body, sigB64, secret) {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const b = new Uint8Array(mac); let s=""; for (let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
    const macB64 = btoa(s);
    if (macB64.length !== sigB64.length) return false;
    let r=0; for (let i=0;i<macB64.length;i++) r |= macB64.charCodeAt(i) ^ sigB64.charCodeAt(i);
    return r===0;
  } catch { return false; }
}
