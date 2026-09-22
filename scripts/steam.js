// Steam Web API 客户端：仅用内置 fetch，带超时与重试。
// 注意：任何错误信息都不包含 API Key。
const API_BASE = "https://api.steampowered.com";
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function apiUrl(interfacePath, params) {
  const url = new URL(`${API_BASE}/${interfacePath}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * 请求并解析 JSON。
 * - 超时 / 网络错误 / 429 / 5xx：重试（指数退避）
 * - 其余 4xx（如无成就的游戏返回 400）：立即失败，由调用方决定是否跳过
 */
async function fetchJson(url, { retries = MAX_RETRIES } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < retries) await sleep(1000 * 2 ** (attempt - 1));
  }
  throw new Error(`Steam API 请求失败: ${lastError.message}`);
}

/** 玩家基础信息（昵称等） */
export async function getPlayerSummary({ apiKey, steamId }) {
  const data = await fetchJson(
    apiUrl("ISteamUser/GetPlayerSummaries/v0002/", { key: apiKey, steamids: steamId }),
  );
  const player = data?.response?.players?.[0];
  if (!player) {
    throw new Error("GetPlayerSummaries 未返回玩家信息，请检查 STEAM_API_KEY 与 STEAM_ID 是否匹配");
  }
  return { personaName: player.personaname ?? "Steam 玩家" };
}

/**
 * 全量游戏库。返回 { gameCount, games }，
 * games 为以 appId 字符串为键的映射：{ [appId]: { name, playtimeForever, rtimeLastPlayed } }
 */
export async function getOwnedGames({ apiKey, steamId }) {
  const data = await fetchJson(
    apiUrl("IPlayerService/GetOwnedGames/v0001/", {
      key: apiKey,
      steamid: steamId,
      include_appinfo: 1,
      include_played_free_games: 1,
      format: "json",
    }),
  );
  const response = data?.response ?? {};
  const games = Array.isArray(response.games) ? response.games : [];
  if (games.length === 0 && (response.game_count ?? 0) === 0) {
    throw new Error(
      "GetOwnedGames 返回空游戏库：请到 Steam 隐私设置将「游戏详情」设为公开（steamcommunity.com/my/edit/settings），并确认 STEAM_ID 正确",
    );
  }

  const gamesMap = {};
  for (const game of games) {
    gamesMap[String(game.appid)] = {
      name: game.name || `App ${game.appid}`,
      playtimeForever: game.playtime_forever ?? 0,
      rtimeLastPlayed: game.rtime_last_played ?? 0,
    };
  }
  return { gameCount: response.game_count ?? games.length, games: gamesMap };
}

/**
 * 某游戏的玩家成就。返回 { total, unlocked: [{ apiname, unlocktime }] }。
 * 游戏无成就 / 未公开时抛错，由调用方捕获并跳过。
 */
export async function getPlayerAchievements({ apiKey, steamId, appId }) {
  const data = await fetchJson(
    apiUrl("ISteamUserStats/GetPlayerAchievements/v0001/", {
      appid: appId,
      key: apiKey,
      steamid: steamId,
    }),
  );
  const stats = data?.playerstats;
  if (!stats || stats.success === false || !Array.isArray(stats.achievements)) {
    throw new Error(stats?.error || "无成就数据");
  }
  const unlocked = stats.achievements
    .filter((a) => a.achieved === 1)
    .map((a) => ({ apiname: a.apiname, unlocktime: a.unlocktime ?? 0 }));
  return { total: stats.achievements.length, unlocked };
}

/**
 * 某游戏的成就名称表（apiname -> 本地化名称）。失败时由调用方降级。
 */
export async function getAchievementSchema({ apiKey, appId, lang = "schinese" }) {
  const data = await fetchJson(
    apiUrl("ISteamUserStats/GetSchemaForGame/v2/", { appid: appId, key: apiKey, l: lang }),
  );
  const list = data?.game?.availableGameStats?.achievements;
  if (!Array.isArray(list)) throw new Error("无成就 schema");
  const names = {};
  for (const item of list) names[item.name] = item.displayName || item.name;
  return names;
}
