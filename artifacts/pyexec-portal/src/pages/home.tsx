import { Show, SignIn, SignUp } from "@clerk/react";
import { Link, Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Code2, Shield, Users, Activity } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 h-16 flex items-center justify-between border-b">
        <div className="flex items-center gap-2 text-primary font-bold text-xl">
          <Code2 className="h-6 w-6" />
          <span>PyExec Portal</span>
        </div>
        <div className="flex items-center gap-4">
          <Show when="signed-out">
            <Button variant="ghost" asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-up">Register</Link>
            </Button>
          </Show>
          <Show when="signed-in">
            <Button asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </Show>
        </div>
      </header>
      
      <main className="flex-1">
        <section className="py-24 px-6 max-w-5xl mx-auto text-center">
          <h1 className="text-5xl font-extrabold tracking-tight text-foreground sm:text-6xl mb-6">
            Enterprise Python Execution
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10">
            Secure, audited, and isolated Python script execution for your organization. 
            Manage access by department and track every execution.
          </p>
          <Show when="signed-out">
            <div className="flex justify-center gap-4">
              <Button size="lg" asChild>
                <Link href="/sign-up">Get Started</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/sign-in">Sign In</Link>
              </Button>
            </div>
          </Show>
        </section>

        <section className="py-20 bg-muted/50 px-6">
          <div className="max-w-5xl mx-auto grid gap-8 md:grid-cols-3">
            <div className="bg-card p-6 rounded-lg border">
              <Shield className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-lg font-bold mb-2">Department Isolation</h3>
              <p className="text-muted-foreground">
                Strict access controls ensure users only see and execute scripts assigned to their department.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <Activity className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-lg font-bold mb-2">Full Audit Trail</h3>
              <p className="text-muted-foreground">
                Every execution, upload, and administrative action is logged and searchable.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <Users className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-lg font-bold mb-2">Centralized Management</h3>
              <p className="text-muted-foreground">
                Admins have full visibility into platform usage, user roles, and script performance.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
