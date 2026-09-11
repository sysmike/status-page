// History lives in two CSV files per monitor:
//   history/raw/<slug>.csv    every check of the last RAW_DAYS days
//   history/daily/<slug>.csv  one aggregated row per day, kept forever

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAW_DAYS = 7;
export const RAW_HEADER = 'timestamp,status,code,ms';
export const DAILY_HEADER = 'date,checks,up,degraded,down,avg,min,max';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function read(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .map((line) => line.split(','));
}

function write(file, header, rows) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${header}\n${rows.map((row) => row.join(',')).join('\n')}\n`);
}

export const rawPath = (slug) => join(ROOT, 'history', 'raw', `${slug}.csv`);
export const dailyPath = (slug) => join(ROOT, 'history', 'daily', `${slug}.csv`);

export function readRaw(slug) {
  return read(rawPath(slug)).map(([timestamp, status, code, ms]) => ({
    timestamp,
    status,
    code: Number(code),
    ms: Number(ms),
  }));
}

export function readDaily(slug) {
  return read(dailyPath(slug)).map(([date, checks, up, degraded, down, avg, min, max]) => ({
    date,
    checks: Number(checks),
    up: Number(up),
    degraded: Number(degraded),
    down: Number(down),
    avg: Number(avg),
    min: Number(min),
    max: Number(max),
  }));
}

export function appendResult(slug, result, now = new Date()) {
  const cutoff = new Date(now.getTime() - RAW_DAYS * 86400000).toISOString();
  const entries = readRaw(slug).filter((entry) => entry.timestamp >= cutoff);
  entries.push({
    timestamp: result.timestamp,
    status: result.status,
    code: result.code,
    ms: result.ms,
  });
  write(
    rawPath(slug),
    RAW_HEADER,
    entries.map((entry) => [entry.timestamp, entry.status, entry.code, entry.ms]),
  );

  const date = result.timestamp.slice(0, 10);
  const days = readDaily(slug);
  let day = days.find((entry) => entry.date === date);
  if (!day) {
    day = { date, checks: 0, up: 0, degraded: 0, down: 0, avg: 0, min: 0, max: 0 };
    days.push(day);
  }

  const measured = day.checks - day.down;
  const totalMs = day.avg * measured;
  day.checks += 1;
  day[result.status] += 1;
  if (result.status !== 'down' && result.ms > 0) {
    const count = measured + 1;
    day.avg = Math.round((totalMs + result.ms) / count);
    day.min = day.min === 0 ? result.ms : Math.min(day.min, result.ms);
    day.max = Math.max(day.max, result.ms);
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  write(
    dailyPath(slug),
    DAILY_HEADER,
    days.map((entry) => [
      entry.date,
      entry.checks,
      entry.up,
      entry.degraded,
      entry.down,
      entry.avg,
      entry.min,
      entry.max,
    ]),
  );
}
