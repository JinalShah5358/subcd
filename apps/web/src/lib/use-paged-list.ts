import * as React from 'react';
import type { Page } from '@ifp/shared';

import { EMPTY_PAGE, type PageMeta, type SortDir } from '@/components/data-table';

export interface PagedQuery {
  page: number;
  pageSize: number;
  sort: string;
  dir: SortDir;
}

interface Options<T> {
  /** Receives page, pageSize, sort, dir and whatever `filters` holds. */
  load: (params: Record<string, string | number | undefined>) => Promise<Page<T>>;
  /** Anything `undefined` is dropped before the request is built. */
  filters?: Record<string, string | number | undefined>;
  sort: string;
  dir?: SortDir;
  pageSize?: number;
}

export interface PagedList<T> {
  rows: T[];
  meta: PageMeta;
  loading: boolean;
  error: string | null;
  query: PagedQuery;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSort: (sort: string, dir: SortDir) => void;
  reload: () => void;
}

/**
 * Drives one paged list: query state, fetching, and the rules that are easy to
 * get subtly wrong in each page separately.
 *
 * Two of those rules matter more than they look:
 *
 * - Changing a filter resets to page 1. Staying on page 7 of a result set that
 *   now has two pages shows an empty table and reads as "no matches".
 * - A response only lands if it is the newest one requested. Typing in a
 *   search box fires overlapping requests, and without the guard a slow early
 *   response can overwrite the results for what was actually typed.
 */
export function usePagedList<T>({
  load,
  filters,
  sort: initialSort,
  dir: initialDir = 'desc',
  pageSize: initialPageSize = 25,
}: Options<T>): PagedList<T> {
  const [rows, setRows] = React.useState<T[]>([]);
  const [meta, setMeta] = React.useState<PageMeta>({ ...EMPTY_PAGE, pageSize: initialPageSize });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [query, setQuery] = React.useState<PagedQuery>({
    page: 1,
    pageSize: initialPageSize,
    sort: initialSort,
    dir: initialDir,
  });

  // The caller passes a new closure every render; holding it in a ref keeps it
  // out of the effect's dependencies without lying to the linter.
  const loadRef = React.useRef(load);
  loadRef.current = load;

  const filterKey = JSON.stringify(filters ?? {});
  const latest = React.useRef(0);

  /**
   * Reset to page 1 when a filter changes — during render, not in an effect.
   *
   * In an effect this fires AFTER the fetch effect has already run once with
   * the stale page, so every keystroke in a search box cost two requests and
   * the first was always discarded. Adjusting state during render is React's
   * documented answer to "derive state from a changed prop": React re-runs
   * this component before committing, so the fetch effect only ever sees the
   * corrected page.
   */
  const lastFilterKey = React.useRef(filterKey);
  if (lastFilterKey.current !== filterKey) {
    lastFilterKey.current = filterKey;
    if (query.page !== 1) setQuery((q) => ({ ...q, page: 1 }));
  }

  React.useEffect(() => {
    const seq = (latest.current += 1);
    setLoading(true);

    const params: Record<string, string | number | undefined> = {
      ...(JSON.parse(filterKey) as Record<string, string | number | undefined>),
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      dir: query.dir,
    };

    loadRef
      .current(params)
      .then((res) => {
        if (seq !== latest.current) return;
        setRows(res.items);
        setMeta({
          page: res.page,
          pageSize: res.pageSize,
          total: res.total,
          totalPages: res.totalPages,
          hasPrev: res.hasPrev,
          hasNext: res.hasNext,
        });
        setError(null);
      })
      .catch((err: unknown) => {
        if (seq !== latest.current) return;
        setRows([]);
        setMeta({ ...EMPTY_PAGE, pageSize: query.pageSize });
        setError(err instanceof Error ? err.message : 'Could not load this list');
      })
      .finally(() => {
        if (seq === latest.current) setLoading(false);
      });
  }, [filterKey, query.page, query.pageSize, query.sort, query.dir, nonce]);

  return {
    rows,
    meta,
    loading,
    error,
    query,
    setPage: React.useCallback((page: number) => setQuery((q) => ({ ...q, page })), []),
    setPageSize: React.useCallback(
      (pageSize: number) => setQuery((q) => ({ ...q, pageSize, page: 1 })),
      [],
    ),
    setSort: React.useCallback(
      (sort: string, dir: SortDir) => setQuery((q) => ({ ...q, sort, dir, page: 1 })),
      [],
    ),
    reload: React.useCallback(() => setNonce((n) => n + 1), []),
  };
}

/** Debounces a search box so each keystroke is not a request. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
