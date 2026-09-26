// 快照（state.json）读写与配置解析工具。
// 状态结构 v4：accounts 按 SteamID64 分桶，各账号独立维护 snapshots 与 lastSentWindow，互不干扰；
// 每个桶内 snapshots = 最近两份快照（旧 → 新，[0] 为差值基线/窗口起点，[1] 为窗口终点），
// lastSentWindow = 已发送窗口终点快照的 capturedAt（幂等标记，兼作「已被播报消费」标记，见 pushSnapshot）。
// CI 中该文件由 Actions Artifact 提供/上传，不进入 Git 历史。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_TIMEZONE = "Asia/Shanghai";
export const STATE_VERSION = 4;
const MAX_SNAPSHOTS = 2;

/** 解析 STEAM_ID 配置：支持逗号/分号/空白分隔多个 SteamID64，去重保序 */
export function parseSteamIds(raw) {
  return [...new Set(String(raw ?? "").split(/[\s,;，；]+/).filter(Boolean))];
}

/** 返回指定时区的当前日期，格式 YYYY-MM-DD */
export function todayIn(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  // en-CA locale 恰好输出 ISO 风格的 YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/** 返回指定时区的当前时间，格式 HH:mm */
export function nowTimeIn(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/**
 * 读取快照；不存在或损坏时返回 null（按首次运行处理）。
 * v1/v2/v3 旧状态自动迁移为 v4，旧数据归属 legacySteamId（升级前只能配置一个账号，即当前列表第一个）。
 */
export function loadState(filePath, legacySteamId = "") {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`⚠️ 读取快照失败（${err.code ?? err.message}），将按首次运行处理`);
    }
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    console.warn("⚠️ 快照内容异常，将按首次运行处理");
    return null;
  }
  if (parsed.version === STATE_VERSION) {
    if (!isValidState(parsed)) {
      console.warn("⚠️ 快照版本无法识别，将按首次运行处理");
      return null;
    }
    return parsed;
  }
  const bucket = migrateLegacy(parsed);
  if (!bucket) {
    console.warn("⚠️ 快照版本无法识别，将按首次运行处理");
    return null;
  }
  console.log(`⬆️ 快照状态 v${parsed.version} → v${STATE_VERSION}，旧数据归属账号 ${legacySteamId || "(未知)"}`);
  return { version: STATE_VERSION, accounts: { [legacySteamId]: bucket } };
}

/** v1（单快照）与 v2（前日基线 + 当日快照）与 v3（单账号快照数组）→ v4 的单账号桶 */
function migrateLegacy(state) {
  let bucket = null;
  if (state.version === 1 && typeof state.lastReportDate === "string") {
    bucket = {
      snapshots: [
        snapshotFrom(state.personaName, state.games, state.achievements, state.lastReportDate, state.capturedAt),
      ],
      // v1 当天已发过战报，标记该窗口避免升级后重复推送
      lastSentWindow: state.capturedAt ?? null,
    };
  } else if (state.version === 2 && "prev" in state) {
    const snapshots = [state.prev, state.current]
      .filter(Boolean)
      .map((snap) => snapshotFrom(snap.personaName, snap.games, snap.achievements, snap.date));
    // v2 的 current 只在发送成功后才写入，存在即代表该窗口已发过
    bucket = { snapshots, lastSentWindow: snapshots.at(-1)?.capturedAt ?? null };
  } else if (state.version === 3 && Array.isArray(state.snapshots)) {
    bucket = { snapshots: state.snapshots, lastSentWindow: state.lastSentWindow ?? null };
  }
  return bucket && isValidBucket(bucket) ? bucket : null;
}

function snapshotFrom(personaName, games, achievements, date, capturedAt) {
  return {
    date,
    capturedAt: capturedAt ?? `${date}T00:00:00.000Z`,
    personaName: personaName ?? "",
    games: games ?? {},
    achievements: achievements ?? {},
  };
}

function isValidState(state) {
  return (
    state.version === STATE_VERSION &&
    typeof state.accounts === "object" &&
    state.accounts !== null &&
    Object.values(state.accounts).every(isValidBucket)
  );
}

function isValidBucket(bucket) {
  return (
    typeof bucket === "object" &&
    bucket !== null &&
    Array.isArray(bucket.snapshots) &&
    bucket.snapshots.length <= MAX_SNAPSHOTS &&
    bucket.snapshots.every((snap) => typeof snap?.date === "string") &&
    (bucket.lastSentWindow === null || typeof bucket.lastSentWindow === "string")
  );
}

export function saveState(filePath, state) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function getAccount(state, steamId) {
  return state?.accounts?.[steamId] ?? null;
}

export function withAccount(state, steamId, account) {
  return { version: STATE_VERSION, accounts: { ...state?.accounts, [steamId]: account } };
}

export function buildSnapshot({ date, personaName, games, achievements, capturedAt = new Date().toISOString() }) {
  return { date, capturedAt, personaName, games, achievements };
}

/**
 * 追加快照，只保留最近两份（[0] 差值基线，[1] 窗口终点）；lastSentWindow 原样保留。
 * 同日重拍且最新一份尚未被播报（capturedAt ≠ lastSentWindow）时直接顶替，不挤掉差值基线。
 */
export function pushSnapshot(account, snapshot) {
  const prev = account?.snapshots ?? [];
  const latest = prev.at(-1);
  const isRework =
    latest && latest.date === snapshot.date && latest.capturedAt !== account?.lastSentWindow;
  const snapshots = isRework
    ? [...prev.slice(0, -1), snapshot]
    : [...prev, snapshot].slice(-MAX_SNAPSHOTS);
  return { snapshots, lastSentWindow: account?.lastSentWindow ?? null };
}
