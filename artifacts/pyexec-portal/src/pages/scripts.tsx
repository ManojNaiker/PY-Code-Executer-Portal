import { useListScripts, getListScriptsQueryKey, useDeleteScript } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Trash2, FileCode2, Sparkles, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Link } from "wouter";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
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
import { useAuth } from "@/hooks/use-auth";
import { useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { RunScriptDialog } from "@/components/run-script-dialog";

export default function ScriptsList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [runTarget, setRunTarget] = useState<{
    id: number;
    name: string;
    initialResult?: any;
    initialSchema?: any;
  } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [enhancingId, setEnhancingId] = useState<number | null>(null);

  async function handleEnhance(script: { id: number; name: string }) {
    setEnhancingId(script.id);
    try {
      const r = await fetch(`/api/scripts/${script.id}/ai-enhance`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      toast({
        title: "AI enhancement complete",
        description: data.aiSchema?.scriptTitle
          ? `Generated: ${data.aiSchema.scriptTitle}`
          : "Form labels and descriptions updated.",
      });
    } catch (e: any) {
      toast({
        title: "AI enhancement failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setEnhancingId(null);
    }
  }

  async function handleRun(script: { id: number; name: string }) {
    setPendingId(script.id);
    try {
      const r = await fetch(`/api/scripts/${script.id}/inputs`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const schema = await r.json();
      // Always open the dialog so the user sees the live log stream,
      // even for scripts that need no inputs (the dialog auto-executes those).
      setRunTarget({ id: script.id, name: script.name, initialSchema: schema });
    } catch (e) {
      toast({
        title: "Failed to run script",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  }

  const { data: profile } = useGetMyProfile({
    query: {
      enabled: !!user?.id,
      queryKey: getGetMyProfileQueryKey()
    }
  });

  const { data: scripts, isLoading } = useListScripts({
    query: {
      queryKey: getListScriptsQueryKey()
    }
  });

  const deleteScript = useDeleteScript({
    mutation: {
      onSuccess: () => {
        toast({ title: "Script deleted successfully" });
        queryClient.invalidateQueries({ queryKey: getListScriptsQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to delete script", variant: "destructive" });
      }
    }
  });

  const isAdmin = profile?.role === "admin";

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Scripts"
          description="Browse and execute available Python scripts."
          icon={<FileCode2 className="h-5 w-5" />}
          actions={<Button disabled>Upload Script</Button>}
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Scripts"
        description="Browse and execute available Python scripts."
        icon={<FileCode2 className="h-5 w-5" />}
        actions={
          <Button asChild>
            <Link href="/upload">Upload Script</Link>
          </Button>
        }
      />

      {(!scripts || scripts.length === 0) ? (
        <div className="text-center py-12 border rounded-lg bg-card border-dashed">
          <FileCode2 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No scripts found</h3>
          <p className="text-muted-foreground mb-4">Upload a script to get started.</p>
          <Button asChild>
            <Link href="/upload">Upload Script</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {scripts.map(script => (
            <Card key={script.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg truncate" title={script.name}>{script.name}</CardTitle>
                  <Badge variant="secondary" className="shrink-0 ml-2">
                    {script.departmentName || "Global"}
                  </Badge>
                </div>
                <CardDescription className="font-mono text-xs truncate">
                  {script.filename}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {script.description || "No description provided."}
                </p>
                <p className="text-xs text-muted-foreground mt-4">
                  Uploaded by {script.uploadedByName || script.uploadedBy} on {format(new Date(script.createdAt), "MMM d, yyyy")}
                </p>
              </CardContent>
              <CardFooter className="flex justify-between gap-2 border-t bg-muted/20 p-4">
                <Button
                  className="w-full"
                  onClick={() => handleRun({ id: script.id, name: script.name })}
                  disabled={pendingId === script.id}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {pendingId === script.id ? "Running..." : "Run"}
                </Button>
                <Button variant="outline" size="icon" asChild title="View details">
                  <Link href={`/scripts/${script.id}`}>
                    <FileCode2 className="h-4 w-4" />
                  </Link>
                </Button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="icon"
                    title="Enhance with AI (better labels, descriptions, warnings)"
                    onClick={() => handleEnhance({ id: script.id, name: script.name })}
                    disabled={enhancingId === script.id}
                    data-testid={`button-ai-enhance-${script.id}`}
                  >
                    {enhancingId === script.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-purple-500" />
                    )}
                  </Button>
                )}
                {isAdmin && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="icon" className="shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Script</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete '{script.name}'? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteScript.mutate({ id: script.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {runTarget && (
        <RunScriptDialog
          scriptId={runTarget.id}
          scriptName={runTarget.name}
          initialResult={runTarget.initialResult ?? null}
          initialSchema={runTarget.initialSchema ?? null}
          open={!!runTarget}
          onOpenChange={(o) => { if (!o) setRunTarget(null); }}
        />
      )}
    </div>
  );
}
