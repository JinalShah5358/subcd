import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, Info, Plus, Users2 } from 'lucide-react';

import { casesApi, clientsApi, type CaseSummary } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import {
  EmptyState,
  PageBody,
  PageHeader,
  ReadinessMeter,
  StatCard,
  StatusBadge,
  formatDate,
} from '@/components/app-ui';
import { DataTable, type Column } from '@/components/data-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Counts {
  drafts: number | null;
  inReview: number | null;
  readyToFile: number | null;
  clients: number | null;
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [counts, setCounts] = useState<Counts>({
    drafts: null,
    inReview: null,
    readyToFile: null,
    clients: null,
  });
  const [loading, setLoading] = useState(true);

  /**
   * Each tile asks the API for one row and reads `total` off the envelope.
   *
   * The previous version counted statuses inside the ten most recent cases,
   * so a firm with sixty drafts saw "3". A number on a dashboard is either
   * the real number or it is misinformation; there is no useful middle.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const count = (params: Record<string, string | number>) =>
        casesApi
          .list({ ...params, pageSize: 1 })
          .then((r) => r.total)
          .catch(() => null);

      const [recent, drafts, inReview, readyToFile, clients] = await Promise.all([
        casesApi
          .list({ pageSize: 8, sort: 'updatedAt', dir: 'desc' })
          .then((r) => r.items)
          .catch(() => []),
        count({ status: 'DRAFT' }),
        count({ status: 'IN_REVIEW' }),
        count({ status: 'READY_TO_FILE' }),
        clientsApi
          .list({ pageSize: 1 })
          .then((r) => r.total)
          .catch(() => null),
      ]);

      if (cancelled) return;
      setCases(recent);
      setCounts({ drafts, inReview, readyToFile, clients });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = user?.fullName?.split(' ')[0] ?? '';
  const show = (n: number | null) => (n === null ? '—' : n);

  const columns: Array<Column<CaseSummary>> = [
    {
      key: 'caseNumber',
      header: 'Case',
      className: 'tabular font-medium',
      cell: (c) => c.caseNumber,
    },
    { key: 'client', header: 'Client', cell: (c) => c.client.legalName },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => <StatusBadge status={c.status} label={c.statusLabel} />,
    },
    {
      key: 'readiness',
      header: 'Readiness',
      headClassName: 'w-[150px]',
      hideOnMobile: true,
      cell: (c) => <ReadinessMeter value={c.readinessScore} />,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      className: 'whitespace-nowrap text-muted-foreground',
      hideOnMobile: true,
      cell: (c) => formatDate(c.updatedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        subtitle={user?.firm.name}
        actions={
          can('case:write') && (
            <Button onClick={() => navigate('/cases/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New case
            </Button>
          )
        }
      />

      <PageBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Drafts" value={show(counts.drafts)} hint="being prepared" />
          <StatCard label="In review" value={show(counts.inReview)} hint="awaiting checks" />
          <StatCard
            label="Ready to file"
            value={show(counts.readyToFile)}
            hint="checks passed — you can file these"
            {...((counts.readyToFile ?? 0) > 0 ? { tone: 'success' as const } : {})}
          />
          <StatCard label="Clients" value={show(counts.clients)} hint="on file" />
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent cases</CardTitle>
              <CardDescription>Most recently updated first</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/cases')}>
              View all
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </CardHeader>

          <DataTable
            columns={columns}
            rows={cases}
            getRowId={(c) => c.id}
            loading={loading}
            onRowClick={(c) => navigate(`/cases/${c.id}`)}
            empty={
              <EmptyState
                icon={FileText}
                title="No cases yet"
                description="Create a client first, then open a case against it."
                action={
                  can('client:write') && (
                    <Button size="sm" onClick={() => navigate('/clients/new')}>
                      <Users2 className="mr-2 h-4 w-4" />
                      Add a client
                    </Button>
                  )
                }
              />
            }
          />
        </Card>

        <Alert variant="warning">
          <Info className="h-4 w-4" />
          <AlertTitle>This platform does not file anything for you</AlertTitle>
          <AlertDescription>
            It prepares and checks case data. Submitting on the government portal — logging in,
            solving the CAPTCHA and pressing submit — remains entirely with the CA.
          </AlertDescription>
        </Alert>
      </PageBody>
    </>
  );
}
