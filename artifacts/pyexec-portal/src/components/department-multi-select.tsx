import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronDown, Globe } from "lucide-react";

export type DeptOption = { id: number; name: string };

interface Props {
  departments: DeptOption[];
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  /** Optional placeholder shown alongside the trigger when nothing is selected. */
  placeholder?: string;
  buttonClassName?: string;
}

/**
 * Multi-select for assigning a script to one or more departments.
 * Empty selection is treated as "Global" (accessible to every user).
 */
export function DepartmentMultiSelect({
  departments,
  value,
  onChange,
  disabled,
  placeholder = "Global / All Users",
  buttonClassName,
}: Props) {
  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedNames = useMemo(
    () => departments.filter(d => selectedSet.has(d.id)).map(d => d.name),
    [departments, selectedSet],
  );

  const summary =
    selectedNames.length === 0
      ? placeholder
      : selectedNames.length <= 2
        ? selectedNames.join(", ")
        : `${selectedNames.length} departments`;

  const toggle = (id: number) => {
    if (selectedSet.has(id)) onChange(value.filter(v => v !== id));
    else onChange([...value, id]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={`w-full justify-between font-normal ${buttonClassName ?? ""}`}
        >
          <span className="flex items-center gap-2 min-w-0 truncate">
            {selectedNames.length === 0 ? (
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{summary}</span>
            {selectedNames.length > 2 && (
              <Badge variant="secondary" className="ml-1 shrink-0">{selectedNames.length}</Badge>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="p-2 border-b">
          <button
            type="button"
            onClick={() => onChange([])}
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left"
          >
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span>Global (no restriction)</span>
            {selectedNames.length === 0 && <Badge variant="secondary" className="ml-auto">Active</Badge>}
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {departments.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No departments yet. Create one in Departments first.
            </div>
          ) : (
            departments.map(d => {
              const checked = selectedSet.has(d.id);
              return (
                <label
                  key={d.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(d.id)} />
                  <span className="flex-1 truncate">{d.name}</span>
                </label>
              );
            })
          )}
        </div>
        {selectedNames.length > 0 && (
          <div className="border-t p-2 text-xs text-muted-foreground">
            {selectedNames.length} of {departments.length} selected
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
