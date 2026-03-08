// ---------------------------------------------------------------------------
// OpenBrowserClaw — Custom Service Worker
// ---------------------------------------------------------------------------
//
// Handles:
//   1. Precaching via Workbox (injected by vite-plugin-pwa)
//   2. Periodic Background Sync — wakes up even when the PWA is closed
//      (Chrome on Android only, requires PWA to be installed)
//   3. Notification click — opens the app when user taps a task notification
//
// NOTE: Service workers run in a separate global scope from the main app.
// They cannot import from app modules that rely on browser globals like
// `window`, so all IndexedDB and cron logic is duplicated inline here.

/// <reference lib="WebWorker" />
/// <reference types="vite-plugin-pwa/client" />

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ---------------------------------------------------------------------------
// Periodic Background Sync
// ---------------------------------------------------------------------------
// Tag must match what the main thread registers in orchestrator.ts
const PERIODIC_SYNC_TAG = 'scheduled-tasks';
const DB_NAME = 'openbrowserclaw';
const DB_VERSION = 1;

self.addEventListener('periodicsync', (event: Event) => {
  const syncEvent = event as any;
  if (syncEvent.tag === PERIODIC_SYNC_TAG) {
    syncEvent.waitUntil(handleScheduledTasks());
  }
});

async function handleScheduledTasks(): Promise<void> {
  // First check if any window is open and focused.
  // If yes, delegate to main thread (it has the full orchestrator + agent).
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  if (clients.length > 0) {
    // App window is open — ask main thread to run the scheduler immediately
    for (const client of clients) {
      client.postMessage({ type: 'run-scheduled-tasks' });
    }
    return;
  }

  // App is closed — check IndexedDB ourselves for due tasks and notify the user
  try {
    const dueTasks = await getEnabledDueTasks();
    if (dueTasks.length === 0) return;

    const body =
      dueTasks.length === 1
        ? `Scheduled task ready: "${dueTasks[0].prompt.slice(0, 60)}"`
        : `${dueTasks.length} scheduled tasks are ready to run.`;

    await self.registration.showNotification('OpenBrowserClaw', {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: PERIODIC_SYNC_TAG,
      data: { url: '/' },
    });
  } catch (err) {
    console.error('[SW] handleScheduledTasks error:', err);
  }
}

// ---------------------------------------------------------------------------
// Notification click — open (or focus) the PWA
// ---------------------------------------------------------------------------

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl: string = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Try to focus an existing window
        const existing = clients.find((c) => {
          try {
            return new URL(c.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });
        if (existing) return existing.focus();
        return self.clients.openWindow(targetUrl);
      }),
  );
});

// ---------------------------------------------------------------------------
// Inline IndexedDB helpers (SW-safe, no imports from app)
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // If the DB doesn't exist yet, just reject — nothing to do
    req.onblocked = () => reject(new Error('IDB blocked'));
  });
}

interface TaskRecord {
  id: string;
  groupId: string;
  schedule: string;
  prompt: string;
  enabled: number | boolean;
  lastRun: number | null;
  createdAt: number;
}

async function getEnabledDueTasks(): Promise<TaskRecord[]> {
  const db = await openDb();
  const tasks = await new Promise<TaskRecord[]>((resolve, reject) => {
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const index = store.index('by-enabled');
    const req = index.getAll(1); // enabled stored as 1
    req.onsuccess = () => resolve(req.result as TaskRecord[]);
    req.onerror = () => reject(req.error);
  });
  db.close();

  const now = new Date();
  return tasks.filter(
    (t) => matchesCron(t.schedule, now) && !ranThisMinute(t.lastRun, now),
  );
}

function ranThisMinute(lastRun: number | null, now: Date): boolean {
  if (!lastRun) return false;
  const last = new Date(lastRun);
  return (
    last.getFullYear() === now.getFullYear() &&
    last.getMonth() === now.getMonth() &&
    last.getDate() === now.getDate() &&
    last.getHours() === now.getHours() &&
    last.getMinutes() === now.getMinutes()
  );
}

// ---------------------------------------------------------------------------
// Cron parser (duplicated from task-scheduler.ts — SW must be self-contained)
// ---------------------------------------------------------------------------

function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  return (
    matchField(min, date.getMinutes()) &&
    matchField(hour, date.getHours()) &&
    matchField(dom, date.getDate()) &&
    matchField(mon, date.getMonth() + 1) &&
    matchField(dow, date.getDay())
  );
}

function matchField(field: string, value: number): boolean {
  if (field === '*') return true;
  return field.split(',').some((part) => {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return false;
      if (range === '*') return value % step === 0;
      if (range.includes('-')) {
        const [lo, hi] = range.split('-').map(Number);
        return value >= lo && value <= hi && (value - lo) % step === 0;
      }
      const start = parseInt(range, 10);
      return value >= start && (value - start) % step === 0;
    }
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      return value >= lo && value <= hi;
    }
    return parseInt(part, 10) === value;
  });
}
