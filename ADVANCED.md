# ⚙️ 高级配置

Fork 之后，所有个性化调整都在你自己的仓库里完成：改对应文件 → 提交 → 自动生效，**不需要改任何代码**。

本项目由两个固定时刻的定时任务组成：

| 时刻（默认） | 工作流 | 干什么 |
|---|---|---|
| 每天 0 点 | `Steam Snapshot`（[snapshot.yml](.github/workflows/snapshot.yml)） | 抓取 Steam 数据存快照，**划定统计窗口边界** |
| 每天 8 点 | `Steam Daily Report`（[report.yml](.github/workflows/report.yml)） | 对比最近两份快照，**发送昨日战报** |

## 改结算时间（统计窗口边界）

编辑 `.github/workflows/snapshot.yml` 里的 cron。**GitHub Actions 的 cron 用的是 UTC**，北京时间 = UTC + 8，换算参考：

| 想要的北京时间 | cron 写法（UTC） |
|---|---|
| 0 点 | `0 16 * * *`（默认） |
| 6 点 | `0 22 * * *` |
| 中午 12 点 | `0 4 * * *` |
| 18 点 | `0 10 * * *` |
| 22 点 | `0 14 * * *` |

五段含义为 `分 时 日 月 周`，都从 UTC 换算。定时有几分钟到几十分钟延迟属正常。

## 改发送时间

编辑 `.github/workflows/report.yml` 里的 cron，换算方式同上。默认 `0 0 * * *` = 北京 8 点。

发送时间改到几点都**不影响统计口径**——窗口永远由快照时刻决定，晚发的内容和早发完全一致。

## 一天发多次战报

给两个工作流**各加多条 cron**，交错排列即可。例如 0 点/12 点结算、8 点/20 点发送：

```yaml
# snapshot.yml
schedule:
  - cron: "0 16 * * *"  # 北京 0 点
  - cron: "0 4 * * *"   # 北京 12 点

# report.yml
schedule:
  - cron: "0 0 * * *"   # 北京 8 点
  - cron: "0 12 * * *"  # 北京 20 点
```

每个已结算的窗口只会发送一次（状态里有幂等标记），不会重复推送。

## 重复快照自动去重

同一天内重复运行 Snapshot（手动误触、定时任务重跑）**不会破坏统计窗口**：若最新一份快照还没被播报消费，新快照会直接顶替它，差值基线不动；只有已被播报消费过（如上面「一天发多次战报」的上午结算）或跨天的新快照，才正常追加并淘汰最旧的一份。

## 改时区

在仓库 **Settings → Secrets and variables → Actions → Variables** 添加 `REPORT_TIMEZONE`（IANA 名称，如 `Asia/Tokyo`）。它决定快照归属的「日期」和战报上的时间显示。

注意：**cron 是 UTC 写死的**，改了时区记得把两个工作流的时刻一起换算，否则「0 点结算」会变成别的时刻结算。

## 立即补发一份战报

Actions → **Steam Daily Report** → Run workflow，勾选 **force**。会重发最近一个已结算窗口的战报（内容与上次相同）。想补新数据，先手动跑一次 **Steam Snapshot** 再 force 发送。

## 重置所有数据

Actions 页面进入任意一次运行，删除名为 `steam-report-state` 的 Artifact（或等 90 天自动过期），下次快照会重新初始化基线。

## 本地运行

```bash
cp .env.example .env   # 填入配置
npm run snapshot       # 结算：抓数据存快照
npm start              # 播报：发送最近窗口的战报
npm test               # 单元测试
```

需要 Node.js >= 22.9。本地 `data/state.json` 已被 `.gitignore` 忽略。

## 换通知平台 / 新增平台

切换飞书 / 钉钉 / 企业微信只需替换 `NOTIFY_WEBHOOK`（见 [README](README.md)）。

想接入新平台（如 Telegram、Server酱），在 `scripts/notifiers/` 下实现 `{ name, matches, buildReport, buildInit, send }` 接口并到 `index.js` 注册即可——现有适配器（如 `dingtalk.js`）就是模板。
