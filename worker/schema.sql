-- VocalRadio 后端数据结构（Cloudflare D1 / SQLite）
-- 一次性执行：wrangler d1 execute vocalradio --remote --file=worker/schema.sql

-- 歌单与计数放在同一张表：filename 既是主键也是唯一业务标识。
-- likes / plays 都是整数计数器，靠 SQL 的 likes = likes + 1 原子自增，
-- 这是 KV 做不到的（KV 读-改-写没有原子性，且同一 key 限制 1 次写/秒）。
DROP TABLE IF EXISTS songs;

CREATE TABLE songs (
  filename TEXT    PRIMARY KEY,            -- 例：0_奥莉安多幻想曲_请不要带我走.mp3
  song_id  TEXT    NOT NULL DEFAULT '',    -- 文件名第一段
  singer   TEXT    NOT NULL DEFAULT '',    -- 文件名第二段
  title    TEXT    NOT NULL DEFAULT '',    -- 文件名第三段及以后
  likes    INTEGER NOT NULL DEFAULT 0,
  plays    INTEGER NOT NULL DEFAULT 0,
  added_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 排行榜 / 按热度取数用
CREATE INDEX idx_songs_likes ON songs (likes DESC);
-- 按加入顺序返回歌单用
CREATE INDEX idx_songs_added ON songs (added_at, filename);

INSERT INTO songs (filename, song_id, singer, title) VALUES
  ('0_奥莉安多幻想曲_请不要带我走.mp3', '0', '奥莉安多幻想曲', '请不要带我走'),
  ('1_奥莉安多幻想曲&在虚无中永存_未命名星系.mp3', '1', '奥莉安多幻想曲&在虚无中永存', '未命名星系'),
  ('2_奥莉安多幻想曲_もう一度その名を.mp3', '2', '奥莉安多幻想曲', 'もう一度その名を'),
  ('3_奥莉安多幻想曲_没问Ti！.mp3', '3', '奥莉安多幻想曲', '没问Ti！'),
  ('4_奥莉安多幻想曲_底色theory.mp3', '4', '奥莉安多幻想曲', '底色theory'),
  ('5_奥莉安多幻想曲_灾厄之时.mp3', '5', '奥莉安多幻想曲', '灾厄之时'),
  ('6_奥莉安多幻想曲_人生和只身一人的旅程.mp3', '6', '奥莉安多幻想曲', '人生和只身一人的旅程'),
  ('7_奥莉安多幻想曲_人立方.mp3', '7', '奥莉安多幻想曲', '人立方'),
  ('8_奥莉安多幻想曲&风琴海皇_彼方的幻想乡.mp3', '8', '奥莉安多幻想曲&风琴海皇', '彼方的幻想乡'),
  ('9_奥莉安多幻想曲_完？美？友！人！.mp3', '9', '奥莉安多幻想曲', '完？美？友！人！'),
  ('10_奥莉安多幻想曲_我生于死去之日.mp3', '10', '奥莉安多幻想曲', '我生于死去之日'),
  ('11_奥莉安多幻想曲_我想知道你对于幸福的定义.mp3', '11', '奥莉安多幻想曲', '我想知道你对于幸福的定义'),
  ('12_奥莉安多幻想曲_心愁，就愿。.mp3', '12', '奥莉安多幻想曲', '心愁，就愿。'),
  ('13_奥莉安多幻想曲_芸芸.mp3', '13', '奥莉安多幻想曲', '芸芸'),
  ('14_奥莉安多幻想曲_再次呼唤我的名字吧.mp3', '14', '奥莉安多幻想曲', '再次呼唤我的名字吧'),
  ('15_洛天依Official_权御天下.mp3', '15', '洛天依Official', '权御天下'),
  ('16_DECO27&初音ミク_モニタリング.mp3', '16', 'DECO27&初音ミク', 'モニタリング'),
  ('17_DECO27&初音ミク_モニタリング (Best Friend Remix).mp3', '17', 'DECO27&初音ミク', 'モニタリング (Best Friend Remix)'),
  ('18_MOCKER44.&trashyboi&诗岸_短恨歌.mp3', '18', 'MOCKER44.&trashyboi&诗岸', '短恨歌'),
  ('19_乌托邦P&星尘_落花后日谈.mp3', '19', '乌托邦P&星尘', '落花后日谈'),
  ('20_MaxXing&星尘_皈依者狂热.mp3', '20', 'MaxXing&星尘', '皈依者狂热'),
  ('21_洛天依Official&乐正绫_九九八十一.mp3', '21', '洛天依Official&乐正绫', '九九八十一'),
  ('22_命运结构&诗岸_夏日尽头的我们.mp3', '22', '命运结构&诗岸', '夏日尽头的我们');
