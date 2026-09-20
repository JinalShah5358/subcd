import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  LICENSE_PLANS,
  LICENSE_PLAN_LABEL,
  PLAN_DEFAULTS,
  defaultExpiryFor,
  type LicensePlan,
} from '@ifp/shared';
import { ApiError } from '@/api/client';
import { platformApi, type LicenseView } from '@/api/endpoints';
import { QuotaCell } from '@/components/license-ui';
import { DateField, SelectField, TextField, TextareaField } from '@/components/form-fields';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';

/**
 * Setting a firm's licence.
 *
 * Every quota box may be left empty, and empty means unlimited — which is why
 * they are text boxes with a stated meaning rather than number spinners that
 * bottom out at zero. A limit of 0 and no limit at all are opposite
 * instructions and must not be one keystroke apart.
 */

const UNLIMITED = 'Leave empty for unlimited';

const quota = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{1,7}$/.test(v), 'A whole number, or empty for unlimited');

const licenseForm = z.object({
  plan: z.enum(LICENSE_PLANS),
  expiresAt: z.string().trim(),
  graceDays: z
    .string()
    .trim()
    .refine((v) => /^\d{1,3}$/.test(v) && Number(v) <= 180, 'Between 0 and 180 days'),
  maxUsers: quota,
  maxClients: quota,
  maxCases: quota,
  note: z.string().trim().max(500),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
});

type LicenseFormValues = z.infer<typeof licenseForm>;

const toField = (v: number | null): string => (v === null ? '' : String(v));
const toQuota = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export function LicenseDialog({
  firm,
  onClose,
  onDone,
}: {
  firm: { id: string; name: string; license: LicenseView };
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const current = firm.license;

  const form = useForm<LicenseFormValues>({
    resolver: zodResolver(licenseForm),
    defaultValues: {
      plan: current.plan,
      expiresAt: current.expiresAt ?? '',
      graceDays: String(current.graceDays),
      maxUsers: toField(current.limits.users),
      maxClients: toField(current.limits.clients),
      maxCases: toField(current.limits.cases),
      note: '',
      reason: '',
    },
  });

  /**
   * Picking a plan fills in that plan's usual terms — it does not lock them.
   * Deliberately a button rather than a watcher on the select: silently
   * rewriting a limit somebody has just typed because they then changed the
   * plan label is the kind of helpfulness that loses work.
   */
  const applyPlanDefaults = () => {
    const plan = form.getValues('plan') as LicensePlan;
    const d = PLAN_DEFAULTS[plan];
    form.setValue('expiresAt', defaultExpiryFor(plan, new Date()) ?? '');
    form.setValue('graceDays', String(d.graceDays));
    form.setValue('maxUsers', toField(d.maxUsers));
    form.setValue('maxClients', toField(d.maxClients));
    form.setValue('maxCases', toField(d.maxCases));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await platformApi.setLicense(firm.id, {
        plan: values.plan,
        expiresAt: values.expiresAt === '' ? null : values.expiresAt,
        graceDays: Number(values.graceDays),
        maxUsers: toQuota(values.maxUsers),
        maxClients: toQuota(values.maxClients),
        maxCases: toQuota(values.maxCases),
        note: values.note === '' ? null : values.note,
        reason: values.reason,
      });

      if (result.alreadyOverLimit.length > 0) {
        toast.warning(`${firm.name}: licence saved, but already over the limit`, {
          description: `${result.alreadyOverLimit.join(' and ')} exceed what the new licence allows. Nothing was removed — they simply cannot add more.`,
        });
      } else {
        toast.success(`${firm.name}: licence updated`);
      }
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? [err.message, err.problem.detail].filter(Boolean).join(' — ')
          : 'Could not save the licence',
      );
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Licence for {firm.name}</DialogTitle>
          <DialogDescription>
            An expired licence makes this firm read-only. They keep sign-in, every case stays
            readable and exportable, and nothing is deleted — they simply cannot create or change
            records until it is renewed.
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

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                In use today
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  Users <QuotaCell used={current.used.users} limit={current.limits.users} />
                </span>
                <span>
                  Clients <QuotaCell used={current.used.clients} limit={current.limits.clients} />
                </span>
                <span>
                  Cases <QuotaCell used={current.used.cases} limit={current.limits.cases} />
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="plan"
                label="Plan"
                required
                options={LICENSE_PLANS.map((p) => ({ value: p, label: LICENSE_PLAN_LABEL[p] }))}
              />
              <div className="flex items-end">
                <Button type="button" variant="outline" size="sm" onClick={applyPlanDefaults}>
                  Fill in this plan&apos;s usual terms
                </Button>
              </div>

              <DateField
                control={form.control}
                name="expiresAt"
                label="Valid until"
                description="Leave empty for a licence with no end date."
              />
              <TextField
                control={form.control}
                name="graceDays"
                label="Grace period (days)"
                description="After expiry, before the firm goes read-only."
              />
            </div>

            <Separator />

            <div>
              <p className="text-sm font-medium">Limits</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Checked when something is created. Lowering a limit never removes anything that
                already exists.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  control={form.control}
                  name="maxUsers"
                  label="Max team members"
                  description={UNLIMITED}
                />
                <TextField
                  control={form.control}
                  name="maxClients"
                  label="Max clients"
                  description={UNLIMITED}
                />
                <TextField
                  control={form.control}
                  name="maxCases"
                  label="Max cases"
                  description={UNLIMITED}
                />
              </div>
            </div>

            <TextField
              control={form.control}
              name="note"
              label="Internal note"
              description="Kept on the firm. Visible to platform administrators only."
            />

            <TextareaField
              control={form.control}
              name="reason"
              label="Reason"
              required
              description="Recorded in the audit trail. “Renewed, invoice INV-2027-114” is worth more in six months than a changed date."
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save licence
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
