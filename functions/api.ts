// /functions/api.ts — adminはx-admin-keyのみ、その他はAPIトークン必須
// __echo__ は「認証後」に実行されるように配置

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  // action 取得
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "__missing__";

  // ① 管理アクション（x-admin-key だけで通す）
  const adminActions = new Set<string>([
    "listLeads",
    "exportLeads",
    "deleteLead",
    "listReservations",
    "listTenants",
  ]);

  const adminKey = request.headers.get("x-admin-key") ?? "";
  if (adminActions.has(action)) {
    if (!__tse(adminKey, env.ADMIN_KEY)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized", need: "admin" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8", "x-auth-mode": "admin" },
      });
    }
    // ここは無認可（APIトークン不要）でOK
    return handleAdminAction(action, request, env);
  }

  // ② それ以外は API トークン必須
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !__tse(token, env.API_KEY)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized", need: "api" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "x-auth-mode": "api" },
    });
  }

  // ③ ここから先は「認証済み」ゾーン。__echo__ もここで処理
  if (action === "__echo__") {
    const raw = await request.json().catch(() => ({} as any));
    return new Response(
      JSON.stringify({ ok: true, action, payload: (raw as any)?.payload ?? null, raw, tenant: "salon-booking-saas" }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-auth-mode": "api" } },
    );
  }

  // ④ その他の公開APIは既存ロジックへ
  return handlePublicAction(action, request, env);
}

// ===== ユーティリティ =====

// タイミング安全な等価比較（キー比較用）
function __tse(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ===== 型と既存ハンドラの宣言（実装はあなたの既存コードが使われます） =====
type Env = {
  ADMIN_KEY: string;
  API_KEY: string;
  // 他にKV/DB等のバインドがあればここに追記してOK
};

declare function handleAdminAction(action: string, request: Request, env: Env): Promise<Response>;
declare function handlePublicAction(action: string, request: Request, env: Env): Promise<Response>;
