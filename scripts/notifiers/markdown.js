// 通用 Markdown 战报构建（钉钉 / 企业微信群机器人的 markdown 消息共用，纯函数）。
import { formatMinutes } from "../diff.js";
import { baselineNote, formatZhDate, sanitize } from "../text.js";

const MAX_ACHIEVEMENT_NAMES = 8;
const MAX_LIBRARY_NAMES = 10;
// 游玩列表截断：防止重度玩家的一天撑爆企微 4096 字节消息上限
const MAX_PLAYED_GAMES = 15;

/** 每日战报 → { title, text }（title 用作通知栏预览/会话标题，text 为正文） */
export function buildReportMarkdown({ personaName, reportDate, diff, achievements, generatedAt, timeZone, baselineDate }) {
  const played = diff.playedToday ?? [];
  const withNew = (achievements ?? []).filter((a) => a.added.length > 0);
  const totalNew = withNew.reduce((sum, a) => sum + a.added.length, 0);
  const blocks = [`### 🎮 Steam 每日战报 · ${formatZhDate(reportDate)}`];

  if (played.length > 0) {
    blocks.push(`**${sanitize(personaName)}** 今天游玩 **${formatMinutes(diff.totalTodayMinutes)}**（${played.length} 款游戏）`);
    // 列表项之间需要空行，钉钉/企微客户端才能稳定渲染为多行
    const shown = played
      .slice(0, MAX_PLAYED_GAMES)
      .map(
        (g, i) =>
          `${i + 1}. **${sanitize(g.name)}**　+${formatMinutes(g.todayMinutes)}（累计 ${formatMinutes(g.totalMinutes)}）`,
      );
    if (played.length > MAX_PLAYED_GAMES) shown.push(`> 共 ${played.length} 款有时长增量，仅列前 ${MAX_PLAYED_GAMES} 款`);
    blocks.push(shown.join("\n\n"));
  } else {
    blocks.push(`**${sanitize(personaName)}** 今天没有启动任何游戏，休息日 📚`);
  }

  if (withNew.length > 0) {
    const lines = withNew.map((a) => {
      const names = a.added
        .slice(0, MAX_ACHIEVEMENT_NAMES)
        .map((item) => `「${sanitize(item.displayName)}」`)
        .join("、");
      const more = a.added.length > MAX_ACHIEVEMENT_NAMES ? ` 等 ${a.added.length} 个` : "";
      return `- **${sanitize(a.gameName)}**（${a.unlockedCount}/${a.total}）：${names}${more}`;
    });
    blocks.push(`🏆 **新解锁成就 ${totalNew} 个**\n\n${lines.join("\n\n")}`);
  }

  if (diff.newLibraryGames?.length > 0) {
    const names = diff.newLibraryGames
      .slice(0, MAX_LIBRARY_NAMES)
      .map((g) => sanitize(g.name))
      .join("、");
    const more = diff.newLibraryGames.length > MAX_LIBRARY_NAMES ? ` 等 ${diff.newLibraryGames.length} 款` : "";
    blocks.push(`📦 **新增入库 ${diff.newLibraryGames.length} 款**：${names}${more}`);
  }

  blocks.push(`库存游戏 ${diff.library.gameCount} 款 ｜ 总时长 ${formatMinutes(diff.library.totalMinutes)}`);
  blocks.push(`数据来源 Steam Web API · ${baselineNote(baselineDate, reportDate)}生成于 ${generatedAt}（${timeZone}）· GitHub Actions`);

  return { title: `🎮 Steam 每日战报 · ${formatZhDate(reportDate)}`, text: blocks.join("\n\n") };
}

/** 首次运行（建立基线）消息 */
export function buildInitMarkdown({ personaName, reportDate, library }) {
  return {
    title: "🎮 Steam 战报已初始化",
    text: [
      "### 🎮 Steam 战报已初始化",
      `**${sanitize(personaName)}** 的基线快照已建立：`,
      `库存 **${library.gameCount}** 款游戏 · 总时长 **${formatMinutes(library.totalMinutes)}**`,
      "明天这个时间将收到第一份每日战报 ✅",
      `基线建立于 ${formatZhDate(reportDate)} · 快照保存在 GitHub Actions Artifact（不进 Git 仓库）`,
    ].join("\n\n"),
  };
}
