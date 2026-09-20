import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import {
  ENTITY_TYPE,
  ENTITY_TYPE_LABEL,
  PAN_REGEX,
  GSTIN_REGEX,
  UDYAM_REGEX,
  gstinChecksumValid,
  type EntityType,
} from '@ifp/shared';
import { ApiError } from '@/api/client';
import { clientsApi, referenceApi, type District } from '@/api/endpoints';
import { Crumbs, LoadingState, PageBody, PageHeader } from '@/components/app-ui';
import {
  ComboboxField,
  DateField,
  SelectField,
  TextField,
  TextareaField,
} from '@/components/form-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';

/**
 * Form schema.
 *
 * Built on the same rules the API enforces, but expressed over the *form's*
 * shape: every field is a string, and empty means "not provided" (or, when
 * editing, "leave unchanged"). The shared schemas transform and strip; this one
 * only needs to validate what the user typed.
 */
const optional = (check: (v: string) => boolean, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || check(v), message);

const clientFormSchema = z.object({
  legalName: z.string().trim().min(1, 'Legal name is required').max(250),
  tradeName: z.string().trim().max(250),
  entityType: z.string().min(1, 'Choose an entity type'),
  constitutionNote: z.string().trim().max(250),
  businessActivity: z.string().trim().max(250),
  nicCode: z.string().trim().max(12),
  pan: optional((v) => PAN_REGEX.test(v), 'PAN is 5 letters, 4 digits, 1 letter (ABCDE1234F)'),
  gstin: optional(
    (v) => GSTIN_REGEX.test(v) && gstinChecksumValid(v),
    'That GSTIN is not valid — check the format and the last character',
  ),
  udyam: optional((v) => UDYAM_REGEX.test(v), 'Udyam looks like UDYAM-GJ-01-0000000'),
  incorporationDate: z.string(),
  regdAddressLine1: z.string().trim().max(200),
  regdAddressLine2: z.string().trim().max(200),
  regdCity: z.string().trim().max(100),
  regdDistrictCode: z.string(),
  regdPincode: optional((v) => /^[1-9][0-9]{5}$/.test(v), 'PIN code is 6 digits'),
  contactPersonName: z.string().trim().max(160),
  contactEmail: optional((v) => z.string().email().safeParse(v).success, 'Enter a valid email'),
  contactPhone: optional((v) => /^[6-9][0-9]{9}$/.test(v), 'Enter a 10-digit Indian mobile number'),
  notes: z.string().trim().max(2000),
});

type ClientFormValues = z.infer<typeof clientFormSchema>;

const EMPTY: ClientFormValues = {
  legalName: '',
  tradeName: '',
  entityType: '',
  constitutionNote: '',
  businessActivity: '',
  nicCode: '',
  pan: '',
  gstin: '',
  udyam: '',
  incorporationDate: '',
  regdAddressLine1: '',
  regdAddressLine2: '',
  regdCity: '',
  regdDistrictCode: '',
  regdPincode: '',
  contactPersonName: '',
  contactEmail: '',
  contactPhone: '',
  notes: '',
};

export function ClientFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; on: string } | null>(null);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: EMPTY,
    mode: 'onBlur',
  });

  useEffect(() => {
    void referenceApi.districts().then(setDistricts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const c = await clientsApi.get(id);
        form.reset({
          ...EMPTY,
          legalName: c.legalName,
          tradeName: c.tradeName ?? '',
          entityType: c.entityType,
          constitutionNote: c.constitutionNote ?? '',
          businessActivity: c.businessActivity ?? '',
          nicCode: c.nicCode ?? '',
          // Identifiers are encrypted and only ever arrive masked, so they are
          // deliberately NOT prefilled. Blank means "leave unchanged".
          incorporationDate: c.incorporationDate ?? '',
          regdAddressLine1: c.regdAddressLine1 ?? '',
          regdAddressLine2: c.regdAddressLine2 ?? '',
          regdCity: c.regdCity ?? '',
          regdDistrictCode: c.regdDistrictCode ?? '',
          regdPincode: c.regdPincode ?? '',
          contactPersonName: c.contactPersonName ?? '',
          contactEmail: c.contactEmail ?? '',
          contactPhone: c.contactPhone ?? '',
          notes: c.notes ?? '',
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not load the client');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Probe for an existing client as soon as an identifier is entered. */
  const checkDuplicate = async () => {
    const pan = form.getValues('pan');
    const gstin = form.getValues('gstin');
    if (!pan && !gstin) return;
    try {
      const res = await clientsApi.checkDuplicate({
        pan: pan || null,
        gstin: gstin || null,
        ...(id ? { excludeClientId: id } : {}),
      });
      setDuplicate(
        res.duplicate && res.clientId
          ? {
              id: res.clientId,
              name: res.legalName ?? 'An existing client',
              on: res.matchedOn ?? '',
            }
          : null,
      );
    } catch {
      // Non-fatal: the server re-checks on submit regardless.
    }
  };

  const entityType = form.watch('entityType');

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    // Empty string means "not provided" / "unchanged" — never send it.
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== '') payload[k] = v;
    }

    try {
      if (isEdit && id) {
        await clientsApi.update(id, payload);
        toast.success('Client updated');
        navigate(`/clients/${id}`);
      } else {
        const created = await clientsApi.create(payload);
        toast.success('Client created');
        navigate(`/clients/${created.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        // Push server-side field errors onto the matching inputs.
        for (const [path, message] of Object.entries(err.fieldErrors)) {
          form.setError(path as keyof ClientFormValues, { message });
        }
        setFormError(err.message);
        if (err.problem.conflictId) {
          setDuplicate({ id: err.problem.conflictId, name: err.message, on: '' });
        }
      } else {
        setFormError('Could not save the client');
      }
    }
  });

  if (loading) return <LoadingState label="Loading client…" />;

  return (
    <>
      <PageHeader
        back={
          <Crumbs
            items={[
              { label: 'Clients', to: '/clients' },
              { label: isEdit ? 'Edit' : 'New client' },
            ]}
          />
        }
        title={isEdit ? 'Edit client' : 'New client'}
        subtitle={isEdit ? 'Changes are recorded in the audit log' : 'The applicant entity'}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save changes' : 'Create client'}
            </Button>
          </>
        }
      />

      <PageBody className="max-w-4xl">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {formError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{formError}</AlertTitle>
              </Alert>
            )}

            {duplicate && (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>This looks like an existing client</AlertTitle>
                <AlertDescription>
                  {duplicate.name}
                  {duplicate.on && ` already uses that ${duplicate.on}.`}{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => navigate(`/clients/${duplicate.id}`)}
                    type="button"
                  >
                    Open the existing record
                  </Button>{' '}
                  instead of creating a second one.
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Entity</CardTitle>
                <CardDescription>As recorded on the PAN and constitution documents.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="legalName"
                  label="Legal name"
                  required
                  description="Exactly as it appears on the PAN"
                  className="sm:col-span-2"
                />
                <TextField control={form.control} name="tradeName" label="Trade name" />
                <SelectField
                  control={form.control}
                  name="entityType"
                  label="Entity type"
                  required
                  options={ENTITY_TYPE.map((t) => ({
                    value: t,
                    label: ENTITY_TYPE_LABEL[t as EntityType],
                  }))}
                />
                {entityType === 'OTHER' && (
                  <TextField
                    control={form.control}
                    name="constitutionNote"
                    label="Describe the constitution"
                    required
                    className="sm:col-span-2"
                  />
                )}
                <TextField control={form.control} name="businessActivity" label="Nature of business" />
                <TextField control={form.control} name="nicCode" label="NIC code" />
                <DateField
                  control={form.control}
                  name="incorporationDate"
                  label="Date of incorporation"
                  max={new Date().toISOString().slice(0, 10)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Identifiers</CardTitle>
                <CardDescription>
                  Stored encrypted with a per-firm key. Only the last four characters are ever
                  returned to this screen.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                {isEdit && (
                  <Alert className="sm:col-span-3">
                    <ShieldCheck className="h-4 w-4" />
                    <AlertDescription>
                      Existing identifiers are not shown here. Leave a field blank to keep it
                      unchanged; type a new value to replace it.
                    </AlertDescription>
                  </Alert>
                )}
                <TextField
                  control={form.control}
                  name="pan"
                  label="PAN"
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  uppercase
                  onBlurCapture={checkDuplicate}
                />
                <TextField
                  control={form.control}
                  name="gstin"
                  label="GSTIN"
                  placeholder="24ABCDE1234F1Z5"
                  maxLength={15}
                  uppercase
                  onBlurCapture={checkDuplicate}
                />
                <TextField
                  control={form.control}
                  name="udyam"
                  label="Udyam registration"
                  placeholder="UDYAM-GJ-01-0000000"
                  uppercase
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Registered address</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <TextField control={form.control} name="regdAddressLine1" label="Address line 1" />
                <TextField control={form.control} name="regdAddressLine2" label="Address line 2" />
                <TextField control={form.control} name="regdCity" label="City" />
                <ComboboxField
                  control={form.control}
                  name="regdDistrictCode"
                  label="District"
                  placeholder="Select a district…"
                  searchPlaceholder="Search districts…"
                  options={districts.map((d) => ({ value: d.code, label: d.name }))}
                />
                <TextField control={form.control} name="regdPincode" label="PIN code" maxLength={6} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contact</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <TextField control={form.control} name="contactPersonName" label="Contact person" />
                <TextField control={form.control} name="contactEmail" label="Email" type="email" />
                <TextField control={form.control} name="contactPhone" label="Phone" maxLength={10} />
                <TextareaField
                  control={form.control}
                  name="notes"
                  label="Notes"
                  className="sm:col-span-3"
                  description="Do not record PAN, Aadhaar or account numbers here — use the dedicated fields, which are encrypted."
                />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? 'Save changes' : 'Create client'}
              </Button>
            </div>
          </form>
        </Form>
      </PageBody>
    </>
  );
}
