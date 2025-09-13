// ① 管理アクション部分の直前〜直後を微修正
const adminActions = new Set<string>([/* 省略 */]);

// 送信値と環境値をトリムしてから比較
const rawAdminHeader = request.headers.get("x-admin-key") ?? "";
const adminKeyHeader = rawAdminHeader.trim();
const envAdminKey    = (env.ADMIN_KEY ?? "").trim();

if (adminActions.has(action)) {
  // Cookie優先の分岐がある場合はそのまま残す
  if (!__tse(adminKeyHeader, envAdminKey)) {
    return new Response(JSON.stringify({ ok:false, error:"unauthorized", need:"admin" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "x-auth-mode": "admin" },
    });
  }
  return handleAdminAction(action, request, env);
}
