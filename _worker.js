export default {
  async fetch(req, env, ctx) {
    return new Response("pong", { headers: { "content-type": "text/plain" } });
  }
};
