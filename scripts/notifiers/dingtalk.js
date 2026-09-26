// 钉钉自定义机器人：markdown 消息 + 加签安全设置（签名算法与飞书不同，勿混用）。
import { createHmac } from "node:crypto";
import { fatalError, postJson } from "./http.js";
import { buildInitMarkdown, buildReportMarkdown } from "./markdown.js";

/** 钉钉加签（timestamp 为毫秒） */
export function signDingtalk(secret, timestampMs) {
  return createHmac("sha256", secret).update(`${timestampMs}\n${secret}`).digest("base64");
}

export function buildSignedUrl(webhook, secret, timestampMs = Date.now()) {
  const joiner = webhook.includes("?") ? "&" : "?";
  return `${webhook}${joiner}timestamp=${timestampMs}&sign=${encodeURIComponent(signDingtalk(secret, timestampMs))}`;
}

const wrap = ({ title, text }) => ({ msgtype: "markdown", markdown: { title, text } });

export const dingtalk = {
  name: "dingtalk",
  matches: (webhook) => /oapi\.dingtalk\.com/.test(webhook),
  buildReport: (data) => wrap(buildReportMarkdown(data)),
  buildInit: (data) => wrap(buildInitMarkdown(data)),
  async send({ webhook, secret = "", payload }) {
    const url = secret ? buildSignedUrl(webhook, secret) : webhook;
    try {
      await postJson(url, payload, {
        parseResult: (res, data) => {
          if (res.ok && data.errcode === 0) return null;
          // 310000：关键词 / 加签 / IP 白名单等安全设置不符，重试无意义
          if (data.errcode === 310000) {
            return fatalError(
              `钉钉安全设置校验失败${data.errmsg ? `: ${data.errmsg}` : ""}` +
                "（请核对加签密钥 NOTIFY_SECRET 与机器人「加签」密钥是否一致，或检查关键词/IP 白名单设置）",
            );
          }
          return new Error(`钉钉返回错误 errcode=${data.errcode ?? res.status}${data.errmsg ? `: ${data.errmsg}` : ""}`);
        },
      });
    } catch (err) {
      throw new Error(`钉钉消息发送失败: ${err.message}`);
    }
    console.log("📨 钉钉消息发送成功");
  },
};
