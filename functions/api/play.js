// GET /api/play?key=<filename> —— 播放上报（play +1）
// 立即返回 { ok: true }，写库放在 waitUntil 里，不拖慢响应。
import { json, invalidKey, dbOrError, onRequestOptions } from "./_lib.js";

export { onRequestOptions };

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;
  const bad = dbOrError(env);
  if (bad) return bad;

  const key = new URL(request.url).searchParams.get("key");
  if (key && !invalidKey(key)) {
    waitUntil(
      env.DB.prepare(
        "INSERT INTO songs (filename, plays) VALUES (?1, 1) " +
          "ON CONFLICT(filename) DO UPDATE SET plays = plays + 1, updated_at = datetime('now')"
      )
        .bind(key)
        .run()
        .catch((e) => console.warn("play 计数失败", e))
    );
  }
  return json({ ok: true });
}
