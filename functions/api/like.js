// GET /api/like?key=<filename> —— 点赞 +1（按需建行 + 原子自增）
// 返回 { key, count }；非法 key 直接忽略，不在表里建行。
import { json, invalidKey, dbOrError, onRequestOptions } from "./_lib.js";

export { onRequestOptions };

export async function onRequestGet(context) {
  const { request, env } = context;
  const bad = dbOrError(env);
  if (bad) return bad;

  const key = new URL(request.url).searchParams.get("key");
  if (!key) return json({ error: "no key" }, 400);
  if (invalidKey(key)) return json({ key, count: 0, ignored: "invalid key" });

  try {
    const row = await env.DB.prepare(
      "INSERT INTO songs (filename, likes) VALUES (?1, 1) " +
        "ON CONFLICT(filename) DO UPDATE SET likes = likes + 1, updated_at = datetime('now') " +
        "RETURNING likes"
    )
      .bind(key)
      .first();
    return json({ key, count: row ? row.likes : 0 });
  } catch (e) {
    return json({ error: "internal error", detail: String(e && e.message ? e.message : e) }, 500);
  }
}
