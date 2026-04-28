import { useGetDashboardStats, getGetDashboardStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Code2,
  Users,
  Building2,
  Terminal,
  LayoutDashboard,
  TrendingUp,
  Sparkles,
  Zap,
  Plus,
  Pencil,
  Trash2,
  LogIn,
  PlayCircle,
} from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/page-header";
import type { ReactNode } from "react";

type StatTone = "indigo" | "fuchsia" | "emerald" | "amber";

const TONE_STYLES: Record<
  StatTone,
  {
    gradient: string;
    ring: string;
    iconBg: string;
    iconText: string;
    glow: string;
    accent: string;
    bar: string;
  }
> = {
  indigo: {
    gradient: "from-indigo-500/15 via-violet-500/10 to-transparent",
    ring: "ring-indigo-500/20",
    iconBg: "bg-gradient-to-br from-indigo-500 to-violet-600",
    iconText: "text-white",
    glow: "shadow-[0_18px_40px_-18px_hsl(250_85%_60%/0.55)]",
    accent: "text-indigo-600 dark:text-indigo-300",
    bar: "from-indigo-500 to-violet-500",
  },
  fuchsia: {
    gradient: "from-fuchsia-500/15 via-pink-500/10 to-transparent",
    ring: "ring-fuchsia-500/20",
    iconBg: "bg-gradient-to-br from-fuchsia-500 to-pink-600",
    iconText: "text-white",
    glow: "shadow-[0_18px_40px_-18px_hsl(322_85%_60%/0.55)]",
    accent: "text-fuchsia-600 dark:text-fuchsia-300",
    bar: "from-fuchsia-500 to-pink-500",
  },
  emerald: {
    gradient: "from-emerald-500/15 via-teal-500/10 to-transparent",
    ring: "ring-emerald-500/20",
    iconBg: "bg-gradient-to-br from-emerald-500 to-teal-600",
    iconText: "text-white",
    glow: "shadow-[0_18px_40px_-18px_hsl(160_85%_45%/0.55)]",
    accent: "text-emerald-600 dark:text-emerald-300",
    bar: "from-emerald-500 to-teal-500",
  },
  amber: {
    gradient: "from-amber-400/20 via-orange-500/10 to-transparent",
    ring: "ring-amber-500/20",
    iconBg: "bg-gradient-to-br from-amber-500 to-orange-600",
    iconText: "text-white",
    glow: "shadow-[0_18px_40px_-18px_hsl(35_90%_55%/0.55)]",
    accent: "text-amber-600 dark:text-amber-300",
    bar: "from-amber-400 to-orange-500",
  },
};

function StatCard({
  title,
  value,
  hint,
  icon,
  tone,
  testId,
}: {
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  tone: StatTone;
  testId?: string;
}) {
  const t = TONE_STYLES[tone];
  return (
    <Card
      data-testid={testId}
      className={`relative overflow-hidden ring-1 ${t.ring} ${t.glow} border-transparent`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br ${t.gradient}`}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "conic-gradient(from 180deg, hsl(var(--primary) / 0.35), transparent 60%)",
        }}
      />
      <CardHeader className="relative z-10 flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div
          className={`h-10 w-10 rounded-xl ${t.iconBg} ${t.iconText} flex items-center justify-center shadow-md ring-1 ring-white/20`}
        >
          {icon}
        </div>
      </CardHeader>
      <CardContent className="relative z-10">
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {hint && (
          <p className={`text-xs mt-1 font-medium ${t.accent}`}>{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

const ACTION_STYLE: Record<
  string,
  { icon: ReactNode; bg: string; text: string }
> = {
  create: {
    icon: <Plus className="h-4 w-4" />,
    bg: "bg-emerald-500/15",
    text: "text-emerald-600 dark:text-emerald-300",
  },
  update: {
    icon: <Pencil className="h-4 w-4" />,
    bg: "bg-amber-500/15",
    text: "text-amber-600 dark:text-amber-300",
  },
  delete: {
    icon: <Trash2 className="h-4 w-4" />,
    bg: "bg-rose-500/15",
    text: "text-rose-600 dark:text-rose-300",
  },
  login: {
    icon: <LogIn className="h-4 w-4" />,
    bg: "bg-sky-500/15",
    text: "text-sky-600 dark:text-sky-300",
  },
  execute: {
    icon: <PlayCircle className="h-4 w-4" />,
    bg: "bg-violet-500/15",
    text: "text-violet-600 dark:text-violet-300",
  },
};

function actionStyle(action: string): { icon: ReactNode; bg: string; text: string } {
  const key = action.toLowerCase();
  const match = Object.keys(ACTION_STYLE).find((k) => key.includes(k));
  if (match) return ACTION_STYLE[match];
  return {
    icon: <Activity className="h-4 w-4" />,
    bg: "bg-indigo-500/15",
    text: "text-indigo-600 dark:text-indigo-300",
  };
}

const DEPT_BARS = [
  "from-indigo-500 to-violet-500",
  "from-fuchsia-500 to-pink-500",
  "from-emerald-500 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-sky-500 to-cyan-500",
  "from-rose-500 to-red-500",
];

export default function Dashboard() {
  const { data: stats, isLoading, error } = useGetDashboardStats({
    query: {
      queryKey: getGetDashboardStatsQueryKey(),
    },
  });

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          description="Overview of platform activity and metrics."
          icon={<LayoutDashboard className="h-5 w-5" />}
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="text-destructive">Failed to load dashboard statistics.</div>
    );
  }

  const departmentMax =
    stats.scriptsByDepartment && stats.scriptsByDepartment.length > 0
      ? Math.max(...stats.scriptsByDepartment.map((d: { count: number }) => d.count), 1)
      : 1;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of platform activity and metrics."
        icon={<LayoutDashboard className="h-5 w-5" />}
      />
      <div className="space-y-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            testId="stat-total-scripts"
            title="Total Scripts"
            value={stats.totalScripts}
            hint={
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Library size
              </span>
            }
            icon={<Code2 className="h-5 w-5" />}
            tone="indigo"
          />
          <StatCard
            testId="stat-total-executions"
            title="Total Executions"
            value={stats.totalExecutions}
            hint={
              <span className="inline-flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {stats.recentExecutions} in the last 24h
              </span>
            }
            icon={<Terminal className="h-5 w-5" />}
            tone="fuchsia"
          />
          {stats.totalUsers !== undefined && (
            <StatCard
              testId="stat-total-users"
              title="Total Users"
              value={stats.totalUsers}
              hint={
                <span className="inline-flex items-center gap-1">
                  <Zap className="h-3 w-3" /> Active members
                </span>
              }
              icon={<Users className="h-5 w-5" />}
              tone="emerald"
            />
          )}
          {stats.totalDepartments !== undefined && (
            <StatCard
              testId="stat-total-departments"
              title="Departments"
              value={stats.totalDepartments}
              hint={
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Organisational units
                </span>
              }
              icon={<Building2 className="h-5 w-5" />}
              tone="amber"
            />
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {stats.recentActivity && stats.recentActivity.length > 0 && (
            <Card
              data-testid="card-recent-activity"
              className="col-span-1 relative overflow-hidden ring-1 ring-indigo-500/10"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-emerald-500"
              />
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-sm">
                    <Activity className="h-4 w-4" />
                  </span>
                  Recent Activity
                </CardTitle>
                <CardDescription>
                  Latest actions performed across the platform.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats.recentActivity.map((log: {
                    id: string | number;
                    action: string;
                    userEmail?: string | null;
                    resourceType: string;
                    resourceId?: string | number | null;
                    createdAt: string | Date;
                  }) => {
                    const s = actionStyle(log.action);
                    return (
                      <div
                        key={log.id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted/60"
                      >
                        <div
                          className={`shrink-0 h-9 w-9 rounded-xl ${s.bg} ${s.text} flex items-center justify-center ring-1 ring-current/10`}
                        >
                          {s.icon}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm font-medium leading-none truncate">
                            {log.action}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {log.userEmail || "System"} • {log.resourceType}
                            {log.resourceId ? ` (${log.resourceId})` : ""}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">
                          {format(new Date(log.createdAt), "MMM d, HH:mm")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {stats.scriptsByDepartment && stats.scriptsByDepartment.length > 0 && (
            <Card
              data-testid="card-scripts-by-department"
              className="col-span-1 relative overflow-hidden ring-1 ring-fuchsia-500/10"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-fuchsia-500 via-pink-500 to-amber-400"
              />
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-fuchsia-500 to-pink-600 text-white flex items-center justify-center shadow-sm">
                    <Building2 className="h-4 w-4" />
                  </span>
                  Scripts by Department
                </CardTitle>
                <CardDescription>
                  Distribution of scripts across the organization.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.scriptsByDepartment.map((dept: { departmentName: string; count: number }, idx: number) => {
                    const pct = Math.round((dept.count / departmentMax) * 100);
                    const bar = DEPT_BARS[idx % DEPT_BARS.length];
                    return (
                      <div key={dept.departmentName} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium truncate">
                            {dept.departmentName}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {dept.count}{" "}
                            <span className="text-xs">
                              {dept.count === 1 ? "script" : "scripts"}
                            </span>
                          </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${bar} transition-all duration-700`}
                            style={{ width: `${Math.max(pct, 6)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
