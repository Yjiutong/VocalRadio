/**
 * 术力口电台后端（Cloudflare Worker + D1）
 *
 * 相对原先「全部塞进 KV」的改动：
 *   1. 点赞用 `likes = likes + 1` 原子自增 —— KV 的读-改-写没有原子性，并发必丢；
 *      而且 KV 对同一 key 限制 1 次写/秒，热门歌曲连点几次就写不进去。
 *   2. 歌单与计数放同一张表 —— 原先 KV 里的 `songlist`、仓库的 playlist.txt、
 *      前端硬编码三份数据，谁也不知道哪个是对的。现在 D1 是唯一事实来源。
 *   3. /api/allLikes 一次 SELECT 取全部 —— 原先是 23 首歌 23 次串行 kv.get。
 *   4. key 必须存在于歌单，否则不写库 —— 原先任意 key 都能创建 KV 记录，无界增长。
 *   5. 免费额度：KV 写 1,000/天 → D1 写 100,000 行/天，播放上报不再轻易打满。
 *
 * 接口路径与返回结构与旧版完全一致，前端无需改动。
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method not allowed" }, 405);
    }

    const db = env.DB;
    if (!db) {
      return json({ error: "D1 binding `DB` 未配置，请检查 wrangler.toml" }, 500);
    }

    try {
      /* ---------- 1. 歌单 ---------- */
      if (path === "/api/random") {
        const { results } = await db
          .prepare("SELECT filename FROM songs ORDER BY added_at, filename")
          .all();
        const list = (results || []).map((r) => r.filename);
        return json({ list });
      }

      /* ---------- 2. 全部点赞（一次查询） ---------- */
      if (path === "/api/allLikes") {
        const { results } = await db.prepare("SELECT filename, likes FROM songs").all();
        const out = {};
        for (const r of results || []) out[r.filename] = r.likes;
        return json(out);
      }

      /* ---------- 3. 单曲点赞数 ---------- */
      if (path === "/api/getLike") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "no key" }, 400);
        const row = await db
          .prepare("SELECT likes FROM songs WHERE filename = ?1")
          .bind(key)
          .first();
        // 未知 key 返回 0 而不是报错：前端会直接把这个数字写进 DOM
        return json({ count: row ? row.likes : 0 });
      }

      /* ---------- 4. 点赞 +1（原子） ---------- */
      if (path === "/api/like") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "no key" }, 400);

        const row = await db
          .prepare("UPDATE songs SET likes = likes + 1 WHERE filename = ?1 RETURNING likes")
          .bind(key)
          .first();

        // 不在歌单里的 key 不写库，但仍然返回数字，避免前端显示 undefined
        if (!row) return json({ key, count: 0, ignored: "unknown key" });
        return json({ key, count: row.likes });
      }

      /* ---------- 5. 播放上报（异步，不阻塞响应） ---------- */
      if (path === "/api/play") {
        const key = url.searchParams.get("key");
        if (key) {
          ctx.waitUntil(
            db
              .prepare("UPDATE songs SET plays = plays + 1 WHERE filename = ?1")
              .bind(key)
              .run()
              .catch((e) => console.warn("play 计数失败", e))
          );
        }
        return json({ ok: true });
      }

      /* ---------- 6. 歌单详情（含点赞/播放，调试与后台用） ---------- */
      if (path === "/api/songs" || path === "/api/songlist") {
        const { results } = await db
          .prepare(
            "SELECT filename, song_id, singer, title, likes, plays, added_at " +
              "FROM songs ORDER BY added_at, filename"
          )
          .all();
        return json({ list: results || [] });
      }

      /* ---------- 根路径 ---------- */
      return json({
        msg: "术力口电台 worker（D1）",
        endpoints: [
          "GET /api/random      → { list: [filename...] }",
          "GET /api/allLikes    → { filename: likes }",
          "GET /api/getLike?key=→ { count }",
          "GET /api/like?key=   → { key, count }",
          "GET /api/play?key=   → { ok }",
          "GET /api/songs       → { list: [{filename,singer,title,likes,plays}] }",
        ],
      });
    } catch (e) {
      console.error("worker 异常", e);
      return json({ error: "internal error", detail: String(e && e.message ? e.message : e) }, 500);
    }
  },
};
