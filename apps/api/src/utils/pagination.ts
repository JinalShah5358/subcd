import type { Page } from '@ifp/shared';

export interface PageArgs {
  page: number;
  pageSize: number;
}

/** Prisma `skip`/`take` for a 1-based page number. */
export function pageSlice(q: PageArgs): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

/**
 * Wraps a page of rows in the response envelope.
 *
 * The count and the page are two statements, so a row inserted between them
 * can shift `total` by one relative to `items`. That is a page-based
 * pagination trade-off, not a bug to paper over: nothing here depends on the
 * two being transactionally identical, and the alternative — holding a
 * transaction open across both — costs more than the discrepancy is worth.
 *
 * Asking for a page past the end returns an empty `items` with the real
 * `total`, which lets the client clamp rather than guess.
 */
export function toPage<T>(items: T[], total: number, q: PageArgs): Page<T> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / q.pageSize);
  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages,
    hasPrev: q.page > 1,
    hasNext: q.page < totalPages,
  };
}
