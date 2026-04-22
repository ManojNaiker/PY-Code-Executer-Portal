import { useState, useMemo } from "react";
import { useListScripts, getListScriptsQueryKey, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Folder, FolderOpen, ArrowLeft, Play, Download, FileCode2, Search } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { RunScriptDialog } from "@/components/run-script-dialog";

const UNCATEGORIZED = "Uncategorized";

export default function ScriptMapping() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [runTarget, setRunTarget] = useState<{ id: number; name: string; initialSchema?: any } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const { data: profile } = useGetMyProfile({
    query: { enabled: !!user?.id, queryKey: getGetMyProfileQueryKey() }
  });
  const { data: scripts, isLoading } = useListScripts({
    query: { queryKey: getListScriptsQueryKey() }
  });

  const folders = useMemo(() => {
    const map = new Map<string, typeof scripts>();
    (scripts ?? []).forEach((s) => {
      const subj = (s.subject?.trim()) || UNCATEGORIZED;
      if (!map.has(subj)) map.set(subj, [] as any);
      (map.get(subj) as any[]).push(s);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({ name, items: items as any[] }));
  }, [scripts]);

  const filteredFolders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return folders;
    return folders
      .map(f => ({
        ...f,
        items: f.items.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q),
        ),
      }))
      .filter(f => f.items.length > 0);
  }, [folders, search]);

  const currentFolder = openFolder ? folders.find(f => f.name === openFolder) : null;

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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Script Mapping</h1>
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (currentFolder) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setOpenFolder(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to folders
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <FolderOpen className="h-8 w-8 text-amber-500" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{currentFolder.name}</h1>
            <p className="text-muted-foreground">
              {currentFolder.items.length} script{currentFolder.items.length === 1 ? "" : "s"} in this folder
            </p>
          </div>
        </div>

        {currentFolder.items.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-card border-dashed">
            <p className="text-muted-foreground">No scripts in this folder.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {currentFolder.items.map((script: any) => (
              <Card key={script.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    {script.hasLogo ? (
                      <img
                        src={`/api/scripts/${script.id}/logo`}
                        alt=""
                        className="h-10 w-10 rounded object-cover bg-muted shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
                        <FileCode2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base truncate" title={script.name}>{script.name}</CardTitle>
                      <CardDescription className="font-mono text-xs truncate">
                        {script.filename}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {script.departmentName || "Global"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                    {script.description || "No description provided."}
                  </p>
                  {script.supportingFiles?.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {script.supportingFiles.length} supporting file{script.supportingFiles.length === 1 ? "" : "s"}
                    </p>
                  )}
                </CardContent>
                <CardFooter className="flex gap-2 border-t bg-muted/20 p-3">
                  <Button
                    className="flex-1"
                    size="sm"
                    onClick={() => handleRun({ id: script.id, name: script.name })}
                    disabled={pendingId === script.id}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {pendingId === script.id ? "Running..." : "Run"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    title="Download bundle (script + supporting files)"
                    onClick={() => handleDownload({ id: script.id, name: script.name })}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" asChild title="Manage / details">
                    <Link href={`/scripts/${script.id}`}>
                      <FileCode2 className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Script Mapping</h1>
          <p className="text-muted-foreground">Scripts organized by Subject. Click a folder to open.</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search folders or scripts..."
            className="pl-9"
          />
        </div>
      </div>

      {filteredFolders.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-card border-dashed">
          <Folder className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No scripts mapped yet</h3>
          <p className="text-muted-foreground mb-4">Upload scripts and assign a Subject to create folders.</p>
          {profile?.role === "admin" && (
            <Button asChild>
              <Link href="/upload">Upload Script</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredFolders.map((f) => (
            <button
              key={f.name}
              onClick={() => setOpenFolder(f.name)}
              className="group text-left border rounded-xl bg-card hover:bg-accent/30 hover:border-primary/40 transition-colors p-5 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <Folder className="h-12 w-12 text-amber-500 group-hover:text-amber-600 transition-colors" fill="currentColor" fillOpacity={0.15} />
                <Badge variant="secondary">{f.items.length}</Badge>
              </div>
              <div>
                <div className="font-semibold truncate" title={f.name}>{f.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {f.items.slice(0, 3).map((s: any) => s.name).join(", ")}
                  {f.items.length > 3 ? ` +${f.items.length - 3} more` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
