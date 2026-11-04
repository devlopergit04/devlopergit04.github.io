/* ui/views/queue.js — the download queue: input, routing preview, job table,
   incremental row updates and the job detail drawer. */

import { state, updateSettings } from '../../store.js';
import {
  addText, addLive, aggregates, cancel, clearFinished, cancelAll, pause, pauseAll, resume,
  retry, remove, startAll, getJob, FINISHED, notify,
} from '../../jobs.js';
import { detectUrls, engineLabel, kindFor, qualityById, QUALITIES, optionsFor, KIND_ICON } from '../../engine.js';
import { SAMPLES } from '../../sites.js';
import { fmtBytes, fmtSpeed, fmtDuration, fmtEta, fmtDateTime, digits, timeAgo } from '../../format.js';
import { t } from '../../i18n.js';
import { esc, icon, statusPill, engineBadge, kindBadge, on } from '../dom.js';
import { openDrawer, closeDrawer, openModal, closeModal, toast, confirmDialog, codeModal } from '../overlays.js';
import { sharedClient } from '../../api.js';
import * as L from '../../logs.js';

const rowRefs = new Map();
let mounted = false;
let rootEl = null;

export const queueView = {
  id: 'queue',
  title: () => t('view.queue.title'),
  sub: () => t('view.queue.sub'),

  render() {
    const s = state.settings;
    return `
    <div class="stack">
      <section class="card" id="addCard">
        <div class="card-head">
          <h3>${icon('i-link')} <span data-i18n="dash.quick"></span></h3>
          <span class="spacer"></span>
          <label class="switch" title="${esc(t('queue.autoStart'))}">
            <input type="checkbox" id="autoStart" ${s.autoStart ? 'checked' : ''}>
            <span class="track"></span><span data-i18n="queue.autoStart"></span>
          </label>
        </div>
        <div class="card-pad addbox">
          <div class="ta-row">
            <textarea id="urlInput" class="textarea mono" rows="3" data-i18n-ph="queue.inputPh" spellcheck="false"></textarea>
            <div class="stack" style="gap:8px;flex:none">
              <button class="btn primary" id="addBtn">${icon('i-plus')} <span data-i18n="queue.add"></span></button>
              <button class="btn ghost sm" id="sampleBtn">${icon('i-bolt')} <span data-i18n="queue.samples"></span></button>
            </div>
          </div>
          <div class="detect-line" id="detectLine"><span class="muted" data-i18n="queue.routing"></span></div>
          <div class="row">
            <label class="field" style="flex:0 0 auto">
              <label for="qualitySel" data-i18n="queue.quality"></label>
              <select class="select" id="qualitySel">
                ${QUALITIES.map((q) => `<option value="${q.id}" ${q.id === s.quality ? 'selected' : ''}>${esc(t(`quality.${q.id}`))}</option>`).join('')}
              </select>
            </label>
            <label class="field" style="flex:0 0 auto">
              <label for="concSel" data-i18n="queue.concurrency"></label>
              <select class="select" id="concSel">
                ${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option value="${n}" ${n === Number(s.concurrency) ? 'selected' : ''}>${digits(n)}</option>`).join('')}
              </select>
            </label>
            <span class="grow"></span>
            <span class="tag mono" id="fmtPreview"></span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3>${icon('i-queue')} <span data-i18n="nav.queue"></span></h3>
          <span class="badge" id="jobCount">0</span>
          <span class="spacer"></span>
          <button class="btn sm ghost" data-q="startAll">${icon('i-play')} <span data-i18n="ui.startAll"></span></button>
          <button class="btn sm ghost" data-q="pauseAll">${icon('i-pause')} <span data-i18n="ui.pauseAll"></span></button>
          <button class="btn sm ghost" data-q="clearDone">${icon('i-check')} <span data-i18n="ui.clearDone"></span></button>
          <button class="btn sm danger" data-q="cancelAll">${icon('i-stop')} <span data-i18n="ui.cancelAll"></span></button>
        </div>

        <div class="table-wrap" id="tableWrap">
          <table class="tbl" id="jobTable">
            <thead><tr>
              <th data-i18n="ui.name"></th>
              <th data-i18n="ui.status"></th>
              <th data-i18n="ui.progress"></th>
              <th data-i18n="ui.speedSize"></th>
              <th style="text-align:end" data-i18n="ui.actions"></th>
            </tr></thead>
            <tbody id="jobBody"></tbody>
          </table>
        </div>

        <div class="empty" id="queueEmpty" hidden>
          ${icon('i-cloud')}
          <h4 data-i18n="queue.empty.title"></h4>
          <p data-i18n="queue.empty.text"></p>
          <div class="chips" id="emptySamples"></div>
        </div>

        <div class="overall">
          <b data-i18n="queue.overall"></b>
          <span class="progress" id="overallBar"><i style="width:0%"></i></span>
          <b id="overallPct">0%</b>
          <span class="muted nowrap" id="overallMeta"></span>
        </div>
      </section>
    </div>`;
  },

  mount(root) {
    rootEl = root;
    mounted = true;
    rowRefs.clear();

    const input = root.querySelector('#urlInput');
    const detect = root.querySelector('#detectLine');

    /* ── input → live routing preview ── */
    let deb = null;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => paintDetect(detect, input.value), 180);
    });
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doAdd(); }
    });
    input.addEventListener('paste', () => setTimeout(() => paintDetect(detect, input.value), 30));

    root.querySelector('#addBtn').addEventListener('click', doAdd);
    root.querySelector('#sampleBtn').addEventListener('click', () => openSamples());
    root.querySelector('#autoStart').addEventListener('change', (e) => updateSettings({ autoStart: e.target.checked }));
    root.querySelector('#qualitySel').addEventListener('change', (e) => {
      updateSettings({ quality: e.target.value });
      paintFormatPreview();
    });
    root.querySelector('#concSel').addEventListener('change', (e) => updateSettings({ concurrency: Number(e.target.value) }));

    /* ── table actions ── */
    on(root, '[data-q]', 'click', (_e, el) => {
      const a = el.dataset.q;
      if (a === 'startAll') startAll();
      if (a === 'pauseAll') pauseAll();
      if (a === 'cancelAll') cancelAll();
      if (a === 'clearDone') { clearFinished(); toast('ok', t('ui.clearDone')); }
    });

    on(root, '[data-job-action]', 'click', async (e, el) => {
      e.stopPropagation();
      const id = el.closest('tr')?.dataset.id;
      const job = getJob(id);
      if (!job) return;
      switch (el.dataset.jobAction) {
        case 'pause': pause(id); break;
        case 'resume': resume(id); break;
        case 'cancel': cancel(id); break;
        case 'retry': retry(id); break;
        case 'details': openJobDrawer(id); break;
        case 'open': openPath(job); break;
        case 'copy': {
          const { copyText } = await import('../../exporters.js');
          if (await copyText(job.url)) toast('ok', t('ui.copied'), job.url);
          break;
        }
        case 'remove': {
          if (FINISHED.includes(job.status) || await confirmDialog(t('queue.removeConfirm'), { danger: true, okLabel: t('ui.remove') })) {
            remove(id);
            toast('info', t('toast.removed'), job.name);
          }
          break;
        }
        default: break;
      }
    });

    on(root, 'tr[data-id]', 'click', (_e, tr) => {
      state.ui.selectedJobId = tr.dataset.id;
      root.querySelectorAll('tr[data-id]').forEach((r) => r.classList.toggle('is-selected', r.dataset.id === tr.dataset.id));
      openJobDrawer(tr.dataset.id);
    });

    /* ── drag & drop a .txt of links ── */
    const card = root.querySelector('#addCard');
    ['dragenter', 'dragover'].forEach((ev) => card.addEventListener(ev, (e) => { e.preventDefault(); card.style.borderColor = 'var(--primary)'; }));
    ['dragleave', 'drop'].forEach((ev) => card.addEventListener(ev, (e) => { e.preventDefault(); card.style.borderColor = ''; }));
    card.addEventListener('drop', async (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      const text = e.dataTransfer?.getData('text/plain') || '';
      let buf = text;
      for (const f of files.slice(0, 5)) {
        if (f.size < 2 * 1024 * 1024) buf += '\n' + await f.text();
      }
      if (buf.trim()) { input.value = buf.trim(); paintDetect(detect, input.value); doAdd(); }
    });

    /* ── empty-state samples ── */
    const es = root.querySelector('#emptySamples');
    es.innerHTML = SAMPLES.map((s) => `<button class="chip" data-sample="${esc(s.url)}">${icon('i-link')}<span>${esc(s.label)}</span></button>`).join('');
    on(es, '[data-sample]', 'click', (_e, el) => {
      input.value = el.dataset.sample;
      paintDetect(detect, input.value);
      input.focus();
    });

    paintFormatPreview();
    syncRows();
    paintOverall();
  },

  tick() { if (mounted) { syncRows(); paintOverall(); } },

  unmount() { mounted = false; rootEl = null; rowRefs.clear(); },
};

/* ═══════════════ helpers ═══════════════ */

function doAdd() {
  const input = rootEl?.querySelector('#urlInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const urls = detectUrls(text);
  if (!urls.length) {
    toast('warn', t('queue.noUrl'), text.slice(0, 80));
    return;
  }
  if (state.settings.mode === 'live') {
    urls.forEach((u) => addLive(u, state.settings.quality));
  } else {
    const { added, dups } = addText(text, { quality: state.settings.quality });
    toast('ok', t('queue.added', { n: digits(added) }), dups ? t('queue.dup') : '');
  }
  input.value = '';
  paintDetect(rootEl.querySelector('#detectLine'), '');
  input.focus();
}

function openSamples() {
  const body = `<div class="chips" style="gap:8px">
    ${SAMPLES.map((s) => `<button class="chip" data-s="${esc(s.url)}" style="padding:8px 12px">${icon('i-link')}<span>${esc(s.label)}</span><em class="mono" style="font-style:normal;font-size:10.5px;opacity:.7">${esc(s.url.replace(/^https?:\/\//, '').slice(0, 38))}</em></button>`).join('')}
  </div>`;
  const root = openModal({
    title: t('queue.samples'),
    body,
    foot: `<button class="btn ghost" data-close-modal>${esc(t('ui.close'))}</button>`,
  });
  root.onclick = (e) => {
    if (e.target.closest('[data-close-modal]')) { closeModal(); root.onclick = null; return; }
    const chip = e.target.closest('[data-s]');
    if (chip) {
      const input = rootEl?.querySelector('#urlInput');
      if (input) {
        input.value = input.value.trim() ? `${input.value.trim()}\n${chip.dataset.s}` : chip.dataset.s;
        paintDetect(rootEl.querySelector('#detectLine'), input.value);
      }
      closeModal();
      root.onclick = null;
    }
  };
}

function paintFormatPreview() {
  const el = rootEl?.querySelector('#fmtPreview');
  if (!el) return;
  el.textContent = `format = ${qualityById(state.settings.quality).fmt}`;
  el.title = t('queue.opts');
}

function paintDetect(container, text) {
  if (!container) return;
  const urls = detectUrls(text || '');
  if (!urls.length) {
    container.innerHTML = `<span class="muted">${esc(t('queue.routing'))}</span>`;
    return;
  }
  container.innerHTML = `<span class="muted">${esc(t('queue.detected'))} ${digits(urls.length)}:</span>` + urls.slice(0, 8).map((u) => {
    const eng = engineLabel(u);
    const kind = kindFor(u, state.settings.quality);
    return `<span class="chip">${icon(eng.icon)}<b>${esc(eng.label)}</b>${icon(KIND_ICON[kind])}<span class="u">${esc(u.length > 46 ? u.slice(0, 46) + '…' : u)}</span></span>`;
  }).join('') + (urls.length > 8 ? `<span class="badge">+${digits(urls.length - 8)}</span>` : '');
}

function rowHtml(job) {
  const act = FINISHED.includes(job.status);
  const busy = job.status === 'downloading' || job.status === 'processing';
  return `
  <tr data-id="${esc(job.id)}" class="is-clickable">
    <td>
      <div class="job-name">
        <b title="${esc(job.name)}">${icon(KIND_ICON[job.kind] || 'i-file')} ${esc(job.name)}</b>
        <span title="${esc(job.url)}">${esc(job.url)}</span>
        <div class="row" style="gap:6px;margin-top:3px">${engineBadge(job.engine)}${kindBadge(job.kind)}${job.real ? `<span class="badge violet">${icon('i-globe')}browser</span>` : ''}${job.attempts > 1 ? `<span class="badge">×${digits(job.attempts)}</span>` : ''}</div>
      </div>
    </td>
    <td data-cell="status">${statusPill(job.status)}${job.error ? `<div class="muted" style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${esc(job.error)}">${esc(job.error)}</div>` : ''}</td>
    <td data-cell="progress">
      <div class="job-prog">
        <span class="progress ${act ? 'done' : ''}" data-bar><i style="width:${job.progress.toFixed(1)}%"></i></span>
        <span class="pct" data-pct>${digits(Math.round(job.progress))}%</span>
      </div>
    </td>
    <td data-cell="speed" class="nowrap">
      <div style="font-variant-numeric:tabular-nums;font-weight:700">${busy ? esc(fmtSpeed(job.speedBps)) : (job.sizeBytes ? esc(fmtBytes(job.sizeBytes)) : '—')}</div>
      <div class="muted" style="font-size:11px" data-sub>${busy ? `${esc(fmtBytes(job.doneBytes))} / ${esc(fmtBytes(job.totalBytes))} · ${esc(fmtEta(job.etaSec))}` : (job.finishedAt ? esc(timeAgo(job.finishedAt)) : esc(fmtBytes(job.totalBytes)))}</div>
    </td>
    <td>
      <div class="job-acts">
        ${busy
          ? `<button class="btn icon ghost" data-job-action="pause" title="${esc(t('ui.pause'))}">${icon('i-pause')}</button>`
          : (job.status === 'paused' || job.status === 'queued'
            ? `<button class="btn icon ghost" data-job-action="resume" title="${esc(t('ui.resume'))}">${icon('i-play')}</button>`
            : (job.status === 'error' || job.status === 'cancelled'
              ? `<button class="btn icon ghost" data-job-action="retry" title="${esc(t('ui.retry'))}">${icon('i-retry')}</button>` : ''))}
        ${job.status === 'completed' ? `<button class="btn icon ghost" data-job-action="open" title="${esc(t('ui.download'))}">${icon('i-download')}</button>` : ''}
        ${!act ? `<button class="btn icon ghost" data-job-action="cancel" title="${esc(t('ui.cancel'))}">${icon('i-stop')}</button>` : ''}
        <button class="btn icon ghost" data-job-action="details" title="${esc(t('ui.details'))}">${icon('i-chevron')}</button>
        <button class="btn icon danger" data-job-action="remove" title="${esc(t('ui.remove'))}">${icon('i-trash')}</button>
      </div>
    </td>
  </tr>`;
}

/** Incremental sync — only touch the DOM where something changed. */
export function syncRows() {
  if (!mounted || !rootEl) return;
  const body = rootEl.querySelector('#jobBody');
  const empty = rootEl.querySelector('#queueEmpty');
  const wrap = rootEl.querySelector('#tableWrap');
  if (!body) return;

  const jobs = state.jobs;
  const ids = new Set(jobs.map((j) => j.id));

  // drop rows whose job is gone
  for (const [id, ref] of [...rowRefs]) {
    if (!ids.has(id)) { ref.tr.remove(); rowRefs.delete(id); }
  }

  // insert / reorder
  let prev = null;
  for (const job of jobs) {
    let ref = rowRefs.get(job.id);
    if (!ref) {
      const tpl = document.createElement('template');
      tpl.innerHTML = rowHtml(job).trim();
      const tr = tpl.content.firstElementChild;
      body.appendChild(tr);
      ref = {
        tr,
        bar: tr.querySelector('[data-bar] i'),
        barWrap: tr.querySelector('[data-bar]'),
        pct: tr.querySelector('[data-pct]'),
        speed: tr.querySelector('[data-cell="speed"]'),
        status: tr.querySelector('[data-cell="status"]'),
        lastStatus: job.status,
        lastPct: -1,
        lastSpeed: -1,
      };
      rowRefs.set(job.id, ref);
    }
    // keep DOM order equal to state order
    const expected = prev ? prev.nextSibling : body.firstElementChild;
    if (ref.tr !== expected) body.insertBefore(ref.tr, expected);
    prev = ref.tr;

    // dynamic cells
    const p = Math.round(job.progress * 10) / 10;
    if (p !== ref.lastPct) {
      ref.lastPct = p;
      ref.bar.style.width = `${p}%`;
      ref.pct.textContent = `${digits(Math.round(p))}%`;
    }
    const busy = job.status === 'downloading' || job.status === 'processing';
    const speedKey = busy ? Math.round(job.speedBps / 1024) : -2;
    if (speedKey !== ref.lastSpeed) {
      ref.lastSpeed = speedKey;
      const sub = ref.speed.querySelector('[data-sub]');
      if (busy) {
        ref.speed.firstElementChild.textContent = fmtSpeed(job.speedBps);
        if (sub) sub.textContent = `${fmtBytes(job.doneBytes)} / ${fmtBytes(job.totalBytes)} · ${fmtEta(job.etaSec)}`;
      } else {
        ref.speed.firstElementChild.textContent = job.sizeBytes ? fmtBytes(job.sizeBytes) : '—';
        if (sub) sub.textContent = job.finishedAt ? timeAgo(job.finishedAt) : fmtBytes(job.totalBytes);
      }
    }
    if (job.status !== ref.lastStatus) {
      ref.lastStatus = job.status;
      ref.lastPct = -1; ref.lastSpeed = -1;
      const tpl = document.createElement('template');
      tpl.innerHTML = rowHtml(job).trim();
      ref.tr.replaceWith(tpl.content.firstElementChild);
      const tr = body.querySelector(`tr[data-id="${CSS.escape(job.id)}"]`);
      rowRefs.set(job.id, {
        tr,
        bar: tr.querySelector('[data-bar] i'),
        barWrap: tr.querySelector('[data-bar]'),
        pct: tr.querySelector('[data-pct]'),
        speed: tr.querySelector('[data-cell="speed"]'),
        status: tr.querySelector('[data-cell="status"]'),
        lastStatus: job.status,
        lastPct: Math.round(job.progress * 10) / 10,
        lastSpeed: -1,
      });
      if (state.ui.selectedJobId === job.id) tr.classList.add('is-selected');
    }
  }

  const hasJobs = jobs.length > 0;
  empty.hidden = hasJobs;
  wrap.classList.toggle('hidden', !hasJobs);
  const count = rootEl.querySelector('#jobCount');
  if (count) {
    const agg = aggregates();
    count.textContent = `${digits(agg.total)} · ${digits(agg.active)} ${t('status.downloading')}`;
  }
}

function paintOverall() {
  if (!mounted || !rootEl) return;
  const agg = aggregates();
  const bar = rootEl.querySelector('#overallBar i');
  const pctEl = rootEl.querySelector('#overallPct');
  const meta = rootEl.querySelector('#overallMeta');
  if (bar) bar.style.width = `${agg.overallPercent.toFixed(1)}%`;
  if (pctEl) pctEl.textContent = `${digits(Math.round(agg.overallPercent))}%`;
  if (meta) {
    meta.textContent = agg.active
      ? `${fmtSpeed(agg.speedBps)} · ${fmtBytes(agg.doneBytes)} / ${fmtBytes(agg.totalBytes)} · ETA ${fmtEta(agg.etaSec)}`
      : `${fmtBytes(state.stats.totalBytes)} ${t('dash.stat.bytes')}`;
  }
}

/* ── detail drawer ─────────────────────────────────────────────────────── */
export function openJobDrawer(id) {
  const job = getJob(id);
  if (!job) return;
  state.ui.selectedJobId = id;
  const meta = job.meta || {};
  const { engine, options } = optionsFor(job.url, state.settings, job.quality);
  const logs = state.logs.filter((l) => l.jobId === id).slice(-80);

  const formats = (meta.formats || []).length ? `
    <div class="card"><div class="card-head"><h3>${icon('i-box')} ${esc(t('queue.formats'))}</h3></div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>ID</th><th>EXT</th><th>RESOLUTION</th><th>V_CODEC</th><th>A_CODEC</th><th>TBR</th><th>SIZE</th>
    </tr></thead><tbody>
      ${meta.formats.map((f) => `<tr>
        <td class="mono">${esc(f.id)}</td><td class="mono">${esc(f.ext)}</td>
        <td class="mono">${esc(f.resolution)}</td><td class="mono" style="font-size:11px">${esc(f.vcodec)}</td>
        <td class="mono" style="font-size:11px">${esc(f.acodec)}</td><td class="mono">${f.tbr ? `${digits(f.tbr)}k` : '—'}</td>
        <td class="mono">${esc(fmtBytes(f.filesize))}</td></tr>`).join('')}
    </tbody></table></div></div>` : '';

  openDrawer({
    title: job.name,
    subtitle: `${engine.label} · ${t(`kind.${job.kind}`)}${meta.resolution ? ' · ' + meta.resolution : ''}${meta.durationSec ? ' · ' + fmtDuration(meta.durationSec) : ''}`,
    body: `
      <div class="card card-pad">
        <div class="row" style="margin-bottom:10px">
          ${statusPill(job.status)}
          <span class="grow"></span>
          <span class="badge">${digits(Math.round(job.progress))}%</span>
          ${job.real ? `<span class="badge violet">${icon('i-globe')} browser</span>` : ''}
        </div>
        <div class="job-prog" style="min-width:0;margin-bottom:12px">
          <span class="progress ${job.status === 'completed' ? 'done' : ''}"><i style="width:${job.progress}%"></i></span>
          <span class="pct">${esc(fmtSpeed(job.speedBps))}</span>
        </div>
        <dl class="kv">
          <dt>${esc(t('ui.name'))}</dt><dd>${esc(job.name)}</dd>
          <dt>URL</dt><dd><a href="${esc(job.url)}" target="_blank" rel="noopener" class="mono">${esc(job.url)}</a></dd>
          <dt>${esc(t('ui.engine'))}</dt><dd>${esc(job.engine)}${meta.site ? ` · ${esc(meta.site)}` : ''}</dd>
          <dt>${esc(t('ui.kind'))}</dt><dd>${esc(t(`kind.${job.kind}`))}</dd>
          <dt>${esc(t('ui.size'))}</dt><dd>${esc(fmtBytes(job.sizeBytes || job.totalBytes))}${job.doneBytes && job.status !== 'completed' ? ` (${esc(fmtBytes(job.doneBytes))})` : ''}</dd>
          ${meta.uploader ? `<dt>uploader</dt><dd>${esc(meta.uploader)}${meta.views ? ` · ${digits(meta.views.toLocaleString('en-US'))} views` : ''}</dd>` : ''}
          <dt>${esc(t('ui.added'))}</dt><dd>${esc(fmtDateTime(job.createdAt))}</dd>
          ${job.startedAt ? `<dt>started</dt><dd>${esc(fmtDateTime(job.startedAt))}</dd>` : ''}
          ${job.finishedAt ? `<dt>${esc(t('ui.finished'))}</dt><dd>${esc(fmtDateTime(job.finishedAt))} (${esc(timeAgo(job.finishedAt))})</dd>` : ''}
          ${job.path ? `<dt>${esc(t('ui.path'))}</dt><dd class="mono">${esc(job.path)}</dd>` : ''}
          ${job.error ? `<dt>${esc(t('ui.error'))}</dt><dd style="color:#fca5a5">${esc(job.error)}</dd>` : ''}
        </dl>
      </div>

      ${formats}

      <div class="card">
        <div class="card-head"><h3>${icon('i-sliders')} ${esc(t('queue.opts'))}</h3>
          <span class="spacer"></span>
          <button class="btn sm ghost" data-drawer-opts>${icon('i-copy')} JSON</button>
        </div>
        <div class="card-pad"><pre class="code" style="max-height:220px">${esc(JSON.stringify(options, null, 2))}</pre></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${icon('i-terminal')} ${esc(t('queue.jobLog'))}</h3>
          <span class="spacer"></span><span class="badge">${digits(logs.length)}</span></div>
        <div class="card-pad">
          <div class="logbox" style="height:200px">
            ${logs.length ? logs.map((l) => `<div class="logline lv-${l.level}"><span class="t">${esc(new Date(l.ts).toLocaleTimeString('en-GB'))}</span><span class="l">${l.level}</span><span class="m">${esc(l.message)}</span></div>`).join('') : `<div class="muted">${esc(t('logs.empty'))}</div>`}
          </div>
        </div>
      </div>`,
    foot: `
      ${job.status === 'downloading' || job.status === 'processing' ? `<button class="btn" data-drawer="pause">${icon('i-pause')} ${esc(t('ui.pause'))}</button>` : ''}
      ${job.status === 'paused' || job.status === 'queued' ? `<button class="btn primary" data-drawer="resume">${icon('i-play')} ${esc(t('ui.resume'))}</button>` : ''}
      ${job.status === 'error' || job.status === 'cancelled' ? `<button class="btn primary" data-drawer="retry">${icon('i-retry')} ${esc(t('ui.retry'))}</button>` : ''}
      ${job.status === 'completed' ? `<button class="btn primary" data-drawer="open">${icon('i-download')} ${esc(t('ui.download'))}</button>` : ''}
      <button class="btn ghost" data-drawer="copy">${icon('i-copy')} URL</button>
      <span class="grow"></span>
      ${!FINISHED.includes(job.status) ? `<button class="btn danger" data-drawer="cancel">${icon('i-stop')} ${esc(t('ui.cancel'))}</button>` : ''}
      <button class="btn danger ghost" data-drawer="remove">${icon('i-trash')} ${esc(t('ui.remove'))}</button>`,
    onClose: () => { state.ui.selectedJobId = null; notify(); },
  });

  const drawerRoot = document.getElementById('drawerRoot');
  drawerRoot.onclick = async (e) => {
    const btn = e.target.closest('[data-drawer]');
    if (e.target.closest('[data-drawer-opts]')) {
      codeModal({ title: t('queue.opts'), filename: `${job.id}.options.json`, code: JSON.stringify(options, null, 2) });
      return;
    }
    if (!btn) return;
    switch (btn.dataset.drawer) {
      case 'pause': pause(job.id); break;
      case 'resume': resume(job.id); break;
      case 'cancel': cancel(job.id); break;
      case 'retry': retry(job.id); break;
      case 'remove': remove(job.id); closeDrawer(); break;
      case 'copy': {
        const { copyText } = await import('../../exporters.js');
        if (await copyText(job.url)) toast('ok', t('ui.copied'));
        break;
      }
      case 'open': openPath(job); break;
      default: break;
    }
    if (btn.dataset.drawer !== 'remove') setTimeout(() => openJobDrawer(job.id), 60);
  };
}

function openPath(job) {
  if (state.settings.mode === 'live' && job.path) {
    window.open(sharedClient.fileUrl(job.id), '_blank', 'noopener');
    return;
  }
  if (job.real && job.path?.startsWith('browser-download://')) {
    toast('info', t('toast.savedReal'), job.path.replace('browser-download://', ''));
    return;
  }
  // Demo mode: nothing on disk — show the path the bot would have written.
  codeModal({
    title: t('ui.openFolder'),
    filename: 'path.txt',
    code: `${state.settings.downloadDir}\n\n${job.path || job.name}\n\n# ${t('mode.demo.tip')}`,
  });
  L.debug('panel', `open folder → ${state.settings.downloadDir}`, { jobId: job.id });
}
