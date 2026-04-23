import { useEffect, useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Script = { id: number; name: string; subject?: string | null; filename: string };

export function AssignScriptsDialog({
  open,
  onOpenChange,
  folderId,
  folderName,
  scripts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folderId: number;
  folderName: string;
  scripts: Script[];
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      const initial = new Set(scripts.filter(s => (s.subject ?? "") === folderName).map(s => s.id));
      setSelected(initial);
      setQ("");
    }
  }, [open, scripts, folderName]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return scripts;
    return scripts.filter(s =>
      s.name.toLowerCase().includes(term) ||
      s.filename.toLowerCase().includes(term) ||
      (s.subject ?? "").toLowerCase().includes(term)
    );
  }, [scripts, q]);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setBusy(true);
    try {
      const r = await fetch(`/api/folders/${folderId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scriptIds: Array.from(selected), action: "set" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast({ title: `${selected.size} script${selected.size === 1 ? "" : "s"} in this folder` });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Failed to update folder", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Assign scripts to "{folderName}"</DialogTitle>
          <DialogDescription>
            Tick the scripts that belong in this folder. Unticked scripts will be removed from it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search scripts..." className="pl-9" />
          </div>
          <div className="border rounded-md max-h-[360px] overflow-y-auto divide-y">
            {filtered.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">No scripts match.</div>
            )}
            {filtered.map(s => {
              const checked = selected.has(s.id);
              const inOther = (s.subject ?? "") && (s.subject ?? "") !== folderName;
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/40 transition-colors ${checked ? "bg-accent/30" : ""}`}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(s.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{s.filename}</div>
                  </div>
                  {inOther && (
                    <span className="text-xs text-muted-foreground shrink-0">in: {s.subject}</span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{selected.size} selected</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
