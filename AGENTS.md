# AGENTS.md

Canonical standing rules for agents executing PRs in `timafor-code/sredi-svoih-app`.

The goal is small, safe, reviewable production changes.

## 1. Agent Execution Policy

- Primary agent: Codex. Fallback agent: Claude Code.
- "The agent" means whichever tool is executing the current PR.
- PR prompts are written in English and must work for both agents without rewriting.
- Standing rules live in this file. PR prompts must not duplicate them.

## 2. Sources Of Truth

Precedence for the executing agent:

1. Latest explicit instruction from the project owner.
2. The current PR prompt: primary outcome, scope, expected files, checks.
3. This `AGENTS.md`.
4. Current repository state: `main`, existing code, Alembic migrations, tests, `docs/`.

The PR prompt defines what to do. The repository defines what exists.

If the PR prompt conflicts with the repository (a referenced file, service,
endpoint, table, column or signature does not exist or differs), stop and
report the mismatch. Do not guess, do not invent the missing piece, do not
silently adapt the scope.

Never describe proposed files, endpoints or tables as existing unless verified
in the repository.

## 3. Architecture

Canonical production architecture:

```text
Mobile app (Expo)  ─┐
Public web (apps/web) ─┼─ HTTPS ─> FastAPI (apps/api) ─> PostgreSQL
Web-admin (apps/admin) ─┘
```

- All clients communicate only through the FastAPI backend.
- Clients never connect to PostgreSQL directly.
- Authorization decisions belong to the backend. Frontend visibility is not
  authorization.
- Supabase is fully retired. Do not add Supabase dependencies, clients, env
  variables, migrations or functions. Remaining Supabase files in the
  repository are legacy and may be changed or removed only by an explicit
  cleanup PR.
- Do not change architecture without explicit owner approval.

## 4. Repository Map

- Mobile app screens: `app/`
- Mobile shared code and services: `src/` (API client: `src/services/apiClient.ts`)
- Web-admin: `apps/admin/` (stylesheet: `apps/admin/src/styles/globals.css`)
- Public web registration: `apps/web/`
- Backend API: `apps/api/` (FastAPI app: `apps/api/app/`, tests: `apps/api/tests/`)
- Database migrations: `apps/api/alembic/versions/`
- Infrastructure and env examples: `infra/`
- Documentation: `docs/`, `docs/infra/`
- Repository scripts and validators: `scripts/`
- Legacy, do not extend: `supabase/`, `scripts/migration/`

## 5. Navigation And Search

- Use `git grep -n`, targeted file reads, and PowerShell
  `Get-ChildItem`/`Select-String`.
- Do not use global `rg`.
- Verify referenced paths, services and signatures against the repository
  before editing.

## 6. Git Workflow

### Before starting a PR

```powershell
git status --short
git switch main
git pull origin main
git status --short
```

- Both `git status --short` runs must be empty (section 7). Otherwise stop and
  report before switching or branching.
- If `git pull` is not permitted in the current agent environment, stop and ask
  the owner to sync `main`. Never branch from a stale `main`.

Create the branch from the updated `main`:

```powershell
git switch -c <prefix>/<focused-change-name>
```

Allowed prefixes: `feature/`, `fix/`, `docs/`.

### Staging and pushing

- The agent creates the branch, implements the PR scope, runs checks, commits
  and pushes.
- Stage only files listed in the PR expected scope, by explicit path:
  `git add <path> <path>`.
- Never use `git add -A` or `git add .`.
- Never merge PRs.
- Never push to `main`.
- Never force-push.
- Never rebase a pushed branch without a separate owner instruction.

## 7. Local Working Tree

Before branching, `git status --short` must be empty.

If it is not empty, stop and report, without resetting, deleting, stashing,
moving or working around anything. This covers modified, deleted or staged
tracked files, merge conflicts, and any untracked file.

Git-ignored local files are owner-local: `plan*.md`, `PLAN*.md`,
`pr-body*.md`, `AGENTS.override.md`, `.env`, `.env.*`, `.claude/`,
`.migration-reports/`. Never force-add them, never read or print `.env*`
contents, and never edit, move or delete them unless the owner explicitly
asks.

## 8. PR Discipline

Every PR has one primary outcome, explicit scope, expected files, checks and a
manual smoke checklist.

Do not:

- mix unrelated features;
- perform unrelated cleanup or refactoring;
- create duplicate implementations of existing functionality; improve the
  canonical implementation instead;
- silently expand scope.

Improvements discovered during work are listed in the final report as
follow-ups. They are not implemented in the current PR.

## 9. Security And Privacy

- Preserve server-side authorization and least privilege in every endpoint.
- Never trust frontend-only permissions.
- Do not read or show `prayer_activity_logs` or any private prayer activity in
  admin, public web or member-facing views.
- Do not expose private user data beyond what the endpoint needs.
- Do not log raw email, phone, names, invite codes, registration comments,
  JWTs, refresh tokens, or verification/password reset codes.
- Do not store plaintext passwords, refresh tokens or invite codes.
- Do not put `DATABASE_URL` or any backend secret into `app/`, `src/`,
  `apps/admin/`, `apps/web/`, Expo env or Vite env.
- Never commit `.env` files or real secrets. Committed env files are only
  `*.example` with placeholder values.

## 10. Database And Migrations

- Alembic in `apps/api/alembic/versions/` is the only migration mechanism.
- Never add files to `supabase/migrations/`.
- Inspect existing models and migrations before any schema change.
- New migration file name: `YYYYMMDDHHMMSS_<slug>.py`, consistent with existing
  files.
- Never edit a migration that has already been merged to `main`.
- No destructive migrations (dropping tables or columns with data, data
  deletion, irreversible type changes) without explicit owner approval in the
  PR prompt.
- Never delete production data as part of a feature PR.

## 11. API Tests And Test Database

Automated API tests run only against the disposable test database through the
Compose `test` profile (see `docs/api-tests.md`):

```powershell
docker compose -f infra/docker-compose.api.yml --profile test up -d --force-recreate api_test_postgres
docker compose -f infra/docker-compose.api.yml --profile test build api_test_backend
docker compose -f infra/docker-compose.api.yml --profile test run --rm api_test_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml --profile test run --rm api_test_backend python -m pytest -q tests
docker compose -f infra/docker-compose.api.yml --profile test stop api_test_postgres
```

- Never run tests through `api_backend`: it uses the working local database.
- Never use `docker compose down -v`.
- Never weaken or bypass the fail-closed guard in `apps/api/tests/db_safety.py`
  and `apps/api/tests/conftest.py`.

## 12. Production Boundary

- Merge is not deployment. Deployment is an owner-run operation.
- The agent does not deploy, does not connect to production hosts, and does not
  change production DNS, Nginx, TLS, env or databases.
- The agent does not run import, promote or migration scripts against any
  production or candidate database.
- Changes to `infra/` production configuration are allowed only when listed in
  the PR expected scope.

## 13. Checks Ladder

Run the checks listed in the PR prompt. Typical checks by area:

- Mobile: `npm run typecheck`, relevant `npm run validate:*` scripts.
- Web-admin: `npm run admin:typecheck`, then `npm run admin:build` once as the
  final pre-commit check.
- Public web: `npm run web:typecheck`, `npm run web:test`, `npm run web:build`.
- API: full or focused pytest through the test profile (section 11).

Rules:

- Required checks are pre-commit gates. If one fails, fix it within scope or
  stop and report. Do not commit.
- Never report a check as passed unless it was actually run and passed.
- Known issue: `apps/web/src/App.test.tsx` may hang under Vitest. If
  `web:test` hangs, stop it, report it as the known hang, and do not try to fix
  it in an unrelated PR.

## 14. Forbidden Scan

Hard pre-commit gate. After explicit-path staging, run:

```powershell
git diff --cached --name-only | Where-Object { $_ -match '^(app|src|apps/admin|apps/web)/' } | ForEach-Object { Select-String -Path $_ -Pattern 'DATABASE_URL|API_JWT_SECRET|API_TOKEN_HASH_SECRET|prayer_activity_logs|supabase' -ErrorAction SilentlyContinue }
git diff --cached --name-only | Where-Object { $_ -match '(^|/)\.env' -and $_ -notmatch '\.example$' }
```

Any output from either command blocks the commit.

Also blocks the commit:

- any staged file outside the PR expected scope;
- a real secret in any staged file, including docs and `*.example` files.

`docs/` and `infra/env/*.example` may mention env variable names as
documentation. If they appear in the diff, state why they are not a leak.

## 15. Smoke Policy

- The agent does not perform manual smoke testing: no browser UI verification,
  no Expo or iPhone runs.
- Browser and Expo/iPhone smoke are owner-only, on the pushed PR branch, before
  merge.
- The agent provides a manual smoke checklist in the PR body.

## 16. PR Output

Default mode is push-only. After push, output:

1. The complete PR body as one ready-to-paste markdown block:

   ```markdown
   ## Summary
   <primary outcome in 1-3 sentences>

   ## Changes
   - <file or area>: <what changed>

   ## Checks
   - <command>: passed | failed | not run (reason)

   ## Manual smoke checklist
   - [ ] <step and expected result>

   ## Out of scope / follow-ups
   - <item or "none">
   ```

2. The GitHub new-PR URL for the pushed branch.

`gh pr create` is optional, only when `gh` is installed and authenticated.
Merge remains owner-only after manual smoke.

## 17. AGENTS.md And CLAUDE.md

- `AGENTS.md` is canonical.
- `CLAUDE.md` imports `@AGENTS.md` and contains only Claude Code specific rules.
- Codex reads `AGENTS.md` at session start: restart Codex after it changes.
- `AGENTS.override.md` is local and private and is never committed.