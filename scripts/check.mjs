// Checks every configured monitor, appends the result to history and writes
// scripts/.results.json for the incident step.

import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { loadConfig, redact, statusMatches } from './lib/config.mjs';
import { appendResult } from './lib/history.mjs';

// Opens a TCP connection and times how long the handshake took. With a
// keyword set it also waits for the first chunk the server sends, which is
// how a banner protocol such as SMTP or SSH gets verified.
function tcpRequest(monitor) {
  const { hostname, port } = new URL(monitor.url);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = connect({ host: hostname, port: Number(port) });
    const elapsed = () => Math.round(performance.now() - started);
    const done = (fn, value) => {
      socket.destroy();
      fn(value);
    };

    socket.setTimeout(monitor.timeout);
    socket.once('timeout', () =>
      done(reject, Object.assign(new Error(`timeout after ${monitor.timeout}ms`), { timeout: true })),
    );
    socket.once('error', (error) => done(reject, error));
    socket.once('connect', () => {
      if (!monitor.keyword) done(resolve, { code: 0, ms: elapsed(), text: '' });
    });
    socket.once('data', (chunk) => done(resolve, { code: 0, ms: elapsed(), text: chunk.toString('utf8') }));
  });
}

async function httpRequest(monitor) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeout);
  const started = performance.now();
  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      headers: { 'user-agent': 'status-page-monitor', ...monitor.headers },
      body: monitor.body,
      redirect: monitor.followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    });
    const text = monitor.keyword ? await response.text() : '';
    return { code: response.status, ms: Math.round(performance.now() - started), text };
  } finally {
    clearTimeout(timer);
  }
}

const request = (monitor) => (monitor.type === 'tcp' ? tcpRequest(monitor) : httpRequest(monitor));

async function check(monitor) {
  let last;
  for (let attempt = 0; attempt <= monitor.retries; attempt += 1) {
    try {
      const { code, ms, text } = await request(monitor);
      if (monitor.type === 'http' && !statusMatches(code, monitor.expectedStatus)) {
        last = { status: 'down', code, ms, error: `unexpected status ${code}` };
      } else if (monitor.keyword && !text.includes(monitor.keyword)) {
        last = { status: 'down', code, ms, error: `keyword "${monitor.keyword}" not found` };
      } else if (monitor.degradedMs > 0 && ms > monitor.degradedMs) {
        last = { status: 'degraded', code, ms, error: `slower than ${monitor.degradedMs}ms` };
      } else {
        return { status: 'up', code, ms, error: null };
      }
    } catch (error) {
      const aborted = error.timeout || error.name === 'AbortError' || error.name === 'TimeoutError';
      last = {
        status: 'down',
        code: 0,
        ms: 0,
        error: aborted
          ? `timeout after ${monitor.timeout}ms`
          : String(error.cause?.message || error.message),
      };
    }
  }
  return last;
}

const { monitors } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
if (monitors.length === 0) {
  console.log('No MONITOR_* variables configured.');
}

const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const results = [];

// A private monitor never hands its URL on: results feed the incident issues
// and the published site, so this is the single place to strip it.
for (const monitor of monitors) {
  const outcome = await check(monitor);
  const result = {
    slug: monitor.slug,
    name: monitor.name,
    url: monitor.private ? monitor.link : monitor.url,
    timestamp,
    ...outcome,
    error: monitor.private ? redact(outcome.error, monitor.url) : outcome.error,
  };
  appendResult(monitor.slug, result);
  results.push(result);
  console.log(
    `${result.status.padEnd(8)} ${monitor.name} — ${result.code || '—'} in ${result.ms}ms` +
      (result.error ? ` (${result.error})` : ''),
  );
}

writeFileSync(new URL('.results.json', import.meta.url), JSON.stringify(results, null, 2));
