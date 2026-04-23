import { useGetDashboardStats, getGetDashboardStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Code2, Users, Building2, Terminal, LayoutDashboard } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/page-header";

export default function Dashboard() {
  const { data: stats, isLoading, error } = useGetDashboardStats({
    query: {
      queryKey: getGetDashboardStatsQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Overview of platform activity and metrics." icon={<LayoutDashboard className="h-5 w-5" />} />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return <div className="text-destructive">Failed to load dashboard statistics.</div>;
  }

  return (
    <div>
      <PageHeader title="Dashboard" description="Overview of platform activity and metrics." icon={<LayoutDashboard className="h-5 w-5" />} />
      <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Scripts</CardTitle>
            <Code2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalScripts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Executions</CardTitle>
            <Terminal className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalExecutions}</div>
            <p className="text-xs text-muted-foreground">
              {stats.recentExecutions} in the last 24h
            </p>
          </CardContent>
        </Card>
        {stats.totalUsers !== undefined && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
            </CardContent>
          </Card>
        )}
        {stats.totalDepartments !== undefined && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Departments</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalDepartments}</div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {stats.recentActivity && stats.recentActivity.length > 0 && (
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest actions performed across the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.recentActivity.map((log) => (
                  <div key={log.id} className="flex items-center gap-4">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {log.action}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {log.userEmail || 'System'} • {log.resourceType} {log.resourceId ? `(${log.resourceId})` : ''}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(log.createdAt), "MMM d, HH:mm")}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {stats.scriptsByDepartment && stats.scriptsByDepartment.length > 0 && (
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle>Scripts by Department</CardTitle>
              <CardDescription>Distribution of scripts across the organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.scriptsByDepartment.map((dept) => (
                  <div key={dept.departmentName} className="flex items-center justify-between">
                    <span className="text-sm font-medium">{dept.departmentName}</span>
                    <span className="text-sm text-muted-foreground">{dept.count} scripts</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}
