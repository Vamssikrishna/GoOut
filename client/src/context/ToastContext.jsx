import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    // Trigger exit transition first, then remove from list.
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 240);
  }, []);

  const addToast = useCallback(
    ({ type = 'info', title = '', message = '', durationMs = 2000 } = {}) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const toast = { id, type, title, message, durationMs, visible: false };
      setToasts((prev) => [toast, ...prev].slice(0, 5));
      // Next frame: enter transition.
      window.setTimeout(() => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t)));
      }, 16);
      window.setTimeout(() => removeToast(id), Math.max(400, Number(durationMs) || 2000));
      return id;
    },
    [removeToast]
  );

  const value = useMemo(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}