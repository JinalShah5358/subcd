import * as React from 'react';
import { useForm, type Control, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/client';
import { casesApi } from '@/api/endpoints';
import {
  CheckboxField,
  DateField,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  TextField,
  TextareaField,
  formatMoney,
} from '@/components/form-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import type { FieldSpec, SectionSpec } from './sections';

/**
 * A case section.
 *
 * Every field is optional and a partial draft always saves — a CA collects this
 * information over days, often from documents that arrive separately.
 * Completeness is enforced by versioned validation rules at transition time,
 * never by refusing a save.
 */

const TODAY = new Date().toISOString().slice(0, 10);

/** Builds a Zod schema from the section descriptor, per field type. */
function buildSchema(spec: SectionSpec) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const group of spec.groups) {
    for (const f of group.fields) {
      switch (f.type) {
        case 'checkbox':
          shape[f.name] = z.boolean();
          break;
        case 'money':
          shape[f.name] = z
            .string()
            .trim()
            .refine(
              (v) => v === '' || /^\d{1,14}(\.\d{1,2})?$/.test(v),
              'Enter an amount with at most 2 decimal places',
            );
          break;
        case 'percent':
          shape[f.name] = z
            .string()
            .trim()
            .refine(
              (v) => v === '' || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100),
              'Enter a percentage between 0 and 100',
            );
          break;
        case 'number':
          shape[f.name] = z
            .string()
            .trim()
            .refine((v) => v === '' || /^\d+$/.test(v), 'Enter a whole number');
          break;
        case 'date':
          shape[f.name] = z
            .string()
            .trim()
            .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a date as DD/MM/YYYY')
            .refine((v) => v === '' || v <= TODAY, 'Date cannot be in the future');
          break;
        default:
          shape[f.name] = z.string().trim().max(f.maxLength ?? 500);
      }
    }
  }

  return z.object(shape);
}

function initialValues(spec: SectionSpec, data: Record<string, unknown> | null) {
  const out: Record<string, string | boolean> = {};
  for (const group of spec.groups) {
    for (const f of group.fields) {
      const raw = data?.[f.name];
      if (f.type === 'checkbox') out[f.name] = raw === true;
      else out[f.name] = raw === null || raw === undefined ? '' : String(raw);
    }
  }
  return out;
}

function renderField<T extends FieldValues>(
  f: FieldSpec,
  control: Control<T>,
  disabled: boolean,
) {
  const common = {
    control,
    name: f.name as never,
    label: f.label,
    disabled,
    ...(f.hint ? { description: f.hint } : {}),
  };

  switch (f.type) {
    case 'checkbox':
      return <CheckboxField key={f.name} {...common} className={f.full ? 'sm:col-span-3' : 'sm:col-span-1'} />;
    case 'select':
      return <SelectField key={f.name} {...common} options={f.options ?? []} />;
    case 'date':
      return <DateField key={f.name} {...common} max={TODAY} />;
    case 'money':
      return <MoneyField key={f.name} {...common} />;
    case 'percent':
      return <PercentField key={f.name} {...common} />;
    case 'number':
      return <NumberField key={f.name} {...common} />;
    case 'textarea':
      return <TextareaField key={f.name} {...common} className="sm:col-span-3" />;
    default:
      return <TextField key={f.name} {...common} maxLength={f.maxLength} />;
  }
}

export function SectionForm({
  caseId,
  spec,
  data,
  extra,
  extraPayload,
  locked,
  onSaved,
}: {
  caseId: string;
  spec: SectionSpec;
  data: Record<string, unknown> | null;
  /** Section-specific UI that is not a plain field (e.g. the bank picker). */
  extra?: React.ReactNode;
  /** Section-specific values merged into the save payload. */
  extraPayload?: Record<string, unknown>;
  locked: boolean;
  onSaved: () => void;
}) {
  const schema = React.useMemo(() => buildSchema(spec), [spec]);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: initialValues(spec, data) as never,
  });

  React.useEffect(() => {
    form.reset(initialValues(spec, data) as never);
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key, data]);

  const dirty = form.formState.isDirty;

  // Warn before leaving with unsaved edits.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const values = form.watch();

  const investmentTotals = React.useMemo(() => {
    if (spec.key !== 'investment') return null;
    const num = (k: string) => Number(String((values as Record<string, unknown>)[k] ?? '')) || 0;
    const heads = [
      'landCost',
      'landDevelopmentCost',
      'buildingCost',
      'plantMachineryCost',
      'electricalInstallationCost',
      'equipmentCost',
      'furnitureFixtureCost',
      'otherEligibleCost',
      'preOperativeExpenses',
    ].reduce((s, k) => s + num(k), 0);
    const funding = [
      'promoterContribution',
      'termLoanComponent',
      'workingCapitalComponent',
      'otherSourceAmount',
    ].reduce((s, k) => s + num(k), 0);
    return { heads, funding, total: num('totalProjectCost') };
  }, [spec.key, values]);

  const onSubmit = form.handleSubmit(async (formValues) => {
    setFormError(null);

    const payload: Record<string, unknown> = {};
    for (const group of spec.groups) {
      for (const f of group.fields) {
        const v = (formValues as Record<string, unknown>)[f.name];
        if (f.type === 'checkbox') payload[f.name] = Boolean(v);
        else if (v !== '' && v !== undefined) payload[f.name] = v;
      }
    }

    try {
      await casesApi.saveSection(caseId, spec.key, { ...payload, ...(extraPayload ?? {}) });
      setSavedAt(new Date());
      form.reset(formValues, { keepValues: true });
      onSaved();
      toast.success(`${spec.title} saved`);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [path, message] of Object.entries(err.fieldErrors)) {
          form.setError(path as never, { message });
        }
        setFormError(err.message);
      } else {
        setFormError('Could not save this section');
      }
      toast.error(`${spec.title} was not saved`);
    }
  });

  const mismatch =
    investmentTotals &&
    investmentTotals.total > 0 &&
    Math.abs(investmentTotals.heads - investmentTotals.total) > 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{spec.title}</CardTitle>
        {spec.blurb && <CardDescription>{spec.blurb}</CardDescription>}
      </CardHeader>

      <CardContent className="space-y-5">
        {locked && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This case is locked for editing at its current status.
            </AlertDescription>
          </Alert>
        )}
        {formError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{formError}</AlertTitle>
          </Alert>
        )}

        {extra}

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6" noValidate>
            {spec.groups.map((group, i) => (
              <div key={group.title ?? i} className="space-y-4">
                {group.title && (
                  <div className="flex items-center gap-3">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {group.title}
                    </h3>
                    <Separator className="flex-1" />
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.fields.map((f) => renderField(f, form.control, locked))}
                </div>
              </div>
            ))}

            {investmentTotals && (
              <Alert variant={mismatch ? 'warning' : 'info'}>
                {mismatch && <AlertTriangle className="h-4 w-4" />}
                <AlertDescription className="tabular">
                  Heads total <strong>{formatMoney(String(investmentTotals.heads))}</strong> ·
                  funding totals <strong>{formatMoney(String(investmentTotals.funding))}</strong> ·
                  project cost entered as{' '}
                  <strong>{formatMoney(String(investmentTotals.total))}</strong>.
                  {mismatch && ' These do not reconcile — validation will flag it.'}
                </AlertDescription>
              </Alert>
            )}

            <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur no-print">
              <Button type="submit" disabled={locked || form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save section
              </Button>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {dirty ? (
                  'Unsaved changes'
                ) : savedAt ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-success" />
                    Saved at {savedAt.toLocaleTimeString()}
                  </>
                ) : (
                  'No changes'
                )}
              </span>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
