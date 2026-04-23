import { useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function AdminAudit() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("");
  const limit = 20;

  const { user } = useAuth();
  const { data: profile } = useGetMyProfile({
    query: { enabled: !!user?.id, queryKey: getGetMyProfileQueryKey() }
  });
  const isAdmin = profile?.role === "admin";

  const { data, isLoading } = useListAuditLogs({
    page,
    limit,
    ...(actionFilter !== "all" ? { action: actionFilter } : {}),
    ...(userFilter ? { userId: userFilter } : {})
  }, {
    query: {
      queryKey: [
        ...getListAuditLogsQueryKey(),
        { page, limit, actionFilter, userFilter }
      ] as const
    }
  });

  const getActionColor = (action: string) => {
    if (action.includes("create") || action.includes("upload")) return "default";
    if (action.includes("delete")) return "destructive";
    if (action.includes("execute") || action.includes("run")) return "secondary";
    return "outline";
  };

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Audit Log" : "My Activity"}
        description={isAdmin ? "Comprehensive system activity trail." : "Your recent activity in the platform."}
        icon={<ScrollText className="h-5 w-5" />}
      />

      <div className="flex gap-4 mb-6">
        <Select value={actionFilter} onValueChange={(val) => { setActionFilter(val); setPage(1); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="script.execute">Script Execute</SelectItem>
            <SelectItem value="script.upload">Script Upload</SelectItem>
            <SelectItem value="script.delete">Script Delete</SelectItem>
            <SelectItem value="user.assign_department">Assign Department</SelectItem>
            <SelectItem value="user.assign_role">Assign Role</SelectItem>
            <SelectItem value="auth.sync">User Login/Sync</SelectItem>
          </SelectContent>
        </Select>

        {isAdmin && (
          <Input
            placeholder="Filter by user clerk ID..."
            className="max-w-xs"
            value={userFilter}
            onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
          />
        )}
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading audit logs...</TableCell>
                </TableRow>
              ) : (!data?.logs || data.logs.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Activity className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">No audit records found.</p>
                  </TableCell>
                </TableRow>
              ) : (
                data.logs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground font-mono">
                      {format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getActionColor(log.action) as any} className="text-xs font-mono">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate" title={log.userEmail || log.userId || "System"}>
                      {log.userEmail || "System"}
                    </TableCell>
                    <TableCell>
                      {log.resourceType && (
                        <span className="text-xs">
                          <span className="text-muted-foreground font-mono">{log.resourceType}</span>
                          {log.resourceId && <span className="ml-1 font-mono">#{log.resourceId}</span>}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.ipAddress || "-"}
                    </TableCell>
                    <TableCell>
                      {log.details && Object.keys(log.details).length > 0 ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 text-xs">View payload</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Log Details</DialogTitle>
                            </DialogHeader>
                            <pre className="bg-black text-green-400 p-4 rounded-md font-mono text-xs overflow-auto max-h-[400px]">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </DialogContent>
                        </Dialog>
                      ) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          {data && data.total > limit && (
            <div className="flex items-center justify-between px-4 py-4 border-t">
              <div className="text-xs text-muted-foreground">
                Showing {(page - 1) * limit + 1} to {Math.min(page * limit, data.total)} of {data.total} entries
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * limit >= data.total}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
