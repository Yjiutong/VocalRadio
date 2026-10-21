// GET /api/songs —— 排行 / 后台查看，按点赞倒序
import { json, dbOrError, onRequestOptions } from "./_lib.js";

export { onRequestOptions };

export async function onRequestGet(context) {
  const { env } = context;
  const bad = dbOrError(env);
  if (bad) return bad;

  try {
    const { results } = await env.DB.prepare(
      "SELECT filename, likes, plays, updated_at FROM songs " +
        "ORDER BY likes DESC, plays DESC, filename LIMIT 500"
    ).all();
    return json({ list: results || [] });
  } catch (e) {
    return json({ error: "internal error", detail: String(e && e.message ? e.message : e) }, 500);
  }
}
