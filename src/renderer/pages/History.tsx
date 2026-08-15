import { useEffect, useMemo, useState } from "react";
import type { HistoryEvent } from "../../shared/types";
import { formatBytes, formatDate } from "../../shared/types";
import { EmptyState, LoadingBar } from "../components/ui";
import { LineChart } from "../components/charts";

export function HistoryPage() {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [trend, setTrend] = useState<{ points: Array<{ at: number; value: number }> } | null>(null);

  useEffect(() => {
    void window.nova.getHistory().then(setEvents);
    void window.nova.getTrend().then((t) => setTrend(t ? { points: t.points.map((p) => ({ at: p.at, value: p.used })) } : null));
  }, []);

  const grouped = useMemo(() => {
    if (!events) return [];
    const map = new Map<string, HistoryEvent[]>();
    for (const e of events) {
      const day = new Date(e.at).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
      const list = map.get(day) ?? [];
      list.push(e);
      map.set(day, list);
    }
    return Array.from(map.entries());
  }, [events]);

  if (!events) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Chargement de l'historique…" />
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Historique & évolution</h1>
          <p className="page-sub">Suivez vos analyses et vos nettoyages, et observez l'évolution de votre stockage dans le temps.</p>
        </div>
      </div>

      {trend && trend.points.length >= 2 && (
        <div className="card mb-5">
          <h3>Évolution du stockage utilisé</h3>
          <div className="card-sub">Courbe basée sur les points enregistrés à chaque analyse complète de disque.</div>
          <LineChart points={trend.points} width={760} height={230} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {grouped.length === 0 && <EmptyState icon="◴" title="Aucun événement" sub="Lancez une analyse et des nettoyages pour voir votre historique apparaître ici." />}
        {grouped.map(([day, list]) => (
          <div key={day}>
            <h3 style={{ textTransform: "capitalize", marginBottom: 12, fontSize: 17 }}>{day}</h3>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {list.map((e) => (
                <div key={e.id} className="file-row">
                  <span style={{ fontSize: 18 }}>{e.type === "scan" ? "🔍" : "🧹"}</span>
                  <div className="flex-1">
                    <div style={{ fontWeight: 650 }}>
                      {e.type === "scan" ? `Analyse${e.status !== "completed" ? ` (${e.status})` : ""}` : "Nettoyage"}
                    </div>
                    <div className="xs muted">{e.detail}</div>
                  </div>
                  <span className="tag">
                    {e.type === "scan" ? formatBytes(e.totalBytes) : `+ ${formatBytes(e.freedBytes)}`}
                  </span>
                  <span className="xs muted nowrap">{formatDate(e.at)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 1 }} />
    </div>
  );
}
