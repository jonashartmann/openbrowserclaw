// ---------------------------------------------------------------------------
// OpenBrowserClaw — Agent Worker
// ---------------------------------------------------------------------------
//
// Runs in a dedicated Web Worker. Owns the Claude API tool-use loop.
// Communicates with the main thread via postMessage.
//
// This is the browser equivalent of NanoClaw's container agent runner.
// Instead of Claude Agent SDK in a Linux container, we use raw Anthropic
// API calls with a tool-use loop.

import type { WorkerInbound, WorkerOutbound, InvokePayload, CompactPayload, ConversationMessage, ThinkingLogEntry, TokenUsage, AuthMode, ToolDefinition } from './types.js';
import { TOOL_DEFINITIONS } from './tools.js';
import { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, OPENROUTER_API_URL, PERPLEXITY_API_URL, FETCH_MAX_RESPONSE } from './config.js';
import { readGroupFile, writeGroupFile, listGroupFiles } from './storage.js';
import { executeShell } from './shell.js';
import { ulid } from './ulid.js';

// ---------------------------------------------------------------------------
// Auth configuration helper
// ---------------------------------------------------------------------------

interface AuthConfig {
  url: string;
  headers: Record<string, string>;
  mode: string;
}

function buildAuthConfig(payload: InvokePayload | CompactPayload): AuthConfig {
  const { authMode, sessionKey, customApiUrl, apiKey } = payload;

  if (authMode === 'session_key' && sessionKey) {
    const url = customApiUrl || ANTHROPIC_API_URL;
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionKey}`,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      mode: 'session_key',
    };
  }

  return {
    url: ANTHROPIC_API_URL,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    mode: 'api_key',
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<WorkerInbound>) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'invoke': {
      const invokePayload = payload as InvokePayload;
      if (invokePayload.provider === 'openrouter' || invokePayload.provider === 'perplexity') {
        await handleInvokeOpenAI(invokePayload);
      } else {
        await handleInvoke(invokePayload);
      }
      break;
    }
    case 'compact': {
      const compactPayload = payload as CompactPayload;
      if (compactPayload.provider === 'openrouter' || compactPayload.provider === 'perplexity') {
        await handleCompactOpenAI(compactPayload);
      } else {
        await handleCompact(compactPayload);
      }
      break;
    }
    case 'cancel':
      // TODO: AbortController-based cancellation
      break;
  }
};

// Shell emulator needs no boot — it's pure JS over OPFS

// ---------------------------------------------------------------------------
// Agent invocation — tool-use loop
// ---------------------------------------------------------------------------

async function handleInvoke(payload: InvokePayload): Promise<void> {
  const { groupId, messages, systemPrompt, apiKey, model, maxTokens } = payload;
  const auth = buildAuthConfig(payload);

  post({ type: 'typing', payload: { groupId } });
  log(groupId, 'info', 'Starting', `Model: ${model} · Max tokens: ${maxTokens} · Auth: ${auth.mode}`);

  try {
    let currentMessages: ConversationMessage[] = [...messages];
    let iterations = 0;
    const maxIterations = 25; // Safety limit to prevent infinite loops

    while (iterations < maxIterations) {
      iterations++;

      const body = {
        model,
        max_tokens: maxTokens,
        cache_control: { type: 'ephemeral' },
        system: systemPrompt,
        messages: currentMessages,
        tools: TOOL_DEFINITIONS,
      };

      log(groupId, 'api-call', `API call #${iterations}`, `${currentMessages.length} messages in context`);

      const res = await fetch(auth.url, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
      }

      const result = await res.json();

      // Emit token usage
      if (result.usage) {
        post({
          type: 'token-usage',
          payload: {
            groupId,
            inputTokens: result.usage.input_tokens || 0,
            outputTokens: result.usage.output_tokens || 0,
            cacheReadTokens: result.usage.cache_read_input_tokens || 0,
            cacheCreationTokens: result.usage.cache_creation_input_tokens || 0,
            contextLimit: getContextLimit(model),
          },
        });
      }

      // Log any text blocks in the response (intermediate reasoning)
      for (const block of result.content) {
        if (block.type === 'text' && block.text) {
          const preview = block.text.length > 200 ? block.text.slice(0, 200) + '…' : block.text;
          log(groupId, 'text', 'Response text', preview);
        }
      }

      if (result.stop_reason === 'tool_use') {
        // Execute all tool calls
        const toolResults = [];
        for (const block of result.content) {
          if (block.type === 'tool_use') {
            const inputPreview = JSON.stringify(block.input);
            const inputShort = inputPreview.length > 300 ? inputPreview.slice(0, 300) + '…' : inputPreview;
            log(groupId, 'tool-call', `Tool: ${block.name}`, inputShort);

            post({
              type: 'tool-activity',
              payload: { groupId, tool: block.name, status: 'running' },
            });

            const output = await executeTool(block.name, block.input, groupId);

            const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
            const outputShort = outputStr.length > 500 ? outputStr.slice(0, 500) + '…' : outputStr;
            log(groupId, 'tool-result', `Result: ${block.name}`, outputShort);

            post({
              type: 'tool-activity',
              payload: { groupId, tool: block.name, status: 'done' },
            });

            toolResults.push({
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: typeof output === 'string'
                ? output.slice(0, 100_000)
                : JSON.stringify(output).slice(0, 100_000),
            });
          }
        }

        // Continue the conversation with tool results
        currentMessages.push({ role: 'assistant', content: result.content });
        currentMessages.push({ role: 'user', content: toolResults as any });

        // Re-signal typing between tool iterations
        post({ type: 'typing', payload: { groupId } });
      } else {
        // Final response — extract text
        const text = result.content
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('');

        // Strip internal tags (matching NanoClaw pattern)
        const cleaned = text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();

        post({ type: 'response', payload: { groupId, text: cleaned || '(no response)' } });
        return;
      }
    }

    // If we hit max iterations
    post({
      type: 'response',
      payload: {
        groupId,
        text: '⚠️ Reached maximum tool-use iterations (25). Stopping to avoid excessive API usage.',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', payload: { groupId, error: message } });
  }
}

// ---------------------------------------------------------------------------
// Context compaction — ask Claude to summarize the conversation
// ---------------------------------------------------------------------------

async function handleCompact(payload: CompactPayload): Promise<void> {
  const { groupId, messages, systemPrompt, model, maxTokens } = payload;
  const auth = buildAuthConfig(payload);

  post({ type: 'typing', payload: { groupId } });
  log(groupId, 'info', 'Compacting context', `Summarizing ${messages.length} messages`);

  try {
    const compactSystemPrompt = [
      systemPrompt,
      '',
      '## COMPACTION TASK',
      '',
      'The conversation context is getting large. Produce a concise summary of the conversation so far.',
      'Include key facts, decisions, user preferences, and any important context.',
      'The summary will replace the full conversation history to stay within token limits.',
      'Be thorough but concise — aim for the essential information only.',
    ].join('\n');

    const compactMessages: ConversationMessage[] = [
      ...messages,
      {
        role: 'user' as const,
        content: 'Please provide a concise summary of our entire conversation so far. Include all key facts, decisions, code discussed, and important context. This summary will replace the full history.',
      },
    ];

    const body = {
      model,
      max_tokens: Math.min(maxTokens, 4096),
      cache_control: { type: 'ephemeral' },
      system: compactSystemPrompt,
      messages: compactMessages,
    };

    const res = await fetch(auth.url, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
    }

    const result = await res.json();
    const summary = result.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');

    log(groupId, 'info', 'Compaction complete', `Summary: ${summary.length} chars`);
    post({ type: 'compact-done', payload: { groupId, summary } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', payload: { groupId, error: `Compaction failed: ${message}` } });
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible API loop (OpenRouter + Perplexity)
// ---------------------------------------------------------------------------

async function handleInvokeOpenAI(payload: InvokePayload): Promise<void> {
  const { groupId, messages, systemPrompt, model, maxTokens, provider, openrouterApiKey, perplexityApiKey } = payload;

  const { url, headers } = buildOpenAIAuthConfig(provider || 'openrouter', openrouterApiKey || '', perplexityApiKey || '');

  // Perplexity does not support tool use
  const useTools = provider !== 'perplexity';
  const openaiTools = useTools ? toOpenAITools(TOOL_DEFINITIONS) : undefined;

  post({ type: 'typing', payload: { groupId } });
  log(groupId, 'info', 'Starting', `Model: ${model} · Provider: ${provider} · Max tokens: ${maxTokens}`);

  try {
    let currentMessages = toOpenAIMessages(messages, systemPrompt);
    let iterations = 0;
    const maxIterations = 25;

    while (iterations < maxIterations) {
      iterations++;

      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        messages: currentMessages,
      };

      if (openaiTools) {
        body.tools = openaiTools;
      }

      log(groupId, 'api-call', `API call #${iterations}`, `${currentMessages.length} messages in context`);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${provider} API error ${res.status}: ${errBody}`);
      }

      const result = await res.json();

      // Emit token usage (OpenAI format uses prompt_tokens / completion_tokens)
      if (result.usage) {
        post({
          type: 'token-usage',
          payload: {
            groupId,
            inputTokens: result.usage.prompt_tokens || 0,
            outputTokens: result.usage.completion_tokens || 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            contextLimit: getContextLimit(model),
          },
        });
      }

      const choice = result.choices?.[0];
      if (!choice) {
        throw new Error('No choices in API response');
      }

      const message = choice.message;
      const finishReason = choice.finish_reason;

      // Log any text content
      if (message.content) {
        const preview = message.content.length > 200 ? message.content.slice(0, 200) + '…' : message.content;
        log(groupId, 'text', 'Response text', preview);
      }

      if (finishReason === 'tool_calls' && message.tool_calls?.length > 0) {
        // Add assistant message with tool calls to history
        currentMessages.push({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: message.tool_calls,
        } as unknown as ConversationMessage);

        // Execute each tool call
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') continue;

          const name = toolCall.function.name as string;
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(toolCall.function.arguments as string);
          } catch {
            input = {};
          }

          const inputShort = toolCall.function.arguments.length > 300
            ? toolCall.function.arguments.slice(0, 300) + '…'
            : toolCall.function.arguments;
          log(groupId, 'tool-call', `Tool: ${name}`, inputShort);

          post({ type: 'tool-activity', payload: { groupId, tool: name, status: 'running' } });

          const output = await executeTool(name, input, groupId);

          const outputShort = output.length > 500 ? output.slice(0, 500) + '…' : output;
          log(groupId, 'tool-result', `Result: ${name}`, outputShort);

          post({ type: 'tool-activity', payload: { groupId, tool: name, status: 'done' } });

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: output.slice(0, 100_000),
          } as unknown as ConversationMessage);
        }

        post({ type: 'typing', payload: { groupId } });
      } else {
        // Final response
        const text = (message.content as string) || '';
        const cleaned = text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        post({ type: 'response', payload: { groupId, text: cleaned || '(no response)' } });
        return;
      }
    }

    post({
      type: 'response',
      payload: {
        groupId,
        text: '⚠️ Reached maximum tool-use iterations (25). Stopping to avoid excessive API usage.',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', payload: { groupId, error: message } });
  }
}

async function handleCompactOpenAI(payload: CompactPayload): Promise<void> {
  const { groupId, messages, systemPrompt, model, maxTokens, provider, openrouterApiKey, perplexityApiKey } = payload;

  const { url, headers } = buildOpenAIAuthConfig(provider || 'openrouter', openrouterApiKey || '', perplexityApiKey || '');

  post({ type: 'typing', payload: { groupId } });
  log(groupId, 'info', 'Compacting context', `Summarizing ${messages.length} messages`);

  try {
    const compactSystemPrompt = [
      systemPrompt,
      '',
      '## COMPACTION TASK',
      '',
      'The conversation context is getting large. Produce a concise summary of the conversation so far.',
      'Include key facts, decisions, user preferences, and any important context.',
      'The summary will replace the full conversation history to stay within token limits.',
      'Be thorough but concise — aim for the essential information only.',
    ].join('\n');

    const allMessages: ConversationMessage[] = [
      ...messages,
      {
        role: 'user' as const,
        content: 'Please provide a concise summary of our entire conversation so far. Include all key facts, decisions, code discussed, and important context. This summary will replace the full history.',
      },
    ];

    const currentMessages = toOpenAIMessages(allMessages, compactSystemPrompt);

    const body = {
      model,
      max_tokens: Math.min(maxTokens, 4096),
      messages: currentMessages,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`${provider} API error ${res.status}: ${errBody}`);
    }

    const result = await res.json();
    const summary = (result.choices?.[0]?.message?.content as string) || '';

    log(groupId, 'info', 'Compaction complete', `Summary: ${summary.length} chars`);
    post({ type: 'compact-done', payload: { groupId, summary } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', payload: { groupId, error: `Compaction failed: ${message}` } });
  }
}

function buildOpenAIAuthConfig(
  provider: string,
  openrouterApiKey: string,
  perplexityApiKey: string,
): { url: string; headers: Record<string, string> } {
  if (provider === 'openrouter') {
    return {
      url: OPENROUTER_API_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterApiKey}`,
        'HTTP-Referer': 'https://openbrowserclaw',
        'X-Title': 'OpenBrowserClaw',
      },
    };
  }

  // perplexity
  return {
    url: PERPLEXITY_API_URL,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${perplexityApiKey}`,
    },
  };
}

/** Convert Anthropic-format messages to OpenAI-format messages */
function toOpenAIMessages(messages: ConversationMessage[], systemPrompt: string): unknown[] {
  const result: unknown[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    const blocks = msg.content;

    if (msg.role === 'assistant') {
      const textBlocks = blocks.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>;
      const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use') as Array<{
        type: 'tool_use'; id: string; name: string; input: Record<string, unknown>;
      }>;

      const content = textBlocks.map((b) => b.text).join('') || null;

      if (toolUseBlocks.length > 0) {
        result.push({
          role: 'assistant',
          content,
          tool_calls: toolUseBlocks.map((b) => ({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          })),
        });
      } else {
        result.push({ role: 'assistant', content });
      }
    } else if (msg.role === 'user') {
      const toolResultBlocks = blocks.filter((b) => b.type === 'tool_result') as Array<{
        type: 'tool_result'; tool_use_id: string; content: string;
      }>;
      const textBlocks = blocks.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>;

      if (toolResultBlocks.length > 0) {
        for (const tr of toolResultBlocks) {
          result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content });
        }
      }

      if (textBlocks.length > 0) {
        result.push({ role: 'user', content: textBlocks.map((b) => b.text).join('') });
      } else if (toolResultBlocks.length === 0) {
        result.push({ role: 'user', content: '' });
      }
    }
  }

  return result;
}

/** Convert Anthropic tool definitions to OpenAI function-calling format */
function toOpenAITools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  groupId: string,
): Promise<string> {
  try {
    switch (name) {
      case 'bash': {
        const result = await executeShell(
          input.command as string,
          groupId,
          {},
          Math.min((input.timeout as number) || 30, 120),
        );
        let output = result.stdout;
        if (result.stderr) output += (output ? '\n' : '') + result.stderr;
        if (result.exitCode !== 0 && !result.stderr) {
          output += `\n[exit code: ${result.exitCode}]`;
        }
        return output || '(no output)';
      }

      case 'read_file':
        return await readGroupFile(groupId, input.path as string);

      case 'write_file':
        await writeGroupFile(groupId, input.path as string, input.content as string);
        return `Written ${(input.content as string).length} bytes to ${input.path}`;

      case 'list_files': {
        const entries = await listGroupFiles(groupId, (input.path as string) || '.');
        return entries.length > 0 ? entries.join('\n') : '(empty directory)';
      }

      case 'fetch_url': {
        const fetchRes = await fetch(input.url as string, {
          method: (input.method as string) || 'GET',
          headers: input.headers as Record<string, string> | undefined,
          body: input.body as string | undefined,
        });
        const rawText = await fetchRes.text();
        const contentType = fetchRes.headers.get('content-type') || '';
        const status = `[HTTP ${fetchRes.status}]\n`;

        // Strip HTML to reduce token usage
        let body = rawText;
        if (contentType.includes('html') || rawText.trimStart().startsWith('<')) {
          body = stripHtml(rawText);
        }

        return status + body.slice(0, FETCH_MAX_RESPONSE);
      }

      case 'update_memory':
        await writeGroupFile(groupId, 'CLAUDE.md', input.content as string);
        return 'Memory updated successfully.';

      case 'create_task': {
        // Post a dedicated message to the main thread to persist the task
        const taskData = {
          id: ulid(),
          groupId,
          schedule: input.schedule as string,
          prompt: input.prompt as string,
          enabled: true,
          lastRun: null,
          createdAt: Date.now(),
        };
        post({ type: 'task-created', payload: { task: taskData } });
        return `Task created successfully.\nSchedule: ${taskData.schedule}\nPrompt: ${taskData.prompt}`;
      }

      case 'javascript': {
        try {
          // Indirect eval: (0, eval)(...) runs in global scope and
          // naturally returns the value of the last expression —
          // no explicit `return` needed.
          const code = input.code as string;
          const result = (0, eval)(`"use strict";\n${code}`);
          if (result === undefined) return '(no return value)';
          if (result === null) return 'null';
          if (typeof result === 'object') {
            try { return JSON.stringify(result, null, 2); } catch { /* fall through */ }
          }
          return String(result);
        } catch (err: unknown) {
          return `JavaScript error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: unknown) {
    return `Tool error (${name}): ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(message: WorkerOutbound): void {
  (self as unknown as Worker).postMessage(message);
}

/**
 * Extract readable text from HTML, stripping tags, scripts, styles, and
 * collapsing whitespace.  Runs in the worker (no DOM), so we use regex.
 */
function stripHtml(html: string): string {
  let text = html;
  // Remove script/style/noscript blocks entirely
  text = text.replace(/<(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // Remove all tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  return text;
}

/** Map model names to their context window limits (tokens). */
function getContextLimit(model: string): number {
  if (model.includes('sonar') || model.includes('perplexity')) return 127_072;
  if (model.includes('gpt-4o')) return 128_000;
  if (model.includes('llama-3.1')) return 128_000;
  if (model.includes('gemini')) return 1_000_000;
  // Default: 200k for Claude Sonnet/Opus
  return 200_000;
}

function log(
  groupId: string,
  kind: ThinkingLogEntry['kind'],
  label: string,
  detail?: string,
): void {
  post({
    type: 'thinking-log',
    payload: { groupId, kind, timestamp: Date.now(), label, detail },
  });
}
