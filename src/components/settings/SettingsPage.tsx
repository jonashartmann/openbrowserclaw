// ---------------------------------------------------------------------------
// OpenBrowserClaw — Settings page
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  Palette, KeyRound, Eye, EyeOff, Bot, MessageSquare,
  Smartphone, HardDrive, Lock, Check, LogIn, ExternalLink, Globe,
  RefreshCw, Search, ChevronDown,
} from 'lucide-react';
import { getConfig, setConfig } from '../../db.js';
import { CONFIG_KEYS, ANTHROPIC_API_VERSION, ANTHROPIC_MODELS_URL, OPENAI_API_BASE, OLLAMA_API_BASE } from '../../config.js';
import { getStorageEstimate, requestPersistentStorage } from '../../storage.js';
import { decryptValue } from '../../crypto.js';
import { getOrchestrator } from '../../stores/orchestrator-store.js';
import { useThemeStore, type ThemeChoice } from '../../stores/theme-store.js';
import type { AuthMode, ProviderType } from '../../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelOption {
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Model fetching helpers
// ---------------------------------------------------------------------------

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(ANTHROPIC_MODELS_URL, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
  const data = await res.json();
  return (data.data as Array<{ id: string; display_name?: string }>)
    .map((m) => ({ value: m.id, label: m.display_name || m.id }));
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(`${OPENAI_API_BASE}/models`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}`);
  const data = await res.json();
  const chatModels = (data.data as Array<{ id: string; created: number }>)
    .filter((m) =>
      m.id.startsWith('gpt-') ||
      m.id.startsWith('o1') ||
      m.id.startsWith('o3') ||
      m.id.startsWith('o4') ||
      m.id.includes('chatgpt'),
    )
    .sort((a, b) => b.created - a.created);
  return chatModels.map((m) => ({ value: m.id, label: m.id }));
}

async function fetchOllamaModels(baseUrl: string): Promise<ModelOption[]> {
  const url = (baseUrl || OLLAMA_API_BASE).replace(/\/$/, '');
  const res = await fetch(`${url}/api/tags`);
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const data = await res.json();
  return (data.models as Array<{ name: string }>).map((m) => ({ value: m.name, label: m.name }));
}

async function fetchModels(
  provider: ProviderType,
  { apiKey, sessionKey, authMode, openaiApiKey, ollamaBaseUrl }: {
    apiKey: string;
    sessionKey: string;
    authMode: AuthMode;
    openaiApiKey: string;
    ollamaBaseUrl: string;
  },
): Promise<ModelOption[]> {
  if (provider === 'anthropic') {
    const key = authMode === 'session_key' ? sessionKey : apiKey;
    if (!key) throw new Error('No API key configured');
    return fetchAnthropicModels(key);
  }
  if (provider === 'openai') {
    if (!openaiApiKey) throw new Error('No OpenAI API key configured');
    return fetchOpenAIModels(openaiApiKey);
  }
  if (provider === 'ollama') {
    return fetchOllamaModels(ollamaBaseUrl);
  }
  throw new Error(`Unknown provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// ModelCombobox — filterable model selector
// ---------------------------------------------------------------------------

function ModelCombobox({
  value,
  onChange,
  models,
  loading,
  error,
  onRefresh,
}: {
  value: string;
  onChange: (value: string) => void;
  models: ModelOption[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedLabel = models.find((m) => m.value === value)?.label || value;

  const filtered = models.filter(
    (m) =>
      m.label.toLowerCase().includes(filter.toLowerCase()) ||
      m.value.toLowerCase().includes(filter.toLowerCase()),
  );

  function handleInputChange(e: { target: HTMLInputElement }) {
    setFilter(e.target.value);
    setOpen(true);
  }

  function handleSelect(modelValue: string) {
    onChange(modelValue);
    setFilter('');
    setOpen(false);
  }

  function handleInputFocus() {
    setFilter('');
    setOpen(true);
  }

  function handleInputBlur(e: FocusEvent) {
    // Close only if focus leaves the whole combobox area
    if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
      setTimeout(() => setOpen(false), 150);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setFilter('');
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? filter : selectedLabel;

  return (
    <div className="relative w-full">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-40 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            className="input input-bordered input-sm w-full pl-7 pr-7"
            placeholder={loading ? 'Loading models…' : 'Search or type a model ID…'}
            value={displayValue}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <ChevronDown
            className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-40 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh model list"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-20 w-full bg-base-100 border border-base-300 rounded-lg shadow-xl mt-1 max-h-56 overflow-y-auto"
        >
          {loading && (
            <div className="px-3 py-2 text-sm opacity-60 flex items-center gap-2">
              <RefreshCw className="w-3 h-3 animate-spin" /> Loading models…
            </div>
          )}
          {error && !loading && (
            <div className="px-3 py-2 text-sm text-error">{error}</div>
          )}
          {!loading && filtered.length === 0 && !error && (
            <div className="px-3 py-2 text-sm opacity-60">
              {filter ? `No models matching "${filter}"` : 'No models found — click refresh'}
            </div>
          )}
          {!loading && filtered.map((m) => (
            <button
              key={m.value}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-base-200 transition-colors ${m.value === value ? 'bg-primary/10 font-medium' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(m.value);
              }}
            >
              <span className="block truncate">{m.label}</span>
              {m.label !== m.value && (
                <span className="block text-xs opacity-50 truncate">{m.value}</span>
              )}
            </button>
          ))}
          {/* Allow typing a custom model ID even if not in list */}
          {!loading && filter && !filtered.some((m) => m.value === filter) && (
            <button
              className="w-full text-left px-3 py-2 text-sm border-t border-base-300 hover:bg-base-200 transition-colors opacity-70"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(filter);
              }}
            >
              Use custom ID: <span className="font-mono">{filter}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const orch = getOrchestrator();

  // Provider
  const [provider, setProvider] = useState<ProviderType>(orch.getProvider());

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

  // Custom API URL (Anthropic session)
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [customApiUrlSaved, setCustomApiUrlSaved] = useState(false);

  // OpenAI API key
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiApiKeyMasked, setOpenaiApiKeyMasked] = useState(true);
  const [openaiApiKeySaved, setOpenaiApiKeySaved] = useState(false);

  // Ollama base URL
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('');
  const [ollamaBaseUrlSaved, setOllamaBaseUrlSaved] = useState(false);

  // Model
  const [model, setModel] = useState(orch.getModel());
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

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
      // Anthropic API key
      const encKey = await getConfig(CONFIG_KEYS.ANTHROPIC_API_KEY);
      if (encKey) {
        try { setApiKey(await decryptValue(encKey)); } catch { setApiKey(''); }
      }

      // Session key
      const encSession = await getConfig(CONFIG_KEYS.SESSION_KEY);
      if (encSession) {
        try { setSessionKey(await decryptValue(encSession)); } catch { setSessionKey(''); }
      }

      // Custom API URL
      const storedUrl = await getConfig(CONFIG_KEYS.CUSTOM_API_URL);
      if (storedUrl) setCustomApiUrl(storedUrl);

      // OpenAI API key
      const encOpenai = await getConfig(CONFIG_KEYS.OPENAI_API_KEY);
      if (encOpenai) {
        try { setOpenaiApiKey(await decryptValue(encOpenai)); } catch { setOpenaiApiKey(''); }
      }

      // Ollama base URL
      const ollamaUrl = await getConfig(CONFIG_KEYS.OLLAMA_BASE_URL);
      if (ollamaUrl) setOllamaBaseUrl(ollamaUrl);

      // Telegram
      const token = await getConfig(CONFIG_KEYS.TELEGRAM_BOT_TOKEN);
      if (token) setTelegramToken(token);
      const chatIds = await getConfig(CONFIG_KEYS.TELEGRAM_CHAT_IDS);
      if (chatIds) {
        try { setTelegramChatIds(JSON.parse(chatIds).join(', ')); }
        catch { setTelegramChatIds(chatIds); }
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

  // Fetch models whenever provider or credentials change
  async function loadModels(
    p: ProviderType,
    opts: { apiKey: string; sessionKey: string; authMode: AuthMode; openaiApiKey: string; ollamaBaseUrl: string },
  ) {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const list = await fetchModels(p, opts);
      setModels(list);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }

  // Auto-fetch models on provider change
  useEffect(() => {
    loadModels(provider, { apiKey, sessionKey, authMode, openaiApiKey, ollamaBaseUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // ---- Handlers ----

  async function handleProviderChange(p: ProviderType) {
    setProvider(p);
    await orch.setProvider(p);
    // Reset model when switching providers
    const defaultModels: Record<ProviderType, string> = {
      anthropic: 'claude-sonnet-4-6',
      openai: 'gpt-4o',
      ollama: '',
    };
    const newModel = defaultModels[p];
    setModel(newModel);
    await orch.setModel(newModel);
  }

  async function handleAuthModeChange(mode: AuthMode) {
    setAuthMode(mode);
    await orch.setAuthMode(mode);
  }

  async function handleSaveApiKey() {
    await orch.setApiKey(apiKey.trim());
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
    loadModels(provider, { apiKey: apiKey.trim(), sessionKey, authMode, openaiApiKey, ollamaBaseUrl });
  }

  async function handleSaveSessionKey() {
    await orch.setSessionKey(sessionKey.trim());
    setSessionKeySaved(true);
    setTimeout(() => setSessionKeySaved(false), 2000);
    loadModels(provider, { apiKey, sessionKey: sessionKey.trim(), authMode, openaiApiKey, ollamaBaseUrl });
  }

  async function handleSaveCustomApiUrl() {
    await orch.setCustomApiUrl(customApiUrl.trim());
    setCustomApiUrlSaved(true);
    setTimeout(() => setCustomApiUrlSaved(false), 2000);
  }

  function handleOpenClaude() {
    window.open('https://claude.ai', '_blank', 'noopener');
  }

  async function handleSaveOpenaiApiKey() {
    await orch.setOpenaiApiKey(openaiApiKey.trim());
    setOpenaiApiKeySaved(true);
    setTimeout(() => setOpenaiApiKeySaved(false), 2000);
    loadModels(provider, { apiKey, sessionKey, authMode, openaiApiKey: openaiApiKey.trim(), ollamaBaseUrl });
  }

  async function handleSaveOllamaBaseUrl() {
    await orch.setOllamaBaseUrl(ollamaBaseUrl.trim());
    setOllamaBaseUrlSaved(true);
    setTimeout(() => setOllamaBaseUrlSaved(false), 2000);
    loadModels(provider, { apiKey, sessionKey, authMode, openaiApiKey, ollamaBaseUrl: ollamaBaseUrl.trim() });
  }

  async function handleModelChange(value: string) {
    setModel(value);
    await orch.setModel(value);
  }

  async function handleNameSave() {
    await orch.setAssistantName(assistantName.trim());
  }

  async function handleTelegramSave() {
    const ids = telegramChatIds.split(',').map((s) => s.trim()).filter(Boolean);
    await orch.configureTelegram(telegramToken.trim(), ids);
    setTelegramSaved(true);
    setTimeout(() => setTelegramSaved(false), 2000);
  }

  async function handleRequestPersistent() {
    const granted = await requestPersistentStorage();
    setIsPersistent(granted);
  }

  const storagePercent = storageQuota > 0 ? (storageUsage / storageQuota) * 100 : 0;

  // ---- Render ----

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

      {/* ---- Provider + Authentication ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><KeyRound className="w-4 h-4" /> Provider &amp; Authentication</h3>

          {/* Provider selector */}
          <div role="tablist" className="tabs tabs-boxed tabs-sm">
            {(['anthropic', 'openai', 'ollama'] as ProviderType[]).map((p) => (
              <button
                key={p}
                role="tab"
                className={`tab capitalize ${provider === p ? 'tab-active' : ''}`}
                onClick={() => handleProviderChange(p)}
              >
                {p === 'anthropic' ? 'Anthropic' : p === 'openai' ? 'OpenAI' : 'Ollama'}
              </button>
            ))}
          </div>

          {/* Anthropic auth */}
          {provider === 'anthropic' && (
            <>
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
                    <button className="btn btn-ghost btn-sm" onClick={() => setApiKeyMasked(!apiKeyMasked)}>
                      {apiKeyMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-primary btn-sm" onClick={handleSaveApiKey} disabled={!apiKey.trim()}>
                      Save
                    </button>
                    {apiKeySaved && (
                      <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                    )}
                  </div>
                  <p className="text-xs opacity-50">Your API key is encrypted and stored locally.</p>
                </div>
              )}

              {authMode === 'session_key' && (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Step 1: Sign in to Claude</p>
                    <button className="btn btn-outline btn-sm w-fit" onClick={handleOpenClaude}>
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
                      <button className="btn btn-ghost btn-sm" onClick={() => setSessionKeyMasked(!sessionKeyMasked)}>
                        {sessionKeyMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="btn btn-primary btn-sm" onClick={handleSaveSessionKey} disabled={!sessionKey.trim()}>
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
                        <button className="btn btn-primary btn-sm" onClick={handleSaveCustomApiUrl}>Save URL</button>
                        {customApiUrlSaved && (
                          <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs opacity-50">
                    Your session key is encrypted and stored locally. Session keys may expire — re-login if needed.
                  </p>
                </div>
              )}
            </>
          )}

          {/* OpenAI auth */}
          {provider === 'openai' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type={openaiApiKeyMasked ? 'password' : 'text'}
                  className="input input-bordered input-sm w-full flex-1 font-mono"
                  placeholder="sk-..."
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => setOpenaiApiKeyMasked(!openaiApiKeyMasked)}>
                  {openaiApiKeyMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary btn-sm" onClick={handleSaveOpenaiApiKey} disabled={!openaiApiKey.trim()}>
                  Save
                </button>
                {openaiApiKeySaved && (
                  <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                )}
              </div>
              <p className="text-xs opacity-50">Your OpenAI API key is encrypted and stored locally.</p>
            </div>
          )}

          {/* Ollama auth */}
          {provider === 'ollama' && (
            <div className="space-y-2">
              <p className="text-sm opacity-70">
                Ollama runs locally — no API key required. Make sure Ollama is running on your machine.
              </p>
              <fieldset className="fieldset">
                <legend className="fieldset-legend">Base URL</legend>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input input-bordered input-sm w-full flex-1 font-mono"
                    placeholder="http://localhost:11434"
                    value={ollamaBaseUrl}
                    onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveOllamaBaseUrl}
                  >
                    Save
                  </button>
                  {ollamaBaseUrlSaved && (
                    <span className="text-success text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
                  )}
                </div>
                <p className="fieldset-label opacity-60">Leave empty to use the default (localhost:11434)</p>
              </fieldset>
            </div>
          )}
        </div>
      </div>

      {/* ---- Model ---- */}
      <div className="card card-bordered bg-base-200">
        <div className="card-body p-4 sm:p-6 gap-3">
          <h3 className="card-title text-base gap-2"><Bot className="w-4 h-4" /> Model</h3>
          <ModelCombobox
            value={model}
            onChange={handleModelChange}
            models={models}
            loading={modelsLoading}
            error={modelsError}
            onRefresh={() => loadModels(provider, { apiKey, sessionKey, authMode, openaiApiKey, ollamaBaseUrl })}
          />
          {model && (
            <p className="text-xs opacity-50 font-mono">Selected: {model}</p>
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
              <span className="opacity-60">of {formatBytes(storageQuota)}</span>
            </div>
            <progress className="progress progress-primary w-full h-2" value={storagePercent} max={100} />
          </div>
          {!isPersistent && (
            <button className="btn btn-outline btn-sm" onClick={handleRequestPersistent}>
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
