/* ui/views/dashboard.js — overview: stats, live speed chart, engine share,
   system health and the recent-activity feed. */

import { state, updateSettings } from '../../store.js';
import { aggregates, addText, activity } from '../../jobs.js';
import { detectUrl, engineLabel, kindFor } from '../../engine.js';
import { fmtBytes, fmtSpeed, fmtDuration, digits, timeAgo } from '../../format.js';
import { t } from '../../i18n.js';
import { esc, icon, statusPill, engineBadge } from '../dom.js';
import { toast } from '../overlays.js';
import { drawSparkline, drawDonut, drawBars } from '../../charts.js';
import { SAMPLES } from '../../sites.js';

const ENGINE_COLORS = { 'yt-dlp': '#10b981', 'gallery-dl': '#38bdf8', 'HTTP': '#f59e0b' };
const KIND_COLORS = { video: '#10b981', audio: '#a78bfa', image: '#38bdf8', file: '#f59e0b' };

let rootEl = null;

export const dashboardView = {
  id: 'dashboard',
  title: () => t('view.dashboard.title'),
  sub: () => t('view.dashboard.sub'),

  render() {
    const agg = aggregates();
    const s = state.settings;
    return `
    <div class="stack">
      <section class="hero">
        <img class="hero-img" src="assets/img/hero.svg" alt="" width="120" height="120">
        <div class="hero-body">
          <h2 data-i18n="dash.heroTitle"></h2>
          <p data-i18n="dash.heroText"></p>
          <div class="hero-actions">
            <a class="btn primary" href="#/queue">${icon('i-plus')} <span data-i18n="dash.newDownload"></span></a>
            <a class="btn ghost" href="#/sites">${icon('i-globe')} <span data-i18n="nav.sites"></span></a>
            <a class="btn ghost" href="https://github.com/devlopergit04/downloader-bot" target="_blank" rel="noopener">${icon('i-github')} <span data-i18n="nav.repo"></span></a>
          </div>
        </div>
      </section>

      <div class="grid cols-4">
        ${statCard('i-bolt', 'dash.stat.active', digits(agg.active), 'stActive', `#/queue`)}
        ${statCard('i-clock', 'dash.stat.queued', digits(agg.queued), 'stQueued', `${digits(agg.paused)} paused`)}
        ${statCard('i-check', 'dash.stat.done', digits(agg.completed), 'stDone', `${digits(state.stats.cancelled)} cancelled`)}
        ${statCard('i-alert', 'dash.stat.failed', digits(agg.failed), 'stFailed', `${digits(agg.cancelled)} cancelled`)}
      </div>

      <div class="grid cols-2">
        <section class="card">
          <div class="card-head"><h3>${icon('i-bolt')} <span data-i18n="dash.speedChart"></span></h3>
            <span class="spacer"></span>
            <span class="badge ok" id="dashSpeed">${esc(fmtSpeed(agg.speedBps))}</span>
          </div>
          <div class="card-pad"><div class="chart-box"><canvas class="chart" id="speedChart"></canvas></div>
            <div class="row" style="margin-top:8px;font-size:11.5px">
              <span class="muted">${esc(t('dash.stat.bytes'))}</span><b id="dashBytes">${esc(fmtBytes(state.stats.totalBytes))}</b>
              <span class="grow"></span>
              <span class="muted">${esc(t('dash.stat.avg'))}</span><b id="dashAvg">—</b>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('i-cpu')} <span data-i18n="dash.engineShare"></span></h3></div>
          <div class="card-pad">
            <div class="row" style="align-items:center;gap:18px">
              <div class="chart-box" style="height:150px;width:150px;flex:none"><canvas class="chart" id="engineDonut"></canvas></div>
              <div class="grow">
                <div class="chart-box" style="height:110px"><canvas class="chart" id="kindBars"></canvas></div>
                <div class="legend" id="engineLegend"></div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="grid cols-2">
        <section class="card">
          <div class="card-head"><h3>${icon('i-shield')} <span data-i18n="dash.health"></span></h3>
            <span class="spacer"></span>
            <button class="btn sm ghost" id="healthRefresh">${icon('i-retry')}</button>
          </div>
          <div class="card-pad" id="healthBody"></div>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('i-clock')} <span data-i18n="dash.activity"></span></h3>
            <span class="spacer"></span><span class="badge" id="actCount">${digits(state.activity.length)}</span>
          </div>
          <div class="activity" id="activityFeed"></div>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h3>${icon('i-link')} <span data-i18n="dash.quick"></span></h3></div>
        <div class="card-pad">
          <div class="row">
            <div class="input-group grow">
              <input class="input mono" id="dashUrl" placeholder="https://youtu.be/…" spellcheck="false" autocomplete="off">
              <button class="btn primary" id="dashAdd">${icon('i-download')}</button>
            </div>
            <select class="select" id="dashQuality" style="max-width:220px">
              ${['best', '1080', '720', 'audio', 'image'].map((q) => `<option value="${q}" ${q === s.quality ? 'selected' : ''}>${esc(t(`quality.${q}`))}</option>`).join('')}
            </select>
          </div>
          <div class="chips" style="margin-top:10px">
            ${SAMPLES.slice(0, 6).map((sm) => `<button class="chip" data-dash-sample="${esc(sm.url)}">${icon('i-link')}<span>${esc(sm.label)}</span></button>`).join('')}
          </div>
          <p class="muted" style="font-size:11.5px;margin-top:10px" id="dashRoute"></p>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon('i-queue')} <span data-i18n="nav.queue"></span></h3>
          <span class="spacer"></span><a class="btn sm ghost" href="#/queue">${esc(t('dash.openQueue'))} ${icon('i-chevron')}</a>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th data-i18n="ui.name"></th><th data-i18n="ui.status"></th><th data-i18n="ui.progress"></th><th data-i18n="ui.speedSize"></th>
        </tr></thead><tbody id="dashRows"></tbody></table></div>
      </section>
    </div>`;
  },

  mount(root) {
    rootEl = root;
    const input = root.querySelector('#dashUrl');
    const route = root.querySelector('#dashRoute');

    const quickAdd = () => {
      const url = detectUrl(input.value);
      if (!url) { toast('warn', t('queue.noUrl')); return; }
      const quality = root.querySelector('#dashQuality').value;
      updateSettings({ quality });
      const { added } = addText(url, { quality });
      if (added) {
        toast('ok', t('toast.added'), url);
        activity('added', { name: engineLabel(url).label, url });
      }
      input.value = '';
      route.textContent = '';
      location.hash = '#/queue';
    };

    root.querySelector('#dashAdd').addEventListener('click', quickAdd);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });
    input.addEventListener('input', () => {
      const url = detectUrl(input.value);
      route.textContent = url ? `${t('queue.routing')}: ${engineLabel(url).label} → ${t(`kind.${urlKind(url)}`)}` : '';
    });
    root.querySelectorAll('[data-dash-sample]').forEach((b) => b.addEventListener('click', () => {
      input.value = b.dataset.dashSample;
      input.dispatchEvent(new Event('input'));
      input.focus();
    }));
    root.querySelector('#healthRefresh').addEventListener('click', () => { paintHealth(); toast('info', t('dash.health')); });

    paintHealth();
    paintActivity();
    paintCharts();
    paintRows();
  },

  tick() {
    if (!rootEl) return;
    const agg = aggregates();
    setText('stActive', digits(agg.active));
    setText('stQueued', digits(agg.queued));
    setText('stDone', digits(agg.completed));
    setText('stFailed', digits(agg.failed));
    setText('dashSpeed', fmtSpeed(agg.speedBps));
    setText('dashBytes', fmtBytes(state.stats.totalBytes));
    setText('dashAvg', avgSpeed());
    setText('actCount', digits(state.activity.length));
    paintCharts();
    paintRows();
    paintActivityTimes();
  },

  unmount() { rootEl = null; },
};

/* ═══════════════ helpers ═══════════════ */
function urlKind(url) {
  return kindFor(url, state.settings.quality);
}

function setText(id, value) {
  const el = rootEl?.querySelector('#' + id);
  if (el && el.textContent !== value) el.textContent = value;
}

function statCard(ic, labelKey, value, id, sub) {
  return `<div class="card stat">
    <span class="k">${icon(ic)} <span data-i18n="${labelKey}"></span></span>
    <span class="v" id="${id}">${value}</span>
    <span class="s">${esc(sub)}</span>
  </div>`;
}

function avgSpeed() {
  const s = state.ui.speedSamples.filter((x) => x.bps > 0);
  if (!s.length) return '—';
  return fmtSpeed(s.reduce((a, b) => a + b.bps, 0) / s.length);
}

function paintCharts() {
  if (!rootEl) return;
  const agg = aggregates();
  const spark = rootEl.querySelector('#speedChart');
  if (spark) drawSparkline(spark, state.ui.speedSamples, { emptyText: '0 KiB/s' });

  const donut = rootEl.querySelector('#engineDonut');
  if (donut) {
    const slices = Object.entries(agg.byEngine).map(([k, v]) => ({ label: k, value: v, color: ENGINE_COLORS[k] || '#6ee7b7' }));
    drawDonut(donut, slices, { centerValue: digits(agg.total), centerLabel: 'jobs' });
  }
  const bars = rootEl.querySelector('#kindBars');
  if (bars) {
    drawBars(bars, Object.entries(agg.byKind).map(([k, v]) => ({ label: k, value: v, color: KIND_COLORS[k] || '#34d399' })), { labelW: 54 });
  }
  const legend = rootEl.querySelector('#engineLegend');
  if (legend) {
    legend.innerHTML = Object.entries(agg.byEngine).length
      ? Object.entries(agg.byEngine).map(([k, v]) => `<span><i style="background:${ENGINE_COLORS[k] || '#6ee7b7'}"></i>${esc(k)} · ${digits(v)}</span>`).join('')
      : `<span class="muted">${esc(t('dash.noActivity'))}</span>`;
  }
}

function healthRows() {
  const s = state.settings;
  const live = s.mode === 'live';
  const h = state.ui.health || {};
  const row = (label, ok, detail) => `<div class="row" style="padding:7px 0;border-bottom:1px solid rgba(6,78,59,.35)">
      <span class="badge ${ok === 'warn' ? 'warn' : ok ? 'ok' : 'err'}">${icon(ok === 'warn' ? 'i-alert' : ok ? 'i-check' : 'i-close')}</span>
      <b style="font-size:12.5px;flex:1">${esc(label)}</b>
      <span class="muted" style="font-size:11.5px">${esc(detail)}</span>
    </div>`;
  const out = [];
  out.push(row(t('dash.health.engines'), true, live ? (h.engines ? `yt-dlp ${h.engines.ytdlp || '?'} · gallery-dl ${h.engines.gallerydl || '?'}` : '…') : 'yt-dlp · gallery-dl · HTTP (simulated)'));
  out.push(row(t('dash.health.ffmpeg'), live ? Boolean(h.engines?.ffmpeg) : 'warn', live ? (h.engines?.ffmpeg || 'not found') : 'only on the backend host'));
  out.push(row(t('dash.health.backend'), live ? (state.ui.connOk ? true : false) : 'warn', live ? (s.apiUrl || '—') : t('conn.demo')));
  out.push(row(t('dash.health.telegram'), Boolean(s.telegramBotToken), s.telegramBotToken ? `token ••••${String(s.telegramBotToken).slice(-4)}` : 'TELEGRAM_BOT_TOKEN empty'));
  out.push(row(t('dash.health.disk'), true, `${s.downloadDir} · ${s.maxUploadMb > 0 ? `${s.maxUploadMb} MB ${t('tg.uploadLimit')}` : 'unlimited'}`));
  out.push(row(t('dash.stat.uptime'), true, fmtDuration((Date.now() - state.stats.startedAt) / 1000)));
  return out.join('');
}

function paintHealth() {
  const el = rootEl?.querySelector('#healthBody');
  if (el) el.innerHTML = healthRows();
}

function paintActivity() {
  const el = rootEl?.querySelector('#activityFeed');
  if (!el) return;
  if (!state.activity.length) {
    el.innerHTML = `<div class="empty" style="padding:26px">${icon('i-clock')}<p>${esc(t('dash.noActivity'))}</p></div>`;
    return;
  }
  const icons = { added: 'i-plus', done: 'i-check', error: 'i-alert', cancelled: 'i-stop', started: 'i-play' };
  el.innerHTML = state.activity.slice(0, 22).map((a) => `
    <div class="act">
      <span class="ico">${icon(icons[a.kind] || 'i-bolt')}</span>
      <span class="bd"><b>${esc(a.title)}</b><span class="mono">${esc((a.url || a.detail || '').slice(0, 62))}</span></span>
      <time data-ago="${a.ts}">${esc(timeAgo(a.ts))}</time>
    </div>`).join('');
}

function paintActivityTimes() {
  rootEl?.querySelectorAll('[data-ago]').forEach((el) => {
    const v = timeAgo(Number(el.dataset.ago));
    if (el.textContent !== v) el.textContent = v;
  });
}

function paintRows() {
  const body = rootEl?.querySelector('#dashRows');
  if (!body) return;
  const jobs = state.jobs.slice(0, 6);
  if (!jobs.length) {
    body.innerHTML = `<tr><td colspan="4"><div class="empty" style="padding:22px">${icon('i-queue')}<p>${esc(t('queue.empty.text'))}</p></div></td></tr>`;
    return;
  }
  body.innerHTML = jobs.map((j) => `<tr class="is-clickable" data-goto="${esc(j.id)}">
    <td><div class="job-name"><b>${esc(j.name)}</b><span>${esc(j.url)}</span></div></td>
    <td>${statusPill(j.status)} ${engineBadge(j.engine)}</td>
    <td><div class="job-prog"><span class="progress ${j.status === 'completed' ? 'done' : ''}"><i style="width:${j.progress}%"></i></span><span class="pct">${digits(Math.round(j.progress))}%</span></div></td>
    <td class="nowrap">${esc(j.status === 'downloading' ? fmtSpeed(j.speedBps) : fmtBytes(j.sizeBytes || j.totalBytes))}</td>
  </tr>`).join('');
  body.querySelectorAll('[data-goto]').forEach((tr) => tr.addEventListener('click', () => {
    state.ui.selectedJobId = tr.dataset.goto;
    location.hash = '#/queue';
    import('./queue.js').then(({ openJobDrawer }) => setTimeout(() => openJobDrawer(tr.dataset.goto), 120));
  }));
}
