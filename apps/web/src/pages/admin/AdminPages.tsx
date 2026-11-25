import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { ASSIGNABLE_ROLE_KEYS, ROLE_LABEL, type RoleKey } from '@ifp/shared';
import { ApiError } from '@/api/client';
import { adminApi, type AuditRow, type FirmProfile, type FirmUser } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageBody,
  PageHeader,
  StatCard,
  StatusBadge,
  formatDateTime,
  titleCase,
} from '@/components/app-ui';
import { LicenseSummaryCard } from '@/components/license-ui';
import { ClearFilters, DataTable, TableToolbar, type Column } from '@/components/data-table';
import { useDebounced, usePagedList } from '@/lib/use-paged-list';
import { SelectField, TextField } from '@/components/form-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/* -------------------------------- users --------------------------------- */

const ALL = '__all__';

export function UsersPage() {
  const { user: me } = useAuth();
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof adminApi.invitations>>>([]);
  const [inviting, setInviting] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(ALL);
  const [roleKey, setRoleKey] = useState(ALL);
  const debouncedQ = useDebounced(q);

  const list = usePagedList<FirmUser>({
    load: (params) => adminApi.users(params),
    filters: {
      q: debouncedQ || undefined,
      status: status === ALL ? undefined : status,
      roleKey: roleKey === ALL ? undefined : roleKey,
    },
    sort: 'fullName',
    dir: 'asc',
  });

  const loadInvites = useCallback(() => {
    void adminApi
      .invitations()
      .then(setInvites)
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : 'Could not load invitations'),
      );
  }, []);

  useEffect(loadInvites, [loadInvites]);

  const reloadAll = () => {
    list.reload();
    loadInvites();
  };

  const changeRole = async (u: FirmUser, next: string) => {
    try {
      await adminApi.updateUser(u.id, { roleKey: next });
      toast.success(`${u.fullName} is now ${ROLE_LABEL[next as RoleKey]}`);
      list.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change the role');
    }
  };

  const toggle = async (u: FirmUser) => {
    try {
      if (u.status === 'DISABLED') await adminApi.enableUser(u.id);
      else await adminApi.disableUser(u.id);
      toast.success(u.status === 'DISABLED' ? 'User enabled' : 'User disabled — sessions ended');
      list.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the user');
    }
  };

  const filtered = Boolean(debouncedQ) || status !== ALL || roleKey !== ALL;

  const columns: Array<Column<FirmUser>> = [
    {
      key: 'fullName',
      header: 'Name',
      sortable: true,
      cell: (u) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{u.fullName}</span>
          {u.id === me?.id && <Badge variant="info">you</Badge>}
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      className: 'text-muted-foreground',
      cell: (u) => u.email,
    },
    {
      key: 'role',
      header: 'Role',
      headClassName: 'w-[210px]',
      cell: (u) => (
        <Select
          value={u.role.key}
          disabled={u.id === me?.id}
          onValueChange={(v) => void changeRole(u, v)}
        >
          {/* The row is clickable-free here, but the select still lives inside
              it — stop the click so opening the menu is not also a row event. */}
          <SelectTrigger className="h-8" onClick={(e) => e.stopPropagation()}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNABLE_ROLE_KEYS.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    { key: 'status', header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
    {
      key: 'lastLoginAt',
      header: 'Last signed in',
      sortable: true,
      className: 'whitespace-nowrap text-muted-foreground',
      hideOnMobile: true,
      cell: (u) => formatDateTime(u.lastLoginAt),
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-[100px]',
      className: 'text-right',
      cell: (u) =>
        u.id === me?.id ? null : (
          <Button
            size="sm"
            variant={u.status === 'DISABLED' ? 'outline' : 'ghost'}
            className={u.status === 'DISABLED' ? '' : 'text-destructive hover:text-destructive'}
            onClick={() => void toggle(u)}
          >
            {u.status === 'DISABLED' ? 'Enable' : 'Disable'}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Everyone in your firm with access"
        actions={
          <>
            <Button variant="outline" size="icon" onClick={reloadAll} aria-label="Refresh">
              <RefreshCw className={list.loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </Button>
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite someone
            </Button>
          </>
        }
      />

      <PageBody className="space-y-4">
        <Card className="overflow-hidden">
          <TableToolbar>
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or email…"
                className="bg-background pl-8"
                aria-label="Search users"
              />
            </div>
            <Select value={roleKey} onValueChange={setRoleKey}>
              <SelectTrigger className="w-[190px] bg-background">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                {ASSIGNABLE_ROLE_KEYS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[150px] bg-background">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {['ACTIVE', 'INVITED', 'DISABLED'].map((s) => (
                  <SelectItem key={s} value={s}>
                    {titleCase(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ClearFilters
              show={filtered}
              onClear={() => {
                setQ('');
                setStatus(ALL);
                setRoleKey(ALL);
              }}
            />
          </TableToolbar>

          <DataTable
            columns={columns}
            rows={list.rows}
            getRowId={(u) => u.id}
            loading={list.loading}
            sort={list.query.sort}
            dir={list.query.dir}
            onSortChange={list.setSort}
            meta={list.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            noun="users"
            empty={
              list.error ? (
                <ErrorState title={list.error} />
              ) : (
                <EmptyState
                  icon={Users}
                  title={filtered ? 'No users match those filters' : 'No users yet'}
                />
              )
            }
          />
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Links are single-use and valid for 7 days</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {invites.length === 0 ? (
              <EmptyState title="No pending invitations" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-[90px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.email}</TableCell>
                      <TableCell>{i.fullName}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {i.role.name}
                      </TableCell>
                      <TableCell>
                        {i.expired ? (
                          <Badge variant="danger">expired</Badge>
                        ) : (
                          <span className="whitespace-nowrap text-muted-foreground">
                            {formatDateTime(i.expiresAt)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await adminApi.revokeInvite(i.id);
                              toast.success('Invitation revoked');
                              loadInvites();
                            } catch (err) {
                              toast.error(
                                err instanceof ApiError ? err.message : 'Could not revoke it',
                              );
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>What each role can do</AlertTitle>
          <AlertDescription>
            Staff do data entry: they cannot reveal identifiers, record consent, waive findings or
            move a case toward filing. Reviewers are read-only. Disabling a user ends their
            sessions immediately, not when their token expires.
          </AlertDescription>
        </Alert>
      </PageBody>

      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onDone={() => {
            setInviting(false);
            reloadAll();
          }}
        />
      )}
    </>
  );
}

const inviteFormSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  fullName: z.string().trim().min(1, 'Full name is required').max(160),
  roleKey: z.string().min(1, 'Choose a role'),
});

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof inviteFormSchema>>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: '', fullName: '', roleKey: 'STAFF' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await adminApi.invite(values);
      toast.success(`Invitation sent to ${values.email}`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitation');
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a colleague</DialogTitle>
          <DialogDescription>
            They receive a single-use link valid for 7 days. Only a hash of the token is stored.
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
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              required
              autoFocus
            />
            <TextField control={form.control} name="fullName" label="Full name" required />
            <SelectField
              control={form.control}
              name="roleKey"
              label="Role"
              required
              options={ASSIGNABLE_ROLE_KEYS.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- firm settings ---------------------------- */

const firmFormSchema = z.object({
  name: z.string().trim().min(1, 'Firm name is required').max(200),
  frn: z.string().trim().max(32),
  contactEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email'),
  contactPhone: z.string().trim().max(20),
  addressLine1: z.string().trim().max(200),
  addressLine2: z.string().trim().max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  pincode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[1-9]\d{5}$/.test(v), 'PIN code is 6 digits'),
});

export function FirmSettingsPage() {
  const [firm, setFirm] = useState<FirmProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof firmFormSchema>>({
    resolver: zodResolver(firmFormSchema),
    defaultValues: {
      name: '',
      frn: '',
      contactEmail: '',
      contactPhone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      pincode: '',
    },
  });

  /**
   * This used to `.catch(() => undefined)` and fall through to a spinner, so a
   * failing request looked exactly like a slow one and the page simply never
   * finished loading. An error the user cannot see is an error nobody reports.
   */
  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void adminApi
      .firm()
      .then((f) => {
        setFirm(f);
        form.reset({
          name: f.name,
          frn: f.frn ?? '',
          contactEmail: f.contactEmail ?? '',
          contactPhone: f.contactPhone ?? '',
          addressLine1: f.addressLine1 ?? '',
          addressLine2: f.addressLine2 ?? '',
          city: f.city ?? '',
          state: f.state ?? '',
          pincode: f.pincode ?? '',
        });
      })
      .catch((err: unknown) =>
        setLoadError(
          err instanceof ApiError
            ? [err.message, err.problem.detail].filter(Boolean).join(' — ')
            : 'Could not load your firm details',
        ),
      )
      .finally(() => setLoading(false));
    // form is stable across renders; re-running on it would refetch endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await adminApi.updateFirm(values);
      toast.success('Firm details saved');
      form.reset(values);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save');
    }
  });

  if (loading) return <LoadingState label="Loading firm…" />;

  if (loadError || !firm) {
    return (
      <>
        <PageHeader title="Firm settings" />
        <PageBody>
          <Card>
            <CardContent className="p-0">
              <ErrorState
                title={loadError ?? 'Could not load your firm details'}
                description="Nothing was changed. Try again — if it keeps failing, the API or the database connection is the place to look."
              />
              <div className="flex justify-center pb-8">
                <Button variant="outline" onClick={load}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try again
                </Button>
              </div>
            </CardContent>
          </Card>
        </PageBody>
      </>
    );
  }

  const dirty = form.formState.isDirty;

  return (
    <>
      <PageHeader title="Firm settings" subtitle={firm.slug} />

      <PageBody className="max-w-5xl space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Users" value={firm._count.users} />
          <StatCard label="Clients" value={firm._count.clients} />
          <StatCard label="Cases" value={firm._count.cases} />
          <StatCard
            label="Data region"
            value={<span className="text-base font-medium">{firm.dataRegion}</span>}
            hint={`retention ${firm.retentionMonths} months`}
          />
        </div>

        <Form {...form}>
          <form onSubmit={onSubmit} noValidate>
            <Card>
              <CardHeader>
                <CardTitle>Firm details</CardTitle>
                <CardDescription>Shown on exports and in the audit trail.</CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField control={form.control} name="name" label="Firm name" required />
                  <TextField
                    control={form.control}
                    name="frn"
                    label="ICAI firm registration number"
                  />
                  <TextField
                    control={form.control}
                    name="contactEmail"
                    label="Contact email"
                    type="email"
                  />
                  <TextField control={form.control} name="contactPhone" label="Contact phone" />
                </div>

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    control={form.control}
                    name="addressLine1"
                    label="Address line 1"
                    className="sm:col-span-2"
                  />
                  <TextField
                    control={form.control}
                    name="addressLine2"
                    label="Address line 2"
                    className="sm:col-span-2"
                  />
                  <TextField control={form.control} name="city" label="City" />
                  <TextField control={form.control} name="state" label="State" />
                  <TextField
                    control={form.control}
                    name="pincode"
                    label="PIN code"
                    maxLength={6}
                    className="sm:max-w-[200px]"
                  />
                </div>
              </CardContent>

              <div className="flex items-center gap-3 border-t bg-muted/30 px-6 py-3">
                <Button type="submit" disabled={form.formState.isSubmitting || !dirty}>
                  {form.formState.isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save changes
                </Button>
                {dirty && (
                  <Button type="button" variant="ghost" onClick={() => form.reset()}>
                    Discard
                  </Button>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {dirty ? 'Unsaved changes' : 'All changes saved'}
                </span>
              </div>
            </Card>
          </form>
        </Form>

        {firm.license && (
          <Card>
            <CardHeader>
              <CardTitle>Licence</CardTitle>
              <CardDescription>
                What this firm is licensed for. Set by the platform, not here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LicenseSummaryCard license={firm.license} />
            </CardContent>
          </Card>
        )}

        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Retention is a legal decision, not a setting</AlertTitle>
          <AlertDescription>
            The {firm.retentionMonths}-month default is an engineering placeholder. The real
            schedule has to come from the firm&apos;s professional and statutory obligations.
            Nothing is deleted automatically — expiring data is flagged for a human to decide on.
          </AlertDescription>
        </Alert>
      </PageBody>
    </>
  );
}

/* -------------------------------- audit --------------------------------- */

const AUDIT_ACTIONS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'SENSITIVE_FIELD_REVEALED',
  'SENSITIVE_DATA_VIEWED',
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CASE_CREATED',
  'CASE_STATUS_CHANGED',
  'CONSENT_RECORDED',
  'VALIDATION_RUN',
  'ACCESS_DENIED',
];

export function AuditPage() {
  const [action, setAction] = useState(ALL);

  const list = usePagedList<AuditRow>({
    load: (params) => adminApi.audit(params),
    filters: { action: action === ALL ? undefined : action },
    sort: 'occurredAt',
    dir: 'desc',
    pageSize: 50,
  });

  const columns: Array<Column<AuditRow>> = [
    {
      key: 'occurredAt',
      header: 'When',
      headClassName: 'w-[170px]',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (r) => formatDateTime(r.occurredAt),
    },
    {
      key: 'actor',
      header: 'Who',
      cell: (r) => (
        <>
          {r.actorEmail ?? 'system'}
          {r.actorRole && (
            <span className="block text-xs text-muted-foreground">{r.actorRole}</span>
          )}
        </>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      className: 'font-medium',
      cell: (r) => titleCase(r.action),
    },
    {
      key: 'entity',
      header: 'Entity',
      hideOnMobile: true,
      cell: (r) => (
        <>
          <span className="text-muted-foreground">{r.entityType}</span>
          {r.metadata && Object.keys(r.metadata).length > 0 && (
            <span className="block text-xs text-muted-foreground">
              {Object.entries(r.metadata)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(' · ')}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'fields',
      header: 'Fields',
      className: 'text-xs text-muted-foreground',
      hideOnMobile: true,
      cell: (r) => r.changedFields.join(', ') || '—',
    },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (r) => <StatusBadge status={r.outcome} label={r.outcome.toLowerCase()} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every consequential action in your firm"
        actions={
          <Button variant="outline" size="icon" onClick={list.reload} aria-label="Refresh">
            <RefreshCw className={list.loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        }
      />

      <PageBody className="space-y-3">
        <Card className="overflow-hidden">
          <TableToolbar>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-[280px] bg-background">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                {AUDIT_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {titleCase(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ClearFilters show={action !== ALL} onClear={() => setAction(ALL)} />
          </TableToolbar>

          <DataTable
            columns={columns}
            rows={list.rows}
            getRowId={(r) => r.id}
            loading={list.loading}
            meta={list.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            noun="entries"
            empty={
              list.error ? (
                <ErrorState title={list.error} />
              ) : (
                <EmptyState title="No audit entries match" />
              )
            }
          />
        </Card>

        <p className="text-xs text-muted-foreground">
          Audit rows record <strong>that</strong> a value was viewed or changed, never the value
          itself. The “fields” column lists field names only. Rows are append-only: the application
          role holds no UPDATE or DELETE grant on this table.
        </p>
      </PageBody>
    </>
  );
}
