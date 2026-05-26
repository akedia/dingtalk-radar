# Privacy

DingTalk Radar is designed as a local-first tool.

- Chat data is stored in a local SQLite database under `~/.dingtalk-radar` by default.
- The app does not upload chat records to a hosted service.
- The app reads data through your local `dws` CLI installation, which itself talks
  to the DingTalk open platform on your behalf.
- Do not commit `*.db`, `.env.local`, logs, or generated runtime data.
- If you enable optional LLM/Codex workflows, review what data those tools receive
  before using them.

You are responsible for complying with local law, DingTalk platform terms, your
organization's policies, and group members' expectations before reading, storing,
or processing chat data.

## DingTalk account safety

- Use a personal or test account that you control. Avoid using a corporate
  admin account whose access scope may be wider than you intend.
- Only read what you need. Configure the smallest set of `openConversationId`
  values that satisfy your use case.
- This tool is read-only by design — it never sends, recalls, or reacts to
  messages. Do not modify it to do so without explicit authorization.
- Do not upload databases, screenshots, or exports containing real chat content
  to public repositories.
- `dws` may prompt for re-authentication periodically. Treat those prompts as
  you would treat any other DingTalk login flow.
