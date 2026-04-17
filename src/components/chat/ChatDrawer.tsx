import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../store/chatStore';
import { Send, RotateCcw } from 'lucide-react';

export function ChatDrawer() {
  const isOpen = useChatStore((s) => s.isOpen);
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryLast = useChatStore((s) => s.retryLast);

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
    <div className="absolute right-0 top-10 bottom-0 w-full md:w-96 flex flex-col z-50 overflow-hidden"
         style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-lg)' }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>AI Assistant</span>
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
          </div>
        ))}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && !messages[messages.length - 1].content && (
          <div className="text-sm rounded-lg px-3 py-2 mr-8 animate-pulse" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Describe your model..."
            disabled={isLoading}
            className="flex-1 rounded px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
            style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            title="Send"
            className="px-3 py-2 rounded flex items-center justify-center disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
