// functions/diag-leads.ts
// 認可ポリシー：以下のいずれかでOK
// 1) Header `x-admin-key` == ADMIN_KEY/ADMIN_TOKEN
// 2) Authorization: Bearer <ADMIN_KEY/ADMIN_TOKEN>
// 3) Cookie `admin_session` の JWT(HMAC-SHA256) が有効 && payload.role == "admin"

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

// --- base64url helpers ---
const b64urlToUint8 = (s: string) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const b64 = s + "=".repeat(pad);
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

const verifyHS256 = async (token: string, secret: string) => {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    const data = enc.encode(`${h}.${p}`);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
    const sig = b64urlToUint8(s);
    if (expected.length !== sig.length) return null;
    // 比較
    for (let i = 0; i < expected.length; i++) if (expected[i] !== sig[i]) return null;
    const payloadJson = new TextDecoder().decode(b64urlToUint8(p));
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
};

const isAuthed = async (req: Request, env: any) => {
  const expected = ((env.ADMIN_KEY ?? env.ADMIN_TOKEN ?? "") as string).trim();
  const jwtSecret = ((env.ADMIN_JWT_SECRET ?? expected) as string).trim();

  // 1) header key
  const hdrKey = (req.headers.get("x-admin-key") ?? "").trim();
  if (expected && hdrKey && hdrKey === expected) return true;

  // 2) bearer
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (expected && bearer && bearer === expected) return true;

  // 3) cookie jwt
  const cookie = req.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)admin_session=([^;]+)/i.exec(cookie);
  if (m && jwtSecret) {
    const payload = await verifyHS256(m[1], jwtSecret);
    if (payload && payload.role === "admin") {
      // exp があればチェック
      if (!payload.exp || Date.now() / 1000 < payload.exp) return true;
    }
  }
  return false;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (!(await isAuthed(request, env))) {
    return json({ ok: false, error: "unauthorized", need: "admin" }, 401);
  }

  // TODO: ここで実データに置き換え
  return json({ ok: true, total: 0, note: "dummy" }, 200);
};
