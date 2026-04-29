import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useListDepartments, getListDepartmentsQueryKey, getListScriptsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { DepartmentMultiSelect } from "@/components/department-multi-select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scriptId: number;
  scriptName: string;
  initialDepartmentIds: number[];
  onSaved?: () => void;
}

/**
 * Admin-only dialog for replacing the set of departments assigned to a script.
 * Empty selection means "Global" (no department restriction).
 */
export function AssignDepartmentsDialog({
  open, onOpenChange, scriptId, scriptName, initialDepartmentIds, onSaved,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() },
  });

  const [selected, setSelected] = useState<number[]>(initialDepartmentIds);
  const [busy, setBusy] = useState(false);

  // Keep local state in sync with prop changes when dialog re-opens for a different script.
  useEffect(() => {
    if (open) setSelected(initialDepartmentIds);
  }, [open, initialDepartmentIds]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/scripts/${scriptId}/departments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ departmentIds: selected }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      toast({
        title: selected.length === 0 ? "Script set to Global" : `Assigned to ${selected.length} department${selected.length === 1 ? "" : "s"}`,
      });
      queryClient.invalidateQueries({ queryKey: getListScriptsQueryKey() });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Failed to update", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Departments</DialogTitle>
          <DialogDescription>
            Choose which departments can access <span className="font-medium">{scriptName}</span>.
            Leave empty to make it Global (visible to every user).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <DepartmentMultiSelect
            departments={departments ?? []}
            value={selected}
            onChange={setSelected}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
