// 通知平台共用的 HTTP 发送：超时、失败重试与各平台响应判定。
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 标记为致命错误（签名/配置不符等）：重试无意义，直接抛出 */
export function fatalError(message) {
  return Object.assign(new Error(message), { fatal: true });
}

/** POST JSON 并校验响应；parseResult 返回 null 成功 / Error 失败（标记 fatal 则不重试） */
export async function postJson(url, body, { parseResult }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      const error = parseResult(res, data);
      if (!error) return data;
      lastError = error;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (lastError.fatal) throw lastError;
    if (attempt < MAX_RETRIES) await sleep(2000 * attempt);
  }
  throw new Error(lastError.message);
}
