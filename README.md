# 🎮 Steam 每日战报

每天定时拉取你的 Steam 游戏时长与成就，自动生成「今日战报」推送到群聊（飞书 / 钉钉 / 企业微信）。零服务器、零第三方依赖，Fork 即用。

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

## 🚀 部署（约 5 分钟）

### 1. Fork 本仓库

点击本页右上角 **Fork → Create fork**，在你的账号下得到一份自己的仓库，后续操作都在你 Fork 的仓库里进行。

### 2. 将 Steam「游戏详情」设为公开

1. 登录后打开 [Steam 隐私设置](https://steamcommunity.com/my/edit/settings)；
2. 在「我的个人资料隐私设置」中找到 **游戏详情**；
3. 改为 **公开**。

> 不公开的话程序拿不到任何数据，运行日志会报「GetOwnedGames 返回空游戏库」。

### 3. 获取 SteamID64 与 API Key

- **SteamID64**：打开 [steamid.io](https://steamid.io)，粘贴你的 Steam 主页链接（或搜昵称），复制结果里的 17 位数字（以 `7656119` 开头）；
- **API Key**：打开 <https://steamcommunity.com/dev/apikey>，登录后页面要求填一个域名，**随便填即可**，提交后会显示一串 32 位的 Key。

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
| `STEAM_ID` | 第 3 步获得的 17 位 SteamID64 |
| `NOTIFY_WEBHOOK` | 第 4 步获得的 Webhook 地址 |
| `NOTIFY_SECRET`（可选） | 飞书 = 签名校验密钥；钉钉 = 加签密钥；企业微信不填 |

### 6. 启用工作流并手动测试

1. 打开仓库的 **Actions** 页面，点击 **I understand my workflows, go ahead and enable them**（Fork 的仓库默认禁用定时任务）；
2. 左侧选择 **Daily Steam Report** → 右侧 **Run workflow → Run workflow**；
3. 等约 1 分钟，运行变绿（✓）后群里应收到「🎮 Steam 战报已初始化」卡片；
4. 部署完成。之后每天在配置的时刻自动发战报（默认 `22:00`）。

> 首次运行只建立基线，**不会**把整个游戏库当成「今日新增」；从第二天起收到差值战报。若运行变红，点进本次运行查看日志，报错信息会写明缺什么配置。

## 🔧 日常调整

所有调整都在仓库的 **Settings → Secrets and variables → Actions** 页完成，无需改代码。

**修改发送时间 / 一天发多次**
切到 **Variables** 标签 → New repository variable：Name 填 `REPORT_TIME`，Value 如 `22:00`（默认）或 `09:00,22:00`（一天两次，逗号分隔）。实际发送为到点后的第一次轮询，通常晚几分钟。

**更换通知平台**
把 Secret `NOTIFY_WEBHOOK` 的值换成新平台的 Webhook 地址（需要密钥的同步换 `NOTIFY_SECRET`），其他都不用动。

**修改时区**
Variables 中添加 `REPORT_TIMEZONE`（IANA 名称，如 `Asia/Tokyo`），默认 `Asia/Shanghai`。

**立即补发一份战报**
Actions → Daily Steam Report → Run workflow，**勾选 force** 再运行，会跳过「今日已发送」检查立即发送。

**重置所有数据**
到 Actions 的运行记录页，删除名为 `steam-report-state` 的 Artifact（或等它 90 天自动过期），下次运行会重新初始化基线。

**本地运行**

```bash
git clone https://github.com/gegegexuxu/SteamDailyReport.git
cd SteamDailyReport
cp .env.example .env   # 按注释填入你的配置
npm start              # 需要 Node.js >= 22.9
npm test               # 运行单元测试
```

## 🔩 工作原理（简述）

- Steam API 只提供累计时长，「今日数据」= 当前累计值 − 前一日快照累计值；
- GitHub 的 cron 读不了仓库变量，所以工作流每半小时轮询一次，由脚本按 `REPORT_TIME` 判断到点才发送；
- 同一天多次发送时，每次都与「前一天最后一次快照」比较，晚间战报包含全天数据；
- 快照保存在 Actions Artifact（90 天），不进 Git 仓库；发送失败下次轮询自动补发，同一天不会重复推送。

## ❓ 常见问题

**为什么首日没有战报？**
首次运行只建立基线（否则整个库会被当作"今日新增"），第二天起生成差值战报。

**手动运行为什么没有发送？**
手动运行与定时轮询共用同一判定：没有「已到点但今日未发」的时刻时跳过。想立即收到战报，勾选 `force` 运行。首次运行（无历史快照）不受此限制。

**提示飞书返回错误 code=19021 / 签名错误？**
`NOTIFY_SECRET` 与飞书机器人「签名校验」的密钥不一致，核对后更新 Secret。

**钉钉提示 errcode=310000？**
安全设置不符：用「加签」就核对 `NOTIFY_SECRET` 与 `SEC` 密钥一致；用「自定义关键词」就确认消息标题里包含该关键词（推荐直接用「战报」）。

**Steam 数据拉取失败？**
确认 Steam「游戏详情」隐私为公开、`STEAM_ID` 是 17 位 SteamID64、`STEAM_API_KEY` 有效。

**快照会丢吗？**
Artifact 保留 90 天，每天运行会持续产生新快照，正常运行不会丢。若长期停用后恢复，会自动重建基线并注明「与 M月d日 以来比较」。

## ⚠️ 隐私说明

- 所有密钥都保存在 GitHub Secrets，代码与日志中不会出现；
- 游戏数据快照保存在 Actions Artifact 中，不进入 Git 历史；
- 公开仓库中别人能看到的只有代码本身，看不到你的任何数据。

## License

[MIT](./LICENSE)
