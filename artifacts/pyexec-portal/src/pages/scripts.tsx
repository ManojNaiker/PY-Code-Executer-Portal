import { useListScripts, getListScriptsQueryKey, useDeleteScript } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Trash2, FileCode2 } from "lucide-react";
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
import { useUser } from "@clerk/react";
import { useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { RunScriptDialog } from "@/components/run-script-dialog";

export default function ScriptsList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [runTarget, setRunTarget] = useState<{ id: number; name: string } | null>(null);

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
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight">Scripts</h1>
          <Button disabled>Upload Script</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scripts</h1>
          <p className="text-muted-foreground">Browse and execute available Python scripts.</p>
        </div>
        <Button asChild>
          <Link href="/upload">Upload Script</Link>
        </Button>
      </div>

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
                  onClick={() => setRunTarget({ id: script.id, name: script.name })}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Run
                </Button>
                <Button variant="outline" size="icon" asChild title="View details">
                  <Link href={`/scripts/${script.id}`}>
                    <FileCode2 className="h-4 w-4" />
                  </Link>
                </Button>
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
          open={!!runTarget}
          onOpenChange={(o) => { if (!o) setRunTarget(null); }}
        />
      )}
    </div>
  );
}
