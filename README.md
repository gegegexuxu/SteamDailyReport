# 🎮 Steam 每日战报

每天定时拉取你的 Steam 数据，自动生成「今日战报」推送到飞书群。零服务器、零第三方依赖（纯 Node.js 内置能力），Fork 即用。

```text
GitHub Actions（定时轮询）
   → 到达 REPORT_TIME 配置的时刻才发送
   → Steam Web API 拉取游戏库 / 成就
   → 与前一日快照做差值
   → 飞书机器人 Webhook 推送卡片
   → 快照存入 Actions Artifact（不进 Git 历史）
```

## 战报效果（文字示意）

```text
🎮 Steam 每日战报 · 9月22日
────────────────────────────
灰烬猎人 今天游玩 2.8 小时（2 款游戏）
 1. ELDEN RING        +1.8 小时（累计 51.8 小时）
 2. Counter-Strike 2  +1 小时（累计 210.7 小时）

🏆 新解锁成就 3 个
 · Counter-Strike 2（80/167）：「赢得一场竞技比赛」「爆头大师」
 · ELDEN RING（41/42）：「艾尔登之王」

📦 新增入库 1 款：Hogwarts Legacy
────────────────────────────
库存游戏 4 款 ｜ 总时长 1096.8 小时
数据来源 Steam Web API · 生成于 22:00（Asia/Shanghai）
```

没玩游戏的当天也会发一张「休息日 📚」卡片，方便确认链路存活。

## 🚀 三分钟部署

### 1. Fork 本仓库

### 2. 设置 Steam 隐私

打开 [Steam 隐私设置](https://steamcommunity.com/my/edit/settings)，将 **「游戏详情」设为公开**（否则 API 拿不到游戏时长和成就）。

### 3. 申请 Steam Web API Key

打开 <https://steamcommunity.com/dev/apikey> 登录后即可获得。

### 4. 创建飞书机器人

飞书群 → 设置 → 群机器人 → 添加自定义机器人，得到 Webhook 地址。
如果启用了「签名校验」，把密钥一并记下（第 5 步会用到）。

### 5. 配置 Secrets

在你 Fork 的仓库中：**Settings → Secrets and variables → Actions → Secrets → New repository secret**

| Name | 说明 | 必填 |
|---|---|---|
| `STEAM_API_KEY` | Steam Web API Key | ✅ |
| `STEAM_ID` | 你的 SteamID64（17 位数字，[steamid.io](https://steamid.io) 可查） | ✅ |
| `FEISHU_WEBHOOK` | 飞书机器人 Webhook 地址 | ✅ |
| `FEISHU_SECRET` | 飞书机器人签名密钥（未开启签名校验可不填） | ❌ |

可选 Variables（**Settings → Secrets and variables → Actions → Variables**）：

| Name | 默认值 | 说明 |
|---|---|---|
| `REPORT_TIMEZONE` | `Asia/Shanghai` | 战报日期所用时区（IANA 名称） |
| `REPORT_TIME` | `22:00` | 每日发送时刻（`HH:MM`），多个用英文逗号分隔（如 `09:00,22:00`）；一天可发多次，每次都与前一天比较 |

### 6. 启用并测试

Fork 后 GitHub 默认会禁用定时任务：打开仓库的 **Actions** 页面，按提示启用工作流。
然后选择 **Daily Steam Report → Run workflow** 手动运行一次：

- 首次运行会发送「战报已初始化」卡片，只建立基线，**不会**把整个游戏库当成今日新增；
- 第二天开始收到每日战报。

发送时刻由 Variables 中的 `REPORT_TIME` 配置（默认每天 `22:00`，`REPORT_TIMEZONE` 所示时区），
无需改代码。工作流每半小时轮询一次，实际发送为到点后的第一次轮询，通常晚几分钟
（GitHub 定时高峰期可能有更长延迟）。

## 🔧 工作原理

1. **数据来源**：Steam API 只提供累计时长，因此「今日数据」= 本次累计值 − 前一日快照累计值；
2. **快照持久化**：每次发送成功后，把当天最新累计值存为 GitHub Actions Artifact（保留 90 天），**不会提交进 Git 仓库**，公开仓库也不会泄露你的游戏数据；
3. **成就对比**：仅为「自前一日以来有时长增量」的游戏（最多 10 款）查询成就，对比前一日解锁集合得出新增成就及其名称；
4. **可配置时间**：GitHub 的 cron 无法读取变量，所以工作流每半小时轮询，由脚本按 `REPORT_TIME`（默认 `22:00`，可配多个时刻）判断到点才发送；快照记录最近发送时刻，同一时刻不会重复推送。手动运行共用此判定，勾选 `force`（或本地 `FORCE_SEND=true`）可强制重发；
5. **一天多次、只比前一天**：同一天多次发送时，每次都与「前一日最后一次快照」比较，晚间战报包含全天数据（不拆分）；当天最后一次快照会在次日自动成为新的比较基线。没有前一日数据时发送初始化卡片；
6. **失败安全**：只有飞书发送成功后才更新快照；发送失败时工作流标红，下次轮询会自动补发完整差值。

## ❓ FAQ

**为什么首日没有战报？**
首次运行只建立基线（否则整个库都会被当作“今日新增”），第二天起生成差值战报。

**战报时间怎么改？**
在 **Settings → Secrets and variables → Actions → Variables** 中设置 `REPORT_TIME`（`HH:MM`，默认 `22:00`），无需改代码。工作流每半小时轮询，到点后第一次轮询发送，通常晚几分钟。想一天发多次就用英文逗号分隔多个时刻，如 `09:00,22:00`。

**一天发多次时，数据会按发送时刻拆分吗？**
不会。每次战报都与「前一天最后一次快照」做差值，晚间战报包含全天数据；当天多次发送互不影响，当天最后一次快照会在次日成为新的比较基线。

**手动运行为什么没有发送？**
手动运行与定时轮询共用同一判定：没有「已到点但今日未发」的时刻时跳过。想立即收到战报，运行时勾选 `force`（本地设 `FORCE_SEND=true`）。首次运行（无历史快照）不受此限制，会直接初始化。

**怎么重置所有数据？**
Actions 页面删除名为 `steam-report-state` 的 Artifact（或等待其 90 天过期），下次运行会重新初始化基线。

**快照会丢吗？**
Artifact 保留 90 天，每天运行会持续产生新快照，正常运行不会丢。若长期停用后恢复，会自动重建基线（中间日期无差值）。

**提示飞书返回错误 code=19021 / 签名错误？**
`FEISHU_SECRET` 与机器人「签名校验」的密钥不一致，核对后更新 Secret。

**飞书机器人设置了「自定义关键词」？**
需要保证消息中包含该关键词。最简单的办法是把关键词加进卡片标题（修改 `scripts/card.js` 中的标题文案）。

**Steam 数据拉取失败？**
确认 Steam「游戏详情」隐私为公开、`STEAM_ID` 是 17 位 SteamID64、`STEAM_API_KEY` 有效。

**想本地跑？**

```bash
cp .env.example .env   # 填入你自己的配置
npm start              # 需要 Node.js >= 22.9（使用 --env-file-if-exists）
npm test               # 运行单元测试
```

本地产生的 `data/state.json` 已被 `.gitignore` 忽略，不会误提交。

## ⚠️ 隐私说明

- 所有密钥都保存在 GitHub Secrets，代码与日志中不会出现；
- 游戏数据快照保存在 Actions Artifact 中，不进入 Git 历史；
- 公开仓库中别人能看到的只有代码本身，看不到你的任何数据。

## License

[MIT](./LICENSE)
