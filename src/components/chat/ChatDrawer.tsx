import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../store/chatStore';
import { Send, RotateCcw, X } from 'lucide-react';
import { useKeyboardInset } from '../mobile/useKeyboardInset';

export function ChatDrawer() {
  const isOpen = useChatStore((s) => s.isOpen);
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryLast = useChatStore((s) => s.retryLast);
  const pendingProposal = useChatStore((s) => s.pendingProposal);
  const proposalError = useChatStore((s) => s.proposalError);
  const applyProposal = useChatStore((s) => s.applyProposal);
  const discardProposal = useChatStore((s) => s.discardProposal);
  const attachViewport = useChatStore((s) => s.attachViewport);
  const setAttachViewport = useChatStore((s) => s.setAttachViewport);
  const requestEstimate = useChatStore((s) => s.requestEstimate);
  const stopGeneration = useChatStore((s) => s.stopGeneration);

  const toggleOpen = useChatStore((s) => s.toggleOpen);

  const keyboardInset = useKeyboardInset();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage(text);
  };

  if (!isOpen) return null;

  return (
    /*
      `top-11` matches the toolbar's `h-11`. At `top-10` the drawer covered the
      bottom 4px of the bar it is anchored under — including part of the very
      button you have to press to get back out.
    */
    <div className="absolute right-0 top-11 bottom-0 w-full lg:w-96 flex flex-col z-50 overflow-hidden"
         style={{
           background: 'var(--bg-panel)',
           borderLeft: '1px solid var(--border-subtle)',
           boxShadow: 'var(--shadow-lg)',
           // Lift the whole drawer clear of the on-screen keyboard rather than
           // just the composer, so the last few messages stay readable while
           // you type the next one.
           bottom: keyboardInset,
         }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>AI Assistant</span>
        {/*
          On mobile this drawer is full-screen, and its only exit used to be
          the toolbar toggle it was drawn on top of. A drawer that covers the
          screen has to carry its own way out.
        */}
        <button
          onClick={toggleOpen}
          aria-label="Close AI Chat"
          title="Close"
          className="tap flex items-center justify-center rounded -mr-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center mt-8">
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Describe what you want to model.</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Example: "Make a box for an Arduino Uno with 2mm walls and rounded corners"</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 ${msg.role === 'user' ? 'ml-8' : 'mr-8'}`}
            style={{
              background: msg.role === 'user' ? 'var(--accent-subtle)' : 'var(--bg-surface)',
              color: msg.role === 'user' ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {msg.images && msg.images.length > 0 && (
              <div className="flex gap-1 mb-1.5 overflow-x-auto">
                {msg.images.map((src, j) => (
                  <img key={j} src={src} alt="" className="w-14 h-14 rounded object-cover shrink-0" style={{ border: '1px solid var(--border-subtle)' }} />
                ))}
              </div>
            )}
            <pre className="whitespace-pre-wrap break-words overflow-hidden font-sans">{msg.content}</pre>
            {msg.parseFailed && (
              <div className="mt-2 pt-2 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Could not apply changes to model</span>
                {i === messages.length - 1 && !isLoading && (
                  <button
                    onClick={retryLast}
                    className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border-subtle)' }}
                  >
                    <RotateCcw size={10} /> Retry
                  </button>
                )}
              </div>
            )}
            {msg.actionError && (
              <div role="alert" className="mt-2 text-[11px]" style={{ color: 'var(--accent-red)' }}>
                Proposed changes rejected: {msg.actionError}
              </div>
            )}
          </div>
        ))}
        {pendingProposal && (
          <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)' }}>
            <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Review proposed model changes</div>
            <ul className="list-disc pl-4 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
              {pendingProposal.summary.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
            <div className="mt-1" style={{ color: 'var(--text-muted)' }}>
              {pendingProposal.affectedNodeIds.length} affected node{pendingProposal.affectedNodeIds.length === 1 ? '' : 's'}
            </div>
            {proposalError && <div role="alert" className="mt-2" style={{ color: 'var(--accent-red)' }}>{proposalError}</div>}
            <div className="flex gap-2 mt-3">
              <button onClick={applyProposal} className="px-2 py-1 rounded" style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>Apply</button>
              <button onClick={discardProposal} className="px-2 py-1 rounded" style={{ border: '1px solid var(--border-default)' }}>Discard</button>
            </div>
          </div>
        )}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && !messages[messages.length - 1].content && (
          <div className="text-sm rounded-lg px-3 py-2 mr-8 animate-pulse" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        className="p-3 px-safe-plus pb-safe-plus"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          ['--safe-pad-x' as any]: '0.75rem',
          ['--safe-pad-y' as any]: '0.75rem',
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={attachViewport} onChange={(event) => setAttachViewport(event.target.checked)} />
            Attach viewport images
          </label>
          {requestEstimate && (
            <span title={requestEstimate.trimmedMessages ? `${requestEstimate.trimmedMessages} older messages omitted` : undefined}>
              ~{requestEstimate.approximateTokens.toLocaleString()} tokens · {requestEstimate.imageCount} image{requestEstimate.imageCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Describe your model..."
            disabled={isLoading}
            enterKeyHint="send"
            className="flex-1 rounded px-3 py-2 text-sm tap-h focus:outline-none disabled:opacity-50"
            style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
          />
          {isLoading ? (
            <button
              onClick={stopGeneration}
              title="Stop generation"
              className="px-3 py-2 rounded flex items-center justify-center tap"
              style={{ background: 'var(--accent-red)', color: '#fff' }}
            >Stop</button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              title="Send"
              aria-label="Send message"
              className="px-3 py-2 rounded flex items-center justify-center tap disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
