import { AlertTriangle, Clock, Lock, ShieldCheck } from 'lucide-react';
import {
  LICENSE_PLAN_LABEL,
  LICENSE_STATE_LABEL,
  type LicensePlan,
  type LicenseState,
} from '@ifp/shared';
import type { LicenseView } from '@/api/endpoints';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * How a licence looks on screen.
 *
 * Nothing here decides anything. `state`, `readOnly` and the day counts all
 * arrive from the API, which derives them from the same shared function that
 * decides whether to accept a write. A component that worked out "expired"
 * for itself would eventually disagree with the server, and the user would be
 * the one who found out.
 */

const STATE_TONE: Record<LicenseState, 'muted' | 'info' | 'warning' | 'danger'> = {
  VALID: 'muted',
  EXPIRING_SOON: 'info',
  GRACE: 'warning',
  READ_ONLY: 'danger',
};

export function PlanBadge({ plan, state }: { plan: LicensePlan; state: LicenseState }) {
  return (
    <Badge variant={STATE_TONE[state]} className="whitespace-nowrap">
      {LICENSE_PLAN_LABEL[plan]}
    </Badge>
  );
}

/** The expiry date, phrased by how close it is. */
export function ExpiryText({
  license,
  className,
}: {
  license: Pick<LicenseView, 'state' | 'expiresAt' | 'daysRemaining' | 'graceDaysRemaining'>;
  className?: string;
}) {
  if (!license.expiresAt) {
    return <span className={cn('text-muted-foreground', className)}>No end date</span>;
  }

  const days = license.daysRemaining ?? 0;
  const tone =
    license.state === 'READ_ONLY'
      ? 'text-destructive'
      : license.state === 'GRACE'
        ? 'text-warning'
        : license.state === 'EXPIRING_SOON'
          ? 'text-warning'
          : 'text-muted-foreground';

  const phrase =
    days > 1
      ? `in ${days} days`
      : days === 1
        ? 'tomorrow'
        : days === 0
          ? 'today'
          : `${-days} day${days === -1 ? '' : 's'} ago`;

  return (
    <span className={cn('whitespace-nowrap', tone, className)}>
      <span className="tabular">{license.expiresAt}</span>
      <span className="block text-xs opacity-80">{phrase}</span>
    </span>
  );
}

/** `18 / 250`, or `41` when that quota is unlimited. */
export function QuotaCell({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <span className="tabular">
        {used} <span className="text-muted-foreground">/ ∞</span>
      </span>
    );
  }
  const full = used >= limit;
  const near = !full && limit > 0 && used / limit >= 0.9;
  return (
    <span className={cn('tabular', full && 'font-semibold text-destructive', near && 'text-warning')}>
      {used} <span className="opacity-70">/ {limit}</span>
    </span>
  );
}

/**
 * The banner a firm sees about its own licence.
 *
 * Silent while the licence is comfortably valid — a permanent notice about a
 * licence that expires in March is noise in September, and noise is what
 * people learn to click past before the one that mattered.
 */
export function LicenseBanner({ license }: { license: LicenseView }) {
  if (license.state === 'VALID') return null;

  if (license.state === 'READ_ONLY') {
    return (
      <Alert variant="destructive" className="no-print">
        <Lock className="h-4 w-4" />
        <AlertTitle>This firm&apos;s licence has expired — the app is read-only</AlertTitle>
        <AlertDescription>
          Everything on file is still here and still readable, and you can export it. Creating or
          changing a client, a case or a user needs a renewed licence. The licence ended on{' '}
          {license.expiresAt}.
        </AlertDescription>
      </Alert>
    );
  }

  if (license.state === 'GRACE') {
    return (
      <Alert variant="warning" className="no-print">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>
          The licence expired on {license.expiresAt} — {license.graceDaysRemaining} day
          {license.graceDaysRemaining === 1 ? '' : 's'} of grace left
        </AlertTitle>
        <AlertDescription>
          Nothing has changed yet. When the grace period ends the app becomes read-only: you will
          still be able to read and export every case, but not create or change one.
        </AlertDescription>
      </Alert>
    );
  }

  const days = license.daysRemaining ?? 0;
  return (
    <Alert variant="info" className="no-print">
      <Clock className="h-4 w-4" />
      <AlertTitle>
        The licence ends {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} (
        {license.expiresAt})
      </AlertTitle>
      <AlertDescription>
        After that there is a {license.graceDays}-day grace period, and then the app becomes
        read-only until it is renewed.
      </AlertDescription>
    </Alert>
  );
}

/** A compact summary for the firm settings page. */
export function LicenseSummaryCard({ license }: { license: LicenseView }) {
  const rows: Array<[string, number, number | null]> = [
    ['Team members', license.used.users, license.limits.users],
    ['Clients', license.used.clients, license.limits.clients],
    ['Cases', license.used.cases, license.limits.cases],
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlanBadge plan={license.plan} state={license.state} />
        <span className="text-sm text-muted-foreground">
          {LICENSE_STATE_LABEL[license.state]}
        </span>
        {license.state === 'VALID' && !license.expiresAt && (
          <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
        )}
      </div>

      <dl className="grid gap-2 sm:grid-cols-3">
        {rows.map(([label, used, limit]) => (
          <div key={label} className="rounded-md border bg-muted/40 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-0.5 text-lg">
              <QuotaCell used={used} limit={limit} />
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-muted-foreground">
        {license.expiresAt
          ? `Valid until ${license.expiresAt}, then a ${license.graceDays}-day grace period.`
          : 'This licence has no end date.'}{' '}
        Only a platform administrator can change it.
      </p>
    </div>
  );
}
