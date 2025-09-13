// /_worker.js — 静的アセットへ素通し（余計なリダイレクトを一切しない）
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
