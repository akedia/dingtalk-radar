# Security

## Reporting

Please open a GitHub security advisory or a private issue if you find a vulnerability.

## Local data

The most sensitive asset is your local SQLite database. Keep it outside synced
folders and do not publish it. The default path is `~/.dingtalk-radar/radar.db`.

## DingTalk usage boundary

- This tool is intended for read-only intelligence over groups you legitimately
  participate in. Confirm your organization's policies before pointing it at
  corporate groups.
- Read what you need and nothing more — configure only the `openConversationId`
  values that match your use case.
- The app never sends, recalls, or reacts to messages, never modifies group
  membership, and never touches contacts or approvals. Do not extend it to do so
  without explicit authorization.
- `dws` rotates its credentials on its own schedule; re-authenticate when
  prompted, do not bypass it.

## Command execution

The app invokes `dws` via `child_process.execFile` with argument arrays. Do not
change this to shell string execution — every flag (`--group`, `--time`,
`--limit`, ...) is user-controlled in the broad sense (it ultimately comes from
the chatroom config file), and shell interpolation would re-introduce command
injection risk.
