// ===== License Helper (drop-in) =====
const corsHeaders = {
  "content-type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Vary": "origin",
};
const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, ...headers } });

const splitList = (s) => (s || "")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

const licenseGate = (env, { action, tenant, toolId }) => {
  // 1) 開発用バイパス（saveLead だけ）
  if (env.ALLOW_PUBLIC_SAVELEAD === "1" && action === "saveLead") {
    return { ok: true, reason: "dev_bypass" };
  }
  // 2) 正攻法：テナント/ツールのホワイトリスト
  const activeTenants = splitList(env.ACTIVE_TENANTS);
  const activeTools   = splitList(env.ACTIVE_TOOLS);
  const configured = activeTenants.length + activeTools.length > 0;

  const byTenant = tenant && activeTenants.includes(tenant);
  const byTool   = toolId && activeTools.includes(toolId);

  if (!configured) return { ok: true, reason: "no_rule" }; // ルール未設定なら通す（開発想定）
  if (byTenant || byTool) return { ok: true, reason: "whitelist" };

  return { ok: false, error: "license_inactive" };
};
// ===== /License Helper =====

// Minimal API mock (Node http)
const http = require('http');
const routes = [
  { method: "POST", path: "/api/customers/signup" },
  { method: "POST", path: "/api/customers/login" },
  { method: "POST", path: "/api/bookings" },
  { method: "DELETE", path: "/api/bookings/{bookingId}" },
  { method: "PUT", path: "/api/bookings/{bookingId}" },
  { method: "POST", path: "/api/payments/intent" },
  { method: "POST", path: "/api/payments/mark-paid" },
  { method: "GET", path: "/api/notifications/email-template" },
  { method: "GET", path: "/api/admin/dashboard" }
];
const server = http.createServer((req,res)=>{
  const hit = routes.find(r => r.method === req.method && r.path === req.url);
  res.setHeader('content-type','application/json; charset=utf-8');
  if (hit) res.end(JSON.stringify({ ok:true, route: hit }));
  else { res.statusCode = 404; res.end(JSON.stringify({ ok:false, error:'not_found' })); }
});
server.listen(3000, ()=> console.log('API mock on http://localhost:3000'));
