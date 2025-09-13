// candidate と envKey をトリムしてから判定
const qsKey  = (url.searchParams.get("key") ?? "").trim() || undefined;
const hdrKey = (request.headers.get("x-admin-key") ?? "").trim() || undefined;
let bodyKey: string | undefined = undefined;
if ((request.headers.get("content-type") || "").includes("application/json")) {
  const j = await request.json().catch(() => ({} as any));
  bodyKey = typeof j?.key === "string" ? j.key.trim() : undefined;
}

const candidate = bodyKey ?? hdrKey ?? qsKey;
const envKey = (env.ADMIN_KEY || "").trim();

if (!candidate) return json({ ok:false, error:"missing key" }, 401);
if (!envKey)    return json({ ok:false, error:"missing ADMIN_KEY" }, 500);

// 長さチェックもトリム後で
if (candidate.length !== envKey.length) {
  return json({ ok:false, error:"length mismatch", got:candidate.length, need:envKey.length }, 401);
}
if (!tse(candidate, envKey)) return json({ ok:false, error:"mismatch" }, 401);
