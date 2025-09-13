// 先頭付近にユーティリティ追加
const normalize = (s: string | null | undefined) =>
  (s ?? "").replace(/[\r\n]+$/g, "").trim();

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  // ...省略...
  const url = new URL(request.url);
  const qsKey  = normalize(url.searchParams.get("key"));
  const hdrKey = normalize(request.headers.get("x-admin-key"));

  let bodyKey: string | undefined;
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    const j = await request.json().catch(() => ({} as any));
    bodyKey = typeof j?.key === "string" ? normalize(j.key) : undefined;
  }

  const candidate = bodyKey || hdrKey || qsKey || "";
  const envKey = normalize(env.ADMIN_KEY);

  if (!candidate) return json({ ok:false, error:"missing key" }, 401);
  if (!envKey)    return json({ ok:false, error:"missing ADMIN_KEY" }, 500);

  // normalize 後の長さでチェック
  if (candidate.length !== envKey.length) {
    return json({ ok:false, error:"length mismatch", got:candidate.length, need:envKey.length }, 401);
  }
  if (!tse(candidate, envKey)) return json({ ok:false, error:"mismatch" }, 401);

  // 以降はそのまま（Cookie発行ロジック）
}
