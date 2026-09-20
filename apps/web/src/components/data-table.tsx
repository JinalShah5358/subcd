import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';
import { EmptyState, TableSkeleton } from '@/components/app-ui';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * The list surface.
 *
 * Every list in the app renders through here, so sorting affordances, the
 * skeleton, the empty state, the "showing 26–50 of 213" line and the page
 * controls all behave identically. Each page used to hand-roll its own
 * <Table> and its own "Load more" button, which is how a Clients list and a
 * Cases list end up disagreeing about what an empty result looks like.
 */

export interface Column<T> {
  /** Also the sort key sent to the API when `sortable` is set. */
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  headClassName?: string;
  /** Hidden below `sm`. Use for columns a phone has no room for. */
  hideOnMobile?: boolean;
}

/** Mirrors the API's `Page<T>` envelope minus the rows. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export const EMPTY_PAGE: PageMeta = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
  hasPrev: false,
  hasNext: false,
};

export type SortDir = 'asc' | 'desc';

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Rendered in place of the rows when there are none and nothing failed. */
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  sort?: string;
  dir?: SortDir;
  onSortChange?: (sort: string, dir: SortDir) => void;
  meta?: PageMeta;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  /** Noun for the footer count line: "213 clients". */
  noun?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading,
  empty,
  onRowClick,
  sort,
  dir = 'desc',
  onSortChange,
  meta,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50, 100],
  noun = 'rows',
  className,
}: DataTableProps<T>) {
  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    // Re-clicking the active column flips direction; a new column starts
    // descending, which is what "most recent first" means for every date
    // column in this app.
    onSortChange(key, sort === key && dir === 'desc' ? 'asc' : 'desc');
  };

  return (
    <div className={cn('flex flex-col', className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={cn(
                  'whitespace-nowrap',
                  c.hideOnMobile && 'hidden sm:table-cell',
                  c.headClassName,
                )}
              >
                {c.sortable && onSortChange ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className="-ml-2 inline-flex items-center gap-1 rounded px-2 py-1 transition-colors hover:text-foreground"
                  >
                    {c.header}
                    {sort === c.key ? (
                      dir === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" />
                      )
                    ) : (
                      <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                    )}
                  </button>
                ) : (
                  c.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading && rows.length === 0 ? (
            <TableSkeleton cols={columns.length} />
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty ?? <EmptyState icon={Inbox} title="Nothing to show" />}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                // A clickable row is unreachable by keyboard unless it is
                // also focusable and answers Enter.
                {...(onRowClick
                  ? {
                      tabIndex: 0,
                      role: 'link',
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      },
                    }
                  : {})}
                className={cn(
                  onRowClick && 'cursor-pointer',
                  loading && 'opacity-60 transition-opacity',
                )}
              >
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn(c.hideOnMobile && 'hidden sm:table-cell', c.className)}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {meta && (
        <DataTablePagination
          meta={meta}
          noun={noun}
          pageSizes={pageSizes}
          {...(onPageChange ? { onPageChange } : {})}
          {...(onPageSizeChange ? { onPageSizeChange } : {})}
        />
      )}
    </div>
  );
}

/* ------------------------------ pagination ------------------------------ */

/**
 * Builds the page-button list: always the first and last page, a window around
 * the current one, and an ellipsis for the gaps. Without this a firm with 200
 * pages of audit entries renders 200 buttons.
 */
export function pageWindow(current: number, total: number, span = 1): Array<number | 'gap'> {
  if (total <= 1) return total === 1 ? [1] : [];
  const pages = new Set<number>([1, total]);
  for (let p = current - span; p <= current + span; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

export function DataTablePagination({
  meta,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50, 100],
  noun = 'rows',
}: {
  meta: PageMeta;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  noun?: string;
}) {
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.total);
  const windowed = pageWindow(meta.page, meta.totalPages);

  return (
    <div className="flex flex-col gap-3 border-t px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular">
          {meta.total === 0 ? (
            <>No {noun}</>
          ) : (
            <>
              Showing <strong className="font-medium text-foreground">{first}</strong>–
              <strong className="font-medium text-foreground">{last}</strong> of{' '}
              <strong className="font-medium text-foreground">{meta.total}</strong> {noun}
            </>
          )}
        </span>

        {onPageSizeChange && (
          <span className="hidden items-center gap-1.5 sm:flex">
            <span aria-hidden>·</span>
            <Select value={String(meta.pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger id="page-size" className="h-7 w-[72px] text-xs" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((s) => (
                  <SelectItem key={s} value={String(s)} className="text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>per page</span>
          </span>
        )}
      </div>

      {onPageChange && meta.totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                size="sm"
                disabled={!meta.hasPrev}
                onClick={() => onPageChange(meta.page - 1)}
              />
            </PaginationItem>

            {windowed.map((p, i) =>
              p === 'gap' ? (
                <PaginationItem key={`gap-${i}`}>
                  <PaginationEllipsis className="h-8 w-8" />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    size="sm"
                    className="h-8 w-8 p-0"
                    isActive={p === meta.page}
                    onClick={() => onPageChange(p)}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            <PaginationItem>
              <PaginationNext
                size="sm"
                disabled={!meta.hasNext}
                onClick={() => onPageChange(meta.page + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

/* -------------------------------- toolbar ------------------------------- */

/** The filter bar that sits above a DataTable inside the same Card. */
export function TableToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3 no-print', className)}
    >
      {children}
    </div>
  );
}

/** "Clear filters" — only rendered when a filter is actually set. */
export function ClearFilters({ show, onClear }: { show: boolean; onClear: () => void }) {
  if (!show) return null;
  return (
    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClear}>
      Clear filters
    </Button>
  );
}
