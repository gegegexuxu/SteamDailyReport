// 飞书自定义机器人 Webhook 发送。
// 支持「签名校验」安全设置；错误信息不包含 Webhook 地址。
import { createHmac } from "node:crypto";

const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 飞书签名：以 `${timestamp}\n${secret}` 为 key、空串为消息计算 HmacSHA256，再 base64。
 * timestamp 为秒级 Unix 时间戳。
 */
export function signPayload(secret, timestampSeconds) {
  const stringToSign = `${timestampSeconds}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

/** 发送卡片 payload（{ msg_type, card }）。secret 可选。失败重试 3 次。 */
export async function sendCard({ webhook, secret = "", payload }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const body = { ...payload };
      if (secret) {
        const timestamp = Math.floor(Date.now() / 1000);
        body.timestamp = String(timestamp);
        body.sign = signPayload(secret, timestamp);
      }
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      // 新版机器人成功返回 { code: 0 }，旧版返回 { StatusCode: 0 }
      const code = data.code ?? data.StatusCode;
      if (res.ok && code === 0) {
        console.log("📨 飞书消息发送成功");
        return;
      }
      const hint = data.msg ?? data.StatusMessage ?? "";
      lastError = new Error(`飞书返回错误 code=${code ?? res.status}${hint ? `: ${hint}` : ""}`);
      if (hint.includes("sign") || hint.includes("签名")) {
        // 签名错误重试也不会成功，直接失败并给出修复提示
        throw new Error(`${lastError.message}（请检查 FEISHU_SECRET 是否与机器人签名密钥一致）`);
      }
    } catch (err) {
      if (err.message?.includes("FEISHU_SECRET")) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < MAX_RETRIES) await sleep(2000 * attempt);
  }
  throw new Error(`飞书消息发送失败: ${lastError.message}`);
}
