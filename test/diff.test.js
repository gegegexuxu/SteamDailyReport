// 单元测试：node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeDiff, diffAchievements, formatMinutes, libraryStats } from "../scripts/diff.js";
import { buildInitCard, buildReportCard } from "../scripts/card.js";
import { formatZhDate, windowNote } from "../scripts/text.js";
import { buildInitMarkdown, buildReportMarkdown } from "../scripts/notifiers/markdown.js";
import { buildSignedUrl, signDingtalk } from "../scripts/notifiers/dingtalk.js";
import { resolveNotifier } from "../scripts/notifiers/index.js";
import { wecom } from "../scripts/notifiers/wecom.js";
import { signPayload } from "../scripts/feishu.js";
import { buildSnapshot, buildState, loadState, nowTimeIn, pushSnapshot, saveState, todayIn } from "../scripts/state.js";

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
  assert.ok(allText.includes("当日游玩"));
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

test("buildInitCard：包含库存统计与全成就（缺省隐藏）", () => {
  const card = buildInitCard({ personaName: "玩家", library: { gameCount: 88, totalMinutes: 60000 }, perfectCount: 3 });
  const allText = JSON.stringify(card);
  assert.ok(allText.includes("88"));
  assert.ok(allText.includes("1000 小时"));
  assert.ok(allText.includes("全成就 **3** 款"));
  const without = buildInitCard({ personaName: "玩家", library: { gameCount: 88, totalMinutes: 60000 } });
  assert.ok(!JSON.stringify(without).includes("全成就"));
});

test("formatZhDate", () => {
  assert.equal(formatZhDate("2026-09-22"), "9月22日");
  assert.equal(formatZhDate("2026-12-01"), "12月1日");
  assert.equal(formatZhDate("bad"), "bad");
});

test("windowNote：窗口跨天合并提示", () => {
  assert.equal(windowNote("2026-09-22", "2026-09-23"), ""); // 相邻两天：正常日报不打扰
  assert.equal(windowNote("2026-09-23", "2026-09-23"), ""); // 同一天（手动补快照的部分窗口）
  assert.equal(windowNote("2026-09-20", "2026-09-23"), "统计 9月20日–9月23日 · ");
  assert.equal(windowNote("bad", "2026-09-23"), "");
});

test("buildReportMarkdown：游玩列表超过 15 款时截断", () => {
  const prev = {};
  const cur = {};
  for (let i = 0; i < 20; i++) {
    prev[String(i)] = game(`G${i}`, 100);
    cur[String(i)] = game(`G${i}`, 100 + i + 1);
  }
  const diff = computeDiff(prev, cur);
  const { text } = buildReportMarkdown({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "22:00",
    timeZone: "Asia/Shanghai",
  });
  assert.ok(text.includes("仅列前 15 款"));
  assert.ok(text.includes("G19")); // 按时长降序，增量最大的在前 15 款内
  assert.ok(!text.includes("G0")); // 增量最小的被截掉
});

test("wecom：超长消息按 UTF-8 字节截断到 4096 以内", () => {
  const diff = computeDiff({ "730": game("CS2", 1000) }, { "730": game("CS2", 1000) });
  const achievements = Array.from({ length: 10 }, (_, i) => ({
    gameName: `游戏名称特别长的测试游戏编号${i}`,
    total: 100,
    unlockedCount: 50,
    added: Array.from({ length: 8 }, (_, j) => ({ displayName: `一个非常非常长的成就名称测试用例${i}-${j}` })),
  }));
  const payload = wecom.buildReport({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements,
    generatedAt: "22:00",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(payload.msgtype, "markdown");
  assert.ok(Buffer.byteLength(payload.markdown.content, "utf8") <= 4096);
  assert.ok(payload.markdown.content.includes("已截断"));
});

test("战报注明跨天合并窗口", () => {
  const diff = computeDiff({ "730": game("CS2", 1000) }, { "730": game("CS2", 1000) });
  const card = buildReportCard({
    personaName: "玩家",
    reportDate: "2026-09-20",
    diff,
    achievements: [],
    generatedAt: "08:00",
    timeZone: "Asia/Shanghai",
    windowNote: windowNote("2026-09-20", "2026-09-23"),
  });
  assert.ok(JSON.stringify(card).includes("统计 9月20日–9月23日"));
  const md = buildReportMarkdown({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "08:00",
    timeZone: "Asia/Shanghai",
    windowNote: windowNote("2026-09-22", "2026-09-23"),
  });
  assert.ok(!md.text.includes("合并"));
});

test("buildReportMarkdown（钉钉/企微共用）：包含核心信息", () => {
  const diff = computeDiff(
    { "730": game("CS2", 1000) },
    { "730": game("CS2", 1090), "4000": game("Golf It!", 10) },
  );
  const { title, text } = buildReportMarkdown({
    personaName: "玩家*甲",
    reportDate: "2026-09-22",
    diff,
    achievements: [{ gameName: "CS2", total: 100, unlockedCount: 35, added: [{ displayName: "首胜" }] }],
    generatedAt: "22:00",
    timeZone: "Asia/Shanghai",
  });
  assert.match(title, /Steam 每日战报 · 9月22日/);
  assert.ok(text.includes("+1.5 小时"));
  assert.ok(text.includes("首胜"));
  assert.ok(text.includes("Golf It!"));
  assert.ok(text.includes("库存游戏 2 款"));
  assert.ok(text.includes("生成于 22:00"));
  assert.ok(text.includes("玩家＊甲")); // markdown 特殊字符被替换
});

test("buildReportMarkdown：休息日", () => {
  const diff = computeDiff({ "730": game("CS2", 1000) }, { "730": game("CS2", 1000) });
  const { text } = buildReportMarkdown({
    personaName: "玩家",
    reportDate: "2026-09-22",
    diff,
    achievements: [],
    generatedAt: "22:00",
    timeZone: "Asia/Shanghai",
  });
  assert.ok(text.includes("休息日"));
});

test("buildInitMarkdown：包含库存统计与全成就（缺省隐藏）", () => {
  const { title, text } = buildInitMarkdown({
    personaName: "玩家",
    library: { gameCount: 88, totalMinutes: 60000 },
    perfectCount: 2,
  });
  assert.ok(title.includes("存档已创建"));
  assert.ok(text.includes("88"));
  assert.ok(text.includes("1000 小时"));
  assert.ok(text.includes("全成就 **2** 款"));
  const { text: bare } = buildInitMarkdown({ personaName: "玩家", library: { gameCount: 88, totalMinutes: 60000 } });
  assert.ok(!bare.includes("全成就"));
});

test("signDingtalk：与钉钉规范一致（HMAC-SHA256，key=secret，消息=timestamp\\nsecret）", () => {
  // 固定向量：由 node:crypto 计算并人工核对算法约定（timestamp 为毫秒）
  assert.equal(signDingtalk("test-secret", 1700000000000), "BYMqUCZnSqbfPf1GCfZftO7Rg2g6P+Rp3/4+bLNtSGA=");
  // 与飞书签名算法不同（key 与消息互换），结果必然不同
  assert.notEqual(signDingtalk("test-secret", 1700000000), signPayload("test-secret", 1700000000));

  const url = buildSignedUrl("https://oapi.dingtalk.com/robot/send?access_token=xxx", "test-secret", 1700000000000);
  assert.ok(url.startsWith("https://oapi.dingtalk.com/robot/send?access_token=xxx&timestamp=1700000000000&sign="));
  assert.ok(url.endsWith(encodeURIComponent(signDingtalk("test-secret", 1700000000000))));
  // Webhook 无查询参数时用 ? 拼接
  assert.ok(buildSignedUrl("https://example.com/hook", "s", 1).includes("?timestamp=1&sign="));
});

test("resolveNotifier：按域名识别平台，未识别时回退飞书", () => {
  assert.equal(resolveNotifier("https://open.feishu.cn/open-apis/bot/v2/hook/xxx").name, "feishu");
  assert.equal(resolveNotifier("https://oapi.dingtalk.com/robot/send?access_token=xxx").name, "dingtalk");
  assert.equal(resolveNotifier("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx").name, "wecom");
  assert.equal(resolveNotifier("https://example.com/hook").name, "feishu");
});

test("state：日期工具与快照读写往返", () => {
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
    saveState(path, buildState({ snapshots: [snapshot], lastSentWindow: null }));
    const loaded = loadState(path);
    assert.equal(loaded.version, 3);
    assert.equal(loaded.snapshots[0].date, "2026-09-22");
    assert.ok(loaded.snapshots[0].capturedAt); // capturedAt 自动生成
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("state：pushSnapshot 只保留最近两份", () => {
  const snap = (date) => buildSnapshot({ date, personaName: "玩家", games: {}, achievements: {} });
  const s1 = pushSnapshot(null, snap("2026-09-21"));
  assert.equal(s1.snapshots.length, 1);
  const s2 = pushSnapshot(s1, snap("2026-09-22"));
  assert.equal(s2.snapshots.length, 2);
  const s3 = pushSnapshot(s2, snap("2026-09-23"));
  assert.equal(s3.snapshots.length, 2);
  assert.deepEqual(s3.snapshots.map((s) => s.date), ["2026-09-22", "2026-09-23"]); // 最旧的被丢弃
  assert.equal(s3.lastSentWindow, null); // 幂等标记原样透传
});

test("state：v1 旧快照自动迁移为 v3", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdr-test-"));
  try {
    const path = join(dir, "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        lastReportDate: "2026-09-22",
        capturedAt: "2026-09-22T14:00:00.000Z",
        personaName: "玩家",
        games: { "730": game("CS2", 1000) },
        achievements: {},
      }),
      "utf8",
    );
    const state = loadState(path);
    assert.equal(state.version, 3);
    assert.equal(state.snapshots.length, 1);
    assert.equal(state.snapshots[0].date, "2026-09-22");
    assert.equal(state.snapshots[0].games["730"].name, "CS2");
    // v1 当天已发过战报，迁移后标记该窗口避免重复推送
    assert.equal(state.lastSentWindow, "2026-09-22T14:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("state：v2 状态自动迁移为 v3", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdr-test-"));
  try {
    const path = join(dir, "state.json");
    const prev = { date: "2026-09-21", personaName: "玩家", games: { "730": game("CS2", 900) }, achievements: {} };
    const current = { date: "2026-09-22", personaName: "玩家", games: { "730": game("CS2", 1000) }, achievements: {} };
    writeFileSync(
      path,
      JSON.stringify({ version: 2, prev, current, lastSent: { date: "2026-09-22", time: "22:01" } }),
      "utf8",
    );
    const state = loadState(path);
    assert.equal(state.version, 3);
    assert.deepEqual(state.snapshots.map((s) => s.date), ["2026-09-21", "2026-09-22"]);
    // v2 的 current 只在发送成功后写入，存在即代表该窗口已发过
    assert.equal(state.lastSentWindow, state.snapshots[1].capturedAt);
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
