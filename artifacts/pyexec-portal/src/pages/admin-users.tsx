import { useState } from "react";
import {
  useListUsers, getListUsersQueryKey,
  useListDepartments, getListDepartmentsQueryKey,
  useAssignUserDepartment, useAssignUserRole
} from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ShieldCheck, User, Plus, Upload, Trash2, KeyRound, Copy, Check } from "lucide-react";
import type { AssignRoleBodyRole } from "@workspace/api-client-react/src/generated/api.schemas";

export default function AdminUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const { data: users, isLoading: usersLoading } = useListUsers({
    query: { queryKey: getListUsersQueryKey() }
  });

  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() }
  });

  const assignDept = useAssignUserDepartment({
    mutation: {
      onSuccess: () => { toast({ title: "Department assigned" }); refreshUsers(); },
      onError: (err) => toast({ title: "Failed to assign department", description: String(err), variant: "destructive" })
    }
  });

  const assignRole = useAssignUserRole({
    mutation: {
      onSuccess: () => { toast({ title: "Role updated" }); refreshUsers(); },
      onError: (err) => toast({ title: "Failed to update role", description: String(err), variant: "destructive" })
    }
  });

  // ---- Single user create dialog state ----
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [newDeptId, setNewDeptId] = useState<string>("none");
  const [creating, setCreating] = useState(false);

  // ---- Credentials banner shown after create / reset ----
  const [credentials, setCredentials] = useState<null | { email: string; password: string; mode: "created" | "reset" }>(null);
  const [credCopied, setCredCopied] = useState(false);

  // ---- Reset password dialog state ----
  const [resetTarget, setResetTarget] = useState<null | { clerkId: string; email: string }>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // ---- Bulk import dialog state ----
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<null | { created: any[]; failed: any[] }>(null);

  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDeptChange = (clerkId: string, deptId: string) => {
    assignDept.mutate({ clerkId, data: { departmentId: deptId === "none" ? null : parseInt(deptId, 10) } });
  };
  const handleRoleChange = (clerkId: string, role: string) => {
    assignRole.mutate({ clerkId, data: { role: role as AssignRoleBodyRole } });
  };

  async function handleCreate() {
    if (!newEmail.trim()) return;
    const emailToCreate = newEmail.trim();
    const typedPassword = newPassword.trim();
    const passwordToUse = typedPassword.length >= 6 ? typedPassword : "changeme123";
    setCreating(true);
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: emailToCreate,
          password: passwordToUse,
          firstName: newFirstName || null,
          lastName: newLastName || null,
          role: newRole,
          departmentId: newDeptId === "none" ? null : parseInt(newDeptId, 10),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setCredentials({ email: emailToCreate, password: passwordToUse, mode: "created" });
      setCredCopied(false);
      setCreateOpen(false);
      setNewEmail(""); setNewPassword(""); setNewFirstName(""); setNewLastName("");
      setNewRole("user"); setNewDeptId("none");
      refreshUsers();
    } catch (e: any) {
      toast({ title: "Failed to create user", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const r = await fetch(`/api/users/${encodeURIComponent(resetTarget.clerkId)}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: resetPassword.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setCredentials({ email: j.email, password: j.newPassword, mode: "reset" });
      setCredCopied(false);
      setResetTarget(null);
      setResetPassword("");
    } catch (e: any) {
      toast({ title: "Failed to reset password", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    const text = `Email: ${credentials.email}\nPassword: ${credentials.password}`;
    try { await navigator.clipboard.writeText(text); setCredCopied(true); setTimeout(() => setCredCopied(false), 2000); } catch {}
  }

  function parseBulkUsers(text: string) {
    // Format per line: email,password,firstName,lastName,role,departmentName
    // Only email is required. Empty cells/lines tolerated.
    const items: any[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const cols = line.split(",").map(c => c.trim());
      const [email, password, firstName, lastName, role, departmentName] = cols;
      if (!email) continue;
      items.push({
        email,
        password: password || undefined,
        firstName: firstName || null,
        lastName: lastName || null,
        role: role === "admin" ? "admin" : "user",
        departmentName: departmentName || undefined,
      });
    }
    return items;
  }

  async function handleBulkImport() {
    const items = parseBulkUsers(bulkText);
    if (items.length === 0) {
      toast({ title: "Nothing to import", description: "Paste at least one email per line.", variant: "destructive" });
      return;
    }
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const r = await fetch("/api/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ users: items }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setBulkResult(j);
      toast({ title: `Bulk import: ${j.created.length} created, ${j.failed.length} failed` });
      refreshUsers();
    } catch (e: any) {
      toast({ title: "Bulk import failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleDelete(clerkId: string) {
    setDeleting(clerkId);
    try {
      const r = await fetch(`/api/users/${encodeURIComponent(clerkId)}`, { method: "DELETE", credentials: "include" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      toast({ title: "User deleted" });
      refreshUsers();
    } catch (e: any) {
      toast({ title: "Failed to delete user", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage user accounts, roles, and department assignments."
        icon={<UsersIcon className="h-5 w-5" />}
        actions={
          <>
          <Dialog open={bulkOpen} onOpenChange={(o) => { setBulkOpen(o); if (!o) setBulkResult(null); }}>
            <DialogTrigger asChild>
              <Button variant="outline"><Upload className="mr-2 h-4 w-4" /> Bulk Import</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Bulk Import Users</DialogTitle>
                <DialogDescription>
                  One user per line, comma-separated:
                  <code className="block mt-1 p-2 bg-muted rounded text-xs">email,password,firstName,lastName,role,departmentName</code>
                  Only <b>email</b> is required. Default password is <code>changeme123</code>. Role is <code>user</code> or <code>admin</code>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Textarea
                  className="font-mono text-xs min-h-[200px]"
                  placeholder={"alice@example.com,,Alice,Smith,user,Engineering\nbob@example.com,Secret123,Bob,Jones,admin,"}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                {bulkResult && (
                  <div className="text-sm space-y-2 max-h-40 overflow-y-auto border rounded p-2">
                    <p className="text-primary">Created: {bulkResult.created.length}</p>
                    {bulkResult.failed.length > 0 && (
                      <>
                        <p className="text-destructive">Failed: {bulkResult.failed.length}</p>
                        <ul className="list-disc pl-5 text-xs">
                          {bulkResult.failed.map((f, i) => <li key={i}>{f.email || "(no email)"}: {f.error}</li>)}
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

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> New User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create User</DialogTitle>
              </DialogHeader>
              <form className="space-y-3 py-2" autoComplete="off" onSubmit={e => e.preventDefault()}>
                {/* Honeypot fields to absorb browser autofill */}
                <input type="text" name="prevent_autofill" autoComplete="off" value="" onChange={() => {}} style={{ display: "none" }} />
                <input type="password" name="prevent_autofill_pw" autoComplete="new-password" value="" onChange={() => {}} style={{ display: "none" }} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>First name</Label>
                    <Input autoComplete="off" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Last name</Label>
                    <Input autoComplete="off" value={newLastName} onChange={e => setNewLastName(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Email *</Label>
                  <Input type="email" autoComplete="off" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="user@example.com" />
                </div>
                <div className="space-y-1">
                  <Label>Password</Label>
                  <Input type="text" autoComplete="new-password" name="new-user-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder='Leave blank for "changeme123"' />
                  <p className="text-xs text-muted-foreground">Minimum 6 characters. If you leave it blank, the default password <code>changeme123</code> is used.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Role</Label>
                    <Select value={newRole} onValueChange={v => setNewRole(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Department</Label>
                    <Select value={newDeptId} onValueChange={setNewDeptId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Global / Unassigned</SelectItem>
                        {departments?.map(d => (
                          <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating || !newEmail.trim()}>
                  {creating ? "Creating..." : "Create User"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      {credentials && (
        <div className="mb-4 border-2 border-primary rounded-lg p-4 bg-primary/5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-semibold text-primary">
                {credentials.mode === "created" ? "User created — share these credentials" : "Password reset — share these credentials"}
              </p>
              <p className="text-xs text-muted-foreground">
                This is the only time the password is shown. Copy it now and give it to the user.
              </p>
              <div className="mt-2 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-sm font-mono">
                <span className="text-muted-foreground">Email:</span>
                <span>{credentials.email}</span>
                <span className="text-muted-foreground">Password:</span>
                <span className="font-bold">{credentials.password}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={copyCredentials}>
                {credCopied ? <><Check className="mr-2 h-4 w-4"/> Copied</> : <><Copy className="mr-2 h-4 w-4"/> Copy</>}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCredentials(null)}>Dismiss</Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) { setResetTarget(null); setResetPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for <b>{resetTarget?.email}</b>. Leave blank to reset to the default <code>changeme123</code>.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3 py-2" autoComplete="off" onSubmit={e => e.preventDefault()}>
            <input type="password" name="prevent_autofill_pw_reset" autoComplete="new-password" value="" onChange={() => {}} style={{ display: "none" }} />
            <div className="space-y-1">
              <Label>New password</Label>
              <Input
                type="text"
                autoComplete="new-password"
                name="reset-user-password"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder='Leave blank for "changeme123"'
              />
              <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetTarget(null); setResetPassword(""); }}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetting}>
              {resetting ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading users...</TableCell></TableRow>
              ) : (!users || users.length === 0) ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No users found.</TableCell></TableRow>
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
                        <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user"><div className="flex items-center"><User className="mr-2 h-3 w-3"/> User</div></SelectItem>
                          <SelectItem value="admin"><div className="flex items-center text-primary"><ShieldCheck className="mr-2 h-3 w-3"/> Admin</div></SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        defaultValue={user.departmentId?.toString() || "none"}
                        onValueChange={(val) => handleDeptChange(user.clerkId, val)}
                        disabled={assignDept.isPending}
                      >
                        <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
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
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Reset password"
                        onClick={() => { setResetTarget({ clerkId: user.clerkId, email: user.email }); setResetPassword(""); }}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" title="Delete user" className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={deleting === user.clerkId}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete User</AlertDialogTitle>
                            <AlertDialogDescription>
                              Permanently delete <b>{user.email}</b>? This removes their account and access. Scripts they uploaded remain.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(user.clerkId)}
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
