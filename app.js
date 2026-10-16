import * as store from './store.js';

// ---------- 派生値・集計（純粋関数。テスト容易・store 非依存） ----------
export const KCAL_PER_KG_KM = 1.0;          // ランニングの標準近似。傾斜ゼロ前提、±20% 程度の粗い推定
export const durationMin = r => r.speed_kmh > 0 ? (r.distance_km / r.speed_kmh) * 60 : 0;
export const kcal = r => KCAL_PER_KG_KM * r.weight_kg * r.distance_km;

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => new Date(s + 'T00:00:00');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** 月曜始まりの週の開始日 */
export function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** 期間の [from, to) を返す。全期間は null */
export function periodRange(period, today = new Date()) {
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  if (period === 'week')  { const f = weekStart(t); return [f, addDays(f, 7)]; }
  if (period === 'month') { const f = new Date(t.getFullYear(), t.getMonth(), 1); return [f, new Date(t.getFullYear(), t.getMonth() + 1, 1)]; }
  if (period === 'year')  { return [new Date(t.getFullYear(), 0, 1), new Date(t.getFullYear() + 1, 0, 1)]; }
  return null;
}

export function filterRows(rows, period, today = new Date()) {
  const tomorrow = ymd(addDays(today, 1));
  const valid = rows.filter(r => r.date < tomorrow);         // 未来日を弾く
  const range = periodRange(period, today);
  if (!range) return valid;
  const [f, t] = range.map(ymd);
  return valid.filter(r => r.date >= f && r.date < t);
}

/** 週1回以上走った週の連続数（今週または先週から遡る） */
export function weekStreak(rows, today = new Date()) {
  const weeks = new Set(rows.map(r => ymd(weekStart(parse(r.date)))));
  let cur = weekStart(today);
  if (!weeks.has(ymd(cur))) cur = addDays(cur, -7);          // 今週まだ走っていなくても先週からつなぐ
  let n = 0;
  while (weeks.has(ymd(cur))) { n++; cur = addDays(cur, -7); }
  return n;
}

/** 期間に応じたビン：週/月→日、年/総合→月 */
export function binDistance(rows, period) {
  const key = (period === 'week' || period === 'month') ? d => d : d => d.slice(0, 7);
  const m = new Map();
  for (const r of rows) m.set(key(r.date), (m.get(key(r.date)) || 0) + r.distance_km);
  const labels = [...m.keys()].sort();
  return { labels, values: labels.map(l => +m.get(l).toFixed(1)) };
}

/** 日ごとの体重（同日複数行は最終行）＋ 直近7日間の移動平均 */
export function weightSeries(allRows, fromDate) {
  const byDay = new Map();
  for (const r of allRows) if (r.weight_kg > 0) byDay.set(r.date, r.weight_kg);
  const days = [...byDay.keys()].sort();
  const pts = days.map(d => ({ x: d, y: byDay.get(d) }));
  const ma = days.map(d => {
    const lo = ymd(addDays(parse(d), -6));
    const w = days.filter(k => k >= lo && k <= d).map(k => byDay.get(k));
    return { x: d, y: +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2) };
  });
  const keep = p => !fromDate || p.x >= fromDate;
  return { points: pts.filter(keep), ma: ma.filter(keep) };
}

// ---------- UI ----------
const $ = id => document.getElementById(id);
const PERIOD_KEY = 'runlog.period';
let charts = {};
let allRows = [];

function setStatus(msg, cls = '') { const el = $('status'); el.textContent = msg; el.className = 'status ' + cls; }

function fmt(n, digits = 1) { return n.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits }); }

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function upsertChart(id, config) {
  if (charts[id]) { charts[id].data = config.data; charts[id].options = config.options; charts[id].update(); return; }
  charts[id] = new Chart($(id), config);
}

function baseOptions() {
  const muted = cssVar('--muted'), line = cssVar('--line');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: muted, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: line } },
      y: { ticks: { color: muted }, grid: { color: line } },
    },
  };
}

function render() {
  const period = localStorage.getItem(PERIOD_KEY) || 'week';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.p === period));

  const rows = filterRows(allRows, period);
  const dist = rows.reduce((a, r) => a + r.distance_km, 0);
  const cal = rows.reduce((a, r) => a + kcal(r), 0);
  const mins = rows.reduce((a, r) => a + durationMin(r), 0);

  $('k-dist').innerHTML = `${fmt(dist)}<small>km</small>`;
  $('k-kcal').innerHTML = `${fmt(cal, 0)}<small>kcal</small>`;
  $('k-count').innerHTML = `${rows.length}<small>回</small> ${Math.floor(mins / 60)}<small>h</small>${pad(Math.round(mins % 60))}<small>m</small>`;
  $('k-streak').innerHTML = `${weekStreak(filterRows(allRows, 'all'))}<small>週</small>`;

  const accent = cssVar('--accent'), accent2 = cssVar('--accent-2');
  const labelMap = { week: '距離（日別）', month: '距離（日別）', year: '距離（月別）', all: '距離（月別）' };
  $('h-dist').textContent = labelMap[period];

  const b = binDistance(rows, period);
  upsertChart('c-dist', {
    type: 'bar',
    data: { labels: b.labels.map(l => l.length === 10 ? l.slice(5) : l), datasets: [{ data: b.values, backgroundColor: accent, borderRadius: 4 }] },
    options: { ...baseOptions(), scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, beginAtZero: true } } },
  });

  const range = periodRange(period);
  const w = weightSeries(filterRows(allRows, 'all'), range ? ymd(range[0]) : null);
  upsertChart('c-weight', {
    type: 'line',
    data: {
      datasets: [
        { data: w.points, showLine: false, pointRadius: 3, backgroundColor: accent2 },
        { data: w.ma, pointRadius: 0, borderColor: accent, borderWidth: 2, tension: .3 },
      ],
    },
    options: { ...baseOptions(), parsing: { xAxisKey: 'x', yAxisKey: 'y' },
      scales: { ...baseOptions().scales, x: { ...baseOptions().scales.x, type: 'category' } } },
  });

  const sp = rows.map(r => ({ x: r.date, y: r.speed_kmh, r: 2 + Math.min(r.distance_km, 20) / 2 }));
  upsertChart('c-speed', {
    type: 'line',
    data: { datasets: [{ data: sp, borderColor: accent, borderWidth: 1.5, pointBackgroundColor: accent2,
      pointRadius: ctx => ctx.raw?.r ?? 3, tension: .2 }] },
    options: { ...baseOptions(), parsing: { xAxisKey: 'x', yAxisKey: 'y' },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw.y} km/h` } } },
      scales: { ...baseOptions().scales, x: { ...baseOptions().scales.x, type: 'category' } } },
  });

  const recent = [...allRows].sort((a, b2) => b2.date.localeCompare(a.date)).slice(0, 7);
  $('recent').innerHTML = `<tr><th>日付</th><th>km</th><th>km/h</th><th>分</th><th>kg</th><th>kcal</th></tr>` +
    recent.map(r => `<tr><td>${r.date}</td><td>${fmt(r.distance_km)}</td><td>${fmt(r.speed_kmh)}</td><td>${Math.round(durationMin(r))}</td><td>${fmt(r.weight_kg)}</td><td>${Math.round(kcal(r))}</td></tr>`).join('');

  // 入力フォームのデフォルト
  const f = $('entry');
  if (!f.date.value) f.date.value = ymd(new Date());
  const last = recent[0];
  if (!f.weight_kg.value && last) f.weight_kg.value = last.weight_kg;
}

async function reload() {
  try {
    setStatus('読み込み中…');
    const pending = store.getQueue();
    if (pending.length) {
      setStatus(`未送信 ${pending.length} 件を送信中…`);
      allRows = await store.flushQueue();
    } else {
      allRows = (await store.load()).rows;
    }
    setStatus('');
  } catch (e) {
    allRows = store.getCache();
    setStatus(`オフライン表示: ${e.message}`, 'err');
  }
  render();
}

function checkPatExpiry() {
  const s = store.getSettings();
  const el = $('warn');
  if (!s?.exp) { el.hidden = true; return; }
  const days = Math.ceil((parse(s.exp) - new Date()) / 86400000);
  el.hidden = days > 14;
  el.textContent = days <= 0 ? 'PAT が失効しています。設定から更新してください。' : `PAT の失効まで ${days} 日。再発行して設定を更新してください。`;
}

// ---------- events ----------
$('tabs').addEventListener('click', e => {
  const p = e.target.dataset.p; if (!p) return;
  localStorage.setItem(PERIOD_KEY, p); render();
});

$('entry').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const row = {
    date: f.date.value,
    distance_km: +(+f.distance_km.value).toFixed(2),
    speed_kmh: +(+f.speed_kmh.value).toFixed(2),
    weight_kg: +(+f.weight_kg.value).toFixed(1),
  };
  if (row.date > ymd(new Date())) { setStatus('未来の日付は記録できません', 'err'); return; }
  $('btn-save').disabled = true;
  try {
    setStatus('保存中…');
    allRows = await store.append(row);
    setStatus(`保存しました（${row.date} ${row.distance_km}km）`, 'ok');
    f.distance_km.value = ''; f.speed_kmh.value = '';
  } catch (err) {
    store.enqueue(row);
    allRows = [...allRows, row];
    setStatus(`オフラインのため端末に保存。次回起動時に送信します（${err.message}）`, 'err');
  } finally {
    $('btn-save').disabled = false;
    render();
  }
});

const dlg = $('dlg');
function openSettings() {
  const s = store.getSettings() || {};
  $('s-owner').value = s.owner || ''; $('s-repo').value = s.repo || 'runlog-data';
  $('s-path').value = s.path || 'runs.csv'; $('s-pat').value = s.pat || ''; $('s-exp').value = s.exp || '';
  dlg.showModal();
}
$('btn-settings').addEventListener('click', openSettings);
$('s-cancel').addEventListener('click', () => dlg.close());
$('s-save').addEventListener('click', async () => {
  store.saveSettings({
    owner: $('s-owner').value.trim(), repo: $('s-repo').value.trim(),
    path: $('s-path').value.trim(), pat: $('s-pat').value.trim(), exp: $('s-exp').value,
  });
  dlg.close(); checkPatExpiry(); await reload();
});

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('online', reload);
checkPatExpiry();
if (!store.getSettings()?.pat) { render(); openSettings(); } else { reload(); }
