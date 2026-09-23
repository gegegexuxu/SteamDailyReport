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
 * diff 来自 computeDiff()；achievements 为 [{ gameName, total, unlockedCount, added: [{ displayName }] }]；
 * extras 为可选亮点（见 highlights.js）：{ titleText, mvp: { appId, sharePercent }, milestoneLines, lastPlayed: { name, lastDate } }
 */
export function buildReportCard({ personaName, reportDate, diff, achievements, generatedAt, timeZone, windowNote = "", extras = {} }) {
  const { titleText = "", mvp = null, milestoneLines = [], lastPlayed = null } = extras;
  const played = diff.playedToday ?? [];
  const achievementsWithNew = (achievements ?? []).filter((a) => a.added.length > 0);
  const totalNewAchievements = achievementsWithNew.reduce((sum, a) => sum + a.added.length, 0);

  const elements = [];

  if (played.length > 0) {
    const titleSuffix = titleText ? `· ${titleText}` : "";
    elements.push(
      div(`**${sanitize(personaName)}** 当日游玩 **${formatMinutes(diff.totalTodayMinutes)}**（${played.length} 款游戏）${titleSuffix}`),
      div(
        played
          .map((g, i) => {
            const isMvp = mvp && g.appId === mvp.appId;
            const share = isMvp && mvp.sharePercent != null ? `，占今日 ${mvp.sharePercent}%` : "";
            const badge = isMvp ? " 🏅" : "";
            return `${i + 1}. **${sanitize(g.name)}**${badge}　+${formatMinutes(g.todayMinutes)}（累计 ${formatMinutes(g.totalMinutes)}${share}）`;
          })
          .join("\n"),
      ),
    );
  } else {
    elements.push(div(`**${sanitize(personaName)}** 当日没有启动任何游戏，休息日 📚`));
    if (lastPlayed) {
      elements.push(div(`上次开团：**${sanitize(lastPlayed.name)}** · ${lastPlayed.lastDate}`));
    }
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

  if (milestoneLines.length > 0) {
    elements.push(div(`🎖 **今日里程碑**\n${milestoneLines.map((line) => `· ${line}`).join("\n")}`));
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
  elements.push(note(`数据来自 Steam · ${windowNote}生成于 ${generatedAt}（${timeZone}）`));

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

/** 首次运行（建立存档）卡片；perfectCount 为全成就游戏数，查不到时缺省隐藏该行 */
export function buildInitCard({ personaName, library, perfectCount }) {
  const lines = [
    `**${sanitize(personaName)}** 的玩家档案已建立 📂`,
    `库存 **${library.gameCount}** 款游戏 · 总时长 **${formatMinutes(library.totalMinutes)}**`,
  ];
  if (typeof perfectCount === "number") lines.push(`🏆 全成就 **${perfectCount}** 款`);

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: "green", title: plain("🎮 战报存档已创建") },
      elements: [div(`${lines.join("\n")}\n\n明天开始，每日战报准时送达 ✅`)],
    },
  };
}
