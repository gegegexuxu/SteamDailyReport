// 主流程：读取快照 → 判断是否到发送时刻 → 拉取 Steam 数据 → 与前一日快照差值 → 发送群通知 → 保存快照。
// CI 以固定频率轮询本脚本实现「发送时间可配置」（cron 无法读变量，见 daily-report.yml 与 REPORT_TIME）：
// 没有「已到点但今日未发」的时刻时直接跳过；同一天可发送多次，但每次都与前一日最后一次快照比较。
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getAchievementSchema, getOwnedGames, getPlayerAchievements, getPlayerSummary } from "./steam.js";
import { computeDiff, diffAchievements, formatMinutes, libraryStats } from "./diff.js";
import { resolveNotifier } from "./notifiers/index.js";
import {
  DEFAULT_REPORT_TIME,
  DEFAULT_TIMEZONE,
  buildSnapshot,
  buildState,
  formatReportTime,
  hasDueReportTime,
  loadState,
  nowTimeIn,
  parseReportTimes,
  saveState,
  todayIn,
} from "./state.js";

// 最多为多少款「自前一日以来有增量」的游戏查询成就，避免库大时 API 调用过量
const ACHIEVEMENT_GAME_LIMIT = 10;

async function main() {
  const apiKey = process.env.STEAM_API_KEY;
  const steamId = process.env.STEAM_ID;
  const webhook = process.env.NOTIFY_WEBHOOK || "";
  const secret = process.env.NOTIFY_SECRET || "";

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
  const timeZone = process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE;
  const forceSend = /^(1|true|yes)$/i.test(process.env.FORCE_SEND ?? "");

  let reportTimes = parseReportTimes(process.env.REPORT_TIME);
  if (process.env.REPORT_TIME && !reportTimes) {
    console.warn(
      `⚠️ REPORT_TIME="${process.env.REPORT_TIME}" 格式非法（应为 HH:MM，多个用英文逗号分隔），` +
        `回退默认 ${DEFAULT_REPORT_TIME}。`,
    );
  }
  reportTimes ??= parseReportTimes(DEFAULT_REPORT_TIME);

  const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
  const state = loadState(statePath);
  const today = todayIn(timeZone);

  // 发送门控：存在「已到点但今日未发」的时刻才继续；无历史快照（首次部署）与 FORCE_SEND 不受限。
  // 定时轮询、手动触发与本地运行共用此判定，避免同一天重复推送。
  if (state && !forceSend && !hasDueReportTime(timeZone, reportTimes, state.lastSent)) {
    console.log(
      `⏭️ ${nowTimeIn(timeZone)} 轮询：发送时刻为 ${reportTimes.map(formatReportTime).join("、")}（${timeZone}），` +
        "暂无待发送时刻，本次跳过（手动触发并勾选 force 可立即发送）。",
    );
    return;
  }
  console.log(`📅 战报日期: ${today}（${timeZone}） · 发送时刻: ${reportTimes.map(formatReportTime).join("、")}`);

  const { personaName } = await getPlayerSummary({ apiKey, steamId });
  const { games } = await getOwnedGames({ apiKey, steamId });
  console.log(`🎮 ${personaName} · 库存 ${Object.keys(games).length} 款游戏`);

  // 状态滚动：新的一天首次发送时，前一日最后一次快照成为今日比较基线；
  // 同一天内再次发送基线保持不变，因此每次战报都覆盖自前一日以来的完整增量
  const prev = state?.current?.date === today ? state.prev : (state?.current ?? state?.prev ?? null);

  // 无前一日基线：发初始化卡片并建立基线，从次日开始生成差值战报
  if (!prev) {
    await notifier.send({
      webhook,
      secret,
      payload: notifier.buildInit({ personaName, reportDate: today, library: libraryStats(games) }),
    });
    saveState(
      statePath,
      buildState({
        prev: null,
        current: buildSnapshot({ date: today, personaName, games, achievements: {} }),
        lastSent: sentToday(timeZone),
      }),
    );
    markStateUpdated();
    console.log("✅ 初始化完成：已保存基线快照，明天开始生成每日战报");
    return;
  }

  const diff = computeDiff(prev.games, games);

  // 仅为自前一日以来有时长增量的游戏查询成就（限量，失败则跳过该游戏成就）
  const achievements = [];
  const nextAchievements = { ...(prev.achievements ?? {}) };
  const gamesToCheck = diff.playedToday.slice(0, ACHIEVEMENT_GAME_LIMIT);
  if (gamesToCheck.length > 0) console.log(`🔍 查询 ${gamesToCheck.length} 款游戏的成就…`);
  for (const game of gamesToCheck) {
    try {
      const stats = await getPlayerAchievements({ apiKey, steamId, appId: game.appId });
      const added = diffAchievements(nextAchievements[game.appId]?.unlockedApinames, stats.unlocked);
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
      personaName: prev.personaName || personaName,
      reportDate: today,
      diff,
      achievements,
      generatedAt: nowTimeIn(timeZone),
      timeZone,
      baselineDate: prev.date,
    }),
  });

  // 发送成功后才写快照；若上方发送失败会抛错退出，快照保持原样，
  // 下次运行会相对旧基线重新计算完整差值（不会丢数据，最多晚发）。
  // prev 不更新（当天多次发送均与前一日比较）；current 为当天最新累计值，次日滚动为基线。
  saveState(
    statePath,
    buildState({
      prev,
      current: buildSnapshot({
        date: today,
        personaName: prev.personaName || personaName,
        games,
        achievements: nextAchievements,
      }),
      lastSent: sentToday(timeZone),
    }),
  );
  markStateUpdated();
  console.log(`✅ 战报已发送（与 ${prev.date} 的快照比较），快照已更新`);
}

/** 本次发送时刻（报告时区），用于门控判定「今日已发到哪个时刻」 */
function sentToday(timeZone) {
  return { date: todayIn(timeZone), time: nowTimeIn(timeZone) };
}

// 告知 CI 本次运行更新了快照、需要上传 Artifact（见 workflow 中的 state_updated 条件）；
// 本地运行没有 GITHUB_OUTPUT，静默忽略
function markStateUpdated() {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "state_updated=true\n");
  }
}

function logPreview(diff, achievements) {
  if (diff.playedToday.length === 0) {
    console.log("😴 今日未游玩任何游戏");
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

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
