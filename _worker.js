// _worker.js （Advanced Mode / 署名デバッグ付き）
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 動作確認
    if (url.pathname === "/_ping") return new Response("pong");

    // 環境変数の確認
    if (url.pathname === "/debug/line-env") {
      const s = env.LINE_CHANNEL_SECRET || "";
      const t = env.LINE_CHANNEL_ACCESS_TOKEN || "";
      return json({ secretLen: s.length, secretHead: s.slice(0,4), secretTail: s.slice(-4), tokenLen: t.length });
    }

    // 署名をサーバ側で再計算して返す（差分調査用）
    if (url.pathname === "/debug/sig" && request.method === "POST") {
      const bodyText = await request.text();
      const headerSig = request.headers.get("x-line-signature") || "";
      const macB64 = await hmacB64(env.LINE_CHANNEL_SECRET, bodyText);
      return json({ headerSig, macB64, equal: headerSig === macB64, headerLen: headerSig.length, macLen: macB64.length, bodyLen: bodyText.length });
    }

    // 本番 Webhook
    if (url.pathname === "/line/webhook") {
      if (request.method !== "POST") return new Response("ok", { status: 200 });

      const bodyText = await request.text();
      const sig = request.headers.get("x-line-signature") || "";
      const macB64 = await hmacB64(env.LINE_CHANNEL_SECRET, bodyText);
      if (!tse(macB64, sig)) return new Response("signature mismatch", { status: 403 });

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

    return env.ASSETS.fetch(request);
  }
};

function json(o){ return new Response(JSON.stringify(o), { headers:{ "content-type":"application/json" } }); }
async function hmacB64(secret, text){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  let s=""; const b=new Uint8Array(mac); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s);
}
function tse(a,b){ if(a.length!==b.length) return false; let r=0; for(let i=0;i<a.length;i++) r|=a.charCodeAt(i)^b.charCodeAt(i); return r===0; }
