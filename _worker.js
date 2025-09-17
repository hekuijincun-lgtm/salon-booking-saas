// _worker.js  ← JS です！（tsじゃない）
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- debug: envの頭/尻/長さを見る ---
    if (url.pathname === "/debug/line-env") {
      const s = env.LINE_CHANNEL_SECRET || "";
      const t = env.LINE_CHANNEL_ACCESS_TOKEN || "";
      const json = { secretLen: s.length, secretHead: s.slice(0,4), secretTail: s.slice(-4), tokenLen: t.length };
      return new Response(JSON.stringify(json), { headers: { "content-type": "application/json" } });
    }

    // --- LINE webhook ---
    if (url.pathname === "/line/webhook") {
      if (request.method !== "POST") return new Response("ok", { status: 200 });

      const bodyText = await request.text();
      const signature = request.headers.get("x-line-signature") || "";
      const ok = await verifyLineSignature(env.LINE_CHANNEL_SECRET, bodyText, signature);
      if (!ok) return new Response("signature mismatch", { status: 403 });

      let payload; try { payload = JSON.parse(bodyText); } catch { return new Response("bad json", { status: 400 }); }
      const events = Array.isArray(payload?.events) ? payload.events : [];
      for (const ev of events) {
        if (ev?.type === "message" && ev?.message?.type === "text" && ev?.replyToken) {
          const replyBody = { replyToken: ev.replyToken, messages: [{ type:"text", text:`受け付けたよ 👉 ${ev.message.text}` }] };
          ctx.waitUntil(fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
            body: JSON.stringify(replyBody),
          }));
        }
      }
      return new Response("OK", { status: 200 });
    }

    // --- その他は静的資産へ ---
    return env.ASSETS.fetch(request);
  }
};

async function verifyLineSignature(secret, body, sigB64) {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const macB64 = arrayBufferToBase64(mac);
    return timingSafeEqual(macB64, sigB64);
  } catch { return false; }
}
function arrayBufferToBase64(buf){const b=new Uint8Array(buf);let s="";for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
function timingSafeEqual(a,b){ if(a.length!==b.length) return false; let r=0; for(let i=0;i<a.length;i++) r|=a.charCodeAt(i)^b.charCodeAt(i); return r===0 }
