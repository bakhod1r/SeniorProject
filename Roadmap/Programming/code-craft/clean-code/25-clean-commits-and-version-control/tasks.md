# Clean Commits & Version-Control Hygiene — Practice Tasks

> 12 hands-on git exercises, easy to hard. Every task: a messy scenario, an instruction, and a collapsible solution with the **exact commands**, the **cleaned result**, and the **reasoning**. These drills assume git ≥ 2.30. Run them in a throwaway repo (`git init scratch && cd scratch`) — most are destructive on purpose.

---

## Table of Contents

1. [Task 1 — Rewrite a "WIP" message into a proper commit (Easy)](#task-1--rewrite-a-wip-message-into-a-proper-commit-easy)
2. [Task 2 — Turn "fix stuff" into Conventional Commits (Easy)](#task-2--turn-fix-stuff-into-conventional-commits-easy)
3. [Task 3 — Write a .gitignore for Go / Java / Python (Easy)](#task-3--write-a-gitignore-for-go--java--python-easy)
4. [Task 4 — Trust version control: delete commented-out code (Easy)](#task-4--trust-version-control-delete-commented-out-code-easy)
5. [Task 5 — Squash a noisy local branch with autosquash (Medium)](#task-5--squash-a-noisy-local-branch-with-autosquash-medium)
6. [Task 6 — Recover lost work with reflog (Medium)](#task-6--recover-lost-work-with-reflog-medium)
7. [Task 7 — Undo a pushed mistake with revert, not reset (Medium)](#task-7--undo-a-pushed-mistake-with-revert-not-reset-medium)
8. [Task 8 — Split a kitchen-sink commit into atomic commits (Hard)](#task-8--split-a-kitchen-sink-commit-into-atomic-commits-hard)
9. [Task 9 — Find a regression with git bisect (Hard)](#task-9--find-a-regression-with-git-bisect-hard)
10. [Task 10 — Remove a secret committed by accident (Hard)](#task-10--remove-a-secret-committed-by-accident-hard)
11. [Task 11 — Kill merge noise: rebase a long-lived branch onto main (Hard)](#task-11--kill-merge-noise-rebase-a-long-lived-branch-onto-main-hard)
12. [Task 12 — Convert a long-lived branch workflow to trunk-based (Hard)](#task-12--convert-a-long-lived-branch-workflow-to-trunk-based-hard)

- [Self-Assessment](#self-assessment)
- [Related Topics](#related-topics)

---

## How to Use

Work top to bottom — difficulty rises and later tasks lean on muscle memory from earlier ones. For each task:

1. Read the scenario and **try it first** in a scratch repo. Reproduce the mess before you fix it; rewriting history you cannot recreate teaches nothing.
2. Decide on a plan *before* you type a destructive command. Every history rewrite is a small surgery — know your escape hatch (`git reflog`, `ORIG_HEAD`, a backup branch) before you cut.
3. Only then open the solution and compare. Matching commands matter less than matching *judgment*: did you rewrite shared history, or only local? Did you preserve the *why*?

A decision rule that governs almost every task here:

```mermaid
flowchart TD
    A[Need to change history?] --> B{Has it been<br/>pushed to a shared branch?}
    B -->|No, local only| C[Rewrite freely:<br/>rebase -i, reset, amend, squash]
    B -->|Yes, shared| D{Is anyone else<br/>building on it?}
    D -->|No / solo feature branch| E[Force-push with lease:<br/>--force-with-lease]
    D -->|Yes, collaborators| F[Never rewrite.<br/>Add a new commit:<br/>git revert]
    C --> G[History stays clean<br/>and bisectable]
    E --> G
    F --> G
```

---

## Task 1 — Rewrite a "WIP" message into a proper commit (Easy)

**Scenario:** You are about to open a pull request. Your last local commit reads:

```
$ git log --oneline -1
a1b2c3d wip
```

The diff adds retry logic to the payment HTTP client. The message tells a reviewer — and your future self — nothing.

**Instruction:** Rewrite the message of the most recent commit into a proper subject + body that captures **what** changed and, more importantly, **why**. The commit is local and unpushed.

<details><summary>Solution</summary>

Because the commit is local and unpushed, amending is safe:

```bash
git commit --amend
```

Your editor opens. A "WIP" message becomes:

```
Add exponential backoff to payment HTTP client

The payment gateway intermittently returns 503 under load, and a single
failed request was surfacing as a hard checkout error to the user.

Retry idempotent POSTs up to 3 times with backoff (200ms, 400ms, 800ms)
plus jitter, so transient gateway hiccups self-heal instead of failing
the purchase. Non-idempotent paths are unchanged.

Refs: PAY-1421
```

**Anatomy of a good message** — the rules this follows:

| Rule | Why |
|---|---|
| Subject ≤ 50 chars, imperative mood ("Add", not "Added"/"Adds") | Reads as a command the commit applies; matches git's own auto-generated messages ("Merge", "Revert"). |
| Blank line between subject and body | `git log`, GitHub, and tooling rely on it to separate the two. |
| Body wrapped at ~72 chars | `git log` indents the body by 4 spaces; 72 keeps it readable in an 80-col terminal. |
| Body explains the *why*, not the *what* | The diff already shows *what*. Only the human knows the *why* — the 503s, the user-facing symptom, the idempotency caveat. |
| Trailer (`Refs:`) links the ticket | Turns the commit into the center of a web: ticket → discussion → decision. |

**Reasoning:** The diff is self-documenting for *what*. The body's job is to record the context that disappears the moment you close the ticket: the symptom, the constraint (idempotency), and the chosen parameters. Six months from now, the only surviving record of *why* this retry budget is 3 and not 10 is this message.

</details>

---

## Task 2 — Turn "fix stuff" into Conventional Commits (Easy)

**Scenario:** A teammate's branch has three commits, all titled variations of the same non-message:

```
$ git log --oneline
e4f5a6b fix stuff
c3d4e5f more fixes
b2c3d4e fix
```

Your team has adopted **Conventional Commits** to drive automated changelogs and semantic-version bumps. These three commits would produce an empty, useless changelog.

**Instruction:** Given what each commit actually did, rewrite all three messages in Conventional Commits format. The commits are on an unpushed local branch.

- `b2c3d4e` corrects a null-pointer crash when a cart is empty.
- `c3d4e5f` adds a new `/health` endpoint.
- `e4f5a6b` changes the default page size from 20 to 50 — a behavior change API consumers must be told about.

<details><summary>Solution</summary>

Rebase interactively and `reword` each commit:

```bash
git rebase -i HEAD~3
```

In the todo list, mark all three:

```
reword b2c3d4e fix
reword c3d4e5f more fixes
reword e4f5a6b fix stuff
```

git opens an editor for each, oldest first. The rewritten messages:

```
fix(cart): prevent NPE when checking out an empty cart

CartService.total() dereferenced a null line-item list when the cart
had never had an item added. Guard with an early return of zero.
```

```
feat(ops): add /health readiness endpoint

Returns 200 with DB and cache connectivity so the load balancer can
drop unhealthy instances instead of routing traffic into them.
```

```
feat(api)!: raise default page size from 20 to 50

BREAKING CHANGE: clients relying on 20 items per page without passing
an explicit ?limit= will now receive 50. Pagination cursors are
unaffected. Pin ?limit=20 to preserve prior behavior.
```

**The Conventional Commits grammar:**

```
<type>(<optional scope>)<optional !>: <subject>

<optional body>

<optional footer / BREAKING CHANGE:>
```

| Type | Meaning | SemVer effect |
|---|---|---|
| `fix:` | A bug fix | PATCH (`x.y.Z`) |
| `feat:` | A new feature | MINOR (`x.Y.0`) |
| `feat!:` / `BREAKING CHANGE:` | Backward-incompatible change | MAJOR (`X.0.0`) |
| `docs:` `style:` `refactor:` `test:` `chore:` `perf:` `ci:` | Non-shipping or internal | No release |

**Reasoning:** The `!` and `BREAKING CHANGE:` footer on the third commit are the load-bearing part — they are what an automated release tool (`semantic-release`, `release-please`) reads to bump the major version and headline the changelog. A page-size change buried in a commit called "fix stuff" would silently break consumers on the next deploy. The format isn't bureaucracy; it makes the history machine-readable so the changelog writes itself.

</details>

---

## Task 3 — Write a .gitignore for Go / Java / Python (Easy)

**Scenario:** A polyglot service repo (a Go binary, a Java module, Python tooling) has no `.gitignore`. `git status` is drowning in build artifacts, IDE files, and a committed `.env`:

```
$ git status --short
?? bin/server
?? target/payment-1.0.jar
?? __pycache__/
?? .idea/
?? .env
?? coverage.out
```

**Instruction:** Write a `.gitignore` that excludes build output, dependency caches, IDE metadata, and secrets for all three ecosystems. Then handle the file that is *already tracked* but should not be.

<details><summary>Solution</summary>

Create `.gitignore`:

```gitignore
# --- Secrets & local config (never commit) ---
.env
.env.*
*.local

# --- Go ---
bin/
*.exe
*.test
*.out          # coverage.out, cpu.out
vendor/        # if you don't vendor; remove this line if you do

# --- Java / Maven / Gradle ---
target/
build/
*.jar
*.war
.gradle/

# --- Python ---
__pycache__/
*.py[cod]
.venv/
venv/
*.egg-info/
.pytest_cache/
.mypy_cache/

# --- IDE / editor ---
.idea/
.vscode/
*.iml
.DS_Store
```

**The catch:** `.gitignore` only ignores **untracked** files. If `.env` was already committed earlier, adding it here does nothing — git keeps tracking it. Stop tracking it without deleting your local copy:

```bash
git rm --cached .env
git commit -m "chore: stop tracking .env; add .gitignore"
```

(If `.env` was *never* committed, the `.gitignore` alone is enough.)

**Reasoning:** Three principles:

1. **Ignore output, commit input.** Build artifacts (`bin/`, `target/`, `*.jar`) are derived from source — regenerable, large, and a constant source of merge conflicts. Source and lockfiles (`go.mod`, `go.sum`, `pom.xml`, `requirements.txt`) are the input and *must* be tracked.
2. **`--cached`, not plain `rm`.** `git rm --cached` removes the file from the index (git stops tracking it) but leaves your working copy on disk. Plain `git rm` would delete your `.env` too.
3. **Secrets are a `.gitignore` line *and* a process.** Ignoring `.env` prevents *future* accidents; if a secret was ever committed, it lives in history forever until you scrub it (see [Task 10](#task-10--remove-a-secret-committed-by-accident-hard)) and rotate it.

</details>

---

## Task 4 — Trust version control: delete commented-out code (Easy)

**Scenario:** A pull request you are reviewing carries this:

```python
def price_with_tax(subtotal: Decimal, rate: Decimal) -> Decimal:
    # Old flat-rate logic, keeping just in case:
    # tax = subtotal * Decimal("0.07")
    # return subtotal + tax
    tax = subtotal * rate
    return (subtotal + tax).quantize(Decimal("0.01"))
```

The author left the old implementation commented out "in case we need to roll back."

**Instruction:** Explain why this belongs in version control, not in the source. Show the diff you would request and the command that makes the "just in case" argument moot.

<details><summary>Solution</summary>

Request the dead comment be deleted:

```python
def price_with_tax(subtotal: Decimal, rate: Decimal) -> Decimal:
    tax = subtotal * rate
    return (subtotal + tax).quantize(Decimal("0.01"))
```

The old logic is not lost — git already remembers it. To prove it and retrieve it on demand:

```bash
# Find the commit that last contained the old flat-rate line:
git log -S '0.07' --oneline -- pricing.py
# a9f0e1d feat(pricing): make tax rate configurable

# See exactly what that commit changed:
git show a9f0e1d -- pricing.py

# Recover the old version of the whole file if you ever truly need it:
git show a9f0e1d~1:pricing.py
```

**Reasoning:** Commented-out code is the worst of both worlds: it clutters the file and obscures the live logic, yet it is invisible to the compiler, the test suite, and the linter — so it rots silently as the surrounding code evolves. The "just in case" instinct is real, but git's `log -S` (the "pickaxe": find every commit that added or removed a string), `git show <commit>:<path>`, and `git blame` give you a *better* time machine than a comment ever could — one that is searchable, dated, and attributed. Deleting dead code is an act of *trust* in version control. The whole point of committing is so you can safely delete.

</details>

---

## Task 5 — Squash a noisy local branch with autosquash (Medium)

**Scenario:** Your feature branch `feat/login-throttle` has the shape every honest branch has mid-development — a clean first commit followed by a trail of corrections:

```
$ git log --oneline main..HEAD
d5e6f7a fix typo in error message
c4d5e6f address review comment: lower the limit
b3c4d5e oops forgot the test
a2b3c4d feat(auth): throttle failed login attempts
```

The bottom commit is the real change; the top three are fixups *to* it. You want to push **one** clean commit.

**Instruction:** Collapse the three fixup commits into the base commit, keeping the base commit's message, without hand-editing a rebase todo list. Use the fixup/autosquash workflow.

<details><summary>Solution</summary>

**The disciplined way** — mark fixups *as you make them*. When you fix the test, instead of writing a fresh commit, attach it to the commit it belongs to:

```bash
git add login_test.py
git commit --fixup a2b3c4d        # creates "fixup! feat(auth): throttle failed login attempts"
```

Repeat for each correction (`--fixup` for code, `--squash` if you also want to fold in a message). When ready to clean up:

```bash
git rebase -i --autosquash main
```

`--autosquash` reorders the todo list automatically — every `fixup!`/`squash!` commit is moved directly under its target and pre-marked:

```
pick   a2b3c4d feat(auth): throttle failed login attempts
fixup  b3c4d5e fixup! feat(auth): throttle failed login attempts
fixup  e7f8a9b fixup! feat(auth): throttle failed login attempts
fixup  f8a9b0c fixup! feat(auth): throttle failed login attempts
```

Save and close — no manual reordering. Result:

```
$ git log --oneline main..HEAD
9c8d7e6 feat(auth): throttle failed login attempts
```

**If you forgot to use `--fixup`** and have raw "oops" commits, do it by hand:

```bash
git rebase -i main
```

```
pick   a2b3c4d feat(auth): throttle failed login attempts
fixup  b3c4d5e oops forgot the test
fixup  c4d5e6f address review comment: lower the limit
fixup  d5e6f7a fix typo in error message
```

(`fixup` discards the fixup's message; `squash` would let you merge messages.)

To make `--autosquash` the default forever: `git config --global rebase.autosquash true`.

**Reasoning:** Local commits are a scratchpad — commit early, commit often, commit ugly. But what you *push* is a published artifact others will read, bisect, and revert. `--fixup` records your *intent* ("this belongs to commit X") at the moment you know it, and `--autosquash` cashes that intent in mechanically, so you never risk fat-fingering the todo list. The branch history becomes one atomic commit that does exactly one thing — which is precisely what makes [Task 9](#task-9--find-a-regression-with-git-bisect-hard)'s bisect usable.

</details>

---

## Task 6 — Recover lost work with reflog (Medium)

**Scenario:** You just ran a hard reset to "clean up," then realized you nuked two commits of real work:

```
$ git reset --hard HEAD~2
HEAD is now at a2b3c4d feat(auth): throttle failed login attempts
$ git log --oneline -1
a2b3c4d feat(auth): throttle failed login attempts
# ...the two commits on top are gone from the log. Panic.
```

There is no remote copy. `git log` shows no trace of them.

**Instruction:** Recover the two lost commits. Explain why they were never actually lost.

<details><summary>Solution</summary>

The reflog records every move `HEAD` has made, including the ones that vanish from `git log`:

```bash
git reflog
```

```
a2b3c4d HEAD@{0}: reset: moving to HEAD~2
9f8e7d6 HEAD@{1}: commit: feat(auth): add account lockout after N failures
6c5b4a3 HEAD@{2}: commit: feat(auth): record failed-attempt timestamps
a2b3c4d HEAD@{3}: commit: feat(auth): throttle failed login attempts
```

`9f8e7d6` is the tip you reset away from. Recover it:

```bash
# Safest: branch the lost work so you can inspect before committing to it.
git branch recovered 9f8e7d6

# Or, if you're sure, move your current branch back to it:
git reset --hard 9f8e7d6

# Or with the symbolic name, equivalently:
git reset --hard HEAD@{1}
```

Verify:

```bash
$ git log --oneline -3 recovered
9f8e7d6 feat(auth): add account lockout after N failures
6c5b4a3 feat(auth): record failed-attempt timestamps
a2b3c4d feat(auth): throttle failed login attempts
```

**Reasoning:** A commit in git is an immutable object identified by its hash; `git reset` only moves a *branch pointer*, it never deletes the commit object. The commits became *unreachable* (no branch or tag points to them), so `git log` — which walks from refs — can't see them. But the reflog kept their hashes, and unreachable objects survive until garbage collection (`gc.reflogExpireUnreachable`, default **90 days**). The lesson: `git reset --hard` and a botched rebase are recoverable for months. The reflog is your undo history — `ORIG_HEAD` similarly points at where `HEAD` was before the last "big" operation (`reset`, `merge`, `rebase`), so `git reset --hard ORIG_HEAD` undoes a bad rebase in one shot.

</details>

---

## Task 7 — Undo a pushed mistake with revert, not reset (Medium)

**Scenario:** You pushed a commit to the shared `main` that breaks production — it ships a config change pointing at the wrong database:

```
$ git log --oneline -2 origin/main
b4d2f1a chore(config): point at new analytics DB   <-- bad, already pushed & deployed
c3e1a0b feat(reports): add weekly export
```

Three teammates have already pulled `main`.

**Instruction:** Get production back to safety **without** rewriting shared history. Then contrast with the wrong fix.

<details><summary>Solution</summary>

Create a *new* commit that is the inverse of the bad one, and push it forward:

```bash
git revert b4d2f1a
```

git opens an editor with a pre-filled message; refine it:

```
Revert "chore(config): point at new analytics DB"

This points production at an unprovisioned DB, causing connection
failures on every report query. Reverting to restore service; will
re-land once the new DB is migrated and load-tested.

This reverts commit b4d2f1a.
```

```bash
git push origin main
```

Resulting history — the mistake and its undo both visible, fast-forward for everyone:

```
$ git log --oneline -3 origin/main
e5f3c2d Revert "chore(config): point at new analytics DB"
b4d2f1a chore(config): point at new analytics DB
c3e1a0b feat(reports): add weekly export
```

**The WRONG fix** — never do this on a shared branch:

```bash
git reset --hard c3e1a0b      # rewinds main locally
git push --force origin main  # rewrites published history
```

Why it's a disaster: your three teammates already have `b4d2f1a`. Force-pushing makes `origin/main` *diverge* from their local `main`. On their next `git pull` they get a tangle of conflicts, and an unlucky `git push` can resurrect `b4d2f1a` — re-breaking production. You've rewritten history out from under live collaborators.

**Reasoning:** The golden rule: **rewrite private history freely; never rewrite shared history.** `reset`/`force-push` *rewrite* — they alter commits others depend on. `revert` *adds* — it leaves every existing commit untouched and appends a new one that cancels the bad change, so every collaborator simply fast-forwards. The cost is one extra commit in the log, which is exactly right: the revert is itself a true historical fact ("we shipped this, it broke prod, we backed it out"). A clean history is an *honest* history, not a censored one. (If you must reduce blast radius on a *solo* branch nobody has pulled, prefer `--force-with-lease` over `--force` — it refuses the push if the remote moved under you.)

</details>

---

## Task 8 — Split a kitchen-sink commit into atomic commits (Hard)

**Scenario:** You committed everything at once at the end of the day. The single commit mixes three unrelated changes:

```
$ git show --stat HEAD
8a7b6c5 various changes

 src/auth.py        | 40 ++++++++++++++   # a real feature: 2FA
 src/auth.py        |  6 +++---          # also: renamed a variable (refactor)
 src/utils.py       | 80 ++++++--------   # gofmt-style reformat, no logic change
 README.md          |  4 ++++            # doc update for the feature
```

This is unreviewable and unbisectable: a reviewer can't approve the 2FA feature without also signing off on a 80-line reformat, and a future bisect that lands here can't tell *which* of the three broke a test.

**Instruction:** Split this one commit into three atomic commits — `feat` (2FA + its doc), `refactor` (the rename), `style` (the reformat) — each independently reviewable and revertable. The commit is local and unpushed.

<details><summary>Solution</summary>

Rebase interactively and `edit` the commit so the rebase pauses with its changes staged:

```bash
git rebase -i HEAD~1
```

```
edit 8a7b6c5 various changes
```

The rebase stops at that commit. Now **un-commit but keep the changes** in the working tree:

```bash
git reset HEAD~1     # soft-ish: moves the changes back to unstaged, keeps files
```

Now stage and commit each logical change separately, using `git add -p` to pick **individual hunks** even within the same file:

```bash
# Commit 1: the feature (and only the feature's lines in auth.py + the doc)
git add -p src/auth.py      # answer y/n per hunk: stage the 2FA hunks, skip the rename hunk
git add README.md
git commit -m "feat(auth): add TOTP-based two-factor authentication

Adds opt-in 2FA using time-based one-time passwords. Documented in
README under 'Security'. Refs: AUTH-88"

# Commit 2: the refactor (the variable rename, no behavior change)
git add -p src/auth.py      # stage the remaining rename hunk
git commit -m "refactor(auth): rename 'tok' to 'session_token' for clarity"

# Commit 3: the mechanical reformat, isolated so reviewers can skim it
git add src/utils.py
git commit -m "style(utils): apply formatter (no logic change)"
```

Finish the rebase:

```bash
git rebase --continue
```

Result — three atomic commits where there was one mud-ball:

```
$ git log --oneline HEAD~3..HEAD
f3a2b1c style(utils): apply formatter (no logic change)
e2d1c0b refactor(auth): rename 'tok' to 'session_token' for clarity
d1c0b9a feat(auth): add TOTP-based two-factor authentication
```

**Key tool — `git add -p`:** patch mode walks you through each *hunk* and asks whether to stage it (`y`/`n`/`s` to split a hunk further/`e` to edit by hand). It's how you separate two changes that live in the *same file*. Verify nothing was dropped with `git diff` (should be empty) after the last commit.

**Reasoning:** Atomic commits — one logical change each — pay off three ways:

- **Reviewable:** the reviewer approves the 2FA logic without wading through an 80-line reformat, and skims the `style` commit in seconds knowing it has no logic.
- **Revertable:** if the rename causes a bug, `git revert e2d1c0b` undoes *only* the rename, leaving 2FA shipped.
- **Bisectable:** when bisect ([Task 9](#task-9--find-a-regression-with-git-bisect-hard)) points at a commit, that commit does *one* thing, so you know exactly what to inspect.

A "kitchen-sink" commit forfeits all three. The mechanical separation of unrelated changes is one of the highest-leverage habits in version control.

</details>

---

## Task 9 — Find a regression with git bisect (Hard)

**Scenario:** A test that passed last release now fails. Somewhere in the last ~200 commits, someone broke `test_checkout_applies_discount`. Reading 200 diffs by hand is hopeless.

**Instruction:** Use `git bisect` to find the exact commit that introduced the regression. Show both the manual and automated forms, and explain why atomic commits make the result actionable.

<details><summary>Solution</summary>

You know a **good** commit (last release tag `v2.3.0`, where the test passed) and a **bad** commit (`HEAD`, where it fails). Bisect binary-searches between them — ~8 steps for 200 commits instead of 200.

**Manual bisect:**

```bash
git bisect start
git bisect bad                 # current HEAD is broken
git bisect good v2.3.0         # this tag was fine
```

git checks out the midpoint commit. Run the test, then tell git the verdict:

```bash
# ...build & run the failing test at the checked-out commit...
pytest tests/test_checkout.py::test_checkout_applies_discount

git bisect good   # if the test passed here
# or
git bisect bad    # if it failed here
```

Repeat — git halves the range each time. After ~8 rounds:

```
7d6e5f4a is the first bad commit
commit 7d6e5f4a
    refactor(pricing): inline discount calculation into Cart.total

git bisect reset   # ALWAYS run this to return to your original HEAD
```

**Automated bisect** — let git run the test for you. Exit code 0 = good, 1–124 (except 125) = bad:

```bash
git bisect start HEAD v2.3.0
git bisect run pytest -x tests/test_checkout.py::test_checkout_applies_discount
# git walks the whole range unattended and prints the first bad commit.
git bisect reset
```

(Use exit code **125** in a wrapper script to mark a commit *untestable* — e.g. it doesn't compile — so bisect skips it.)

How the search collapses the range:

```mermaid
flowchart LR
    G[v2.3.0<br/>good] --- M1[commit 100<br/>test?] --- B[HEAD<br/>bad]
    M1 -->|good| M2[commit 150]
    M1 -->|bad| M3[commit 50]
    M2 -->|...| F[7d6e5f4a<br/>first bad commit]
    M3 -->|...| F
```

**Reasoning — why atomic commits matter here:** bisect hands you a single commit. If that commit is atomic — `refactor(pricing): inline discount calculation` — you immediately know the regression is in the discount inlining and nowhere else; the fix is often obvious from the diff alone. If instead bisect lands on a kitchen-sink "various changes" commit (see [Task 8](#task-8--split-a-kitchen-sink-commit-into-atomic-commits-hard)) touching auth, pricing, *and* formatting, bisect has narrowed the search to a commit that is itself a haystack — you've gained almost nothing. **Bisect's resolution is only as fine as your commits are atomic.** Clean history isn't an aesthetic; it's the substrate that makes automated debugging work.

</details>

---

## Task 10 — Remove a secret committed by accident (Hard)

**Scenario:** Three commits ago, an AWS secret key was committed in `config/settings.py` and then "removed" in a later commit. But it still lives in history:

```bash
$ git log -S 'AKIA' --oneline
9c8b7a6 chore: remove hardcoded key      # "removed" it...
4d3c2b1 feat: add S3 upload              # ...but it's still in this commit forever
$ git show 4d3c2b1:config/settings.py | grep AKIA
AWS_SECRET_KEY = "AKIAIOSFODNN7EXAMPLE..."   # exposed to anyone who clones
```

The branch is already pushed to a shared remote.

**Instruction:** Scrub the secret from **all** of history and lay out the full incident response. Identify the single most important step.

<details><summary>Solution</summary>

**Step 0 — the most important step, do it FIRST: rotate the secret.** The moment a secret hits a remote, treat it as compromised. Anyone who cloned or forked has it; scrubbing history does *not* un-leak it.

```bash
# In the AWS console / CLI: deactivate and delete the exposed key, issue a new one.
aws iam delete-access-key --access-key-id AKIAIOSFODNN7EXAMPLE
# Update your secret store / .env (and make sure .env is gitignored — Task 3).
```

**Step 1 — purge it from history.** The modern tool is `git filter-repo` (the old `filter-branch` is deprecated and dangerously slow):

```bash
# Put the literal secret (or a regex) in a replacements file:
echo 'AKIAIOSFODNN7EXAMPLE==>REMOVED' > expressions.txt
git filter-repo --replace-text expressions.txt
# To strip the file entirely instead of just the value:
# git filter-repo --path config/settings.py --invert-paths
```

Or **BFG Repo-Cleaner** (faster for big repos):

```bash
bfg --replace-text expressions.txt
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

**Step 2 — force-push the rewritten history.** This *is* a shared-history rewrite, justified only because the alternative (a live leaked credential) is worse:

```bash
git push --force-with-lease --all
git push --force-with-lease --tags
```

**Step 3 — coordinate the team.** Filter-repo rewrites every commit hash, so every collaborator's clone is now incompatible. Tell them to re-clone (cleanest) rather than pull, and ensure no stale forks/PRs reintroduce the secret. On GitHub, contact support to purge cached views and check no fork retained it.

**Reasoning:** Two truths govern secret leaks:

1. **Rotation, not scrubbing, is the real fix.** History rewriting closes the door, but the secret already walked out — clones, CI logs, backups, the attacker's `git clone` 30 seconds after the push. The only thing that actually protects you is invalidating the credential. Scrubbing is cleanup, not containment.
2. **This is the one legitimate reason to rewrite shared history** — and even then `--force-with-lease` (refuses if the remote advanced unexpectedly) over raw `--force`, plus explicit team coordination. Contrast [Task 7](#task-7--undo-a-pushed-mistake-with-revert-not-reset-medium): there, `revert` was right because the data wasn't dangerous. Here the data is *itself* the threat, so it must be expunged, not merely superseded.

</details>

---

## Task 11 — Kill merge noise: rebase a long-lived branch onto main (Hard)

**Scenario:** A feature branch has been open for two weeks. To "stay current" the author repeatedly merged `main` into it. The history is a thicket of merge commits:

```
$ git log --oneline --graph feat/billing
*   a9b8c7d Merge branch 'main' into feat/billing
|\
| * 7f6e5d4 (main) fix(api): patch rate limiter
* | 6e5d4c3 feat(billing): add proration
*   5d4c3b2 Merge branch 'main' into feat/billing
|\
| * 4c3b2a1 chore: bump deps
* | 3b2a190 feat(billing): add invoice model
* 2a19087 feat(billing): scaffold billing module
```

The three real commits (`scaffold`, `invoice model`, `proration`) are buried under "Merge branch 'main'" noise. Reviewers see a tangle instead of a story.

**Instruction:** Replay the feature's three real commits cleanly on top of the current `main`, discarding the merge noise, so the branch reads as a linear sequence. The branch is pushed but **solo** — no one else builds on it.

<details><summary>Solution</summary>

Rebase the branch onto the latest `main`. Rebase replays *your* commits and drops the merge commits entirely:

```bash
git checkout feat/billing
git fetch origin
git rebase origin/main
```

If conflicts surface (they will, where `main` and your work touched the same lines), resolve each, then:

```bash
# edit the conflicted files...
git add <resolved-files>
git rebase --continue        # or: git rebase --abort to bail out safely
```

Result — linear, every commit a real change:

```
$ git log --oneline --graph feat/billing
* c4b3a29 feat(billing): add proration
* b3a2918 feat(billing): add invoice model
* a291807 feat(billing): scaffold billing module
* 7f6e5d4 (origin/main) fix(api): patch rate limiter
* 4c3b2a1 chore: bump deps
```

Because the branch was already pushed, update the remote — and because rebase rewrote your commit hashes, this requires a force-push. Use the **lease** form so you can't clobber an unexpected remote update:

```bash
git push --force-with-lease origin feat/billing
```

**Going forward, don't re-merge `main` — rebase to stay current:**

```bash
git fetch origin && git rebase origin/main   # instead of: git merge main
```

**Reasoning:** "Merge `main` in to stay current" creates a merge commit every time, polluting the branch with commits that carry no feature content and obscure the actual work. Rebasing *replays* your commits on top of the latest `main`, producing a linear history that reads as a clean narrative: scaffold → model → proration. The trade-off is honest: rebase rewrites your branch's hashes (hence `--force-with-lease`), which is **only safe because the branch is solo**. The rule from [Task 7](#task-7--undo-a-pushed-mistake-with-revert-not-reset-medium) still holds — if a teammate had branched off `feat/billing`, you would *not* rebase it out from under them. `--force-with-lease` is the seatbelt: it aborts the push if `origin/feat/billing` moved since your last fetch, catching the case where someone pushed while you were rebasing.

</details>

---

## Task 12 — Convert a long-lived branch workflow to trunk-based (Hard)

**Scenario:** A team runs long-lived feature branches: each feature gets a branch that lives for weeks, drifts far from `main`, and produces an agonizing "big bang" merge with hundreds of conflicts at the end. The new-search-ranking branch is now three weeks old, 60 commits deep, and conflicts with half the codebase.

**Instruction:** Lay out how to convert this team to **trunk-based development** with short-lived branches and feature flags — and how to land the giant in-flight branch without another big-bang merge.

<details><summary>Solution</summary>

**The target workflow:** everyone integrates into `main` (the trunk) at least daily via tiny, short-lived branches (hours to ~2 days), each merged through a fast PR. Unfinished work hides behind a **feature flag**, not behind an unmerged branch.

```mermaid
flowchart TD
    subgraph LL["Long-lived branches (the problem)"]
        M1[main] --> F1[feature branch<br/>3 weeks, 60 commits]
        F1 -.big-bang merge<br/>200 conflicts.-> M2[main]
    end
    subgraph TB["Trunk-based (the target)"]
        T[main / trunk] --> B1[branch · hours]
        T --> B2[branch · hours]
        T --> B3[branch · hours]
        B1 -->|small PR, same day| T
        B2 -->|small PR, same day| T
        B3 -->|small PR, same day| T
        T --> FF[Incomplete work<br/>behind feature flag]
    end
```

**Migrating the team:**

1. **Introduce a feature-flag mechanism** so incomplete code can live on `main` switched off:
   ```python
   if flags.enabled("new_search_ranking"):
       return rank_v2(query)
   return rank_v1(query)
   ```
2. **Merge to `main` daily.** A branch that lives less than a day barely drifts, so conflicts shrink from "hundreds at the end" to "a handful, continuously."
3. **Branch protection on `main`:** require PR review + green CI before merge. The trunk must always be releasable, because everyone builds on it every day.
4. **Decouple deploy from release.** Code ships to production *dark* (flag off) and is *released* by flipping the flag — so an unfinished feature on `main` is invisible to users.

**Landing the 60-commit giant without a big-bang merge** — slice it backwards into trunk:

1. Wrap the whole feature's entry point behind `flags.enabled("new_search_ranking")` (default **off**).
2. Carve the branch into a series of small, independently-mergeable PRs — schema first, then the ranking module, then the API wiring — each safe to merge because the flag keeps it inert in production. Use `git rebase -i` and `git add -p` ([Task 8](#task-8--split-a-kitchen-sink-commit-into-atomic-commits-hard)) to reshape 60 tangled commits into a handful of clean, atomic, reviewable slices.
3. Merge the slices into `main` over a few days. Production stays unaffected (flag off) while the code integrates continuously.
4. When complete and tested, flip the flag on — a one-line change, instantly revertable, with zero merge conflicts.

**Reasoning:** Long-lived branches defer integration pain — and deferred pain compounds. Three weeks of divergence is three weeks of conflicts saved up for one catastrophic merge, plus a feature that was never exercised against the real, moving `main`. Trunk-based development inverts this: integrate constantly so each merge is trivial, and use **feature flags** to separate *merging code* (continuous, safe) from *releasing behavior* (a deliberate flip). The branch stops being the unit of "unfinished" — the flag is. This is the version-control hygiene that scales to a team: a trunk that is always green, always releasable, and never harbors a three-week-old time bomb.

</details>

---

## Self-Assessment

Score yourself honestly. Aim for "could do it under pressure, on a shared repo, without breaking a teammate."

- [ ] **Task 1–2:** I can rewrite a vague message into a subject + body that explains *why*, and I know the Conventional Commits types and what each bumps in SemVer.
- [ ] **Task 3:** I can write a multi-language `.gitignore`, and I know why `git rm --cached` (not plain `rm`) un-tracks an already-committed file.
- [ ] **Task 4:** I delete commented-out code on sight, because I trust `git log -S` and `git show <commit>:<path>` to retrieve it.
- [ ] **Task 5:** I commit ugly locally but push clean — `git commit --fixup` + `git rebase -i --autosquash`.
- [ ] **Task 6:** `git reset --hard` doesn't scare me, because `git reflog` and `ORIG_HEAD` are my undo history.
- [ ] **Task 7:** I know the golden rule cold: rewrite private history freely, never rewrite shared history — `revert` (adds), not `reset` (rewrites), on anything pushed.
- [ ] **Task 8:** I can split a mixed commit with `git rebase -i` (`edit`) + `git reset` + `git add -p`, one logical change per commit.
- [ ] **Task 9:** I can find a regression with `git bisect run`, and I can articulate *why* atomic commits make its output actionable.
- [ ] **Task 10:** On a leaked secret I **rotate first**, then `git filter-repo`/BFG, then force-push and coordinate a re-clone.
- [ ] **Task 11:** I can rebase a noisy branch onto `main` and push it safely with `--force-with-lease` — and I know why that's only OK on a solo branch.
- [ ] **Task 12:** I can argue for trunk-based development with feature flags and explain how to land a giant branch in slices without a big-bang merge.

If three or more are unchecked, re-do those tasks in a scratch repo before your next real PR.

---

## Related Topics

- [Chapter README](../README.md) — the positive rules behind these drills.
- [junior.md](junior.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md) — the rest of this topic's file set.
- [Code Reviews](../17-code-reviews/README.md) — the etiquette of *reviewing* the clean history these tasks produce.
- [Refactoring](../../refactoring/README.md) — the discipline of behavior-preserving change that atomic commits (Task 8) make safely reviewable.

---

> **Next:** practice on a real repo. The fastest way to internalize this is to take your *own* messiest branch and run Tasks 5, 8, and 11 on a copy of it.
