import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DATA_DIR =
  process.env.DINGTALK_RADAR_DATA_DIR ||
  join(homedir(), '.dingtalk-radar');

const CONFIG_PATH = join(DATA_DIR, 'config.json');

export interface Config {
  myNicknames: string[];
  defaultRange: 'day' | 'week' | 'month' | 'quarter' | 'year';
  rescanConcurrency: number;
  privacyConfirmed: boolean;
  setupCompleted: boolean;
  demoMode: boolean;
  defaultSyncDays: number;
  trackedGroups: string[];
}

function envNames(): string[] {
  return (process.env.DINGTALK_RADAR_MY_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function envGroups(): string[] {
  return (process.env.DINGTALK_RADAR_GROUPS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

const DEFAULTS: Config = {
  myNicknames: envNames(),
  defaultRange: 'week',
  rescanConcurrency: 3,
  privacyConfirmed: false,
  setupCompleted: false,
  demoMode: process.env.DINGTALK_RADAR_DEMO === '1',
  defaultSyncDays: 7,
  trackedGroups: envGroups(),
};

export function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf-8');
    return DEFAULTS;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    const merged = { ...DEFAULTS, ...parsed };
    if (envNames().length > 0) merged.myNicknames = envNames();
    if (envGroups().length > 0) merged.trackedGroups = envGroups();
    if (process.env.DINGTALK_RADAR_DEMO === '1') merged.demoMode = true;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

export function writeConfig(patch: Partial<Config>): Config {
  const cur = readConfig();
  const merged = { ...cur, ...patch };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export function configStatus() {
  const cfg = readConfig();
  return {
    dataDir: DATA_DIR,
    configPath: CONFIG_PATH,
    configured:
      cfg.setupCompleted &&
      cfg.privacyConfirmed &&
      (cfg.demoMode || cfg.myNicknames.length > 0),
    config: cfg,
  };
}
