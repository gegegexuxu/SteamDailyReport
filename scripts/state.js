// 快照（state.json）读写、时区时间工具与发送时刻判定。
// 快照结构 v2：prev = 前一日最后一次快照（当日所有战报的比较基线），
// current = 当日最近一次快照（次日首次发送时滚动为新的 prev）。
// CI 中该文件由 Actions Artifact 提供/上传，不进入 Git 历史。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_TIMEZONE = "Asia/Shanghai";
export const DEFAULT_REPORT_TIME = "22:00";
export const STATE_VERSION = 2;

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

/** "HH:MM" → 当日分钟数（%24 兼容个别环境下午夜显示为 24:xx） */
function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour % 24) * 60 + minute;
}

/** 解析单个发送时刻（"HH" 或 "HH:MM"）；合法返回 {hour, minute}，否则 null */
export function parseReportTime(value) {
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** 解析 REPORT_TIME（逗号分隔的多个时刻，升序）；为空或任一非法返回 null */
export function parseReportTimes(value) {
  const parts = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const parsed = parts.map(parseReportTime);
  if (parsed.length === 0 || parsed.some((item) => item === null)) return null;
  return parsed.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

/** {hour, minute} → "HH:MM" */
export function formatReportTime({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * 是否存在「已到点但今日尚未发送」的时刻（轮询门控用）。
 * lastSent 为 { date, time }（报告时区）或 null；时刻 T 视为已发送：
 * lastSent.date == 今天 且 lastSent.time >= T（一次发送满足其之前所有时刻）。
 */
export function hasDueReportTime(timeZone, reportTimes, lastSent, now = new Date()) {
  const nowMinutes = timeToMinutes(nowTimeIn(timeZone, now));
  const sentMinutes =
    lastSent && lastSent.date === todayIn(timeZone, now) ? timeToMinutes(lastSent.time) : -1;
  return reportTimes.some(({ hour, minute }) => {
    const slot = hour * 60 + minute;
    return slot <= nowMinutes && sentMinutes < slot;
  });
}

/** 读取快照；不存在或损坏时返回 null（按首次运行处理），不让进程崩溃。v1 旧快照自动迁移为 v2。 */
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

/** v1（单快照）→ v2（前日基线 + 当日快照）：旧快照整体作为前一日基线 */
function migrateState(state) {
  if (state.version !== 1 || typeof state.lastReportDate !== "string") return state;
  return {
    version: STATE_VERSION,
    prev: {
      date: state.lastReportDate,
      personaName: state.personaName ?? "",
      games: state.games ?? {},
      achievements: state.achievements ?? {},
    },
    current: null,
    // 当天所有时刻视为已发过，避免升级当天重复推送
    lastSent: { date: state.lastReportDate, time: "23:59" },
  };
}

function isValidState(state) {
  const isSnapshot = (snap) =>
    snap === null || (typeof snap === "object" && typeof snap.date === "string");
  return (
    state.version === STATE_VERSION &&
    isSnapshot(state.prev) &&
    isSnapshot(state.current) &&
    (!state.lastSent || typeof state.lastSent === "object")
  );
}

/** 写入快照（自动创建目录） */
export function saveState(filePath, state) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** 组装某日某时刻的累计值快照 */
export function buildSnapshot({ date, personaName, games, achievements }) {
  return { date, personaName, games, achievements };
}

/** 组装完整状态对象 */
export function buildState({ prev, current, lastSent }) {
  return { version: STATE_VERSION, prev, current, lastSent };
}
