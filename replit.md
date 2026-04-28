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
- **Auth**: Local JWT + bcrypt session cookie (`pyexec_session`). Seeded admin: `admin@pyexec.com` / `admin@123`.
- **AI**: Anthropic Claude (Sonnet 4.6) via the Replit AI Integrations blueprint (`AI_INTEGRATIONS_ANTHROPIC_API_KEY`)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + wouter routing

## Architecture

### Frontend (`artifacts/pyexec-portal`)
- Dark-navy corporate UI
- Local session-cookie auth, user record in local DB
- Routes: /, /dashboard, /scripts, /scripts/:id, /upload, /admin/departments, /admin/users, /admin/audit
- /sign-in for the local login form

### Standalone Windows EXE Builder
- `src/lib/windowsPython.ts` downloads & caches `astral-sh/python-build-standalone` (cpython-3.11.9 install_only) to `~/.cache/pyexec-win-py/`. Used to bundle a complete Python interpreter into every generated EXE.
- `src/lib/exeBuilder.ts` builds Windows EXEs via Go cross-compile (GOOS=windows GOARCH=amd64). Each EXE embeds: the .py script, supporting files, optional logo, **the entire Python distribution under `bundle/python/`**, and any third-party pip wheels needed by the script (installed via `pip install --platform win_amd64 --python-version 3.11 --abi cp311 --only-binary=:all:` into `bundle/python/Lib/site-packages/`).
- `exe-template/main.go` extracts `bundle/` to a hidden cache at `%LOCALAPPDATA%\PyExecPortal\<scriptName>-<buildHash>\` (PyInstaller `--onefile` style — user never sees extracted files). Re-extracts only when `buildHash` changes. Runs the script with `cwd = exeDir` so any output files (logs, exports) the script writes land next to the EXE where the user expects them. Uses the bundled `python\python.exe`; falls back to system Python only if the bundled tree is missing.
- After bundling, `pruneWindowsPython()` strips ~100 MB of unused runtime (debug `.pdb` files, pip/setuptools/venv/idlelib/test, plus tcl-tk/sqlite3/ssl when the script doesn't need them — detected via `detectStdlibNeeds()` + a heuristic list of pip packages that pull each in). Final EXE size: ~17 MB minimal, ~24 MB with SSL/HTTP, ~28 MB with tkinter, ~25 MB with `requests`.

### Backend (`artifacts/api-server`)
- Express 5 API server
- Local session middleware (JWT cookie)
- Routes: /api/departments, /api/users, /api/scripts, /api/scripts/:id/execute, /api/scripts/:id/execute-stream, /api/scripts/:id/ai-fix-error, /api/scripts/:id/ai-fix-error/apply, /api/scripts/:id/ai-enhance, /api/audit-logs, /api/dashboard/stats, /api/auth/login, /api/auth/me
- Python execution via child_process spawn (python3); streaming responses via NDJSON

### JARVIS Auto-Fix (Replit/Grok-style auto error resolver)
- When an admin runs a script and it fails, JARVIS automatically:
  1. Reads `stderr`/`exitCode`
  2. Calls Anthropic to diagnose + produce a corrected full file (`/ai-fix-error`)
  3. Persists the fix (`/ai-fix-error/apply`)
  4. Re-runs the script and re-evaluates
  5. Repeats up to `MAX_AUTO_FIX_ATTEMPTS = 3` (defined in `run-script-dialog.tsx`)
- The dialog shows an "Auto-Fix Timeline" with each attempt's diagnosis, changes, confidence, and outcome (`Fixed` / `Still failing` / `JARVIS error`).
- Auto-mode is ON by default for admins, can be toggled off per-dialog. Non-admins see a hint that they need an admin to enable auto-fix (since persisting the fix writes to `scripts.code`).

### Multi-language support (JARVIS works on all common script types)
- Language is detected from the file extension first, then a content sniff (shebangs, common keywords).
- Recognised languages and their behaviour on this Linux server:
  | Language | Extensions | Execution | JARVIS fix / enhance |
  | --- | --- | --- | --- |
  | Python | `.py`, `.pyw` | `python3 -u` (with auto pip install + Tkinter shim) | yes |
  | Bash / Shell | `.sh`, `.bash`, `.zsh` | `bash` | yes |
  | JavaScript | `.js`, `.mjs`, `.cjs` | `node` | yes |
  | TypeScript | `.ts` | `npx -y tsx` | yes |
  | Ruby / Perl / PHP | `.rb`, `.pl`, `.php` | their interpreter if installed | yes |
  | PowerShell | `.ps1`, `.psm1` | `pwsh` (only if installed) | yes |
  | Windows Batch | `.bat`, `.cmd` | not runnable on Linux — friendly stderr | yes |
  | VBScript | `.vbs` | not runnable on Linux | yes |
  | VBA / Office Macro | `.bas`, `.cls`, `.frm`, `.vba` | not runnable on Linux | yes |
  | HTML | `.html`, `.htm` | not server-executable (browser-rendered) | yes |
  | SQL | `.sql` | not runnable here (needs DB) | yes (review) |
- Implementation lives in `artifacts/api-server/src/lib/scriptLanguage.ts` (registry + detector). The execution route, AI fix-error and AI enhance routes all use this registry to pick the right interpreter and craft a language-aware system prompt.
- For non-runnable languages, the execute endpoint returns a friendly "cannot run on this server" stderr instead of crashing — JARVIS auto-fix then kicks in and produces a corrected file the user can run on its native platform (Windows, Excel, browser, etc.).

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
