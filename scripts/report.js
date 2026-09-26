// 播报：每天 8 点（北京时间）对比各账号最近两份快照（默认即昨天 0 点 → 今天 0 点），生成昨日战报并发送。
// 支持多账号：STEAM_ID 逗号分隔，每号一张卡片；lastSentWindow 按账号防重（force 可跳过）；
// 某次结算缺失时窗口自动跨天合并；单个账号失败不影响其他账号。
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getAchievementSchema, getPlayerAchievements } from "./steam.js";
import { computeDiff, diffAchievements, formatMinutes } from "./diff.js";
import { computeMilestones, computeMvp, lastPlayedGame, pickTitle } from "./highlights.js";
import { resolveNotifier } from "./notifiers/index.js";
import {
  DEFAULT_TIMEZONE,
  getAccount,
  loadState,
  nowTimeIn,
  parseSteamIds,
  saveState,
  withAccount,
} from "./state.js";
import { windowNote } from "./text.js";

// 查成就的游戏数上限，避免库大时 API 调用过量
const ACHIEVEMENT_GAME_LIMIT = 10;

async function main() {
  const apiKey = process.env.STEAM_API_KEY;
  const webhook = process.env.NOTIFY_WEBHOOK || "";
  const secret = process.env.NOTIFY_SECRET || "";
  const forceSend = /^(1|true|yes)$/i.test(process.env.FORCE_SEND ?? "");
  const timeZone = process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE;

  const missing = ["STEAM_API_KEY", "STEAM_ID"].filter((name) => !process.env[name]);
  if (!webhook) missing.push("NOTIFY_WEBHOOK");
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
  const notifier = resolveNotifier(webhook);

  const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
  // 旧版单账号状态自动迁移，归属到配置列表的第一个账号
  let state = loadState(statePath, steamIds[0]);
  if (!state) {
    console.error("❌ 没有任何快照。请先运行 Snapshot 工作流（本地为 npm run snapshot）建立基线。");
    process.exit(1);
  }

  let sent = false;
  for (const steamId of steamIds) {
    const account = getAccount(state, steamId);
    const label = account?.snapshots.at(-1)?.personaName || steamId;
    if (!account || account.snapshots.length === 0) {
      console.log(`⏭️ [${label}] 还没有快照，先运行 Snapshot 工作流（本地为 npm run snapshot）建立基线。`);
      continue;
    }
    if (account.snapshots.length < 2) {
      console.log(`⏭️ [${label}] 目前只有一份快照（基线），统计窗口尚未形成，本次不发送。下次快照生成后开始出报。`);
      continue;
    }
    if (!forceSend && account.lastSentWindow === account.snapshots.at(-1).capturedAt) {
      const [base, latest] = account.snapshots;
      console.log(`⏭️ [${label}] 窗口（${base.date} → ${latest.date}）的战报已发送过，跳过（手动触发并勾选 force 可重发）。`);
      continue;
    }

    try {
      // 每号成功后立即落盘：后面账号失败不会丢掉已发送账号的窗口标记
      state = withAccount(state, steamId, await sendAccountReport({ apiKey, steamId, account, timeZone, notifier, webhook, secret }));
      saveState(statePath, state);
      sent = true;
      console.log(`✅ [${label}] 战报已发送，状态已更新`);
    } catch (err) {
      console.error(`❌ [${label}] 战报生成/发送失败: ${err.message}`);
    }
  }

  if (sent) markStateUpdated();
}

// 生成并发送单个账号的战报；成功后返回该账号的新状态桶（成就基线 + 已发窗口标记）
async function sendAccountReport({ apiKey, steamId, account, timeZone, notifier, webhook, secret }) {
  const [base, latest] = account.snapshots;
  console.log(`📊 [${latest.personaName || steamId}] 战报窗口: ${base.date} → ${latest.date}（${timeZone}）`);
  const windowStartSec = Math.floor(Date.parse(base.capturedAt) / 1000);
  const diff = computeDiff(base.games, latest.games);

  const achievements = [];
  const nextAchievements = { ...(latest.achievements ?? {}) };
  // 新入库游戏也查成就，否则窗口内的解锁会被窗口过滤永久漏掉
  const gamesToCheck = [...diff.playedToday, ...diff.newLibraryGames].slice(0, ACHIEVEMENT_GAME_LIMIT);
  if (gamesToCheck.length > 0) console.log(`🔍 查询 ${gamesToCheck.length} 款游戏的成就…`);
  for (const game of gamesToCheck) {
    try {
      const stats = await getPlayerAchievements({ apiKey, steamId, appId: game.appId });
      const added = diffAchievements(
        base.achievements?.[game.appId]?.unlockedApinames,
        stats.unlocked,
        windowStartSec,
      );
      let nameMap = {};
      if (added.length > 0) {
        try {
          nameMap = await getAchievementSchema({ apiKey, appId: game.appId });
        } catch {
          // schema 拿不到时降级显示原始 apiname
        }
      }
      achievements.push({
        appId: game.appId,
        gameName: game.name,
        total: stats.total,
        unlockedCount: stats.unlocked.length,
        added: added.map((item) => ({ ...item, displayName: nameMap[item.apiname] || item.apiname })),
      });
      nextAchievements[game.appId] = {
        total: stats.total,
        unlockedApinames: stats.unlocked.map((item) => item.apiname),
      };
    } catch (err) {
      console.warn(`⚠️ 跳过「${game.name}」的成就统计: ${err.message}`);
    }
  }

  logPreview(diff, achievements);
  await notifier.send({
    webhook,
    secret,
    payload: notifier.buildReport({
      personaName: latest.personaName || base.personaName,
      reportDate: base.date,
      diff,
      achievements,
      generatedAt: nowTimeIn(timeZone),
      timeZone,
      windowNote: windowNote(base.date, latest.date),
      extras: {
        titleText: pickTitle(diff.totalTodayMinutes),
        mvp: computeMvp(diff.playedToday),
        milestoneLines: computeMilestones({
          baseGames: base.games,
          latestGames: latest.games,
          achievements,
        }),
        lastPlayed:
          diff.playedToday.length === 0
            ? lastPlayedGame(latest.games, timeZone, windowStartSec)
            : null,
      },
    }),
  });

  // 发送成功后才写状态（成就基线 + 已发窗口标记）；失败抛错退出，下次重算不重复计入
  return {
    snapshots: [base, { ...latest, achievements: nextAchievements }],
    lastSentWindow: latest.capturedAt,
  };
}

function logPreview(diff, achievements) {
  if (diff.playedToday.length === 0) {
    console.log("😴 窗口内未游玩任何游戏");
  }
  for (const game of diff.playedToday) {
    console.log(`  ▸ ${game.name}: +${formatMinutes(game.todayMinutes)}（累计 ${formatMinutes(game.totalMinutes)}）`);
  }
  for (const section of achievements) {
    if (section.added.length > 0) {
      console.log(`  🏆 ${section.gameName}: 新成就 ${section.added.length} 个（${section.unlockedCount}/${section.total}）`);
    }
  }
  if (diff.newLibraryGames.length > 0) {
    console.log(`  📦 新增入库: ${diff.newLibraryGames.map((g) => g.name).join("、")}`);
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
