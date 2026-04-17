import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../store/chatStore';
import { Send, Settings, X } from 'lucide-react';

export function ChatDrawer() {
  const isOpen = useChatStore((s) => s.isOpen);
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const showSettings = useChatStore((s) => s.showSettings);
  const toggleSettings = useChatStore((s) => s.toggleSettings);
  const setApiConfig = useChatStore((s) => s.setApiConfig);
  const apiKey = useChatStore((s) => s.apiKey);
  const model = useChatStore((s) => s.model);
  const provider = useChatStore((s) => s.provider);
  const apiEndpoint = useChatStore((s) => s.apiEndpoint);

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
    <div className="absolute right-0 top-10 bottom-0 w-96 flex flex-col z-50 overflow-hidden"
         style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-lg)' }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>AI Assistant</span>
        <button onClick={toggleSettings} style={{ color: 'var(--text-muted)' }} className="hover:opacity-80">
          {showSettings ? <X size={16} /> : <Settings size={16} />}
        </button>
      </div>

      {showSettings && (
        <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div>
            <label className="text-[10px] uppercase font-mono tracking-wider" style={{ color: 'var(--text-muted)' }}>Provider</label>
            <select
              value={provider}
              onChange={(e) => setApiConfig({ provider: e.target.value as 'openai' | 'anthropic' })}
              className="w-full rounded px-2 py-1 text-sm focus:outline-none"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-mono tracking-wider" style={{ color: 'var(--text-muted)' }}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiConfig({ apiKey: e.target.value })}
              placeholder="Enter API key..."
              className="w-full rounded px-2 py-1 text-sm focus:outline-none"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-mono tracking-wider" style={{ color: 'var(--text-muted)' }}>Model</label>
            <input
              value={model}
              onChange={(e) => setApiConfig({ model: e.target.value })}
              className="w-full rounded px-2 py-1 text-sm focus:outline-none"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-mono tracking-wider" style={{ color: 'var(--text-muted)' }}>API Endpoint (optional)</label>
            <input
              value={apiEndpoint}
              onChange={(e) => setApiConfig({ apiEndpoint: e.target.value })}
              placeholder="https://api.anthropic.com"
              className="w-full rounded px-2 py-1 text-sm focus:outline-none"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            />
          </div>
        </div>
      )}

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
          </div>
        ))}
        {isLoading && (
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
