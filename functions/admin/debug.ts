// /functions/admin/debug.ts
// Secrets が反映されてるか「長さ」だけ確認する安全なデバッグ用

export async function onRequest({ env }: { env: any }) {
  const norm = (s: string | null | undefined) =>
    (s ?? "").replace(/[\r\n]+$/g, "").trim();

  const raw = env.ADMIN_KEY ?? "";
  const out = {
    has_ADMIN_KEY: !!raw,
    raw_len: String(raw).length,
    norm_len: norm(raw).length,
    has_ADMIN_JWT_SECRET: !!env.ADMIN_JWT_SECRET,
  };
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
