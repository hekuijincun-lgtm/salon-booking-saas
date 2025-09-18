export default {
  async fetch(request, env, ctx) {
    return new Response("WORKER ALIVE"); // ← 一旦これだけ
  }
};
