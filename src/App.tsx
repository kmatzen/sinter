import { useEffect } from 'react';
import { NodeTreePanel } from './components/tree/NodeTreePanel';
import { Viewport } from './components/viewport/Viewport';
import { PropertyPanel } from './components/properties/PropertyPanel';
import { Toolbar } from './components/toolbar/Toolbar';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { useEvaluator } from './engine/useEvaluator';
import { useModelerStore } from './store/modelerStore';

function App() {
  useEvaluator();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useModelerStore.getState().undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useModelerStore.getState().redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-full flex flex-col bg-zinc-900 text-zinc-100">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <NodeTreePanel />
        <Viewport />
        <PropertyPanel />
      </div>
      <ChatDrawer />
    </div>
  );
}

export default App;
