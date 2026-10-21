// GET /api/getLike?key=<filename> —— 单曲点赞数（没点过返回 0）
import { json, invalidKey, dbOrError, onRequestOptions } from "./_lib.js";

export { onRequestOptions };

export async function onRequestGet(context) {
  const { request, env } = context;
  const bad = dbOrError(env);
  if (bad) return bad;

  const key = new URL(request.url).searchParams.get("key");
  if (invalidKey(key)) return json({ count: 0 });

  try {
    const row = await env.DB.prepare("SELECT likes FROM songs WHERE filename = ?1")
      .bind(key)
      .first();
    return json({ count: row ? row.likes : 0 });
  } catch (e) {
    return json({ count: 0, error: String(e && e.message ? e.message : e) }, 500);
  }
}
