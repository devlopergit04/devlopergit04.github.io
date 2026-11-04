/* ui/views/sites.js — the supported-services catalogue + the routing rules
   copied straight out of downloader/engine.py. */

import { state } from '../../store.js';
import { SITES } from '../../sites.js';
import { GALLERY_DOMAINS, DIRECT_DOMAINS, FILE_EXT, engineFor, engineLabel } from '../../engine.js';
import { addText } from '../../jobs.js';
import { digits } from '../../format.js';
import { t } from '../../i18n.js';
import { esc, icon, on } from '../dom.js';
import { toast } from '../overlays.js';

let rootEl = null;

const GLYPH = { 'yt-dlp': 'i-video', 'gallery-dl': 'i-image', 'HTTP': 'i-file' };
const TINT = { 'yt-dlp': 'ok', 'gallery-dl': 'info', 'HTTP': 'warn' };

export const sitesView = {
  id: 'sites',
  title: () => t('view.sites.title'),
  sub: () => t('view.sites.sub'),

  render() {
    return `
    <div class="stack">
      <section class="card">
        <div class="card-head">
          <h3>${icon('i-globe')} <span data-i18n="nav.sites"></span></h3>
          <span class="badge" id="siteCount"></span>
          <span class="spacer"></span>
          <div class="input-group" style="max-width:290px">
            <input class="input" id="siteSearch" data-i18n-ph="sites.searchPh" autocomplete="off">
            <button class="btn ghost" id="siteClear" title="${esc(t('ui.close'))}">${icon('i-close')}</button>
          </div>
        </div>
        <div class="card-pad">
          <div class="site-grid" id="siteGrid"></div>
          <p class="muted" style="font-size:11.5px;margin-top:12px">${icon('i-bolt')} ${esc(t('sites.note'))}</p>
        </div>
      </section>

      <div class="grid cols-2">
        <section class="card">
          <div class="card-head"><h3>${icon('i-cpu')} <span data-i18n="queue.routing"></span></h3></div>
          <div class="card-pad">
            <p class="muted" style="font-size:12px;margin-bottom:10px">downloader/engine.py → <span class="mono">_classify()</span></p>
<pre class="code"><span class="c"># 1) دامنه‌های فایل مستقیم → HTTP</span>
DIRECT_DOMAINS = (${DIRECT_DOMAINS.map((d) => `"${d}"`).join(', ')})

<span class="c"># 2) دامنه‌های گالری/تصویر → gallery-dl</span>
GALLERY_DOMAINS = (
${GALLERY_DOMAINS.map((d) => `    "${d}",`).join('\n')}
)

<span class="c"># 3) پسوند فایل مستقیم → HTTP</span>
FILE_EXT = (
${FILE_EXT.map((e) => `    "${e}",`).join('\n')}
)

<span class="c"># 4) هر چیز دیگر → yt-dlp (بیش از ۱۸۰۰ سایت)</span></pre>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('i-search')} <span data-i18n="sites.engineFor"></span></h3></div>
          <div class="card-pad">
            <div class="input-group">
              <input class="input mono" id="probeUrl" placeholder="https://example.com/video" spellcheck="false">
              <button class="btn primary" id="probeBtn">${esc(t('sites.tryIt'))}</button>
            </div>
            <div id="probeOut" style="margin-top:12px"></div>
          </div>
        </section>
      </div>
    </div>`;
  },

  mount(root) {
    rootEl = root;
    const grid = root.querySelector('#siteGrid');
    const search = root.querySelector('#siteSearch');

    const paint = () => {
      const q = (state.ui.siteQuery || '').trim().toLowerCase();
      const list = SITES.filter((s) => !q || s.name.toLowerCase().includes(q) || s.domain.includes(q) || (s.short || '').includes(q) || s.engine.toLowerCase().includes(q) || s.note.includes(q));
      grid.innerHTML = list.map((s) => `
        <button class="site" data-site="${esc(s.id)}">
          <span class="top">
            <span class="glyph">${icon(GLYPH[s.engine] || 'i-cloud')}</span>
            <span class="grow"><b>${esc(s.name)}</b><span class="dom">${esc(s.domain)}${s.short ? ` · ${esc(s.short)}` : ''}</span></span>
          </span>
          <span class="meta">
            <span class="badge ${TINT[s.engine] || ''}">${esc(s.engine)}</span>
            ${s.kinds.map((k) => `<span class="badge plain">${icon({ video: 'i-video', audio: 'i-audio', image: 'i-image', file: 'i-file' }[k])}${esc(t(`kind.${k}`))}</span>`).join('')}
          </span>
          <p>${esc(s.note)}</p>
        </button>`).join('') || `<div class="empty" style="grid-column:1/-1">${icon('i-search')}<p>${esc(t('sites.empty'))}</p></div>`;
      root.querySelector('#siteCount').textContent = t('sites.count', { n: digits(list.length) });
    };

    search.value = state.ui.siteQuery || '';
    search.addEventListener('input', () => { state.ui.siteQuery = search.value; paint(); });
    root.querySelector('#siteClear').addEventListener('click', () => { search.value = ''; state.ui.siteQuery = ''; paint(); search.focus(); });

    on(grid, '[data-site]', 'click', (_e, el) => {
      const site = SITES.find((s) => s.id === el.dataset.site);
      if (!site?.sample) return;
      const { added } = addText(site.sample, { quality: state.settings.quality });
      toast(added ? 'ok' : 'warn', added ? t('toast.added') : t('queue.dup'), `${site.name} · ${engineLabel(site.sample).label}`);
      if (added) location.hash = '#/queue';
    });

    const probe = () => {
      const url = root.querySelector('#probeUrl').value.trim();
      const out = root.querySelector('#probeOut');
      if (!url) { out.innerHTML = ''; return; }
      const eng = engineLabel(url);
      const kind = engineFor(url);
      out.innerHTML = `
        <dl class="kv">
          <dt>${esc(t('ui.engine'))}</dt><dd><span class="badge ${TINT[eng.label]}">${icon(GLYPH[eng.label])}${esc(eng.label)}</span></dd>
          <dt>classify()</dt><dd class="mono">${esc(kind)}</dd>
          <dt>${esc(t('ui.kind'))}</dt><dd>${esc(t(`kind.${kind === 'gallery' ? 'image' : kind === 'http' ? 'file' : 'video'}`))}</dd>
          <dt>host</dt><dd class="mono">${esc(safeHost(url))}</dd>
        </dl>`;
    };
    root.querySelector('#probeBtn').addEventListener('click', probe);
    root.querySelector('#probeUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') probe(); });

    paint();
  },

  tick() {},
  unmount() { rootEl = null; },
};

function safeHost(url) {
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname; } catch { return '—'; }
}
