---
name: ship
description: Use when the user says "ship", "ship it", "commit and push", "save and push", "push my changes", "send my work up", or otherwise asks to publish current local changes to the remote in one step. Stages relevant changes, commits with a Conventional Commit message that matches the repo's style, and pushes. If push is rejected because branches diverged, runs `git pull --rebase` and pushes again. Surfaces conflicts rather than auto-resolving.
allowed-tools: Bash
---

# Ship: commit and push, rebasing on divergence

Take whatever is in the working tree, get it onto the remote in one go. The flow is: assess state → stage → commit → push → if rejected, rebase → push again. Never resolve conflicts automatically; if the rebase hits one, stop and surface it.

## When this applies

The user wants their current changes published to the remote *now*. Typical phrasings:

- "ship it"
- "ship my changes"
- "commit and push"
- "save and push"

## When this does NOT apply

- The user said only "commit" with no mention of pushing → use the `smart-commit` skill instead.
- The user said only "push" and the working tree is clean → just `git push`; do not invent a commit.
- The branch is `main`/`master` AND the team uses pull-request workflow → confirm before pushing direct.
- The user explicitly said "force push" or "amend and push" → these are different operations; do not silently rewrite history.

## Step 1 — Gather state (parallel)

Run these in parallel via `Bash`:

```bash
git status
git diff
git diff --cached
git log --oneline -5
git rev-parse --abbrev-ref HEAD
git rev-parse --abbrev-ref @{u} 2>/dev/null   # may be empty if no upstream
```

Use the output to decide:

- Is there anything to commit? (modified files, untracked files that aren't noise)
- Is there an existing upstream tracking branch?
- What branch are we on, and what is the local-vs-remote relationship?

## Step 2 — Stage what to commit

If there's nothing to commit but the local branch is ahead of upstream → skip to Step 4 (push only).

Otherwise, stage by name. The same rules as `smart-commit`:

- **NEVER** `git add -A` or `git add .`
- Stage modified tracked files explicitly: `git add path/file1 path/file2`
- For untracked files, **skip** noise: `node_modules/`, `.venv/`, `__pycache__/`, `*.pyc`, `build/`, `dist/`, `.next/`, `target/`, `.gradle/`, `*.egg-info/`, `.DS_Store`, `Thumbs.db`, `*.log`, `coverage/`, `.cache/`, `.tmp/`, `.terraform/`, `.idea/`, `.vscode/` (unless user-maintained), `.wrangler/state/`
- **NEVER** stage files that look like secrets: `.env*`, `*credential*`, `*secret*`, `*.key`, `*.pem`. Warn the user if they explicitly request it.

## Step 3 — Commit

Read `git log --oneline -10` first to determine commit-message style. For this repo it's Conventional Commits (`feat(scope):`, `fix(skill):`, `docs(plan):`, `chore:`). Match.

Pick a `type` from the diff:

| Diff content | Type |
|---|---|
| New feature / capability | `feat` |
| Bug fix | `fix` |
| Internal refactor, no user-facing change | `refactor` |
| Docs only | `docs` |
| Tests only | `test` |
| Build, deps, gitignore, tooling | `chore` |
| Formatting / whitespace only | `style` |
| Performance | `perf` |

`scope` should be the area of the codebase touched (`skill`, `pipeline`, `ledger`, `plan`, `plugin`, etc.). Drop the scope if the change spans many areas.

Commit using HEREDOC so multi-line messages survive:

```bash
git commit -m "$(cat <<'EOF'
type(scope): one-line summary in imperative mood

- detail one (if multi-file)
- detail two

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Hooks: do **not** pass `--no-verify`. If a pre-commit hook fails, fix the underlying issue and re-stage; never amend the previous commit to bypass hook failure (the failed commit didn't happen, so amend would clobber prior work).

## Step 4 — Push

```bash
git push
```

Outcomes:

| Outcome | Action |
|---|---|
| Success | Continue to Step 6 (verify). |
| `The current branch X has no upstream branch` | Run `git push -u origin <branch>`. If branch is `main`/`master` on a repo using PRs, confirm with user first. |
| Rejected, `Updates were rejected because the remote contains work that you do not have locally` | Continue to Step 5 (rebase). |
| Auth / network error | Surface verbatim. Do NOT retry. |
| Rejected, `protected branch` / `branch protection rule` | Surface and stop — they need a PR. |

## Step 5 — Rebase, then push again

When push is rejected for divergence, do **not** force-push. Rebase:

```bash
git pull --rebase
```

Outcomes:

| Outcome | Action |
|---|---|
| Clean rebase, working tree clean | Re-run `git push`, continue to Step 6. |
| Conflict (`CONFLICT (...)`, files listed) | **STOP.** Run `git status` and surface the conflicting files to the user. Tell them: rebase is in progress; they can resolve and `git rebase --continue`, or `git rebase --abort` to back out. Do not resolve conflicts automatically. |
| Rebase rejected because uncommitted local changes | Should not happen at this point (we just committed). If it does, surface and stop. |

## Step 6 — Verify and report

```bash
git log --oneline origin/<branch>..HEAD   # should print nothing
git status                                # should be clean, no "ahead by N"
```

Report concisely:

```
Pushed <short-sha> to <remote>/<branch>.
Message: type(scope): summary

Changes:
- path/file1 — what changed
- path/file2 — what changed

[If rebase happened:]
Rebased atop N upstream commit(s) before pushing.
```

## What this skill will NEVER do

- `git push --force`, `--force-with-lease`, `+ref` syntax — unless the user explicitly typed it.
- `git reset --hard` to "fix" anything.
- `git rebase -i` or any interactive rebase.
- Auto-resolve merge conflicts.
- Skip hooks (`--no-verify`, `--no-gpg-sign`).
- Stage `.env*`, `*credential*`, `*secret*`, `*.key`, `*.pem`.
- Push to a protected branch on a PR-based repo without confirmation.
- Create empty commits.
- Amend a commit that already exists on the remote.

## Edge cases

| Situation | Behavior |
|---|---|
| Working tree clean and branch matches remote | Tell user "nothing to ship", stop. |
| Working tree clean, branch ahead of remote | Skip to Step 4 (push only). |
| Detached HEAD | Surface, stop — let user check out a branch first. |
| Unborn branch (no commits) | Surface, stop — let user make the initial commit. |
| Pre-commit hook fails | Surface the failure, fix the underlying issue, re-run from Step 2. |
| Pre-push hook fails | Surface the failure. Do not retry. |
| `git pull --rebase` says nothing to do (we were already up to date) | Push must have failed for another reason. Re-read the original push error. |
