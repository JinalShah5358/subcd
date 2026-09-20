import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Globe2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldOff,
} from 'lucide-react';

import { LICENSE_STATE_LABEL } from '@ifp/shared';
import {
  platformApi,
  type ExpiringLicense,
  type PlatformFirmSummary,
  type PlatformTotals,
} from '@/api/endpoints';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageBody,
  PageHeader,
  StatCard,
  StatusBadge,
  formatDate,
  formatDateTime,
} from '@/components/app-ui';
import { ExpiryText, PlanBadge, QuotaCell } from '@/components/license-ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * The platform administrator's home.
 *
 * A separate screen rather than the case dashboard, because a platform
 * administrator has no cases: their tenant holds none by design, so the case
 * dashboard greeted them with three zeroes and no sign that the console they
 * signed in for existed.
 *
 * What belongs here is the work of running the service, in the order it
 * actually gets done: what needs attention today, then what changed recently,
 * then the totals. Totals last on purpose — a number that only ever goes up
 * is reassuring, not actionable.
 */

interface Data {
  totals: PlatformTotals;
  attention: ExpiringLicense[];
  recent: PlatformFirmSummary[];
  suspended: PlatformFirmSummary[];
}

export function PlatformOverviewPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      platformApi.totals(),
      platformApi.expiring({ withinDays: 30, page: 1, pageSize: 8, sort: 'expiresAt', dir: 'asc' }),
      platformApi.firms({ page: 1, pageSize: 5, sort: 'createdAt', dir: 'desc' }),
      platformApi.firms({ page: 1, pageSize: 5, sort: 'createdAt', dir: 'desc', status: 'SUSPENDED' }),
    ])
      .then(([totals, attention, recent, suspended]) =>
        setData({
          totals,
          attention: attention.items,
          recent: recent.items,
          suspended: suspended.items,
        }),
      )
      .catch(() => setError('Could not load the platform overview'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading && !data) return <LoadingState label="Loading the platform overview…" />;
  if (error) return <ErrorState title={error} />;
  if (!data) return null;

  const { totals, attention, recent, suspended } = data;
  const expired = attention.filter((f) => f.readOnly);

  return (
    <>
      <PageHeader
        title="Platform"
        subtitle="Running the service — firms, licences and nothing inside them"
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </Button>
            <Button asChild>
              <Link to="/platform/firms">
                <Plus className="mr-2 h-4 w-4" />
                Add a firm
              </Link>
            </Button>
          </>
        }
      />

      <PageBody className="space-y-4">
        {/* ---------------------- needs attention ---------------------- */}
        {expired.length > 0 && (
          <Alert variant="destructive">
            <ShieldOff className="h-4 w-4" />
            <AlertTitle>
              {expired.length} firm{expired.length === 1 ? ' is' : 's are'} read-only right now
            </AlertTitle>
            <AlertDescription>
              Their licences have lapsed past the grace period. They can still sign in, read and
              export everything on file; they cannot create or change a record until renewed.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Needs attention</CardTitle>
              <CardDescription>Licences that have ended or end within 30 days</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/platform/licenses">All renewals</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing to chase"
                description="No licence ends in the next 30 days. Firms with no end date never appear here."
              />
            ) : (
              <ul className="divide-y">
                {attention.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                    <span className="min-w-[160px] flex-1">
                      <span className="font-medium">{f.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {f.contactEmail ?? 'no contact email on file'}
                      </span>
                    </span>
                    <PlanBadge plan={f.plan} state={f.state} />
                    <span className={`text-sm ${f.readOnly ? 'text-destructive' : ''}`}>
                      {LICENSE_STATE_LABEL[f.state]}
                    </span>
                    <ExpiryText license={f} className="text-sm" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ------------------------- suspended ------------------------- */}
        {suspended.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Suspended</CardTitle>
              <CardDescription>
                Sign-in refused for everyone in these firms. Nothing was deleted, and it is
                reversible from the Firms screen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {suspended.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                    <span className="min-w-[160px] flex-1">
                      <span className="font-medium">{f.name}</span>
                      <span className="block text-xs text-muted-foreground">{f.slug}</span>
                    </span>
                    <StatusBadge status={f.status} />
                    <span className="text-xs text-muted-foreground">
                      {f.clientCount} client(s), {f.caseCount} case(s) untouched
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ----------------------- recently added ---------------------- */}
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Recently provisioned</CardTitle>
              <CardDescription>The newest firms on the platform</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/platform/firms">All firms</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No firms yet"
                description="Add the first firm and invite its administrator."
              />
            ) : (
              <ul className="divide-y">
                {recent.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                    <span className="min-w-[160px] flex-1">
                      <span className="font-medium">{f.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        added {formatDate(f.createdAt)} ·{' '}
                        {f.lastActiveAt ? (
                          `last sign-in ${formatDateTime(f.lastActiveAt)}`
                        ) : (
                          <span className="text-warning">never signed in</span>
                        )}
                      </span>
                    </span>
                    <PlanBadge plan={f.license.plan} state={f.license.state} />
                    <span className="text-sm">
                      <QuotaCell used={f.clientCount} limit={f.license.limits.clients} />
                      <span className="ml-1 text-xs text-muted-foreground">clients</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* -------------------------- totals --------------------------- */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Firms" value={totals.firmCount} hint="on the platform" />
          <StatCard
            label="Active"
            value={totals.activeFirms}
            hint="able to sign in"
            {...(totals.activeFirms > 0 ? { tone: 'success' as const } : {})}
          />
          <StatCard
            label="Suspended"
            value={totals.suspendedFirms}
            hint="sign-in refused"
            {...(totals.suspendedFirms > 0 ? { tone: 'warning' as const } : {})}
          />
          <StatCard label="Users" value={totals.userCount} hint="across all firms" />
        </div>

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>What this console can and cannot see</AlertTitle>
          <AlertDescription>
            Firm names, licences and counts — nothing else. This account holds one permission,{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">platform:admin</code>, and it is
            not a superset of the others: every client, case, document and audit route answers it
            with a refusal. The counts above come from database functions whose return types have
            no column a client record could arrive in.
          </AlertDescription>
        </Alert>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Globe2 className="h-3.5 w-3.5" />
          Licences are set by hand here. Nothing bills, and nothing renews on its own.
          <CalendarClock className="ml-auto h-3.5 w-3.5" />
        </p>
      </PageBody>
    </>
  );
}
