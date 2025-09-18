export async function onRequestGet() { return new Response('pong', { headers: { 'content-type':'text/plain' } }); }
