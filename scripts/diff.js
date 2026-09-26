// 纯函数差值计算：对比上次快照与本次 Steam 数据。
// Steam API 只提供累计值，「今日数据」= 当前累计值 - 上次累计值。

/** 游戏库统计：游戏数与总时长（分钟） */
export function libraryStats(games) {
  const entries = Object.values(games ?? {});
  return {
    gameCount: entries.length,
    totalMinutes: entries.reduce((sum, g) => sum + (g.playtimeForever ?? 0), 0),
  };
}

/**
 * 今日时长 = playtimeForever 差值（负数按 0，退款/统计回退）；首见游戏历史时长未知，
 * 不计今日时长只记「新增入库」，避免首见即虚报。playedToday 按今日时长降序。
 */
export function computeDiff(prevGames, currentGames) {
  const playedToday = [];
  const newLibraryGames = [];
  let totalTodayMinutes = 0;

  for (const [appId, current] of entries(currentGames)) {
    const prev = prevGames?.[appId];
    if (!prev) {
      newLibraryGames.push({ appId, name: current.name });
      continue;
    }
    const delta = (current.playtimeForever ?? 0) - (prev.playtimeForever ?? 0);
    if (delta > 0) {
      playedToday.push({
        appId,
        name: current.name,
        todayMinutes: delta,
        totalMinutes: current.playtimeForever ?? 0,
      });
      totalTodayMinutes += delta;
    }
  }

  playedToday.sort((a, b) => b.todayMinutes - a.todayMinutes);
  newLibraryGames.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  return {
    playedToday,
    totalTodayMinutes,
    newLibraryGames,
    library: libraryStats(currentGames),
  };
}

/** 成就差集（保持本次顺序）。unlocktime 早于 windowStartSec（窗口起点 unix 秒）的不算新增，
 *  避免首见老游戏把历史成就当新增；unlocktime 缺失（0）视为未知，保守计入。 */
export function diffAchievements(prevApinames, currentUnlocked, windowStartSec = 0) {
  const prevSet = new Set(prevApinames ?? []);
  return (currentUnlocked ?? [])
    .filter((item) => {
      if (prevSet.has(item.apiname)) return false;
      const knownUnlock = Number.isFinite(windowStartSec) && item.unlocktime > 0;
      return !knownUnlock || item.unlocktime >= windowStartSec;
    })
    .map((item) => ({ ...item }));
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 分钟";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} 小时`;
}

function entries(obj) {
  return Object.entries(obj ?? {});
}
