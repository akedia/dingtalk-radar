import { db } from './db';
import { writeConfig } from './config';

const GROUPS = [
  { id: 'cid_demo_eng_sprint', name: '工程冲刺周报' },
  { id: 'cid_demo_product', name: '产品周会群' },
  { id: 'cid_demo_growth', name: '增长 & 投放' },
  { id: 'cid_demo_design', name: '设计协同' },
  { id: 'cid_demo_ai_lab', name: 'AI 研究' },
];

const SENDERS = ['Alex', 'Ming', 'Luna', 'Kai', 'River', 'Yuki', 'Chen'];
const CONTENTS = [
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

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function seedDemoData() {
  const database = db();
  const now = new Date();
  const insertMessage = database.prepare(`
    INSERT OR IGNORE INTO messages
      (chatroom_id, message_id, sender, content, time, timestamp, type, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStats = database.prepare(`
    INSERT INTO daily_stats (chatroom_id, date, total, top_senders, by_hour, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chatroom_id, date) DO UPDATE SET
      total = excluded.total,
      top_senders = excluded.top_senders,
      by_hour = excluded.by_hour,
      refreshed_at = excluded.refreshed_at
  `);

  database.transaction(() => {
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const d = new Date(now);
      d.setDate(now.getDate() - dayOffset);
      const date = ymd(d);
      for (let gi = 0; gi < GROUPS.length; gi++) {
        const group = GROUPS[gi];
        const count = Math.max(8, 42 - dayOffset * 2 + gi * 5);
        const byHour = Array.from({ length: 24 }, (_, hour) => ({
          hour,
          count: hour >= 9 && hour <= 23 ? Math.floor(count / 15) + ((hour + gi) % 3) : 0,
        }));
        const topSenders = SENDERS.slice(0, 3).map((sender, index) => ({
          sender,
          count: Math.max(1, Math.floor(count / (index + 2))),
        }));
        insertStats.run(group.id, date, count, JSON.stringify(topSenders), JSON.stringify(byHour), Date.now());
        for (let i = 0; i < Math.min(count, 18); i++) {
          // message_id is now TEXT — synthesize a stable id from the offsets.
          const messageId = `demo_${dayOffset}_${gi}_${i + 1}`;
          const hour = 9 + ((i + gi) % 12);
          const minute = (i * 7) % 60;
          const time = `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
          const timestamp = Math.floor(new Date(time).getTime() / 1000);
          insertMessage.run(
            group.id,
            messageId,
            SENDERS[(i + gi) % SENDERS.length],
            CONTENTS[(i + gi + dayOffset) % CONTENTS.length],
            time,
            timestamp,
            'text',
            date,
          );
        }
      }
    }
  })();

  writeConfig({
    demoMode: true,
    setupCompleted: true,
    privacyConfirmed: true,
    myNicknames: ['你的钉钉名'],
    trackedGroups: GROUPS.map((g) => g.id),
  });

  return { groups: GROUPS.length, days: 14 };
}
