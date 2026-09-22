// 通知适配器注册与选择：按 Webhook 域名自动识别平台（飞书 / 钉钉 / 企业微信）。
// daily-report.js 只面向适配器接口（buildReport / buildInit / send），新增平台只需实现同名接口并注册。
import { buildInitCard, buildReportCard } from "../card.js";
import { sendCard } from "../feishu.js";
import { dingtalk } from "./dingtalk.js";
import { wecom } from "./wecom.js";

const feishu = {
  name: "feishu",
  matches: (webhook) => /open\.feishu\.cn/.test(webhook),
  buildReport: buildReportCard,
  buildInit: buildInitCard,
  send: sendCard,
};

const adapters = [feishu, dingtalk, wecom];

/** 按 Webhook 域名识别通知平台；无法识别时按飞书处理（历史默认）并告警 */
export function resolveNotifier(webhook) {
  const adapter = adapters.find((adapter) => adapter.matches(webhook));
  if (!adapter) {
    console.warn("⚠️ 无法根据 Webhook 域名识别通知平台，按飞书处理（支持：飞书 / 钉钉 / 企业微信）");
    return feishu;
  }
  return adapter;
}
