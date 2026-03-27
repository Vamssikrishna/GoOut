import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';

function getStyles(type) {
  switch (type) {
    case 'success':
      return {
        bar: 'bg-emerald-500',
        text: 'text-emerald-900',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
      };
    case 'error':
      return {
        bar: 'bg-red-500',
        text: 'text-red-900',
        bg: 'bg-red-50',
        border: 'border-red-200',
      };
    default:
      return {
        bar: 'bg-goout-green',
        text: 'text-slate-900',
        bg: 'bg-white',
        border: 'border-slate-200',
      };
  }
}

export default function ToastViewport() {
  const { toasts } = useToast();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!hydrated) return null;

  return (
    <div className="fixed top-20 right-4 z-[200] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => {
        const styles = getStyles(t.type);
        return (
          <div
            key={t.id}
            className={`rounded-xl border ${styles.border} shadow-lg ${styles.bg} overflow-hidden`}
            role="status"
            aria-live="polite"
          >
            <div className={`h-1 ${styles.bar}`} />
            <div className="p-3">
              {t.title && <div className={`text-sm font-semibold ${styles.text}`}>{t.title}</div>}
              {t.message && <div className={`text-xs mt-0.5 ${styles.text} opacity-90`}>{t.message}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

