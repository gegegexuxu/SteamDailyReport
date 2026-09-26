# 🎮 Steam 每日战报

每天 0 点自动结算你的 Steam 游戏时长与成就，早上 8 点把「昨日战报」推送到群聊（飞书 / 钉钉 / 企业微信）。零服务器、零第三方依赖，Fork 即用。

## 战报效果（文字示意）

```text
🎮 Steam 每日战报 · 9月22日
────────────────────────────
灰烬猎人 当日游玩 2.8 小时（2 款游戏）· 战斗力在线 ⚔️
 1. Counter-Strike 2 🏅 +2 小时（累计 210.7 小时，占今日 71%）
 2. ELDEN RING         +0.8 小时（累计 51.8 小时）

🏆 新解锁成就 3 个
 · Counter-Strike 2（80/167）：「赢得一场竞技比赛」「爆头大师」
 · ELDEN RING（41/42）：「艾尔登之王」

🎖 今日里程碑
 · ELDEN RING 41/42，再拿 1 个成就就全达成

📦 新增入库 1 款：Hogwarts Legacy
────────────────────────────
库存游戏 4 款 ｜ 总时长 1096.8 小时
数据来自 Steam · 生成于 08:00（Asia/Shanghai）
```

没玩游戏的当天也会发一张「休息日 📚」卡片（附上次开团的游戏和日期），方便确认链路存活。

## 🚀 部署（约 5 分钟）

### 1. Fork 本仓库

点击本页右上角 **Fork → Create fork**，在你的账号下得到一份自己的仓库，后续操作都在你 Fork 的仓库里进行。

### 2. 将 Steam「游戏详情」设为公开

1. 登录后打开 [Steam 隐私设置](https://steamcommunity.com/my/edit/settings)；
2. 在「我的个人资料隐私设置」中找到 **游戏详情**；
3. 改为 **公开**。

> 不公开的话程序拿不到任何数据，运行日志会报「GetOwnedGames 返回空游戏库」。

### 3. 获取 SteamID64 与 API Key

- **SteamID64**：先看你的 Steam 主页链接是哪种形式——
  - `steamcommunity.com/profiles/76561198…/`：`profiles/` 后面那串数字**就是** SteamID64，直接复制；
  - `steamcommunity.com/id/自定义名/`：这是自定义网址，**不是** SteamID64，到 [steamid.io](https://steamid.io) 粘贴主页链接查一下，复制 17 位数字（以 `7656119` 开头）；
- **API Key**：打开 <https://steamcommunity.com/dev/apikey>，登录后页面要求填一个域名，**随便填即可**，提交后会显示一串 32 位的 Key。不想在浏览器再登录一次的话：按 **Win+R** 打开「运行」，执行
  `steam://openurl/https://steamcommunity.com/dev/apikey`
  会用 Steam 客户端内置浏览器打开该页，自动带上已登录状态。

### 4. 创建群机器人（飞书 / 钉钉 / 企业微信，三选一）

**飞书**
1. 群聊 → 设置 → 群机器人 → **添加机器人 → 自定义机器人**；
2. 创建后复制 **Webhook 地址**，形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx`；
3. 若开启了「签名校验」安全设置，把密钥一并复制。

**钉钉**
1. 群聊 → 设置 → 机器人 → **添加机器人 → 自定义**（通过 Webhook 接入）；
2. 安全设置三选一：推荐 **加签**（复制 `SEC` 开头的密钥）；选「自定义关键词」建议直接用 **战报**（消息标题里自带）；IP 白名单一般用不上；
3. 复制 **Webhook 地址**，形如 `https://oapi.dingtalk.com/robot/send?access_token=xxxx`。

**企业微信**
1. 群聊 → 右上角菜单 → **添加群机器人 → 新创建一个机器人**；
2. 复制 **Webhook 地址**，形如 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx`，无需密钥。

> 用哪家平台按 Webhook 域名自动识别，不需要额外配置。

### 5. 配置仓库 Secrets

进入你 Fork 的仓库 → **Settings → Secrets and variables → Actions → Secrets 标签 → New repository secret**，逐个添加：

| Name | Secret 值 |
|---|---|
| `STEAM_API_KEY` | 第 3 步获得的 API Key |
| `STEAM_ID` | 第 3 步获得的 17 位 SteamID64；多个账号用逗号分隔，每号各发一张战报（见下文「多账号战报」） |
| `NOTIFY_WEBHOOK` | 第 4 步获得的 Webhook 地址 |
| `NOTIFY_SECRET`（可选） | 飞书 = 签名校验密钥；钉钉 = 加签密钥；企业微信不填 |

### 6. 启用工作流并手动测试

1. 打开仓库的 **Actions** 页面，点击 **I understand my workflows, go ahead and enable them**（Fork 的仓库默认禁用定时任务）；
2. 左侧选择 **Steam Snapshot** → 右侧 **Run workflow → Run workflow**，等运行变绿（✓）后群里应收到「🎮 战报存档已创建」卡片（会顺带统计全成就游戏数，多等几十秒属正常）；
3. 部署完成。之后每天 **0 点自动结算、8 点自动推送昨日战报**（北京时间）。

> 首次快照只建立基线，**不会**把整个游戏库当成「当日新增」；下次 0 点结算后，8 点你就会收到第一份战报。若运行变红，点进本次运行查看日志，报错信息会写明缺什么配置。

## 🔧 日常调整

所有调整都在你 Fork 的仓库里完成，无需改代码。

**修改结算 / 发送时间、一天发多次**
改两个工作流里的 cron 即可（含 UTC 换算表），详见 **[高级配置 ADVANCED.md](ADVANCED.md)**。

**更换通知平台**
把 Secret `NOTIFY_WEBHOOK` 的值换成新平台的 Webhook 地址（需要密钥的同步换 `NOTIFY_SECRET`），其他都不用动。

**多账号战报**
把 Secret `STEAM_ID` 配成逗号分隔的多个 SteamID64（如 `76561198…,76561198…`）：

- 每个账号各发一张战报卡片（首行带各自昵称），发到同一个群；
- 各账号的快照、统计窗口、成就基线完全独立，新账号自动初始化基线，次日开始出报；
- 查询别人的账号，需要对方 Steam 隐私设置里「游戏详情」为公开；
- 更换 / 删减账号不影响其他账号的数据；被移除账号的快照原样保留，重新加回会补一份跨窗口合并的战报。

**立即补发一份战报**
Actions → Steam Daily Report → Run workflow，**勾选 force** 再运行；想带上最新数据就先手动跑一次 Steam Snapshot。

**重置所有数据**
到 Actions 的运行记录页，删除名为 `steam-report-state` 的 Artifact（或等它 90 天自动过期），下次快照会重新初始化基线。

**本地运行**

```bash
git clone https://github.com/gegegexuxu/SteamDailyReport.git
cd SteamDailyReport
cp .env.example .env   # 按注释填入你的配置
npm run snapshot       # 结算：抓数据存快照
npm start              # 播报：发送最近窗口的战报
npm test               # 运行单元测试（需要 Node.js >= 22.9）
```

更多自定义（改时区、一天多次、新增通知平台等）见 **[高级配置 ADVANCED.md](ADVANCED.md)**。

## 🔩 工作原理（简述）

- 每天 **0 点结算**：抓一次 Steam 累计数据存为快照（保存在 GitHub Actions Artifact，保留 90 天，不进 Git 仓库）；
- 每天 **8 点播报**：对比各账号最近两份快照，差值即昨天一整天的时长与新增成就（多账号各发一张卡片）；
- 成就只播报解锁时间（unlocktime）落在统计窗口内的：工具首次见到的老游戏，其历史成就不会被误报为「当日新解锁」；
- 某次结算缺失时窗口自动跨天合并补发，并在战报中注明「跨 M月d日–M月d日 合并」；
- 同一个窗口只会发送一次；发送失败下次运行自动重试，数据不会丢。

## ❓ 常见问题

**为什么部署当天没有战报？**
首次快照只建立基线（否则整个库会被当作"当日新增"），需要两份快照才能构成统计窗口；最早第二天 8 点收到第一份战报。

**手动运行 Report 为什么没发送？**
要么快照不足两份（窗口未形成），要么该窗口已发送过（日志会说明）。想强制重发，勾选 `force` 运行。

**提示飞书返回错误 code=19021 / 签名错误？**
`NOTIFY_SECRET` 与飞书机器人「签名校验」的密钥不一致，核对后更新 Secret。

**钉钉提示 errcode=310000？**
安全设置不符：用「加签」就核对 `NOTIFY_SECRET` 与 `SEC` 密钥一致；用「自定义关键词」就确认消息标题里包含该关键词（推荐直接用「战报」）。

**Steam 数据拉取失败？**
确认 Steam「游戏详情」隐私为公开、`STEAM_ID` 是 17 位 SteamID64、`STEAM_API_KEY` 有效。

**快照会丢吗？**
Artifact 保留 90 天，每天结算会持续产生新快照，正常运行不会丢。若长期停用后恢复，窗口会自动跨天合并补发，并在战报中注明。

想改结算/发送时间、一天发多次、改时区？见 **[高级配置 ADVANCED.md](ADVANCED.md)**。

## ⚠️ 隐私说明

- 所有密钥都保存在 GitHub Secrets，代码与日志中不会出现；
- 游戏数据快照保存在 Actions Artifact 中，不进入 Git 历史；
- 公开仓库中别人能看到的只有代码本身，看不到你的任何数据。

## License

[MIT](./LICENSE)
