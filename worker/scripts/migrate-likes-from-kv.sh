#!/usr/bin/env bash
# 把旧 KV 里的 `like_<文件名>` 计数导入 D1（播放数不迁：旧值本来就不准，且没什么参考价值）。
#
# 用法（在仓库根目录执行，需已 wrangler login）：
#   export KV_NAMESPACE_ID="<旧 KV 的命名空间 id>"
#   bash worker/scripts/migrate-likes-from-kv.sh
#
# 拿命名空间 id：npx wrangler kv namespace list
#
# 说明：点赞量级很小（个位数），嫌麻烦也可以跳过——直接让 D1 从 0 开始。
set -euo pipefail

: "${KV_NAMESPACE_ID:?请先 export KV_NAMESPACE_ID=<旧 KV 命名空间 id>}"
DB_NAME="${D1_DB_NAME:-vocalradio}"
CONFIG="${WRANGLER_CONFIG:-worker/wrangler.toml}"
PLAYLIST="${PLAYLIST:-playlist.txt}"
OUT="${OUT_SQL:-$(mktemp -t likes-from-kv-XXXXXX.sql)}"

WRANGLER="${WRANGLER:-npx wrangler}"

echo "-- 从 KV 导入点赞数（生成的 SQL）" >"$OUT"

while IFS= read -r f; do
  raw=$($WRANGLER kv key get "like_$f" --namespace-id "$KV_NAMESPACE_ID" --remote 2>/dev/null | tr -d '\r\n' || true)
  if [[ "$raw" =~ ^[0-9]+$ ]]; then n="$raw"; else n=0; fi
  esc=${f//\'/\'\'}
  printf "UPDATE songs SET likes = %s WHERE filename = '%s';\n" "$n" "$esc" >>"$OUT"
  printf '  %-52s %s\n' "$f" "$n"
done < <(grep -o '"[^"]*\.mp3"' "$PLAYLIST" | tr -d '"')

echo
echo "已生成：$OUT"
echo "执行：npx wrangler d1 execute $DB_NAME --remote --config $CONFIG --file=$OUT"
