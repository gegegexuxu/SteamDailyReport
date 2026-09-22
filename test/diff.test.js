// 单元测试：node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeDiff, diffAchievements, formatMinutes, libraryStats } from "../scripts/diff.js";
import { buildInitCard, buildReportCard, formatZhDate } from "../scripts/card.js";
import { signPayload } from "../scripts/feishu.js";
import { buildState, buildSnapshot, loadState, saveState } from "../scripts/state.js";
import {
  DEFAULT_REPORT_TIME,
  formatReportTime,
  hasDueReportTime,
  nowTimeIn,
  parseReportTime,
  parseReportTimes,
  todayIn,
} from "../scripts/state.js";

const game = (name, playtimeForever) => ({ name, playtimeForever, rtimeLastPlayed: 0 });

test("computeDiff：正常差值并按时长降序", () => {
  const prev = { "730": game("CS2", 1000), "570": game("Dota 2", 5000) };
  const cur = { "730": game("CS2", 1090), "570": game("Dota 2", 5030) };
  const diff = computeDiff(prev, cur);
  assert.equal(diff.totalTodayMinutes, 120);
  assert.deepEqual(
    diff.playedToday.map((g) => g.appId),
    ["730", "570"],
  );
  assert.equal(diff.playedToday[0].todayMinutes, 90);
  assert.equal(diff.playedToday[0].totalMinutes, 1090);
  assert.deepEqual(diff.newLibraryGames, []);
});

test("computeDiff：时长回退（负增量）不产生负值", () => {
  const prev = { "730": game("CS2", 1000) };
  const cur = { "730": game("CS2", 990) };
  const diff = computeDiff(prev, cur);
  assert.equal(diff.totalTodayMinutes, 0);
  assert.deepEqual(diff.playedToday, []);
});

test("computeDiff：新增入库不计入今日时长（历史时长未知）", () => {
  const prev = { "730": game("CS2", 1000) };
  const cur = { "730": game("CS2", 1000), "4000": game("新游戏", 300) };
  const diff = computeDiff(prev, cur);
  assert.deepEqual(diff.newLibraryGames.map((g) => g.appId), ["4000"]);
  assert.equal(diff.totalTodayMinutes, 0);
  assert.deepEqual(diff.playedToday, []);
});

test("computeDiff：无上次快照时全部记为新增入库", () => {
  const cur = { "730": game("CS2", 1000) };
  const diff = computeDiff(null, cur);
  assert.equal(diff.newLibraryGames.length, 1);
  assert.equal(diff.totalTodayMinutes, 0);
});

test("computeDiff：library 统计", () => {
  const cur = { "730": game("CS2", 1000), "570": game("Dota 2", 5000) };
  assert.deepEqual(libraryStats(cur), { gameCount: 2, totalMinutes: 6000 });
  const diff = computeDiff({}, cur);
  assert.equal(diff.library.gameCount, 2);
  assert.equal(diff.library.totalMinutes, 6000);
});

test("diffAchievements：仅返回新增", () => {
  const prev = ["A", "B"];
  const current = [
    { apiname: "A", unlocktime: 1 },
    { apiname: "B", unlocktime: 2 },
    { apiname: "C", unlocktime: 3 },
  ];
  const added = diffAchievements(prev, current);
  assert.deepEqual(added.map((a) => a.apiname), ["C"]);
  assert.deepEqual(diffAchievements(["A"], [{ apiname: "A", unlocktime: 1 }]), []);
});

test("formatMinutes", () => {
  assert.equal(formatMinutes(30), "30 分钟");
  assert.equal(formatMinutes(60), "1 小时");
  assert.equal(formatMinutes(90), "1.5 小时");
  assert.equal(formatMinutes(0), "0 分钟");
  assert.equal(formatMinutes(-5), "0 分钟");
});

test("signPayload：与飞书规范一致（HMAC-SHA256，key=timestamp\\nsecret，空消息）", () => {
  // 固定向量：由 node:crypto 计算并人工核对算法约定
  assert.equal(signPayload("test-secret", 1700000000), "mbm4Y4oluIPQ00qlBIhX8vAZ0EKv3nw0LuTb91jPL84=");
  // 不同时间戳签名不同
  assert.notEqual(signPayload("test-secret", 1700000001), signPayload("test-secret", 1700000000));
});

test("buildReportCard：有游玩 + 成就 + 新入库", () => {
  const diff = computeDiff(
    { "730": game("CS2", 1000) },
    { "730": game("CS2", 1090), "4000": game("Golf It!", 10) },
  );
  const card = buildReportCard({
    personaName: "玩家*甲",
    reportDate: "2026-09-22",
    diff,
    achievements: [
      { gameName: "CS2", total: 100, unlockedCount: 35, added: [{ displayName: "首胜" }] },
    ],
    generatedAt: "22:00",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(card.msg_type, "interactive");
  assert.equal(card.card.header.title.content, "🎮 Steam 每日战报 · 9月22日");
  assert.equal(card.card.header.template, "blue");
  const allText = JSON.stringify(card);
  assert.ok(allText.includes("今天游玩"));
  assert.ok(allText.includes("+1.5 小时"));
  assert.ok(allText.includes("首胜"));
  assert.ok(allText.includes("Golf It!"));
  assert.ok(allText.includes("玩家＊甲")); // markdown 特殊字符被替换
  assert.ok(allText.includes("6000") === false); // 不包含无关数据
});

test("buildReportCard：休息日卡片", () => {
  const diff = computeDiff({ "730": game("CS2", 1000) }, { "730": game("CS2", 1000) });
  const card = buildReportCard({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "22:00",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(card.card.header.template, "turquoise");
  assert.ok(JSON.stringify(card).includes("休息日"));
});

test("buildInitCard：包含库存统计", () => {
  const card = buildInitCard({ personaName: "玩家", reportDate: "2026-09-22", library: { gameCount: 88, totalMinutes: 60000 } });
  assert.ok(JSON.stringify(card).includes("88"));
  assert.ok(JSON.stringify(card).includes("1000 小时"));
});

test("formatZhDate", () => {
  assert.equal(formatZhDate("2026-09-22"), "9月22日");
  assert.equal(formatZhDate("2026-12-01"), "12月1日");
  assert.equal(formatZhDate("bad"), "bad");
});

test("parseReportTime：支持 HH 与 HH:MM，非法返回 null", () => {
  assert.deepEqual(parseReportTime("22"), { hour: 22, minute: 0 });
  assert.deepEqual(parseReportTime("22:00"), { hour: 22, minute: 0 });
  assert.deepEqual(parseReportTime(" 9:05 "), { hour: 9, minute: 5 });
  assert.deepEqual(parseReportTime(DEFAULT_REPORT_TIME), { hour: 22, minute: 0 });
  for (const bad of ["25:00", "22:60", "abc", "", "8:5", "-1:00", undefined]) {
    assert.equal(parseReportTime(bad), null, String(bad));
  }
});

test("parseReportTimes：逗号分隔并按时间升序；为空或任一非法返回 null", () => {
  assert.deepEqual(parseReportTimes("22:00,09:00"), [
    { hour: 9, minute: 0 },
    { hour: 22, minute: 0 },
  ]);
  assert.deepEqual(parseReportTimes(" 9, 12:30 "), [
    { hour: 9, minute: 0 },
    { hour: 12, minute: 30 },
  ]);
  assert.equal(parseReportTimes("09:00,bad"), null);
  assert.equal(parseReportTimes(""), null);
  assert.equal(parseReportTimes(undefined), null);
});

test("formatReportTime：补零输出 HH:MM", () => {
  assert.equal(formatReportTime({ hour: 9, minute: 5 }), "09:05");
  assert.equal(formatReportTime({ hour: 22, minute: 0 }), "22:00");
});

test("hasDueReportTime：按报告时区判定到点与当日已发", () => {
  // 2026-09-23 06:00 UTC = 14:00（Asia/Shanghai）
  const now = new Date("2026-09-23T06:00:00Z");
  const slots = parseReportTimes("12:00,22:00");
  // 尚未到点
  assert.equal(hasDueReportTime("Asia/Shanghai", parseReportTimes("15:00"), null, now), false);
  // 恰好到点（含等于）
  assert.equal(hasDueReportTime("Asia/Shanghai", parseReportTimes("14:00"), null, now), true);
  // 12:00 已到且今日未发
  assert.equal(hasDueReportTime("Asia/Shanghai", slots, null, now), true);
  // 12:00 已满足（13:07 发过）、22:00 未到 → 无待发
  assert.equal(hasDueReportTime("Asia/Shanghai", slots, { date: "2026-09-23", time: "13:07" }, now), false);
  // 记录的发送时刻早于 12:00 → 仍需发送
  assert.equal(hasDueReportTime("Asia/Shanghai", slots, { date: "2026-09-23", time: "11:30" }, now), true);
  // 昨天发过不影响今天
  assert.equal(hasDueReportTime("Asia/Shanghai", slots, { date: "2026-09-22", time: "23:59" }, now), true);
  // 同一时刻在 UTC 时区为 06:00
  assert.equal(hasDueReportTime("UTC", parseReportTimes("06:00"), null, now), true);
  assert.equal(hasDueReportTime("UTC", parseReportTimes("06:30"), null, now), false);
});

test("state：日期工具与读写往返", () => {
  assert.match(todayIn("Asia/Shanghai"), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(nowTimeIn("Asia/Shanghai"), /^\d{2}:\d{2}$/);

  const dir = mkdtempSync(join(tmpdir(), "sdr-test-"));
  try {
    const path = join(dir, "state.json");
    assert.equal(loadState(path), null); // 不存在 → null
    const snapshot = buildSnapshot({
      date: "2026-09-22",
      personaName: "玩家",
      games: { "730": game("CS2", 1) },
      achievements: {},
    });
    saveState(path, buildState({ prev: snapshot, current: null, lastSent: { date: "2026-09-22", time: "22:01" } }));
    assert.equal(loadState(path).prev.date, "2026-09-22");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("state：v1 旧快照自动迁移为 v2（旧快照作为前一日基线）", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdr-test-"));
  try {
    const path = join(dir, "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        lastReportDate: "2026-09-22",
        capturedAt: "2026-09-22T14:00:00Z",
        personaName: "玩家",
        games: { "730": game("CS2", 1000) },
        achievements: {},
      }),
      "utf8",
    );
    const state = loadState(path);
    assert.equal(state.version, 2);
    assert.equal(state.prev.date, "2026-09-22");
    assert.equal(state.prev.games["730"].name, "CS2");
    assert.equal(state.current, null);
    // 迁移当天视为已全部发过，避免升级当天重复推送
    assert.deepEqual(state.lastSent, { date: "2026-09-22", time: "23:59" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("state：损坏快照返回 null 而不是崩溃", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdr-test-"));
  try {
    const path = join(dir, "state.json");
    writeFileSync(path, "{not json", "utf8");
    assert.equal(loadState(path), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
