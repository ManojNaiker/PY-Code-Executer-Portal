import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useUploadScript, useListDepartments, getListDepartmentsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileUp, Upload as UploadIcon, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  description: z.string().max(500).optional(),
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

    if (!file.name.endsWith('.py')) {
      setFileError("Only .py files are supported");
      setFileContent("");
      setFilename("");
      e.target.value = "";
      return;
    }

    setFilename(file.name);
    
    // Set default name if empty
    if (!form.getValues("name")) {
      form.setValue("name", file.name.replace(/\.py$/, ''));
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") {
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
      setFileError("Please select a valid Python file");
      return;
    }

    uploadScript.mutate({
      data: {
        name: values.name,
        description: values.description || null,
        filename: filename,
        code: fileContent,
        departmentId: values.departmentId && values.departmentId !== "none" ? parseInt(values.departmentId, 10) : null
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Upload Script</h1>
        <p className="text-muted-foreground">Deploy a new Python script to the portal.</p>
      </div>

      <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle>Script Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <div className="space-y-2">
                <label className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${fileError ? "text-destructive" : ""}`}>Python File *</label>
                <div className={`border-2 border-dashed rounded-lg p-6 text-center ${fileError ? 'border-destructive bg-destructive/5' : 'border-muted-foreground/25 hover:bg-muted/50'} transition-colors relative`}>
                  <input
                    type="file"
                    accept=".py"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileUp className={`h-8 w-8 ${fileError ? 'text-destructive' : 'text-muted-foreground'}`} />
                    {filename ? (
                      <span className="font-medium font-mono text-primary">{filename}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Click or drag a .py file to upload</span>
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
            </CardContent>
            <CardFooter className="flex justify-end border-t pt-6">
              <Button type="submit" disabled={uploadScript.isPending || !filename}>
                {uploadScript.isPending ? "Uploading..." : (
                  <>
                    <UploadIcon className="mr-2 h-4 w-4" />
                    Upload Script
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
