// 结算：每天 0 点（北京时间）抓取 Steam 累计数据并存为快照，划清战报统计窗口的边界。
// 支持多账号：STEAM_ID 逗号分隔多个 SteamID64，各账号快照独立存桶；
// 新账号自动建基线并尝试发送初始化卡片；某账号失败不影响其他账号。
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { countPerfectGames, getOwnedGames, getPlayerSummary } from "./steam.js";
import { libraryStats } from "./diff.js";
import { resolveNotifier } from "./notifiers/index.js";
import {
  DEFAULT_TIMEZONE,
  STATE_VERSION,
  buildSnapshot,
  getAccount,
  loadState,
  parseSteamIds,
  pushSnapshot,
  saveState,
  todayIn,
  withAccount,
} from "./state.js";

async function main() {
  const apiKey = process.env.STEAM_API_KEY;
  const missing = ["STEAM_API_KEY", "STEAM_ID"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `❌ 缺少必要环境变量: ${missing.join(", ")}。` +
        "本地请复制 .env.example 为 .env；GitHub 上请配置 Settings → Secrets → Actions。",
    );
    process.exit(1);
  }
  const steamIds = parseSteamIds(process.env.STEAM_ID);
  if (steamIds.length === 0) {
    console.error("❌ STEAM_ID 未解析出任何账号（多个账号用逗号分隔）。");
    process.exit(1);
  }
  const timeZone = process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE;

  const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
  // 旧版单账号状态自动迁移，归属到配置列表的第一个账号
  let state = loadState(statePath, steamIds[0]) ?? { version: STATE_VERSION, accounts: {} };

  let changed = false;
  for (const steamId of steamIds) {
    try {
      const account = getAccount(state, steamId);
      const { personaName } = await getPlayerSummary({ apiKey, steamId });
      const { games, statsVisible } = await getOwnedGames({ apiKey, steamId });
      const today = todayIn(timeZone);
      console.log(`📸 [${personaName}] 快照日期: ${today}（${timeZone}）· 库存 ${Object.keys(games).length} 款游戏`);

      // 成就集沿用本账号上一份快照；按窗口查询在发送时做（report.js），结果写回作下个窗口基线
      const snapshot = buildSnapshot({
        date: today,
        personaName,
        games,
        achievements: account?.snapshots.at(-1)?.achievements ?? {},
      });
      const isFirst = (account?.snapshots.length ?? 0) === 0;

      state = withAccount(state, steamId, pushSnapshot(account, snapshot));
      changed = true;
      const count = getAccount(state, steamId).snapshots.length;
      console.log(`✅ [${personaName}] 快照已保存（现有 ${count} 份，最近两份构成一个统计窗口）`);

      if (isFirst) {
        await sendInitCard({ personaName, today, games, statsVisible, apiKey, steamId });
        console.log(`🆕 [${personaName}] 基线已建立：下次快照生成后，发送流程将产出第一份战报`);
      }
    } catch (err) {
      console.error(`❌ [${steamId}] 快照失败，跳过该账号: ${err.message}`);
    }
  }

  // 全部账号都失败时不动状态文件，避免用空桶覆盖 CI 里的历史快照
  if (changed) {
    saveState(statePath, state);
    markStateUpdated();
  }
}

async function sendInitCard({ personaName, today, games, statsVisible = [], apiKey, steamId }) {
  const webhook = process.env.NOTIFY_WEBHOOK || "";
  try {
    if (!webhook) throw new Error("未配置 NOTIFY_WEBHOOK");
    const notifier = resolveNotifier(webhook);

    // 全成就统计需逐款查询成就接口，只在建基线时做一次；查不出结果（null）则卡片隐藏该行
    let perfectCount;
    if (statsVisible.length > 0) {
      console.log(`🔍 [${personaName}] 正在统计全成就游戏（${statsVisible.length} 款，约需几十秒）…`);
      perfectCount = await countPerfectGames({ apiKey, steamId, appIds: statsVisible });
    }

    await notifier.send({
      webhook,
      secret: process.env.NOTIFY_SECRET || "",
      payload: notifier.buildInit({ personaName, reportDate: today, library: libraryStats(games), perfectCount }),
    });
  } catch (err) {
    console.warn(`⚠️ 初始化卡片未发送（不影响快照）: ${err.message}`);
  }
}

// 告知 CI 需上传 Artifact；本地运行没有 GITHUB_OUTPUT，静默忽略
function markStateUpdated() {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "state_updated=true\n");
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
