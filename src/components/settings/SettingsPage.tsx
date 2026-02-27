// ---------------------------------------------------------------------------
// OpenBrowserClaw — Settings page
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import {
  Palette, KeyRound, Eye, EyeOff, Bot, MessageSquare,
  Smartphone, HardDrive, Lock, Check, LogIn, ExternalLink, Globe,
  Bookmark, Copy, CheckCircle, Clipboard,
} from 'lucide-react';
import { getConfig, setConfig } from '../../db.js';
import { CONFIG_KEYS } from '../../config.js';
import { getStorageEstimate, requestPersistentStorage } from '../../storage.js';
import { decryptValue } from '../../crypto.js';
import { getOrchestrator } from '../../stores/orchestrator-store.js';
import { useThemeStore, type ThemeChoice } from '../../stores/theme-store.js';
import type { AuthMode } from '../../types.js';
import { buildBookmarkletCode } from '../../session-key-helper.js';

const MODELS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export function SettingsPage() {
  const orch = getOrchestrator();

  // Auth mode
  const [authMode, setAuthMode] = useState<AuthMode>(orch.getAuthMode());

  // API Key
  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState(true);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Session Key (Claude Pro)
  const [sessionKey, setSessionKey] = useState('');
  const [sessionKeyMasked, setSessionKeyMasked] = useState(true);
  const [sessionKeySaved, setSessionKeySaved] = useState(false);

  // Custom API URL
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [customApiUrlSaved, setCustomApiUrlSaved] = useState(false);

  // Model
  const [model, setModel] = useState(orch.getModel());

  // Assistant name
  const [assistantName, setAssistantName] = useState(orch.getAssistantName());

  // Telegram
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatIds, setTelegramChatIds] = useState('');
  const [telegramSaved, setTelegramSaved] = useState(false);

  // Storage
  const [storageUsage, setStorageUsage] = useState(0);
  const [storageQuota, setStorageQuota] = useState(0);
  const [isPersistent, setIsPersistent] = useState(false);

  // Bookmarklet
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
  const [sessionMethod, setSessionMethod] = useState<'bookmarklet' | 'manual'>('bookmarklet');

  // Auto-imported session key (from URL hash redirect)
  const [autoImported, setAutoImported] = useState(false);

  // Theme
  const { theme, setTheme } = useThemeStore();

  // Load current values + check for auto-imported session key from URL hash
  useEffect(() => {
    async function load() {
      // Check for session key in URL hash (from bookmarklet redirect)
      const hash = window.location.hash;
      if (hash.startsWith('#session_key=')) {
        const key = decodeURIComponent(hash.slice('#session_key='.length));
        if (key) {
          setSessionKey(key);
          setAuthMode('session_key');
          await orch.setAuthMode('session_key');
          await orch.setSessionKey(key);
          setAutoImported(true);
          setTimeout(() => setAutoImported(false), 5000);
          // Clean the URL hash without triggering navigation
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      }

      // API key
      const encKey = await getConfig(CONFIG_KEYS.ANTHROPIC_API_KEY);
      if (encKey) {
        try {
          const dec = await decryptValue(encKey);
          setApiKey(dec);
        } catch {
          setApiKey('');
        }
      }

      // Session key (only load from storage if not just auto-imported)
      if (!hash.startsWith('#session_key=')) {
        const encSession = await getConfig(CONFIG_KEYS.SESSION_KEY);
        if (encSession) {
          try {
            const dec = await decryptValue(encSession);
            setSessionKey(dec);
          } catch {
            setSessionKey('');
          }
        }
      }

      // Custom API URL
      const storedUrl = await getConfig(CONFIG_KEYS.CUSTOM_API_URL);
      if (storedUrl) setCustomApiUrl(storedUrl);

      // Telegram
      const token = await getConfig(CONFIG_KEYS.TELEGRAM_BOT_TOKEN);
      if (token) setTelegramToken(token);
      const chatIds = await getConfig(CONFIG_KEYS.TELEGRAM_CHAT_IDS);
      if (chatIds) {
        try {
          setTelegramChatIds(JSON.parse(chatIds).join(', '));
        } catch {
          setTelegramChatIds(chatIds);
        }
      }

      // Storage
      const est = await getStorageEstimate();
      setStorageUsage(est.usage);
      setStorageQuota(est.quota);
      if (navigator.storage?.persisted) {
        setIsPersistent(await navigator.storage.persisted());
      }
    }
    load();
  }, []);

  async function handleAuthModeChange(mode: AuthMode) {
    setAuthMode(mode);
    await orch.setAuthMode(mode);
  }

  async function handleSaveApiKey() {
    await orch.setApiKey(apiKey.trim());
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  }

  async function handleSaveSessionKey() {
    await orch.setSessionKey(sessionKey.trim());
    setSessionKeySaved(true);
    setTimeout(() => setSessionKeySaved(false), 2000);
  }

  async function handleSaveCustomApiUrl() {
    await orch.setCustomApiUrl(customApiUrl.trim());
    setCustomApiUrlSaved(true);
    setTimeout(() => setCustomApiUrlSaved(false), 2000);
  }

  function handleOpenClaude() {
    window.open('https://claude.ai', '_blank', 'noopener');
  }

  const bookmarkletHref = buildBookmarkletCode(window.location.origin);

  async function handleCopyBookmarklet() {
    try {
      await navigator.clipboard.writeText(bookmarkletHref);
      setBookmarkletCopied(true);
      setTimeout(() => setBookmarkletCopied(false), 2000);
    } catch {
      // Fallback: select a temporary textarea
      const ta = document.createElement('textarea');
      ta.value = bookmarkletHref;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setBookmarkletCopied(true);
      setTimeout(() => setBookmarkletCopied(false), 2000);
    }
  }

  async function handleModelChange(value: string) {
    setModel(value);
    await orch.setModel(value);
  }

  async function handleNameSave() {
    await orch.setAssistantName(assistantName.trim());
  }

  async function handleTelegramSave() {
    const ids = telegramChatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await orch.configureTelegram(telegramToken.trim(), ids);
    setTelegramSaved(true);
    setTimeout(() => setTelegramSaved(false), 2000);
  }

  async function handleRequestPersistent() {
    const granted = await requestPersistentStorage();
    setIsPersistent(granted);
  }

  const storagePercent = storageQuota > 0 ? (storageUsage / storageQuota) * 100 : 0;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold mb-4">Settings</h2>

      {/* ---- Theme ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><Palette className="w-4 h-4" /> Appearance</h3>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Theme</legend>
            <select
              className="select select-bordered select-sm w-full"
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeChoice)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </fieldset>
        </div>
      </div>

      {/* ---- Authentication ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><KeyRound className="w-4 h-4" /> Authentication</h3>

          {/* Auth mode tabs */}
          <div role="tablist" className="tabs tabs-boxed tabs-sm">
            <button
              role="tab"
              className={`tab ${authMode === 'api_key' ? 'tab-active' : ''}`}
              onClick={() => handleAuthModeChange('api_key')}
            >
              <KeyRound className="w-3 h-3 mr-1" /> API Key
            </button>
            <button
              role="tab"
              className={`tab ${authMode === 'session_key' ? 'tab-active' : ''}`}
              onClick={() => handleAuthModeChange('session_key')}
            >
              <LogIn className="w-3 h-3 mr-1" /> Claude Pro Login
            </button>
          </div>

          {/* API Key mode */}
          {authMode === 'api_key' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type={apiKeyMasked ? 'password' : 'text'}
                  className="input input-bordered input-sm w-full flex-1 font-mono"
                  placeholder="sk-ant-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setApiKeyMasked(!apiKeyMasked)}
                >
                  {apiKeyMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveApiKey}
                  disabled={!apiKey.trim()}
                >
                  Save
                </button>
                {apiKeySaved && (
                  <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                )}
              </div>
              <p className="text-xs opacity-50">
                Your API key is encrypted and stored locally. It never leaves your browser.
              </p>
            </div>
          )}

          {/* Claude Pro Session Key mode */}
          {authMode === 'session_key' && (
            <div className="space-y-3">
              {/* Auto-import success banner */}
              {autoImported && (
                <div className="alert alert-success text-sm py-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>Session key imported automatically! You're ready to go.</span>
                </div>
              )}

              {/* Method selector */}
              <div role="tablist" className="tabs tabs-boxed tabs-xs">
                <button
                  role="tab"
                  className={`tab ${sessionMethod === 'bookmarklet' ? 'tab-active' : ''}`}
                  onClick={() => setSessionMethod('bookmarklet')}
                >
                  <Bookmark className="w-3 h-3 mr-1" /> Easy (Mobile-friendly)
                </button>
                <button
                  role="tab"
                  className={`tab ${sessionMethod === 'manual' ? 'tab-active' : ''}`}
                  onClick={() => setSessionMethod('manual')}
                >
                  <Clipboard className="w-3 h-3 mr-1" /> Manual
                </button>
              </div>

              {/* ---- Bookmarklet method ---- */}
              {sessionMethod === 'bookmarklet' && (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Step 1: Save the bookmarklet</p>
                    <div className="text-xs opacity-70 space-y-1">
                      <p><strong>On desktop:</strong> Drag the button below to your bookmarks bar.</p>
                      <p><strong>On mobile:</strong> Tap "Copy link" below, create a new bookmark for any page, then edit it and replace the URL with the copied text.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Draggable bookmarklet link (desktop) */}
                      <a
                        href={bookmarkletHref}
                        onClick={(e) => e.preventDefault()}
                        className="btn btn-secondary btn-sm no-underline"
                        title="Drag this to your bookmarks bar"
                      >
                        <Bookmark className="w-4 h-4" /> Get Session Key
                      </a>
                      {/* Copy button (mobile) */}
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={handleCopyBookmarklet}
                      >
                        {bookmarkletCopied
                          ? <><Check className="w-4 h-4" /> Copied!</>
                          : <><Copy className="w-4 h-4" /> Copy link</>
                        }
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Step 2: Log in to Claude</p>
                    <button
                      className="btn btn-outline btn-sm w-fit"
                      onClick={handleOpenClaude}
                    >
                      <ExternalLink className="w-4 h-4" /> Open claude.ai
                    </button>
                    <p className="text-xs opacity-70">Sign in with your Claude Pro/Team account if not already logged in.</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Step 3: Run the bookmarklet</p>
                    <div className="text-xs opacity-70 space-y-1">
                      <p>While on claude.ai, tap/click the <strong>"Get Session Key"</strong> bookmark you saved.</p>
                      <p>It will extract your session key and redirect you back here automatically.</p>
                    </div>
                  </div>

                  <div className="divider text-xs opacity-50 my-1">or paste manually</div>
                </div>
              )}

              {/* ---- Manual method ---- */}
              {sessionMethod === 'manual' && (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Step 1: Sign in to Claude</p>
                    <button
                      className="btn btn-outline btn-sm w-fit"
                      onClick={handleOpenClaude}
                    >
                      <ExternalLink className="w-4 h-4" /> Open claude.ai
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Step 2: Copy your session key</p>
                    <div className="text-xs opacity-70 space-y-1">
                      <p className="font-medium">Desktop (Chrome/Firefox/Edge):</p>
                      <ol className="list-decimal list-inside space-y-0.5 ml-1">
                        <li>Open DevTools (F12 or Ctrl+Shift+I)</li>
                        <li>Go to <strong>Application</strong> &gt; <strong>Cookies</strong> &gt; <strong>https://claude.ai</strong></li>
                        <li>Find <code className="bg-base-300 px-1 rounded">sessionKey</code> and copy its value</li>
                      </ol>
                    </div>
                    <div className="text-xs opacity-70 space-y-1 mt-1">
                      <p className="font-medium">iOS Safari:</p>
                      <ol className="list-decimal list-inside space-y-0.5 ml-1">
                        <li>Go to <strong>Settings</strong> &gt; <strong>Safari</strong> &gt; <strong>Advanced</strong> &gt; <strong>Website Data</strong></li>
                        <li>Search for <strong>claude.ai</strong> and tap it</li>
                        <li>Find the <code className="bg-base-300 px-1 rounded">sessionKey</code> cookie value</li>
                      </ol>
                    </div>
                    <div className="text-xs opacity-70 space-y-1 mt-1">
                      <p className="font-medium">Android Chrome:</p>
                      <ol className="list-decimal list-inside space-y-0.5 ml-1">
                        <li>Use the bookmarklet method above (recommended), or</li>
                        <li>Open <code className="bg-base-300 px-1 rounded">chrome://settings/cookies/detail?site=claude.ai</code></li>
                        <li>Find and copy the <code className="bg-base-300 px-1 rounded">sessionKey</code> value</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* Session key input (shared by both methods) */}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">
                  {sessionMethod === 'bookmarklet' ? 'Paste session key (if not auto-imported)' : 'Step 3: Paste your session key'}
                </p>
                <div className="flex gap-2">
                  <input
                    type={sessionKeyMasked ? 'password' : 'text'}
                    className="input input-bordered input-sm w-full flex-1 font-mono"
                    placeholder="sk-ant-sid01-..."
                    value={sessionKey}
                    onChange={(e) => setSessionKey(e.target.value)}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSessionKeyMasked(!sessionKeyMasked)}
                  >
                    {sessionKeyMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveSessionKey}
                    disabled={!sessionKey.trim()}
                  >
                    Save Session Key
                  </button>
                  {sessionKeySaved && (
                    <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                  )}
                </div>
              </div>

              {/* Optional: Custom API URL */}
              <div className="collapse collapse-arrow bg-base-300 rounded-lg">
                <input type="checkbox" />
                <div className="collapse-title text-sm font-medium flex items-center gap-1 min-h-0 py-2">
                  <Globe className="w-3 h-3" /> Advanced: Custom API URL
                </div>
                <div className="collapse-content space-y-2">
                  <p className="text-xs opacity-70">
                    If direct session key auth doesn't work, you can set up a CORS proxy
                    that forwards requests to the Claude API with your session key as a cookie.
                    Enter your proxy URL here.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full flex-1 font-mono"
                      placeholder="https://your-proxy.example.com/v1/messages"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleSaveCustomApiUrl}
                    >
                      Save URL
                    </button>
                    {customApiUrlSaved && (
                      <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs opacity-50">
                Your session key is encrypted and stored locally. It never leaves your browser
                (except to authenticate API requests). Session keys may expire — you'll need to
                re-login if that happens.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ---- Model ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><Bot className="w-4 h-4" /> Model</h3>
          <select
            className="select select-bordered select-sm"
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---- Assistant Name ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><MessageSquare className="w-4 h-4" /> Assistant Name</h3>
          <div className="flex gap-2">
            <input
              type="text"
              className="input input-bordered input-sm flex-1"
              placeholder="Andy"
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
              onBlur={handleNameSave}
            />
          </div>
          <p className="text-xs opacity-50">
            The name used for the assistant. Mention @{assistantName} to trigger a response.
          </p>
        </div>
      </div>

      {/* ---- Telegram ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><Smartphone className="w-4 h-4" /> Telegram Bot</h3>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Bot Token</legend>
            <input
              type="password"
              className="input input-bordered input-sm w-full font-mono"
              placeholder="123456:ABC-DEF..."
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Allowed Chat IDs</legend>
            <input
              type="text"
              className="input input-bordered input-sm w-full font-mono"
              placeholder="-100123456, 789012"
              value={telegramChatIds}
              onChange={(e) => setTelegramChatIds(e.target.value)}
            />
            <p className="fieldset-label opacity-60">Comma-separated chat IDs</p>
          </fieldset>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleTelegramSave}
              disabled={!telegramToken.trim()}
            >
              Save Telegram Config
            </button>
            {telegramSaved && (
              <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
            )}
          </div>
        </div>
      </div>

      {/* ---- Storage ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><HardDrive className="w-4 h-4" /> Storage</h3>
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span>{formatBytes(storageUsage)} used</span>
              <span className="opacity-60">
                of {formatBytes(storageQuota)}
              </span>
            </div>
            <progress
              className="progress progress-primary w-full h-2"
              value={storagePercent}
              max={100}
            />
          </div>
          {!isPersistent && (
            <button
              className="btn btn-outline btn-sm"
              onClick={handleRequestPersistent}
            >
              <Lock className="w-4 h-4" /> Request Persistent Storage
            </button>
          )}
          {isPersistent && (
            <div className="badge badge-success badge-sm gap-1.5">
              <Lock className="w-3 h-3" /> Persistent storage active
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
