export default {
  async fetch(req) {
    const u = new URL(req.url);
    return new Response("WORKER " + u.pathname, { headers: { "content-type":"text/plain" } });
  }
};
