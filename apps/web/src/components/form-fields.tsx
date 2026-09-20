import * as React from 'react';
import { CalendarIcon, Check, ChevronsUpDown, Eye, Loader2 } from 'lucide-react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/**
 * Form fields.
 *
 * Every field is a thin wrapper over shadcn's Form primitives bound to
 * react-hook-form, so validation state, aria wiring and error messages come
 * from one place. A screen never renders a bare <input>: if a field type is
 * missing, add it here rather than hand-rolling it at the call site.
 *
 * Zod schemas come from @ifp/shared — the same ones the API validates with, so
 * a client-side message and a server-side message cannot drift apart.
 */

interface BaseProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  autoFocus?: boolean;
}

function RequiredMark({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="text-destructive" aria-hidden>
      {' '}
      *
    </span>
  );
}

/* ------------------------------- text -------------------------------- */

interface TextFieldProps<T extends FieldValues> extends BaseProps<T> {
  type?: 'text' | 'email' | 'password' | 'tel' | 'url';
  maxLength?: number;
  autoComplete?: string;
  /** Uppercases as the user types — for PAN, GSTIN, IFSC and the like. */
  uppercase?: boolean;
  onBlurCapture?: () => void;
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder,
  disabled,
  required,
  className,
  type = 'text',
  maxLength,
  autoComplete,
  uppercase,
  autoFocus,
  onBlurCapture,
}: TextFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            <RequiredMark show={required} />
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ''}
              type={type}
              placeholder={placeholder}
              disabled={disabled}
              maxLength={maxLength}
              autoComplete={autoComplete}
              autoFocus={autoFocus}
              className={cn(uppercase && 'uppercase')}
              onChange={(e) =>
                field.onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)
              }
              onBlur={() => {
                field.onBlur();
                onBlurCapture?.();
              }}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/* ----------------------------- textarea ------------------------------ */

interface TextareaFieldProps<T extends FieldValues> extends BaseProps<T> {
  rows?: number;
  maxLength?: number;
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder,
  disabled,
  required,
  className,
  rows = 3,
  maxLength,
}: TextareaFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            <RequiredMark show={required} />
          </FormLabel>
          <FormControl>
            <Textarea
              {...field}
              value={field.value ?? ''}
              rows={rows}
              maxLength={maxLength}
              placeholder={placeholder}
              disabled={disabled}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/* ------------------------------ select ------------------------------- */

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

interface SelectFieldProps<T extends FieldValues> extends BaseProps<T> {
  options: Option[];
  /** Shown when the list is empty — e.g. talukas not yet captured for a district. */
  emptyHint?: string;
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder = 'Select…',
  disabled,
  required,
  className,
  options,
  emptyHint,
}: SelectFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            <RequiredMark show={required} />
          </FormLabel>
          <Select
            onValueChange={field.onChange}
            value={field.value ?? ''}
            disabled={disabled || options.length === 0}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={options.length === 0 ? (emptyHint ?? placeholder) : placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/* ----------------------------- combobox ------------------------------ */

interface ComboboxFieldProps<T extends FieldValues> extends BaseProps<T> {
  options: Option[];
  searchPlaceholder?: string;
  emptyText?: string;
  /** Rendered under the list — e.g. "Add a branch". */
  footer?: React.ReactNode;
}

/**
 * Searchable single-select. Used where the list is long enough that scrolling
 * a native select is painful: clients, banks, districts.
 */
export function ComboboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'Nothing found.',
  disabled,
  required,
  className,
  options,
  footer,
}: ComboboxFieldProps<T>) {
  const [open, setOpen] = React.useState(false);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const selected = options.find((o) => o.value === field.value);
        return (
          <FormItem className={cn('flex flex-col', className)}>
            <FormLabel>
              {label}
              <RequiredMark show={required} />
            </FormLabel>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <FormControl>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                      'w-full justify-between font-normal',
                      !selected && 'text-muted-foreground',
                    )}
                  >
                    <span className="truncate">{selected?.label ?? placeholder}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder={searchPlaceholder} />
                  <CommandList>
                    <CommandEmpty>{emptyText}</CommandEmpty>
                    <CommandGroup>
                      {options.map((o) => (
                        <CommandItem
                          key={o.value}
                          value={`${o.label} ${o.hint ?? ''}`}
                          onSelect={() => {
                            field.onChange(o.value);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              o.value === field.value ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <div className="min-w-0">
                            <div className="truncate">{o.label}</div>
                            {o.hint && (
                              <div className="truncate text-xs text-muted-foreground">{o.hint}</div>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                  {footer && <div className="border-t p-1">{footer}</div>}
                </Command>
              </PopoverContent>
            </Popover>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

/* ------------------------------- date -------------------------------- */

/**
 * Date entry: a typed field AND a calendar.
 *
 * The two halves exist for two different users of the same screen. A CA
 * copying twenty dates off sanction letters types `15/03/2024` and tabs on —
 * forcing that person through a popover for every field would be cruel. But
 * "what was the Monday three weeks ago" is a question only a calendar answers,
 * and so is "is 31 April a date" (it is not, and the picker cannot offer it).
 *
 * Form state is always an ISO `YYYY-MM-DD` string, because that is what the
 * shared Zod schemas and the API accept. The `DD/MM/YYYY` shown in the box is
 * presentation only — Indian convention, and unambiguous on paper.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `2024-03-15` → `15/03/2024`. Returns '' for anything unparseable. */
export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso || !ISO_DATE.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Accepts `15/03/2024`, `15-03-2024`, `15032024` and `2024-03-15`.
 *
 * Returns null unless the date genuinely exists: 31/02 parses arithmetically
 * into 3 March, and silently storing the wrong date is worse than refusing it.
 */
export function displayToIso(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (ISO_DATE.test(t)) return isRealDate(t) ? t : null;

  const digits = t.replace(/\D/g, '');
  if (digits.length !== 8) return null;

  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const iso = `${yyyy}-${mm}-${dd}`;
  return isRealDate(iso) ? iso : null;
}

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Round-tripping catches 31/02 and 31/04: Date rolls them into next month.
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/** Midday UTC, so a negative timezone offset cannot roll the date backwards. */
function isoToDate(iso: string): Date | undefined {
  if (!ISO_DATE.test(iso) || !isRealDate(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DateField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  required,
  className,
  max,
  min,
}: BaseProps<T> & { max?: string; min?: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            <RequiredMark show={required} />
          </FormLabel>
          <FormControl>
            <DateInput
              value={(field.value as string | null) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              disabled={disabled}
              {...(min ? { min } : {})}
              {...(max ? { max } : {})}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * The control itself, usable outside react-hook-form (filter bars, dialogs).
 *
 * `rest` matters more than it looks: <FormControl> clones its child with the
 * generated id, aria-describedby and aria-invalid. Swallowing those would
 * leave the <FormLabel>'s htmlFor pointing at nothing and the error message
 * unannounced, so they are forwarded to the real input.
 */
export function DateInput({
  value,
  onChange,
  onBlur,
  disabled,
  min,
  max,
  placeholder = 'DD/MM/YYYY',
  className,
  ...rest
}: {
  value: string;
  onChange: (iso: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
} & Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'value' | 'onChange' | 'onBlur' | 'disabled' | 'min' | 'max' | 'placeholder' | 'className'
>) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => isoToDisplay(value));

  // Keep the box in step when the form resets or the value is set elsewhere,
  // but never while the user is mid-keystroke on this field.
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setText(isoToDisplay(value));
  }, [value, focused]);

  const selected = value ? isoToDate(value) : undefined;
  const minDate = min ? isoToDate(min) : undefined;
  const maxDate = max ? isoToDate(max) : undefined;

  const commit = (raw: string) => {
    const iso = displayToIso(raw);
    if (iso) {
      onChange(iso);
      setText(isoToDisplay(iso));
    } else if (raw.trim() === '') {
      onChange('');
    }
    // An unparseable entry is left in the box as typed. Clearing it would
    // throw away what the user wrote; the Zod message says what is wrong.
  };

  const fromYear = minDate?.getFullYear() ?? 1950;
  const toYear = maxDate?.getFullYear() ?? new Date().getFullYear() + 10;

  return (
    <div className={cn('relative flex', className)}>
      <Input
        {...rest}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        className="tabular pr-10"
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          // Commit as soon as it is unambiguous, so validation and any
          // dependent field update while typing rather than only on blur.
          const iso = displayToIso(e.target.value);
          if (iso) onChange(iso);
          else if (e.target.value.trim() === '') onChange('');
        }}
        onBlur={() => {
          setFocused(false);
          commit(text);
          onBlur?.();
        }}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Open calendar"
            className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? maxDate ?? undefined}
            captionLayout="dropdown-buttons"
            fromYear={fromYear}
            toYear={toYear}
            {...(minDate || maxDate
              ? {
                  disabled: [
                    ...(minDate ? [{ before: minDate }] : []),
                    ...(maxDate ? [{ after: maxDate }] : []),
                  ],
                }
              : {})}
            onSelect={(d) => {
              if (!d) return;
              const iso = dateToIso(d);
              onChange(iso);
              setText(isoToDisplay(iso));
              setOpen(false);
            }}
          />
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                const iso = dateToIso(new Date());
                onChange(iso);
                setText(isoToDisplay(iso));
                setOpen(false);
              }}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => {
                onChange('');
                setText('');
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ------------------------------ numbers ------------------------------ */

/** Indian digit grouping (1,23,45,678) on a decimal string — never a float. */
export function formatIndianNumber(value: string): string {
  const [whole = '0', frac] = String(value).split('.');
  const digits = whole.replace(/\D/g, '');
  if (!digits) return '';
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const [whole, frac] = String(value).split('.');
  const grouped = formatIndianNumber(whole ?? '0');
  return `₹${grouped}${frac ? `.${frac.padEnd(2, '0').slice(0, 2)}` : ''}`;
}

/**
 * Money is a decimal STRING end to end (ADR-014). This field never parses to a
 * float; it strips grouping on input and echoes the grouped value as a hint so
 * the user can check they typed the right number of zeroes.
 */
export function MoneyField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  required,
  className,
  placeholder = '0.00',
}: BaseProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const raw = String(field.value ?? '');
        const preview = raw && /^\d+(\.\d{1,2})?$/.test(raw) ? formatMoney(raw) : null;
        return (
          <FormItem className={className}>
            <FormLabel>
              {label}
              <RequiredMark show={required} />
            </FormLabel>
            <FormControl>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  ₹
                </span>
                <Input
                  {...field}
                  value={raw}
                  inputMode="decimal"
                  placeholder={placeholder}
                  disabled={disabled}
                  className="pl-7 tabular"
                  onChange={(e) => field.onChange(e.target.value.replace(/[^\d.]/g, ''))}
                />
              </div>
            </FormControl>
            {preview ? (
              <FormDescription className="tabular">{preview}</FormDescription>
            ) : (
              description && <FormDescription>{description}</FormDescription>
            )}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  required,
  className,
  placeholder,
}: BaseProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            <RequiredMark show={required} />
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ''}
              inputMode="numeric"
              placeholder={placeholder}
              disabled={disabled}
              className="tabular"
              onChange={(e) => field.onChange(e.target.value.replace(/[^\d]/g, ''))}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function PercentField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  required,
  className,
}: BaseProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            <RequiredMark show={required} />
          </FormLabel>
          <FormControl>
            <div className="relative">
              <Input
                {...field}
                value={field.value ?? ''}
                inputMode="decimal"
                placeholder="0.00"
                disabled={disabled}
                className="pr-8 tabular"
                onChange={(e) => field.onChange(e.target.value.replace(/[^\d.]/g, ''))}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/* ----------------------------- checkbox ------------------------------ */

export function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
}: BaseProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem
          className={cn(
            'flex flex-row items-start gap-3 space-y-0 rounded-md border p-3',
            className,
          )}
        >
          <FormControl>
            <Checkbox
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
              disabled={disabled}
              className="mt-0.5"
            />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel className="font-normal">{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );
}

/* ---------------------------- read-only ------------------------------ */

/**
 * A stored identifier. The API only ever sends the masked form; the full value
 * costs an audited round trip, which is the point.
 */
export function MaskedValue({
  masked,
  onReveal,
  canReveal,
  label,
}: {
  masked: string | null;
  onReveal?: () => Promise<string | null>;
  canReveal?: boolean;
  label?: string;
}) {
  const [value, setValue] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (!masked) return <span className="text-muted-foreground">—</span>;
  if (value) return <span className="masked">{value}</span>;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="masked">{masked}</span>
      {canReveal && onReveal && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setValue(await onReveal());
            } finally {
              setBusy(false);
            }
          }}
          aria-label={label ? `Reveal ${label}` : 'Reveal'}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
          Reveal
        </Button>
      )}
    </span>
  );
}
