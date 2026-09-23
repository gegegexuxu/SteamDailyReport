// 战报亮点计算：称号、今日 MVP、里程碑、最近在玩（纯函数，飞书卡片与 Markdown 渲染层共用）。
// 全部只依赖快照里已有的数据，不发起任何 Steam API 请求。
import { formatZhDate, sanitize } from "./text.js";

/** 单游戏 / 库存总时长的播报档位（小时）：上次未达、这次达成才播报 */
const HOUR_TIERS = [10, 25, 50, 100, 200, 500, 1000, 2000, 5000];
/** 全成就鼓励：窗口内解锁了成就且距全成就 ≤ 该值时播报 */
const PERFECT_REMAINING = 5;

/** 当日称号：≥5 小时肝帝、≥2 小时在线、>0 小酌；没玩返回空串 */
export function pickTitle(totalTodayMinutes) {
  if (!(totalTodayMinutes > 0)) return "";
  if (totalTodayMinutes >= 300) return "今日肝帝 👑";
  if (totalTodayMinutes >= 120) return "战斗力在线 ⚔️";
  return "小酌怡情 🍵";
}

/**
 * 今日 MVP：当日玩最久的游戏（playedToday 已按当日时长降序，取首项）。
 * 多款游戏时附带占当日总时长的百分比；单款 100% 没有信息量，只给徽章。
 */
export function computeMvp(playedToday) {
  const played = playedToday ?? [];
  if (played.length === 0) return null;
  const total = played.reduce((sum, g) => sum + g.todayMinutes, 0);
  const sharePercent =
    played.length > 1 && total > 0 ? Math.round((played[0].todayMinutes / total) * 100) : null;
  return { appId: played[0].appId, sharePercent };
}

/**
 * 里程碑播报，返回渲染就绪的行数组（无里程碑为空数组，渲染层整段隐藏）：
 * - 单游戏累计时长跨档（与 computeDiff 一致，新入库游戏因历史时长未知不播报；
 *   长合并窗口一次跨过多档时取最高档）
 * - 库存总时长跨档（同样取最高档）
 * - 全成就：本窗口有新解锁且距全成就 ≤5 个 →「再拿 N 个」；本窗口集齐 → 达成庆祝
 */
export function computeMilestones({ baseGames, latestGames, achievements }) {
  const lines = [];

  for (const [appId, current] of Object.entries(latestGames ?? {})) {
    const prev = baseGames?.[appId];
    if (!prev) continue;
    const prevMinutes = prev.playtimeForever ?? 0;
    const nowMinutes = current.playtimeForever ?? 0;
    const tier = HOUR_TIERS.findLast((h) => prevMinutes < h * 60 && nowMinutes >= h * 60);
    if (tier) lines.push(`🎉 ${sanitize(current.name)} 累计突破 ${tier} 小时`);
  }

  const sumPlaytime = (games) =>
    Object.values(games ?? {}).reduce((sum, g) => sum + (g.playtimeForever ?? 0), 0);
  const prevTotal = sumPlaytime(baseGames);
  const nowTotal = sumPlaytime(latestGames);
  const totalTier = HOUR_TIERS.findLast((h) => prevTotal < h * 60 && nowTotal >= h * 60);
  if (totalTier) lines.push(`📚 库存总时长突破 ${totalTier} 小时`);

  for (const game of achievements ?? []) {
    if (game.added.length === 0) continue;
    const remaining = game.total - game.unlockedCount;
    if (remaining === 0) lines.push(`🏆 ${sanitize(game.gameName)} 全成就达成！`);
    else if (remaining <= PERFECT_REMAINING)
      lines.push(`${sanitize(game.gameName)} ${game.unlockedCount}/${game.total}，再拿 ${remaining} 个成就就全达成`);
  }

  return lines;
}

/**
 * 休息日的「最近在玩」：rtimeLastPlayed 最近且确实玩过的游戏。
 * beforeUnixSec 为统计窗口起点的 unix 秒——窗口内动过的游戏（当日新买即玩、
 * 打开不到一分钟等）不计，否则「上次开团」会与「当日没有启动任何游戏」自相矛盾。
 * 返回 { name, lastDate }（name 未清洗，由渲染层 sanitize）或 null（窗口前从未玩过）。
 */
export function lastPlayedGame(games, timeZone, beforeUnixSec = Infinity) {
  let best = null;
  for (const game of Object.values(games ?? {})) {
    const last = game.rtimeLastPlayed ?? 0;
    if (last <= 0 || last >= beforeUnixSec) continue;
    if (!best || last > best.rtimeLastPlayed) best = game;
  }
  if (!best) return null;
  return { name: best.name, lastDate: formatZhDate(unixDateIn(best.rtimeLastPlayed, timeZone)) };
}

/** unix 秒 → 时区日期 YYYY-MM-DD（en-CA locale 恰好输出 ISO 风格，同 state.js 的技巧） */
function unixDateIn(seconds, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(seconds * 1000));
}
