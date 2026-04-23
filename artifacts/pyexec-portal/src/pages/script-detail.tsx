import { useState, useRef } from "react";
import { useRoute } from "wouter";
import { useGetScript, getGetScriptQueryKey, useExecuteScript } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Play, Terminal, ArrowLeft, Clock, FileCode2, Pencil } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { ExecutionResult } from "@workspace/api-client-react/src/generated/api.schemas";
import { ScriptFilesManager } from "@/components/script-files-manager";
import { useGetMyProfile, getGetMyProfileQueryKey, useListDepartments, getListDepartmentsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";

export default function ScriptDetail() {
  const [, params] = useRoute("/scripts/:id");
  const scriptId = params?.id ? parseInt(params.id, 10) : 0;
  const { toast } = useToast();
  
  const [stdin, setStdin] = useState("");
  const [args, setArgs] = useState("");
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useGetMyProfile({
    query: { enabled: !!user?.id, queryKey: getGetMyProfileQueryKey() }
  });
  const isAdmin = profile?.role === "admin";

  const { data: script, isLoading } = useGetScript(scriptId, {
    query: {
      enabled: !!scriptId,
      queryKey: getGetScriptQueryKey(scriptId)
    }
  });

  const { data: departments } = useListDepartments({
    query: { enabled: isAdmin, queryKey: getListDepartmentsQueryKey() }
  });

  // ---- Edit dialog ----
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editFilename, setEditFilename] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editDept, setEditDept] = useState("none");
  const [editBusy, setEditBusy] = useState(false);

  const openEdit = () => {
    if (!script) return;
    setEditName(script.name);
    setEditDesc(script.description ?? "");
    setEditSubject(script.subject ?? "");
    setEditFilename(script.filename);
    setEditCode(script.code);
    setEditDept(script.departmentId ? String(script.departmentId) : "none");
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!scriptId) return;
    setEditBusy(true);
    try {
      const r = await fetch(`/api/scripts/${scriptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editName,
          description: editDesc || null,
          subject: editSubject || null,
          filename: editFilename,
          code: editCode,
          departmentId: editDept === "none" ? null : parseInt(editDept, 10),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      toast({ title: "Script updated" });
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: getGetScriptQueryKey(scriptId) });
    } catch (e: any) {
      toast({ title: "Failed to update script", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setEditBusy(false);
    }
  };

  const executeScript = useExecuteScript({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
        if (data.success) {
          toast({ title: "Execution completed successfully" });
        } else {
          toast({ title: "Execution failed", variant: "destructive" });
        }
      },
      onError: (err) => {
        toast({ title: "Failed to execute script", description: String(err), variant: "destructive" });
      }
    }
  });

  const handleRun = () => {
    if (!scriptId) return;
    executeScript.mutate({
      id: scriptId,
      data: {
        stdin: stdin || null,
        args: args ? args.split(" ").filter(Boolean) : []
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!script) {
    return <div className="text-center py-12">Script not found.</div>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild className="pl-0 text-muted-foreground hover:text-foreground">
        <Link href="/scripts">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Scripts
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-2xl">{script.name}</CardTitle>
                <CardDescription className="text-base mt-2">{script.description}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Button variant="outline" size="sm" onClick={openEdit}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </Button>
                )}
                <Badge variant="outline" className="font-mono">{script.filename}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-[#0d1117] text-[#c9d1d9] p-4 rounded-md overflow-x-auto font-mono text-sm border border-[#30363d]">
                <pre><code>{script.code}</code></pre>
              </div>
            </CardContent>
          </Card>

          {result && (
            <Card className={result.success ? "border-primary/50" : "border-destructive/50"}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Terminal className="h-5 w-5" />
                    Execution Result
                  </CardTitle>
                  <div className="flex gap-2">
                    <Badge variant={result.success ? "default" : "destructive"}>
                      Exit Code: {result.exitCode}
                    </Badge>
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {result.executionTimeMs}ms
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.stdout && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Standard Output</Label>
                    <div className="bg-black text-green-400 p-3 rounded-md font-mono text-sm whitespace-pre-wrap">
                      {result.stdout}
                    </div>
                  </div>
                )}
                {result.stderr && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Standard Error</Label>
                    <div className="bg-black text-red-400 p-3 rounded-md font-mono text-sm whitespace-pre-wrap">
                      {result.stderr}
                    </div>
                  </div>
                )}
                {!result.stdout && !result.stderr && (
                  <p className="text-sm text-muted-foreground italic">No output produced.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Execution Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="args">Command Line Arguments</Label>
                <Textarea 
                  id="args" 
                  placeholder="arg1 arg2 arg3" 
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  className="font-mono text-sm min-h-[60px]"
                />
                <p className="text-xs text-muted-foreground">Space-separated arguments.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stdin">Standard Input (stdin)</Label>
                <Textarea 
                  id="stdin" 
                  placeholder="Input data to be passed to the script..." 
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  className="font-mono text-sm min-h-[120px]"
                />
              </div>
              <Button 
                onClick={handleRun} 
                disabled={executeScript.isPending}
                className="w-full font-bold"
                size="lg"
              >
                {executeScript.isPending ? "Executing..." : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Execute Script
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <ScriptFilesManager
            scriptId={script.id}
            hasLogo={!!script.hasLogo}
            supportingFiles={script.supportingFiles ?? []}
            isAdmin={isAdmin}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {script.subject && (
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Subject</span>
                  <span className="font-medium">{script.subject}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Department</span>
                <span className="font-medium">{script.departmentName || "Global"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Uploaded By</span>
                <span className="font-medium">{script.uploadedByName || script.uploadedBy}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium">{format(new Date(script.createdAt), "MMM d, yyyy")}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Script</DialogTitle>
            <DialogDescription>
              Update script metadata or code. Changing the code clears any cached AI-generated input schema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Filename</Label>
                <Input value={editFilename} onChange={e => setEditFilename(e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} className="min-h-[60px]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Department</Label>
                <Select value={editDept} onValueChange={setEditDept}>
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
            <div className="space-y-1">
              <Label>Python Code</Label>
              <Textarea
                value={editCode}
                onChange={e => setEditCode(e.target.value)}
                className="font-mono text-xs min-h-[300px]"
                spellCheck={false}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editBusy || !editName.trim() || !editFilename.trim()}>
              {editBusy ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
