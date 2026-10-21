/**
 * 术力口电台后端（Cloudflare Worker + D1）—— 只负责「点赞 / 播放」计数
 *
 * 歌单在哪：仓库根目录的 playlist.txt。前端直接读本地文件，下载器负责维护，
 *   push 到 Pages 即生效。所以这里既不需要歌单接口，也不需要往 D1 手写歌单。
 *
 * 为什么用 D1 而不是 KV：
 *   KV 的 get→+1→put 没有原子性（50 次并发实测只剩 1），且同一 key 限制 1 次写/秒、
 *   免费额度只有 1,000 写/天。D1 用 `INSERT ... ON CONFLICT DO UPDATE SET likes = likes + 1`
 *   一条语句原子完成，免费额度 10 万行写/天。
 *
 * 计数行按需创建：没人点过的歌不会在表里占一行，新增歌曲无需任何数据库操作。
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

// 只接受符合命名规律的 key（序号_歌手_歌名.mp3），
// 避免任意字符串在表里刷出无限行。
const KEY_RE = /^\d{1,4}_.+\.mp3$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8", ...CORS_HEADERS },
  });
}

function invalidKey(key) {
  return !key || key.length > 200 || !KEY_RE.test(key);
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
      /* ---------- 歌单已迁到仓库，接口下线 ---------- */
      if (path === "/api/random" || path === "/api/songlist") {
        return json(
          {
            error: "gone",
            message: "歌单已迁移到仓库根目录的 playlist.txt，由前端直接读取；查看计数请用 GET /api/songs。",
          },
          410
        );
      }

      /* ---------- 全部点赞（只返回有互动的歌，缺省视为 0） ---------- */
      if (path === "/api/allLikes") {
        const { results } = await db.prepare("SELECT filename, likes FROM songs").all();
        const out = {};
        for (const r of results || []) out[r.filename] = r.likes;
        return json(out);
      }

      /* ---------- 单曲点赞数 ---------- */
      if (path === "/api/getLike") {
        const key = url.searchParams.get("key");
        if (invalidKey(key)) return json({ count: 0 });
        const row = await db
          .prepare("SELECT likes FROM songs WHERE filename = ?1")
          .bind(key)
          .first();
        // 没被点过的歌返回 0，前端会把这个数字直接写进 DOM
        return json({ count: row ? row.likes : 0 });
      }

      /* ---------- 点赞 +1（按需建行 + 原子自增） ---------- */
      if (path === "/api/like") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "no key" }, 400);
        if (invalidKey(key)) return json({ key, count: 0, ignored: "invalid key" });

        const row = await db
          .prepare(
            "INSERT INTO songs (filename, likes) VALUES (?1, 1) " +
              "ON CONFLICT(filename) DO UPDATE SET likes = likes + 1, updated_at = datetime('now') " +
              "RETURNING likes"
          )
          .bind(key)
          .first();

        return json({ key, count: row ? row.likes : 0 });
      }

      /* ---------- 播放上报（异步，不阻塞响应） ---------- */
      if (path === "/api/play") {
        const key = url.searchParams.get("key");
        if (key && !invalidKey(key)) {
          ctx.waitUntil(
            db
              .prepare(
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

      /* ---------- 排行 / 后台查看 ---------- */
      if (path === "/api/songs") {
        const { results } = await db
          .prepare(
            "SELECT filename, likes, plays, updated_at FROM songs " +
              "ORDER BY likes DESC, plays DESC, filename LIMIT 500"
          )
          .all();
        return json({ list: results || [] });
      }

      /* ---------- 根路径 ---------- */
      return json({
        msg: "术力口电台 worker（D1，只做计数）",
        playlist: "仓库根目录 playlist.txt",
        endpoints: [
          "GET /api/like?key=   → { key, count }",
          "GET /api/getLike?key=→ { count }",
          "GET /api/allLikes    → { filename: likes }",
          "GET /api/play?key=   → { ok }",
          "GET /api/songs       → { list: [{filename,likes,plays}] }",
        ],
      });
    } catch (e) {
      console.error("worker 异常", e);
      return json({ error: "internal error", detail: String(e && e.message ? e.message : e) }, 500);
    }
  },
};
