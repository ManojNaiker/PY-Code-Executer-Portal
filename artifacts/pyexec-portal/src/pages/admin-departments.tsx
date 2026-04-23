import { useState } from "react";
import { useListDepartments, getListDepartmentsQueryKey, useCreateDepartment, useDeleteDepartment } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Building2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<null | { created: any[]; failed: any[] }>(null);

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

  const parseBulkDepts = (text: string) => {
    const items: Array<{ name: string; description?: string | null }> = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [name, ...rest] = line.split(",").map(s => s.trim());
      if (!name) continue;
      items.push({ name, description: rest.join(",") || null });
    }
    return items;
  };

  const handleBulkImport = async () => {
    const items = parseBulkDepts(bulkText);
    if (items.length === 0) {
      toast({ title: "Nothing to import", description: "Paste at least one department name per line.", variant: "destructive" });
      return;
    }
    setBulkBusy(true); setBulkResult(null);
    try {
      const r = await fetch("/api/departments/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ departments: items }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setBulkResult(j);
      toast({ title: `Bulk import: ${j.created.length} created, ${j.failed.length} failed` });
      queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
    } catch (e: any) {
      toast({ title: "Bulk import failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Departments"
        description="Manage organizational units for access control."
        icon={<Building2 className="h-5 w-5" />}
        actions={
          <>
        <Dialog open={bulkOpen} onOpenChange={(o) => { setBulkOpen(o); if (!o) setBulkResult(null); }}>
          <DialogTrigger asChild>
            <Button variant="outline"><Upload className="mr-2 h-4 w-4" /> Bulk Import</Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Bulk Import Departments</DialogTitle>
              <DialogDescription>
                One per line: <code>name,description</code> (description optional).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Textarea
                className="font-mono text-xs min-h-[180px]"
                placeholder={"Engineering,Software development team\nMarketing\nFinance,Accounting and budgeting"}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
              />
              {bulkResult && (
                <div className="text-sm space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                  <p className="text-primary">Created: {bulkResult.created.length}</p>
                  {bulkResult.failed.length > 0 && (
                    <>
                      <p className="text-destructive">Failed: {bulkResult.failed.length}</p>
                      <ul className="list-disc pl-5 text-xs">
                        {bulkResult.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkOpen(false)}>Close</Button>
              <Button onClick={handleBulkImport} disabled={bulkBusy || !bulkText.trim()}>
                {bulkBusy ? "Importing..." : "Import"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
          </>
        }
      />

      <div className="border rounded-lg overflow-hidden bg-card">
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
      </div>
    </div>
  );
}
