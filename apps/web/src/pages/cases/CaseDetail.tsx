import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Info,
  Loader2,
  Printer,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  CASE_STATUS_LABEL,
  TRANSITION_PRECONDITIONS,
  canTransition,
  type CaseStatus,
} from '@ifp/shared';
import { ApiError } from '@/api/client';
import {
  casesApi,
  consentApi,
  validationApi,
  type CaseDetail,
  type ValidationRun,
} from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import {
  Crumbs,
  DescriptionItem,
  DescriptionList,
  ErrorState,
  LoadingState,
  PageBody,
  PageHeader,
  ReadinessMeter,
  SeverityBadge,
  StatCard,
  StatusBadge,
  formatDate,
  formatDateTime,
  titleCase,
} from '@/components/app-ui';
import { SelectField, TextField, TextareaField, formatMoney } from '@/components/form-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BankPicker, type NewBank } from './BankPicker';
import { SECTIONS } from './sections';
import { SectionForm } from './SectionForm';

type StepKey =
  | 'project'
  | 'loan'
  | 'employment'
  | 'investment'
  | 'first-sale'
  | 'documents'
  | 'consent'
  | 'review';

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'project', label: 'Project' },
  { key: 'loan', label: 'Loan & bank' },
  { key: 'employment', label: 'Employment' },
  { key: 'investment', label: 'Investment' },
  { key: 'first-sale', label: 'First sale' },
  { key: 'documents', label: 'Documents' },
  { key: 'consent', label: 'Consent' },
  { key: 'review', label: 'Review' },
];

export function CaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const step = (params.get('step') as StepKey) ?? 'project';

  const [kase, setKase] = useState<CaseDetail | null>(null);
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, r] = await Promise.all([
        casesApi.get(id),
        validationApi.latest(id).catch(() => null),
      ]);
      setKase(c);
      setRun(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the case');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runValidation = async () => {
    if (!id) return;
    setValidating(true);
    try {
      const result = await casesApi.validate(id);
      const [c, r] = await Promise.all([casesApi.get(id), validationApi.latest(id)]);
      setKase(c);
      setRun(r);
      toast.success(
        result.blockingCount === 0
          ? 'Validation passed with no blocking findings'
          : `${result.blockingCount} blocking finding${result.blockingCount === 1 ? '' : 's'} to resolve`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  if (loading) return <LoadingState label="Loading case…" />;
  if (!kase || !id) return <ErrorState title="Case not found" />;

  const sectionSpec = SECTIONS.find((s) => s.key === step);

  return (
    <>
      <PageHeader
        back={
          <Crumbs
            items={[
              { label: 'Cases', to: '/cases' },
              { label: kase.caseNumber },
            ]}
          />
        }
        title={
          <span className="flex items-center gap-2">
            <span className="tabular">{kase.caseNumber}</span>
            <StatusBadge status={kase.status} label={kase.statusLabel} />
          </span>
        }
        subtitle={
          <>
            <Link to={`/clients/${kase.client.id}`} className="hover:underline">
              {kase.client.legalName}
            </Link>
            {' · '}
            {titleCase(kase.applicationType)}
          </>
        }
        actions={
          <>
            {can('validation:run') && (
              <Button variant="outline" onClick={runValidation} disabled={validating}>
                {validating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Run validation
              </Button>
            )}
            {can('case:transition') && (
              <Button onClick={() => setStatusOpen(true)}>
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Change status
              </Button>
            )}
          </>
        }
      >
        <div className="overflow-x-auto px-4 pb-2 sm:px-6 no-print">
          <Tabs value={step} onValueChange={(v) => setParams({ step: v })}>
            <TabsList>
              {STEPS.map((s) => (
                <TabsTrigger key={s.key} value={s.key}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </PageHeader>

      <PageBody className="space-y-4">
        {kase.locked && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This case is locked</AlertTitle>
            <AlertDescription>
              A filed or approved case cannot be edited. Move it back to review if a correction is
              genuinely needed.
            </AlertDescription>
          </Alert>
        )}

        {kase.schemeVersion.status === 'DRAFT' && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Scheme rules are not confirmed</AlertTitle>
            <AlertDescription>
              This case is pinned to scheme version{' '}
              <strong>{kase.schemeVersion.versionLabel}</strong>, which is still a draft.
              Eligibility rules that depend on the governing resolution are <strong>not</strong>{' '}
              being applied — only structural checks run. See “Not being checked” in the validation
              panel.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Readiness" value={`${kase.readinessScore}%`}>
            <ReadinessMeter value={kase.readinessScore} />
          </StatCard>
          <StatCard
            label="Blocking"
            value={run?.blockingCount ?? '—'}
            hint="must be resolved"
            {...(run?.blockingCount ? { tone: 'danger' as const } : {})}
          />
          <StatCard
            label="Warnings"
            value={run?.warningCount ?? '—'}
            hint="review before filing"
            {...(run?.warningCount ? { tone: 'warning' as const } : {})}
          />
          <StatCard
            label="Last validated"
            value={
              <span className="text-base font-medium">
                {run ? formatDateTime(run.startedAt) : 'Never'}
              </span>
            }
            hint={run?.triggeredBy?.fullName ?? undefined}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {sectionSpec && step === 'loan' && <LoanStep kase={kase} onSaved={load} />}
            {sectionSpec && step !== 'loan' && (
              <SectionForm
                caseId={id}
                spec={sectionSpec}
                data={(kase[sectionSpec.dataKey] as Record<string, unknown> | null) ?? null}
                locked={kase.locked}
                onSaved={load}
              />
            )}
            {step === 'documents' && <DocumentsStep kase={kase} onChanged={load} />}
            {step === 'consent' && <ConsentStep kase={kase} onChanged={load} />}
            {step === 'review' && <ReviewStep kase={kase} run={run} />}
          </div>

          <ValidationPanel
            run={run}
            onWaived={load}
            onRun={runValidation}
            running={validating}
            canRun={can('validation:run')}
            canWaive={can('validation:waive')}
          />
        </div>
      </PageBody>

      {statusOpen && (
        <StatusDialog
          kase={kase}
          run={run}
          onClose={() => setStatusOpen(false)}
          onChanged={() => {
            setStatusOpen(false);
            void load();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------- loan step ------------------------------ */

function LoanStep({ kase, onSaved }: { kase: CaseDetail; onSaved: () => void }) {
  const spec = SECTIONS.find((s) => s.key === 'loan')!;
  const loan = (kase.loan ?? null) as Record<string, unknown> | null;
  const [bankId, setBankId] = useState<string>((loan?.bankId as string) ?? '');
  const [newBank, setNewBank] = useState<NewBank | null>(null);

  const extraPayload: Record<string, unknown> = {};
  if (newBank) extraPayload.newBank = newBank;
  else if (bankId) extraPayload.bankId = bankId;

  return (
    <SectionForm
      caseId={kase.id}
      spec={spec}
      data={loan}
      locked={kase.locked}
      extraPayload={extraPayload}
      onSaved={() => {
        setNewBank(null);
        onSaved();
      }}
      extra={
        <BankPicker
          value={bankId}
          pendingBank={newBank}
          disabled={kase.locked}
          onSelect={(id) => {
            setBankId(id);
            setNewBank(null);
          }}
          onCreate={(b) => {
            setNewBank(b);
            setBankId('');
          }}
        />
      }
    />
  );
}

/* ---------------------------- documents step ---------------------------- */

function DocumentsStep({ kase, onChanged }: { kase: CaseDetail; onChanged: () => void }) {
  const { can } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const editable = can('document:write') && !kase.locked;

  const update = async (slotId: string, body: Record<string, unknown>) => {
    setBusyId(slotId);
    try {
      await casesApi.updateDocument(kase.id, slotId, body);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the checklist');
    } finally {
      setBusyId(null);
    }
  };

  const outstanding = kase.documents.filter((d) => d.isRequired && d.status === 'REQUIRED').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document checklist</CardTitle>
        <CardDescription>
          File uploads are not part of this build. Marking each document as present, not available
          or not applicable is what gates a case as ready to file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {outstanding > 0 ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {outstanding} mandatory document{outstanding === 1 ? '' : 's'} still marked as
              required.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="success">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>Every mandatory document is accounted for.</AlertDescription>
          </Alert>
        )}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead className="w-[110px]">Required</TableHead>
                <TableHead className="w-[170px]">Status</TableHead>
                <TableHead className="w-[150px]">Verification</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kase.documents.map((d) => (
                <TableRow key={d.id} className={busyId === d.id ? 'opacity-60' : undefined}>
                  <TableCell>
                    <span className="font-medium">{d.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {titleCase(d.category)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {d.isRequired ? (
                      <Badge variant="warning">mandatory</Badge>
                    ) : (
                      <Badge variant="muted">optional</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={d.status}
                      disabled={!editable || busyId === d.id}
                      onValueChange={(v) => void update(d.id, { status: v, notes: d.notes })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="REQUIRED">Required</SelectItem>
                        <SelectItem value="PRESENT">Present</SelectItem>
                        <SelectItem value="NOT_AVAILABLE">Not available</SelectItem>
                        <SelectItem value="NOT_APPLICABLE">Not applicable</SelectItem>
                        <SelectItem value="REJECTED">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={d.verificationStatus}
                      disabled={!editable || busyId === d.id}
                      onValueChange={(v) =>
                        void update(d.id, {
                          status: d.status,
                          verificationStatus: v,
                          notes: d.notes,
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNVERIFIED">Unverified</SelectItem>
                        <SelectItem value="VERIFIED">Verified</SelectItem>
                        <SelectItem value="QUERY">Query</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={d.notes ?? ''}
                      disabled={!editable}
                      placeholder="Notes…"
                      className="h-8"
                      onBlur={(e) => {
                        if (e.target.value !== (d.notes ?? '')) {
                          void update(d.id, { status: d.status, notes: e.target.value });
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ----------------------------- consent step ----------------------------- */

function ConsentStep({ kase, onChanged }: { kase: CaseDetail; onChanged: () => void }) {
  const { can } = useAuth();
  const [template, setTemplate] = useState<Awaited<
    ReturnType<typeof consentApi.activeTemplate>
  > | null>(null);
  const [affirmed, setAffirmed] = useState(false);
  const [contactName, setContactName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void consentApi
      .activeTemplate()
      .then(setTemplate)
      .catch(() => setTemplate(null));
  }, []);

  const record = async () => {
    if (!template) return;
    setBusy(true);
    try {
      await consentApi.record({
        clientId: kase.client.id,
        caseId: kase.id,
        templateId: template.id,
        method: 'CA_ATTESTATION',
        attestationText: template.bodyText,
        affirmed: true,
        clientContactName: contactName || undefined,
      });
      toast.success('Authorization recorded');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not record the authorization');
    } finally {
      setBusy(false);
    }
  };

  if (kase.consent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Client authorization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert variant="success">
            <FileCheck2 className="h-4 w-4" />
            <AlertTitle>Authorization recorded</AlertTitle>
            <AlertDescription>
              Recorded {formatDateTime(kase.consent.recordedAt)} by attestation.
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            The exact wording that was affirmed is stored with this record, along with a hash of the
            template version, so it can always be reproduced.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!template) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Client authorization</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingState label="Loading the current wording…" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client authorization</CardTitle>
        <CardDescription>
          Version {template.versionLabel} · purposes:{' '}
          {template.purposeCodes.join(', ').toLowerCase()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {template.isDraftText && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This wording has not been legally reviewed</AlertTitle>
            <AlertDescription>
              The text below is an engineering placeholder. It must be replaced with wording
              reviewed by the firm&apos;s legal adviser before this platform is used with real
              client data.
            </AlertDescription>
          </Alert>
        )}

        <ScrollArea className="h-72 rounded-md border bg-muted/30 p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{template.bodyText}</p>
        </ScrollArea>

        <div className="space-y-2">
          <Label htmlFor="consent-contact">Client contact who confirmed (optional)</Label>
          <Input
            id="consent-contact"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>

        {/* Never pre-ticked. A checkbox alone is not compliance, but an
            explicit, un-prefilled affirmation is the minimum worth recording. */}
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Checkbox
            id="affirm"
            checked={affirmed}
            disabled={!can('consent:record')}
            onCheckedChange={(v) => setAffirmed(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="affirm" className="font-normal leading-relaxed">
            I confirm the statement above, on behalf of this firm.
          </Label>
        </div>

        <Button disabled={!affirmed || !can('consent:record') || busy} onClick={record}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ClipboardCheck className="mr-2 h-4 w-4" />
          )}
          Record authorization
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ review step ----------------------------- */

function ReviewStep({ kase, run }: { kase: CaseDetail; run: ValidationRun | null }) {
  const loan = kase.loan as Record<string, unknown> | null;
  const inv = kase.investment as Record<string, unknown> | null;
  const proj = kase.project as Record<string, unknown> | null;
  const emp = kase.employment as Record<string, unknown> | null;
  const sale = kase.firstSale as Record<string, unknown> | null;

  const v = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : String(x));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Case summary</CardTitle>
            <CardDescription>Everything captured for this application</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </CardHeader>
        <CardContent>
          <DescriptionList>
            <DescriptionItem term="Case number">
              <span className="tabular">{kase.caseNumber}</span>
            </DescriptionItem>
            <DescriptionItem term="Client">{kase.client.legalName}</DescriptionItem>
            <DescriptionItem term="Application type">
              {titleCase(kase.applicationType)}
            </DescriptionItem>
            <DescriptionItem term="Scheme">
              {kase.schemeVersion.scheme.name} ({kase.schemeVersion.versionLabel})
            </DescriptionItem>
            <DescriptionItem term="Application date">
              {formatDate(kase.applicationDate)}
            </DescriptionItem>
            <DescriptionItem term="Status">{kase.statusLabel}</DescriptionItem>
            <DescriptionItem term="Portal application no.">
              {v(kase.portalApplicationNo)}
            </DescriptionItem>
            <DescriptionItem term="Filed at">{formatDateTime(kase.filedAt)}</DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem term="Project name">{v(proj?.projectName)}</DescriptionItem>
              <DescriptionItem term="District">{v(proj?.districtCode)}</DescriptionItem>
              <DescriptionItem term="Taluka">{v(proj?.talukaCode)}</DescriptionItem>
              <DescriptionItem term="Commercial production">
                {formatDate(proj?.commercialProductionDate as string)}
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Loan</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem term="Account">
                <span className="masked">{v(loan?.loanAccountMasked)}</span>
              </DescriptionItem>
              <DescriptionItem term="Sanction date">
                {formatDate(loan?.sanctionDate as string)}
              </DescriptionItem>
              <DescriptionItem term="First disbursement">
                {formatDate(loan?.firstDisbursementDate as string)}
              </DescriptionItem>
              <DescriptionItem term="Sanctioned">
                <span className="tabular">{formatMoney(loan?.sanctionedAmount as string)}</span>
              </DescriptionItem>
              <DescriptionItem term="Disbursed">
                <span className="tabular">{formatMoney(loan?.disbursedAmount as string)}</span>
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Investment</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem term="Total project cost">
                <span className="tabular">{formatMoney(inv?.totalProjectCost as string)}</span>
              </DescriptionItem>
              <DescriptionItem term="Eligible investment">
                <span className="tabular">
                  {formatMoney(inv?.eligibleInvestmentTotal as string)}
                </span>
              </DescriptionItem>
              <DescriptionItem term="Plant &amp; machinery">
                <span className="tabular">{formatMoney(inv?.plantMachineryCost as string)}</span>
              </DescriptionItem>
              <DescriptionItem term="Subsidy claimed">
                <span className="tabular">{formatMoney(inv?.subsidyClaimedAmount as string)}</span>
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Employment &amp; first sale</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem term="Total employees">
                <span className="tabular">{v(emp?.totalEmployees)}</span>
              </DescriptionItem>
              <DescriptionItem term="EPF registered">
                <span className="tabular">{v(emp?.epfRegisteredEmployees)}</span>
              </DescriptionItem>
              <DescriptionItem term="First sale date">
                {formatDate(sale?.firstSaleDate as string)}
              </DescriptionItem>
              <DescriptionItem term="Invoice number">{v(sale?.invoiceNumber)}</DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pre-filing checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList>
            <DescriptionItem term="Documents accounted for">
              {kase.documents.filter((d) => d.status !== 'REQUIRED').length} of{' '}
              {kase.documents.length}
            </DescriptionItem>
            <DescriptionItem term="Authorization">
              {kase.consent ? `recorded ${formatDate(kase.consent.recordedAt)}` : 'not recorded'}
            </DescriptionItem>
            <DescriptionItem term="Blocking findings">
              {run?.blockingCount ?? 'not validated'}
            </DescriptionItem>
            <DescriptionItem term="Readiness">{kase.readinessScore}%</DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>
    </div>
  );
}

/* --------------------------- validation panel --------------------------- */

function ValidationPanel({
  run,
  onWaived,
  onRun,
  running,
  canRun,
  canWaive,
}: {
  run: ValidationRun | null;
  onWaived: () => void;
  onRun: () => void;
  running: boolean;
  canRun: boolean;
  canWaive: boolean;
}) {
  const [inactive, setInactive] = useState<
    Array<{ code: string; name: string; severity: string; reason: string }>
  >([]);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    void validationApi
      .inactiveRules()
      .then(setInactive)
      .catch(() => undefined);
  }, []);

  const submitWaiver = async () => {
    if (!waiving || !reason.trim()) return;
    try {
      await validationApi.waive(waiving, reason.trim());
      toast.success('Warning waived');
      setWaiving(null);
      setReason('');
      onWaived();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not waive the finding');
    }
  };

  return (
    <div className="space-y-4 xl:sticky xl:top-36 xl:self-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validation</CardTitle>
          {run && (
            <CardDescription>
              {run.findings.length} finding{run.findings.length === 1 ? '' : 's'} ·{' '}
              {formatDateTime(run.startedAt)}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {!run ? (
            <>
              <p className="text-sm text-muted-foreground">This case has not been validated yet.</p>
              {canRun && (
                <Button onClick={onRun} disabled={running} className="w-full">
                  {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Run validation
                </Button>
              )}
            </>
          ) : run.findings.length === 0 ? (
            <Alert variant="success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>No findings. Every active rule passed.</AlertDescription>
            </Alert>
          ) : (
            <>
              {run.findings.map((f) => (
                <div
                  key={f.id}
                  className={`rounded-md border-l-2 border-y border-r p-2.5 ${
                    f.severity === 'BLOCKING'
                      ? 'border-l-destructive'
                      : f.severity === 'WARNING'
                        ? 'border-l-warning'
                        : 'border-l-info'
                  } ${f.status === 'WAIVED' ? 'opacity-60' : ''}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {f.ruleCode}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{f.message}</p>
                  {f.remediationHint && (
                    <p className="mt-1 text-xs text-muted-foreground">{f.remediationHint}</p>
                  )}
                  {f.status === 'WAIVED' ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Waived: {f.waiverReason}
                    </p>
                  ) : (
                    f.severity !== 'BLOCKING' &&
                    canWaive && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => setWaiving(f.id)}
                      >
                        Waive with reason
                      </Button>
                    )
                  )}
                </div>
              ))}
              <Separator />
              <p className="text-xs text-muted-foreground">
                Blocking findings cannot be waived — they must be resolved.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {inactive.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Not being checked</CardTitle>
            <CardDescription>
              These rules exist but are inactive — do not assume eligibility has been verified.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {inactive.map((r) => (
              <div key={r.code} className="text-sm">
                <p className="font-medium leading-snug">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.reason}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(waiving)} onOpenChange={(o) => !o && setWaiving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Waive this warning</DialogTitle>
            <DialogDescription>
              The reason is stored on the finding and written to the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="waiver-reason">Why is this acceptable for this case?</Label>
            <Input
              id="waiver-reason"
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiving(null)}>
              Cancel
            </Button>
            <Button onClick={submitWaiver} disabled={!reason.trim()}>
              Waive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ----------------------------- status dialog ---------------------------- */

const statusSchema = z.object({
  status: z.string().min(1, 'Choose a status'),
  reason: z.string().trim().max(500),
  portalApplicationNo: z.string().trim().max(64),
});

function StatusDialog({
  kase,
  run,
  onClose,
  onChanged,
}: {
  kase: CaseDetail;
  run: ValidationRun | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof statusSchema>>({
    resolver: zodResolver(statusSchema),
    defaultValues: { status: '', reason: '', portalApplicationNo: '' },
  });

  const status = form.watch('status');
  const targets = (Object.keys(CASE_STATUS_LABEL) as CaseStatus[]).filter((s) =>
    canTransition(kase.status as CaseStatus, s),
  );
  const preconditions = status ? TRANSITION_PRECONDITIONS[status as CaseStatus] : undefined;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await casesApi.setStatus(kase.id, {
        status: values.status,
        reason: values.reason || undefined,
        portalApplicationNo:
          values.status === 'FILED' ? values.portalApplicationNo : undefined,
      });
      toast.success(`Case moved to ${CASE_STATUS_LABEL[values.status as CaseStatus].toLowerCase()}`);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? [err.message, err.problem.detail].filter(Boolean).join(' — ')
          : 'Could not change the status',
      );
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change case status</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            Currently <StatusBadge status={kase.status} label={kase.statusLabel} />
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

            <SelectField
              control={form.control}
              name="status"
              label="New status"
              required
              options={targets.map((s) => ({ value: s, label: CASE_STATUS_LABEL[s] }))}
            />

            {preconditions && (
              <Alert variant="info">
                <Info className="h-4 w-4" />
                <AlertTitle>The server will check</AlertTitle>
                <AlertDescription>
                  <ul className="ml-4 list-disc">
                    {preconditions.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {run && run.blockingCount > 0 && ['IN_REVIEW', 'READY_TO_FILE'].includes(status) && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {run.blockingCount} blocking finding{run.blockingCount === 1 ? '' : 's'} must be
                  resolved first.
                </AlertDescription>
              </Alert>
            )}

            {status === 'FILED' && (
              <>
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>You file the application, not this platform</AlertTitle>
                  <AlertDescription>
                    Submit the form on the portal yourself, then record the application number it
                    gave you.
                  </AlertDescription>
                </Alert>
                <TextField
                  control={form.control}
                  name="portalApplicationNo"
                  label="Portal application number"
                  required
                />
              </>
            )}

            <TextareaField control={form.control} name="reason" label="Reason / note (optional)" />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!status || form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Change status
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
