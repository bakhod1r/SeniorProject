# Git & GitHub Roadmap — Universal Template

> This template guides AI content generation for Git & GitHub topics.
> Replace {{TOPIC_NAME}} with the specific topic (e.g., "git rebase", "GitHub Actions").
> Keep all > blockquote instructions — they guide content authors.

## Overview

> Provide a 2–3 sentence summary of what this topic covers and why it matters for developers working with Git and GitHub.

This template covers the full spectrum of Git and GitHub knowledge — from daily developer workflows to internal object model internals. It is structured into nine progressive documents, each targeting a specific experience level or use case.

| **Files per topic** | 9 files: `junior.md`, `middle.md`, `senior.md`, `professional.md`, `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md`, `specification.md` |
| **Language** | All content must be generated in **English** |
| **Table of Contents** | **REQUIRED** on the four level files (`junior.md`, `middle.md`, `senior.md`, `professional.md`) as a numbered TOC linking each section; **OPTIONAL** on practice files (`tasks.md`, `find-bug.md`, `optimize.md`) |
| **Depth / Length** | Each level file (`junior.md`, `middle.md`, `senior.md`, `professional.md`) must be substantial — target at least ~520 lines of genuine content (no filler), with multiple worked code examples, at least one Mermaid diagram, and at least one comparison table where the topic allows |
| **Level Handoff** | Every level file ends with a **`Next step:`** line linking to the next level in the progression (junior → middle → senior → professional → …) |

### Topic Structure

```
XX-topic-name/
├── junior.md          ← Daily Git workflow, basic commands, GitHub UI
├── middle.md          ← Branching strategies, rebasing, GitHub Actions, PRs
├── senior.md          ← Repository design, automation, inner-source, security
├── professional.md    ← Mastery / Leadership — Git internals, object model
├── interview.md       ← Interview prep across all levels
├── tasks.md           ← Hands-on practice tasks
├── find-bug.md        ← Find and fix bugs in code (10+ exercises)
├── optimize.md        ← Optimize slow/inefficient code (10+ exercises)
└── specification.md   ← Official spec / documentation deep-dive
```

---

---
# TEMPLATE 1 — junior.md
# {{TOPIC_NAME}} — Git Basics for Beginners
---

> Target audience: developers who are new to version control or switching from another system.
> Goal: build confidence using Git daily without fear.

## Introduction

> Explain what {{TOPIC_NAME}} is in plain language. Avoid jargon. Answer: "What is this and why do I need it?"

Git is a distributed version control system that tracks changes in files over time. GitHub is a cloud platform that hosts Git repositories and enables collaboration. Together they let you save progress, collaborate with teammates, and recover from mistakes.

## Prerequisites

> List what the reader must already know before starting this document.

- A terminal / command-line interface installed
- Basic file system knowledge (folders, files, paths)
- A GitHub account (free tier is sufficient)
- Git installed (`git --version` should return output)

## Glossary

> Define every term the first time it appears. Keep definitions to one sentence.

| Term | Definition |
|------|-----------|
| **Repository (repo)** | A folder tracked by Git containing your project files and their full history. |
| **Commit** | A snapshot of the repository at a specific point in time, identified by a SHA hash. |
| **Branch** | A lightweight, movable pointer to a commit that lets you work in isolation. |
| **Remote** | A version of the repository hosted on another machine or service such as GitHub. |
| **HEAD** | A special pointer that indicates the commit you are currently working on. |
| **Staging area (index)** | A preparation zone where you assemble changes before they become a commit. |
| **Working tree** | The actual files on disk that you edit directly. |
| **Merge** | Combining the history of two branches into one. |
| **Pull Request (PR)** | A GitHub feature that proposes merging one branch into another and requests review. |
| **Clone** | Copying a remote repository to your local machine. |

## Core Concepts

> Explain the daily Git workflow using a diagram. Keep it visual and concrete.

### The Three-Stage Workflow

```text
Working Tree  -->  Staging Area (Index)  -->  Local Repository  -->  Remote (GitHub)
   (edit)           (git add)                  (git commit)          (git push)
```

```mermaid
graph LR
    A[Edit files<br/>Working Tree] -->|git add| B[Staging Area<br/>Index]
    B -->|git commit| C[Local Repo<br/>.git/]
    C -->|git push| D[Remote<br/>GitHub]
    D -->|git pull| A
    D -->|git clone| C
```

### How Branches Work

```text
main:    A---B---C
                  \
feature:           D---E
```

Each letter is a commit. The feature branch diverges from `main` at commit C and adds its own commits D and E without affecting `main`.

## Real-World Analogies

> Use everyday analogies to make abstract concepts concrete.

**Save points in a video game** — A commit is like saving your game. You can always reload a previous save if something goes wrong. Branches are like save slots: one for your main run, one where you experiment with a different build.

**Google Docs revision history** — Every commit is an entry in the revision history. `git log` shows you who changed what and when, just like "See version history" in Docs.

**Parallel universes** — When you create a branch, you fork into a parallel timeline. Changes in that timeline do not affect the main timeline until you deliberately merge them back.

## Code Examples

> Provide copy-paste-ready commands with brief comments. Test every command before including it.

### Start a new project

```bash
# Initialize a new Git repository in the current folder
git init

# Or clone an existing repository from GitHub
git clone https://github.com/owner/repo.git
cd repo
```

### The daily commit cycle

```bash
# Check what has changed since the last commit
git status

# Stage a specific file
git add src/app.js

# Stage all changed files in the current directory
git add .

# Create a commit with a descriptive message
git commit -m "feat: add login form validation"

# Push the commit to the remote branch
git push origin main
```

### Working with branches

```bash
# List all local branches
git branch

# Create and switch to a new branch in one step
git checkout -b feature/user-auth

# Push the new branch to GitHub for the first time
git push -u origin feature/user-auth

# Switch back to main
git checkout main

# Merge the feature branch into main
git merge feature/user-auth
```

### Staying up to date

```bash
# Fetch remote changes and merge them into the current branch
git pull origin main

# Fetch without merging (safe inspection)
git fetch origin
git log origin/main..HEAD
```

### Inspecting history

```bash
# Show commit log (newest first)
git log

# Compact one-line format
git log --oneline

# Show the last 5 commits as a graph
git log --oneline --graph --all -5
```

## Error Recovery and Repository Repair

> Cover the errors beginners hit most often. Show the exact error message, explain what caused it, and give the fix.

### Merge Conflict

```text
CONFLICT (content): Merge conflict in src/app.js
Automatic merge failed; fix conflicts and then commit the result.
```

**Cause:** Two branches edited the same lines of the same file.

**Fix:**
```bash
# Open the conflicting file — Git marks conflicts like this:
# <<<<<<< HEAD
# your changes
# =======
# their changes
# >>>>>>> feature/login

# Edit the file to keep the correct version, then:
git add src/app.js
git commit -m "resolve merge conflict in app.js"
```

### Detached HEAD

```text
HEAD detached at a3f2c1b
```

**Cause:** You checked out a commit SHA instead of a branch name.

**Fix:**
```bash
# Create a new branch here to save your work
git checkout -b rescue/detached-work

# Or simply go back to main
git checkout main
```

### Rejected Push

```text
! [rejected]  main -> main (non-fast-forward)
hint: Updates were rejected because the remote contains work that you do not have locally.
```

**Cause:** Someone else pushed to the same branch since your last pull.

**Fix:**
```bash
# Pull first, then push again
git pull origin main
git push origin main
```

## Common Mistakes

> List mistakes beginners make repeatedly, with a one-line prevention tip.

| Mistake | Prevention |
|---------|-----------|
| Committing without staging (`git commit` with nothing added) | Always run `git status` before committing. |
| Force-pushing to `main` and deleting teammates' work | Never use `git push --force` on shared branches. |
| Committing secrets (passwords, API keys) | Add `.env` to `.gitignore` before the first commit. |
| Huge commit containing everything | Commit early and often; one logical change per commit. |
| Writing unhelpful commit messages ("fix stuff") | Follow Conventional Commits: `type: short description`. |
| Working directly on `main` | Always create a feature branch for new work. |

## Cheat Sheet

> A quick-reference table of essential commands.

| Command | What it does |
|---------|-------------|
| `git init` | Initialize a new repo |
| `git clone <url>` | Copy a remote repo locally |
| `git status` | Show changed files |
| `git add <file>` | Stage a file |
| `git add .` | Stage all changes |
| `git commit -m "msg"` | Create a commit |
| `git push origin <branch>` | Push to remote |
| `git pull origin <branch>` | Fetch and merge from remote |
| `git branch <name>` | Create a branch |
| `git checkout <branch>` | Switch to a branch |
| `git checkout -b <branch>` | Create and switch |
| `git merge <branch>` | Merge a branch into current |
| `git log --oneline` | Show compact history |
| `git diff` | Show unstaged changes |
| `git stash` | Temporarily save uncommitted changes |
| `git stash pop` | Restore stashed changes |

## Summary

> Summarize the key takeaways in 3–5 bullet points.

- Git tracks every change to your files as a series of commits, giving you a complete, recoverable history.
- The three-stage workflow (working tree → staging area → repository) gives you precise control over what goes into each commit.
- Branches let you experiment in isolation; pull requests let you propose and review changes before merging.
- Most beginner errors (conflicts, rejected pushes) have safe, predictable fixes — no work is truly lost.
- Build the habit: `git status` before every `git add`, and `git pull` before every `git push`.

## Further Reading

> Link to official docs and high-quality external resources. No paywalled content.

- [Pro Git Book (free)](https://git-scm.com/book/en/v2) — the definitive reference
- [GitHub Docs — Getting Started](https://docs.github.com/en/get-started)
- [Atlassian Git Tutorials](https://www.atlassian.com/git/tutorials)
- [Oh Shit, Git!?!](https://ohshitgit.com/) — plain-language fixes for common mistakes
- [Conventional Commits Specification](https://www.conventionalcommits.org/)

---

---
# TEMPLATE 2 — middle.md
# {{TOPIC_NAME}} — Team Workflows and Git Internals for Mid-Level Engineers
---

> Target audience: developers with 1–3 years of Git experience who work on teams and want to understand the "why" behind Git's design.
> Goal: move from "using Git" to "understanding Git decisions."

## Introduction

> Explain what deeper Git knowledge unlocks. Answer: "Why does Git work this way, and how does understanding it help me in a team?"

Git's design choices — distributed architecture, content-addressable storage, cheap branching — are not accidental. Understanding them helps you choose the right workflow, debug complex situations confidently, and make better decisions about branching strategies and release processes.

## Evolution of Version Control

> Give historical context so readers understand why Git was designed the way it was.

### Centralized VCS (CVCS) — SVN, CVS, Perforce

```text
Developer A ─┐
Developer B ─┼──> Central Server (single source of truth)
Developer C ─┘
```

- Single server is a single point of failure
- Network required for most operations (commit, history, diff)
- Branching is expensive (full copy of files)

### Distributed VCS (DVCS) — Git, Mercurial

```text
Developer A (full repo) <──> Remote (GitHub) <──> Developer B (full repo)
```

- Every clone is a full backup
- Most operations are local (commit, log, branch, diff)
- Branching is a pointer operation — O(1) cost regardless of repo size

Git was created by Linus Torvalds in 2005 for Linux kernel development after the free license for BitKeeper was revoked. Design goals: speed, data integrity, non-linear development support.

## Core Concepts

> Cover the concepts that separate mid-level engineers from beginners.

### Rebase vs. Merge

```text
BEFORE:
main:    A---B---C
                  \
feature:           D---E

MERGE result (preserves history, creates a merge commit):
main:    A---B---C---M
                  \ /
feature:           D---E

REBASE result (rewrites history, linear):
main:    A---B---C---D'---E'
```

- **Merge** preserves context — you can see exactly when a branch diverged and rejoined.
- **Rebase** creates a cleaner linear history but rewrites commit SHAs (never rebase public branches).

### Branching Strategies

```mermaid
gitGraph
    commit id: "A"
    commit id: "B"
    branch feature/login
    commit id: "C"
    commit id: "D"
    checkout main
    merge feature/login id: "M"
    commit id: "E"
```

| Strategy | Best For | Key Rule |
|----------|----------|----------|
| **GitFlow** | Scheduled releases, versioned software | `develop` + `release` + `hotfix` branches |
| **GitHub Flow** | Continuous deployment | Short-lived feature branches merged to `main` |
| **Trunk-Based Development** | High-velocity teams with feature flags | Everyone commits to `main` (or very short branches) |

## Comparison with Alternative VCS and Platforms

> Compare Git/GitHub with alternatives to sharpen the mental model.

| Feature | Git + GitHub | SVN + SVN server | Mercurial (hg) | Perforce |
|---------|-------------|-----------------|----------------|---------|
| Architecture | Distributed | Centralized | Distributed | Centralized |
| Branching cost | O(1) pointer | O(n) file copy | O(1) | Depends |
| Merge algorithm | 3-way merge | 3-way merge | 3-way merge | 3-way merge |
| Binary file support | Poor (use LFS) | Good | Poor (use LFS) | Excellent |
| Industry adoption | Dominant | Legacy | Niche | Game dev / enterprise |
| Free hosting | GitHub, GitLab | Self-hosted | Bitbucket | Self-hosted |

## Diagnosing Repository Issues

> Go beyond `git status`. Show how to find what went wrong and when.

### git bisect — Binary Search for Bugs

```bash
# Start a bisect session
git bisect start

# Mark the current commit as bad
git bisect bad

# Mark a known-good commit
git bisect good v1.0.0

# Git checks out a middle commit — test and mark
git bisect good    # or: git bisect bad

# Repeat until Git identifies the first bad commit
# When done:
git bisect reset
```

### git blame — Find Who Changed a Line

```bash
# Show who last changed each line of a file
git blame src/auth.js

# Ignore whitespace changes
git blame -w src/auth.js

# Show the commit that introduced a specific line range
git blame -L 42,60 src/auth.js
```

### git log -S — Pickaxe Search

```bash
# Find commits that added or removed a specific string
git log -S "password_hash" --oneline

# Find commits that changed a regex pattern
git log -G "api_key\s*=" --oneline

# Show patch (diff) alongside results
git log -S "secret" -p
```

## Anti-Patterns

> Describe Git practices that seem reasonable but cause real pain on teams.

### Merge Commits on Feature Branches

**Problem:** Merging `main` into your feature branch repeatedly creates a noisy history full of merge commits that are hard to read or bisect.

**Fix:** Use `git rebase origin/main` to keep your feature branch up to date instead of merging.

```bash
# Instead of this:
git merge main

# Do this:
git fetch origin
git rebase origin/main
```

### Long-Lived Feature Branches

**Problem:** A feature branch open for 3+ weeks accumulates massive drift from `main`, leading to painful merge conflicts and delayed integration bugs.

**Fix:** Break large features into smaller, independently mergeable slices. Use feature flags to hide incomplete features from users.

### Committing Directly to `main`

**Problem:** No review, no CI check before code reaches production.

**Fix:** Enable branch protection rules on GitHub: require pull request reviews and status checks before merging.

## Alternative Approaches

> Describe when to pick each workflow and how they differ in practice.

### GitFlow

```text
main ────────────────────────────────── (production releases)
         \                    /
release   ──────────────────
         \                  \
develop  ─────────────────────────────
           \         \
feature/A   ──────    ──── (merged back to develop)
```

Best for: libraries, mobile apps with App Store review cycles, teams that release on a schedule.
Cost: complex branch management, slower integration, high merge overhead.

### GitHub Flow

```text
main ─── PR1 ─── PR2 ─── PR3 ─── (deploy on every merge)
```

Best for: web services with continuous deployment.
Cost: requires robust CI/CD and feature flags for incomplete work.

### Trunk-Based Development

```text
main ─── commit ─── commit ─── commit ─── (everyone works here)
```

Best for: experienced teams with high test coverage and feature flags.
Cost: requires discipline; broken commits affect everyone immediately.

## Interview Insights

> Common interview questions at this level and concise answers.

**Q: What is the difference between `git merge` and `git rebase`?**
A: Both integrate changes from one branch into another. Merge preserves the full branching history and creates a merge commit. Rebase rewrites the feature branch commits on top of the target branch, producing a linear history. Rebase should never be used on public shared branches because it rewrites SHA hashes.

**Q: When would you use `git cherry-pick`?**
A: When you need to apply a specific commit from one branch to another without merging the entire branch. Common for backporting a bug fix from `main` to a release branch.

**Q: How do you undo a commit that has been pushed?**
A: Use `git revert <sha>` to create a new commit that undoes the changes — this is safe for public branches. Avoid `git reset --hard` followed by force push on shared branches.

**Q: Explain GitFlow vs trunk-based development.**
A: GitFlow uses multiple long-lived branches (`main`, `develop`, `release`, `hotfix`) and suits scheduled releases. Trunk-based development keeps a single `main` branch with everyone committing frequently, relying on feature flags and CI for safety. Trunk-based is preferred for high-frequency web deployments.

## Summary

- Git's distributed model means every clone is a full backup and most operations are local.
- Rebase creates clean linear history but must never be used on shared/public branches.
- Choose your branching strategy based on release cadence and team size, not habit.
- `git bisect`, `git blame`, and `git log -S` are your primary diagnostic tools when something breaks.
- Long-lived branches and direct commits to `main` are the most common team-level anti-patterns.

## Further Reading

- [Pro Git — Branching chapter](https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell)
- [Atlassian — Comparing Workflows](https://www.atlassian.com/git/tutorials/comparing-workflows)
- [Trunk Based Development](https://trunkbaseddevelopment.com/)
- [GitHub Flow Guide](https://docs.github.com/en/get-started/quickstart/github-flow)
- [GitFlow original post by Vincent Driessen](https://nvie.com/posts/a-successful-git-branching-model/)

---

---
# TEMPLATE 3 — senior.md
# {{TOPIC_NAME}} — Designing Git Workflows for Large Teams
---

> Target audience: senior engineers and tech leads responsible for Git strategy, CI/CD architecture, and repository governance.
> Goal: provide the frameworks and trade-offs needed to make defensible architectural decisions.

## Introduction

> Answer: "What decisions does a senior engineer make about Git that a mid-level engineer does not?"

At scale, Git workflow decisions directly affect deployment frequency, incident MTTR, and team autonomy. Senior engineers design the branching strategy, enforce it through automation (branch protection, CODEOWNERS, required status checks), and define the release process. This document covers those architectural decisions and their consequences.

## Architecture Decisions

> Present the key structural choices with trade-off tables so readers can make defensible decisions.

### Monorepo vs. Polyrepo

| Dimension | Monorepo | Polyrepo |
|-----------|---------|---------|
| Code sharing | Trivial (import by path) | Requires package publishing |
| Atomic cross-service changes | One PR, one review | Multiple PRs coordinated manually |
| CI build time | Grows without investment (sparse checkout, affected-targets) | Naturally scoped to each repo |
| Onboarding | One clone, one dev setup | Multiple repos, multiple setups |
| Access control | Coarse (CODEOWNERS per path) | Fine-grained per repo |
| Tooling investment | High (Nx, Bazel, Turborepo needed) | Low |
| Used by | Google, Meta, Airbnb | Most startups, microservice shops |

**Decision rule:** Choose monorepo when services share significant code or need frequent atomic changes together. Choose polyrepo when teams and services are truly independent and different release cycles are needed.

### Branch Protection Configuration

```yaml
# GitHub branch protection (via API or terraform-github provider)
branch_protection:
  branch: main
  required_pull_request_reviews:
    required_approving_review_count: 2
    dismiss_stale_reviews: true
    require_code_owner_reviews: true
  required_status_checks:
    strict: true          # branch must be up to date before merge
    contexts:
      - "ci/test"
      - "ci/lint"
      - "security/scan"
  enforce_admins: true
  restrictions:
    push_teams: []        # nobody can push directly
  allow_force_pushes: false
  allow_deletions: false
```

## Core Concepts

### GitHub Apps vs. GitHub Actions

| | GitHub Apps | GitHub Actions |
|-|------------|---------------|
| Authentication | App installation token (scoped) | `GITHUB_TOKEN` (per-workflow) |
| Trigger model | Webhook events | Workflow YAML triggers |
| Permissions | Fine-grained per installation | Repo-level, configurable |
| Reusability | Cross-repo, any language | Reusable workflows, marketplace |
| Best for | Bots, integrations, custom checks | CI/CD, automation |

Use **GitHub Apps** when you need a persistent bot identity, cross-organization access, or fine-grained permission scopes. Use **GitHub Actions** for per-repo CI/CD automation.

### CODEOWNERS — Governance at the File Level

```text
# .github/CODEOWNERS
# Syntax: <path pattern>  <@owner or @team>

# Default owners for everything
*                          @org/platform-team

# Ownership of specific directories
/src/auth/                 @org/security-team
/src/payments/             @org/payments-team @alice

# Infrastructure files require two approvers
/terraform/                @org/infra-team

# Docs can be reviewed by anyone on the docs team
/docs/                     @org/docs-team
```

When a PR touches a file covered by CODEOWNERS, GitHub automatically requests a review from the listed owners. Branch protection can require CODEOWNERS approval before merge.

### Release Automation

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # full history needed for changelog generation
      - name: Generate changelog
        run: npx conventional-changelog-cli -p angular -i CHANGELOG.md -s
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: CHANGELOG.md
          generate_release_notes: true
```

## Performance Optimization

> Large repositories become slow. Show the techniques that keep them fast.

### Shallow Clone (CI pipelines)

```bash
# Full clone — downloads entire history
git clone https://github.com/org/large-repo.git

# Shallow clone — only the latest commit (fastest for CI)
git clone --depth=1 https://github.com/org/large-repo.git

# Fetch additional history if needed (e.g., for git bisect)
git fetch --deepen=100
```

### Partial Clone (filter by object type)

```bash
# Clone without blobs — download file content on demand
git clone --filter=blob:none https://github.com/org/large-repo.git

# Clone without trees or blobs — only commits and tags
git clone --filter=tree:0 https://github.com/org/large-repo.git
```

### Sparse Checkout (monorepos)

```bash
# Enable sparse checkout
git clone --no-checkout https://github.com/org/monorepo.git
cd monorepo
git sparse-checkout init --cone
git sparse-checkout set services/auth services/api shared/lib
git checkout main
```

Only the specified paths are materialized on disk. Essential for monorepos with hundreds of packages.

### Repository Maintenance

```bash
# Run garbage collection and repack
git gc --aggressive --prune=now

# Check repository health
git fsck --full

# Show what is consuming space
git count-objects -vH
```

## Security Architecture

### Signing Commits with GPG or SSH

```bash
# Configure GPG signing
git config --global user.signingkey <GPG_KEY_ID>
git config --global commit.gpgsign true

# Or use SSH signing (Git 2.34+)
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true

# Verify a commit signature
git log --show-signature -1
```

### Secret Scanning

- Enable GitHub Secret Scanning on all repositories (free for public repos, part of GitHub Advanced Security for private).
- Add `git-secrets` or `trufflehog` as a pre-commit hook locally.
- Set up push protection to block secrets before they reach the remote.

```bash
# Install git-secrets and configure AWS patterns
git secrets --install
git secrets --register-aws
```

### Branch Protection as Code (Terraform)

```hcl
resource "github_branch_protection" "main" {
  repository_id = github_repository.app.node_id
  pattern       = "main"

  required_pull_request_reviews {
    required_approving_review_count = 2
    require_code_owner_reviews      = true
    dismiss_stale_reviews           = true
  }

  required_status_checks {
    strict   = true
    contexts = ["ci/test", "security/scan"]
  }

  enforce_admins     = true
  allows_force_pushes = false
}
```

## Postmortem Examples

> Describe a realistic failure scenario, root cause, and remediation.

### Accidental Force Push to main

**What happened:** An engineer ran `git push --force origin main` while trying to update a feature branch. The remote `main` was reset to an older commit, losing 3 days of merged work.

**Root cause:** Branch protection was not enabled; the engineer had direct push access.

**Remediation:**
1. Immediately: `git reflog` on any local clone to find the lost commit SHA.
2. Restore: `git push origin <lost-sha>:main` (temporarily disable protection if needed).
3. Long-term: Enable branch protection with `allow_force_pushes: false` and `enforce_admins: true`.

**Prevention:**
- Enable branch protection on `main` for all repositories, including admin accounts.
- Use `git push --force-with-lease` instead of `--force` — it fails if someone else pushed since your last fetch.

## SLO Design for Git-Based Delivery

> Define measurable targets for the delivery pipeline.

| Metric | Definition | Target (example) |
|--------|-----------|-----------------|
| **Deployment Frequency** | How often code is deployed to production | Multiple times per day |
| **Lead Time for Changes** | Time from commit to production | < 1 hour |
| **Change Failure Rate** | % of deployments causing a production incident | < 5% |
| **MTTR** | Mean time to restore service after an incident | < 30 minutes |
| **PR cycle time** | Time from PR open to merge | < 24 hours |
| **CI pipeline duration** | Time from push to green status | < 10 minutes |

## Capacity Planning

> What to monitor as repositories and teams grow.

- **Repository size:** Alert when `.git` exceeds 1 GB. Investigate large blobs with `git rev-list --objects --all | sort -k 2 | tail -20`.
- **CI queue time:** If queued longer than 5 minutes, increase runner capacity or optimize parallel jobs.
- **Branch count:** Stale branches (no commits in 90+ days) accumulate. Automate deletion of merged branches.
- **CODEOWNERS coverage:** Run periodic audits to ensure all paths have at least one owner.
- **Secrets exposure:** Review secret scanning alerts weekly; target zero unresolved critical alerts.

## Summary

- Monorepo vs. polyrepo is a team autonomy and code-sharing trade-off, not a technical preference.
- CODEOWNERS + branch protection + required status checks form the governance triad for safe, scalable collaboration.
- Shallow clone, partial clone, and sparse checkout are essential for CI speed in large repositories.
- Signed commits and secret scanning are the two highest-leverage security controls in a Git workflow.
- Measure DORA metrics (deployment frequency, lead time, change failure rate, MTTR) to make delivery improvement objective.

## Further Reading

- [DORA State of DevOps Report](https://dora.dev/research/)
- [GitHub — Managing a large monorepo](https://docs.github.com/en/repositories/working-with-files/managing-large-files)
- [Git partial clone](https://git-scm.com/docs/partial-clone)
- [GitHub CODEOWNERS docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [Terraform GitHub provider](https://registry.terraform.io/providers/integrations/github/latest/docs)

---

---
# TEMPLATE 4 — professional.md
# {{TOPIC_NAME}} — Internals and Protocol Level
---

> Target audience: staff engineers, open-source contributors, and developers who need to understand Git at the object model and plumbing level.
> Goal: demystify exactly what happens on disk and over the wire when Git operations run.

## Introduction

> Answer: "What happens under the hood when I run a Git command?"

Every Git porcelain command (add, commit, push, merge) is built from a small set of plumbing commands that manipulate a content-addressable object store. Understanding the object model explains why Git is fast, why history cannot be silently altered, and how pack files keep repository size manageable. This document goes from concept to hex bytes.

## How It Works Internally

### Content-Addressable Storage

Git stores every piece of data as an object identified by the SHA-1 (or SHA-256 in newer repos) hash of its content plus a header. Two identical files produce identical SHA hashes and are stored only once — deduplication is automatic.

```text
Object = SHA1( "type length\0content" )
```

Object types:
- **blob** — raw file content
- **tree** — directory listing (maps filenames to blob/tree SHAs)
- **commit** — snapshot pointer (tree SHA + parent SHA + metadata)
- **tag** — annotated pointer to a commit

### SHA-1 vs SHA-256

Git historically used SHA-1. Since Git 2.29 (2020), SHA-256 repositories are supported (still experimental for interop). SHA-256 eliminates the theoretical collision attack surface that SHA-1 has. Transition is opt-in: `git init --object-format=sha256`.

## Git Object Model Deep Dive

### The DAG Structure

```text
tag v1.0
    |
    v
commit C3 ──parent──> commit C2 ──parent──> commit C1
    |                     |                     |
    v                     v                     v
 tree T3              tree T2              tree T1
  ├── blob B1 (README)   ├── blob B1 (README — same SHA, same content)
  ├── blob B2 (main.go)  ├── blob B3 (main.go v2)
  └── tree T_src         └── tree T_src
        └── blob B4             └── blob B4
```

- Commits form a directed acyclic graph (DAG): each commit points to its parent(s).
- Trees point to blobs and subtrees. Unchanged files share blob objects across commits.
- Tags point to commits (lightweight tags are just refs; annotated tags are objects).

### Reachability and Garbage Collection

An object is **reachable** if you can traverse the DAG from any ref (branch tip, tag, HEAD) to reach it. Unreachable objects are candidates for garbage collection.

```bash
# Show all reachable objects from HEAD
git rev-list --objects HEAD

# Force GC — remove unreachable objects older than the grace period
git gc --prune=now
```

## Git Plumbing Command Analysis

> Show how porcelain maps to plumbing.

### Creating a Commit Entirely with Plumbing

```bash
# 1. Hash a blob (file content) and write it to the object store
echo "Hello, Git" | git hash-object -w --stdin
# => e51ca0d0b8c5b6e02473228bbf23b42c17a24a93

# 2. Create a tree object that contains this blob
git update-index --add --cacheinfo 100644 \
  e51ca0d0b8c5b6e02473228bbf23b42c17a24a93 hello.txt
git write-tree
# => 4b825dc642cb6eb9a060e54bf8d69288fbee4904

# 3. Create a commit object pointing to that tree
echo "Initial commit" | git commit-tree \
  4b825dc642cb6eb9a060e54bf8d69288fbee4904
# => a1b2c3d4e5f6... (commit SHA)

# 4. Advance a branch ref to the new commit
git update-ref refs/heads/main a1b2c3d4e5f6...
```

This sequence is exactly what `git add` + `git commit` do internally.

### Porcelain → Plumbing Mapping

| Porcelain | Plumbing equivalent |
|-----------|-------------------|
| `git add <file>` | `git hash-object -w <file>` + `git update-index` |
| `git commit -m "msg"` | `git write-tree` + `git commit-tree` + `git update-ref` |
| `git checkout <branch>` | `git read-tree` + `git checkout-index` + update `HEAD` |
| `git merge` | `git merge-base` + `git read-tree -m` + `git merge-index` |
| `git diff` | `git diff-index` or `git diff-tree` |

## Object/Pack File Hex Analysis

### Inspecting Objects with git cat-file

```bash
# Show the type of an object
git cat-file -t HEAD
# => commit

# Pretty-print a commit object
git cat-file -p HEAD
# => tree   4b825dc642cb6eb9a060e54bf8d69288fbee4904
#    parent a1b2c3d4e5f6789012345678901234567890abcd
#    author  Alice <alice@example.com> 1700000000 +0000
#    committer Alice <alice@example.com> 1700000000 +0000
#
#    feat: add hello.txt

# Pretty-print the root tree
git cat-file -p HEAD^{tree}
# => 100644 blob e51ca0d0...  hello.txt
#    040000 tree 9daeafb9...  src

# Pretty-print a blob
git cat-file -p e51ca0d0
# => Hello, Git

# Show raw object size
git cat-file -s HEAD
# => 234
```

### Raw Object Format on Disk

Loose object stored at `.git/objects/e5/1ca0d0...`:

```text
zlib-compressed:
  "blob 10\0Hello, Git"
   ^^^^  ^^  ^^^^^^^^^^
   type  len  content
```

The filename is the first 2 hex chars as directory + remaining 38 chars as filename, allowing efficient filesystem lookup.

## POSIX File Locking and .git Directory Internals

### .git/ Structure

```text
.git/
├── HEAD                  # current branch ref or detached commit SHA
├── config                # repo-level configuration
├── index                 # binary staging area (the index)
├── COMMIT_EDITMSG        # last commit message
├── FETCH_HEAD            # last fetched ref
├── ORIG_HEAD             # backup of HEAD before merge/rebase
├── refs/
│   ├── heads/            # local branch pointers
│   │   └── main          # contains the SHA of the tip commit
│   ├── remotes/
│   │   └── origin/
│   │       └── main
│   └── tags/
├── objects/
│   ├── pack/             # packed objects (.pack + .idx pairs)
│   └── xx/               # loose objects (first 2 hex chars of SHA)
└── logs/
    └── refs/             # reflog (history of ref changes)
        └── heads/
            └── main
```

### File Locking

Git uses POSIX file locking (`.lock` files) to ensure safe concurrent access:
- Before updating a ref, Git creates `refs/heads/main.lock`.
- On success, it renames the lock file atomically.
- On crash, stale `.lock` files must be removed manually: `rm .git/refs/heads/main.lock`.

## Pack File Binary Format

When a repository grows, Git packs loose objects into a `.pack` file for efficiency.

```bash
# Trigger packing manually
git gc

# List pack files
ls .git/objects/pack/
# => pack-abc123.idx  pack-abc123.pack

# Verify a pack file
git verify-pack -v .git/objects/pack/pack-abc123.idx | head -20
```

### Delta Compression

Pack files use delta compression: instead of storing a full copy of every version of a file, Git stores a base object and a sequence of delta instructions (add N bytes at offset X, copy from base at offset Y).

```text
OFS_DELTA  — delta base is at a relative offset within the same pack file (preferred)
REF_DELTA  — delta base is referenced by SHA (used across pack files)
```

OFS_DELTA is faster (no SHA lookup) and preferred. REF_DELTA allows cross-pack references (used in shallow clones).

### .idx File Structure

The `.idx` file is a sorted index into the `.pack` file, enabling O(log n) binary search by SHA:

```text
Magic: \377tOc
Version: 2
Fan-out table: 256 × 4-byte counts (cumulative count by first SHA byte)
SHA table: sorted SHA entries
CRC table: per-object CRC32
Offset table: 4-byte offsets into .pack (or 8-byte for large packs)
```

## Git Source Code Walkthrough

### Key Algorithms in git.git

| Algorithm | Source file | What it does |
|-----------|------------|-------------|
| xdiff | `xdiff/xdiffi.c` | Myers diff algorithm — generates hunks for `git diff` |
| merge-ort | `merge-ort.c` | New merge strategy (2021) replacing recursive; faster for large trees |
| pack-objects | `builtin/pack-objects.c` | Selects delta bases, applies compression, writes .pack |
| commit-graph | `commit-graph.c` | Precomputed DAG index for fast `git log --graph` |
| revision walk | `revision.c` | Traverses the commit DAG for `git log`, `git gc` reachability |

### Commit Graph File

```bash
# Generate a commit-graph file for faster history traversal
git commit-graph write --reachable

# Verify the commit graph
git commit-graph verify
```

The commit graph stores precomputed parent SHAs and generation numbers in `.git/objects/info/commit-graphs/`, making `git log --graph` logarithmically faster on large repos.

## Performance Internals

### git log Graph Traversal

`git log` performs a topological sort of the DAG. Without the commit-graph file, every commit object must be read from disk. With commit-graph, parents and generation numbers are read from a compact binary file — 10–100x faster on large repos.

```bash
# Measure log performance without commit-graph
time git log --oneline | wc -l

# Write commit-graph and measure again
git commit-graph write --reachable
time git log --oneline | wc -l
```

### git gc --aggressive

```bash
# Standard gc (incremental, fast)
git gc

# Aggressive gc (full repack, slower but smaller)
git gc --aggressive --prune=now

# Check size before and after
git count-objects -vH
```

`--aggressive` re-selects delta bases more exhaustively. It is typically run once after large history imports (e.g., `git filter-repo`) rather than routinely.

### Shallow and Partial Clone Filters

```bash
# Shallow: no history blobs, only tip
git clone --depth=1 <url>

# Blobless: commits and trees but blobs fetched on demand
git clone --filter=blob:none <url>

# Treeless: only commits; trees and blobs fetched on demand
git clone --filter=tree:0 <url>
```

The filter specification is part of the Git transfer protocol (Git protocol v2). The server sends only objects matching the filter; the client fetches remaining objects lazily.

## Summary

- Every Git object is identified by the SHA hash of its content — identical content is stored once, making Git a content-addressable store.
- Commits, trees, blobs, and tags form a DAG. Reachability from refs determines what GC can safely delete.
- Plumbing commands (`hash-object`, `write-tree`, `commit-tree`, `update-ref`) are the primitives; porcelain commands compose them.
- Pack files use OFS_DELTA compression and a binary .idx index for O(log n) lookup.
- The commit-graph file, shallow/partial clones, and `git gc` are the primary performance levers for large repositories.

## Further Reading

- [Pro Git — Git Internals chapter](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain)
- [Git object model — official docs](https://git-scm.com/docs/gitformat-object)
- [Pack format specification](https://git-scm.com/docs/pack-format)
- [Commit graph file format](https://git-scm.com/docs/commit-graph-format)
- [Git partial clone design doc](https://github.com/nicowillis/git-partial-clone)

---

---
# TEMPLATE 5 — interview.md
# {{TOPIC_NAME}} — Interview Preparation: Git & GitHub
---

> Target audience: engineers preparing for technical interviews at any level.
> Goal: provide realistic questions with concise, accurate model answers and follow-up prompts.

## How to Use This Document

> Read the question, write your own answer, then compare with the model answer. Practice saying answers aloud — interviewers evaluate clarity of communication, not just technical accuracy.

---

## Junior Level

> Questions at this level test whether the candidate can use Git safely in a team.

---

**Q1: What is the difference between `git merge` and `git rebase`?**

Model answer: Both integrate changes from one branch into another. `git merge` creates a new merge commit that preserves the full branch history. `git rebase` replays your commits on top of the target branch, rewriting their SHAs and producing a linear history. Rebase should only be used on private (local, unpublished) branches because rewriting SHAs on a shared branch breaks teammates' history.

Follow-up: "When would you prefer merge over rebase?" — When you want to preserve the exact history of when a feature was developed in parallel.

---

**Q2: What is HEAD in Git?**

Model answer: HEAD is a special pointer that indicates the commit (or branch) you are currently working on. In normal use, HEAD points to a branch name, which in turn points to the latest commit on that branch. When you check out a commit SHA directly, HEAD becomes "detached" and no longer tracks a branch.

Follow-up: "What does it mean for HEAD to be detached?" — It means new commits won't be saved to any branch. You must create a new branch to preserve your work.

---

**Q3: How do you resolve a merge conflict?**

Model answer: Git marks the conflicting sections in the affected files with `<<<<<<<`, `=======`, and `>>>>>>>`. I open each conflicted file, decide which version to keep (or combine both), remove the conflict markers, then `git add` the resolved file and `git commit` to complete the merge.

Follow-up: "What tools do you use to resolve conflicts?" — VS Code's merge editor, IntelliJ's three-way diff, or `git mergetool` with vimdiff.

---

**Q4: What does `git stash` do?**

Model answer: `git stash` temporarily shelves uncommitted changes (both staged and unstaged) so you can switch branches or pull updates with a clean working tree. The changes are saved in a stack. `git stash pop` restores the most recent stash and removes it from the stack; `git stash apply` restores without removing it.

Follow-up: "What is the difference between `git stash pop` and `git stash apply`?" — `pop` removes the stash from the stack; `apply` keeps it, allowing you to apply it to multiple branches.

---

## Middle Level

> Questions at this level test team workflow knowledge and ability to recover from complex situations.

---

**Q5: When would you use `git cherry-pick`?**

Model answer: `git cherry-pick <sha>` applies a single commit from one branch to another. I use it when a bug fix is made on `main` and needs to be backported to an older release branch, or when a specific commit from a feature branch is needed without pulling the entire branch.

Follow-up: "What are the risks of cherry-picking?" — It duplicates the commit (new SHA, same changes), which can cause confusing history and double-application conflicts if the original branch is later merged.

---

**Q6: Explain GitFlow vs. trunk-based development.**

Model answer: GitFlow uses multiple long-lived branches — `main`, `develop`, `release/*`, `hotfix/*` — and is suited for software shipped on a schedule (e.g., mobile apps). Trunk-based development keeps a single `main` branch; everyone commits small changes frequently (using feature flags for incomplete work) and deploys continuously. Trunk-based is preferred for web services with continuous delivery because it reduces merge overhead and detects integration problems earlier.

Follow-up: "What is the main risk of long-lived feature branches?" — Massive merge conflicts and delayed integration bugs that were invisible until late.

---

**Q7: How do you undo a commit that has been pushed to a shared branch?**

Model answer: Use `git revert <sha>` — it creates a new commit that reverses the changes, leaving the original commit in history. This is safe for shared branches because it does not rewrite history. Avoid `git reset --hard` followed by `git push --force` on shared branches, as this rewrites history and breaks teammates' local repos.

Follow-up: "When is `git reset` appropriate after a push?" — Only on your own private feature branch, never on `main` or any branch shared with others.

---

## Senior Level

> Questions at this level test system-design thinking and leadership around Git workflows.

---

**Q8: Design a branching strategy for 50 engineers releasing to production daily.**

Model answer: I would implement trunk-based development: all engineers work on short-lived feature branches (< 2 days) and merge to `main` via pull requests with at least one reviewer and passing CI. Feature flags hide incomplete features from users. Main is deployed automatically on every merge. Release branches are cut from `main` when a specific version is needed (e.g., mobile releases). Branch protection enforces no direct pushes, required status checks (test, lint, security scan), and CODEOWNERS approval for critical paths. DORA metrics are tracked weekly.

---

**Q9: How would you handle a secret (API key) accidentally committed to history?**

Model answer: First, rotate the secret immediately — assume it is compromised. Then remove it from history using `git filter-repo --path-glob '*.env' --invert-paths` or `git filter-repo --replace-text <expressions-file>`. Force-push the rewritten history to the remote and notify all teammates to re-clone. Add the file to `.gitignore` and enable GitHub secret scanning with push protection to prevent recurrence. Document the incident in a postmortem.

---

**Q10: What is CODEOWNERS and how does it affect review assignment?**

Model answer: `.github/CODEOWNERS` maps file path patterns to GitHub users or teams. When a PR touches a file matching a pattern, GitHub automatically requests a review from the designated owner. Combined with branch protection (`require_code_owner_reviews: true`), no PR can be merged to `main` without approval from the relevant owner. This enforces domain ownership without manual reviewer assignment.

---

## Professional Level

> Questions at this level test deep internals knowledge — object model, protocol, storage format.

---

**Q11: Explain the Git object model.**

Model answer: Git stores four types of objects — blob, tree, commit, tag — identified by the SHA-1 (or SHA-256) hash of their content plus a type/length header. Blobs hold raw file content. Trees map filenames to blob or subtree SHAs. Commits point to a tree (the root directory snapshot), zero or more parent commits, and contain author metadata. Tags are annotated pointers to commits. Together, commits form a directed acyclic graph (DAG); branches are movable pointers to commit nodes in that DAG.

---

**Q12: How does pack file delta compression work?**

Model answer: Git packs loose objects into `.pack` files for storage and transfer efficiency. Within a pack, similar objects (e.g., consecutive versions of a file) are stored as a base object plus a delta: a sequence of copy-from-base and insert-literal instructions. The delta format is called OFS_DELTA when the base is at a known byte offset within the same pack (faster, preferred) or REF_DELTA when the base is referenced by SHA (used across pack boundaries). The `.idx` file provides a sorted, binary-searchable index of SHA → offset mappings into the `.pack`.

---

**Q13: What is the difference between OFS_DELTA and REF_DELTA?**

Model answer: Both represent delta-compressed objects in a Git pack file. OFS_DELTA identifies the base object by its byte offset relative to the current object's position in the pack — resolution is O(1), no SHA lookup needed. REF_DELTA identifies the base by its full SHA hash — the reader must look up the SHA in the index or object store, which is slower and requires the base to be in a known location. Git prefers OFS_DELTA when packing locally; REF_DELTA appears in shallow clones or cross-pack references where the base is in a different pack.

---

## Summary

- Junior questions test daily command knowledge and safe recovery from common errors.
- Middle questions test team workflow understanding and situational judgment.
- Senior questions test system design and governance decision-making.
- Professional questions test object model and storage format depth.
- In every answer, explain the "why" — interviewers want to see reasoning, not just command recall.

---

---
# TEMPLATE 6 — tasks.md
# {{TOPIC_NAME}} — Hands-On Tasks by Level
---

> Target audience: learners at any level who want to build skill through practice.
> Goal: provide concrete, verifiable tasks that produce real artifacts.
> Each task has a clear deliverable so the learner knows when they are done.

---

## Junior Tasks

> These tasks build muscle memory for daily Git operations.

---

**Task J1: Clone a repository and make your first commit**

Steps:
1. Fork the repository `https://github.com/skills/introduction-to-github` to your account.
2. Clone your fork locally: `git clone https://github.com/<you>/introduction-to-github.git`
3. Create a new branch: `git checkout -b add-my-name`
4. Add your name to `README.md`.
5. Stage and commit: `git add README.md && git commit -m "docs: add my name to README"`
6. Push: `git push -u origin add-my-name`

Deliverable: A pushed branch visible on GitHub.

---

**Task J2: Open a Pull Request and merge it**

Steps:
1. From Task J1's pushed branch, open a Pull Request on GitHub targeting `main`.
2. Write a descriptive PR description (what changed, why).
3. Request a review from a classmate or self-review.
4. Merge the PR using "Squash and merge."
5. Delete the remote branch after merge.

Deliverable: A merged PR in your repository's pull request history.

---

**Task J3: Resolve a merge conflict**

Steps:
1. On `main`, edit line 1 of `README.md` and commit.
2. Create a new branch from one commit before: `git checkout -b conflict-branch HEAD~1`
3. Edit the same line 1 differently and commit.
4. Merge `main` into `conflict-branch`: `git merge main`
5. Resolve the conflict in `README.md`, stage, and complete the merge.

Deliverable: A repository with a successfully resolved merge conflict in its history (`git log --oneline --graph`).

---

**Task J4: Use git stash to switch context**

Steps:
1. Make changes to a file but do NOT commit.
2. Run `git stash` and verify the working tree is clean with `git status`.
3. Switch to another branch, make a commit there, and switch back.
4. Run `git stash pop` and verify your changes are restored.

Deliverable: A written note (in your learning journal) explaining what `git stash` saved and where it stored the data.

---

## Middle Tasks

> These tasks build workflow design and automation skills.

---

**Task M1: Design and document a branching strategy**

Steps:
1. Choose a project scenario: a SaaS web app with weekly releases.
2. Write a `BRANCHING.md` document that specifies:
   - Branch naming conventions (e.g., `feature/`, `hotfix/`, `release/`)
   - Who can merge to `main`
   - What CI checks are required before merge
   - How hotfixes are handled
3. Include a Mermaid diagram illustrating the branch lifecycle.

Deliverable: A committed `BRANCHING.md` file reviewed by a peer.

---

**Task M2: Write a `.github/pull_request_template.md`**

Steps:
1. Create `.github/pull_request_template.md` in a repository.
2. Include sections: Summary, Motivation, Changes, Test plan, Screenshots (if UI), Checklist.
3. Open a new PR and verify that the template pre-populates the description field.

Deliverable: A pull request that used the template, with all checklist items completed.

---

**Task M3: Set up a pre-commit hook with lint**

Steps:
1. Create `.git/hooks/pre-commit` (or use the `pre-commit` framework).
2. Add a shell script that runs `eslint src/` (or your language's linter).
3. Make the hook executable: `chmod +x .git/hooks/pre-commit`
4. Attempt to commit code with a lint error — verify the hook blocks the commit.
5. Fix the error and verify the commit succeeds.

Deliverable: A repository where `git commit` fails on lint errors and succeeds after they are fixed.

```bash
#!/bin/sh
# .git/hooks/pre-commit
npx eslint src/ --max-warnings=0
if [ $? -ne 0 ]; then
  echo "Lint failed. Fix errors before committing."
  exit 1
fi
```

---

## Senior Tasks

> These tasks build platform engineering and architectural skills.

---

**Task S1: Build a GitHub Actions CI/CD pipeline with matrix builds**

Steps:
1. Create `.github/workflows/ci.yml`.
2. Run tests across a matrix of Node.js versions (18, 20, 22) and operating systems (ubuntu-latest, windows-latest).
3. Add a separate job that runs only on `main` pushes and deploys to a staging environment.
4. Use `needs:` to enforce job ordering.

Deliverable: A green CI run on GitHub Actions showing matrix results across all combinations.

```yaml
jobs:
  test:
    strategy:
      matrix:
        node: [18, 20, 22]
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm test
```

---

**Task S2: Create a CODEOWNERS file and validate it**

Steps:
1. Create `.github/CODEOWNERS` assigning ownership to at least three different teams/paths.
2. Enable "Require review from Code Owners" in branch protection settings.
3. Open a PR that touches an owned path and verify that the correct owner is automatically requested.
4. Document any paths that lack an owner and add a default catch-all owner.

Deliverable: A `CODEOWNERS` file committed to `main` and a PR showing automatic review assignment.

---

**Task S3: Write a monorepo strategy Architecture Decision Record (ADR)**

Steps:
1. Create `docs/adr/001-monorepo-strategy.md`.
2. Follow the ADR template: Title, Status, Context, Decision, Consequences.
3. Address: tooling choice (Nx / Turborepo / Bazel), CI optimization (affected builds), sparse checkout setup, and code ownership model.
4. Get it reviewed by at least one peer.

Deliverable: A committed, reviewed ADR document.

---

## Professional Tasks

> These tasks build deep internals knowledge through direct object manipulation.

---

**Task P1: Inspect a commit object using git cat-file**

Steps:
1. In any Git repository, run: `git cat-file -p HEAD`
2. Copy the tree SHA from the output and run: `git cat-file -p <tree-sha>`
3. Copy a blob SHA from the tree output and run: `git cat-file -p <blob-sha>`
4. Run `git cat-file -s HEAD` to see the raw byte size of the commit object.
5. Locate the loose object file on disk: `.git/objects/<first2>/<remaining38>`

Deliverable: A written explanation (in your learning journal) tracing the full path: commit → tree → blob → file content.

---

**Task P2: Create a commit using only plumbing commands**

Steps:
1. Initialize a new empty repository: `git init plumbing-test && cd plumbing-test`
2. Create a file and hash it: `echo "Hello plumbing" | git hash-object -w --stdin`
3. Add it to the index: `git update-index --add --cacheinfo 100644 <blob-sha> hello.txt`
4. Write the tree: `git write-tree`
5. Create the commit: `echo "First plumbing commit" | git commit-tree <tree-sha>`
6. Update the branch ref: `git update-ref refs/heads/main <commit-sha>`
7. Verify with: `git log --oneline`

Deliverable: A repository with one commit created entirely without porcelain commands, verified by `git log`.

---

## Summary

- Junior tasks build daily command fluency through repetition on real repositories.
- Middle tasks develop workflow design, automation, and code review skills.
- Senior tasks build platform and governance artifacts that scale to large teams.
- Professional tasks develop internals intuition by manipulating Git's plumbing layer directly.

---

---
# TEMPLATE 7 — find-bug.md
# {{TOPIC_NAME}} — Bug Scenarios: Git Workflow Anti-Patterns
---

> Target audience: developers at any level who want to recognize and fix common Git mistakes.
> Format: each scenario shows the symptom, root cause, how to detect it, how to fix it, and how to prevent recurrence.

---

## Bug 1: Rebasing a Public Branch (Force Push on a Shared Branch)

**Symptom:**
```text
error: failed to push some refs to 'origin'
hint: Updates were rejected because the tip of your current branch is behind its remote counterpart.
```
Teammates report that their `git pull` now produces unexpected merge commits or conflicts.

**Root Cause:** An engineer ran `git rebase origin/main` on the `develop` branch and then force-pushed, rewriting the SHA history that teammates had already checked out.

**Detection:**
```bash
# Compare local and remote history — diverged SHAs with same content indicate a rewrite
git log --oneline origin/develop..develop
git log --oneline develop..origin/develop
```

**Fix:**
```bash
# Teammates must reset their local branch to the remote
git fetch origin
git reset --hard origin/develop
# WARNING: this discards any local commits on develop not yet pushed
```

**Prevention:** Never rebase a branch that other engineers have checked out. Use `git merge` instead, or restrict rebase to private feature branches before their first push.

---

## Bug 2: git push --force Instead of --force-with-lease

**Symptom:** A teammate's recent commits disappear from the remote branch with no warning.

**Root Cause:** `git push --force` overwrites the remote unconditionally. If someone pushed between your last fetch and your force push, their commits are silently lost.

**Detection:**
```bash
# Check the reflog on GitHub (Insights > Network) or locally via:
git reflog show origin/main
```

**Fix:**
```bash
# Recover lost commits from any teammate's local reflog
git reflog
git push origin <lost-sha>:main
```

**Prevention:** Always use `--force-with-lease` instead of `--force`. It fails if the remote has commits you have not fetched, protecting against overwriting others' work.

```bash
# Safe force push
git push --force-with-lease origin feature/my-branch
```

---

## Bug 3: Missing --rebase on git pull (Unnecessary Merge Commit on Feature Branch)

**Symptom:** `git log --oneline --graph` shows merge commits cluttering a feature branch that only one person is working on.

```text
*   a1b2c3d Merge branch 'main' into feature/login
|\
| * f4e5d6c fix: correct typo in config
* | 9g8h7i6 feat: add login form
```

**Root Cause:** Running `git pull` (without `--rebase`) when `main` has new commits creates a merge commit on the feature branch, polluting its history.

**Fix:**
```bash
# Re-linearize the feature branch (interactive rebase to drop the merge commit)
git rebase -i origin/main
# In the editor, drop any merge commits (lines starting with "Merge branch")
```

**Prevention:** Configure Git to rebase by default on pull:
```bash
git config --global pull.rebase true
# Then git pull is equivalent to git pull --rebase
```

---

## Bug 4: Secret Accidentally Committed (API Key in .env)

**Symptom:** GitHub Secret Scanning alert: "AWS secret access key found in commit `a3f2c1b`."

**Root Cause:** A developer committed `.env` containing `AWS_SECRET_ACCESS_KEY=xxx` because `.gitignore` did not exclude it.

**Detection:**
```bash
# Search current history for secret patterns
git log -S "AWS_SECRET_ACCESS_KEY" --oneline
git grep "AWS_SECRET" $(git rev-list --all)
```

**Fix:**
```bash
# Step 1: Rotate the secret immediately — assume it is compromised

# Step 2: Remove from history using git filter-repo
pip install git-filter-repo
git filter-repo --path .env --invert-paths

# Step 3: Force push rewritten history
git push origin --force --all
git push origin --force --tags

# Step 4: Notify all teammates to re-clone
```

**Prevention:**
```bash
# .gitignore
.env
.env.*
!.env.example

# Enable GitHub push protection (blocks pushes containing detected secrets)
# Settings > Security > Secret scanning > Push protection: enabled
```

---

## Bug 5: Large Binary Files Committed Without LFS

**Symptom:** `git clone` takes 10+ minutes. `git count-objects -vH` shows size-pack > 2 GB.

**Root Cause:** Design assets, compiled binaries, or video files were committed directly to Git. Git stores every version of every binary file in full.

**Detection:**
```bash
# Find the largest objects in history
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | sort -k3 -rn \
  | head -20
```

**Fix:**
```bash
# Migrate existing large files to LFS
git lfs migrate import --include="*.psd,*.mp4,*.zip" --everything
git push --force --all
```

**Prevention:**
```bash
# .gitattributes
*.psd  filter=lfs diff=lfs merge=lfs -text
*.mp4  filter=lfs diff=lfs merge=lfs -text
*.zip  filter=lfs diff=lfs merge=lfs -text

# Install LFS before first commit
git lfs install
```

---

## Bug 6: GitHub Actions Workflow Echoing a Secret

**Symptom:** CI log shows the literal value of a secret:
```text
Run echo ${{ secrets.API_KEY }}
ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Root Cause:** GitHub Actions masks secrets only when they are passed through `${{ secrets.X }}` in supported fields. Using `echo` with direct interpolation in a `run:` step prints the value.

**Detection:** Review CI logs for unexpected credential-shaped strings.

**Fix:**
```yaml
# WRONG — secret value appears in log
- run: echo ${{ secrets.API_KEY }}

# CORRECT — pass secret as environment variable; GitHub masks it
- run: echo "$API_KEY"
  env:
    API_KEY: ${{ secrets.API_KEY }}
```

**Prevention:** Never interpolate `${{ secrets.X }}` directly inside a `run:` shell command. Always inject secrets as environment variables.

---

## Bug 7: Wrong git reset --hard Losing Uncommitted Work

**Symptom:** Files edited for hours are gone. `git status` shows a clean working tree.

**Root Cause:** The developer ran `git reset --hard HEAD` (or `git checkout .`) intending to discard a single file's changes, but reset the entire working tree.

**Detection:** Uncommitted changes are NOT in the reflog — they are genuinely lost unless the editor auto-saved.

**Fix:**
```bash
# Check if your editor created a backup (VS Code, JetBrains often do)
# Check /tmp for temp files
ls /tmp/*.py  # or relevant extension

# If you staged the changes before reset:
git fsck --lost-found
ls .git/lost-found/other/  # dangling blobs may contain your content
```

**Prevention:**
```bash
# Discard changes in a SINGLE file only
git checkout -- src/specific-file.js

# Or use restore (Git 2.23+)
git restore src/specific-file.js

# Never use reset --hard without first stashing or committing
```

---

## Bug 8: Merging an Outdated Feature Branch Without Rebasing First

**Symptom:** A PR is merged that reverts changes already in `main`, or integration tests that passed on CI now fail in production.

**Root Cause:** The feature branch was created weeks ago and `main` has since changed in ways that conflict semantically (not syntactically — Git did not detect a conflict, but the behavior is wrong).

**Detection:**
```bash
# Check how far the feature branch has drifted from main
git log --oneline main..feature/old-branch   # commits only in feature
git log --oneline feature/old-branch..main   # commits only in main (missed changes)
```

**Fix:**
```bash
# Rebase the feature branch on top of the current main
git checkout feature/old-branch
git fetch origin
git rebase origin/main
# Resolve any conflicts that surface
git push --force-with-lease origin feature/old-branch
```

**Prevention:** Enforce a branch age policy: feature branches older than 5 days must be rebased before merge. Add a CI check that fails if the feature branch is more than N commits behind `main`.

---

## Summary

- Rebasing shared branches and force-pushing without `--force-with-lease` are the most destructive team-level mistakes.
- Secrets in history require immediate credential rotation — history rewriting is secondary.
- Large binary files must be handled with LFS from the first commit; migration is painful.
- Never use `git reset --hard` without understanding its scope; prefer `git restore <file>` for single-file rollbacks.
- Outdated feature branches cause semantic merge bugs that CI cannot always catch — rebase before merge.

---

---
# TEMPLATE 8 — optimize.md
# {{TOPIC_NAME}} — Performance Optimization Scenarios
---

> Target audience: engineers working with large repositories or slow CI pipelines.
> Format: each scenario shows measured before/after command output, explains why the optimization works, and lists trade-offs.

---

## Optimization 1: Full Clone in CI → Shallow Clone

**Problem:** CI pipeline spends 4 minutes cloning a repository with 10 years of history before running a 30-second test suite.

**Before:**
```bash
time git clone https://github.com/org/large-repo.git
# real  4m12s
# Size on disk: 1.8 GB
du -sh large-repo/.git
# 1.8G  large-repo/.git
```

**After:**
```bash
time git clone --depth=1 https://github.com/org/large-repo.git
# real  0m18s
# Size on disk: 42 MB
du -sh large-repo/.git
# 42M  large-repo/.git
```

**Why it's faster:** `--depth=1` fetches only the tip commit and its tree/blobs. Git does not transfer parent commits or historical objects. The server sends a shallow pack with a `shallow` boundary marker.

**GitHub Actions implementation:**
```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 1   # default is 1 (shallow); set to 0 for full history
```

**Trade-offs:**
- `git log`, `git blame`, and `git bisect` are unavailable without additional `git fetch --deepen=N`.
- Tags and branches other than the checked-out one are not fetched.
- Acceptable for CI/CD; not suitable for release tooling that needs full history (e.g., changelog generation).

---

## Optimization 2: Large Repo Without LFS → LFS Migration

**Problem:** Repository with design assets grows to 8 GB. Clone time: 22 minutes. PR checkout: 3 minutes.

**Before:**
```bash
git count-objects -vH
# count: 0
# size-pack: 7.94 GiB
# in-pack: 182341

time git clone https://github.com/org/design-repo.git
# real  22m07s
```

**After (post-LFS migration):**
```bash
git count-objects -vH
# count: 0
# size-pack: 184 MiB     <-- git objects only; binaries now in LFS
# in-pack: 14892

time git clone https://github.com/org/design-repo.git
# real  1m43s            <-- git clone; LFS files fetched on demand
```

**Migration steps:**
```bash
# Install git-filter-repo and git-lfs
pip install git-filter-repo
git lfs install

# Migrate all PSD, PNG, MP4 files to LFS across entire history
git lfs migrate import \
  --include="*.psd,*.png,*.jpg,*.mp4,*.zip" \
  --everything

# Verify
git lfs ls-files | head -10

# Push rewritten history
git push --force --all
git push --force --tags
```

**Why it's faster:** LFS stores binary content on a separate object storage server. The Git repository only stores LFS pointer files (a few hundred bytes each). Developers fetch LFS objects on demand rather than downloading all historical versions of every binary.

**Trade-offs:** LFS has storage and bandwidth costs on GitHub (1 GB free, then paid). Requires `git lfs` installed on all developer machines. History is rewritten — all teammates must re-clone.

---

## Optimization 3: Sequential CI Jobs → Parallel Matrix Build

**Problem:** CI runs lint, unit tests, integration tests, and E2E tests sequentially. Total pipeline time: 48 minutes.

**Before:**
```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint          # 4 min
      - run: npm run test:unit     # 12 min
      - run: npm run test:integ    # 18 min
      - run: npm run test:e2e      # 14 min
# Total: 48 minutes
```

**After:**
```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run lint   # 4 min

  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run test:unit   # 12 min

  test-integ:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run test:integ  # 18 min

  test-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run test:e2e    # 14 min

  merge-gate:
    needs: [lint, test-unit, test-integ, test-e2e]
    runs-on: ubuntu-latest
    steps:
      - run: echo "All checks passed"
# Total wall-clock time: 18 minutes (longest job)
```

**Why it's faster:** Jobs run on separate runner instances in parallel. The critical path is the slowest individual job (18 min) rather than the sum.

**Trade-offs:** Each parallel job re-runs `npm ci` (cache mitigates this). More concurrent runner minutes consumed (higher cost on paid plans). Dependent jobs require `needs:` to enforce ordering.

---

## Optimization 4: Inefficient git log --all → Targeted Query

**Problem:** `git log --all` on a large repo with 50,000 commits takes 45 seconds and returns too much noise.

**Before:**
```bash
time git log --all --oneline | wc -l
# 50,000 lines
# real  0m44s
```

**After (filter by date and path):**
```bash
time git log --since="30 days ago" --oneline -- src/payments/ | wc -l
# 87 lines
# real  0m0.3s
```

**Useful targeted query patterns:**
```bash
# Changes to a specific file in the last 90 days
git log --since="90 days ago" --oneline -- src/auth/login.js

# Changes by a specific author
git log --author="alice@example.com" --oneline --since="2024-01-01"

# Commits that touched a specific function (Git 2.38+)
git log -L :myFunction:src/utils.js

# Commits containing a specific string in the diff
git log -S "deprecated_api_call" --oneline

# Generate commit-graph for faster subsequent traversals
git commit-graph write --reachable
time git log --since="30 days ago" --oneline -- src/ | wc -l
# real  0m0.1s   <-- commit-graph speeds up traversal further
```

**Why it's faster:** `--since` allows Git to stop DAG traversal once it reaches commits older than the cutoff. `-- <path>` restricts diff computation to the specified path. The commit-graph file eliminates per-commit object reads.

---

## Optimization 5: No .gitignore → Proper .gitignore

**Problem:** Repository contains `node_modules/`, build artifacts, and OS files. Clone size: 890 MB. `git status` takes 8 seconds.

**Before:**
```bash
du -sh .git
# 890M  .git

time git status
# real  0m8.2s
```

**After (with .gitignore):**

```text
# .gitignore
node_modules/
dist/
build/
.DS_Store
Thumbs.db
*.log
.env
.env.*
!.env.example
coverage/
.nyc_output/
*.orig
```

```bash
# Remove tracked files that should be ignored
git rm -r --cached node_modules/ dist/ build/
git commit -m "chore: remove ignored files from tracking"
git gc --prune=now

du -sh .git
# 12M   .git

time git status
# real  0m0.3s
```

**Why it's faster:** Git no longer tracks or hashes thousands of dependency files on every `git status`. Removing them from tracking also eliminates them from pack files after GC.

**Trade-offs:** Removing tracked files requires `git rm --cached`, not just adding to `.gitignore`. Teammates must run `npm install` locally after the change. Use `gitignore.io` to generate a starting `.gitignore` for your language and framework.

---

## Repository Health Metrics

> Track these metrics to identify optimization opportunities proactively.

| Metric | Command | Healthy threshold |
|--------|---------|------------------|
| Repository size (packed) | `git count-objects -vH \| grep size-pack` | < 500 MB |
| Loose object count | `git count-objects -vH \| grep ^count` | < 100 (after gc) |
| Largest objects | `git rev-list --objects --all \| git cat-file --batch-check='%(objectsize) %(rest)' \| sort -rn \| head -5` | No single object > 50 MB |
| Shallow clone time | `time git clone --depth=1 <url>` | < 30 seconds |
| CI pipeline duration | GitHub Actions workflow run time | < 10 minutes |
| Stale branches | Count of branches with last commit > 90 days | 0 |

## Summary

- Shallow clones (`--depth=1`) are the single highest-impact CI optimization for large repositories.
- LFS migration is mandatory for any repository storing binary assets — the sooner it is applied, the less painful the rewrite.
- Parallel CI jobs eliminate sequential bottlenecks; the pipeline is only as slow as its longest job.
- Targeted `git log` queries with `--since` and `-- <path>` are orders of magnitude faster than `git log --all`.
- A proper `.gitignore` is not just hygiene — it directly determines `git status` performance and repository size.

## Further Reading

- [GitHub — Managing large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [Git LFS documentation](https://git-lfs.com/)
- [GitHub Actions — Using concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency)
- [git-filter-repo](https://github.com/newren/git-filter-repo)
- [gitignore.io](https://www.toptal.com/developers/gitignore)

---

## Coding Patterns for Git (junior.md)

### Pattern 1 — Safe Feature Branch Workflow

```bash
# Always start from an up-to-date main
git checkout main
git pull origin main

# Create descriptively named branch
git checkout -b feat/user-authentication-jwt

# Work in small, atomic commits
git add src/auth/jwt.py tests/test_jwt.py
git commit -m "feat(auth): add JWT token generation with RS256"

git add src/auth/middleware.py
git commit -m "feat(auth): add JWT validation middleware"

# Push and open PR
git push -u origin feat/user-authentication-jwt
```

### Pattern 2 — Undo Common Mistakes

```bash
# Undo last commit but keep changes staged
git reset --soft HEAD~1

# Undo last commit and unstage changes (keep files)
git reset --mixed HEAD~1    # (default)

# Discard last commit AND all changes (DESTRUCTIVE)
git reset --hard HEAD~1

# Undo a pushed commit safely (creates a revert commit)
git revert HEAD
git push origin main

# Remove a file accidentally added to the index
git restore --staged secret.env

# Recover a file deleted from working tree
git restore src/deleted-file.py
```

---

## Coding Patterns for Git (middle.md)

### Pattern 1 — Interactive Rebase for Clean History

```bash
# Squash last 4 commits before merging PR
git rebase -i HEAD~4

# In the editor:
# pick a1b2c3d feat: add user model
# squash e4f5a6b fix: typo in user model
# squash g7h8i9j fix: missing validation
# squash k0l1m2n test: add user model tests
# → becomes one clean commit

# Reorder commits: move the test commit before the feature commit
# pick k0l1m2n test: add user model tests
# pick a1b2c3d feat: add user model

# Edit a specific commit (stop and amend)
# edit a1b2c3d feat: add user model
# → git amend → git rebase --continue
```

### Pattern 2 — Git Bisect to Find Regression

```bash
# Binary search for the commit that introduced a bug
git bisect start
git bisect bad                        # Current commit is broken
git bisect good v2.3.0               # Last known good version

# Git checks out a midpoint commit
# Test the behavior, then mark:
git bisect good    # or
git bisect bad

# Git narrows down — repeat until it identifies the exact commit
# Found: abc1234 is the first bad commit

# Automate with a test script
git bisect start HEAD v2.3.0
git bisect run python -m pytest tests/test_login.py -x -q
# Git automatically runs the script on each midpoint
```

### Pattern 3 — Git Hooks for Quality Gates

```bash
# .git/hooks/pre-commit — run linter and tests before every commit
#!/usr/bin/env bash
set -euo pipefail

echo "Running pre-commit checks..."

# Check for secrets
if grep -r "AKIA[0-9A-Z]{16}" --include="*.py" --include="*.js" .; then
  echo "ERROR: AWS access key detected in source code" >&2
  exit 1
fi

# Run linter
python -m ruff check . || exit 1

# Run tests (fast subset only)
python -m pytest tests/unit/ -x -q --timeout=30 || exit 1

echo "Pre-commit checks passed"
```

```bash
# .git/hooks/commit-msg — enforce Conventional Commits
#!/usr/bin/env python3
import sys
import re

msg = open(sys.argv[1]).read()
pattern = r'^(feat|fix|docs|style|refactor|test|chore|ci|perf)(\(.+\))?: .{1,72}'
if not re.match(pattern, msg.split('\n')[0]):
    print("ERROR: Commit message must follow Conventional Commits format")
    print("  Example: feat(auth): add JWT validation")
    sys.exit(1)
```

---

## Coding Patterns for Git (senior.md)

### Pattern 1 — Trunk-Based Development with Feature Flags

```mermaid
gitGraph
   commit id: "main: stable"
   branch feat/payment-v2
   commit id: "payment: behind flag"
   commit id: "payment: tests"
   checkout main
   merge feat/payment-v2 id: "merge: flag off in prod"
   commit id: "enable flag: 5% canary"
   commit id: "enable flag: 100%"
   commit id: "cleanup: remove flag"
```

```python
# Feature flag check — flag is in LaunchDarkly/AWS AppConfig
def process_payment(order):
    if feature_flags.is_enabled("payment-v2", user=order.user_id):
        return payment_v2.process(order)
    return payment_v1.process(order)
```

### Pattern 2 — Monorepo Affected-Only CI

```yaml
# GitHub Actions: only run affected package tests
name: CI
on: [push]

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      api: ${{ steps.changes.outputs.api }}
      frontend: ${{ steps.changes.outputs.frontend }}
      shared: ${{ steps.changes.outputs.shared }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            api:
              - 'packages/api/**'
              - 'packages/shared/**'
            frontend:
              - 'packages/frontend/**'
              - 'packages/shared/**'
            shared:
              - 'packages/shared/**'

  test-api:
    needs: detect-changes
    if: needs.detect-changes.outputs.api == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd packages/api && npm test

  test-frontend:
    needs: detect-changes
    if: needs.detect-changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd packages/frontend && npm test
```

### Pattern 3 — Git Notes for Build Metadata

```bash
# Attach CI build metadata to commits without modifying history
git notes --ref=ci add -m '{"build_id":"123","status":"passed","coverage":"87.3%"}' HEAD

# Push notes to remote (notes are not pushed by default)
git push origin refs/notes/ci

# Fetch notes from remote
git fetch origin refs/notes/ci:refs/notes/ci

# Show notes in git log
git log --notes=ci --format="%H %s %N" | head -20

# Use case: link a commit to its deployment artifact
git notes --ref=deployment add -m "docker.io/myapp:$(git rev-parse --short HEAD)" HEAD
```

### Pattern 4 — Signed Commits and Tags for Release Integrity

```bash
# Configure GPG signing
git config --global user.signingkey YOUR_GPG_KEY_ID
git config --global commit.gpgsign true
git config --global tag.gpgsign true

# Create a signed annotated tag for release
git tag -s v2.1.0 -m "Release 2.1.0 — adds payment v2"

# Verify a signed tag
git tag -v v2.1.0

# GitHub: require signed commits via branch protection
# Settings → Branches → Require signed commits

# SSH signing (newer alternative to GPG)
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
```

---

## Clean Code / Best Practices — Git

### Commit Message Quality

| Pattern | Bad | Good |
|---------|-----|------|
| Message content | "fix bug", "WIP", "stuff" | `fix(cart): prevent negative quantity on remove` |
| Scope | No context | `feat(auth):`, `fix(api):`, `chore(deps):` |
| Body | No explanation | Explain *why*, not just *what* |
| Breaking change | No notice | `BREAKING CHANGE:` footer with migration notes |
| Size | 50-file commit | One logical change per commit |

### Branch Hygiene

```bash
# Delete merged local branches
git branch --merged main | grep -v '^\*\|main\|master\|develop' | xargs -r git branch -d

# Delete merged remote branches
git fetch --prune   # Removes remote-tracking refs for deleted remote branches

# Interactive cleanup: list stale branches with last commit date
git for-each-ref --sort=-committerdate --format='%(committerdate:short) %(refname:short)' refs/heads/ | head -20

# Find branches with no activity in 90 days
git for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/heads/ | grep "months\|year"
```

---

## Error Handling and Recovery

### Recovering from Common Git Disasters

```bash
# DISASTER 1: Accidentally committed to main instead of a branch
git branch feat/my-work            # Save work to new branch
git reset --hard HEAD~1            # Remove from main
git checkout feat/my-work          # Continue on branch

# DISASTER 2: Force-pushed over main (team's commits gone)
# On any machine that had the commits:
git reflog                          # Find the SHA before the force push
git checkout -b recovery-branch <sha>
git push origin recovery-branch
# Then restore main:
git checkout main
git reset --hard recovery-branch
git push --force-with-lease origin main   # Safer than --force

# DISASTER 3: Deleted a branch before merging
git reflog | grep "feat/deleted-branch" | head -5
git checkout -b feat/deleted-branch <recovered-sha>

# DISASTER 4: git clean removed untracked files you needed
# Unfortunately git clean -f is unrecoverable unless you have editor backups
# Prevention: always use git clean --dry-run (-n) first

# DISASTER 5: Wrong file in git stash pop conflict
git checkout ORIG_HEAD -- path/to/file  # Restore from before stash pop
```

---

## GitHub Actions — Advanced Patterns

### Reusable Workflows

```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy Workflow
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      image-tag:
        required: true
        type: string
    secrets:
      deploy-role-arn:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.deploy-role-arn }}
          aws-region: us-east-1
      - name: Deploy
        run: |
          aws ecs update-service \
            --cluster ${{ inputs.environment }} \
            --service my-app \
            --force-new-deployment
```

```yaml
# .github/workflows/production-deploy.yml — calls reusable workflow
name: Production Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    uses: ./.github/workflows/reusable-build.yml

  deploy-staging:
    needs: build
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: staging
      image-tag: ${{ needs.build.outputs.image-tag }}
    secrets:
      deploy-role-arn: ${{ secrets.STAGING_ROLE_ARN }}

  deploy-production:
    needs: deploy-staging
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: production
      image-tag: ${{ needs.build.outputs.image-tag }}
    secrets:
      deploy-role-arn: ${{ secrets.PROD_ROLE_ARN }}
```

### Matrix Builds for Cross-Platform Testing

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        python-version: ["3.10", "3.11", "3.12"]
        exclude:
          - os: windows-latest
            python-version: "3.10"  # Known issue
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: pip install -e ".[test]"
      - run: pytest tests/ -v --tb=short
```

### Cache Strategy for Faster Builds

```yaml
      - name: Cache pip dependencies
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('**/requirements*.txt') }}
          restore-keys: |
            ${{ runner.os }}-pip-

      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: |
            ~/.npm
            node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-node-

      - name: Cache Docker layers
        uses: actions/cache@v4
        with:
          path: /tmp/.buildx-cache
          key: ${{ runner.os }}-buildx-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-buildx-
```

---

## Git Internals — Deeper Analysis

### The Reflog as Safety Net

```bash
# Reflog records every HEAD movement — your ultimate undo history
git reflog
# 0abc123 (HEAD -> main) HEAD@{0}: commit: feat: new feature
# 1def456 HEAD@{1}: reset: moving to HEAD~1
# 2ghi789 HEAD@{2}: commit: fix: hotfix
# 3jkl012 HEAD@{3}: checkout: moving from feature to main

# Recover a commit that was "lost" by reset --hard
git checkout -b rescue HEAD@{2}

# Reflog for a specific branch
git reflog refs/heads/my-feature

# Reflog expiry (default: 90 days for reachable, 30 for unreachable)
git config gc.reflogExpire 180           # Extend to 180 days
git config gc.reflogExpireUnreachable 90 # Keep unreachable longer

# Force gc to run and see what it prunes
git gc --aggressive --prune=now --dry-run
```

### Pack Files and Delta Compression

```bash
# Show pack file statistics
git count-objects -v
# count: 0           ← loose objects
# size: 0            ← size of loose objects in KB
# in-pack: 12453     ← objects in pack files
# packs: 1           ← number of pack files
# size-pack: 4320    ← pack file size in KB
# prune-packable: 0  ← loose objects also in pack
# garbage: 0

# List all pack files
ls -lh .git/objects/pack/

# Inspect a pack file index
git verify-pack -v .git/objects/pack/pack-abc123.idx | sort -k3 -n | tail -20
# Shows: sha1  type  size  size-in-pack  offset  depth  base-sha

# Repack for optimal compression
git repack -a -d -f --depth=250 --window=250
# -a: pack everything
# -d: remove old packs
# -f: force re-delta
# --depth: max delta chain depth
# --window: objects to compare for delta

# Find the largest objects in pack
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  awk '/^blob/ {print substr($0,6)}' | \
  sort --numeric-sort --key=2 --reverse | \
  head -20
```

### Git Protocol Internals

```bash
# Smart HTTP protocol negotiation (what happens during git fetch)
# Client sends:
#   GET /repo.git/info/refs?service=git-upload-pack HTTP/1.1
# Server responds with pack-refs advertisement
# Client computes "have" (what it has) and "want" (what it needs)
# Server generates minimum pack for the delta

# Trace Git network operations
GIT_TRACE_PACKET=1 git fetch origin 2>&1 | head -50
# Shows: packet:          git< # service=git-upload-pack
#        packet:        upload-pack< SHA1 refs/heads/main
#        packet:          git> want SHA1

# Trace all Git operations
GIT_TRACE=1 git status 2>&1

# Measure pack negotiation performance
GIT_TRACE_PERFORMANCE=1 git fetch origin 2>&1 | grep "performance"
```

---

## GitHub CLI — Automation Patterns

```bash
# Create PR from current branch with auto-fill
gh pr create --fill --web

# Review a PR
gh pr checkout 123              # Check out PR locally
gh pr review 123 --approve
gh pr review 123 --request-changes --body "Please add tests"
gh pr merge 123 --squash --delete-branch

# List PRs needing your review
gh pr list --search "review-requested:@me"

# Run a GitHub Actions workflow manually
gh workflow run deploy.yml --field environment=staging

# Watch a running workflow
gh run watch

# Create a release
gh release create v2.1.0 \
  --title "Release 2.1.0" \
  --notes "$(git log v2.0.0..HEAD --oneline --no-merges)" \
  ./dist/myapp-linux-amd64 \
  ./dist/myapp-darwin-arm64

# Search code across repos
gh search code "TODO: remove before launch" --owner myorg --language go
```

---

## Optimization Patterns for Git Workflows

### Optimization 1 — Shallow Clone for CI

```bash
# Full clone: minutes on large repos
# Shallow clone: seconds

# CI checkout — depth 1 is enough for most builds
git clone --depth 1 --branch main https://github.com/org/repo.git

# GitHub Actions uses this automatically
- uses: actions/checkout@v4
  with:
    fetch-depth: 1    # Default — shallow
    # fetch-depth: 0  # Full history (needed for git log, versioning)
```

**Before:** `git clone` on 5GB repo = 4 minutes
**After:** `git clone --depth=1` = 8 seconds

### Optimization 2 — Git Sparse Checkout for Monorepos

```bash
# Check out only the packages/api subtree
git clone --no-checkout --filter=blob:none https://github.com/org/monorepo.git
cd monorepo
git sparse-checkout init --cone
git sparse-checkout set packages/api packages/shared
git checkout main

# Result: only the specified directories are downloaded
# 2GB monorepo → 180MB download
```

### Optimization 3 — Partial Clone with Blob Filters

```bash
# Download commits and trees, but not blob contents
# Blobs fetched on-demand when accessed
git clone --filter=blob:none https://github.com/org/repo.git

# Download only commits (no tree, no blobs) — fastest clone
git clone --filter=tree:0 https://github.com/org/repo.git

# Check which objects are missing (will be fetched on-demand)
git rev-list --objects --missing=print HEAD | grep "^?" | wc -l
```

### Optimization 4 — Git Maintenance for Large Repos

```bash
# Enable background maintenance (runs hourly via launchd/systemd)
git maintenance start

# This schedules:
# - prefetch: downloads new objects in background
# - loose-objects: packs loose objects
# - incremental-repack: incrementally repacks to reduce pack count
# - commit-graph: writes commit-graph for faster traversal

# Check maintenance status
git maintenance run --task=commit-graph
git maintenance run --task=prefetch

# Manual: write commit-graph for faster log and blame
git commit-graph write --reachable --changed-paths
```

### Optimization 5 — GitHub Actions Job Parallelism

| Strategy | Build Time | When to Use |
|----------|-----------|-------------|
| Sequential jobs | 20 min | Simple single-service repo |
| Parallel test sharding | 5 min | Large test suite (1000+ tests) |
| Affected-only builds | 3 min | Monorepo with path filters |
| Reusable workflows + cache | 4 min | Multi-repo with shared tooling |
| Self-hosted runners | 2 min | When GitHub-hosted runners are bottleneck |

```yaml
# Test sharding — split 1000 tests across 5 parallel runners
  test:
    strategy:
      matrix:
        shard: [1, 2, 3, 4, 5]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest tests/ --shard-id=${{ matrix.shard }} --num-shards=5
```

---

## Git Self-Assessment Checklist

### Junior Level
- [ ] Can initialize a repo and make the first commit
- [ ] Understands staging area vs working directory vs repository
- [ ] Can create, switch, and delete branches
- [ ] Can resolve a simple merge conflict in a text editor
- [ ] Can push to and pull from a remote
- [ ] Knows how to undo the last commit with `git reset --soft`

### Middle Level
- [ ] Can perform interactive rebase to clean up branch history
- [ ] Can use `git bisect` to find a regression commit
- [ ] Can configure and use pre-commit hooks
- [ ] Can explain when to use merge vs rebase (and why)
- [ ] Can set up GitHub Actions for CI/CD
- [ ] Can cherry-pick specific commits across branches

### Senior Level
- [ ] Can design a branching strategy for a 20-person team
- [ ] Can implement trunk-based development with feature flags
- [ ] Can configure CODEOWNERS and branch protection rules
- [ ] Can audit and clean up a large repo with git-filter-repo
- [ ] Can optimize CI pipeline with caching and parallelism
- [ ] Can write a reusable GitHub Actions workflow

### Professional Level
- [ ] Can explain the git object model (blob/tree/commit/tag)
- [ ] Can construct a commit manually using plumbing commands
- [ ] Can analyze pack file delta chains with `git verify-pack`
- [ ] Can trace git protocol negotiation with `GIT_TRACE_PACKET`
- [ ] Can diagnose and recover from `ORIG_HEAD`, reflog, and orphaned objects
- [ ] Can explain why `--force-with-lease` is safer than `--force`


---

## Git Cheat Sheet

### Essential Commands by Category

```bash
# ── SETUP ──
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global core.editor "code --wait"
git config --global init.defaultBranch main
git config --global pull.rebase true       # Prefer rebase over merge on pull

# ── STARTING A REPO ──
git init                    # Init in current directory
git clone <url>             # Clone remote repo
git clone --depth 1 <url>   # Shallow clone (CI/CD)

# ── STAGING AND COMMITTING ──
git status                  # What's changed?
git diff                    # Unstaged changes
git diff --staged           # Staged changes (ready to commit)
git add <file>              # Stage a specific file
git add -p                  # Stage hunks interactively
git commit -m "message"
git commit --amend --no-edit   # Amend last commit (do not push after this)

# ── BRANCHING ──
git branch                  # List local branches
git branch -a               # List all (including remote)
git checkout -b <name>      # Create and switch
git switch -c <name>        # Modern equivalent
git branch -d <name>        # Delete merged branch
git branch -D <name>        # Force delete

# ── MERGING AND REBASING ──
git merge <branch>          # Merge branch into current
git merge --no-ff <branch>  # Always create a merge commit
git rebase main             # Rebase current branch onto main
git rebase -i HEAD~5        # Interactive rebase last 5 commits
git cherry-pick <sha>       # Apply specific commit
git cherry-pick A..B        # Apply range of commits

# ── REMOTE ──
git remote -v               # Show remotes
git remote add origin <url>
git push -u origin <branch> # Push and track
git push --force-with-lease  # Safe force push
git fetch --prune           # Fetch and clean stale remote refs
git pull --rebase           # Fetch + rebase

# ── INSPECTION ──
git log --oneline --graph --all   # Visual branch history
git log --author="Name" --since="2 weeks ago"
git blame <file>            # Who changed each line
git show <sha>              # Show a commit's diff
git diff main...feat/my-br  # Changes on branch since diverging from main
git log -S "search string"  # Find commits that added/removed a string
git log --follow -- <file>  # History across renames

# ── UNDOING ──
git restore <file>          # Discard working tree changes
git restore --staged <file> # Unstage a file
git reset --soft HEAD~1     # Undo commit, keep staged
git reset --mixed HEAD~1    # Undo commit, unstage (default)
git reset --hard HEAD~1     # Undo commit and discard changes (DESTRUCTIVE)
git revert <sha>            # Safe undo for pushed commits
git clean -fd               # Remove untracked files and dirs (DESTRUCTIVE)
git clean -fdn              # Dry run first!

# ── STASHING ──
git stash                   # Stash working tree changes
git stash push -m "WIP: feature x"
git stash list
git stash pop               # Apply and remove top stash
git stash apply stash@{2}   # Apply without removing
git stash drop stash@{2}    # Delete a specific stash
git stash branch <name>     # Create branch from stash

# ── TAGS ──
git tag v1.2.0              # Lightweight tag
git tag -a v1.2.0 -m "Release notes"  # Annotated tag
git push origin v1.2.0      # Push single tag
git push origin --tags      # Push all tags
git tag -d v1.2.0           # Delete local tag
git push origin --delete v1.2.0  # Delete remote tag

# ── ADVANCED ──
git reflog                  # Every HEAD movement — your undo safety net
git bisect start; git bisect bad; git bisect good v1.0.0
git worktree add ../hotfix hotfix-branch  # Multiple working trees
git submodule add <url> lib/vendor        # Add a submodule
git filter-repo --path src/ --path-rename src/:./  # Remove path history
```

---

## GitHub Actions Cheat Sheet

```yaml
# ── TRIGGERS ──
on:
  push:
    branches: [main, 'release/**']
    paths: ['src/**', 'tests/**']
  pull_request:
    types: [opened, synchronize, reopened]
  schedule:
    - cron: '0 2 * * 1'    # Monday 2am UTC
  workflow_dispatch:        # Manual trigger
    inputs:
      environment:
        type: choice
        options: [dev, staging, prod]

# ── COMMON STEPS ──
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0        # Full history for versioning
      token: ${{ secrets.GITHUB_TOKEN }}

  - uses: actions/setup-node@v4
    with:
      node-version: '20'
      cache: 'npm'

  - uses: actions/setup-python@v5
    with:
      python-version: '3.12'
      cache: 'pip'

  - uses: actions/cache@v4
    with:
      path: ~/.gradle/caches
      key: gradle-${{ hashFiles('**/*.gradle*') }}

  - name: Upload artifact
    uses: actions/upload-artifact@v4
    with:
      name: build-output
      path: dist/
      retention-days: 7

  - name: Download artifact
    uses: actions/download-artifact@v4
    with:
      name: build-output
      path: dist/

# ── ENVIRONMENT AND SECRETS ──
env:
  NODE_ENV: production
  API_URL: ${{ vars.API_URL }}          # Repository variable (not secret)
  API_KEY: ${{ secrets.API_KEY }}        # Secret

# ── JOB DEPENDENCIES ──
jobs:
  test:
    runs-on: ubuntu-latest
  build:
    needs: test
  deploy:
    needs: [test, build]
    if: github.ref == 'refs/heads/main'

# ── MATRIX ──
strategy:
  matrix:
    node: [18, 20, 22]
    os: [ubuntu-latest, macos-latest]
  fail-fast: false

# ── OUTPUTS ──
jobs:
  build:
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - id: version
        run: echo "version=$(cat VERSION)" >> $GITHUB_OUTPUT
  deploy:
    needs: build
    steps:
      - run: echo "Deploying ${{ needs.build.outputs.version }}"
```

---

## Common Git Workflow Comparison

| Workflow | Best For | Branches | Merge Strategy | Cons |
|----------|----------|----------|----------------|------|
| **GitHub Flow** | Small teams, continuous delivery | `main` + short-lived feature branches | Squash merge | No release management |
| **Git Flow** | Versioned software releases | `main`, `develop`, `feature/*`, `release/*`, `hotfix/*` | Merge commits | Overhead for small teams |
| **Trunk-Based** | Large teams, CI/CD at scale | `main` (commits every day) + short feature branches (<2 days) | Merge or squash | Requires feature flags |
| **Forking Workflow** | Open source, external contributors | Fork + PR | Merge commit | Sync overhead |
| **Release Branches** | Multiple supported versions | `release/1.x`, `release/2.x` | Cherry-pick + merge | Backport complexity |

---

## Branch Protection Rules Checklist

### GitHub Branch Protection for `main`

```
✓ Require a pull request before merging
  ✓ Require approvals: 2
  ✓ Dismiss stale pull request approvals when new commits are pushed
  ✓ Require review from Code Owners
✓ Require status checks to pass before merging
  ✓ Require branches to be up to date before merging
  ✓ Status checks: ci/test, ci/lint, ci/security-scan
✓ Require conversation resolution before merging
✓ Require signed commits
✓ Require linear history (no merge commits — squash or rebase only)
✓ Do not allow bypassing the above settings
✓ Restrict who can push to matching branches: release-managers team
```

### CODEOWNERS File

```
# .github/CODEOWNERS

# Global owner (fallback)
*                          @org/platform-team

# Frontend
/src/frontend/             @org/frontend-team
/src/components/           @org/frontend-team

# Infrastructure
/terraform/                @org/sre-team
/cloudformation/           @org/sre-team
/.github/workflows/        @org/sre-team

# Security-sensitive files
/src/auth/                 @org/security-team
/src/crypto/               @org/security-team
SECURITY.md                @org/security-team

# Docs
/docs/                     @org/tech-writers
*.md                       @org/tech-writers
```

---

## Tricky Interview Questions — Git & GitHub

### Q: What is the difference between `git merge` and `git rebase`, and when should you choose each?

**Merge:** Creates a new merge commit that joins two branch histories. The history is non-linear but accurate — you can see exactly when branches diverged and rejoined. Safe for shared branches.

**Rebase:** Re-applies commits from one branch on top of another, rewriting SHA hashes. Produces a linear history. Never rebase shared/public branches — other collaborators' histories diverge.

**Decision rule:**
- On private feature branches: rebase onto `main` to keep history clean and linear
- On `main` or shared branches: merge (never rebase public history)
- Before opening a PR: rebase to incorporate latest `main`; squash WIP commits
- After a PR is approved: squash merge into `main` for clean one-commit-per-feature history

### Q: Explain how `git reset --soft`, `--mixed`, and `--hard` differ.

All three move the `HEAD` and branch pointer to the specified commit. The difference is in what happens to the index (staging area) and working tree:

| Flag | HEAD | Index (staging) | Working Tree |
|------|------|-----------------|--------------|
| `--soft` | Moved | Unchanged | Unchanged |
| `--mixed` (default) | Moved | Reset to HEAD | Unchanged |
| `--hard` | Moved | Reset to HEAD | Reset to HEAD |

Use `--soft` to recommit with a different message. Use `--mixed` to unstage and reorganize changes. Use `--hard` only when you want to permanently discard changes.

### Q: What is a detached HEAD, and how do you recover from it?

A detached HEAD means `HEAD` points directly to a commit SHA instead of pointing to a branch reference. Happens when you `git checkout <sha>` or `git checkout v1.0.0`.

In this state, new commits you make will become orphaned once you switch branches — they won't be reachable from any branch and will eventually be garbage collected.

```bash
# Check if you're in detached HEAD state
git status  # "HEAD detached at abc1234"

# Recovery — save your work before switching:
git checkout -b recovery-branch   # Create branch from current detached state
git checkout main                  # Now your commits are safe on recovery-branch

# If you already switched away and lost commits:
git reflog   # Find the SHA of your orphaned commits
git checkout -b recovery-branch <sha>
```


---

## Git Metrics and Analytics

### Repository Health Metrics

```bash
# Commit frequency by author (last 90 days)
git log --since="90 days ago" --format="%an" | sort | uniq -c | sort -rn | head -20

# Files changed most frequently (hotspots — high churn = risk)
git log --name-only --format="" | sort | uniq -c | sort -rn | head -20

# Average commit size (lines changed)
git log --stat --format="" | grep "changed" | \
  awk '{ins+=$4; del+=$6; commits++} END {print "avg insertions:", ins/commits, "deletions:", del/commits}'

# PR merge time analysis (requires gh CLI)
gh pr list --state merged --limit 100 --json number,createdAt,mergedAt \
  | jq '[.[] | {number: .number, days: ((.mergedAt | fromdateiso8601) - (.createdAt | fromdateiso8601)) / 86400}] | sort_by(.days) | reverse | .[0:10]'

# Code review coverage: PRs merged without review
gh pr list --state merged --limit 200 --json number,reviews \
  | jq '[.[] | select(.reviews | length == 0)] | length'
```

### GitHub Actions Cost and Efficiency Metrics

```bash
# Total Actions minutes used this month
gh api /repos/org/repo/actions/workflows \
  --jq '.workflows[] | {name: .name, id: .id}'

# Runner time by workflow
gh api /repos/org/repo/actions/runs \
  --jq '.workflow_runs[] | {name: .name, duration: .run_duration_ms, conclusion: .conclusion}' \
  | jq -s 'group_by(.name) | map({workflow: .[0].name, avg_ms: (map(.duration) | add/length), runs: length})'

# Flaky test detection: jobs that sometimes fail, sometimes pass
gh run list --limit 500 --json name,conclusion \
  | jq 'group_by(.name) | map({job: .[0].name, failures: (map(select(.conclusion=="failure")) | length), total: length})' \
  | jq '.[] | select(.failures > 0 and .failures < .total)'
```

---

## Advanced GitHub Patterns

### Dependabot Configuration

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "09:00"
      timezone: UTC
    open-pull-requests-limit: 5
    groups:
      dev-dependencies:
        patterns: ["@types/*", "eslint*", "jest*"]
        update-types: ["minor", "patch"]
    ignore:
      - dependency-name: "react"
        versions: [">=19.0.0"]   # Not ready for React 19 yet

  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

### Required Status Checks with Skip for Docs

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
  pull_request:

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      code: ${{ steps.filter.outputs.code }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            code:
              - 'src/**'
              - 'tests/**'
              - '*.json'
              - '*.lock'

  test:
    needs: detect-changes
    if: needs.detect-changes.outputs.code == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  # Required status check that always passes for docs-only PRs
  ci-pass:
    needs: [detect-changes, test]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Check CI result
        run: |
          if [[ "${{ needs.test.result }}" == "failure" ]]; then
            exit 1
          fi
          echo "CI passed (or skipped for docs-only change)"
```

---

## Process/Coding Patterns for Git (professional.md)

### Object Database Exploration

```bash
# Walk the full object graph from HEAD
git rev-parse HEAD                         # Get HEAD commit SHA
git cat-file -t <commit-sha>               # → commit
git cat-file -p <commit-sha>               # → tree SHA, parent SHA, author, message

git cat-file -p <tree-sha>                 # → list of blob/tree entries
# 100644 blob <sha>    README.md
# 040000 tree <sha>    src
# 100755 blob <sha>    scripts/deploy.sh

git cat-file -p <blob-sha>                 # → raw file content

# Verify object integrity
git fsck --full                            # Check all objects for corruption
git fsck --lost-found                      # Find unreachable (orphaned) objects

# Count objects by type
git cat-file --batch-all-objects --batch-check='%(objecttype)' | sort | uniq -c
```

### Plumbing Command Workflow

```bash
# Build a commit entirely from plumbing commands (no porcelain)

# Step 1: Create a blob object
BLOB_SHA=$(printf "Hello, World\n" | git hash-object -w --stdin)
echo "Blob SHA: $BLOB_SHA"

# Step 2: Create a tree object referencing the blob
git update-index --add --cacheinfo 100644,"$BLOB_SHA",hello.txt
TREE_SHA=$(git write-tree)
echo "Tree SHA: $TREE_SHA"

# Step 3: Create a commit object
COMMIT_SHA=$(echo "Initial commit via plumbing" | git commit-tree "$TREE_SHA")
echo "Commit SHA: $COMMIT_SHA"

# Step 4: Point a branch at the new commit
git update-ref refs/heads/plumbing-demo "$COMMIT_SHA"
git log plumbing-demo --oneline
```

### POSIX File Locking in Git

```bash
# Git uses lock files to prevent concurrent writes to index and refs
# .git/index.lock — held during git add, git reset, git checkout
# .git/refs/heads/main.lock — held during git update-ref

# Why lock files? POSIX rename() is atomic — git writes to .lock then renames
# This prevents corruption if two git processes run simultaneously

# Stuck lock file (from a killed git process)
ls -la .git/*.lock .git/refs/heads/*.lock 2>/dev/null
# If found and no git process is running:
rm .git/index.lock

# Verify no git processes are actually running before removing
lsof .git/index.lock 2>/dev/null || echo "No process holds the lock"
```

---

## Git Security Considerations

### Preventing Secret Leaks

```bash
# Install pre-commit framework with secret detection
pip install pre-commit
cat > .pre-commit-config.yaml << 'EOF'
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: detect-aws-credentials
      - id: detect-private-key
EOF
pre-commit install

# Scan entire git history for secrets (run after a suspected leak)
gitleaks detect --source . --log-opts="--all"

# If a secret was committed, remove it from ALL history:
git filter-repo --path secrets.env --invert-paths
# This rewrites all SHAs — everyone must re-clone
# Rotate the exposed credentials immediately regardless
```

### Signing Commits and Verifying Provenance

```bash
# GitHub Artifact Attestation (2024+)
# Generates SLSA provenance attestation in GitHub Actions
- name: Attest build provenance
  uses: actions/attest-build-provenance@v1
  with:
    subject-path: dist/myapp-*

# Verify attestation before deploying
gh attestation verify ./dist/myapp-linux-amd64 \
  --owner myorg \
  --format json | jq '.[] | {signer: .verificationResult.signature.certificate.subjectAlternativeName, workflow: .verificationResult.statement.predicate.buildDefinition.buildType}'
```

---

## Level Comparison Matrix

| Dimension | Junior | Middle | Senior | Professional |
|-----------|--------|--------|--------|--------------|
| **Commit quality** | Writes commits | Conventional Commits + scope | Squash strategy, atomic commits | Object-level understanding |
| **Branching** | Uses feature branches | Designs branching strategies | Trunk-based + feature flags | Reflog/DAG internals |
| **CI/CD** | Reads workflows | Writes workflows | Reusable workflows, matrix | Protocol tracing, pack optimization |
| **Recovery** | `git status`, undo | Bisect, reflog basics | Full disaster recovery | POSIX locking, fsck, filter-repo |
| **Security** | `.gitignore` | pre-commit hooks | CODEOWNERS, signed commits | Provenance attestation, history audit |
| **Performance** | N/A | Caching in CI | Shallow clone, sparse checkout | Pack files, partial clone, maintenance |


---

## Git Performance Tips

### Large File Handling

```bash
# Check what's making your repo large
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize:disk) %(rest)' | \
  grep '^blob' | sort -k3 -n -r | head -20 | \
  awk '{printf "%.2f MB\t%s\n", $3/(1024*1024), $4}'

# Git LFS — track large files with pointer storage
git lfs install
git lfs track "*.psd" "*.mp4" "*.zip" "*.tar.gz"
git lfs track "assets/videos/**"
git add .gitattributes
git commit -m "chore: configure Git LFS for binary assets"

# Migrate existing large files to LFS (rewrites history)
git lfs migrate import --include="*.mp4,*.zip" --everything

# Check LFS status
git lfs status
git lfs ls-files
```

### Repository Size Reduction

```bash
# Verify repo size before and after
git count-objects -vH

# Remove a large file that was accidentally committed
git filter-repo --path large-dump.sql --invert-paths --force

# Remove a directory from history
git filter-repo --path secrets/ --invert-paths --force

# After filter-repo: force push all branches (coordinate with team)
git push origin --force --all
git push origin --force --tags

# Expire reflog and aggressive GC to actually reclaim space
git reflog expire --expire=now --all
git gc --aggressive --prune=now
```

---

## GitHub Repository Settings Best Practices

### Repository Configuration Checklist

```
Branch Protection (main):
  ✓ Require PR reviews (min 2 reviewers)
  ✓ Dismiss stale reviews on new commits
  ✓ Require CODEOWNERS review
  ✓ Required status checks (CI tests, linting)
  ✓ Require branches up to date
  ✓ Require signed commits
  ✓ Restrict pushes to release managers only
  ✓ No force push, no deletion

Security:
  ✓ Enable Dependabot alerts
  ✓ Enable Dependabot security updates
  ✓ Enable secret scanning
  ✓ Enable push protection (blocks secrets before push)
  ✓ Enable code scanning (CodeQL or third-party)

General:
  ✓ Default branch: main
  ✓ Allow squash merging (preferred for linear history)
  ✓ Allow merge commits (for merging release branches)
  ✓ Disallow rebase merging (confusing for most teams)
  ✓ Auto-delete head branches on PR merge
  ✓ Wikis disabled (use docs/ folder instead)
  ✓ Issues enabled with templates configured
  ✓ Projects enabled for roadmap tracking
```

---

## GitHub Issue and PR Templates

### PR Template

```markdown
<!-- .github/pull_request_template.md -->
## Summary
<!-- What does this PR do? Link to the related issue. -->
Closes #

## Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Refactor (no functional change)
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed (describe steps)

## Checklist
- [ ] My code follows the style guide (linter passes)
- [ ] I have added/updated documentation
- [ ] I have not committed any secrets or credentials
- [ ] The PR title follows Conventional Commits format
- [ ] I have assigned a reviewer and relevant label
```

### Bug Report Issue Template

```yaml
# .github/ISSUE_TEMPLATE/bug_report.yml
name: Bug Report
description: Report a reproducible bug
labels: [bug, needs-triage]
body:
  - type: textarea
    id: description
    attributes:
      label: Bug Description
      description: Clear description of the bug
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Steps to Reproduce
      placeholder: |
        1. Go to '...'
        2. Click on '...'
        3. See error
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
    validations:
      required: true
  - type: dropdown
    id: severity
    attributes:
      label: Severity
      options: [Critical, High, Medium, Low]
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Version
      placeholder: "e.g. v2.1.3"
    validations:
      required: true
```


---

## Summary

Git and GitHub form the backbone of modern software development. Mastery progresses from understanding the three trees (working directory, index, repository), through branching strategies and CI/CD pipelines, to the internal object model that makes Git a content-addressable filesystem with cryptographic integrity.

| Level | Key Milestone |
|-------|--------------|
| Junior | Write clean commits; use feature branches; resolve merge conflicts |
| Middle | Design branching strategies; write GitHub Actions; use interactive rebase |
| Senior | Architect CI/CD pipelines; implement trunk-based development; perform large repo maintenance |
| Professional | Understand pack file delta compression; trace protocol negotiation; audit and rewrite history safely |

The most important Git skill at every level: **commit atomically, communicate clearly in commit messages, and never force-push to shared branches without coordination.**

### Anti-Patterns to Avoid

| Anti-Pattern | Why It Hurts | Better Practice |
|-------------|-------------|-----------------|
| Committing directly to `main` | Bypasses review; breaks CI for others | Always use feature branches + PR |
| "Mega commits" (1000+ line changes) | Impossible to review or bisect | One logical change per commit |
| Storing secrets in git | Permanent — removal requires full history rewrite | Secret scanning + pre-commit hooks |
| Long-lived feature branches | Massive merge conflicts | Short branches (< 3 days) + feature flags |
| Force-pushing to shared branches | Breaks collaborators' local history | `--force-with-lease` only on personal branches |
| Skipping pre-commit hooks (`--no-verify`) | Lets broken code bypass quality gates | Fix the root cause, never skip |
| Tagging without signing | Release integrity cannot be verified | Always use annotated signed tags for releases |
| No `.gitignore` | Leaks build artifacts, IDE configs, secrets | Template from gitignore.io at repo creation |
---
---

# TEMPLATE 9 — `specification.md`

> **Focus:** Official documentation deep-dive — standards references, framework specifications, official guidelines, and version compatibility.
>
> **Source:** Always cite the official documentation or standards with direct section links.
> - AI Red Teaming: https://airc.nist.gov/Docs | https://owasp.org/www-project-ai-security-and-privacy-guide/
> - Cyber Security: https://owasp.org/www-project-top-ten/ | https://csrc.nist.gov/
> - Code Review: https://google.github.io/eng-practices/review/
> - Engineering Manager: https://www.manager-tools.com/ | https://lethain.com/staff-engineer/
> - QA: https://www.istqb.org/certifications/ | https://testing.googleblog.com/
> - Technical Writer: https://developers.google.com/tech-writing | https://www.writethedocs.org/guide/
> - Product Manager: https://www.svpg.com/inspired/ | https://www.productboard.com/resources/
> - DevRel: https://www.devrel.agency/resources | https://www.commonroom.io/resources/
> - AWS: https://docs.aws.amazon.com/ | https://aws.amazon.com/architecture/
> - Git/GitHub: https://git-scm.com/docs | https://docs.github.com/

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Specification

> **Official Documentation / Standards Reference**
>
> Source: [{{SOURCE_NAME}}]({{DOCS_URL}}) — {{SECTION}}

---

## Table of Contents

1. [Reference](#reference)
2. [Official Framework / Standard](#official-framework--standard)
3. [Core Rules & Guidelines](#core-rules--guidelines)
4. [Process / Workflow Specification](#process--workflow-specification)
5. [Metrics & Measurement](#metrics--measurement)
6. [Common Scenarios & Responses](#common-scenarios--responses)
7. [Version & Evolution History](#version--evolution-history)
8. [Official Examples & Case Studies](#official-examples--case-studies)
9. [Compliance Checklist](#compliance-checklist)
10. [Related Resources](#related-resources)

---

## 1. Reference

| Property | Value |
|----------|-------|
| **Official Source** | [{{SOURCE_NAME}}]({{DOCS_URL}}) |
| **Relevant Section** | {{SECTION_NAME}} — {{SECTION_TITLE}} |
| **Standard / Version** | {{STANDARD_VERSION}} |
| **Direct URL** | {{DOCS_URL}}/{{PATH}} |

---

## 2. Official Framework / Standard

> From: {{DOCS_URL}}/{{FRAMEWORK_SECTION}}

### {{FRAMEWORK_OR_STANDARD_NAME}}

{{FRAMEWORK_DESCRIPTION}}

| Component | Purpose | Official Guidance |
|-----------|---------|------------------|
| {{COMP_1}} | {{PURPOSE_1}} | [Link]({{URL_1}}) |
| {{COMP_2}} | {{PURPOSE_2}} | [Link]({{URL_2}}) |
| {{COMP_3}} | {{PURPOSE_3}} | [Link]({{URL_3}}) |

---

## 3. Core Rules & Guidelines

### Guideline 1: {{GUIDELINE_NAME}}

> *Source: [{{DOCS_URL}}/{{SECTION}}]({{DOCS_URL}}/{{SECTION}}) — "{{DOC_QUOTE}}"*

{{GUIDELINE_EXPLANATION}}

**✅ Good practice:**
{{GOOD_EXAMPLE}}

**❌ Anti-pattern:**
{{BAD_EXAMPLE}}

### Guideline 2: {{GUIDELINE_NAME}}

> *Source: [{{DOCS_URL}}/{{SECTION}}]({{DOCS_URL}}/{{SECTION}})*

{{GUIDELINE_EXPLANATION}}

---

## 4. Process / Workflow Specification

### Official Process Flow

```
{{PROCESS_STEP_1}}
    ↓
{{PROCESS_STEP_2}}
    ↓
{{PROCESS_STEP_3}}
    ↓
{{PROCESS_STEP_4}}
```

| Stage | Official Requirement | Notes |
|-------|---------------------|-------|
| {{STAGE_1}} | {{REQ_1}} | {{NOTES_1}} |
| {{STAGE_2}} | {{REQ_2}} | {{NOTES_2}} |

---

## 5. Metrics & Measurement

| Metric | Official Definition | Target / Benchmark | Reference |
|--------|--------------------|--------------------|-----------|
| {{METRIC_1}} | {{DEF_1}} | {{TARGET_1}} | [Link]({{URL_1}}) |
| {{METRIC_2}} | {{DEF_2}} | {{TARGET_2}} | [Link]({{URL_2}}) |
| {{METRIC_3}} | {{DEF_3}} | {{TARGET_3}} | [Link]({{URL_3}}) |

---

## 6. Common Scenarios & Responses

| Scenario | Official Guidance | Reference |
|----------|-------------------|-----------|
| {{SCENARIO_1}} | {{GUIDANCE_1}} | [Docs]({{URL_1}}) |
| {{SCENARIO_2}} | {{GUIDANCE_2}} | [Docs]({{URL_2}}) |
| {{SCENARIO_3}} | {{GUIDANCE_3}} | [Docs]({{URL_3}}) |

---

## 7. Version & Evolution History

| Version / Edition | Change | Year | Notes |
|------------------|--------|------|-------|
| {{VER_1}} | {{CHANGE_1}} | {{YEAR_1}} | {{NOTES_1}} |
| {{VER_2}} | {{CHANGE_2}} | {{YEAR_2}} | {{NOTES_2}} |

---

## 8. Official Examples & Case Studies

### Example: {{EXAMPLE_TITLE}}

> Source: [{{DOCS_URL}}/{{ANCHOR}}]({{DOCS_URL}}/{{ANCHOR}})

{{EXAMPLE_DESCRIPTION}}

**Outcome / Result:**
{{EXPECTED_OUTCOME}}

---

## 9. Compliance Checklist

- [ ] Follows official recommended approach for {{TOPIC_NAME}}
- [ ] Aligned with standard version ({{STANDARD_VERSION}})
- [ ] Covers all required process stages
- [ ] Metrics are tracked per official guidance
- [ ] Common scenarios handled per official recommendations
- [ ] Team/stakeholder requirements met

---

## 10. Related Resources

| Topic | Source | URL |
|-------|--------|-----|
| {{RELATED_1}} | {{SOURCE_1}} | [Link]({{URL_1}}) |
| {{RELATED_2}} | {{SOURCE_2}} | [Link]({{URL_2}}) |
| {{RELATED_3}} | {{SOURCE_3}} | [Link]({{URL_3}}) |

---

> **Content Rules for `specification.md`:**
> - Always link directly to the relevant section of the official source (not just the homepage)
> - Use the most authoritative and widely accepted official standard or framework
> - Include measurable metrics where official standards define them
> - Document process flows using official terminology
> - Note when standards or best practices have evolved over time
> - Minimum 2 Core Guidelines, 3 Metrics, 3 Scenarios, 2 Official Examples

</details>
