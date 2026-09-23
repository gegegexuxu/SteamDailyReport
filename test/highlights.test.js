// 单元测试：战报亮点（称号 / MVP / 里程碑 / 最近在玩）及渲染层 extras 集成
import test from "node:test";
import assert from "node:assert/strict";

import { computeDiff } from "../scripts/diff.js";
import { computeMilestones, computeMvp, lastPlayedGame, pickTitle } from "../scripts/highlights.js";
import { buildReportCard } from "../scripts/card.js";
import { buildReportMarkdown } from "../scripts/notifiers/markdown.js";

const game = (name, playtimeForever, rtimeLastPlayed = 0) => ({ name, playtimeForever, rtimeLastPlayed });

test("pickTitle：称号三档边界", () => {
  assert.equal(pickTitle(0), "");
  assert.equal(pickTitle(-1), "");
  assert.equal(pickTitle(60), "小酌怡情 🍵");
  assert.equal(pickTitle(119), "小酌怡情 🍵");
  assert.equal(pickTitle(120), "战斗力在线 ⚔️");
  assert.equal(pickTitle(299), "战斗力在线 ⚔️");
  assert.equal(pickTitle(300), "今日肝帝 👑");
});

test("computeMvp：取当日最久游戏，多款附占比，单款不给占比", () => {
  const played = [
    { appId: "570", name: "Dota 2", todayMinutes: 90, totalMinutes: 5000 },
    { appId: "730", name: "CS2", todayMinutes: 30, totalMinutes: 1000 },
  ];
  assert.deepEqual(computeMvp(played), { appId: "570", sharePercent: 75 });
  assert.deepEqual(computeMvp([played[0]]), { appId: "570", sharePercent: null });
  assert.equal(computeMvp([]), null);
  assert.equal(computeMvp(null), null);
});

test("computeMilestones：单游戏跨档只播报一次", () => {
  // CS2 常驻库存让总时长早已过档，避免单游戏跨档连带库存跨档
  const base = { "570": game("Dota 2", 49 * 60), "730": game("CS2", 600) };
  const latest = { "570": game("Dota 2", 51 * 60), "730": game("CS2", 600) };
  assert.deepEqual(computeMilestones({ baseGames: base, latestGames: latest, achievements: [] }), [
    "🎉 Dota 2 累计突破 50 小时",
  ]);
  const later = { "570": game("Dota 2", 53 * 60), "730": game("CS2", 600) };
  assert.deepEqual(computeMilestones({ baseGames: latest, latestGames: later, achievements: [] }), []);
});

test("computeMilestones：长合并窗口一次跨过多档时取最高档", () => {
  // 2h → 52h 同时跨过 10/25/50 档，应播 50 而不是最低的 10
  const base = { "570": game("Dota 2", 2 * 60), "730": game("CS2", 600) };
  const latest = { "570": game("Dota 2", 52 * 60), "730": game("CS2", 600) };
  assert.deepEqual(computeMilestones({ baseGames: base, latestGames: latest, achievements: [] }), [
    "🎉 Dota 2 累计突破 50 小时",
    "📚 库存总时长突破 50 小时",
  ]);
});

test("computeMilestones：新入库游戏不播档位（历史时长未知，同 computeDiff 口径）", () => {
  // 新游戏的时长只计入库存总时长且不足以跨档，单游戏档位应跳过
  const base = { "730": game("CS2", 100) };
  const latest = { "730": game("CS2", 100), "4000": game("新游戏", 300) };
  assert.deepEqual(computeMilestones({ baseGames: base, latestGames: latest, achievements: [] }), []);
});

test("computeMilestones：库存总时长跨档", () => {
  const base = { "730": game("CS2", 499 * 60) };
  const latest = { "730": game("CS2", 501 * 60) };
  assert.deepEqual(computeMilestones({ baseGames: base, latestGames: latest, achievements: [] }), [
    "🎉 CS2 累计突破 500 小时",
    "📚 库存总时长突破 500 小时",
  ]);
});

test("computeMilestones：全成就在望与达成", () => {
  const base = { "570": game("Dota 2", 100) };
  const latest = { "570": game("Dota 2", 120) };
  const section = (unlockedCount, total, addedCount) => ({
    gameName: "Dota 2",
    total,
    unlockedCount,
    added: Array.from({ length: addedCount }, (_, i) => ({ displayName: `成就${i}` })),
  });

  assert.deepEqual(computeMilestones({ baseGames: base, latestGames: latest, achievements: [section(41, 42, 1)] }), [
    "Dota 2 41/42，再拿 1 个成就就全达成",
  ]);
  assert.ok(
    computeMilestones({ baseGames: base, latestGames: latest, achievements: [section(42, 42, 1)] }).includes(
      "🏆 Dota 2 全成就达成！",
    ),
  );
  // 距全成就太远不播
  assert.deepEqual(computeMilestones({ baseGames: base, latestGames: latest, achievements: [section(30, 100, 2)] }), []);
  // 本窗口没有新解锁不播（即使已接近全成就）
  assert.deepEqual(computeMilestones({ baseGames: base, latestGames: latest, achievements: [section(41, 42, 0)] }), []);
  // 无任何里程碑 → 空数组
  assert.deepEqual(computeMilestones({ baseGames: null, latestGames: null, achievements: [] }), []);
});

test("lastPlayedGame：取最近玩过的游戏并格式化日期，从未玩过返回 null", () => {
  const games = {
    "730": game("CS2", 100, Math.floor(Date.UTC(2026, 8, 15, 2, 0) / 1000)), // 北京 9月15日 10:00
    "570": game("Dota 2", 100, Math.floor(Date.UTC(2026, 8, 20, 16, 0) / 1000)), // 北京 9月21日 00:00
    "4000": game("从未运行", 100, 0),
  };
  assert.deepEqual(lastPlayedGame(games, "Asia/Shanghai"), { name: "Dota 2", lastDate: "9月21日" });
  assert.equal(lastPlayedGame({ "4000": game("从未运行", 100, 0) }, "Asia/Shanghai"), null);
  assert.equal(lastPlayedGame(null, "Asia/Shanghai"), null);
});

test("lastPlayedGame：窗口内动过的游戏不计（当日新买即玩等）", () => {
  const before = Math.floor(Date.UTC(2026, 8, 21, 16, 0) / 1000); // 北京 9月22日 00:00，窗口起点
  const inWindow = Math.floor(Date.UTC(2026, 8, 22, 6, 0) / 1000); // 北京 9月22日 14:00，属窗口内
  const games = {
    "990080": game("新买即玩", 300, inWindow), // computeDiff 不计其时长 → 走休息日分支
    "570": game("Dota 2", 100, Math.floor(Date.UTC(2026, 8, 20, 16, 0) / 1000)), // 北京 9月21日
  };
  assert.deepEqual(lastPlayedGame(games, "Asia/Shanghai", before), { name: "Dota 2", lastDate: "9月21日" });
  // 全部都在窗口内动过 → 隐藏该行，避免与「当日没有启动任何游戏」矛盾
  assert.equal(lastPlayedGame({ "990080": game("新买即玩", 300, inWindow) }, "Asia/Shanghai", before), null);
});

test("extras 渲染：卡片与 Markdown 呈现称号/MVP/里程碑", () => {
  const diff = computeDiff(
    { "570": game("Dota 2", 3000), "730": game("CS2", 1000) },
    { "570": game("Dota 2", 3120), "730": game("CS2", 1030) },
  );
  // Dota 2 +120、CS2 +30 → 总 150 分钟（战斗力在线），MVP 占比 80%
  const extras = {
    titleText: pickTitle(diff.totalTodayMinutes),
    mvp: computeMvp(diff.playedToday),
    milestoneLines: ["🎉 Dota 2 累计突破 50 小时"],
  };

  const card = buildReportCard({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "08:00",
    timeZone: "Asia/Shanghai",
    extras,
  });
  const allText = JSON.stringify(card);
  assert.ok(allText.includes("战斗力在线 ⚔️"));
  assert.ok(allText.includes("Dota 2** 🏅"));
  assert.ok(allText.includes("占今日 80%"));
  assert.ok(allText.includes("今日里程碑"));

  const md = buildReportMarkdown({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "08:00",
    timeZone: "Asia/Shanghai",
    extras,
  });
  assert.ok(md.text.includes("战斗力在线 ⚔️"));
  assert.ok(md.text.includes("占今日 80%"));
  assert.ok(md.text.includes("今日里程碑"));
});

test("extras 渲染：休息日展示最近在玩", () => {
  const diff = computeDiff({ "570": game("Dota 2", 3000) }, { "570": game("Dota 2", 3000) });
  const extras = { lastPlayed: { name: "Dota 2", lastDate: "9月21日" } };

  const card = buildReportCard({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "08:00",
    timeZone: "Asia/Shanghai",
    extras,
  });
  assert.ok(JSON.stringify(card).includes("上次开团：**Dota 2** · 9月21日"));

  const md = buildReportMarkdown({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "08:00",
    timeZone: "Asia/Shanghai",
    extras,
  });
  assert.ok(md.text.includes("上次开团：**Dota 2** · 9月21日"));
});
