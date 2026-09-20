import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertTriangle,
  Building2,
  Loader2,
  Plus,
  RefreshCw,
  KeyRound,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  FIRM_STATUS,
  FIRM_STATUS_LABEL,
  LICENSE_PLANS,
  LICENSE_PLAN_LABEL,
  defaultExpiryFor,
  type FirmStatus,
  type LicensePlan,
} from '@ifp/shared';
import { ApiError } from '@/api/client';
import {
  platformApi,
  type PlatformFirmSummary,
  type PlatformTotals,
} from '@/api/endpoints';
import {
  EmptyState,
  ErrorState,
  PageBody,
  PageHeader,
  StatCard,
  StatusBadge,
  formatDateTime,
} from '@/components/app-ui';
import { ClearFilters, DataTable, TableToolbar, type Column } from '@/components/data-table';
import { useDebounced, usePagedList } from '@/lib/use-paged-list';
import { DateField, SelectField, TextField, TextareaField } from '@/components/form-fields';
import { ExpiryText, PlanBadge, QuotaCell } from '@/components/license-ui';
import { LicenseDialog } from './LicenseDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

const ALL = '__all__';

/**
 * The platform console.
 *
 * Everything on this screen is firm metadata: names, status, counts, when
 * someone last signed in. There is no route from here into a firm's clients or
 * cases, and that is not a UI omission — the API has no endpoint that would
 * return them, because the underlying database functions cannot.
 */
export function PlatformFirmsPage() {
  const [totals, setTotals] = useState<PlatformTotals | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusTarget, setStatusTarget] = useState<PlatformFirmSummary | null>(null);
  const [licenseTarget, setLicenseTarget] = useState<PlatformFirmSummary | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(ALL);
  const debouncedQ = useDebounced(q);

  const list = usePagedList<PlatformFirmSummary>({
    load: (params) => platformApi.firms(params),
    filters: {
      q: debouncedQ || undefined,
      status: status === ALL ? undefined : status,
    },
    sort: 'createdAt',
    dir: 'desc',
  });

  const loadTotals = useCallback(() => {
    void platformApi
      .totals()
      .then(setTotals)
      .catch(() => setTotals(null));
  }, []);

  useEffect(loadTotals, [loadTotals]);

  const reloadAll = () => {
    list.reload();
    loadTotals();
  };

  const filtered = Boolean(debouncedQ) || status !== ALL;

  const columns: Array<Column<PlatformFirmSummary>> = [
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
      key: 'status',
      header: 'Status',
      cell: (f) => <StatusBadge status={f.status} />,
    },
    {
      key: 'plan',
      header: 'Licence',
      cell: (f) => <PlanBadge plan={f.license.plan} state={f.license.state} />,
    },
    {
      key: 'expires',
      header: 'Valid until',
      hideOnMobile: true,
      cell: (f) => <ExpiryText license={f.license} />,
    },
    {
      key: 'users',
      header: 'Users',
      headClassName: 'text-right',
      className: 'text-right',
      cell: (f) => <QuotaCell used={f.userCount} limit={f.license.limits.users} />,
    },
    {
      key: 'clients',
      header: 'Clients',
      headClassName: 'text-right',
      className: 'text-right',
      hideOnMobile: true,
      cell: (f) => <QuotaCell used={f.clientCount} limit={f.license.limits.clients} />,
    },
    {
      key: 'cases',
      header: 'Cases',
      headClassName: 'text-right',
      className: 'text-right',
      hideOnMobile: true,
      cell: (f) => <QuotaCell used={f.caseCount} limit={f.license.limits.cases} />,
    },
    {
      key: 'lastActive',
      header: 'Last sign-in',
      className: 'whitespace-nowrap text-muted-foreground',
      hideOnMobile: true,
      cell: (f) =>
        f.lastActiveAt ? (
          formatDateTime(f.lastActiveAt)
        ) : (
          <span className="text-warning">never</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-[200px]',
      className: 'text-right',
      cell: (f) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setLicenseTarget(f)}>
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            Licence
          </Button>
          <Button
            size="sm"
            variant={f.status === 'ACTIVE' ? 'ghost' : 'outline'}
            className={f.status === 'ACTIVE' ? 'text-destructive hover:text-destructive' : ''}
            onClick={() => setStatusTarget(f)}
          >
            {f.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Firms"
        subtitle="Every tenant on this platform"
        actions={
          <>
            <Button variant="outline" size="icon" onClick={reloadAll} aria-label="Refresh">
              <RefreshCw className={list.loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add a firm
            </Button>
          </>
        }
      />

      <PageBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Firms" value={totals?.firmCount ?? '—'} hint="on the platform" />
          <StatCard
            label="Active"
            value={totals?.activeFirms ?? '—'}
            hint="able to sign in"
            {...((totals?.activeFirms ?? 0) > 0 ? { tone: 'success' as const } : {})}
          />
          <StatCard
            label="Suspended"
            value={totals?.suspendedFirms ?? '—'}
            hint="sign-in refused"
            {...((totals?.suspendedFirms ?? 0) > 0 ? { tone: 'warning' as const } : {})}
          />
          <StatCard label="Users" value={totals?.userCount ?? '—'} hint="across all firms" />
        </div>

        <Card className="overflow-hidden">
          <TableToolbar>
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, slug or FRN…"
                className="bg-background pl-8"
                aria-label="Search firms"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[170px] bg-background">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {FIRM_STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {FIRM_STATUS_LABEL[s as FirmStatus]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ClearFilters
              show={filtered}
              onClear={() => {
                setQ('');
                setStatus(ALL);
              }}
            />
          </TableToolbar>

          <DataTable
            columns={columns}
            rows={list.rows}
            getRowId={(f) => f.id}
            loading={list.loading}
            meta={list.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            noun="firms"
            empty={
              list.error ? (
                <ErrorState title={list.error} />
              ) : (
                <EmptyState
                  icon={Building2}
                  title={filtered ? 'No firms match those filters' : 'No firms yet'}
                  description={
                    filtered ? undefined : 'Add the first firm and invite its administrator.'
                  }
                />
              )
            }
          />
        </Card>

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>What this console can and cannot see</AlertTitle>
          <AlertDescription>
            Firm names, status and counts — nothing else. There is no endpoint here that returns a
            client, a case, an identifier or a document, and the database functions this screen
            reads through cannot return them either. Suspending a firm refuses sign-in for
            everyone in it; it deletes nothing and is reversible.
          </AlertDescription>
        </Alert>
      </PageBody>

      {creating && (
        <CreateFirmDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            reloadAll();
          }}
        />
      )}

      {licenseTarget && (
        <LicenseDialog
          firm={licenseTarget}
          onClose={() => setLicenseTarget(null)}
          onDone={() => {
            setLicenseTarget(null);
            reloadAll();
          }}
        />
      )}

      {statusTarget && (
        <StatusDialog
          firm={statusTarget}
          onClose={() => setStatusTarget(null)}
          onDone={() => {
            setStatusTarget(null);
            reloadAll();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------ create firm ----------------------------- */

const createFirmForm = z.object({
  name: z.string().trim().min(1, 'Firm name is required').max(200),
  slug: z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and single hyphens only'),
  frn: z.string().trim().max(32),
  contactEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email'),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  dataRegion: z.string().trim().min(1),
  adminEmail: z.string().trim().min(1, 'Required').email('Enter a valid email address'),
  adminFullName: z.string().trim().min(1, 'Required').max(160),
  plan: z.enum(LICENSE_PLANS),
  expiresAt: z.string().trim(),
});

/** Derives a slug from the firm name, the way a person would. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function CreateFirmDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);

  const form = useForm<z.infer<typeof createFirmForm>>({
    resolver: zodResolver(createFirmForm),
    defaultValues: {
      name: '',
      slug: '',
      frn: '',
      contactEmail: '',
      city: '',
      state: 'Gujarat',
      dataRegion: 'in-west',
      adminEmail: '',
      adminFullName: '',
      plan: 'TRIAL' as LicensePlan,
      expiresAt: defaultExpiryFor('TRIAL', new Date()) ?? '',
    },
  });

  // Same idea for the licence end date: follow the plan until a human
  // overrides it, then stop interfering.
  const plan = form.watch('plan');
  useEffect(() => {
    if (!expiryTouched) form.setValue('expiresAt', defaultExpiryFor(plan, new Date()) ?? '');
  }, [plan, expiryTouched, form]);

  // Keep the slug in step with the name until someone edits it themselves.
  const name = form.watch('name');
  useEffect(() => {
    if (!slugTouched) form.setValue('slug', slugify(name), { shouldValidate: Boolean(name) });
  }, [name, slugTouched, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const { plan: chosenPlan, expiresAt, ...firm } = values;
      const created = await platformApi.createFirm({
        ...firm,
        license: { plan: chosenPlan, expiresAt: expiresAt === '' ? null : expiresAt },
      });
      toast.success(`${created.name} created`, {
        description: `An invitation was sent to ${created.invitation.email}.`,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? [err.message, err.problem.detail].filter(Boolean).join(' — ')
          : 'Could not create the firm',
      );
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a firm</DialogTitle>
          <DialogDescription>
            The firm and its first administrator are created together. They receive a single-use
            invitation link and set their own password — you never see or choose it.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="name"
                label="Firm name"
                required
                autoFocus
                className="sm:col-span-2"
              />
              <div className="sm:col-span-2" onInput={() => setSlugTouched(true)}>
                <TextField
                  control={form.control}
                  name="slug"
                  label="Slug"
                  required
                  description="Used in URLs and the audit trail. It cannot be changed afterwards."
                />
              </div>
              <TextField control={form.control} name="frn" label="ICAI registration number" />
              <TextField
                control={form.control}
                name="contactEmail"
                label="Firm contact email"
                type="email"
              />
              <TextField control={form.control} name="city" label="City" />
              <TextField control={form.control} name="state" label="State" />
              <SelectField
                control={form.control}
                name="dataRegion"
                label="Data region"
                required
                options={[{ value: 'in-west', label: 'in-west (Mumbai)' }]}
                description="Only one region is provisioned today."
              />
            </div>

            <Separator />

            <div>
              <p className="text-sm font-medium">Licence</p>
              <p className="mb-3 text-xs text-muted-foreground">
                The plan fills in its usual limits, which you can change any time from the Licence
                button on this firm&apos;s row.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  control={form.control}
                  name="plan"
                  label="Plan"
                  required
                  options={LICENSE_PLANS.map((pl) => ({
                    value: pl,
                    label: LICENSE_PLAN_LABEL[pl],
                  }))}
                />
                <div onInput={() => setExpiryTouched(true)}>
                  <DateField
                    control={form.control}
                    name="expiresAt"
                    label="Valid until"
                    description="Empty means no end date."
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                When the licence lapses the firm becomes read-only — still able to sign in, read
                and export, but not to create or change records.
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-sm font-medium">First administrator</p>
              <p className="mb-3 text-xs text-muted-foreground">
                They will be able to invite the rest of the firm once they are in.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="adminFullName"
                  label="Full name"
                  required
                />
                <TextField
                  control={form.control}
                  name="adminEmail"
                  label="Email"
                  type="email"
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create firm and invite
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- suspend / restore -------------------------- */

const statusForm = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(500),
});

function StatusDialog({
  firm,
  onClose,
  onDone,
}: {
  firm: PlatformFirmSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const suspending = firm.status === 'ACTIVE';
  const nextStatus = suspending ? 'SUSPENDED' : 'ACTIVE';

  const form = useForm<z.infer<typeof statusForm>>({
    resolver: zodResolver(statusForm),
    defaultValues: { reason: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await platformApi.setFirmStatus(firm.id, { status: nextStatus, reason: values.reason });
      toast.success(suspending ? `${firm.name} suspended` : `${firm.name} reactivated`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the status');
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {suspending ? `Suspend ${firm.name}?` : `Reactivate ${firm.name}?`}
          </DialogTitle>
          <DialogDescription>
            {suspending
              ? `All ${firm.userCount} user(s) in this firm will be refused sign-in immediately.`
              : 'Everyone in this firm will be able to sign in again.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            {suspending ? (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Nothing is deleted</AlertTitle>
                <AlertDescription>
                  This firm&apos;s {firm.clientCount} client(s) and {firm.caseCount} case(s) stay
                  exactly where they are. Suspension only refuses sign-in, and it can be undone
                  from this same screen.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="info">
                <ShieldCheck className="h-4 w-4" />
                <AlertDescription>
                  Their data was never touched, so the firm returns to exactly the state it was in.
                </AlertDescription>
              </Alert>
            )}

            <TextareaField
              control={form.control}
              name="reason"
              label="Reason"
              required
              autoFocus
              description="Recorded in the audit trail. Write it for whoever reads this in six months."
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={suspending ? 'destructive' : 'default'}
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {suspending ? 'Suspend firm' : 'Reactivate firm'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
