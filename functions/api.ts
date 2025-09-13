// /functions/api.ts（抜粋：ガード部分の直後）

// ① adminは先に判定（x-admin-keyのみ）
if (adminActions.has(action)) { /* 既存のまま */ }

// ② それ以外はAPIトークン必須
const auth = request.headers.get("authorization") ?? "";
const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
if (!token || !constantTimeEqual(token, env.API_KEY)) {
  return json({ ok:false, error:"unauthorized", need:"api" }, 401);
}

// ③ ここから先は認証済み。__echo__ もここで扱う
if (action === "__echo__") {
  const raw = await request.json().catch(() => ({}));
  return json({ ok:true, action, payload: raw?.payload ?? null, raw, tenant: "salon-booking-saas" });
}

// ④ その他の公開API
return handlePublicAction(action, request, env);
