import { useState, useMemo, useEffect } from "react";
import { useListScripts, getListScriptsQueryKey, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Play, Download, FileCode2, Search, Plus, Pencil, Trash2, Users as UsersIcon,
  FolderPlus, Folder,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { RunScriptDialog } from "@/components/run-script-dialog";
import { PageHeader } from "@/components/page-header";
import { FolderDialog, type FolderRecord } from "@/components/folder-dialog";
import { AssignScriptsDialog } from "@/components/assign-scripts-dialog";
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
  const [openFolder, setOpenFolder] = useState<string | null>(null);
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

  const currentFolder = openFolder ? combined.find(f => f.name === openFolder) : null;

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

  function handleDownload(script: { id: number; name: string }) {
    window.location.href = `/api/scripts/${script.id}/download`;
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

  if (currentFolder) {
    const meta = currentFolder.folder;
    const colorClasses = getColor(meta?.color);
    const Icn = getIcon(meta?.icon ?? "FolderOpen");
    return (
      <div>
        <PageHeader
          title={currentFolder.name}
          description={`${currentFolder.items.length} script${currentFolder.items.length === 1 ? "" : "s"} in this folder`}
          icon={<Icn className={`h-5 w-5 ${colorClasses.text}`} />}
          back={
            <Button variant="ghost" size="sm" className="pl-0 h-7 text-muted-foreground hover:text-foreground" onClick={() => setOpenFolder(null)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to folders
            </Button>
          }
          actions={
            isAdmin && meta && (
              <>
                <Button variant="outline" size="sm" onClick={() => setAssignFolder(meta)}>
                  <FolderPlus className="mr-2 h-4 w-4" /> Assign Scripts
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setEditingFolder(meta); setFolderDialogOpen(true); }}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
              </>
            )
          }
        />

        {currentFolder.items.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-card border-dashed">
            <p className="text-muted-foreground mb-3">No scripts in this folder yet.</p>
            {isAdmin && meta && (
              <Button size="sm" onClick={() => setAssignFolder(meta)}>
                <FolderPlus className="mr-2 h-4 w-4" /> Assign Scripts
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {currentFolder.items.map((script: any) => (
              <div key={script.id} className="border rounded-xl bg-card flex flex-col overflow-hidden hover:shadow-sm transition-shadow">
                <div className="p-4 flex items-start gap-3">
                  {script.hasLogo ? (
                    <img src={`/api/scripts/${script.id}/logo`} alt="" className="h-10 w-10 rounded object-cover bg-muted shrink-0" />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
                      <FileCode2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold truncate" title={script.name}>{script.name}</div>
                    <div className="font-mono text-xs text-muted-foreground truncate">{script.filename}</div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {script.departmentName || "Global"}
                  </Badge>
                </div>
                <div className="px-4 pb-4 flex-1">
                  <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                    {script.description || "No description provided."}
                  </p>
                </div>
                <div className="flex gap-2 border-t bg-muted/20 p-3">
                  <Button className="flex-1" size="sm" onClick={() => handleRun({ id: script.id, name: script.name })} disabled={pendingId === script.id}>
                    <Play className="mr-2 h-4 w-4" />
                    {pendingId === script.id ? "Running..." : "Run"}
                  </Button>
                  <Button variant="outline" size="sm" title="Download" onClick={() => handleDownload({ id: script.id, name: script.name })}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" asChild title="Manage / details">
                    <Link href={`/scripts/${script.id}`}>
                      <FileCode2 className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
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
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Script Mapping"
        description="Scripts organized by Folder. Click a folder to open."
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
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredFolders.map((f) => {
            const colors = getColor(f.folder?.color);
            const Icn = getIcon(f.folder?.icon);
            return (
              <div
                key={f.name}
                className={`group relative text-left border rounded-xl bg-card hover:border-primary/40 hover:shadow-md transition-all overflow-hidden`}
              >
                <button
                  onClick={() => setOpenFolder(f.name)}
                  className="w-full text-left p-5 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${colors.bg} ${colors.text} border ${colors.border}`}>
                      <Icn className="h-6 w-6" />
                    </div>
                    <Badge variant="secondary">{f.items.length}</Badge>
                  </div>
                  <div>
                    <div className="font-semibold truncate" title={f.name}>{f.name}</div>
                    <div className="text-xs text-muted-foreground truncate min-h-[1rem]">
                      {f.folder?.description
                        ? f.folder.description
                        : f.items.length > 0
                          ? f.items.slice(0, 3).map((s: any) => s.name).join(", ") + (f.items.length > 3 ? ` +${f.items.length - 3} more` : "")
                          : "Empty folder"}
                    </div>
                  </div>
                </button>
                {isAdmin && f.folder && (
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
            );
          })}
        </div>
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
