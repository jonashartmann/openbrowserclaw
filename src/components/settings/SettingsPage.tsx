// ---------------------------------------------------------------------------
// OpenBrowserClaw — Settings page
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  Palette, KeyRound, Eye, EyeOff, Bot, MessageSquare,
  Smartphone, HardDrive, Lock, Check, LogIn, ExternalLink, Globe,
} from 'lucide-react';
import { getConfig, setConfig } from '../../db.js';
import { CONFIG_KEYS } from '../../config.js';
import { getStorageEstimate, requestPersistentStorage } from '../../storage.js';
import { decryptValue } from '../../crypto.js';
import { getOrchestrator } from '../../stores/orchestrator-store.js';
import { useThemeStore, type ThemeChoice } from '../../stores/theme-store.js';
import type { AuthMode, Provider } from '../../types.js';

const ANTHROPIC_MODELS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const OPENROUTER_MODELS = [
  { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (via OpenRouter)' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (via OpenRouter)' },
  { value: 'openai/gpt-4o', label: 'GPT-4o (via OpenRouter)' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (via OpenRouter)' },
  { value: 'meta-llama/llama-3.1-405b-instruct', label: 'Llama 3.1 405B (via OpenRouter)' },
  { value: 'google/gemini-pro-1.5', label: 'Gemini Pro 1.5 (via OpenRouter)' },
  { value: 'mistralai/mixtral-8x22b-instruct', label: 'Mixtral 8x22B (via OpenRouter)' },
];

const PERPLEXITY_MODELS = [
  { value: 'llama-3.1-sonar-large-128k-online', label: 'Sonar Large (web search)' },
  { value: 'llama-3.1-sonar-small-128k-online', label: 'Sonar Small (web search)' },
  { value: 'llama-3.1-sonar-huge-128k-online', label: 'Sonar Huge (web search)' },
  { value: 'llama-3.1-70b-instruct', label: 'Llama 3.1 70B' },
  { value: 'llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
];

const PROVIDER_DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openrouter: 'anthropic/claude-3.5-sonnet',
  perplexity: 'llama-3.1-sonar-large-128k-online',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export function SettingsPage() {
  const orch = getOrchestrator();

  // Provider
  const [provider, setProvider] = useState<Provider>(orch.getProvider());

  // Auth mode (Anthropic)
  const [authMode, setAuthMode] = useState<AuthMode>(orch.getAuthMode());

  // API Key (Anthropic)
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

  // OpenRouter API Key
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [openrouterApiKeyMasked, setOpenrouterApiKeyMasked] = useState(true);
  const [openrouterApiKeySaved, setOpenrouterApiKeySaved] = useState(false);

  // Perplexity API Key
  const [perplexityApiKey, setPerplexityApiKey] = useState('');
  const [perplexityApiKeyMasked, setPerplexityApiKeyMasked] = useState(true);
  const [perplexityApiKeySaved, setPerplexityApiKeySaved] = useState(false);

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

      // Session key
      const encSession = await getConfig(CONFIG_KEYS.SESSION_KEY);
      if (encSession) {
        try {
          const dec = await decryptValue(encSession);
          setSessionKey(dec);
        } catch {
          setSessionKey('');
        }
      }

      // Custom API URL
      const storedUrl = await getConfig(CONFIG_KEYS.CUSTOM_API_URL);
      if (storedUrl) setCustomApiUrl(storedUrl);

      // OpenRouter API key
      const encOpenrouter = await getConfig(CONFIG_KEYS.OPENROUTER_API_KEY);
      if (encOpenrouter) {
        try {
          const dec = await decryptValue(encOpenrouter);
          setOpenrouterApiKey(dec);
        } catch {
          setOpenrouterApiKey('');
        }
      }

      // Perplexity API key
      const encPerplexity = await getConfig(CONFIG_KEYS.PERPLEXITY_API_KEY);
      if (encPerplexity) {
        try {
          const dec = await decryptValue(encPerplexity);
          setPerplexityApiKey(dec);
        } catch {
          setPerplexityApiKey('');
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

  async function handleProviderChange(p: Provider) {
    setProvider(p);
    await orch.setProvider(p);
    // Switch model to the default for the new provider if it's not compatible
    const defaultModel = PROVIDER_DEFAULT_MODELS[p];
    setModel(defaultModel);
    await orch.setModel(defaultModel);
  }

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

  async function handleSaveOpenrouterApiKey() {
    await orch.setOpenrouterApiKey(openrouterApiKey.trim());
    setOpenrouterApiKeySaved(true);
    setTimeout(() => setOpenrouterApiKeySaved(false), 2000);
  }

  async function handleSavePerplexityApiKey() {
    await orch.setPerplexityApiKey(perplexityApiKey.trim());
    setPerplexityApiKeySaved(true);
    setTimeout(() => setPerplexityApiKeySaved(false), 2000);
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

  const modelList =
    provider === 'openrouter' ? OPENROUTER_MODELS
    : provider === 'perplexity' ? PERPLEXITY_MODELS
    : ANTHROPIC_MODELS;

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

      {/* ---- Provider ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><Globe className="w-4 h-4" /> AI Provider</h3>
          <div role="tablist" className="tabs tabs-boxed tabs-sm">
            <button
              role="tab"
              className={`tab ${provider === 'anthropic' ? 'tab-active' : ''}`}
              onClick={() => handleProviderChange('anthropic')}
            >
              Anthropic
            </button>
            <button
              role="tab"
              className={`tab ${provider === 'openrouter' ? 'tab-active' : ''}`}
              onClick={() => handleProviderChange('openrouter')}
            >
              OpenRouter
            </button>
            <button
              role="tab"
              className={`tab ${provider === 'perplexity' ? 'tab-active' : ''}`}
              onClick={() => handleProviderChange('perplexity')}
            >
              Perplexity
            </button>
          </div>

          {provider === 'anthropic' && (
            <p className="text-xs opacity-50">
              Use the Anthropic API directly. Requires an API key from console.anthropic.com, or sign in with Claude Pro.
            </p>
          )}
          {provider === 'openrouter' && (
            <p className="text-xs opacity-50">
              Access Claude, GPT-4, Llama, Gemini, and more through a unified API. Get an API key at openrouter.ai. Supports tool use.
            </p>
          )}
          {provider === 'perplexity' && (
            <p className="text-xs opacity-50">
              Use Perplexity's Sonar models with real-time web search. Get an API key at perplexity.ai. Tool use not supported.
            </p>
          )}
        </div>
      </div>

      {/* ---- Authentication ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><KeyRound className="w-4 h-4" /> Authentication</h3>

          {/* Anthropic auth */}
          {provider === 'anthropic' && (
            <>
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
                      <p>After logging in to claude.ai:</p>
                      <ol className="list-decimal list-inside space-y-0.5 ml-1">
                        <li>Open DevTools (F12 or Ctrl+Shift+I)</li>
                        <li>Go to <strong>Application</strong> &gt; <strong>Cookies</strong> &gt; <strong>https://claude.ai</strong></li>
                        <li>Find the cookie named <code className="bg-base-300 px-1 rounded">sessionKey</code></li>
                        <li>Copy its value</li>
                      </ol>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Step 3: Paste your session key</p>
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
            </>
          )}

          {/* OpenRouter auth */}
          {provider === 'openrouter' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type={openrouterApiKeyMasked ? 'password' : 'text'}
                  className="input input-bordered input-sm w-full flex-1 font-mono"
                  placeholder="sk-or-v1-..."
                  value={openrouterApiKey}
                  onChange={(e) => setOpenrouterApiKey(e.target.value)}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setOpenrouterApiKeyMasked(!openrouterApiKeyMasked)}
                >
                  {openrouterApiKeyMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveOpenrouterApiKey}
                  disabled={!openrouterApiKey.trim()}
                >
                  Save
                </button>
                {openrouterApiKeySaved && (
                  <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                )}
              </div>
              <p className="text-xs opacity-50">
                Get your API key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="link">openrouter.ai/keys</a>.
                Your key is encrypted and stored locally.
              </p>
            </div>
          )}

          {/* Perplexity auth */}
          {provider === 'perplexity' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type={perplexityApiKeyMasked ? 'password' : 'text'}
                  className="input input-bordered input-sm w-full flex-1 font-mono"
                  placeholder="pplx-..."
                  value={perplexityApiKey}
                  onChange={(e) => setPerplexityApiKey(e.target.value)}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPerplexityApiKeyMasked(!perplexityApiKeyMasked)}
                >
                  {perplexityApiKeyMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSavePerplexityApiKey}
                  disabled={!perplexityApiKey.trim()}
                >
                  Save
                </button>
                {perplexityApiKeySaved && (
                  <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                )}
              </div>
              <p className="text-xs opacity-50">
                Get your API key at <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noopener noreferrer" className="link">perplexity.ai/settings/api</a>.
                Your key is encrypted and stored locally.
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
            {modelList.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {provider === 'perplexity' && (
            <p className="text-xs opacity-50">
              Sonar models include real-time web search. Tool use (bash, files, etc.) is not available with Perplexity.
            </p>
          )}
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
