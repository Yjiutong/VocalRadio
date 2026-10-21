DROP TABLE IF EXISTS songs;
CREATE TABLE songs (filename TEXT PRIMARY KEY, likes INTEGER NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_songs_likes ON songs (likes DESC);
