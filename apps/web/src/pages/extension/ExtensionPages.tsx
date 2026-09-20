import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Chrome,
  Copy,
  Loader2,
  Puzzle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/client';
import {
  extensionApi,
  type CapturedField,
  type ExtensionDevice,
  type FormVersionDetail,
  type FormVersionSummary,
} from '@/api/endpoints';
import {
  Crumbs,
  EmptyState,
  ErrorState,
  LoadingState,
  PageBody,
  PageHeader,
  StatusBadge,
  formatDateTime,
} from '@/components/app-ui';
import { DataTable, type Column } from '@/components/data-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

/* ------------------------------ pairing page ---------------------------- */

export function ExtensionPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<ExtensionDevice[]>([]);
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void Promise.all([extensionApi.devices(), extensionApi.formVersions()])
      .then(([d, v]) => {
        setDevices(d);
        setVersions(v);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load extension settings'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const startPairing = async () => {
    try {
      const res = await extensionApi.pairingCode();
      setPairing({ code: res.code, expiresAt: res.expiresAt });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not generate a code');
    }
  };

  const revoke = async (device: ExtensionDevice) => {
    try {
      await extensionApi.revokeDevice(device.id, 'Unpaired from the web app');
      toast.success(`${device.label} unpaired`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not unpair');
    }
  };

  const deviceColumns: Array<Column<ExtensionDevice>> = [
    {
      key: 'label',
      header: 'Browser',
      cell: (d) => (
        <div className="flex items-center gap-2">
          <Chrome className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <span className="font-medium">{d.label}</span>
            {d.agentVersion && (
              <span className="block text-xs text-muted-foreground">v{d.agentVersion}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (d) =>
        d.revokedAt ? (
          <Badge variant="muted">unpaired</Badge>
        ) : d.expired ? (
          <Badge variant="danger">expired</Badge>
        ) : (
          <Badge variant="success">active</Badge>
        ),
    },
    {
      key: 'lastSeen',
      header: 'Last used',
      className: 'whitespace-nowrap text-muted-foreground',
      hideOnMobile: true,
      cell: (d) => (d.lastSeenAt ? formatDateTime(d.lastSeenAt) : 'never'),
    },
    {
      key: 'expires',
      header: 'Pairing expires',
      className: 'whitespace-nowrap text-muted-foreground',
      hideOnMobile: true,
      cell: (d) => formatDateTime(d.expiresAt),
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-[100px]',
      className: 'text-right',
      cell: (d) =>
        d.revokedAt ? null : (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => void revoke(d)}
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            Unpair
          </Button>
        ),
    },
  ];

  const versionColumns: Array<Column<FormVersionSummary>> = [
    {
      key: 'label',
      header: 'Capture',
      cell: (v) => (
        <>
          <span className="font-medium">{v.label}</span>
          <span className="block text-xs text-muted-foreground">
            {v.form.name} · {v.fingerprint}
          </span>
        </>
      ),
    },
    { key: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} /> },
    {
      key: 'mapped',
      header: 'Mapped',
      headClassName: 'text-right',
      className: 'tabular text-right',
      cell: (v) => `${v.mappedCount} / ${v.fieldCount}`,
    },
    {
      key: 'scope',
      header: 'Scope',
      hideOnMobile: true,
      cell: (v) =>
        v.isShared ? (
          <Badge variant="info">shared</Badge>
        ) : (
          <Badge variant="secondary">your firm</Badge>
        ),
    },
    {
      key: 'capturedAt',
      header: 'Captured',
      className: 'whitespace-nowrap text-muted-foreground',
      hideOnMobile: true,
      cell: (v) => formatDateTime(v.capturedAt),
    },
  ];

  if (loading) return <LoadingState label="Loading extension settings…" />;

  return (
    <>
      <PageHeader
        title="Browser extension"
        subtitle="Pair a browser, and manage the field maps it uses"
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={() => void startPairing()}>
              <Puzzle className="mr-2 h-4 w-4" />
              Pair a browser
            </Button>
          </>
        }
      />

      <PageBody className="space-y-4">
        {error && <ErrorState title={error} />}

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>What the extension does, and what it will not do</AlertTitle>
          <AlertDescription>
            It fills the IFP application form with data you have already prepared here, marks every
            box it touched, and lists what it could not fill. It never presses submit, never reads
            or solves a CAPTCHA, never reads a password field, and never stores your IFP
            credentials. The final review and the submit click stay with you.
          </AlertDescription>
        </Alert>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Paired browsers</CardTitle>
            <CardDescription>
              Each pairing is tied to your account and expires after 90 days.
            </CardDescription>
          </CardHeader>
          <DataTable
            columns={deviceColumns}
            rows={devices}
            getRowId={(d) => d.id}
            empty={
              <EmptyState
                icon={Chrome}
                title="No browser paired yet"
                description="Install the extension, then generate a pairing code here."
              />
            }
          />
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Field maps</CardTitle>
            <CardDescription>
              A capture records which controls the portal form has. Nothing is filled until a
              capture is reviewed and activated.
            </CardDescription>
          </CardHeader>
          <DataTable
            columns={versionColumns}
            rows={versions}
            getRowId={(v) => v.id}
            onRowClick={(v) => navigate(`/extension/maps/${v.id}`)}
            empty={
              <EmptyState
                icon={Puzzle}
                title="No field map captured yet"
                description="Open the IFP form in a paired browser and use “Learn this page” in the extension. Nothing here guesses at the portal's HTML."
              />
            }
          />
        </Card>
      </PageBody>

      {pairing && <PairingDialog pairing={pairing} onClose={() => { setPairing(null); load(); }} />}
    </>
  );
}

function PairingDialog({
  pairing,
  onClose,
}: {
  pairing: { code: string; expiresAt: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pair a browser</DialogTitle>
          <DialogDescription>
            Open the extension in the browser you want to pair, and enter this code.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-6 text-center">
          <p className="tabular select-all font-mono text-3xl font-semibold tracking-[0.2em]">
            {pairing.code}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Valid until {formatDateTime(pairing.expiresAt)} · single use
          </p>
        </div>

        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(pairing.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error('Could not copy — select the code and copy it manually');
            }
          }}
        >
          {copied ? (
            <CheckCircle2 className="mr-2 h-4 w-4 text-success" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {copied ? 'Copied' : 'Copy code'}
        </Button>

        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Anyone who enters this code within ten minutes gets a browser paired to{' '}
            <strong>your</strong> account, with your permissions. Do not share it.
          </AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- field map review -------------------------- */

const UNMAPPED = '__none__';

export function FieldMapPage() {
  const { id } = useParams();
  const [version, setVersion] = useState<FormVersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    void extensionApi
      .formVersion(id)
      .then((v) => {
        setVersion(v);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load this capture'),
      )
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const setMapping = async (field: CapturedField, sourcePath: string) => {
    if (!id) return;
    setSaving(field.id);
    try {
      if (sourcePath === UNMAPPED) {
        await extensionApi.deleteMapping(id, field.id);
      } else {
        await extensionApi.saveMapping(id, {
          formFieldId: field.id,
          sourcePath,
          transform: field.mapping?.transform ?? undefined,
          confirmed: true,
        });
      }
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the mapping');
    } finally {
      setSaving(null);
    }
  };

  const setTransform = async (field: CapturedField, transform: string) => {
    if (!id || !field.mapping) return;
    setSaving(field.id);
    try {
      await extensionApi.saveMapping(id, {
        formFieldId: field.id,
        sourcePath: field.mapping.sourcePath,
        transform: transform === UNMAPPED ? undefined : transform,
        confirmed: true,
      });
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the transform');
    } finally {
      setSaving(null);
    }
  };

  const activate = async (status: string) => {
    if (!id) return;
    try {
      await extensionApi.setVersionStatus(id, status);
      toast.success(status === 'ACTIVE' ? 'This map is now in use' : `Marked ${status.toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change the status');
    }
  };

  if (loading) return <LoadingState label="Loading capture…" />;
  if (error || !version) return <ErrorState title={error ?? 'Capture not found'} />;

  const fillable = version.fields.filter((f) => !f.refusedReason);
  const refused = version.fields.filter((f) => f.refusedReason);
  const mapped = fillable.filter((f) => f.mapping).length;

  const visible = filter
    ? fillable.filter((f) =>
        `${f.labelText ?? ''} ${f.nameAttr ?? ''} ${f.idAttr ?? ''}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : fillable;

  return (
    <>
      <PageHeader
        back={
          <Crumbs
            items={[
              { label: 'Browser extension', to: '/extension' },
              { label: version.label },
            ]}
          />
        }
        title={version.label}
        subtitle={`${version.form.name} · ${version.form.host} · captured ${formatDateTime(version.capturedAt)}`}
        actions={
          <>
            <StatusBadge status={version.status} />
            {version.status !== 'ACTIVE' ? (
              <Button onClick={() => void activate('ACTIVE')} disabled={mapped === 0}>
                Activate this map
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void activate('RETIRED')}>
                Retire
              </Button>
            )}
          </>
        }
      />

      <PageBody className="space-y-4">
        <Alert variant={mapped === 0 ? 'warning' : 'info'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {mapped} of {fillable.length} controls mapped
          </AlertTitle>
          <AlertDescription>
            Bind each control to the data that belongs in it. Nothing is mapped automatically: a
            label like “Name of Applicant (as per PAN)” is a judgement, and one wrong binding types
            a PAN into a turnover box on a government form. Activating requires at least one
            confirmed mapping.
          </AlertDescription>
        </Alert>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Controls on the page</CardTitle>
              <CardDescription>In the order the extension found them</CardDescription>
            </div>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by label or name…"
              className="max-w-[240px]"
            />
          </CardHeader>

          <CardContent className="space-y-2 p-4 pt-0">
            {visible.length === 0 && <EmptyState title="No controls match" />}
            {visible.map((field) => (
              <div
                key={field.id}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_200px_140px] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {field.labelText || field.nameAttr || field.idAttr || field.selector}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {field.controlType}
                    {field.inputType ? `[${field.inputType}]` : ''} · {field.selector}
                    {field.maxLength ? ` · max ${field.maxLength}` : ''}
                    {field.required ? ' · required' : ''}
                  </p>
                  {field.options && field.options.length > 0 && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {field.options.length} option(s):{' '}
                      {field.options
                        .slice(0, 4)
                        .map((o) => o.label)
                        .join(', ')}
                      {field.options.length > 4 ? '…' : ''}
                    </p>
                  )}
                </div>

                <Select
                  value={field.mapping?.sourcePath ?? UNMAPPED}
                  disabled={saving === field.id}
                  onValueChange={(v) => void setMapping(field, v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Not mapped" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={UNMAPPED}>— not mapped —</SelectItem>
                    {Object.entries(version.sourcePaths).map(([path, label]) => (
                      <SelectItem key={path} value={path}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={field.mapping?.transform ?? UNMAPPED}
                  disabled={!field.mapping || saving === field.id}
                  onValueChange={(v) => void setTransform(field, v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="No transform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNMAPPED}>as-is</SelectItem>
                    {version.transforms.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {saving === field.id && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {refused.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Left alone by policy</CardTitle>
              <CardDescription>
                The extension recorded that these exist and refused to record anything it could act
                on. They cannot be mapped.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Separator className="mb-3" />
              <ul className="space-y-1.5 text-sm">
                {refused.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{f.labelText || f.controlType}</span>
                    <span className="text-xs text-muted-foreground">{f.refusedReason}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Captured from {version.form.host}. If the portal changes its form, capture it again — the
          extension compares a digest of the page against this map and warns when they differ.{' '}
          <Link to="/extension" className="underline">
            Back to extension settings
          </Link>
        </p>
      </PageBody>
    </>
  );
}
