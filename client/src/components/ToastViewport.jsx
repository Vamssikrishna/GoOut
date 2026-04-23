import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';

function getStyles(type) {
  switch (type) {
    case 'success':
      return {
        bar: 'bg-emerald-500',
        text: 'text-emerald-900',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200'
      };
    case 'error':
      return {
        bar: 'bg-red-500',
        text: 'text-red-900',
        bg: 'bg-red-50',
        border: 'border-red-200'
      };
    default:
      return {
        bar: 'bg-slate-700',
        text: 'text-slate-900',
        bg: 'bg-white',
        border: 'border-slate-200'
      };
  }
}

export default function ToastViewport() {
  const { toasts } = useToast();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!hydrated) return null;

  return (
    <div className="fixed top-[max(0.75rem,env(safe-area-inset-top,0px))] sm:top-20 right-1/2 translate-x-1/2 sm:right-4 sm:translate-x-0 z-[200] flex flex-col gap-3 w-[min(100%,22rem)] max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-2rem)] goout-animate-stagger">
      {toasts.map((t) => {
        const styles = getStyles(t.type);
        return (
          <div
            key={t.id}
            className={`rounded-2xl border ${styles.border} shadow-md ${styles.bg} overflow-hidden transform-gpu transition-all duration-300 ease-out ${
              t.visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
            } hover:-translate-y-0.5 hover:shadow-xl`}
            role="status"
            aria-live="polite">
            
            <div className={`h-1 ${styles.bar}`} />
            <div className="p-3">
              {t.title && <div className={`text-sm font-semibold ${styles.text}`}>{t.title}</div>}
              {t.message && <div className={`text-xs mt-0.5 ${styles.text} opacity-90`}>{t.message}</div>}
            </div>
          </div>);

      })}
    </div>);

}