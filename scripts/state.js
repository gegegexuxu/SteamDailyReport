// 快照（state.json）读写与时区日期工具。
// 状态结构 v3：snapshots = 最近两份快照（旧 → 新，[0] 为差值基线/窗口起点，[1] 为窗口终点），
// lastSentWindow = 已发送窗口终点快照的 capturedAt（幂等标记，防止同一窗口重复推送）。
// CI 中该文件由 Actions Artifact 提供/上传，不进入 Git 历史。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_TIMEZONE = "Asia/Shanghai";
const STATE_VERSION = 3;
const MAX_SNAPSHOTS = 2;

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

/** 读取快照；不存在或损坏时返回 null（按首次运行处理），不让进程崩溃。v1/v2 旧状态自动迁移为 v3。 */
export function loadState(filePath) {
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
  const state = migrateState(parsed);
  if (!isValidState(state)) {
    console.warn("⚠️ 快照版本无法识别，将按首次运行处理");
    return null;
  }
  return state;
}

/** v1（单快照）与 v2（前日基线 + 当日快照）→ v3（快照数组）；旧快照缺 capturedAt 时用日期合成 */
function migrateState(state) {
  if (state.version === 1 && typeof state.lastReportDate === "string") {
    return {
      version: STATE_VERSION,
      snapshots: [
        snapshotFrom(state.personaName, state.games, state.achievements, state.lastReportDate, state.capturedAt),
      ],
      // v1 当天已发过战报，标记该窗口避免升级后重复推送
      lastSentWindow: state.capturedAt ?? null,
    };
  }
  if (state.version === 2 && "prev" in state) {
    const snapshots = [state.prev, state.current]
      .filter(Boolean)
      .map((snap) => snapshotFrom(snap.personaName, snap.games, snap.achievements, snap.date));
    // v2 的 current 只在发送成功后才写入，存在即代表该窗口已发过
    return { version: STATE_VERSION, snapshots, lastSentWindow: snapshots.at(-1)?.capturedAt ?? null };
  }
  return state;
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
    Array.isArray(state.snapshots) &&
    state.snapshots.length <= MAX_SNAPSHOTS &&
    state.snapshots.every((snap) => typeof snap?.date === "string") &&
    (state.lastSentWindow === null || typeof state.lastSentWindow === "string")
  );
}

/** 写入快照（自动创建目录） */
export function saveState(filePath, state) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** 组装某日某时刻的累计值快照 */
export function buildSnapshot({ date, personaName, games, achievements, capturedAt = new Date().toISOString() }) {
  return { date, capturedAt, personaName, games, achievements };
}

/** 追加快照，只保留最近两份（[0] 差值基线，[1] 窗口终点）；lastSentWindow 原样保留 */
export function pushSnapshot(state, snapshot) {
  const snapshots = [...(state?.snapshots ?? []), snapshot].slice(-MAX_SNAPSHOTS);
  return { version: STATE_VERSION, snapshots, lastSentWindow: state?.lastSentWindow ?? null };
}

/** 组装完整状态对象 */
export function buildState({ snapshots, lastSentWindow }) {
  return { version: STATE_VERSION, snapshots, lastSentWindow };
}
