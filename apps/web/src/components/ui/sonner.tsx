import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/components/theme-provider';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * shadcn ships this wired to next-themes; this is a Vite app, so it reads our
 * own theme provider instead.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          error: 'group-[.toaster]:border-destructive/40',
          success: 'group-[.toaster]:border-success/40',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
