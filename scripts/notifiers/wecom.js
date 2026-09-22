// 企业微信群机器人：markdown 消息（无签名机制，key 已包含在 Webhook 地址里）。
import { postJson } from "./http.js";
import { buildInitMarkdown, buildReportMarkdown } from "./markdown.js";

// 企微 markdown 消息正文上限 4096 字节（UTF-8），留少量余量
const MAX_CONTENT_BYTES = 4000;

/** 按 UTF-8 字节数截断（先退到字符边界，再回退到行边界，避免截出半行 markdown） */
export function truncateUtf8(text, maxBytes) {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let cut = maxBytes;
  while (cut > 0 && (buffer[cut] & 0xc0) === 0x80) cut--; // 跳过 UTF-8 续字节
  let str = buffer.subarray(0, cut).toString("utf8");
  const lastBreak = str.lastIndexOf("\n");
  if (lastBreak > 0) str = str.slice(0, lastBreak);
  return `${str}\n\n…（内容过长已截断）`;
}

const wrap = ({ text }) => ({ msgtype: "markdown", markdown: { content: truncateUtf8(text, MAX_CONTENT_BYTES) } });

export const wecom = {
  name: "wecom",
  matches: (webhook) => /qyapi\.weixin\.qq\.com/.test(webhook),
  buildReport: (data) => wrap(buildReportMarkdown(data)),
  buildInit: (data) => wrap(buildInitMarkdown(data)),
  async send({ webhook, payload }) {
    try {
      await postJson(webhook, payload, {
        parseResult: (res, data) => {
          if (res.ok && data.errcode === 0) return null;
          return new Error(
            `企业微信返回错误 errcode=${data.errcode ?? res.status}${data.errmsg ? `: ${data.errmsg}` : ""}`,
          );
        },
      });
    } catch (err) {
      throw new Error(`企业微信消息发送失败: ${err.message}`);
    }
    console.log("📨 企业微信消息发送成功");
  },
};
