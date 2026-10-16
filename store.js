// store.js — データ I/O 層。GitHub Contents API で private repo の CSV を読み書きする。
// Supabase 等に乗り換える場合はこのファイルだけ差し替える（load / save / getSettings の契約を守る）。

const SETTINGS_KEY = 'runlog.settings';
const QUEUE_KEY = 'runlog.queue';
const CACHE_KEY = 'runlog.cache';

export const HEADER = ['date', 'distance_km', 'speed_kmh', 'weight_kg'];

export class ConflictError extends Error {}

// ---------- settings ----------
export function getSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null; } catch { return null; }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ---------- CSV ----------
export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const r = {};
    header.forEach((h, i) => { r[h] = cols[i]?.trim() ?? ''; });
    return {
      date: r.date,
      distance_km: Number(r.distance_km),
      speed_kmh: Number(r.speed_kmh),
      weight_kg: Number(r.weight_kg),
    };
  }).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.distance_km));
}

export function toCSV(rows) {
  const body = rows.map(r => [r.date, r.distance_km, r.speed_kmh, r.weight_kg].join(','));
  return [HEADER.join(','), ...body].join('\n') + '\n';
}

// ---------- GitHub Contents API ----------
function api(s) {
  return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${s.path}`;
}
function headers(s) {
  return {
    Authorization: `Bearer ${s.pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
function b64decodeUTF8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function b64encodeUTF8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

/** @returns {Promise<{rows: object[], sha: string|null}>} */
export async function load() {
  const s = getSettings();
  if (!s?.pat) throw new Error('設定が未入力です');
  const res = await fetch(api(s), { headers: headers(s), cache: 'no-store' });
  if (res.status === 404) return { rows: [], sha: null };
  if (!res.ok) throw new Error(`読み込み失敗 (${res.status})`);
  const json = await res.json();
  if (json.encoding !== 'base64') throw new Error('1MB 超のファイルは未対応です');
  const rows = parseCSV(b64decodeUTF8(json.content));
  localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  return { rows, sha: json.sha };
}

/** 全行を書き戻す。sha が古ければ ConflictError。 */
export async function save(rows, sha) {
  const s = getSettings();
  const body = {
    message: `runlog: ${rows.length} rows`,
    content: b64encodeUTF8(toCSV(rows)),
  };
  if (sha) body.sha = sha;
  const res = await fetch(api(s), { method: 'PUT', headers: headers(s), body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 422) throw new ConflictError('競合');
  if (!res.ok) throw new Error(`書き込み失敗 (${res.status})`);
  const json = await res.json();
  localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  return json.content.sha;
}

/** 1行追記。競合時は最新を読み直して再試行（最大3回）。 */
export async function append(row) {
  for (let i = 0; i < 3; i++) {
    const { rows, sha } = await load();
    rows.push(row);
    rows.sort((a, b) => a.date.localeCompare(b.date));
    try {
      await save(rows, sha);
      return rows;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('競合が解消できませんでした');
}

// ---------- offline queue / cache ----------
export function getCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch { return []; }
}
export function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
export function enqueue(row) {
  const q = getQueue(); q.push(row);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}
/** キューを順に送信。成功した分は除去。最後に成功したときの全行を返す（なければ null）。 */
export async function flushQueue() {
  let q = getQueue();
  let rows = null;
  while (q.length) {
    rows = await append(q[0]);         // 失敗すれば throw、残りはキューに残る
    q = q.slice(1);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }
  return rows;
}
