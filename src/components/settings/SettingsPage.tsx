// ---------------------------------------------------------------------------
// OpenBrowserClaw — Settings page
// ---------------------------------------------------------------------------

import { useEffect, useState, useRef } from 'react';
import {
  Palette, KeyRound, Eye, EyeOff, Bot, MessageSquare,
  Smartphone, HardDrive, Lock, Check, LogIn, ExternalLink,
  CheckCircle, AlertTriangle, Loader2,
} from 'lucide-react';
import { getConfig } from '../../db.js';
import { CONFIG_KEYS } from '../../config.js';
import { getStorageEstimate, requestPersistentStorage } from '../../storage.js';
import { decryptValue } from '../../crypto.js';
import { getOrchestrator } from '../../stores/orchestrator-store.js';
import { useThemeStore, type ThemeChoice } from '../../stores/theme-store.js';
import type { AuthMode } from '../../types.js';
import { generatePKCE, buildAuthorizationUrl, completeOAuthFlow } from '../../oauth.js';

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

  // OAuth login flow state
  const [oauthStep, setOauthStep] = useState<'idle' | 'waiting-for-code' | 'exchanging' | 'done' | 'error'>('idle');
  const [oauthCode, setOauthCode] = useState('');
  const [oauthError, setOauthError] = useState('');
  const pkceVerifierRef = useRef<string>('');

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

  // Theme
  const { theme, setTheme } = useThemeStore();

  // Load current values
  useEffect(() => {
    async function load() {
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
    // Ensure auth mode is set to api_key when saving manually
    await orch.setAuthMode('api_key');
    setAuthMode('api_key');
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  }

  // --- OAuth flow ---

  async function handleStartOAuth() {
    setOauthError('');
    setOauthCode('');
    const pkce = await generatePKCE();
    pkceVerifierRef.current = pkce.verifier;
    const url = buildAuthorizationUrl(pkce);
    window.open(url, '_blank', 'noopener');
    setOauthStep('waiting-for-code');
  }

  async function handleSubmitOAuthCode() {
    const code = oauthCode.trim();
    if (!code) return;

    setOauthStep('exchanging');
    setOauthError('');

    try {
      const result = await completeOAuthFlow(code, pkceVerifierRef.current);

      if (result.type === 'success') {
        // Save the API key
        setApiKey(result.apiKey);
        await orch.setApiKey(result.apiKey);
        await orch.setAuthMode('api_key');
        setAuthMode('api_key');
        setOauthStep('done');
      } else {
        setOauthError(result.error);
        setOauthStep('error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // CORS or network errors surface as TypeErrors from fetch()
      const isCors = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS');
      setOauthError(
        isCors
          ? 'Network/CORS error: The browser blocked the token exchange request to console.anthropic.com. '
            + 'This OAuth flow may not work directly from a browser. '
            + 'Try using an API key from console.anthropic.com instead.'
          : `Unexpected error: ${msg}`,
      );
      setOauthStep('error');
    }
  }

  function handleResetOAuth() {
    setOauthStep('idle');
    setOauthCode('');
    setOauthError('');
    pkceVerifierRef.current = '';
  }

  // --- Other handlers ---

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
              <LogIn className="w-3 h-3 mr-1" /> Login with Claude
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

          {/* Login with Claude — OAuth flow */}
          {authMode === 'session_key' && (
            <div className="space-y-3">
              <p className="text-sm opacity-70">
                Sign in with your Anthropic account to generate an API key automatically.
                Works on any device — no developer tools needed.
              </p>

              {/* Step 1: Start OAuth */}
              {oauthStep === 'idle' && (
                <button
                  className="btn btn-primary btn-sm w-fit"
                  onClick={handleStartOAuth}
                >
                  <ExternalLink className="w-4 h-4" /> Sign in with Anthropic
                </button>
              )}

              {/* Step 2: Waiting for user to paste the code */}
              {oauthStep === 'waiting-for-code' && (
                <div className="space-y-3">
                  <div className="alert alert-info text-sm py-2">
                    <span>A browser tab opened to the Anthropic Console. Sign in and copy the authorization code shown after approval.</span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Paste authorization code</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full flex-1 font-mono"
                        placeholder="Paste the code here..."
                        value={oauthCode}
                        onChange={(e) => setOauthCode(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSubmitOAuthCode}
                        disabled={!oauthCode.trim()}
                      >
                        Submit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleResetOAuth}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2b: Exchanging code for token */}
              {oauthStep === 'exchanging' && (
                <div className="alert text-sm py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Exchanging code for API key...</span>
                </div>
              )}

              {/* Step 3: Success */}
              {oauthStep === 'done' && (
                <div className="space-y-2">
                  <div className="alert alert-success text-sm py-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>API key created and saved. You're ready to go!</span>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleResetOAuth}
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Error state */}
              {oauthStep === 'error' && (
                <div className="space-y-2">
                  <div className="alert alert-error text-sm py-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{oauthError}</span>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleResetOAuth}
                  >
                    Try again
                  </button>
                </div>
              )}

              <p className="text-xs opacity-50">
                This uses the same OAuth flow as Claude Code CLI to create a
                permanent API key linked to your account. The key is stored
                encrypted in your browser.
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
