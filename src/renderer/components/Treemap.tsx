import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "../../shared/types";

export interface TmItem {
  key: string;
  label: string;
  value: number;
  color: string;
  fileCount?: number;
  meta?: unknown;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  item: TmItem;
}

function worstAspect(row: TmItem[], rowSum: number, side: number): number {
  const width = rowSum / side;
  let worst = 0;
  for (const it of row) {
    const height = (it.value / rowSum) * side;
    const a = Math.max(width, height) / Math.min(width, height);
    if (a > worst) worst = a;
  }
  return worst;
}

export function squarify(items: TmItem[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((a, i) => a + i.value, 0);
  const results: Rect[] = [];
  if (total <= 0 || items.length === 0) return results;

  let i = 0;
  let curX = x;
  let curY = y;
  let curW = w;
  let curH = h;
  let curTotal = total;

  while (i < items.length) {
    const side = Math.min(curW, curH);
    const row: TmItem[] = [];
    let rowSum = 0;
    let best = Infinity;
    let advanced = false;

    while (i < items.length) {
      const candidate = items[i];
      row.push(candidate);
      rowSum += candidate.value;
      const worst = worstAspect(row, rowSum, side);
      if (worst > best) {
        row.pop();
        rowSum -= candidate.value;
        break;
      }
      best = worst;
      i++;
      advanced = true;
    }
    if (!advanced) break;
    if (row.length === 0 || rowSum <= 0) break;

    if (curW >= curH) {
      const frac = rowSum / curTotal;
      const rowW = curW * frac;
      let cy = curY;
      for (const it of row) {
        const rh = curH * (it.value / rowSum);
        results.push({ x: curX, y: cy, w: rowW, h: rh, item: it });
        cy += rh;
      }
      curX += rowW;
      curW -= rowW;
    } else {
      const frac = rowSum / curTotal;
      const rowH = curH * frac;
      let cx = curX;
      for (const it of row) {
        const rw = curW * (it.value / rowSum);
        results.push({ x: cx, y: curY, w: rw, h: rowH, item: it });
        cx += rw;
      }
      curY += rowH;
      curH -= rowH;
    }
    curTotal -= rowSum;
    if (curW < 1 || curH < 1) break;
  }
  return results;
}

export function Treemap({
  items,
  onItemClick,
  highlight,
}: {
  items: TmItem[];
  onItemClick?: (item: TmItem) => void;
  highlight?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ item: TmItem; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 460 });

  const capped = useMemo(() => {
    if (items.length <= 400) return items;
    const sorted = [...items].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 399);
    const rest = sorted.slice(399);
    const restSum = rest.reduce((a, r) => a + r.value, 0);
    if (restSum > 0) {
      top.push({ key: "__rest__", label: "Autres", value: restSum, color: "rgba(148,163,184,0.45)", fileCount: rest.length });
    }
    return top;
  }, [items]);

  const rects = useMemo(() => squarify(capped, 0, 0, size.w, size.h), [capped, size.w, size.h]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: Math.max(100, Math.floor(cr.width)), h: Math.max(120, Math.floor(cr.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = useMemo(() => capped.reduce((a, i) => a + i.value, 0), [capped]);

  return (
    <div>
      <div className="treemap-wrap" ref={containerRef} onMouseLeave={() => setHover(null)}>
        <div style={{ position: "absolute", inset: 0 }}>
{rects.map((r) => {
            const isActive = hover && hover.item.key === r.item.key;
            const isHi = highlight != null && highlight === r.item.key;
            const showLabel = r.w > 54 && r.h > 26;
            const showSize = r.w > 54 && r.h > 40;
            return (
              <div
                key={r.item.key}
                className="treemap-tile"
                style={{
                  left: r.x,
                  top: r.y,
                  width: r.w,
                  height: r.h,
                  background: `linear-gradient(135deg, ${r.item.color}, ${r.item.color}88)`,
                  outline: isHi ? "2px solid rgba(255,255,255,0.85)" : undefined,
                  boxShadow: isActive ? "0 0 0 2px rgba(139,92,246,0.6), 0 0 20px rgba(139,92,246,0.3)" : undefined,
                  animationDelay: `${Math.min(r.x + r.y, 500) * 0.5}ms`,
                }}
                onClick={() => onItemClick?.(r.item)}
                onMouseEnter={(e) => setHover({ item: r.item, x: e.clientX, y: e.clientY })}
              >
                {showLabel && <div className="tile-label">{r.item.label}</div>}
                {showSize && <div className="tile-size">{formatBytes(r.item.value)}</div>}
              </div>
            );
          })}
        </div>
      </div>
      {hover && (
        <div className="treemap-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="tt-title">{hover.item.label}</div>
          <div className="tt-line">Taille : {formatBytes(hover.item.value)}</div>
          <div className="tt-line">
            Part : {total > 0 ? ((hover.item.value / total) * 100).toFixed(1) : 0} %
          </div>
          {hover.item.fileCount !== undefined && <div className="tt-line">{hover.item.fileCount} éléments</div>}
        </div>
      )}
    </div>
  );
}
