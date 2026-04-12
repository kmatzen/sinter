import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../store/chatStore';

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
    <div className="absolute right-0 top-10 bottom-0 w-96 bg-zinc-900 border-l border-zinc-700 flex flex-col z-50 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-700 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">AI Assistant</span>
        <button onClick={toggleSettings} className="text-zinc-400 hover:text-zinc-200 text-sm">
          {showSettings ? '\u2715' : '\u2699'}
        </button>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="p-3 border-b border-zinc-700 space-y-2 bg-zinc-800/50">
          <div>
            <label className="text-[10px] text-zinc-400 uppercase">Provider</label>
            <select
              value={provider}
              onChange={(e) => setApiConfig({ provider: e.target.value as 'openai' | 'anthropic' })}
              className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 uppercase">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiConfig({ apiKey: e.target.value })}
              placeholder="Enter API key..."
              className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 uppercase">Model</label>
            <input
              value={model}
              onChange={(e) => setApiConfig({ model: e.target.value })}
              className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 uppercase">API Endpoint (optional)</label>
            <input
              value={apiEndpoint}
              onChange={(e) => setApiConfig({ apiEndpoint: e.target.value })}
              placeholder="https://api.anthropic.com"
              className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100"
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-zinc-500 text-center mt-8">
            <p className="mb-2">Describe what you want to model.</p>
            <p className="text-xs">Example: "Make a box for an Arduino Uno with 2mm walls and rounded corners"</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-blue-900/40 text-blue-100 ml-8'
                : 'bg-zinc-800 text-zinc-200 mr-8'
            }`}
          >
            <pre className="whitespace-pre-wrap break-words overflow-hidden font-sans">{msg.content}</pre>
          </div>
        ))}
        {isLoading && (
          <div className="bg-zinc-800 text-zinc-400 text-sm rounded-lg px-3 py-2 mr-8 animate-pulse">
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-zinc-700">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Describe your model..."
            disabled={isLoading}
            className="flex-1 bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-sm text-white"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
