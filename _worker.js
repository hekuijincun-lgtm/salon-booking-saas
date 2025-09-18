// _worker.js
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 環境変数の頭/尻/長さを返す
    if (url.pathname === "/debug/line-env") {
      const s = env.LINE_CHANNEL_SECRET || "";
      const t = env.LINE_CHANNEL_ACCESS_TOKEN || "";
      return json({ secretLen: s.length, secretHead: s.slice(0,4), secretTail: s.slice(-4), tokenLen: t.length });
    }

    // 生ボディで HMAC(SHA256) Base64 を計算して返す
    if (url.pathname === "/debug/sig" && req.method === "POST") {
      const bodyText = await req.text();
      const macB64 = await hmacB64(env.LINE_CHANNEL_SECRET, bodyText);
      return json({ macB64, bodyLen: bodyText.length });
    }

    // LINE webhook
    if (url.pathname === "/line/webhook") {
      if (req.method !== "POST") return new Response("ok", { status: 200 });

      const bodyText = await req.text();
      const sig = req.headers.get("x-line-signature") || "";
      const macB64 = await hmacB64(env.LINE_CHANNEL_SECRET, bodyText);

      if (!tse(macB64, sig)) return json({ error: "signature mismatch", macB64, sig }, 403);

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

    return env.ASSETS.fetch(req);
  }
};

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type":"application/json" }});
}

async function hmacB64(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  const b = new Uint8Array(mac); let s = ""; for (let i=0;i<b.length;i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function tse(a, b) {                 // timing-safe equal
  if (a.length !== b.length) return false;
  let r = 0; for (let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
