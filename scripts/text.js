// 展示文本的共享工具（各通知平台的消息构建器共用，纯函数）。
const MAX_NAME_LENGTH = 50;

/** 游戏名/成就名轻度清洗：去换行、替换 markdown 特殊字符、截断 */
export function sanitize(text) {
  return String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[`*[\]]/g, (ch) => ({ "`": "｀", "*": "＊", "[": "［", "]": "］" })[ch])
    .slice(0, MAX_NAME_LENGTH);
}

/** "2026-09-22" -> "9月22日" */
export function formatZhDate(dateStr) {
  const [, month, day] = String(dateStr).split("-").map(Number);
  if (!month || !day) return String(dateStr);
  return `${month}月${day}日`;
}

/**
 * 窗口跨天合并提示：某次结算（快照）缺失时，战报窗口会自动跨越多天补发。
 * 窗口相邻（或同一天）返回空串，不打扰日常战报；跨多天返回「统计 9月20日–9月23日 · 」。
 */
export function windowNote(baseDate, latestDate) {
  const from = new Date(`${baseDate}T00:00:00Z`);
  const to = new Date(`${latestDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "";
  const days = Math.round((to - from) / 86_400_000);
  if (days <= 1) return "";
  return `统计 ${formatZhDate(baseDate)}–${formatZhDate(latestDate)} · `;
}
