import React, { useEffect, useMemo, useState } from "react";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  SAFETY_LABELS,
  formatBytes,
  type Category,
  type SafetyLevel,
} from "../../shared/types";

/* ---------- Badge sécurité ---------- */
const SAFETY_ICON: Record<SafetyLevel, string> = {
  safe: "🟢",
  review: "🟡",
  caution: "🟠",
  risky: "🔴",
  protected: "🛡️",
};

export function SafetyBadge({ level }: { level: SafetyLevel }) {
  return (
    <span className={`badge badge-${level}`}>
      <span>{SAFETY_ICON[level]}</span>
      {SAFETY_LABELS[level]}
    </span>
  );
}

/* ---------- Tag catégorie ---------- */
export function CategoryTag({ category }: { category: Category }) {
  const color = CATEGORY_COLORS[category];
  return (
    <span className="tag">
      <span style={{ width: 8, height: 8, borderRadius: 3, background: color, display: "inline-block", boxShadow: `0 0 8px ${color}` }} />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/* ---------- Barre de progression ---------- */
export function ProgressBar({
  value,
  tone = "accent",
  indeterminate = false,
  height = 10,
}: {
  value: number;
  tone?: "accent" | "good" | "warn" | "danger";
  indeterminate?: boolean;
  height?: number;
}) {
  const cls = `progress-fill ${tone !== "accent" ? `progress-fill-${tone}` : ""} ${indeterminate ? "indeterminate" : ""}`;
  return (
    <div className="progress-track" style={{ height }}>
      <div className={cls} style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* ---------- Barre de chargement animée ---------- */
export function LoadingBar({ label = "Chargement…", max = 92 }: { label?: string; max?: number }) {
  const [pct, setPct] = useState(8);
  useEffect(() => {
    const iv = setInterval(() => {
      setPct((p) => {
        if (p >= max) return max;
        // Ralentit à l'approche du maximum pour rester crédible tant que c'est en cours.
        const inc = Math.max(0.6, (max - p) / 22);
        return Math.min(max, p + inc);
      });
    }, 110);
    return () => clearInterval(iv);
  }, [max]);
  return (
    <div className="loading-block">
      <div className="row-between mb-2">
        <span className="muted small">{label}</span>
        <span className="small" style={{ fontWeight: 650 }}>{Math.round(pct)}%</span>
      </div>
      <ProgressBar value={pct} height={12} />
    </div>
  );
}

/* ---------- Carte statistique ---------- */
export function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
  delay = 0,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: string;
  tone?: "default" | "accent" | "good";
  delay?: number;
}) {
  return (
    <div className="stat-card" style={{ animationDelay: `${delay}ms` }}>
      <div className="stat-label">
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ---------- Sélecteur segmenté ---------- */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- État vide ---------- */
export function EmptyState({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-ico">{icon}</div>
      <h3>{title}</h3>
      {sub && <p className="muted small" style={{ maxWidth: 420, margin: "0 auto" }}>{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- Modale ---------- */
export function Modal({ title, children, onClose, wide }: { title?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={wide ? { width: "min(820px, calc(100vw - 48px))" } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

/* ---------- Spinner ---------- */
export function Spinner() {
  return <div className="spinner" role="status" aria-label="Chargement" />;
}

/* ---------- Évolution de valeur animée ---------- */
export function AnimatedNumber({ value, format = formatBytes }: { value: number; format?: (n: number) => string }) {
  const [display, setDisplay] = useState(value);
  const fromRef = React.useRef(value);
  const raf = React.useRef<number | null>(null);

  useMemo(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const from = fromRef.current;
    const to = value;
    const dur = 700;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      fromRef.current = to;
    };
  }, [value]);

  return <span>{format(display)}</span>;
}

/* ---------- Tri de table ---------- */
export function useSort<T>(items: T[], defaultKey: keyof T, defaultDir: "asc" | "desc" = "desc") {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [dir, setDir] = useState<"asc" | "desc">(defaultDir);

  const toggle = (key: keyof T) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir("desc");
    }
  };

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [items, sortKey, dir]);

  return { sorted, sortKey, dir, toggle };
}
