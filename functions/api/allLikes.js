// GET /api/allLikes —— 全部点赞 { "<filename>": likes }
// 只返回有互动的歌；列表里没出现的 = 0 赞。
import { json, dbOrError, onRequestOptions } from "./_lib.js";

export { onRequestOptions };

export async function onRequestGet(context) {
  const { env } = context;
  const bad = dbOrError(env);
  if (bad) return bad;

  try {
    const { results } = await env.DB.prepare("SELECT filename, likes FROM songs").all();
    const out = {};
    for (const r of results || []) out[r.filename] = r.likes;
    return json(out);
  } catch (e) {
    return json({ error: "internal error", detail: String(e && e.message ? e.message : e) }, 500);
  }
}
