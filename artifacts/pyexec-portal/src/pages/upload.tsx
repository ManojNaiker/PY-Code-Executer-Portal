import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useUploadScript, useListDepartments, getListDepartmentsQueryKey } from "@workspace/api-client-react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileUp, Upload as UploadIcon, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FolderTreeSelect } from "@/components/folder-tree-select";

const SUPPORTED_EXTENSIONS = [
  ".py", ".pyw", ".ipynb",
  ".sh", ".bash", ".zsh",
  ".js", ".mjs", ".cjs",
  ".ts",
  ".ps1", ".psm1",
  ".bat", ".cmd",
  ".vbs", ".vba", ".bas", ".cls", ".frm",
  ".html", ".htm",
  ".sql",
  ".rb", ".pl", ".php",
];

const SUPPORTED_EXTENSIONS_ACCEPT = SUPPORTED_EXTENSIONS.join(",");

function hasSupportedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function stripExtension(name: string): string {
  const lower = name.toLowerCase();
  const ext = SUPPORTED_EXTENSIONS.find(e => lower.endsWith(e));
  return ext ? name.slice(0, name.length - ext.length) : name;
}

/**
 * Convert a Jupyter notebook (.ipynb JSON) into a runnable Python script.
 * - Code cells become Python blocks separated by `# %% [cell N]` markers
 *   (compatible with VS Code / PyCharm cell-mode).
 * - Markdown cells become `# %% [markdown]` comments.
 * - Magic lines (%matplotlib, !pip install ...) and shell-prefixed lines
 *   are commented out so the file is valid Python.
 * Returns null if the file isn't a valid notebook.
 */
function notebookToPython(rawJson: string): string | null {
  let nb: any;
  try {
    nb = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!nb || !Array.isArray(nb.cells)) return null;

  const out: string[] = [
    "# Converted from Jupyter Notebook (.ipynb) on upload.",
    "# Magic commands (%xxx) and shell lines (!xxx) have been commented out.",
    "",
  ];
  let cellIdx = 0;
  for (const cell of nb.cells) {
    cellIdx += 1;
    const src = Array.isArray(cell.source) ? cell.source.join("") : (typeof cell.source === "string" ? cell.source : "");
    if (cell.cell_type === "code") {
      out.push(`# %% [cell ${cellIdx}]`);
      const lines = src.split("\n").map((line: string) => {
        const trimmed = line.trimStart();
        // Comment out IPython magics and shell escapes — they're not valid Python.
        if (trimmed.startsWith("%") || trimmed.startsWith("!") || trimmed.startsWith("?")) {
          return `# [magic] ${line}`;
        }
        return line;
      });
      out.push(lines.join("\n"));
      out.push("");
    } else if (cell.cell_type === "markdown") {
      out.push(`# %% [markdown ${cellIdx}]`);
      const lines = src.split("\n").map((line: string) => `# ${line}`);
      out.push(lines.join("\n"));
      out.push("");
    }
  }
  return out.join("\n");
}

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  description: z.string().max(500).optional(),
  subject: z.string().max(100).optional(),
  departmentId: z.string().optional(),
});

export default function Upload() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [fileContent, setFileContent] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [fileError, setFileError] = useState<string>("");

  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() }
  });

  const uploadScript = useUploadScript({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Script uploaded successfully" });
        setLocation(`/scripts/${data.id}`);
      },
      onError: (error) => {
        toast({ title: "Failed to upload script", description: String(error), variant: "destructive" });
      }
    }
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      subject: "",
      departmentId: "none",
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError("");
    const file = e.target.files?.[0];
    if (!file) {
      setFileContent("");
      setFilename("");
      return;
    }

    if (!hasSupportedExtension(file.name)) {
      setFileError("Unsupported file type. Upload a script Light AI knows (.py, .sh, .js, .ts, .ps1, .bat, .vbs, .bas, .html, .sql, .rb, .pl, .php …).");
      setFileContent("");
      setFilename("");
      e.target.value = "";
      return;
    }

    const isNotebook = file.name.toLowerCase().endsWith(".ipynb");
    const finalName = isNotebook ? `${stripExtension(file.name)}.py` : file.name;
    setFilename(finalName);

    // Set default name if empty
    if (!form.getValues("name")) {
      form.setValue("name", stripExtension(file.name));
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== "string") return;
      if (isNotebook) {
        const py = notebookToPython(result);
        if (!py) {
          setFileError("Could not parse the .ipynb file. Make sure it's a valid Jupyter notebook.");
          setFileContent("");
          setFilename("");
          return;
        }
        setFileContent(py);
        toast({
          title: "Notebook converted",
          description: "The .ipynb was flattened into a Python script so it can run on the server and be fixed by Light AI.",
        });
      } else {
        setFileContent(result);
      }
    };
    reader.onerror = () => {
      setFileError("Failed to read file");
    };
    reader.readAsText(file);
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (!fileContent || !filename) {
      setFileError("Please select a script file to upload.");
      return;
    }

    uploadScript.mutate({
      data: {
        name: values.name,
        description: values.description || null,
        subject: values.subject?.trim() || null,
        filename: filename,
        code: fileContent,
        departmentId: values.departmentId && values.departmentId !== "none" ? parseInt(values.departmentId, 10) : null
      }
    });
  };

  return (
    <div>
      <PageHeader
        title="Upload Script"
        description="Deploy a new script to the portal. Light AI auto-fixes any supported language."
        icon={<UploadIcon className="h-5 w-5" />}
      />
      <div className="max-w-3xl">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div>
              <h2 className="text-base font-semibold mb-1">Script Details</h2>
              <p className="text-sm text-muted-foreground mb-5">Provide the file and metadata for this script.</p>
              <div className="space-y-6">
              
              <div className="space-y-2">
                <label className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${fileError ? "text-destructive" : ""}`}>Script File *</label>
                <div className={`border-2 border-dashed rounded-lg p-6 text-center ${fileError ? 'border-destructive bg-destructive/5' : 'border-muted-foreground/25 hover:bg-muted/50'} transition-colors relative`}>
                  <input
                    type="file"
                    accept={SUPPORTED_EXTENSIONS_ACCEPT}
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileUp className={`h-8 w-8 ${fileError ? 'text-destructive' : 'text-muted-foreground'}`} />
                    {filename ? (
                      <span className="font-medium font-mono text-primary">{filename}</span>
                    ) : (
                      <>
                        <span className="text-sm text-muted-foreground">Click or drag a script file to upload</span>
                        <span className="text-xs text-muted-foreground">
                          Python, Jupyter Notebook, Bash, JavaScript, TypeScript, PowerShell, Batch, VBScript, VBA, HTML, SQL, Ruby, Perl, PHP
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {fileError && <p className="text-sm text-destructive">{fileError}</p>}
                
                {fileContent && !fileError && (
                  <div className="mt-2 text-xs text-muted-foreground text-right font-mono">
                    {(fileContent.split('\n').length)} lines
                  </div>
                )}
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Script Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Data Processor" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject / Folder</FormLabel>
                    <FormControl>
                      <FolderTreeSelect
                        value={field.value ?? ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>
                      Pick an existing folder from the tree, or create a custom name.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="What does this script do?" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department Assignment</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a department" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Global (All Users)</SelectItem>
                        {departments?.map(dept => (
                          <SelectItem key={dept.id} value={dept.id.toString()}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Restrict access to users in a specific department.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
            </div>
            <div className="flex justify-end border-t pt-6">
              <Button type="submit" disabled={uploadScript.isPending || !filename}>
                {uploadScript.isPending ? "Uploading..." : (
                  <>
                    <UploadIcon className="mr-2 h-4 w-4" />
                    Upload Script
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
