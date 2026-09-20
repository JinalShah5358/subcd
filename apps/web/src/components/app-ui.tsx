import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

/* ------------------------------ page chrome ---------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A breadcrumb-style trail rendered above the title. */
  back?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          {back && <div className="mb-1 no-print">{back}</div>}
          <h1 className="truncate text-xl font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl p-4 pb-12 sm:p-6 sm:pb-16', className)}>
      {children}
    </div>
  );
}

/* -------------------------------- status ------------------------------- */

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'info' | 'muted' | 'danger';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  // case
  DRAFT: 'muted',
  IN_REVIEW: 'info',
  READY_TO_FILE: 'warning',
  FILED: 'info',
  ACKNOWLEDGED: 'info',
  QUERY_RAISED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'muted',
  ARCHIVED: 'muted',
  // user
  ACTIVE: 'success',
  INVITED: 'warning',
  DISABLED: 'danger',
  // document slot
  REQUIRED: 'warning',
  PRESENT: 'success',
  NOT_AVAILABLE: 'danger',
  NOT_APPLICABLE: 'muted',
  // verification
  VERIFIED: 'success',
  UNVERIFIED: 'muted',
  QUERY: 'warning',
  // audit outcome
  SUCCESS: 'success',
  FAILURE: 'danger',
  DENIED: 'danger',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'muted'} className="whitespace-nowrap font-medium">
      {label ?? status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: 'BLOCKING' | 'WARNING' | 'INFO' }) {
  const variant: BadgeVariant =
    severity === 'BLOCKING' ? 'danger' : severity === 'WARNING' ? 'warning' : 'info';
  return (
    <Badge variant={variant} className="font-medium">
      {severity.toLowerCase()}
    </Badge>
  );
}

/* --------------------------------- stats ------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  tone,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'danger' | 'warning' | 'success';
  children?: ReactNode;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-1.5">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'tabular text-2xl font-semibold leading-none',
            tone === 'danger' && 'text-destructive',
            tone === 'warning' && 'text-warning',
            tone === 'success' && 'text-success',
          )}
        >
          {value}
        </div>
        {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
        {children && <div className="mt-2">{children}</div>}
      </CardContent>
    </Card>
  );
}

export function ReadinessMeter({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <Progress
      value={clamped}
      aria-label={`${clamped}% ready`}
      className={cn('h-2', className)}
      indicatorClassName={cn(
        clamped >= 80 ? 'bg-success' : clamped >= 50 ? 'bg-warning' : 'bg-destructive',
      )}
    />
  );
}

/* -------------------------------- states ------------------------------- */

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: typeof Inbox;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="rounded-full border bg-muted/60 p-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-14 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} className="hover:bg-transparent">
          {Array.from({ length: cols }).map((__, c) => (
            <TableCell key={c}>
              {/* Varying widths so the placeholder reads as content rather
                  than as a broken grid. */}
              <Skeleton
                className="h-4"
                style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%`, maxWidth: 180 }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function ErrorState({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={<span className="text-destructive">{title}</span>}
      {...(description ? { description } : {})}
    />
  );
}

/* ------------------------------ definition ----------------------------- */

export function DescriptionList({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-4',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {children}
    </dl>
  );
}

export function DescriptionItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className="mt-1 break-words text-sm">{children}</dd>
    </div>
  );
}

/* ------------------------------ formatting ----------------------------- */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/* ------------------------------ breadcrumbs ---------------------------- */

/**
 * The trail above a detail-page title.
 *
 * A case sits three levels deep and is usually reached from a search result,
 * so "where am I and how do I get back to the list" is a real question. The
 * last entry is the current page and is not a link.
 */
export function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-xs">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${item.label}-${i}`}>
              <BreadcrumbItem>
                {last || !item.to ? (
                  <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={item.to}>{item.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
