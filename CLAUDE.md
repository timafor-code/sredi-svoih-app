# CLAUDE.md
@AGENTS.md

## Claude Code specific
- Do not run npm run admin:build during iterations; run it once as the final pre-commit check.
- One session or /clear per PR. Do not carry context between PRs.
- Prefer targeted reads: git grep -n, sed -n 'N,Mp', wc -l before reading files.
- Do not read whole large files or directory trees without a reason.
