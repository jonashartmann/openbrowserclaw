// ---------------------------------------------------------------------------
// OpenBrowserClaw — Chat page
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { X, MessageSquare, Globe, FileText, MapPin } from 'lucide-react';
import { useOrchestratorStore } from '../../stores/orchestrator-store.js';
import { MessageList } from './MessageList.js';
import { ChatInput } from './ChatInput.js';
import { TypingIndicator } from './TypingIndicator.js';
import { ToolActivity } from './ToolActivity.js';
import { ActivityLog } from './ActivityLog.js';
import { ContextBar } from './ContextBar.js';
import { ChatActions } from './ChatActions.js';

const LineGraphIcon = ({ className }: { className?: string }) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        <path d="M3 3v18h18" />
        <path d="m7 15 4-4 3 3 5-7" />
    </svg>
);

const PROMPT_STARTERS = [
    {
        icon: Globe,
        title: 'Latest news',
        prompt: 'Get me the top trending posts from HackerNews.',
    },
    {
        icon: LineGraphIcon,
        title: 'Generate a report',
        prompt: 'Show me a graph with the Ethereum price over the last 6 months.',
    },
    {
        icon: MapPin,
        title: 'Map viewer',
        prompt: 'Generate an interactive map viewer with the top locations to visit in Seattle.',
    },
];

export function ChatPage() {
  const messages = useOrchestratorStore((s) => s.messages);
  const isTyping = useOrchestratorStore((s) => s.isTyping);
  const toolActivity = useOrchestratorStore((s) => s.toolActivity);
  const activityLog = useOrchestratorStore((s) => s.activityLog);
  const orchState = useOrchestratorStore((s) => s.state);
  const tokenUsage = useOrchestratorStore((s) => s.tokenUsage);
  const error = useOrchestratorStore((s) => s.error);
  const sendMessage = useOrchestratorStore((s) => s.sendMessage);
  const loadHistory = useOrchestratorStore((s) => s.loadHistory);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.length === 0 && !isTyping && (
          <div className="flex flex-col items-center justify-center min-h-full py-8 px-4">
            <MessageSquare className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 opacity-30" />
            <h2 className="text-xl sm:text-2xl font-bold text-center">Start a conversation</h2>
            <p className="mt-1.5 opacity-60 mb-5 text-sm text-center">Try one of these to get started</p>

            {/* Mobile: horizontal swipeable prompt cards */}
            <div className="flex sm:hidden gap-3 overflow-x-auto pb-2 w-full snap-x snap-mandatory prompt-scroll">
              {PROMPT_STARTERS.map(({ icon: Icon, title, prompt }) => (
                <button
                  key={title}
                  className="card card-bordered bg-base-200 active:bg-base-300 transition-colors cursor-pointer text-left shrink-0 w-44 snap-start"
                  onClick={() => sendMessage(prompt)}
                >
                  <div className="card-body p-3.5 gap-1.5">
                    <Icon className="w-5 h-5 opacity-60" />
                    <div className="font-medium text-sm leading-snug">{title}</div>
                    <div className="text-xs opacity-50 line-clamp-3">{prompt}</div>
                  </div>
                </button>
              ))}
              {/* Right-edge spacer so last card isn't flush against viewport */}
              <div className="shrink-0 w-1" aria-hidden="true" />
            </div>

            {/* Desktop: vertical stacked prompt cards */}
            <div className="hidden sm:grid gap-3 w-full max-w-md">
              {PROMPT_STARTERS.map(({ icon: Icon, title, prompt }) => (
                <button
                  key={title}
                  className="card card-bordered bg-base-200 hover:bg-base-300 active:bg-base-300 active:scale-[0.98] transition-all cursor-pointer text-left"
                  onClick={() => sendMessage(prompt)}
                >
                  <div className="card-body p-4 flex-row items-start gap-3">
                    <Icon className="w-5 h-5 opacity-60 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{title}</div>
                      <div className="text-xs opacity-50 mt-0.5 line-clamp-2">{prompt}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <MessageList messages={messages} />

        {isTyping && <TypingIndicator />}
        {toolActivity && (
          <ToolActivity tool={toolActivity.tool} status={toolActivity.status} />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Bottom bar */}
      <div className="border-t border-base-300 bg-base-100">
        {/* Activity log (collapsible) */}
        {activityLog.length > 0 && <ActivityLog entries={activityLog} />}

        {/* Context / token usage bar */}
        {tokenUsage && <ContextBar usage={tokenUsage} />}

        {/* Compact / New Session actions */}
        <ChatActions disabled={orchState !== 'idle'} />

        {/* Error display */}
        {error && (
          <div className="px-4 pb-2">
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => useOrchestratorStore.getState().clearError()}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <ChatInput
          onSend={sendMessage}
          disabled={orchState !== 'idle'}
        />
      </div>
    </div>
  );
}
