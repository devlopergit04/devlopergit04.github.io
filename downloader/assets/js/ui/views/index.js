/* ui/views/index.js — the view registry used by the hash router. */

import { dashboardView } from './dashboard.js';
import { queueView } from './queue.js';
import { logsView } from './logs.js';
import { telegramView } from './telegram.js';
import { sitesView } from './sites.js';
import { settingsView } from './settings.js';
import { helpView } from './help.js';

export const VIEWS = {
  dashboard: dashboardView,
  queue: queueView,
  logs: logsView,
  telegram: telegramView,
  sites: sitesView,
  settings: settingsView,
  help: helpView,
};

export const DEFAULT_ROUTE = 'dashboard';
export const ROUTES = Object.keys(VIEWS);
