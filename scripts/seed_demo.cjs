/* eslint-disable @typescript-eslint/no-require-imports */
const Database = require('better-sqlite3');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');

const dataDir = process.env.DINGTALK_RADAR_DATA_DIR || join(homedir(), '.dingtalk-radar');
const dbPath = join(dataDir, 'radar.db');
if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, emoji TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS daily_stats (chatroom_id TEXT NOT NULL, date TEXT NOT NULL, total INTEGER NOT NULL, top_senders TEXT NOT NULL, by_hour TEXT NOT NULL, refreshed_at INTEGER NOT NULL, PRIMARY KEY (chatroom_id, date));
CREATE TABLE IF NOT EXISTS messages (chatroom_id TEXT NOT NULL, message_id TEXT NOT NULL, sender TEXT NOT NULL, content TEXT NOT NULL, time TEXT NOT NULL, timestamp INTEGER NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (chatroom_id, message_id));
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
`);

const categories = [
  ['工程协作', '#6366f1', '💻'],
  ['产品讨论', '#06b6d4', '🎯'],
  ['运营增长', '#f59e0b', '📈'],
  ['AI 研究', '#a855f7', '🤖'],
  ['客户对接', '#10b981', '🤝'],
];
const now = Date.now();
const insertGroup = db.prepare('INSERT OR IGNORE INTO groups (name, color, emoji, sort_order, created_at) VALUES (?, ?, ?, ?, ?)');
categories.forEach((g, i) => insertGroup.run(g[0], g[1], g[2], i, now));

const groups = [
  ['cid_demo_eng_sprint', '工程冲刺周报'],
  ['cid_demo_product', '产品周会群'],
  ['cid_demo_growth', '增长 & 投放'],
  ['cid_demo_design', '设计协同'],
  ['cid_demo_ai_lab', 'AI 研究'],
];
const senders = ['Alex', 'Ming', 'Luna', 'Kai', 'River', 'Yuki', 'Chen'];
const contents = [
  '今天周会先聊一下下个迭代的目标，重点是把审批流自动化跑通。',
  '已经在 dingtalk-radar 里把上周的几个群打开监控，待会拉个日报看看哪些群信号最强。',
  '@你的钉钉名 这个话题你可能更熟，能不能帮忙把竞品的发布节奏整理成一张表？',
  '分享一个开源项目 https://github.com/example/agent-workflow 可以把多 Agent 编排可视化。',
  '这篇文章值得读：AI Agent 落地为什么卡在组织流程 https://example.com/agent-org',
  '下周有一个 AI 工具内测名额，想找 20 个真实团队试用，感兴趣可以报名。',
  '今天投放数据跑得不错，CPI 比上周降了 18%，详见钉钉文档：https://alidocs.dingtalk.com/i/example',
  '有没有人熟悉移动端 IM 上架流程？需要一个 checklist 准备审核材料。',
  '新版语音转文字工具体验不错 https://example.com/voice-note 支持批量导出 Markdown。',
  '今天最值得关注的是 AI 工具开始从个人效率走向团队工作流。',
];
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const insertMessage = db.prepare('INSERT OR IGNORE INTO messages (chatroom_id, message_id, sender, content, time, timestamp, type, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insertStats = db.prepare('INSERT INTO daily_stats (chatroom_id, date, total, top_senders, by_hour, refreshed_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chatroom_id, date) DO UPDATE SET total = excluded.total, top_senders = excluded.top_senders, by_hour = excluded.by_hour, refreshed_at = excluded.refreshed_at');

db.transaction(() => {
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const d = new Date(); d.setDate(d.getDate() - dayOffset);
    const date = ymd(d);
    for (let gi = 0; gi < groups.length; gi++) {
      const [chatroomId] = groups[gi];
      const count = Math.max(8, 42 - dayOffset * 2 + gi * 5);
      const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour >= 9 && hour <= 23 ? Math.floor(count / 15) + ((hour + gi) % 3) : 0 }));
      const topSenders = senders.slice(0, 3).map((sender, index) => ({ sender, count: Math.max(1, Math.floor(count / (index + 2))) }));
      insertStats.run(chatroomId, date, count, JSON.stringify(topSenders), JSON.stringify(byHour), Date.now());
      for (let i = 0; i < Math.min(count, 18); i++) {
        const messageId = `demo_${dayOffset}_${gi}_${i + 1}`;
        const hour = 9 + ((i + gi) % 12);
        const minute = (i * 7) % 60;
        const time = `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
        insertMessage.run(chatroomId, messageId, senders[(i + gi) % senders.length], contents[(i + gi + dayOffset) % contents.length], time, Math.floor(new Date(time).getTime() / 1000), 'text', date);
      }
    }
  }
})();

writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ myNicknames: ['你的钉钉名'], trackedGroups: groups.map((g) => g[0]), defaultRange: 'week', rescanConcurrency: 3, privacyConfirmed: true, setupCompleted: true, demoMode: true, defaultSyncDays: 7 }, null, 2));
console.log(`Seeded demo data at ${dbPath}`);
