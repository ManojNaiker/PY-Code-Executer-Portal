import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, FileSpreadsheet, Terminal, AlertCircle, CheckCircle2, Clock, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type DetectedArg = {
  name: string;
  flag: string | null;
  label: string;
  help: string;
  required: boolean;
  type: "string" | "int" | "float" | "bool";
  default: string | null;
  choices: string[] | null;
  positional: boolean;
};

type FileSpec = {
  required: boolean;
  kind: "excel" | "csv" | "json" | "text";
  label: string;
  hint: string;
} | null;

type InputsSchema = {
  args: DetectedArg[];
  needsStdin: boolean;
  stdinPrompt: string | null;
  file: FileSpec;
};

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
};

interface Props {
  scriptId: number;
  scriptName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialResult?: ExecResult | null;
  initialSchema?: InputsSchema | null;
}

const ACCEPT_BY_KIND: Record<string, string> = {
  excel: ".xlsx,.xls",
  csv: ".csv",
  json: ".json",
  text: "*",
};

export function RunScriptDialog({ scriptId, scriptName, open, onOpenChange, initialResult, initialSchema }: Props) {
  const { toast } = useToast();
  const [schema, setSchema] = useState<InputsSchema | null>(initialSchema ?? null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [stdin, setStdin] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(initialResult ?? null);

  useEffect(() => {
    if (!open) {
      setSchema(null);
      setValues({});
      setStdin("");
      setFile(null);
      setResult(null);
      return;
    }
    if (initialResult) setResult(initialResult);
    if (initialSchema) {
      setSchema(initialSchema);
      const init: Record<string, string> = {};
      for (const a of initialSchema.args) {
        if (a.default != null) init[a.name] = a.default;
        else if (a.type === "bool") init[a.name] = "false";
        else init[a.name] = "";
      }
      setValues(init);
      return;
    }
    setLoadingSchema(true);
    fetch(`/api/scripts/${scriptId}/inputs`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: InputsSchema) => {
        setSchema(data);
        const init: Record<string, string> = {};
        for (const a of data.args) {
          if (a.default != null) init[a.name] = a.default;
          else if (a.type === "bool") init[a.name] = "false";
          else init[a.name] = "";
        }
        setValues(init);
      })
      .catch((e) => {
        toast({ title: "Failed to load script inputs", description: String(e), variant: "destructive" });
        setSchema({ args: [], needsStdin: false, stdinPrompt: null, file: null });
      })
      .finally(() => setLoadingSchema(false));
  }, [open, scriptId, initialResult, initialSchema]);

  const hasInputs = !!schema && (schema.args.length > 0 || schema.needsStdin || schema.file != null);

  function buildArgsList(): string[] {
    if (!schema) return [];
    const out: string[] = [];
    for (const a of schema.args) {
      const v = values[a.name] ?? "";
      if (a.type === "bool") {
        if (v === "true" && a.flag) out.push(a.flag);
        continue;
      }
      if (v === "" || v == null) continue;
      if (a.flag) {
        out.push(a.flag, v);
      } else {
        out.push(v);
      }
    }
    return out;
  }

  async function executeNow(opts?: { skipFile?: boolean }) {
    setRunning(true);
    setResult(null);
    try {
      const args = buildArgsList();
      let res: Response;
      if (file && !opts?.skipFile) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("args", JSON.stringify(args));
        if (stdin) fd.append("stdin", stdin);
        res = await fetch(`/api/scripts/${scriptId}/execute`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
      } else {
        res = await fetch(`/api/scripts/${scriptId}/execute`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args, stdin: stdin || null }),
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ExecResult = await res.json();
      setResult(data);
      if (data.success) {
        toast({ title: "Execution completed" });
      } else {
        toast({ title: "Execution failed", description: `Exit code ${data.exitCode}`, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Failed to execute", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  function validate(): string | null {
    if (!schema) return "Loading...";
    for (const a of schema.args) {
      if (a.required && a.type !== "bool" && !(values[a.name] ?? "").trim()) {
        return `Please provide: ${a.label}`;
      }
    }
    if (schema.file?.required && !file) {
      return `Please upload: ${schema.file.label}`;
    }
    return null;
  }

  function handleSubmit() {
    const err = validate();
    if (err) {
      toast({ title: "Required field missing", description: err, variant: "destructive" });
      return;
    }
    executeNow();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Run: {scriptName}
          </DialogTitle>
          <DialogDescription>
            {loadingSchema
              ? "Detecting required inputs..."
              : hasInputs
                ? "Provide the required inputs below, then click Execute."
                : result
                  ? "Execution result:"
                  : "Ready to run."}
          </DialogDescription>
        </DialogHeader>

        {loadingSchema && (
          <div className="space-y-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!loadingSchema && schema && hasInputs && (
          <div className="space-y-5 py-2">
            {schema.args.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
                  Required Fields
                </div>
                {schema.args.map((a) => (
                  <div key={a.name} className="space-y-1.5">
                    <Label htmlFor={`arg-${a.name}`} className="flex items-center gap-2">
                      {a.label}
                      {a.required && <span className="text-destructive text-xs">*</span>}
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {a.flag ?? a.name}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                    </Label>
                    {a.help && <p className="text-xs text-muted-foreground">{a.help}</p>}
                    {a.choices ? (
                      <select
                        id={`arg-${a.name}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={values[a.name] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                      >
                        <option value="">-- Select --</option>
                        {a.choices.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : a.type === "bool" ? (
                      <select
                        id={`arg-${a.name}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={values[a.name] ?? "false"}
                        onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    ) : (
                      <Input
                        id={`arg-${a.name}`}
                        type={a.type === "int" || a.type === "float" ? "number" : "text"}
                        step={a.type === "float" ? "any" : undefined}
                        value={values[a.name] ?? ""}
                        placeholder={a.default ?? `Enter ${a.label.toLowerCase()}`}
                        onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {schema.file && (
              <div className="space-y-2 p-4 rounded-lg border border-dashed border-primary/40 bg-primary/5">
                <Label className="flex items-center gap-2 font-semibold">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  {schema.file.label}
                  {schema.file.required && <span className="text-destructive text-xs">*</span>}
                </Label>
                <p className="text-xs text-muted-foreground">{schema.file.hint}</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept={ACCEPT_BY_KIND[schema.file.kind] ?? "*"}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="cursor-pointer"
                  />
                  {file && (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Upload className="h-3 w-3" />
                      {(file.size / 1024).toFixed(1)} KB
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {schema.needsStdin && (
              <div className="space-y-1.5">
                <Label htmlFor="stdin-input" className="flex items-center gap-2">
                  Standard Input
                  {schema.stdinPrompt && (
                    <span className="text-xs text-muted-foreground italic">
                      Prompt: "{schema.stdinPrompt}"
                    </span>
                  )}
                </Label>
                <Textarea
                  id="stdin-input"
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  placeholder="Type the value(s) the script will read..."
                  className="font-mono text-sm min-h-[80px]"
                />
              </div>
            )}
          </div>
        )}

        {result && (
          <div className={`rounded-md border p-3 space-y-2 ${result.success ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-2">
              {result.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-sm font-semibold">
                {result.success ? "Success" : "Failed"}
              </span>
              <Badge variant="outline" className="ml-auto">
                <Clock className="h-3 w-3 mr-1" />
                {result.executionTimeMs}ms
              </Badge>
              <Badge variant={result.success ? "default" : "destructive"}>
                exit {result.exitCode}
              </Badge>
            </div>
            {result.stdout && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                  <Terminal className="h-3 w-3" /> Output
                </div>
                <pre className="bg-black text-green-400 p-3 rounded text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">
                  {result.stdout}
                </pre>
              </div>
            )}
            {result.stderr && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">Errors</div>
                <pre className="bg-black text-red-400 p-3 rounded text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">
                  {result.stderr}
                </pre>
              </div>
            )}
            {!result.stdout && !result.stderr && (
              <p className="text-xs italic text-muted-foreground">No output produced.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {hasInputs && (
            <Button onClick={handleSubmit} disabled={running || loadingSchema}>
              {running ? (
                "Executing..."
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Execute
                </>
              )}
            </Button>
          )}
          {!hasInputs && result && (
            <Button onClick={() => executeNow()} disabled={running}>
              <Play className="mr-2 h-4 w-4" />
              Run Again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
