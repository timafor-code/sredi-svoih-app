# Codex Known Untracked Files Policy

We are working in the `sredi-svoih-app` project.

This policy amends `docs/admin-members-add-user-pr-plan.md` and applies to all Codex prompts in the admin members add-user PR series.

## Problem

Local development can contain persistent untracked scratch/generated files such as:

```text
?? PLAN-seating-registrations-v15.md
?? pr-body.md
?? supabase/functions/.gitkeep
?? "supabase/snippets/Untitled query 971.sql"
?? 500
```

These files should not block Codex from creating a new feature branch.

## Rule

After syncing `main`, Codex must run:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git status --short
```

Codex must classify the output before deciding whether to stop.

Codex must continue and create the feature branch if the only dirty entries are tolerated pre-existing untracked files listed below.

Codex must not stage, edit, delete, move, or commit these tolerated files.

Codex must stop only if there are:

- modified tracked files;
- deleted tracked files;
- staged files;
- merge conflicts;
- unexpected untracked files outside the tolerated list and outside the current PR expected scope.

## Tolerated pre-existing untracked files

```text
PLAN-seating-registrations-v15.md
pr-body.md
500
supabase/functions/.gitkeep
supabase/functions/
supabase/snippets/Untitled query 971.sql
supabase/snippets/
```

## Mandatory branch creation behavior

Use this startup block in Codex prompts:

```text
Before starting, run:
cd F:\2026\SS-App\code\sredi-svoih-app; git switch main; git pull origin main; git status --short

If git status only shows tolerated pre-existing untracked files, continue and create the feature branch. Do not stage, edit, delete, move, or commit those tolerated files. Stop only for modified/deleted/staged tracked files, merge conflicts, or unexpected untracked files outside the tolerated list and outside this PR's expected scope.

cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/<focused-pr-branch-name>
```

## Mandatory commit behavior

At the end of a Codex run:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git status --short
```

Codex must stage only the expected files for the current PR.

Tolerated pre-existing untracked files may remain visible in `git status --short`. They are not a reason to stop after the feature branch has already been created.

## Example for current state

This status is allowed and must not block branch creation:

```text
?? PLAN-seating-registrations-v15.md
?? pr-body.md
?? supabase/functions/.gitkeep
?? "supabase/snippets/Untitled query 971.sql"
```

Codex must continue with:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app; git switch -c feature/admin-members-rabbi-role-alignment
```

and must not stage any of those tolerated files.
