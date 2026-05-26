# DingTalk Radar

> 钉钉群信号太多，重要的反而被淹没。
> DingTalk Radar turns noisy DingTalk group chats into a local-first intelligence dashboard.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**[中文](#中文) | [English](#english)**

---

<a name="中文"></a>

## 中文

DingTalk Radar 是 [wechat-radar](https://github.com/akedia/wechat-radar) 的钉钉移植，
依托 [`dws` CLI](https://docs.dingtalk.com/) 把钉钉群消息拉到本地 SQLite，
按天聚合成一个可工作的情报看板。

你得到的不是"聊天记录列表"，而是每天可以直接处理的情报：

- 今日优先看：消息、文章、工具、异动分区展示
- 话题雷达：用 Codex CLI 按天聚合跨群话题
- 链接情报：文章/工具资源去重，生成可读标题
- 群日报：每天活跃群可生成摘要报告，方便复制给 AI 继续处理
- 本地存储：聊天数据落到你自己的 SQLite，不上传到第三方服务
- 明暗主题：默认奶白色浅色主题，也支持深色模式

## 快速开始

```bash
git clone https://github.com/akedia/dingtalk-radar.git
cd dingtalk-radar
pnpm install
pnpm rebuild better-sqlite3
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次进入会跳到 `/setup`，按页面提示填写你的钉钉显示名 / userId、要追踪的群 openConversationId 列表、确认隐私说明；也可以先启用 demo 数据体验。

## 前置条件

- [ ] Node.js 20+：`node --version`
- [ ] pnpm：`corepack enable && pnpm --version`
- [ ] dws CLI 已安装并完成首次登录：`dws --version`
- [ ] 需要 PC 版 dws（v0.2.27 路由）：`dws chat message list ...` 仅 PC 版支持
- [ ] 想做话题聚合：本机能跑 `codex --version`

dws CLI 用于调用钉钉开放平台。`dws chat message list --group <openConversationId> --time "yyyy-MM-dd HH:mm:ss" --format json`
是 DingTalk Radar 拉取群消息的底层指令；首次使用前请按 dingtalk-workspace skill 的引导完成登录。

## 配置

默认数据目录是 `~/.dingtalk-radar/`，不会写进项目目录。

```bash
cp .env.example .env.local
```

常用配置：

```bash
DINGTALK_RADAR_DATA_DIR=~/.dingtalk-radar
# 你的钉钉显示名 / userId — 用于识别 @我的
DINGTALK_RADAR_MY_NAMES=张三,zhangsan,ding_userid_123
# 要追踪的群 openConversationId 列表（也可在 /setup 页面填）
DINGTALK_RADAR_GROUPS=cid_xxxx=,cid_yyyy=
DINGTALK_RADAR_DEMO=0
DINGTALK_RADAR_CODEX_MODEL=
# 自定义 dws 可执行路径（默认 PATH 上的 dws）
DINGTALK_RADAR_DWS_BIN=
```

也可以直接在 `/setup` 页面配置。配置会写入 `~/.dingtalk-radar/config.json`。

## 与 wechat-radar 的差异

| 维度 | wechat-radar | dingtalk-radar |
|------|--------------|----------------|
| 数据源 | `wx-cli` 读取本机微信 4.x DB | `dws chat message list`（PC 版） |
| 会话发现 | `wx sessions` 全量列表 | 钉钉无全量会话接口，需要手动配置要追踪的 openConversationId |
| 消息 ID | INTEGER `local_id` | TEXT `message_id`（msgUuid / openMsgId） |
| 图片消息 | 走本地缓存 `/api/wx-image` 代理 | 直接渲染消息体内 http(s) 图片 URL；mediaId 暂未代理 |
| 链接源 | `wechat_raw`（appmsg XML） | `dingtalk_card`（卡片消息 JSON） |
| @ 检测 | 显示昵称 `@<name>` | 显示名 / userId `@<name>` / `@<userId>` |

## 使用方式

1. 进入 `/setup`，填写自己的钉钉名 / userId 与群 openConversationId 列表。
2. 回首页，选择日期或时间范围。
3. 点击"重扫"同步当前范围消息。
4. 点击"全量同步"拉取更长历史。
5. 打开"话题雷达"查看跨群主题。
6. 打开"链接情报"查看文章和工具资源。
7. 在活跃群列表点击"日报"查看单群日报。

## 数据与隐私

DingTalk Radar 默认只在本机读写数据：

- `~/.dingtalk-radar/radar.db`：SQLite 主数据库
- `~/.dingtalk-radar/config.json`：本地配置
- `~/.dingtalk-radar/backups/`：可选备份

安全设计：

- dws CLI 调用走 `child_process.execFile` 参数数组，不拼 shell
- SQLite 使用 prepared statements
- 页面只以 React 文本节点渲染聊天内容
- 不把 dws 鉴权、数据库、模型缓存提交进仓库

重要风险提示：

- 钉钉是企业 IM。读取群消息前请自行确认符合公司规则、群成员预期、与所在地区相关法律。
- 不要把包含真实聊天内容的数据库或截图上传到公开仓库。
- 推荐先在自己的测试群验证 dws 拉取链路，再启用对正式群的追踪。

## 项目结构

```text
app/                 Next.js App Router 页面与 API
components/          看板、侧边栏、图表、消息渲染组件
lib/                 dws CLI 封装、SQLite、话题/链接聚合逻辑
scripts/             本地维护脚本
```

## 常见问题

| 问题 | 解决方法 |
| --- | --- |
| `dws: command not found` | 安装 dws CLI 并完成首次登录。 |
| `better-sqlite3` native 模块报错 | 运行 `pnpm rebuild better-sqlite3`。 |
| 首页没有数据 | 先完成 `/setup` 并配置至少一个 openConversationId，然后点击"重扫"。 |
| 话题雷达为空 | 打开对应日期会自动构建；也可以点击"构建话题"。需要本机可运行 `codex`。 |
| 不想读真实钉钉 | 在 `/setup` 勾选 demo 模式，或设置 `DINGTALK_RADAR_DEMO=1`。 |
| `dws chat message list` 报"权限不足" | 该接口仅 PC 路由可用；wrapper 会自动选；如果失败请确认 `dws --version` 输出包含 PC 版本。 |

## 致谢

- [akedia/wechat-radar](https://github.com/akedia/wechat-radar)：本项目直接基于其架构移植。
- [钉钉 dingtalk-workspace skill](https://docs.dingtalk.com/)：底层 dws CLI 来源。
- [Next.js](https://nextjs.org/)、[ECharts](https://echarts.apache.org/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)。

---

<a name="english"></a>

## English

DingTalk Radar is a local-first intelligence dashboard for DingTalk groups, ported
from [wechat-radar](https://github.com/akedia/wechat-radar). It pulls group messages
through the `dws` CLI into a local SQLite database, then surfaces daily briefings,
cross-group topics, link intelligence, mentions, and per-group reports.

### Features

- Daily dashboard for messages, links, tools, anomalies, and people
- Codex CLI powered topic clustering by date
- Link intelligence with generated titles and deduplication
- Per-group daily reports with copy-friendly output
- Local SQLite storage by default
- Light and dark themes

### Install

```bash
git clone https://github.com/akedia/dingtalk-radar.git
cd dingtalk-radar
pnpm install
pnpm rebuild better-sqlite3
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The first run redirects to
`/setup`, where you configure your DingTalk display names / userIds, the
openConversationId list of groups to track, and a privacy confirmation. Or enable
demo mode to explore the UI without DingTalk data.

### Requirements

- [ ] Node.js 20+
- [ ] pnpm
- [ ] `dws` CLI (PC routing) — required for `dws chat message list`
- [ ] Optional: Codex CLI for better topic / link summaries

### Privacy

By default, runtime data is stored locally under `~/.dingtalk-radar/`. The app does
not upload your chat database. You are responsible for using it in a way that
respects DingTalk rules, your organization's policies, group members' privacy, and
local laws.

### Differences vs. wechat-radar

| | wechat-radar | dingtalk-radar |
|--|--------------|----------------|
| Source | `wx-cli` reading local WeChat DB | `dws chat message list` (PC) |
| Session list | `wx sessions` full enumeration | Manually configured openConversationIds |
| Message id | INTEGER `local_id` | TEXT `message_id` (msgUuid / openMsgId) |
| Images | proxied via `/api/wx-image` from local cache | inline http(s) image URLs only (mediaId proxy is TODO) |
| Link source | `wechat_raw` (appmsg XML) | `dingtalk_card` (rich-card JSON) |

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `dws` is not on PATH | Install the dws CLI and finish first-time login. |
| `better-sqlite3` fails to load | Run `pnpm rebuild better-sqlite3`. |
| No dashboard data | Finish `/setup`, add at least one openConversationId, then click rescan. |
| Topic radar is empty | Open the date or click build topics; make sure `codex` is available. |
