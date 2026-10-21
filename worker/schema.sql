-- VocalRadio 后端数据结构（Cloudflare D1 / SQLite）
-- 一次性执行（数据库名 likes）：
--   网页端：D1 → likes → Console，粘贴本文件全文执行
--   命令行：wrangler d1 execute likes --remote --config worker/wrangler.toml --file=worker/schema.sql
--
-- 设计要点：
--   · 歌单不在这里，歌单是仓库根目录的 playlist.txt（前端直接读，下载器负责维护）。
--   · 这张表只存「互动计数」，行按需创建：第一次被点赞或播放时才 INSERT，
--     之后走 ON CONFLICT DO UPDATE，一条语句原子累加。
--   · 所以新增歌曲不需要写数据库；只有它被点赞/播放时才会自动出现一行。

DROP TABLE IF EXISTS songs;

CREATE TABLE songs (
  filename   TEXT    PRIMARY KEY,            -- 例：0_奥莉安多幻想曲_请不要带我走.mp3
  likes      INTEGER NOT NULL DEFAULT 0,
  plays      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 排行榜用
CREATE INDEX idx_songs_likes ON songs (likes DESC);
