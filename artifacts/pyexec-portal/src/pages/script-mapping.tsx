import { useState, useMemo, useEffect } from "react";
import { useListScripts, getListScriptsQueryKey, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Play, Download, FolderDown, FileCode2, Search, Plus, Pencil, Trash2,
  FolderPlus, Folder, ChevronRight, ChevronDown, Building2,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { RunScriptDialog } from "@/components/run-script-dialog";
import { PageHeader } from "@/components/page-header";
import { FolderDialog, type FolderRecord } from "@/components/folder-dialog";
import { AssignScriptsDialog } from "@/components/assign-scripts-dialog";
import { AssignDepartmentsDialog } from "@/components/assign-departments-dialog";
import { getColor, getIcon } from "@/lib/folder-icons";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";

const UNCATEGORIZED = "Uncategorized";

type FolderApi = FolderRecord & { createdAt: string; updatedAt: string };

async function fetchFolders(): Promise<FolderApi[]> {
  const r = await fetch("/api/folders", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function ScriptMapping() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (name: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const [search, setSearch] = useState("");
  const [runTarget, setRunTarget] = useState<{ id: number; name: string; initialSchema?: any } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const [folders, setFolders] = useState<FolderApi[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);

  // Create / edit folder
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FolderRecord | null>(null);

  // Assign scripts dialog
  const [assignFolder, setAssignFolder] = useState<FolderApi | null>(null);
  const [assignDeptScript, setAssignDeptScript] = useState<{ id: number; name: string; departmentIds: number[] } | null>(null);

  // Delete confirm
  const [deleteFolder, setDeleteFolder] = useState<FolderApi | null>(null);

  const { data: profile } = useGetMyProfile({
    query: { enabled: !!user?.id, queryKey: getGetMyProfileQueryKey() }
  });
  const isAdmin = profile?.role === "admin";

  const { data: scripts, isLoading } = useListScripts({
    query: { queryKey: getListScriptsQueryKey() }
  });

  async function refreshFolders() {
    setFoldersLoading(true);
    try {
      const list = await fetchFolders();
      setFolders(list);
    } catch (e) {
      // ignore
    } finally {
      setFoldersLoading(false);
    }
  }

  useEffect(() => { refreshFolders(); }, []);

  // Combine real folders + script-derived folders (subjects)
  const combined = useMemo(() => {
    const byName = new Map<string, { folder: FolderApi | null; items: any[] }>();
    folders.forEach(f => byName.set(f.name, { folder: f, items: [] }));
    (scripts ?? []).forEach((s: any) => {
      const subj = (s.subject?.trim()) || UNCATEGORIZED;
      if (!byName.has(subj)) byName.set(subj, { folder: null, items: [] });
      byName.get(subj)!.items.push(s);
    });
    // Drop empty Uncategorized if no scripts
    if (byName.get(UNCATEGORIZED)?.items.length === 0) byName.delete(UNCATEGORIZED);
    return Array.from(byName.entries())
      .sort(([a], [b]) => a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b))
      .map(([name, v]) => ({ name, folder: v.folder, items: v.items }));
  }, [folders, scripts]);

  const filteredFolders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return combined;
    return combined
      .map(f => ({
        ...f,
        items: f.items.filter((s: any) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q),
        ),
      }))
      .filter(f => f.items.length > 0 || f.name.toLowerCase().includes(q));
  }, [combined, search]);


  async function handleRun(script: { id: number; name: string }) {
    setPendingId(script.id);
    try {
      const r = await fetch(`/api/scripts/${script.id}/inputs`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const schema = await r.json();
      setRunTarget({ id: script.id, name: script.name, initialSchema: schema });
    } catch (e) {
      toast({ title: "Failed to run script", description: String(e), variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  }

  function handleDownloadExe(script: { id: number; name: string }) {
    window.location.href = `/api/scripts/${script.id}/exe`;
  }
  function handleDownloadSupporting(script: { id: number; name: string }) {
    window.location.href = `/api/scripts/${script.id}/supporting`;
  }

  async function confirmDeleteFolder(f: FolderApi) {
    try {
      const r = await fetch(`/api/folders/${f.id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      toast({ title: "Folder deleted" });
      setDeleteFolder(null);
      await refreshFolders();
      queryClient.invalidateQueries({ queryKey: getListScriptsQueryKey() });
    } catch (e: any) {
      toast({ title: "Failed to delete folder", description: e?.message || String(e), variant: "destructive" });
    }
  }

  if (isLoading || foldersLoading) {
    return (
      <div>
        <PageHeader title="Script Mapping" description="Scripts organized by Folder." icon={<Folder className="h-5 w-5" />} />
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Script Mapping"
        description="Scripts organized by Folder. Click a folder to expand."
        icon={<Folder className="h-5 w-5" />}
        actions={
          <>
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search folders or scripts..."
                className="pl-9"
              />
            </div>
            {isAdmin && (
              <Button onClick={() => { setEditingFolder(null); setFolderDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> New Folder
              </Button>
            )}
          </>
        }
      />

      {filteredFolders.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-card border-dashed">
          <Folder className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No folders yet</h3>
          <p className="text-muted-foreground mb-4">Create a folder to start organising scripts.</p>
          {isAdmin && (
            <Button onClick={() => { setEditingFolder(null); setFolderDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> New Folder
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg bg-card divide-y">
          {filteredFolders.map((f) => {
            const colors = getColor(f.folder?.color);
            const Icn = getIcon(f.folder?.icon);
            const isOpen = expandedFolders.has(f.name) || (search.trim().length > 0);
            return (
              <div key={f.name} className="group">
                <div
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer select-none"
                  onClick={() => toggleFolder(f.name)}
                >
                  <div className="text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                  <div className={`h-8 w-8 rounded-md flex items-center justify-center ${colors.bg} ${colors.text} border ${colors.border} shrink-0`}>
                    <Icn className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate" title={f.name}>{f.name}</div>
                    {f.folder?.description && (
                      <div className="text-xs text-muted-foreground truncate">{f.folder.description}</div>
                    )}
                  </div>
                  <Badge variant="secondary" className="shrink-0">{f.items.length}</Badge>
                  {isAdmin && f.folder && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Assign scripts"
                        onClick={(e) => { e.stopPropagation(); setAssignFolder(f.folder!); }}
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Edit folder"
                        onClick={(e) => { e.stopPropagation(); setEditingFolder(f.folder!); setFolderDialogOpen(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Delete folder"
                        onClick={(e) => { e.stopPropagation(); setDeleteFolder(f.folder!); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="bg-muted/10 border-t">
                    {f.items.length === 0 ? (
                      <div className="pl-14 pr-4 py-3 text-sm text-muted-foreground italic">
                        Empty folder.
                        {isAdmin && f.folder && (
                          <Button
                            variant="link" size="sm" className="ml-2 h-auto p-0"
                            onClick={() => setAssignFolder(f.folder!)}
                          >
                            Assign scripts
                          </Button>
                        )}
                      </div>
                    ) : (
                      f.items.map((script: any) => (
                        <div
                          key={script.id}
                          className="flex items-center gap-3 pl-14 pr-3 py-2 hover:bg-muted/30 border-t border-dashed"
                        >
                          {script.hasLogo ? (
                            <img src={`/api/scripts/${script.id}/logo`} alt="" className="h-7 w-7 rounded object-cover bg-muted shrink-0" />
                          ) : (
                            <div className="h-7 w-7 rounded bg-muted flex items-center justify-center shrink-0">
                              <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate" title={script.name}>{script.name}</div>
                            <div className="font-mono text-xs text-muted-foreground truncate">{script.filename}</div>
                          </div>
                          {(() => {
                            const depts: Array<{ id: number; name: string }> =
                              (script as any).departments
                              ?? (script.departmentName ? [{ id: script.departmentId, name: script.departmentName }] : []);
                            if (depts.length === 0) {
                              return (
                                <Badge variant="outline" className="shrink-0 text-xs hidden sm:inline-flex">
                                  Global
                                </Badge>
                              );
                            }
                            const visible = depts.slice(0, 2);
                            const extra = depts.length - visible.length;
                            return (
                              <div className="hidden sm:flex items-center gap-1 shrink-0 max-w-[260px] overflow-hidden">
                                {visible.map(d => (
                                  <Badge key={d.id} variant="outline" className="text-xs truncate" title={d.name}>
                                    {d.name}
                                  </Badge>
                                ))}
                                {extra > 0 && (
                                  <Badge variant="secondary" className="text-xs" title={depts.map(d => d.name).join(", ")}>
                                    +{extra}
                                  </Badge>
                                )}
                              </div>
                            );
                          })()}
                          <div className="flex gap-1 shrink-0">
                            <Button
                              size="sm"
                              onClick={() => handleRun({ id: script.id, name: script.name })}
                              disabled={pendingId === script.id}
                              className="h-8"
                            >
                              <Play className="mr-1.5 h-3.5 w-3.5" />
                              {pendingId === script.id ? "Running..." : "Run"}
                            </Button>
                            <Button
                              variant="outline" size="sm" className="h-8 w-8 p-0"
                              title="Download EXE"
                              onClick={() => handleDownloadExe({ id: script.id, name: script.name })}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            {(() => {
                              const supportCount = script.supportingFiles?.length ?? 0;
                              const hasSupport = supportCount > 0;
                              return (
                                <Button
                                  variant="outline" size="sm" className="h-8 w-8 p-0"
                                  title={hasSupport
                                    ? `Download supporting files as ZIP (${supportCount} file${supportCount === 1 ? "" : "s"})`
                                    : "No supporting files attached"}
                                  onClick={() => hasSupport && handleDownloadSupporting({ id: script.id, name: script.name })}
                                  disabled={!hasSupport}
                                  aria-label="Download supporting files as ZIP"
                                >
                                  <FolderDown className="h-3.5 w-3.5" />
                                </Button>
                              );
                            })()}
                            {isAdmin && (
                              <Button
                                variant="outline" size="sm" className="h-8 w-8 p-0"
                                title="Assign to departments"
                                onClick={() => setAssignDeptScript({
                                  id: script.id,
                                  name: script.name,
                                  departmentIds: (script as any).departmentIds
                                    ?? ((script as any).departments?.map((d: any) => d.id))
                                    ?? (script.departmentId ? [script.departmentId] : []),
                                })}
                              >
                                <Building2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="outline" size="sm" asChild title="Manage / details" className="h-8 w-8 p-0"
                              >
                                <Link href={`/scripts/${script.id}`}>
                                  <FileCode2 className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {runTarget && (
        <RunScriptDialog
          scriptId={runTarget.id}
          scriptName={runTarget.name}
          initialResult={null}
          initialSchema={runTarget.initialSchema ?? null}
          open={!!runTarget}
          onOpenChange={(o) => { if (!o) setRunTarget(null); }}
        />
      )}

      <FolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        folder={editingFolder}
        onSaved={async () => { await refreshFolders(); queryClient.invalidateQueries({ queryKey: getListScriptsQueryKey() }); }}
      />
      {assignFolder && (
        <AssignScriptsDialog
          open={!!assignFolder}
          onOpenChange={(o) => { if (!o) setAssignFolder(null); }}
          folderId={assignFolder.id}
          folderName={assignFolder.name}
          scripts={(scripts ?? []) as any}
          onSaved={async () => { await refreshFolders(); queryClient.invalidateQueries({ queryKey: getListScriptsQueryKey() }); }}
        />
      )}

      {assignDeptScript && (
        <AssignDepartmentsDialog
          open={!!assignDeptScript}
          onOpenChange={(o) => { if (!o) setAssignDeptScript(null); }}
          scriptId={assignDeptScript.id}
          scriptName={assignDeptScript.name}
          initialDepartmentIds={assignDeptScript.departmentIds}
          onSaved={() => queryClient.invalidateQueries({ queryKey: getListScriptsQueryKey() })}
        />
      )}

      <AlertDialog open={!!deleteFolder} onOpenChange={(o) => { if (!o) setDeleteFolder(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder "{deleteFolder?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The folder will be removed. Scripts inside will become uncategorised — they won't be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFolder && confirmDeleteFolder(deleteFolder)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
