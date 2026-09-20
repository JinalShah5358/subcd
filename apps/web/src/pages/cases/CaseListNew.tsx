import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, FileText, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

import {
  APPLICATION_TYPE,
  APPLICATION_TYPE_LABEL,
  CASE_STATUS,
  CASE_STATUS_LABEL,
  type ApplicationType,
  type CaseStatus,
} from '@ifp/shared';
import { ApiError } from '@/api/client';
import {
  casesApi,
  clientsApi,
  referenceApi,
  type CaseSummary,
  type ClientSummary,
  type SchemeWithVersions,
} from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import {
  EmptyState,
  ErrorState,
  PageBody,
  PageHeader,
  ReadinessMeter,
  StatusBadge,
  formatDate,
} from '@/components/app-ui';
import { ClearFilters, DataTable, TableToolbar, type Column } from '@/components/data-table';
import { useDebounced, usePagedList } from '@/lib/use-paged-list';
import { ComboboxField, SelectField, TextareaField } from '@/components/form-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = '__all__';

export function CaseListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [status, setStatus] = useState(ALL);
  const [applicationType, setApplicationType] = useState(ALL);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q);

  const list = usePagedList<CaseSummary>({
    load: (params) => casesApi.list(params),
    filters: {
      q: debouncedQ || undefined,
      status: status === ALL ? undefined : status,
      applicationType: applicationType === ALL ? undefined : applicationType,
    },
    sort: 'updatedAt',
    dir: 'desc',
  });

  const filtered = Boolean(debouncedQ) || status !== ALL || applicationType !== ALL;

  const columns: Array<Column<CaseSummary>> = [
    {
      key: 'caseNumber',
      header: 'Case',
      sortable: true,
      className: 'tabular font-medium',
      cell: (c) => c.caseNumber,
    },
    { key: 'client', header: 'Client', cell: (c) => c.client.legalName },
    {
      key: 'applicationType',
      header: 'Type',
      className: 'text-muted-foreground',
      hideOnMobile: true,
      cell: (c) =>
        APPLICATION_TYPE_LABEL[c.applicationType as ApplicationType] ?? c.applicationType,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      cell: (c) => <StatusBadge status={c.status} label={c.statusLabel} />,
    },
    {
      key: 'readinessScore',
      header: 'Readiness',
      sortable: true,
      headClassName: 'w-[170px]',
      hideOnMobile: true,
      cell: (c) => (
        <div className="flex items-center gap-2">
          <span className="tabular w-9 text-xs text-muted-foreground">{c.readinessScore}%</span>
          <ReadinessMeter value={c.readinessScore} className="flex-1" />
        </div>
      ),
    },
    {
      key: 'assignedTo',
      header: 'Assigned',
      className: 'text-muted-foreground',
      hideOnMobile: true,
      cell: (c) => c.assignedTo?.fullName ?? '—',
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (c) => formatDate(c.updatedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title="Cases"
        subtitle="One case is one subsidy application"
        actions={
          can('case:write') && (
            <Button onClick={() => navigate('/cases/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New case
            </Button>
          )
        }
      />

      <PageBody>
        <Card className="overflow-hidden">
          <TableToolbar>
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search case number or client…"
                className="bg-background pl-8"
                aria-label="Search cases"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[190px] bg-background">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {CASE_STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CASE_STATUS_LABEL[s as CaseStatus]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={applicationType} onValueChange={setApplicationType}>
              <SelectTrigger className="w-[200px] bg-background">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All application types</SelectItem>
                {APPLICATION_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {APPLICATION_TYPE_LABEL[t as ApplicationType]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ClearFilters
              show={filtered}
              onClear={() => {
                setQ('');
                setStatus(ALL);
                setApplicationType(ALL);
              }}
            />
          </TableToolbar>

          <DataTable
            columns={columns}
            rows={list.rows}
            getRowId={(c) => c.id}
            loading={list.loading}
            onRowClick={(c) => navigate(`/cases/${c.id}`)}
            sort={list.query.sort}
            dir={list.query.dir}
            onSortChange={list.setSort}
            meta={list.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            noun="cases"
            empty={
              list.error ? (
                <ErrorState title={list.error} description="Try again, or reload the page." />
              ) : filtered ? (
                <EmptyState
                  icon={FileText}
                  title="No cases match those filters"
                  description="Clear the search or the status filter to see everything again."
                />
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No cases yet"
                  description="Create a client first, then open a case against it."
                  action={
                    can('case:write') && (
                      <Button size="sm" onClick={() => navigate('/cases/new')}>
                        <Plus className="mr-2 h-4 w-4" />
                        New case
                      </Button>
                    )
                  }
                />
              )
            }
          />
        </Card>
      </PageBody>
    </>
  );
}

/* ------------------------------- new case ------------------------------- */

const newCaseSchema = z.object({
  clientId: z.string().min(1, 'Choose a client'),
  schemeVersionId: z.string().min(1, 'Choose a scheme version'),
  applicationType: z.string().min(1, 'Choose an application type'),
  duplicateOverrideReason: z.string().trim().max(500),
});

type NewCaseValues = z.infer<typeof newCaseSchema>;

export function CaseNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [schemes, setSchemes] = useState<SchemeWithVersions[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

  const form = useForm<NewCaseValues>({
    resolver: zodResolver(newCaseSchema),
    defaultValues: {
      clientId: params.get('clientId') ?? '',
      schemeVersionId: '',
      applicationType: 'CAPITAL_SUBSIDY',
      duplicateOverrideReason: '',
    },
  });

  useEffect(() => {
    void clientsApi
      .list({ limit: 100 })
      .then((r) => setClients(r.items))
      .catch(() => undefined);
    void referenceApi
      .schemes()
      .then((s) => {
        setSchemes(s);
        const first = s[0]?.versions[0];
        if (first) form.setValue('schemeVersionId', first.id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schemeVersionId = form.watch('schemeVersionId');
  const selectedVersion = schemes
    .flatMap((s) => s.versions.map((v) => ({ ...v, schemeName: s.name })))
    .find((v) => v.id === schemeVersionId);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await casesApi.create({
        clientId: values.clientId,
        schemeVersionId: values.schemeVersionId,
        applicationType: values.applicationType,
        duplicateOverrideReason: values.duplicateOverrideReason || undefined,
      });
      toast.success(`Case ${created.caseNumber} created`);
      navigate(`/cases/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError([err.message, err.problem.detail].filter(Boolean).join(' — '));
        if (err.status === 409) setConflictId(err.problem.conflictId ?? null);
      } else {
        setError('Could not create the case');
      }
    }
  });

  return (
    <>
      <PageHeader title="New case" subtitle="Pin a client to a scheme version" />

      <PageBody className="max-w-2xl">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate>
            <Card>
              <CardHeader>
                <CardTitle>Case details</CardTitle>
                <CardDescription>
                  The case is pinned to the scheme version you choose, so a later rule change
                  cannot silently rewrite its verdict.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{error}</AlertTitle>
                    {conflictId && (
                      <AlertDescription>
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0"
                          onClick={() => navigate(`/cases/${conflictId}`)}
                        >
                          Open the existing case
                        </Button>
                      </AlertDescription>
                    )}
                  </Alert>
                )}

                <ComboboxField
                  control={form.control}
                  name="clientId"
                  label="Client"
                  required
                  placeholder="Choose a client…"
                  searchPlaceholder="Search clients…"
                  emptyText="No clients found. Create one first."
                  options={clients.map((c) => ({
                    value: c.id,
                    label: c.legalName,
                    ...(c.panMasked ? { hint: c.panMasked } : {}),
                  }))}
                />

                <SelectField
                  control={form.control}
                  name="applicationType"
                  label="Application type"
                  required
                  options={APPLICATION_TYPE.map((t) => ({
                    value: t,
                    label: APPLICATION_TYPE_LABEL[t as ApplicationType],
                  }))}
                />

                <SelectField
                  control={form.control}
                  name="schemeVersionId"
                  label="Scheme version"
                  required
                  options={schemes.flatMap((s) =>
                    s.versions.map((v) => ({
                      value: v.id,
                      label: `${s.name} — ${v.versionLabel} (${v.status.toLowerCase()})`,
                    })),
                  )}
                />

                {selectedVersion?.unverified && (
                  <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>This scheme version has no cited source yet</AlertTitle>
                    <AlertDescription>
                      The case will be pinned to it, but eligibility rules that depend on the
                      governing resolution stay inactive until that resolution is read and cited.
                      Only structural checks will run.
                    </AlertDescription>
                  </Alert>
                )}

                {conflictId && (
                  <TextareaField
                    control={form.control}
                    name="duplicateOverrideReason"
                    label="Reason for creating a second case anyway"
                    description="Recorded on the case and in the audit log."
                  />
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Create case
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>
      </PageBody>
    </>
  );
}
