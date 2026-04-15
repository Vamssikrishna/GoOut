import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';

function getStyles(type) {
  switch (type) {
    case 'success':
      return {
        bar: 'bg-gradient-to-r from-emerald-500 via-cyan-400 to-violet-500',
        text: 'text-emerald-900',
        bg: 'bg-emerald-50/85',
        border: 'border-emerald-200/80'
      };
    case 'error':
      return {
        bar: 'bg-gradient-to-r from-red-500 via-fuchsia-500 to-violet-500',
        text: 'text-red-900',
        bg: 'bg-red-50/85',
        border: 'border-red-200/80'
      };
    default:
      return {
        bar: 'bg-gradient-to-r from-goout-green via-goout-neon to-goout-violet',
        text: 'text-slate-900',
        bg: 'bg-white/90',
        border: 'border-cyan-200/80'
      };
  }
}

export default function ToastViewport() {
  const { toasts } = useToast();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!hydrated) return null;

  return (
    <div className="fixed top-20 right-4 z-[200] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)] goout-animate-stagger">
      {toasts.map((t) => {
        const styles = getStyles(t.type);
        return (
          <div
            key={t.id}
            className={`rounded-xl border ${styles.border} shadow-2xl shadow-cyan-500/10 ${styles.bg} backdrop-blur-md overflow-hidden transform-gpu transition-all duration-300 ease-out ${
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