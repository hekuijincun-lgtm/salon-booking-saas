// functions/[[path]].ts
export const onRequest: PagesFunction<{ LINE_CHANNEL_SECRET: string; LINE_CHANNEL_ACCESS_TOKEN: string; }> =
  async ({ request, env, waitUntil, next }) => {
    const url = new URL(request.url);
    if (url.pathname === "/line/webhook") {
      if (request.method !== "POST") return new Response("ok", { status: 200 });
      const bodyText = await request.text();
      const signature = request.headers.get("x-line-signature") || "";
      const ok = await verifyLineSignature(env.LINE_CHANNEL_SECRET, bodyText, signature);
      if (!ok) return new Response("signature mismatch", { status: 403 });
      let payload:any; try { payload = JSON.parse(bodyText); } catch { return new Response("bad json", { status: 400 }); }
      const events:any[] = Array.isArray(payload?.events) ? payload.events : [];
      for (const ev of events) {
        if (ev?.type==="message" && ev?.message?.type==="text" && ev?.replyToken) {
          const replyBody = { replyToken: ev.replyToken, messages: [{ type:"text", text:`受け付けたよ 👉 ${ev.message.text}` }] };
          waitUntil(fetch("https://api.line.me/v2/bot/message/reply", {
            method:"POST",
            headers:{ "Content-Type":"application/json", Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
            body: JSON.stringify(replyBody),
          }).then(async r => { if (!r.ok) console.warn("LINE reply failed:", r.status, await r.text().catch(()=>'')); }));
        }
      }
      return new Response("OK", { status: 200 });
    }
    return next();
  };
// helpersは省略可（今のままでOK）
