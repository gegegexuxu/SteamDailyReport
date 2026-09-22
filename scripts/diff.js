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
 * 对比游戏库，产出战报核心数据。
 *
 * 规则：
 * - 今日时长 = playtimeForever 差值；负数（退款/统计回退）按 0 处理
 * - 上次快照中不存在的游戏记为「新增入库」；因其历史时长未知，
 *   不计入今日游玩时长，避免首见即虚报
 * - playedToday 按今日时长降序
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

/** 成就差集：返回本次新增解锁的 apiname 列表（保持本次顺序） */
export function diffAchievements(prevApinames, currentUnlocked) {
  const prevSet = new Set(prevApinames ?? []);
  return (currentUnlocked ?? [])
    .filter((item) => !prevSet.has(item.apiname))
    .map((item) => ({ ...item }));
}

/** 分钟数转人类可读时长 */
export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 分钟";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} 小时`;
}

function entries(obj) {
  return Object.entries(obj ?? {});
}
