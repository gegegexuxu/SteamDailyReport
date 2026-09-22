// 结算：每天 0 点（北京时间）抓取 Steam 累计数据并存为快照，划清战报统计窗口的边界。
// 首次快照会尝试发送初始化卡片；未配置 Webhook 或发送失败仅告警——快照本身才是关键产物。
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getOwnedGames, getPlayerSummary } from "./steam.js";
import { libraryStats } from "./diff.js";
import { resolveNotifier } from "./notifiers/index.js";
import { DEFAULT_TIMEZONE, buildSnapshot, loadState, pushSnapshot, saveState, todayIn } from "./state.js";

async function main() {
  const apiKey = process.env.STEAM_API_KEY;
  const steamId = process.env.STEAM_ID;
  const missing = ["STEAM_API_KEY", "STEAM_ID"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `❌ 缺少必要环境变量: ${missing.join(", ")}。` +
        "本地请复制 .env.example 为 .env；GitHub 上请配置 Settings → Secrets → Actions。",
    );
    process.exit(1);
  }
  const timeZone = process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE;

  const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
  const state = loadState(statePath);

  const { personaName } = await getPlayerSummary({ apiKey, steamId });
  const { games } = await getOwnedGames({ apiKey, steamId });
  const today = todayIn(timeZone);
  console.log(`📸 快照日期: ${today}（${timeZone}）· ${personaName} · 库存 ${Object.keys(games).length} 款游戏`);

  // 成就集沿用最近一份快照的记录；真正按窗口查询成就是在发送时（见 report.js），
  // 查询结果会写回快照，作为下个窗口的成就基线
  const snapshot = buildSnapshot({
    date: today,
    personaName,
    games,
    achievements: state?.snapshots.at(-1)?.achievements ?? {},
  });
  const isFirst = (state?.snapshots.length ?? 0) === 0;

  const nextState = pushSnapshot(state, snapshot);
  saveState(statePath, nextState);
  markStateUpdated();
  console.log(`✅ 快照已保存（现有 ${nextState.snapshots.length} 份，最近两份构成一个统计窗口）`);

  if (isFirst) {
    await sendInitCard({ personaName, today, games });
    console.log("🆕 基线已建立：下次快照生成后，发送流程将产出第一份战报");
  }
}

async function sendInitCard({ personaName, today, games }) {
  const webhook = process.env.NOTIFY_WEBHOOK || "";
  try {
    if (!webhook) throw new Error("未配置 NOTIFY_WEBHOOK");
    const notifier = resolveNotifier(webhook);
    await notifier.send({
      webhook,
      secret: process.env.NOTIFY_SECRET || "",
      payload: notifier.buildInit({ personaName, reportDate: today, library: libraryStats(games) }),
    });
  } catch (err) {
    console.warn(`⚠️ 初始化卡片未发送（不影响快照）: ${err.message}`);
  }
}

// 告知 CI 本次运行更新了快照、需要上传 Artifact（见 workflow 中的 state_updated 条件）；
// 本地运行没有 GITHUB_OUTPUT，静默忽略
function markStateUpdated() {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "state_updated=true\n");
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
