import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  CalendarClock,
  ChevronDown,
  FileText,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Puzzle,
  Moon,
  ScrollText,
  Shield,
  Sun,
  Users,
  Users2,
} from 'lucide-react';

import { adminApi, type LicenseView } from '@/api/endpoints';
import { LicenseBanner } from '@/components/license-ui';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthContext';
import { useTheme } from '@/components/theme-provider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  permission?: string;
}

/**
 * The firm's own navigation.
 *
 * Every item carries the permission its route requires, so the sidebar and
 * the router agree about what a role may reach. A link that renders and then
 * lands on "not available to your role" is a worse experience than no link.
 */
const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, permission: 'case:read' },
  { to: '/clients', label: 'Clients', icon: Users2, permission: 'client:read' },
  { to: '/cases', label: 'Cases', icon: FileText, permission: 'case:read' },
  { to: '/extension', label: 'Browser extension', icon: Puzzle, permission: 'case:read' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users', label: 'Users', icon: Users, permission: 'user:manage' },
  { to: '/admin/firm', label: 'Firm settings', icon: Building2, permission: 'firm:manage' },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
];

/**
 * The platform administrator's navigation, and the whole of it.
 *
 * A platform admin is not a senior firm user, so they do not get the firm's
 * sidebar with the interesting parts greyed out — they get a different
 * sidebar. Theirs is a tenant that deliberately holds no clients and no
 * cases, and showing them Clients, Cases, Users, Firm settings and the audit
 * log implied those screens had something behind them.
 */
const PLATFORM_NAV: NavItem[] = [
  { to: '/platform', label: 'Overview', icon: LayoutDashboard, end: true, permission: 'platform:admin' },
  { to: '/platform/firms', label: 'Firms', icon: Globe2, permission: 'platform:admin' },
  {
    to: '/platform/licenses',
    label: 'Renewals',
    icon: CalendarClock,
    permission: 'platform:admin',
  },
];

/** Exported for `app-shell.nav.test.tsx`, which asserts the two consoles stay apart. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const platform = can('platform:admin');

  // Either/or, not both. The two consoles have nothing in common but the
  // chrome around them.
  const mainItems = platform ? [] : MAIN_NAV.filter((i) => can(i.permission as never));
  const adminItems = platform ? [] : ADMIN_NAV.filter((i) => can(i.permission as never));
  const platformItems = platform ? PLATFORM_NAV : [];

  const item = (i: NavItem) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-sidebar-accent font-medium text-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* A rail on the active item, so the current section is findable
              without relying on a background tint alone. */}
          <span
            aria-hidden
            className={cn(
              'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <i.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
          {i.label}
        </>
      )}
    </NavLink>
  );

  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
      {mainItems.map(item)}
      {adminItems.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Administration
          </p>
          {adminItems.map(item)}
        </>
      )}
      {platformItems.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Platform
          </p>
          {platformItems.map(item)}
        </>
      )}
    </nav>
  );
}

function Brand() {
  const { user, can } = useAuth();
  // A platform admin has no '/' to go to — it redirects. Point the wordmark
  // at the console they actually hold.
  const home = can('platform:admin') ? '/platform' : '/';
  return (
    <Link
      to={home}
      className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5 transition-colors hover:bg-sidebar-accent/50"
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-bold tracking-tight text-primary-foreground shadow-sm">
        IFP
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">Subsidy Cases</p>
        <p className="truncate text-xs text-muted-foreground">{user?.firm.name}</p>
      </div>
    </Link>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Change theme">
              <Icon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Theme: {theme}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const initials = (user?.fullName ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-start gap-2 px-2 py-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium leading-tight">
              {user?.fullName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{user?.role.name}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">{user?.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Shield className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Role</span>
          <Badge variant="secondary" className="ml-auto">
            {user?.role.name}
          </Badge>
        </div>
        <div className="flex items-center gap-2 px-2 pb-1.5">
          <span className="w-3.5" />
          <span className="text-xs text-muted-foreground">Permissions</span>
          <span className="tabular ml-auto text-xs font-medium">{user?.permissions.length}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Brand />
      <NavLinks {...(onNavigate ? { onNavigate } : {})} />
      <Separator className="bg-sidebar-border" />
      <div className="flex items-center gap-1 p-2">
        <div className="min-w-0 flex-1">
          <UserMenu />
        </div>
        <ThemeToggle />
      </div>
    </>
  );
}

/** The title shown in the mobile top bar, derived from the route. */
function useSectionTitle(): string {
  const { pathname } = useLocation();
  const all = [...MAIN_NAV, ...ADMIN_NAV, ...PLATFORM_NAV];
  // '/platform' is a prefix of '/platform/firms', so the longest match wins
  // below — but only because the Overview item is marked `end`.
  const match = all
    .filter((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match?.label ?? 'Subsidy Cases';
}

/**
 * The firm's own licence, fetched once for the banner.
 *
 * Deliberately silent on failure. A licence notice is information, not a
 * gate — the gate is the API refusing the write — so a firm should never see
 * an error about the thing that was only ever going to tell them their
 * licence is fine.
 */
function useOwnLicense(): LicenseView | null {
  const [license, setLicense] = useState<LicenseView | null>(null);

  useEffect(() => {
    let live = true;
    void adminApi
      .firm()
      .then((f) => {
        if (live) setLicense(f.license ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return license;
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const title = useSectionTitle();
  const license = useOwnLicense();

  // A route change with the drawer left open hides the page behind it.
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex no-print">
        <SidebarBody />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="flex w-64 flex-col border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur lg:hidden no-print">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="truncate text-sm font-semibold">{title}</span>
        </div>

        <main className="min-w-0 flex-1 animate-fade-in">
          {license && license.state !== 'VALID' && (
            <div className="px-4 pt-4 sm:px-6">
              <LicenseBanner license={license} />
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
