# AGENTS.md

Canonical standing rules for Codex-compatible agents in this repository.

Source of truth for the backend migration roadmap: repository-root `plan.md`,
version `2026-07-06 v2.7`. The local plan file is ignored by Git and must not be
staged unless a future PR explicitly lists it in expected scope.

## Agent Execution Policy

- Primary agent: Codex.
- Fallback agent: Claude Code.
- Prompts are written in English regardless of the executing tool.
- One canonical prompt per PR should work for both agents without rewriting.
- "The agent" means whichever tool is executing the current PR.

## Existing Project Restrictions

- Do not touch `auth.users`.
- Do not use Supabase Admin API.
- Do not use a service-role key.
- Do not add `DATABASE_URL` to `apps/admin`.
- Do not commit `.env.local`.
- Do not run `npx supabase db reset` unless the project owner explicitly asks
  for it in a separate command.
- Do not use global `rg`. Use `git grep`, PowerShell
  `Get-ChildItem`/`Select-String`, or targeted file reads.
- Do not touch untracked `supabase/functions/`, `supabase/snippets/`, or `500`
  unless explicitly in expected scope.
- Do not read or show `prayer_activity_logs` in admin.
- Do not stage files outside the current PR's expected scope.

## Migration Script Carve-Out

The restrictions above apply to all app/admin/mobile code and all normal PR
work.

The only explicit exception is for controlled owner-run migration utilities:

- Owner-run scripts under `scripts/migration/**` may read Supabase Auth metadata
  when required for inventory/export.
- This includes `auth.users`/`auth.identities` access through direct database
  access or a service-role key stored only in the owner's local environment.
- The key must never be committed.
- The key must never be placed in `apps/admin`, mobile, Expo env, Vite env, docs
  examples with real values, or frontend code.
- The agent may create or review these scripts in future PRs but must not run
  them against production unless the project owner gives a separate explicit
  command.
- Scripts must output counts, mappings, and validation reports only.
- No raw auth dumps, plaintext tokens, OAuth provider payloads, or password data
  may be committed.

For forbidden scans, hits in `scripts/migration/**` that mention service-role or
Admin Auth access are not automatic failures. They require manual review against
this carve-out. The same strings in `apps/admin/**`, `app/**`, `src/**`, or
committed env files remain a hard failure.

## New Backend Restrictions

- Do not expose PostgreSQL directly to mobile/admin.
- Do not put `DATABASE_URL` into mobile or `apps/admin`.
- Do not log raw email, phone, names, invite codes, registration comments, JWTs,
  refresh tokens, or password reset codes.
- Do not store plaintext passwords.
- Do not store plaintext refresh tokens.
- Do not store plaintext invite codes.
- Do not implement payment gateway during backend migration.
- Do not implement Apple Sign-In during the first backend migration wave.
- Do not mark email verification or password reset as complete without a
  working delivery path.
- Do not enable API auth for production until OAuth-only users have an explicit
  migration path.

## Git Workflow

- The agent creates the feature branch, implements the PR scope, runs checks,
  commits, and pushes.
- Stage only files listed in the PR expected scope, by explicit path.
- Use `git add <path> <path>`.
- Never use `git add -A`.
- Never use `git add .`.
- Never merge PRs.
- Never push to `main`.
- Never force-push.
- Never rebase a pushed branch without separate owner instruction.
- If modified tracked files, deleted tracked files, staged files, merge
  conflicts, or unexpected untracked files outside the tolerated list and
  outside the current PR expected scope are present before branching, stop and
  report them. Do not hide, delete, stage, or work around unrelated local
  files.
- Tolerated pre-existing untracked files listed in
  "Known Local Untracked Files" do not block branch creation if they are the
  only dirty entries in `git status --short`.
- Known local files that must never be staged unless explicitly in expected
  scope include `500`, `supabase/functions/`, `supabase/snippets/`,
  `.env.local`, `AGENTS.override.md`, and local plan files.

## Known Local Untracked Files

The following pre-existing local untracked files and directories are tolerated:

- `500`
- `supabase/functions/.gitkeep`
- `supabase/functions/`
- `supabase/snippets/Untitled query 971.sql`
- `supabase/snippets/`
- `PLAN-seating-registrations-v15.md`
- `pr-body.md`

If these paths are the only dirty entries in `git status --short`, they do not
block branch creation.

The agent must leave these paths untouched:

- do not stage them;
- do not edit them;
- do not delete them;
- do not move them;
- do not commit them.

The agent must stop only for:

- modified tracked files;
- deleted tracked files;
- staged files;
- merge conflicts;
- unexpected untracked files outside the tolerated list and outside the current
  PR expected scope.

## Smoke Policy

- Smoke tests must not be run by the agent.
- Browser smoke and Expo/iPhone smoke are owner-only on the pushed PR branch
  before merge.
- The agent should only provide a manual smoke checklist.

## Forbidden Scan Policy

Forbidden scan is a hard pre-commit gate for staged files.

Expected/reviewable hits are allowed only in these paths:

- `docs/**` may mention `auth.users`, `DATABASE_URL`, service-role access, or
  migration targets as documentation.
- `infra/env/*.example` may include `DATABASE_URL` as backend-only example
  configuration.
- `scripts/**` may include `DATABASE_URL` only for owner/dev migration or import
  tools, never for `apps/admin` or mobile.
- `scripts/migration/**` may mention service-role/Admin Auth access only under
  the owner-run migration-script carve-out.

Hard failures that block commit:

- Any forbidden hit in staged files outside the allowed paths above.
- Secrets or backend-only access strings in `apps/admin/**`, `app/**`,
  `src/**`, or committed env files.
- `DATABASE_URL` in `apps/admin` or mobile code.
- `service_role`, `SUPABASE_SERVICE`, or `sb_secret` in client code.
- New production code touching `auth.users` directly.
- New admin UI reading `prayer_activity_logs`.
- Any staged file outside the PR's expected scope.

Before commit, after explicit-path staging, run the staged-file scan:

```powershell
git diff --cached --name-only | ForEach-Object { Select-String -Path $_ -Pattern "service_role|sb_secret|SUPABASE_SERVICE|DATABASE_URL|auth.users|prayer_activity_logs" -SimpleMatch:$false -ErrorAction SilentlyContinue }
```

If scan reports expected docs/example/script hits, explain the file, reason, and
why it is not a client/runtime secret leak.

## Repository Map

- Mobile app: `app/`
- Mobile shared code/services: `src/`
- Canonical Supabase client: `src/services/supabaseClient.ts`
- Web-admin app: `apps/admin/`
- Admin stylesheet: `apps/admin/src/styles/globals.css`
- Supabase migrations: `supabase/migrations/`
- Future Python backend: `apps/api/`
- Migration scripts: `scripts/migration/`
- Local plan file: repository root, ignored by Git.

## Navigation And Search

- Use `git grep`, targeted file reads, and PowerShell
  `Get-ChildItem`/`Select-String`.
- Do not use global `rg`.
- Verify referenced paths/services/signatures against the actual repository
  before editing or emitting prompts.

## Checks Ladder

- Official PR checks are mandatory pre-commit gates.
- If any required check fails, do not commit. Fix the issue within PR scope or
  stop and report the failure.
- Check results must not be described as passed unless they were actually run
  and passed.
- Claude Code should not run `npm run admin:build` during iterations; it runs it
  once as the final pre-commit check.

## PR Link Policy

- Default mode B is push-only. After push, the agent outputs the complete PR
  body using the root `plan.md` section 9 template as one ready-to-paste
  markdown block, then outputs the GitHub new-PR URL.
- `gh pr create` is optional only when `gh` is installed and authenticated.
- Merge remains owner-only after manual smoke.

## AGENTS.md And CLAUDE.md Conventions

- `AGENTS.md` is canonical.
- `CLAUDE.md` imports `@AGENTS.md`.
- `CLAUDE.md` must not duplicate all standing rules.
- Codex reads `AGENTS.md` at session start, so restart Codex after changing
  `AGENTS.md`.
- `AGENTS.override.md` is local/private and must never be committed.

## Prompt Authoring Policy

- Prompts may be authored by ChatGPT, Claude, or manually.
- Prompt authors must use the root `plan.md` version.
- Prompt authors must verify referenced paths, services, signatures, and files
  against the actual repository before emitting prompts.
- Do not reference plan sections by number unless the root plan file exists and
  the version header matches the intended version.

## Main Branch Protection Recommendation

The repository owner should configure `main` to:

- require a pull request before merging;
- block direct pushes to `main`;
- keep merge owner-controlled.
