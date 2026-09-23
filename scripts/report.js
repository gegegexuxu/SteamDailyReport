// 播报：每天 8 点（北京时间）对比最近两份快照（默认即昨天 0 点 → 今天 0 点），生成昨日战报并发送。
// 某次结算缺失时窗口自动跨天合并；lastSentWindow 防止同一窗口重复推送（force 可跳过）。
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getAchievementSchema, getPlayerAchievements } from "./steam.js";
import { computeDiff, diffAchievements, formatMinutes } from "./diff.js";
import { computeMilestones, computeMvp, lastPlayedGame, pickTitle } from "./highlights.js";
import { resolveNotifier } from "./notifiers/index.js";
import { DEFAULT_TIMEZONE, buildState, loadState, nowTimeIn, saveState } from "./state.js";
import { windowNote } from "./text.js";

// 最多为多少款「窗口内有增量」的游戏查询成就，避免库大时 API 调用过量
const ACHIEVEMENT_GAME_LIMIT = 10;

async function main() {
  const apiKey = process.env.STEAM_API_KEY;
  const steamId = process.env.STEAM_ID;
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
  const notifier = resolveNotifier(webhook);

  const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
  const state = loadState(statePath);
  if (!state || state.snapshots.length === 0) {
    console.error("❌ 没有任何快照。请先运行 Snapshot 工作流（本地为 npm run snapshot）建立基线。");
    process.exit(1);
  }
  if (state.snapshots.length < 2) {
    console.log("⏭️ 目前只有一份快照（基线），统计窗口尚未形成，本次不发送。下次快照生成后开始出报。");
    return;
  }

  const [base, latest] = state.snapshots;
  if (!forceSend && state.lastSentWindow === latest.capturedAt) {
    console.log(`⏭️ 窗口（${base.date} → ${latest.date}）的战报已发送过，跳过（手动触发并勾选 force 可重发）。`);
    return;
  }

  console.log(`📊 战报窗口: ${base.date} → ${latest.date}（${timeZone}）`);
  const diff = computeDiff(base.games, latest.games);

  const achievements = [];
  const nextAchievements = { ...(latest.achievements ?? {}) };
  const gamesToCheck = diff.playedToday.slice(0, ACHIEVEMENT_GAME_LIMIT);
  if (gamesToCheck.length > 0) console.log(`🔍 查询 ${gamesToCheck.length} 款游戏的成就…`);
  for (const game of gamesToCheck) {
    try {
      const stats = await getPlayerAchievements({ apiKey, steamId, appId: game.appId });
      const added = diffAchievements(base.achievements?.[game.appId]?.unlockedApinames, stats.unlocked);
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
        // 休息日才展示「上次开团」，且只认窗口起点之前玩过的游戏
        lastPlayed:
          diff.playedToday.length === 0
            ? lastPlayedGame(latest.games, timeZone, Math.floor(Date.parse(base.capturedAt) / 1000))
            : null,
      },
    }),
  });

  // 发送成功后才写状态：记录已发窗口（幂等），并把本次查到的成就集写回最新快照，
  // 作为下个窗口的成就基线——若发送失败会抛错退出，下次运行重算，不会重复计入
  saveState(
    statePath,
    buildState({
      snapshots: [base, { ...latest, achievements: nextAchievements }],
      lastSentWindow: latest.capturedAt,
    }),
  );
  markStateUpdated();
  console.log("✅ 战报已发送，状态已更新");
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

// 告知 CI 本次运行更新了状态、需要上传 Artifact；本地运行没有 GITHUB_OUTPUT，静默忽略
function markStateUpdated() {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "state_updated=true\n");
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
