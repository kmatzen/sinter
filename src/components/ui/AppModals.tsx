import { useModalStore } from '../../store/modalStore';

export function AppModals() {
  return (
    <>
      <ConfirmDialog />
      <Toast />
    </>
  );
}

function ConfirmDialog() {
  const visible = useModalStore((s) => s.confirmVisible);
  const message = useModalStore((s) => s.confirmMessage);
  const action = useModalStore((s) => s.confirmAction);
  const hide = useModalStore((s) => s.hideConfirm);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.6)' }}
         onClick={hide}>
      <div className="w-[360px] rounded-lg p-6"
           style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)' }}
           onClick={(e) => e.stopPropagation()}>
        <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {message}
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={hide}
                  className="text-xs px-4 py-2 rounded font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
            Cancel
          </button>
          <button onClick={() => { action?.(); hide(); }}
                  className="text-xs px-4 py-2 rounded font-medium"
                  style={{ background: 'var(--accent-red)', color: 'white' }}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast() {
  const message = useModalStore((s) => s.toastMessage);

  if (!message) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]">
      <div className="px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg"
           style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)' }}>
        {message}
      </div>
    </div>
  );
}
