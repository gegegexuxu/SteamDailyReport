// 飞书卡片构建（纯函数，方便单元测试）。
// 使用飞书经典卡片 JSON（schema 1.0），自定义机器人 Webhook 直接可发。
import { formatMinutes } from "./diff.js";
import { formatZhDate, sanitize } from "./text.js";

const MAX_ACHIEVEMENT_NAMES = 8;
const MAX_LIBRARY_NAMES = 10;

const div = (content) => ({ tag: "div", text: { tag: "lark_md", content } });
const md = (content) => ({ tag: "lark_md", content });
const plain = (content) => ({ tag: "plain_text", content });
const note = (content) => ({ tag: "note", elements: [plain(content)] });

/**
 * 每日战报卡片。
 * diff 来自 computeDiff()；achievements 为 [{ gameName, total, unlockedCount, added: [{ displayName }] }]
 */
export function buildReportCard({ personaName, reportDate, diff, achievements, generatedAt, timeZone, windowNote = "" }) {
  const played = diff.playedToday ?? [];
  const achievementsWithNew = (achievements ?? []).filter((a) => a.added.length > 0);
  const totalNewAchievements = achievementsWithNew.reduce((sum, a) => sum + a.added.length, 0);

  const elements = [];

  if (played.length > 0) {
    elements.push(
      div(`**${sanitize(personaName)}** 当日游玩 **${formatMinutes(diff.totalTodayMinutes)}**（${played.length} 款游戏）`),
      div(
        played
          .map(
            (g, i) =>
              `${i + 1}. **${sanitize(g.name)}**　+${formatMinutes(g.todayMinutes)}（累计 ${formatMinutes(g.totalMinutes)}）`,
          )
          .join("\n"),
      ),
    );
  } else {
    elements.push(div(`**${sanitize(personaName)}** 当日没有启动任何游戏，休息日 📚`));
  }

  if (achievementsWithNew.length > 0) {
    const lines = achievementsWithNew.map((a) => {
      const names = a.added
        .slice(0, MAX_ACHIEVEMENT_NAMES)
        .map((item) => `「${sanitize(item.displayName)}」`)
        .join("、");
      const more = a.added.length > MAX_ACHIEVEMENT_NAMES ? ` 等 ${a.added.length} 个` : "";
      return `· **${sanitize(a.gameName)}**（${a.unlockedCount}/${a.total}）：${names}${more}`;
    });
    elements.push(div(`🏆 **新解锁成就 ${totalNewAchievements} 个**\n${lines.join("\n")}`));
  }

  if (diff.newLibraryGames?.length > 0) {
    const names = diff.newLibraryGames
      .slice(0, MAX_LIBRARY_NAMES)
      .map((g) => sanitize(g.name))
      .join("、");
    const more = diff.newLibraryGames.length > MAX_LIBRARY_NAMES ? ` 等 ${diff.newLibraryGames.length} 款` : "";
    elements.push(div(`📦 **新增入库 ${diff.newLibraryGames.length} 款**：${names}${more}`));
  }

  elements.push({ tag: "hr" });
  elements.push({
    tag: "div",
    fields: [
      { is_short: true, text: md(`**库存游戏**\n${diff.library.gameCount} 款`) },
      { is_short: true, text: md(`**总时长**\n${formatMinutes(diff.library.totalMinutes)}`) },
    ],
  });
  elements.push(
    note(
      `数据来源 Steam Web API · ${windowNote}生成于 ${generatedAt}（${timeZone}）· GitHub Actions`,
    ),
  );

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: played.length > 0 ? "blue" : "turquoise",
        title: plain(`🎮 Steam 每日战报 · ${formatZhDate(reportDate)}`),
      },
      elements,
    },
  };
}

/** 首次运行（建立基线）卡片 */
export function buildInitCard({ personaName, reportDate, library }) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: "green", title: plain("🎮 Steam 战报已初始化") },
      elements: [
        div(
          `**${sanitize(personaName)}** 的基线快照已建立：\n` +
            `库存 **${library.gameCount}** 款游戏 · 总时长 **${formatMinutes(library.totalMinutes)}**\n\n` +
            `明天这个时间将收到第一份每日战报 ✅`,
        ),
        note(`基线建立于 ${formatZhDate(reportDate)} · 快照保存在 GitHub Actions Artifact（不进 Git 仓库）`),
      ],
    },
  };
}
