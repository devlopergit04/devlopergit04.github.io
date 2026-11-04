/* ui/views/logs.js — the log console (mirrors LOG_LEVEL from .env). */

import { state, save } from '../../store.js';
import { filteredLogs, sources, clearLogs, exportLogs, LEVELS, formatLine } from '../../logs.js';
import { digits, fmtClock } from '../../format.js';
import { t } from '../../i18n.js';
import { esc, icon, on } from '../dom.js';
import { toast, confirmDialog } from '../overlays.js';
import { copyText, downloadText } from '../../exporters.js';

let rootEl = null;
let rendered = 0;      // how many filtered lines are already in the DOM
let lastSig = '';      // signature of the current filter set

const LEVEL_COLOR = { DEBUG: '#64748b', INFO: '#38bdf8', SUCCESS: '#34d399', WARNING: '#f59e0b', ERROR: '#f87171' };

export const logsView = {
  id: 'logs',
  title: () => t('view.logs.title'),
  sub: () => t('view.logs.sub'),

  render() {
    const f = state.ui.logFilter;
    return `
    <div class="stack">
      <section class="card">
        <div class="card-head">
          <h3>${icon('i-terminal')} <span data-i18n="logs.filter"></span></h3>
          <span class="spacer"></span>
          <label class="switch"><input type="checkbox" id="autoScroll" ${f.autoScroll ? 'checked' : ''}><span class="track"></span><span data-i18n="logs.autoScroll"></span></label>
          <label class="switch"><input type="checkbox" id="wrapLogs" ${f.wrap ? 'checked' : ''}><span class="track"></span><span data-i18n="logs.wrap"></span></label>
        </div>
        <div class="card-pad">
          <div class="filters" style="margin-bottom:10px">
            ${LEVELS.map((lv) => `<button class="fbtn ${f.levels.includes(lv) ? 'is-on' : ''}" data-level="${lv}" style="${f.levels.includes(lv) ? '' : `color:${LEVEL_COLOR[lv]}`}"><i style="background:${LEVEL_COLOR[lv]}"></i>${lv}</button>`).join('')}
            <span class="grow"></span>
            <select class="select" id="sourceSel" style="max-width:190px">
              <option value="all">${esc(t('logs.source'))}: ${esc(t('ui.all'))}</option>
              ${sources().map((s) => `<option value="${esc(s)}" ${f.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
            <select class="select" id="jobSel" style="max-width:210px">
              <option value="">job: ${esc(t('ui.all'))}</option>
              ${state.jobs.slice(0, 40).map((j) => `<option value="${esc(j.id)}" ${f.jobId === j.id ? 'selected' : ''}>${esc(j.name.slice(0, 28))}</option>`).join('')}
            </select>
          </div>
          <div class="row">
            <span class="badge" id="logCount">${digits(filteredLogs().length)}</span>
            <span class="muted" style="font-size:11.5px">LOG_LEVEL = <b class="mono">${esc(state.settings.logLevel)}</b></span>
            <span class="grow"></span>
            <button class="btn sm ghost" id="copyLogs">${icon('i-copy')} <span data-i18n="ui.copy"></span></button>
            <button class="btn sm ghost" id="exportLogs">${icon('i-download')} <span data-i18n="logs.export"></span></button>
            <button class="btn sm danger" id="clearLogs">${icon('i-trash')} <span data-i18n="logs.clear"></span></button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="logbox" id="logBox" style="border:0;border-radius:0 0 var(--r-md) var(--r-md)"></div>
      </section>
    </div>`;
  },

  mount(root) {
    rootEl = root;
    rendered = 0;
    lastSig = '';

    on(root, '[data-level]', 'click', (_e, el) => {
      const lv = el.dataset.level;
      const levels = new Set(state.ui.logFilter.levels);
      if (levels.has(lv)) levels.delete(lv); else levels.add(lv);
      state.ui.logFilter.levels = LEVELS.filter((l) => levels.has(l));
      el.classList.toggle('is-on', levels.has(lv));
      el.style.color = levels.has(lv) ? '' : LEVEL_COLOR[lv];
      save(); rerender();
    });

    root.querySelector('#sourceSel').addEventListener('change', (e) => { state.ui.logFilter.source = e.target.value; save(); rerender(); });
    root.querySelector('#jobSel').addEventListener('change', (e) => { state.ui.logFilter.jobId = e.target.value || null; save(); rerender(); });
    root.querySelector('#autoScroll').addEventListener('change', (e) => { state.ui.logFilter.autoScroll = e.target.checked; save(); });
    root.querySelector('#wrapLogs').addEventListener('change', (e) => {
      state.ui.logFilter.wrap = e.target.checked; save();
      root.querySelector('#logBox').style.whiteSpace = e.target.checked ? '' : 'pre';
    });

    root.querySelector('#copyLogs').addEventListener('click', async () => {
      const ok = await copyText(exportLogs());
      toast(ok ? 'ok' : 'err', ok ? t('ui.copied') : t('ui.copy'));
    });
    root.querySelector('#exportLogs').addEventListener('click', () => {
      downloadText(`downloader-bot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`, exportLogs());
      toast('ok', t('logs.export'));
    });
    root.querySelector('#clearLogs').addEventListener('click', async () => {
      if (await confirmDialog(t('logs.clear') + '?', { danger: true, okLabel: t('logs.clear') })) {
        clearLogs(); rerender(); toast('info', t('logs.clear'));
      }
    });

    rerender();
  },

  tick() {
    if (!rootEl) return;
    const lines = filteredLogs();
    const sig = `${state.ui.logFilter.levels.join()}|${state.ui.logFilter.source}|${state.ui.logFilter.jobId || ''}`;
    if (sig !== lastSig) { rerender(); return; }
    if (lines.length === rendered) {
      // keep the badge fresh (log level filter may hide new lines)
      setText(rootEl, '#logCount', digits(lines.length));
      return;
    }
    if (lines.length < rendered) { rerender(); return; }
    const box = rootEl.querySelector('#logBox');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const fragHtml = lines.slice(rendered).map(lineHtml).join('');
    box.insertAdjacentHTML('beforeend', fragHtml);
    rendered = lines.length;
    while (box.childElementCount > 1200) box.firstElementChild.remove();
    setText(rootEl, '#logCount', digits(lines.length));
    if (state.ui.logFilter.autoScroll && nearBottom) box.scrollTop = box.scrollHeight;
  },

  unmount() { rootEl = null; rendered = 0; },
};

function lineHtml(l) {
  return `<div class="logline lv-${esc(l.level)}" ${l.jobId ? `data-job="${esc(l.jobId)}"` : ''}>` +
    `<span class="t">${esc(fmtClock(l.ts))}</span>` +
    `<span class="l">${esc(l.level)}</span>` +
    `<span class="src">${esc(l.source)}</span>` +
    `<span class="m">${esc(l.message)}</span></div>`;
}

function rerender() {
  if (!rootEl) return;
  const lines = filteredLogs();
  const box = rootEl.querySelector('#logBox');
  box.innerHTML = lines.length
    ? lines.map(lineHtml).join('')
    : `<div class="muted" style="padding:14px">${esc(t('logs.empty'))}</div>`;
  rendered = lines.length;
  lastSig = `${state.ui.logFilter.levels.join()}|${state.ui.logFilter.source}|${state.ui.logFilter.jobId || ''}`;
  setText(rootEl, '#logCount', digits(lines.length));
  if (state.ui.logFilter.autoScroll) box.scrollTop = box.scrollHeight;
  box.style.whiteSpace = state.ui.logFilter.wrap ? '' : 'pre';
  // refresh the source dropdown (new engines may have appeared)
  const sel = rootEl.querySelector('#sourceSel');
  const cur = state.ui.logFilter.source;
  const opts = ['all', ...sources()];
  if (sel && opts.join() !== [...sel.options].map((o) => o.value).join()) {
    sel.innerHTML = opts.map((s) => `<option value="${esc(s)}" ${s === cur ? 'selected' : ''}>${s === 'all' ? `${esc(t('logs.source'))}: ${esc(t('ui.all'))}` : esc(s)}</option>`).join('');
  }
}

function setText(root, sel, value) {
  const el = root.querySelector(sel);
  if (el && el.textContent !== value) el.textContent = value;
}

export { formatLine };
