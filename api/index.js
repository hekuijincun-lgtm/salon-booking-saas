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