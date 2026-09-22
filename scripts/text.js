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

/** "2026-09-22" 的前一天（YYYY-MM-DD）；解析失败返回 null */
export function previousDateString(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * 生成「与 M月d日 以来比较 · 」前缀，用于跨天补发（停更后恢复）时说明差值口径；
 * 基线就是昨日（正常情况）时返回空串，不打扰日常战报。
 */
export function baselineNote(baselineDate, reportDate) {
  if (!baselineDate || baselineDate === previousDateString(reportDate)) return "";
  return `与 ${formatZhDate(baselineDate)} 以来比较 · `;
}
