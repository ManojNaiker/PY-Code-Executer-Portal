import { useState } from "react";
import { 
  useListUsers, getListUsersQueryKey, 
  useListDepartments, getListDepartmentsQueryKey,
  useAssignUserDepartment, useAssignUserRole
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ShieldCheck, User } from "lucide-react";
import type { AssignRoleBodyRole } from "@workspace/api-client-react/src/generated/api.schemas";

export default function AdminUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading: usersLoading } = useListUsers({
    query: { queryKey: getListUsersQueryKey() }
  });

  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() }
  });

  const assignDept = useAssignUserDepartment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Department assigned" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: (err) => toast({ title: "Failed to assign department", description: String(err), variant: "destructive" })
    }
  });

  const assignRole = useAssignUserRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role updated" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: (err) => toast({ title: "Failed to update role", description: String(err), variant: "destructive" })
    }
  });

  const handleDeptChange = (clerkId: string, deptId: string) => {
    assignDept.mutate({
      clerkId,
      data: { departmentId: deptId === "none" ? null : parseInt(deptId, 10) }
    });
  };

  const handleRoleChange = (clerkId: string, role: string) => {
    assignRole.mutate({
      clerkId,
      data: { role: role as AssignRoleBodyRole }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-muted-foreground">Manage user roles and department assignments.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading users...</TableCell>
                </TableRow>
              ) : (!users || users.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No users found.</TableCell>
                </TableRow>
              ) : (
                users.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.firstName || user.lastName ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unnamed User'}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Select 
                        defaultValue={user.role} 
                        onValueChange={(val) => handleRoleChange(user.clerkId, val)}
                        disabled={assignRole.isPending}
                      >
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">
                            <div className="flex items-center"><User className="mr-2 h-3 w-3"/> User</div>
                          </SelectItem>
                          <SelectItem value="admin">
                            <div className="flex items-center text-primary"><ShieldCheck className="mr-2 h-3 w-3"/> Admin</div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select 
                        defaultValue={user.departmentId?.toString() || "none"} 
                        onValueChange={(val) => handleDeptChange(user.clerkId, val)}
                        disabled={assignDept.isPending}
                      >
                        <SelectTrigger className="w-[180px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Global / Unassigned</SelectItem>
                          {departments?.map(dept => (
                            <SelectItem key={dept.id} value={dept.id.toString()}>{dept.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(user.createdAt), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
