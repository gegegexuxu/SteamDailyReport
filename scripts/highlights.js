// 战报亮点计算：称号、今日 MVP、里程碑、最近在玩（纯函数，飞书卡片与 Markdown 渲染层共用）。
// 全部只依赖快照里已有的数据，不发起任何 Steam API 请求。
import { formatZhDate, sanitize } from "./text.js";

/** 单游戏 / 库存总时长的播报档位（小时）：上次未达、这次达成才播报 */
const HOUR_TIERS = [10, 25, 50, 100, 200, 500, 1000, 2000, 5000];
/** 全成就鼓励：窗口内有新解锁且距全成就 ≤ 该值时播报 */
const PERFECT_REMAINING = 5;

export function pickTitle(totalTodayMinutes) {
  if (!(totalTodayMinutes > 0)) return "";
  if (totalTodayMinutes >= 300) return "今日肝帝 👑";
  if (totalTodayMinutes >= 120) return "战斗力在线 ⚔️";
  return "小酌怡情 🍵";
}

/** 今日 MVP：playedToday 首项；单款 100% 无信息量，不给占比 */
export function computeMvp(playedToday) {
  const played = playedToday ?? [];
  if (played.length === 0) return null;
  const total = played.reduce((sum, g) => sum + g.todayMinutes, 0);
  const sharePercent =
    played.length > 1 && total > 0 ? Math.round((played[0].todayMinutes / total) * 100) : null;
  return { appId: played[0].appId, sharePercent };
}

/** 里程碑播报：单游戏/库存总时长跨档 + 全成就达成或临近；空数组时渲染层整段隐藏 */
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

/** 休息日的「最近在玩」：rtimeLastPlayed 最近的游戏；beforeUnixSec（窗口起点）内动过的不计，
 *  否则与「当日没有启动任何游戏」矛盾。返回 { name, lastDate }（name 由渲染层 sanitize）。 */
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
