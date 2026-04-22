import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Paperclip, Trash2, Upload, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetScriptQueryKey, getListScriptsQueryKey } from "@workspace/api-client-react";

interface SupportingFile { name: string; size: number; }

interface Props {
  scriptId: number;
  hasLogo: boolean;
  supportingFiles: SupportingFile[];
  isAdmin: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ScriptFilesManager({ scriptId, hasLogo, supportingFiles, isAdmin }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const supportInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function refetch() {
    queryClient.invalidateQueries({ queryKey: getGetScriptQueryKey(scriptId) });
    queryClient.invalidateQueries({ queryKey: getListScriptsQueryKey() });
  }

  async function uploadLogo(file: File) {
    setBusy("logo");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/scripts/${scriptId}/logo`, { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast({ title: "Logo uploaded" });
      refetch();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function deleteLogo() {
    setBusy("logo");
    try {
      const r = await fetch(`/api/scripts/${scriptId}/logo`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "Logo removed" });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to remove logo", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function uploadSupportFiles(files: FileList) {
    setBusy("support");
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("files", f));
      const r = await fetch(`/api/scripts/${scriptId}/supporting-files`, {
        method: "POST", body: fd, credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast({ title: "Supporting files uploaded" });
      refetch();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function deleteSupportFile(name: string) {
    setBusy(`support:${name}`);
    try {
      const r = await fetch(`/api/scripts/${scriptId}/supporting-files/${encodeURIComponent(name)}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "File removed" });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to remove file", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Files & Bundle</CardTitle>
        <CardDescription>
          Logo and supporting files are included when users download the script bundle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> Logo
            </span>
            {hasLogo && isAdmin && (
              <Button size="sm" variant="ghost" onClick={deleteLogo} disabled={busy === "logo"}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 rounded border bg-muted flex items-center justify-center overflow-hidden">
              {hasLogo ? (
                <img src={`/api/scripts/${scriptId}/logo`} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            {isAdmin && (
              <>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={busy === "logo"}
                >
                  <Upload className="h-3.5 w-3.5 mr-2" />
                  {hasLogo ? "Replace" : "Upload"} Logo
                </Button>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium flex items-center gap-2">
              <Paperclip className="h-4 w-4" /> Supporting files
              <span className="text-xs text-muted-foreground font-normal">({supportingFiles.length})</span>
            </span>
            {isAdmin && (
              <>
                <input
                  ref={supportInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.length) uploadSupportFiles(e.target.files); e.target.value = ""; }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => supportInputRef.current?.click()}
                  disabled={busy === "support"}
                >
                  <Upload className="h-3.5 w-3.5 mr-2" /> Add Files
                </Button>
              </>
            )}
          </div>
          {supportingFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No supporting files attached.</p>
          ) : (
            <ul className="space-y-1 border rounded divide-y">
              {supportingFiles.map((f) => (
                <li key={f.name} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-mono text-xs truncate flex-1" title={f.name}>{f.name}</span>
                  <span className="text-xs text-muted-foreground mx-3">{formatBytes(f.size)}</span>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteSupportFile(f.name)}
                      disabled={busy === `support:${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pt-2 border-t">
          <Button
            variant="default"
            className="w-full"
            onClick={() => { window.location.href = `/api/scripts/${scriptId}/download`; }}
          >
            <Download className="h-4 w-4 mr-2" /> Download Bundle (.zip)
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Includes script, supporting files, logo, and Windows launcher (run.bat).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
