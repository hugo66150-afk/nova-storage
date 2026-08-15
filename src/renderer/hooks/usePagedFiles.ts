import { useCallback, useEffect, useRef, useState } from "react";
import type { FileCandidate } from "../../shared/types";

export interface PagedState {
  items: FileCandidate[];
  total: number;
  totalBytes: number;
  offset: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const EMPTY: PagedState = {
  items: [],
  total: 0,
  totalBytes: 0,
  offset: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
  error: null,
};

/**
 * Cache mémoire global : ne re-fetch jamais une liste déjà chargée.
 * Borné (FIFO) pour éviter une croissance mémoire illimitée au fil des
 * navigations et des scans.
 */
const cache = new Map<string, PagedState>();
const CACHE_MAX = 40;

function cacheSet(key: string, state: PagedState): void {
  cache.set(key, state);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

const PAGE_SIZE = 200;

type Loader = (offset: number, limit: number) => Promise<{ items: FileCandidate[]; total: number; totalBytes: number }>;

function toState(p: { items: FileCandidate[]; total: number; totalBytes: number }, fromOffset: number): PagedState {
  return {
    items: p.items,
    total: p.total,
    totalBytes: p.totalBytes,
    offset: fromOffset + p.items.length,
    hasMore: fromOffset + p.items.length < p.total,
    loading: false,
    loadingMore: false,
    error: null,
  };
}

/**
 * Charge une liste de fichiers par pages (SQL paginé côté main) et met en
 * cache côté renderer. La clé `cacheKey` doit refléter tous les paramètres
 * (scanId + filtre) : un changement de clé recharge proprement.
 */
export function usePagedFiles(cacheKey: string, loader: Loader): PagedState & { loadMore: () => void; reload: () => void } {
  const cached = cache.get(cacheKey);
  const [state, setState] = useState<PagedState>(cached ? { ...cached, loading: false } : { ...EMPTY, loading: true });
  const loaderRef = useRef<Loader>(loader);
  loaderRef.current = loader;

  const fetch = useCallback(
    (offset: number, merge: boolean) => {
      loaderRef.current(offset, PAGE_SIZE).then(
        (p) => {
          const next = toState(p, offset);
          const merged: PagedState = merge
            ? { ...next, items: [...(cache.get(cacheKey)?.items ?? []), ...p.items] }
            : next;
          cacheSet(cacheKey, merged);
          setState(merged);
        },
        (e) => {
          setState({ ...EMPTY, loading: false, error: e instanceof Error ? e.message : String(e) });
        },
      );
    },
    [cacheKey],
  );

  useEffect(() => {
    const existing = cache.get(cacheKey);
    if (existing) {
      setState({ ...existing, loading: false });
      return;
    }
    setState({ ...EMPTY, loading: true });
    fetch(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const loadMore = useCallback(() => {
    if (state.loading || state.loadingMore || !state.hasMore) return;
    setState((s) => ({ ...s, loadingMore: true }));
    loaderRef.current(state.offset, PAGE_SIZE).then(
      (p) => {
        const next = toState(p, state.offset);
        const cur = cache.get(cacheKey);
        const merged: PagedState = {
          ...next,
          items: [...(cur?.items ?? state.items), ...p.items],
        };
        cacheSet(cacheKey, merged);
        setState(merged);
      },
      (e) => {
        setState((s) => ({ ...s, loadingMore: false, error: e instanceof Error ? e.message : String(e) }));
      },
    );
  }, [cacheKey, state.hasMore, state.loading, state.loadingMore, state.offset, state.items]);

  const reload = useCallback(() => {
    cache.delete(cacheKey);
    setState({ ...EMPTY, loading: true });
    fetch(0, false);
  }, [cacheKey, fetch]);

  return { ...state, loadMore, reload };
}

/** Invalide le cache d'un scan (après un nettoyage, par exemple). */
export function invalidatePagedCache(scanId: number): void {
  const prefix = `scan:${scanId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
