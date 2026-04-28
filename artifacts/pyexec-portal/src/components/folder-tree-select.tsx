import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, Plus, Check } from "lucide-react";
import { getColor, getIcon } from "@/lib/folder-icons";
import { Input } from "@/components/ui/input";

type FolderRow = { id: number; name: string; icon: string; color: string };

export function FolderTreeSelect({
  value,
  onChange,
  placeholder = "Choose or type a folder…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [open, setOpen] = useState(true);
  const [customMode, setCustomMode] = useState(false);

  useEffect(() => {
    fetch("/api/folders", { credentials: "include" })
      .then(r => (r.ok ? r.json() : []))
      .then(setFolders)
      .catch(() => {});
  }, []);

  const matchedExisting = folders.some(f => f.name === value);
  const showCustomInput = customMode || (!!value && !matchedExisting);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent/40 transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Folder className="h-4 w-4 text-primary" />
        <span>Folders</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {value ? `Selected: ${value}` : placeholder}
        </span>
      </button>

      {open && (
        <div className="border-t px-2 py-2 space-y-1 max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setCustomMode(false);
            }}
            className={`w-full flex items-center gap-2 pl-7 pr-3 py-2 text-sm rounded-lg transition-colors ${
              !value && !customMode ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/40"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            <span>No folder (Uncategorized)</span>
            {!value && !customMode && <Check className="h-3.5 w-3.5 ml-auto" />}
          </button>

          {folders.map(f => {
            const c = getColor(f.color);
            const Icn = getIcon(f.icon);
            const active = value === f.name;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onChange(f.name);
                  setCustomMode(false);
                }}
                className={`w-full flex items-center gap-2 pl-7 pr-3 py-2 text-sm rounded-lg transition-colors ${
                  active ? `${c.bg} ${c.text} font-medium` : "hover:bg-accent/40"
                }`}
              >
                <span className={`h-7 w-7 rounded-md flex items-center justify-center ${c.bg} ${c.text} ${c.border} border`}>
                  <Icn className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{f.name}</span>
                {active && <Check className="h-3.5 w-3.5 ml-auto" />}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setCustomMode(true);
              if (matchedExisting) onChange("");
            }}
            className={`w-full flex items-center gap-2 pl-7 pr-3 py-2 text-sm rounded-lg transition-colors ${
              showCustomInput ? "bg-accent/60 text-accent-foreground font-medium" : "hover:bg-accent/40"
            }`}
          >
            <span className="h-7 w-7 rounded-md flex items-center justify-center bg-primary/10 text-primary border border-primary/20">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span>Custom folder name…</span>
          </button>

          {showCustomInput && (
            <div className="pl-9 pr-2 pt-1">
              <Input
                autoFocus={customMode}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder="e.g. Reports Q3"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
