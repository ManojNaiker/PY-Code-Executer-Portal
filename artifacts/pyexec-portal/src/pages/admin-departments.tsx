import { useState } from "react";
import { useListDepartments, getListDepartmentsQueryKey, useCreateDepartment, useDeleteDepartment } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function AdminDepartments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: departments, isLoading } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() }
  });

  const createDept = useCreateDepartment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Department created" });
        setIsCreateOpen(false);
        setNewName("");
        setNewDesc("");
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      },
      onError: (err) => toast({ title: "Failed to create department", description: String(err), variant: "destructive" })
    }
  });

  const deleteDept = useDeleteDepartment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Department deleted" });
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      },
      onError: (err) => toast({ title: "Failed to delete department", description: String(err), variant: "destructive" })
    }
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createDept.mutate({
      data: { name: newName, description: newDesc || null }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Departments</h1>
          <p className="text-muted-foreground">Manage organizational units for access control.</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Department
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Department</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Engineering" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea id="desc" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Software development team" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!newName.trim() || createDept.isPending}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading departments...</TableCell>
                </TableRow>
              ) : (!departments || departments.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <Building2 className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">No departments found.</p>
                  </TableCell>
                </TableRow>
              ) : (
                departments.map(dept => (
                  <TableRow key={dept.id}>
                    <TableCell className="font-mono text-xs">{dept.id}</TableCell>
                    <TableCell className="font-medium">{dept.name}</TableCell>
                    <TableCell className="text-muted-foreground">{dept.description || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(dept.createdAt), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Department</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete {dept.name}? This will remove department assignment from all associated users and scripts.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteDept.mutate({ id: dept.id })}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
