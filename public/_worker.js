export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === "/__ping") {
      return new Response("pong", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/debug/line-env") {
      const s = env.LINE_CHANNEL_SECRET || "";
      const t = env.LINE_CHANNEL_ACCESS_TOKEN || "";
      return json({ secretLen: s.length, secretHead: s.slice(0,4), secretTail: s.slice(-4), tokenLen: t.length });
    }

    // 生 bytes で署名計算
    if (url.pathname === "/debug/sig" && req.method === "POST") {
      const buf = new Uint8Array(await req.arrayBuffer());
      const macB64 = await hmacB64Bytes(env.LINE_CHANNEL_SECRET, buf);
      return json({ macB64, bodyLen: buf.length });
    }

    if (url.pathname === "/line/webhook") {
      if (req.method !== "POST") return new Response("ok", { status: 200 });

      const buf = new Uint8Array(await req.arrayBuffer());
      const sig = req.headers.get("x-line-signature") || "";
      const macB64 = await hmacB64Bytes(env.LINE_CHANNEL_SECRET, buf);

      if (!tse(macB64, sig)) {
        return json({ error: "signature mismatch", macB64, sig }, 403);
      }

      // 任意: オウム返し
      try {
        const payload = JSON.parse(new TextDecoder().decode(buf));
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

    // 静的資産
    return env.ASSETS.fetch(req);
  }
};

function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json" }});
}

async function hmacB64Bytes(secret, bytes){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, bytes);
  const b = new Uint8Array(mac); let s=""; for (let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
  return btoa(s);
}

function tse(a,b){
  if (a.length !== b.length) return false;
  let r=0; for (let i=0;i<a.length;i++) r |= a.charCodeAt(i)^b.charCodeAt(i);
  return r===0;
}
