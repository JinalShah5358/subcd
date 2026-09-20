import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CheckCircle2,
  FileCheck2,
  Loader2,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import {
  hasPermission,
  loginSchema,
  password as passwordSchema,
  type SessionUser,
} from '@ifp/shared';
import { ApiError } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import { TextField } from '@/components/form-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* The left panel is not decoration: it states, before anyone signs in,
          what this tool does and — more importantly — what it does not do. */}
      <aside className="relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary-foreground/15 text-sm font-bold ring-1 ring-inset ring-primary-foreground/25">
            IFP
          </div>
          <div>
            <p className="font-semibold leading-tight">IFP Subsidy Platform</p>
            <p className="text-xs opacity-80">Case management for CA firms</p>
          </div>
        </div>

        <div className="relative max-w-md space-y-7">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight">
            Gujarat IFP subsidy cases, prepared and checked before they are filed.
          </h2>

          <ul className="space-y-4 text-sm">
            <li className="flex gap-3">
              <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
              <span className="opacity-90">
                Structural checks run on every case — formats, arithmetic, date ordering,
                documents and consent — before a status can move.
              </span>
            </li>
            <li className="flex gap-3">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
              <span className="opacity-90">
                PAN, GSTIN and account numbers are encrypted per firm and shown masked. Revealing
                one is an audited action.
              </span>
            </li>
            <li className="flex gap-3">
              <ScrollText className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
              <span className="opacity-90">
                Every consequential action is recorded in an append-only audit log — that it
                happened, never the value itself.
              </span>
            </li>
          </ul>
        </div>

        <p className="relative max-w-md border-l-2 border-primary-foreground/30 pl-4 text-xs leading-relaxed opacity-80">
          This platform does not file anything. Logging in to the government portal, solving the
          CAPTCHA and pressing submit remain entirely with the CA.
        </p>
      </aside>

      <div className="flex flex-1 items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              IFP
            </div>
            <div>
              <p className="font-semibold leading-tight">IFP Subsidy Platform</p>
              <p className="text-xs text-muted-foreground">Case management for CA firms</p>
            </div>
          </div>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg">{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground lg:hidden">
            This platform prepares and checks case data. Filing on the government portal remains
            with the CA.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- demo accounts ----------------------------- */

/**
 * Seeded development accounts, one per role.
 *
 * DEVELOPMENT ONLY. The whole block sits behind `import.meta.env.DEV`, so it
 * is not merely hidden in a production build — Vite eliminates it, and these
 * strings never reach a production bundle. A one-click credential filler on a
 * real sign-in page would be indefensible.
 *
 * The password matches prisma/seed's default. If you seeded with
 * SEED_DEMO_PASSWORD, set VITE_DEMO_PASSWORD to the same value.
 */
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD ?? 'ChangeMe!Dev2026';

/** The four roles inside one CA firm. */
const FIRM_ACCOUNTS = [
  { label: 'Firm admin', email: 'admin@demo.local', hint: 'Everything in the firm, incl. users and audit' },
  { label: 'CA', email: 'ca@demo.local', hint: 'Reveal identifiers, consent, transitions' },
  { label: 'Staff', email: 'staff@demo.local', hint: 'Data entry only' },
  { label: 'Reviewer', email: 'reviewer@demo.local', hint: 'Read-only' },
] as const;

/**
 * The super admin, kept apart from the four above on purpose.
 *
 * It is not a senior version of "Firm admin" — it belongs to a different
 * tenant entirely, and it can see firms, licences and counts while being
 * unable to open a single client or case. Listing it as a fifth peer button
 * made it look like one more rung on the same ladder.
 */
const PLATFORM_ACCOUNT = {
  label: 'Super admin (platform)',
  email: 'platform@demo.local',
  hint: 'Firms, licences and renewals — no client data, in any firm',
} as const;

function DemoAccounts({
  onUse,
  busy,
}: {
  onUse: (email: string, password: string) => void;
  busy: string | null;
}) {
  if (!import.meta.env.DEV) return null;

  const button = (a: { label: string; email: string; hint: string }, primary = false) => (
    <Tooltip key={a.email}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={primary ? 'default' : 'outline'}
          size="sm"
          className={primary ? 'w-full justify-center' : 'justify-start'}
          disabled={busy !== null}
          onClick={() => onUse(a.email, DEMO_PASSWORD)}
        >
          {busy === a.email ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : primary ? (
            <ShieldCheck className="mr-2 h-3.5 w-3.5 shrink-0" />
          ) : (
            <UserRound className="mr-2 h-3.5 w-3.5 shrink-0" />
          )}
          {a.label}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="font-medium">{a.email}</p>
        <p className="text-xs opacity-80">{a.hint}</p>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div className="mt-6">
      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          Demo accounts
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Inside a CA firm
          </p>
          <div className="grid grid-cols-2 gap-2">{FIRM_ACCOUNTS.map((a) => button(a))}</div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Running the platform
          </p>
          {button(PLATFORM_ACCOUNT, true)}
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        One click signs you straight in, so you can compare what each role may do.
        Development build only.
      </p>
    </div>
  );
}

/* -------------------------------- login -------------------------------- */

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.input<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  /**
   * Where a newly signed-in account should land.
   *
   * A platform administrator has no clients and no cases — theirs is a tenant
   * that deliberately holds none — so the case dashboard greets them with
   * three zeroes and no hint that the firms console exists. Send them to the
   * screen they actually signed in for. An explicit `next` always wins, so a
   * deep link the user followed still works.
   */
  const landingFor = (u: SessionUser): string => {
    const next = params.get('next');
    if (next) return next;
    return hasPermission(u.permissions, 'platform:admin') ? '/platform' : '/';
  };

  const signIn = async (email: string, password: string) => {
    setError(null);
    const u = await login(email, password);
    navigate(landingFor(u), { replace: true });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signIn(values.email, values.password);
    } catch (err) {
      // Deliberately generic — the API never discloses whether an account exists.
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    }
  });

  return (
    <AuthFrame title="Sign in">
      {params.get('reset') && (
        <Alert className="mb-4">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Password updated</AlertTitle>
          <AlertDescription>Sign in with your new password.</AlertDescription>
        </Alert>
      )}
      {params.get('welcome') && (
        <Alert className="mb-4">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Account ready</AlertTitle>
          <AlertDescription>Sign in to get started.</AlertDescription>
        </Alert>
      )}

      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            control={form.control}
            name="email"
            label="Email"
            type="email"
            autoComplete="username"
            required
            autoFocus
          />
          <TextField
            control={form.control}
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
          />

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </Button>

          <p className="text-center text-sm">
            <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground hover:underline">
              Forgot your password?
            </Link>
          </p>
        </form>
      </Form>

      <DemoAccounts
        busy={demoBusy}
        onUse={async (email, password) => {
          // Fill the form as well as submitting it: if the sign-in fails, the
          // credentials that were tried are still on screen to be corrected
          // rather than vanishing along with the attempt.
          setError(null);
          form.setValue('email', email, { shouldValidate: true, shouldDirty: true });
          form.setValue('password', password, { shouldValidate: true, shouldDirty: true });
          setDemoBusy(email);
          try {
            await signIn(email, password);
          } catch (err) {
            setError(
              err instanceof ApiError ? err.message : 'Could not sign in. Please try again.',
            );
          } finally {
            setDemoBusy(null);
          }
        }}
      />
    </AuthFrame>
  );
}

/* ---------------------------- forgot password --------------------------- */

const forgotSchema = z.object({ email: z.string().email('Enter a valid email address') });

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await authApi.forgot(values.email);
    } catch {
      // Ignored on purpose: the response is identical either way.
    } finally {
      setSent(true);
    }
  });

  return (
    <AuthFrame title="Reset your password">
      {sent ? (
        <div className="space-y-4">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Check your inbox</AlertTitle>
            <AlertDescription>
              If that address is registered, a reset link is on its way. It is valid for 15 minutes.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              required
              autoFocus
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
            <p className="text-center text-sm">
              <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        </Form>
      )}
    </AuthFrame>
  );
}

/* ----------------------------- reset password --------------------------- */

const resetSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'The two passwords do not match',
    path: ['confirm'],
  });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await authApi.reset(token, values.password);
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password');
    }
  });

  if (!token) {
    return (
      <AuthFrame title="Reset your password">
        <Alert variant="destructive">
          <AlertDescription>
            That link is missing its token. <Link to="/forgot-password" className="underline">Request a new one</Link>.
          </AlertDescription>
        </Alert>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Choose a new password" description="At least 12 characters.">
      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <TextField
            control={form.control}
            name="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
          />
          <TextField
            control={form.control}
            name="confirm"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
          />
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Set password
          </Button>
        </form>
      </Form>
    </AuthFrame>
  );
}

/* ----------------------------- accept invite ---------------------------- */

const inviteSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your full name').max(160),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'The two passwords do not match',
    path: ['confirm'],
  });

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { fullName: '', password: '', confirm: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await authApi.acceptInvite(token, values.fullName, values.password);
      navigate('/login?welcome=1', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the invitation');
    }
  });

  if (!token) {
    return (
      <AuthFrame title="Accept your invitation">
        <Alert variant="destructive">
          <AlertDescription>That invitation link is missing its token.</AlertDescription>
        </Alert>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Set up your account" description="Choose a password of at least 12 characters.">
      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <TextField control={form.control} name="fullName" label="Full name" required autoFocus />
          <TextField
            control={form.control}
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            required
          />
          <TextField
            control={form.control}
            name="confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
          />
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create account
          </Button>
        </form>
      </Form>
    </AuthFrame>
  );
}
