// GET /api/random —— 已下线，固定返回 410
// 歌单已迁移到仓库根目录的 playlist.txt，前端直接读取。
// 保留这个接口是为了让「浏览器缓存里的旧 JS」拿到明确信号而不是 404。
import { json, onRequestOptions } from "./_lib.js";

export { onRequestOptions };

export function onRequestGet() {
  return json(
    {
      error: "gone",
      message: "歌单已迁移到仓库根目录的 playlist.txt，由前端直接读取；查看计数请用 GET /api/songs。",
    },
    410
  );
}
