# PyExec Portal Workspace

## Overview

Enterprise Python Code Execution Platform. Users can upload Python scripts, organize them by department, and execute them from the browser — no installation needed. Full audit logging, department-based access control, and user management.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Clerk (via `@clerk/express` + `@clerk/react`)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + wouter routing

## Architecture

### Frontend (`artifacts/pyexec-portal`)
- Dark-navy corporate UI
- Clerk-authenticated with user sync to local DB
- Routes: /, /dashboard, /scripts, /scripts/:id, /upload, /admin/departments, /admin/users, /admin/audit
- /sign-in, /sign-up for Clerk auth pages

### Backend (`artifacts/api-server`)
- Express 5 API server
- Clerk proxy middleware for auth
- Routes: /api/departments, /api/users, /api/scripts, /api/scripts/:id/execute, /api/audit-logs, /api/dashboard/stats, /api/auth/sync
- Python execution via child_process spawn (python3)

### Database (`lib/db`)
Tables:
- `departments` — organizational units
- `users` — synced from Clerk, with role (admin/user) and department assignment
- `scripts` — uploaded Python files with code stored in text column
- `executions` — execution history per script
- `audit_logs` — full audit trail for all actions

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Access Control

- First user to register becomes admin
- Admins can see all scripts and manage departments/users
- Regular users only see scripts assigned to their department (or unassigned scripts)
- All actions are recorded in audit_logs

## Admin Management Endpoints (raw fetch on frontend)

- `POST /api/users` — create one user (email, password, firstName, lastName, role, departmentId). Default password `changeme123` if omitted.
- `POST /api/users/bulk` — `{users:[...]}`. Items may use `departmentName` instead of `departmentId`. Returns `{created, failed}`.
- `DELETE /api/users/:clerkId` — delete user (cannot delete self).
- `POST /api/departments/bulk` — `{departments:[{name, description?}]}`. Returns `{created, failed}`.
- `PUT /api/scripts/:id` — admin-only edit of name/description/subject/filename/code/departmentId. Code change clears `aiSchema` cache.

UI: admin-users page has "New User" + "Bulk Import" dialogs and per-row delete; admin-departments page has "Bulk Import" dialog; script-detail page shows "Edit" button for admins.

## AI / Anthropic API Key Setup

The AI Enhancer and AI Fix Error features use Anthropic Claude.

**On Replit (current setup):** The Replit Anthropic AI integration is installed and provides the API key automatically via the `AI_INTEGRATIONS_ANTHROPIC_API_KEY` environment variable. No manual configuration needed.

**Running locally (development on your machine):** The Replit integration env var won't be available. You have two options:
1. Set `SESSION_SECRET` and add your own Anthropic key via Admin Settings in the app (Settings → AI Provider → Anthropic → paste key).
2. Or set the env var manually: `export AI_INTEGRATIONS_ANTHROPIC_API_KEY=sk-ant-...` before starting the backend.

The code in `artifacts/api-server/src/lib/aiClient.ts` and `lib/integrations-anthropic-ai/src/client.ts` handles both cases — it prefers a key stored in Admin Settings, falls back to the env var.

## JARVIS AI Enhancer

The AI Enhancer (`POST /api/scripts/:id/ai-enhance`) is a JARVIS-style AI analyst and code improver:

**Field Reconciliation** — AI reads the full script and produces `reconciledFields` (the definitive correct form field list):
- Parser-detected fields that ARE needed → kept (`source: "parser"`)
- Fields the parser MISSED but the script needs → added (`source: "ai_added"`, shown with green "Added by JARVIS" badge)
- Parser-detected fields that are NOT needed → silently removed
- The run dialog prefers `aiSchema.reconciledFields` over raw parser output when available

**Code Enhancement** — AI improves the script and saves it back to `scripts.code`:
- Adds progress print statements, try/except around network calls, input validation, specific error messages
- `aiSchema.codeEnhanced = true` + `aiSchema.codeChanges[]` describe what was improved
- The run dialog shows a green "Script enhanced by JARVIS" banner listing the changes

**tkinter simpledialog detection** — parser now also detects:
- `simpledialog.askstring("Title", "Prompt:")` → text field with label = "Prompt"
- `simpledialog.askstring("Title", "Password:", show="*")` → password field
- `simpledialog.askinteger(...)` / `simpledialog.askfloat(...)` → number field

## Notes

- `lib/api-zod/src/index.ts` only exports from generated tag subdirs (not the old types folder pattern) — do not add `export * from "./generated/types"` back
- Python execution uses `python3` system binary with 30s timeout, sandboxed temp directory
- The tkinter form parser (`lib/scriptParser.ts`) detects Entry widgets using: (1) preceding Label text, (2) variable name (e.g. `username_entry` → "Username"), (3) following Label text as fallbacks in that order; also detects `simpledialog` calls directly
