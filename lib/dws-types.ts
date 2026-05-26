// Types that mirror what the dws CLI emits. Field names follow DingTalk's
// open-platform conventions; defensive callers handle minor alias variation.

export type ChatType = 'private' | 'group';

export interface DwsSession {
  chat: string;
  chat_type: ChatType;
  is_group: boolean;
  last_msg_type: string;
  last_sender: string;
  summary: string;
  time: string;
  timestamp: number;
  unread: number;
  username: string;
}

export interface DwsStatsBucket {
  hour: number;
  count: number;
}

export interface DwsStatsSender {
  sender: string;
  count: number;
}

export interface DwsStatsType {
  type: string;
  count: number;
}

export interface DwsStats {
  chat: string;
  chat_type: ChatType;
  is_group: boolean;
  username: string;
  total: number;
  by_hour: DwsStatsBucket[];
  by_type: DwsStatsType[];
  top_senders: DwsStatsSender[];
}

// DingTalk msg ids are opaque strings (msgUuid / openMsgId). Carry as TEXT.
export interface DwsMessage {
  message_id: string;
  sender: string;
  sender_id?: string;
  content: string;
  time: string;
  timestamp: number;
  type: string;
  // optional thread / topic linkage for DingTalk topic messages
  open_conv_thread_id?: string;
  // raw payload from dws for downstream renderers that want richer data
  raw?: unknown;
}

export interface DwsNewMessage extends DwsMessage {
  username: string;
  chat?: string;
}

export interface DwsMember {
  username: string;
  nickname?: string;
  display_name?: string;
}

export interface DwsDaemonStatus {
  running: boolean;
  pid?: number;
  uptime_seconds?: number;
  version?: string;
}

export interface DwsGroupSearchResult {
  open_conversation_id: string;
  name: string;
  owner?: string;
  member_count?: number;
}
