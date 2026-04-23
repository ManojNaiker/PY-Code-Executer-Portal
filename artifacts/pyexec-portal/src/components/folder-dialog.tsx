import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FOLDER_ICONS, FOLDER_COLORS, getColor } from "@/lib/folder-icons";
import { useToast } from "@/hooks/use-toast";

export type FolderRecord = {
  id: number;
  name: string;
  icon: string;
  color: string;
  description?: string | null;
};

export function FolderDialog({
  open,
  onOpenChange,
  folder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folder?: FolderRecord | null;
  onSaved?: (f: FolderRecord) => void;
}) {
  const { toast } = useToast();
  const isEdit = !!folder;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string>("Folder");
  const [color, setColor] = useState<string>("amber");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(folder?.name ?? "");
      setDescription(folder?.description ?? "");
      setIcon(folder?.icon ?? "Folder");
      setColor(folder?.color ?? "amber");
    }
  }, [open, folder]);

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(isEdit ? `/api/folders/${folder!.id}` : "/api/folders", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), description: description || null, icon, color }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast({ title: isEdit ? "Folder updated" : "Folder created" });
      onSaved?.(j);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Failed to save folder", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const colorClasses = getColor(color);
  const PreviewIcon = (FOLDER_ICONS as any)[icon] ?? FOLDER_ICONS.Folder;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Folder" : "Create Folder"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the folder name, icon, or color." : "Create a folder to group related scripts."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className={`h-14 w-14 rounded-lg flex items-center justify-center ${colorClasses.bg} ${colorClasses.text} border ${colorClasses.border}`}>
              <PreviewIcon className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <Label>Folder Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Finance, HR, Reports" autoFocus />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional short description" className="min-h-[60px]" />
          </div>

          <div>
            <Label className="mb-2 block">Icon</Label>
            <div className="grid grid-cols-8 gap-2 max-h-44 overflow-y-auto p-1">
              {Object.entries(FOLDER_ICONS).map(([k, Icn]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setIcon(k)}
                  className={`h-9 w-9 rounded-md flex items-center justify-center border transition-colors ${icon === k ? `${colorClasses.bg} ${colorClasses.text} ${colorClasses.border}` : "border-border hover:bg-accent text-muted-foreground"}`}
                  title={k}
                >
                  <Icn className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Color</Label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setColor(c.name)}
                  className={`h-8 w-8 rounded-full border-2 ${c.bg} ${color === c.name ? `${c.border} ring-2 ring-offset-2 ring-offset-background ${c.text.replace("text-", "ring-")}` : "border-transparent"}`}
                  title={c.name}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
