export const onRequest: PagesFunction = async () => {
  // TODO: 初期化処理（KV/DBのスキーマ作成など）
  return new Response(JSON.stringify({ ok: true, initialized: true }), {
    headers: { "content-type": "application/json" },
  });
};
