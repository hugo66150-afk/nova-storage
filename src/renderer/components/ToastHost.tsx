import { useApp } from "../state/store";

const ICONS: Record<string, string> = {
  success: "✅",
  error: "⛔",
  info: "💡",
  warning: "⚠️",
};

export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status" onClick={() => dismissToast(t.id)}>
          <div className="toast-icon">{ICONS[t.kind]}</div>
          <div>
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-msg">{t.message}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
