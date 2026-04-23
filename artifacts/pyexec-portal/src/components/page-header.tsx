import { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  icon,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="relative border-b bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/50 -mx-6 md:-mx-10 px-6 md:px-10 pt-6 pb-5 mb-6 sticky top-0 z-10 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(ellipse 60% 80% at 0% 0%, hsl(var(--primary) / 0.08), transparent 60%), radial-gradient(ellipse 40% 60% at 100% 0%, hsl(var(--primary) / 0.05), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "linear-gradient(to bottom, black, transparent)",
        }}
      />
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <div className="shrink-0 h-11 w-11 rounded-md bg-gradient-to-br from-primary/15 to-primary/5 text-primary flex items-center justify-center ring-1 ring-primary/15 shadow-sm">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground truncate">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-4 ${className}`}>
      {(title || actions || description) && (
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
