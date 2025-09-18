export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.pathname === "/__ping") {
    return new Response("pong", { headers: { "content-type": "text/plain" } });
  }

  if (url.pathname === "/debug/line-env") {
    const s = env.LINE_CHANNEL_SECRET || "";
    const t = env.LINE_CHANNEL_ACCESS_TOKEN || "";
    return Response.json({
      secretLen: s.length, secretHead: s.slice(0,4), secretTail: s.slice(-4), tokenLen: t.length
    });
  }

  if (url.pathname === "/debug/sig" && request.method === "POST") {
    const buf = new Uint8Array(await request.arrayBuffer());
    const macB64 = await hmacB64Bytes(env.LINE_CHANNEL_SECRET, buf);
    return Response.json({ macB64, bodyLen: buf.length });
  }

  if (url.pathname === "/line/webhook") {
    if (request.method !== "POST") return new Response("ok", { status: 200 });
    const buf = new Uint8Array(await request.arrayBuffer());
    const sig = request.headers.get("x-line-signature") || "";
    const macB64 = await hmacB64Bytes(env.LINE_CHANNEL_SECRET, buf);
    if (!tse(macB64, sig)) {
      return Response.json({ error: "signature mismatch", macB64, sig }, { status: 403 });
    }
    try {
      const payload = JSON.parse(new TextDecoder().decode(buf));
      for (const ev of payload?.events ?? []) {
        if (ev?.type === "message" && ev?.message?.type === "text" && ev?.replyToken) {
          const body = { replyToken: ev.replyToken, messages: [{ type:"text", text:`受け付けたよ 👉 ${ev.message.text}` }] };
          context.waitUntil(fetch("https://api.line.me/v2/bot/message/reply", {
            method:"POST",
            headers:{ "Content-Type":"application/json", Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
            body: JSON.stringify(body),
          }));
        }
      }
    } catch {}
    return new Response("OK", { status: 200 });
  }

  return new Response("OK", { status: 200 });
}

async function hmacB64Bytes(secret, bytes){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, bytes);
  const b = new Uint8Array(mac); let s="";
  for (let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
  return btoa(s);
}
function tse(a,b){ if(a.length!==b.length) return false; let r=0; for(let i=0;i<a.length;i++) r|=a.charCodeAt(i)^b.charCodeAt(i); return r===0; }
