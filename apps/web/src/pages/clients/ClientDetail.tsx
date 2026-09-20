import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, FilePlus2, Loader2, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import {
  ENTITY_TYPE_LABEL,
  PAN_REGEX,
  PROMOTER_ROLE,
  type EntityType,
} from '@ifp/shared';
import { ApiError } from '@/api/client';
import { clientsApi, type ClientDetail, type Promoter } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import {
  Crumbs,
  DescriptionItem,
  DescriptionList,
  EmptyState,
  ErrorState,
  LoadingState,
  PageBody,
  PageHeader,
  ReadinessMeter,
  StatusBadge,
  formatDate,
  titleCase,
} from '@/components/app-ui';
import {
  CheckboxField,
  MaskedValue,
  PercentField,
  SelectField,
  TextField,
} from '@/components/form-fields';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoterDialog, setPromoterDialog] = useState<Promoter | 'new' | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      setClient(await clientsApi.get(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the client');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <LoadingState label="Loading client…" />;
  if (!client || !id) return <ErrorState title="Client not found" />;

  const ownershipTotal = client.promoters.reduce(
    (sum, p) => sum + (p.ownershipPercent ? Number(p.ownershipPercent) : 0),
    0,
  );
  const ownershipRecorded = client.promoters.some((p) => p.ownershipPercent);

  return (
    <>
      <PageHeader
        back={
          <Crumbs
            items={[
              { label: 'Clients', to: '/clients' },
              { label: client.legalName },
            ]}
          />
        }
        title={client.legalName}
        subtitle={`${ENTITY_TYPE_LABEL[client.entityType as EntityType] ?? client.entityType}${
          client.tradeName ? ` · trading as ${client.tradeName}` : ''
        }`}
        actions={
          <>
            {can('case:write') && (
              <Button variant="outline" onClick={() => navigate(`/cases/new?clientId=${client.id}`)}>
                <FilePlus2 className="mr-2 h-4 w-4" />
                New case
              </Button>
            )}
            {can('client:write') && (
              <Button onClick={() => navigate(`/clients/${client.id}/edit`)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            )}
          </>
        }
      />

      <PageBody className="space-y-4">
        {client.deletedAt && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This client is deleted</AlertTitle>
            <AlertDescription>
              It is retained for the audit trail and can no longer be edited.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Entity</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList>
                <DescriptionItem term="Legal name">{client.legalName}</DescriptionItem>
                <DescriptionItem term="Trade name">{client.tradeName ?? '—'}</DescriptionItem>
                <DescriptionItem term="Entity type">
                  {ENTITY_TYPE_LABEL[client.entityType as EntityType] ?? client.entityType}
                </DescriptionItem>
                <DescriptionItem term="Business activity">
                  {client.businessActivity ?? '—'}
                </DescriptionItem>
                <DescriptionItem term="Incorporated">
                  {formatDate(client.incorporationDate)}
                </DescriptionItem>
                <DescriptionItem term="NIC code">{client.nicCode ?? '—'}</DescriptionItem>
                <DescriptionItem term="PAN">
                  <MaskedValue
                    masked={client.panMasked}
                    label="PAN"
                    canReveal={can('sensitive:reveal')}
                    onReveal={async () => (await clientsApi.reveal(id, 'pan')).value}
                  />
                </DescriptionItem>
                <DescriptionItem term="GSTIN">
                  <MaskedValue
                    masked={client.gstinMasked}
                    label="GSTIN"
                    canReveal={can('sensitive:reveal')}
                    onReveal={async () => (await clientsApi.reveal(id, 'gstin')).value}
                  />
                </DescriptionItem>
                <DescriptionItem term="Udyam">
                  <MaskedValue
                    masked={client.udyamMasked}
                    label="Udyam number"
                    canReveal={can('sensitive:reveal')}
                    onReveal={async () => (await clientsApi.reveal(id, 'udyam')).value}
                  />
                </DescriptionItem>
              </DescriptionList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact &amp; address</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList>
                <DescriptionItem term="Contact person">
                  {client.contactPersonName ?? '—'}
                </DescriptionItem>
                <DescriptionItem term="Email">{client.contactEmail ?? '—'}</DescriptionItem>
                <DescriptionItem term="Phone">
                  <span className="tabular">{client.contactPhone ?? '—'}</span>
                </DescriptionItem>
                <DescriptionItem term="District">
                  {client.regdDistrictCode ?? '—'}
                </DescriptionItem>
                <DescriptionItem term="Address">
                  {[
                    client.regdAddressLine1,
                    client.regdAddressLine2,
                    client.regdCity,
                    client.regdPincode,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </DescriptionItem>
                <DescriptionItem term="Notes">
                  <span className="whitespace-pre-wrap">{client.notes ?? '—'}</span>
                </DescriptionItem>
              </DescriptionList>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Promoters</CardTitle>
              <CardDescription>Proprietor, partners or directors</CardDescription>
            </div>
            {can('client:write') && (
              <Button size="sm" variant="outline" onClick={() => setPromoterDialog('new')}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add promoter
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {client.promoters.length === 0 ? (
              <EmptyState
                title="No promoters recorded"
                description="Validation warns when no primary promoter is identified."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead className="text-right">Ownership</TableHead>
                    <TableHead>PAN</TableHead>
                    <TableHead>Aadhaar</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.promoters.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.fullName}
                        {p.isPrimary && (
                          <Badge variant="info" className="ml-2">
                            primary
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {titleCase(p.designation)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {p.ownershipPercent ? `${p.ownershipPercent}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <MaskedValue
                          masked={p.panMasked}
                          label="PAN"
                          canReveal={can('sensitive:reveal')}
                          onReveal={async () => (await clientsApi.revealPromoterPan(id, p.id)).value}
                        />
                      </TableCell>
                      <TableCell className="masked text-muted-foreground">
                        {p.aadhaarMasked ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.phone ?? p.email ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {can('client:write') && (
                          <Button size="sm" variant="ghost" onClick={() => setPromoterDialog(p)}>
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {ownershipRecorded && Math.abs(ownershipTotal - 100) > 0.5 && (
              <div className="border-t p-3">
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Ownership adds up to {ownershipTotal.toFixed(2)}%, not 100%. Validation will
                    flag this.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <p className="border-t p-3 text-xs text-muted-foreground">
              Aadhaar is stored as the last four digits only. Full Aadhaar storage is blocked by a
              database constraint pending a documented legal decision.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Cases</CardTitle>
            {can('case:write') && (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/cases/new?clientId=${client.id}`}>
                  <Plus className="mr-2 h-4 w-4" />
                  New case
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {client.cases.length === 0 ? (
              <EmptyState
                title="No cases yet"
                description="A case is one subsidy application for this client."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[160px]">Readiness</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.cases.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/cases/${c.id}`)}
                    >
                      <TableCell className="font-medium tabular">{c.caseNumber}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {titleCase(c.applicationType)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="tabular w-9 text-xs text-muted-foreground">
                            {c.readinessScore}%
                          </span>
                          <ReadinessMeter value={c.readinessScore} className="flex-1" />
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(c.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageBody>

      {promoterDialog && (
        <PromoterDialog
          clientId={id}
          promoter={promoterDialog === 'new' ? null : promoterDialog}
          onClose={() => setPromoterDialog(null)}
          onSaved={() => {
            setPromoterDialog(null);
            void load();
          }}
        />
      )}
    </>
  );
}

/* ---------------------------- promoter dialog --------------------------- */

const promoterFormSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(160),
  designation: z.string().min(1, 'Choose a designation'),
  ownershipPercent: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) >= 0 && Number(v) <= 100),
      'Enter a percentage between 0 and 100',
    ),
  pan: z
    .string()
    .trim()
    .refine((v) => v === '' || PAN_REGEX.test(v), 'PAN is 5 letters, 4 digits, 1 letter'),
  aadhaarLast4: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}$/.test(v), 'Enter the last 4 digits only'),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email'),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit mobile number'),
  isPrimary: z.boolean(),
});

type PromoterFormValues = z.infer<typeof promoterFormSchema>;

function PromoterDialog({
  clientId,
  promoter,
  onClose,
  onSaved,
}: {
  clientId: string;
  promoter: Promoter | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [removing, setRemoving] = useState(false);

  const form = useForm<PromoterFormValues>({
    resolver: zodResolver(promoterFormSchema),
    defaultValues: {
      fullName: promoter?.fullName ?? '',
      designation: promoter?.designation ?? '',
      ownershipPercent: promoter?.ownershipPercent ?? '',
      pan: '',
      aadhaarLast4: promoter?.aadhaarMasked?.slice(-4) ?? '',
      email: promoter?.email ?? '',
      phone: promoter?.phone ?? '',
      isPrimary: promoter?.isPrimary ?? false,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const payload: Record<string, unknown> = { isPrimary: values.isPrimary };
    for (const [k, v] of Object.entries(values)) {
      if (k === 'isPrimary') continue;
      if (v !== '') payload[k] = v;
    }
    try {
      if (promoter) {
        await clientsApi.updatePromoter(clientId, promoter.id, payload);
      } else {
        await clientsApi.addPromoter(clientId, payload);
      }
      toast.success(promoter ? 'Promoter updated' : 'Promoter added');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [path, message] of Object.entries(err.fieldErrors)) {
          form.setError(path as keyof PromoterFormValues, { message });
        }
        toast.error(err.message);
      } else {
        toast.error('Could not save the promoter');
      }
    }
  });

  const remove = async () => {
    if (!promoter) return;
    setRemoving(true);
    try {
      await clientsApi.removePromoter(clientId, promoter.id);
      toast.success('Promoter removed');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the promoter');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{promoter ? 'Edit promoter' : 'Add promoter'}</DialogTitle>
          <DialogDescription>
            Promoters are business principals. Only the last four Aadhaar digits may be recorded.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <TextField control={form.control} name="fullName" label="Full name" required autoFocus />
            <SelectField
              control={form.control}
              name="designation"
              label="Designation"
              required
              options={PROMOTER_ROLE.map((r) => ({ value: r, label: titleCase(r) }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <PercentField control={form.control} name="ownershipPercent" label="Ownership" />
              <TextField
                control={form.control}
                name="pan"
                label="PAN"
                maxLength={10}
                uppercase
                description={promoter ? 'Blank keeps the stored value' : undefined}
              />
              <TextField
                control={form.control}
                name="aadhaarLast4"
                label="Aadhaar (last 4 only)"
                maxLength={4}
                description="Never enter the full number"
              />
              <TextField control={form.control} name="phone" label="Phone" maxLength={10} />
              <TextField
                control={form.control}
                name="email"
                label="Email"
                type="email"
                className="sm:col-span-2"
              />
            </div>
            <CheckboxField
              control={form.control}
              name="isPrimary"
              label="Primary contact for this client"
              description="Only one promoter can be primary."
            />

            <DialogFooter className="gap-2 sm:justify-between">
              {promoter ? (
                <Button type="button" variant="destructive" onClick={remove} disabled={removing}>
                  {removing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
