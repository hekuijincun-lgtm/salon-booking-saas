import { createHmac } from "node:crypto";

const text = (b: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(b));

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const secret = env.LINE_CHANNEL_SECRET;
  if (!secret) return new Response("LINE_CHANNEL_SECRET not set", { status: 500 });

  const bodyBuf = await request.arrayBuffer();
  const signature = request.headers.get("x-line-signature") ?? "";

  const hmac = createHmac("sha256", secret).update(Buffer.from(bodyBuf)).digest("base64");
  if (hmac !== signature) return new Response("Bad signature", { status: 401 });

  const payload = JSON.parse(await text(bodyBuf));

  // TODO: ここでイベント分岐（message/replyなど）
  // 返信はMessaging APIのReply APIを使う（fetchで呼ぶ）。本雛形は受信OKまで。
  return new Response("ok");
};

// 安全側のデフォルト（POST以外は405）
export const onRequest: PagesFunction = async ({ request }) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  return new Response("Method Not Allowed", { status: 405 });
};
