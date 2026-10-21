/**
 * 点赞 / 播放计数 —— 公共部分（Cloudflare Pages Functions）
 *
 * 本文件以 `_` 开头，Pages 不会把它注册成路由，只作为模块被其他函数 import。
 *
 * 为什么用 D1 而不是 KV：
 *   KV 的 get→+1→put 没有原子性（50 次并发实测只剩 1），且同一 key 限制 1 次写/秒、
 *   免费额度只有 1,000 写/天。D1 用
 *   `INSERT ... ON CONFLICT DO UPDATE SET likes = likes + 1` 一条语句原子完成。
 *
 * 计数行按需创建：没人点过的歌不会在表里占一行，新增歌曲无需任何数据库操作。
 * 歌单不在这里 —— 歌单是仓库根目录的 playlist.txt，前端直接读。
 */

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

// 只接受符合命名规律的 key（序号_歌手_歌名.mp3），
// 避免任意字符串在表里刷出无限行。
export const KEY_RE = /^\d{1,4}_.+\.mp3$/;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8", ...CORS_HEADERS },
  });
}

export function invalidKey(key) {
  return !key || key.length > 200 || !KEY_RE.test(key);
}

/** OPTIONS 预检：同源调用用不到，但保留以防被别的域名引用 */
export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** 缺绑定时的统一报错，返回 null 表示一切正常 */
export function dbOrError(env) {
  if (!env || !env.DB) {
    return json(
      {
        error: "D1 绑定 `DB` 未配置",
        fix: "Pages 项目 → Settings → Bindings → Add → D1 database bindings，Variable name 填 DB，选数据库 likes，然后重新部署",
      },
      500
    );
  }
  return null;
}
