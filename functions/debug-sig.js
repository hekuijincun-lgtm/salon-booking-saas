export async function onRequestPost({ request, env }) {
  const buf = new Uint8Array(await request.arrayBuffer());
  const macB64 = await hmacB64(env.LINE_CHANNEL_SECRET, buf);
  return Response.json({ macB64, bodyLen: buf.length });
}
async function hmacB64(secret, bytes){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, bytes);
  const b = new Uint8Array(mac); let s=""; for (let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
  return btoa(s);
}
