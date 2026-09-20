import { useState } from 'react';
import { CalendarClock, RefreshCw } from 'lucide-react';

import { LICENSE_STATE_LABEL } from '@ifp/shared';
import { platformApi, type ExpiringLicense } from '@/api/endpoints';
import {
  EmptyState,
  ErrorState,
  PageBody,
  PageHeader,
  StatusBadge,
} from '@/components/app-ui';
import { DataTable, TableToolbar, type Column } from '@/components/data-table';
import { ExpiryText, PlanBadge } from '@/components/license-ui';
import { usePagedList } from '@/lib/use-paged-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Renewals.
 *
 * Everything the Firms screen shows, narrowed to the firms whose licence is
 * about to matter and ordered by how soon. It exists because the useful
 * question is never "list all firms" — it is "who do I have to call this
 * week", and answering that by sorting a 200-row table by eye is how a firm
 * goes read-only without anyone meaning it to.
 *
 * Firms with no end date never appear here. That is correct: there is nothing
 * to renew.
 */

const WINDOWS = [
  { value: '0', label: 'Already expired' },
  { value: '7', label: 'Within 7 days' },
  { value: '30', label: 'Within 30 days' },
  { value: '90', label: 'Within 90 days' },
];

export function PlatformLicensesPage() {
  const [withinDays, setWithinDays] = useState('30');

  const list = usePagedList<ExpiringLicense>({
    load: (params) => platformApi.expiring(params),
    filters: { withinDays: Number(withinDays) },
    // The endpoint offers exactly one ordering — expired first, then soonest —
    // and says so in its schema rather than accepting a sort it would ignore.
    sort: 'expiresAt',
    dir: 'asc',
  });

  const columns: Array<Column<ExpiringLicense>> = [
    {
      key: 'name',
      header: 'Firm',
      cell: (f) => (
        <>
          <span className="font-medium">{f.name}</span>
          <span className="block text-xs text-muted-foreground">{f.slug}</span>
        </>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (f) => <PlanBadge plan={f.plan} state={f.state} />,
    },
    {
      key: 'state',
      header: 'State',
      cell: (f) => (
        <span className={f.readOnly ? 'text-destructive' : undefined}>
          {LICENSE_STATE_LABEL[f.state]}
          {f.state === 'GRACE' && f.graceDaysRemaining !== null && (
            <span className="block text-xs text-muted-foreground">
              {f.graceDaysRemaining} day{f.graceDaysRemaining === 1 ? '' : 's'} of grace left
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'expires',
      header: 'Ends',
      cell: (f) => <ExpiryText license={f} />,
    },
    {
      key: 'contact',
      header: 'Contact',
      hideOnMobile: true,
      className: 'text-muted-foreground',
      cell: (f) => f.contactEmail ?? <span className="text-warning">none on file</span>,
    },
    {
      key: 'status',
      header: 'Firm status',
      hideOnMobile: true,
      cell: (f) => <StatusBadge status={f.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Renewals"
        subtitle="Licences that have ended, or are about to"
        actions={
          <Button variant="outline" size="icon" onClick={list.reload} aria-label="Refresh">
            <RefreshCw className={list.loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        }
      />

      <PageBody className="space-y-4">
        <Card className="overflow-hidden">
          <TableToolbar>
            <Select value={withinDays} onValueChange={setWithinDays}>
              <SelectTrigger className="w-[200px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </TableToolbar>

          <DataTable
            columns={columns}
            rows={list.rows}
            getRowId={(f) => f.id}
            loading={list.loading}
            meta={list.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            noun="licences"
            empty={
              list.error ? (
                <ErrorState title={list.error} />
              ) : (
                <EmptyState
                  icon={CalendarClock}
                  title="Nothing to renew in this window"
                  description="Firms with no end date are not listed here — there is nothing to renew."
                />
              )
            }
          />
        </Card>

        <Alert variant="info">
          <CalendarClock className="h-4 w-4" />
          <AlertTitle>What expiry actually does</AlertTitle>
          <AlertDescription>
            After the grace period the firm becomes read-only. Everyone can still sign in, open
            every case and export; nobody can create or change a record. Nothing is deleted or
            hidden. Change the licence from the Licence button on the Firms screen.
          </AlertDescription>
        </Alert>
      </PageBody>
    </>
  );
}
