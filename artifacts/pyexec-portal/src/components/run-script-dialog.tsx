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
import { Play, FileSpreadsheet, Terminal, AlertCircle, CheckCircle2, Clock, Upload, MonitorPlay, Keyboard } from "lucide-react";
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
  kind: "excel" | "csv" | "json" | "text" | "image" | "any";
  label: string;
  hint: string;
  source: "extension" | "filedialog" | "argparse" | "argv";
} | null;

type DetectedInput = { prompt: string; secret: boolean };

type DetectedGui = {
  framework: string;
  hasMainLoop: boolean;
} | null;

type TkField = {
  label: string;
  kind: "text" | "password" | "number" | "select" | "checkbox" | "textarea";
  choices?: string[];
  default?: string;
};

type TkAction = { label: string };

type TkForm = {
  fields: TkField[];
  actions: TkAction[];
  needsFile: boolean;
  fileLabel: string | null;
} | null;

type InputsSchema = {
  args: DetectedArg[];
  inputs: DetectedInput[];
  needsStdin: boolean;
  stdinPrompt: string | null;
  file: FileSpec;
  gui: DetectedGui;
  tkForm: TkForm;
};

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  deps?: {
    attempted: string[];
    installed: string[];
    failed: { pkg: string; error: string }[];
    log?: string;
  };
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
  image: ".png,.jpg,.jpeg,.gif,.bmp,.webp",
  text: "*",
  any: "*",
};

function makeInitArgs(schema: InputsSchema): Record<string, string> {
  const init: Record<string, string> = {};
  for (const a of schema.args) {
    if (a.default != null) init[a.name] = a.default;
    else if (a.type === "bool") init[a.name] = "false";
    else init[a.name] = "";
  }
  return init;
}

export function RunScriptDialog({ scriptId, scriptName, open, onOpenChange, initialResult, initialSchema }: Props) {
  const { toast } = useToast();
  const [schema, setSchema] = useState<InputsSchema | null>(initialSchema ?? null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [inputValues, setInputValues] = useState<string[]>([]);
  const [extraStdin, setExtraStdin] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tkValues, setTkValues] = useState<Record<string, string>>({});
  const [tkAction, setTkAction] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(initialResult ?? null);

  function initTkValues(s: InputsSchema): Record<string, string> {
    const init: Record<string, string> = {};
    if (s.tkForm) {
      for (const f of s.tkForm.fields) {
        if (f.default != null) init[f.label] = f.default;
        else if (f.kind === "checkbox") init[f.label] = "false";
        else init[f.label] = "";
      }
    }
    return init;
  }

  useEffect(() => {
    if (!open) {
      setSchema(null);
      setValues({});
      setInputValues([]);
      setExtraStdin("");
      setFile(null);
      setTkValues({});
      setTkAction("");
      setResult(null);
      return;
    }
    if (initialResult) setResult(initialResult);
    if (initialSchema) {
      setSchema(initialSchema);
      setValues(makeInitArgs(initialSchema));
      setInputValues(new Array(initialSchema.inputs.length).fill(""));
      setTkValues(initTkValues(initialSchema));
      setTkAction(initialSchema.tkForm?.actions?.[0]?.label ?? "");
      return;
    }
    setLoadingSchema(true);
    fetch(`/api/scripts/${scriptId}/inputs`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: InputsSchema) => {
        setSchema(data);
        setValues(makeInitArgs(data));
        setInputValues(new Array(data.inputs.length).fill(""));
        setTkValues(initTkValues(data));
        setTkAction(data.tkForm?.actions?.[0]?.label ?? "");
      })
      .catch((e) => {
        toast({ title: "Failed to load script inputs", description: String(e), variant: "destructive" });
        setSchema({ args: [], inputs: [], needsStdin: false, stdinPrompt: null, file: null, gui: null, tkForm: null });
      })
      .finally(() => setLoadingSchema(false));
  }, [open, scriptId, initialResult, initialSchema]);

  const hasTkForm = !!schema?.tkForm && (
    schema.tkForm.fields.length > 0 ||
    schema.tkForm.actions.length > 0 ||
    schema.tkForm.needsFile
  );

  const hasInputs = !!schema && (
    schema.args.length > 0 ||
    schema.inputs.length > 0 ||
    schema.needsStdin ||
    schema.file != null ||
    schema.gui != null ||
    hasTkForm
  );

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

  function buildStdin(): string | null {
    if (!schema) return null;
    const lines: string[] = [];
    for (const v of inputValues) lines.push(v);
    if (extraStdin) lines.push(extraStdin);
    if (lines.length === 0) return null;
    // Each input() call reads one line
    return lines.join("\n") + "\n";
  }

  async function executeNow(opts?: { skipFile?: boolean }) {
    setRunning(true);
    setResult(null);
    try {
      const args = buildArgsList();
      const stdin = buildStdin();
      const tkInputsPayload = hasTkForm
        ? { fields: tkValues, action: tkAction }
        : null;
      let res: Response;
      if (file && !opts?.skipFile) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("args", JSON.stringify(args));
        if (stdin) fd.append("stdin", stdin);
        if (tkInputsPayload) fd.append("tkInputs", JSON.stringify(tkInputsPayload));
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
          body: JSON.stringify({
            args,
            stdin: stdin || null,
            tkInputs: tkInputsPayload,
          }),
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
    for (let i = 0; i < (schema.inputs?.length ?? 0); i++) {
      if (!(inputValues[i] ?? "").length) {
        return `Please answer prompt: "${schema.inputs[i].prompt}"`;
      }
    }
    if (schema.tkForm?.needsFile && !file) {
      return `Please upload: ${schema.tkForm.fileLabel ?? "File"}`;
    }
    if (schema.tkForm && schema.tkForm.actions.length > 0 && !tkAction) {
      return "Please choose an action to run.";
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

        {!loadingSchema && schema && schema.gui && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex gap-2 text-sm">
            <MonitorPlay className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">GUI application detected ({schema.gui.framework})</div>
              <p className="text-muted-foreground text-xs mt-1">
                {hasTkForm
                  ? "We have rebuilt this desktop window as a web form. Fill the fields below and pick which button to run — the script will execute headlessly on the server."
                  : "This script tries to open a desktop window. The server runs headless, so the native window cannot be displayed in the browser. Any input prompts will be collected from the form below and forwarded to the script."}
              </p>
            </div>
          </div>
        )}

        {!loadingSchema && schema?.tkForm && hasTkForm && (
          <div className="space-y-4 py-2">
            {schema.tkForm.fields.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
                  Form Fields
                </div>
                {schema.tkForm.fields.map((f) => (
                  <div key={f.label} className="space-y-1.5">
                    <Label htmlFor={`tk-${f.label}`} className="flex items-center gap-2">
                      {f.label}
                      <Badge variant="outline" className="text-[10px]">{f.kind}</Badge>
                    </Label>
                    {f.kind === "select" && f.choices ? (
                      <select
                        id={`tk-${f.label}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={tkValues[f.label] ?? ""}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                      >
                        <option value="">-- Select --</option>
                        {f.choices.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : f.kind === "checkbox" ? (
                      <select
                        id={`tk-${f.label}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={tkValues[f.label] ?? "false"}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    ) : f.kind === "textarea" ? (
                      <Textarea
                        id={`tk-${f.label}`}
                        value={tkValues[f.label] ?? ""}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                        className="font-mono text-sm min-h-[80px]"
                      />
                    ) : (
                      <Input
                        id={`tk-${f.label}`}
                        type={f.kind === "password" ? "password" : f.kind === "number" ? "number" : "text"}
                        value={tkValues[f.label] ?? ""}
                        placeholder={f.default ?? `Enter ${f.label.toLowerCase()}`}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {schema.tkForm.needsFile && (
              <div className="space-y-2 p-4 rounded-lg border border-dashed border-primary/40 bg-primary/5">
                <Label className="flex items-center gap-2 font-semibold">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  {schema.tkForm.fileLabel ?? "File"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  This file replaces the native file dialog the script would normally open.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
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

            {schema.tkForm.actions.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="tk-action" className="flex items-center gap-2">
                  Action to Run
                  <span className="text-destructive text-xs">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pick which button from the original GUI you want to trigger.
                </p>
                <select
                  id="tk-action"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={tkAction}
                  onChange={(e) => setTkAction(e.target.value)}
                >
                  {schema.tkForm.actions.map((a) => (
                    <option key={a.label} value={a.label}>{a.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {!loadingSchema && schema && hasInputs && (
          <div className="space-y-5 py-2">
            {schema.args.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
                  Command-line Arguments
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

            {schema.inputs.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide flex items-center gap-2">
                  <Keyboard className="h-4 w-4" />
                  Interactive Prompts
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  The script asks for input. Fill each prompt below — values will be sent in order.
                </p>
                {schema.inputs.map((inp, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <Label htmlFor={`input-${idx}`} className="flex items-center gap-2">
                      {inp.prompt || `Prompt ${idx + 1}`}
                      <span className="text-destructive text-xs">*</span>
                      {inp.secret && <Badge variant="outline" className="text-[10px]">password</Badge>}
                    </Label>
                    <Input
                      id={`input-${idx}`}
                      type={inp.secret ? "password" : "text"}
                      value={inputValues[idx] ?? ""}
                      onChange={(e) => {
                        const next = [...inputValues];
                        next[idx] = e.target.value;
                        setInputValues(next);
                      }}
                      placeholder="Type your answer..."
                    />
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

            {schema.needsStdin && schema.inputs.length === 0 && (
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
                  value={extraStdin}
                  onChange={(e) => setExtraStdin(e.target.value)}
                  placeholder="Type the value(s) the script will read..."
                  className="font-mono text-sm min-h-[80px]"
                />
              </div>
            )}
          </div>
        )}

        {result?.deps && (result.deps.installed.length > 0 || result.deps.failed.length > 0) && (
          <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3 text-xs space-y-1">
            <div className="font-semibold text-blue-600 dark:text-blue-400">Dependency installation</div>
            {result.deps.installed.length > 0 && (
              <div>Installed: <span className="font-mono">{result.deps.installed.join(", ")}</span></div>
            )}
            {result.deps.failed.length > 0 && (
              <div className="text-destructive">
                Failed: {result.deps.failed.map((f) => (
                  <div key={f.pkg} className="mt-1">
                    <span className="font-mono font-semibold">{f.pkg}</span>
                    <pre className="whitespace-pre-wrap text-[10px] opacity-80 mt-0.5">{f.error.slice(0, 400)}</pre>
                  </div>
                ))}
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
          {hasInputs ? (
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
          ) : (
            !loadingSchema && (
              <Button onClick={() => executeNow()} disabled={running}>
                <Play className="mr-2 h-4 w-4" />
                {result ? "Run Again" : "Execute"}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
