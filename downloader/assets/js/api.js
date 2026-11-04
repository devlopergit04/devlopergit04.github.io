/* api.js — REST/SSE client for the optional real backend (downloader/api/server.py).
   The panel is fully usable without it (demo mode); with it, every button on
   this page drives the actual Python engines on your machine or server. */

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class ApiClient {
  constructor({ baseUrl = '', token = '', timeout = 8000 } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
    this.timeout = timeout;
  }

  setConfig({ baseUrl, token }) {
    if (baseUrl !== undefined) this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    if (token !== undefined) this.token = token || '';
  }

  get ready() { return !!this.baseUrl; }

  async request(path, { method = 'GET', body, timeout = this.timeout } = {}) {
    if (!this.baseUrl) throw new ApiError(0, 'No backend URL configured');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        let detail = `${res.status} ${res.statusText}`;
        try { const j = await res.json(); if (j?.detail) detail = j.detail; } catch { /* not json */ }
        throw new ApiError(res.status, detail);
      }
      if (res.status === 204) return null;
      const type = res.headers.get('content-type') || '';
      return type.includes('application/json') ? res.json() : res.text();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const reason = err.name === 'AbortError' ? `timeout after ${timeout}ms` : (err.message || String(err));
      throw new ApiError(0, reason);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── endpoints ────────────────────────────────────────────────────────── */
  health() { return this.request('/api/health', { timeout: 5000 }); }
  stats() { return this.request('/api/stats'); }
  listJobs() { return this.request('/api/jobs'); }
  getJob(id) { return this.request(`/api/jobs/${encodeURIComponent(id)}`); }
  createJob(payload) { return this.request('/api/jobs', { method: 'POST', body: payload }); }
  jobAction(id, action) { return this.request(`/api/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' }); }
  deleteJob(id) { return this.request(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  getConfig() { return this.request('/api/config'); }
  setConfigRemote(patch) { return this.request('/api/config', { method: 'POST', body: patch }); }
  logs(limit = 300) { return this.request(`/api/logs?limit=${limit}`); }
  telegramPing() { return this.request('/api/telegram/ping', { method: 'POST', timeout: 10000 }); }
  fileUrl(id) { return `${this.baseUrl}/api/files/${encodeURIComponent(id)}`; }

  /**
   * Live event stream. Prefers SSE, falls back to polling `listJobs()`.
   * @param {(evt:{type:string, [k:string]:any})=>void} onEvent
   * @returns {{stop:()=>void}}
   */
  stream(onEvent, pollMs = 2000) {
    let es = null;
    let timer = null;
    let stopped = false;

    const startSse = () => {
      if (typeof EventSource === 'undefined' || !this.baseUrl) return startPolling();
      try {
        const qs = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
        es = new EventSource(this.baseUrl + '/api/events' + qs);
        es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ } };
        es.onerror = () => { es?.close(); es = null; if (!stopped) startPolling(); };
      } catch { startPolling(); }
    };

    const startPolling = async () => {
      if (stopped) return;
      const tick = async () => {
        if (stopped) return;
        try {
          const data = await this.listJobs();
          onEvent({ type: 'snapshot', jobs: data?.jobs || [] });
        } catch (err) {
          onEvent({ type: 'error', message: err.message });
        }
        timer = setTimeout(tick, pollMs);
      };
      tick();
    };

    startSse();
    return {
      stop() {
        stopped = true;
        if (es) { es.close(); es = null; }
        if (timer) clearTimeout(timer);
      },
    };
  }
}

export const sharedClient = new ApiClient();
