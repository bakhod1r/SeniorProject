# Workspaces — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Workspaces vs `replace`: A Decision Framework](#workspaces-vs-replace-a-decision-framework)
3. [The Multi-Team Monorepo](#the-multi-team-monorepo)
4. [CI Strategy: Two Builds Per PR](#ci-strategy-two-builds-per-pr)
5. [Release Engineering Across Modules](#release-engineering-across-modules)
6. [The "Trunk + Releasable Modules" Architecture](#the-trunk--releasable-modules-architecture)
7. [Cross-Module Refactors at Scale](#cross-module-refactors-at-scale)
8. [Workspace Boundaries: When to Split](#workspace-boundaries-when-to-split)
9. [Avoiding Workspace-Induced Tight Coupling](#avoiding-workspace-induced-tight-coupling)
10. [Reproducibility, Audit, and Provenance](#reproducibility-audit-and-provenance)
11. [Anti-Patterns at this Level](#anti-patterns-at-this-level)
12. [Senior-Level Checklist](#senior-level-checklist)
13. [Summary](#summary)

---

## Introduction

A senior engineer's job is not to create a workspace — that is one command — but to decide *whether* a workspace is the right answer in the first place, and to design the surrounding processes so the workspace remains a friend over years rather than a slow source of incoherence. The mechanical surface area is small; the organisational implications can be large.

After reading this you will:

- Apply an explicit framework to choose between workspaces, `replace`, vendoring, and "publish more often"
- Design a CI matrix that keeps a multi-module repo honest
- Run release engineering for several inter-dependent modules without losing sleep
- Avoid the most common organisational anti-patterns workspaces enable

This file is about *governance and architecture*. The mechanics are in [junior.md](junior.md) and [middle.md](middle.md).

---

## Workspaces vs `replace`: A Decision Framework

Both workspaces and `replace` directives can substitute one module for another. Choosing between them is a senior decision. Use this matrix.

| Question | Answer | Recommendation |
|----------|--------|----------------|
| Is the substitution permanent (will be released)? | yes | `replace` in the consuming `go.mod` (rare) — or, better, publish the fork as a new module |
| Is the substitution permanent (will be released)? | no | `replace` in `go.work`, or `use` if you have the module locally |
| Are there many consumers in the same repo? | yes | `go.work` with `use` — one swap, all consumers benefit |
| Are there many consumers in the same repo? | no | a single `replace` in the one consumer's `go.mod` is fine |
| Will the substitution survive a `git push`? | yes | `go.mod` (the file is part of the published artefact) |
| Will the substitution survive a `git push`? | no | `go.work` (gitignored) — never makes it past your laptop |

The hierarchy from most-to-least-public:

1. Republish under a new module path (most public, most disciplined).
2. `replace` in `go.mod` (public, durable, easy to forget).
3. `use` in `go.work` (private to a team or laptop, scoped, recommended for multi-module dev).
4. `replace` in `go.work` (private, one-off swap of a third-party module).

The default for "I want to develop two modules together" is option 3. The default for "I shipped a critical fix to upstream and they have not tagged" is option 1 if upstream is dead, option 2 if they have agreed to merge, option 4 if it is a hotfix you will revert next week.

---

## The Multi-Team Monorepo

A monorepo with five teams and twenty modules has different needs from a two-person library project. Senior decisions cluster around three axes:

### Axis 1 — One workspace or several?

A single repo-wide `go.work` listing all twenty modules is conceptually simple but operationally heavy: every module's tests can fail when any other module changes. You also force every contributor to have every module checked out and buildable.

A more scalable pattern is **per-area workspaces**: each team owns a sub-tree with its own `go.work` for the modules they coordinate on. Cross-team interfaces are released as published versions, not pulled in via the workspace.

```
mono/
├── auth/
│   ├── go.work         # auth team's workspace (their three modules)
│   ├── service/
│   ├── tokens/
│   └── ldap-bridge/
├── billing/
│   ├── go.work         # billing team's workspace (their two modules)
│   ├── service/
│   └── invoicing/
└── shared/
    ├── go.mod          # repo-wide shared library, no workspace
    └── ...
```

Cross-team consumption goes through `go get example.com/mono/shared@v0.4.0` — a real version, not a workspace `use`.

### Axis 2 — Commit `go.work` or not?

In a tight monorepo with consistent layout, commit it. In a sprawling polyrepo or a federated monorepo where teams own sub-trees, gitignore the team-level workspaces and commit only `go.work.example` files.

### Axis 3 — Who is allowed to add a `replace` to `go.work`?

A workspace `replace` is a force multiplier. One line can re-route every module's view of a dependency. Senior governance: gate workspace `replace` lines behind code review the same way you gate `go.mod` `replace`. Add a CI rule that comments on PRs touching `go.work` lines starting with `replace`.

---

## CI Strategy: Two Builds Per PR

The single most important CI insight for workspaces:

> **Run two builds: one with the workspace, one without.**

The two builds answer different questions.

### Build A — Workspace on (`GOWORK=auto` or default)

This is the build the developer ran on their laptop. It catches:

- Code-level integration bugs across modules.
- Tests that span modules.
- Linter violations.

It does **not** catch release-ordering bugs, because the workspace masks them.

### Build B — Workspace off (`GOWORK=off`), per module

For each listed module, `cd` into it and:

```bash
GOWORK=off go build ./...
GOWORK=off go test ./...
GOWORK=off go vet ./...
```

This is the build a downstream consumer will see. It catches:

- A module's `go.mod` requires an unpublished feature of a sibling.
- A `go work sync` was missed before merge.
- Indirect dependencies drifted.

A typical GitHub Actions matrix:

```yaml
jobs:
  workspace-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go test ./...
        env:
          GOWORK: auto

  isolated-build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        module: [server, auth, billing]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go test ./...
        working-directory: ${{ matrix.module }}
        env:
          GOWORK: off
```

Both must pass. The second is the gate that protects consumers.

### Bonus: a "tidy is clean" check

```yaml
- name: Verify go.work and go.mod are tidy
  run: |
    go work sync
    git diff --exit-code go.work
    for m in server auth billing; do
      (cd $m && GOWORK=off go mod tidy)
    done
    git diff --exit-code '*/go.mod' '*/go.sum'
```

If `go work sync` or `go mod tidy` produces a diff, the build fails. Engineers must commit the changes before merge.

---

## Release Engineering Across Modules

A multi-module workspace makes day-to-day development easy, but it concentrates the release-engineering complexity at tag time. The senior playbook:

### 1. Topological sort the modules

If `server` depends on `auth`, and `auth` depends on `shared`, the release order is `shared → auth → server`. Lower modules tag first; their tagged versions are pulled into the higher modules' `go.mod` before those tag.

### 2. Decide on tag naming

In a multi-module repo, tags are prefixed with the module subdirectory:

- `shared/v0.5.0`
- `auth/v0.4.0`
- `server/v1.2.0`

The Go toolchain understands this prefix when the module path matches. Document the convention in your repo's `RELEASE.md`.

### 3. Automate the cascade

A typical release script:

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Verify isolated builds
for m in shared auth server; do
    (cd "$m" && GOWORK=off go build ./... && GOWORK=off go test ./...)
done

# 2. Tag in topological order
git tag shared/v0.5.0 && git push origin shared/v0.5.0
sleep 30   # let proxy pick up the tag

(cd auth && go get example.com/proj/shared@v0.5.0)
git commit -am "auth: bump shared to v0.5.0" && git push
git tag auth/v0.4.0 && git push origin auth/v0.4.0
sleep 30

(cd server && go get example.com/proj/auth@v0.4.0)
git commit -am "server: bump auth to v0.4.0" && git push
git tag server/v1.2.0 && git push origin server/v1.2.0
```

The `sleep 30` between tag and consumer-side `go get` is to give the module proxy time to discover the tag. (For private setups, this is unnecessary.)

### 4. Pre-flight check

Before triggering the cascade, run a `GOWORK=off` build *as if* every previous tag had been bumped. If anything fails, fix before tagging.

### 5. Document the inverse: rollback

What if `auth/v0.4.0` is broken in a way `shared/v0.5.0` cannot fix? Document the rollback: re-tag `auth/v0.4.1` with the fix, then bump `server` again. Avoid tag deletion — Go's proxy caches retracted tags but the experience is messy.

---

## The "Trunk + Releasable Modules" Architecture

A common monorepo pattern combines a workspace at the trunk with selectively releasable modules.

```
mono/
├── go.work               # lists everything, gitignored (or example only)
├── pkg/
│   ├── shared/           # released as example.com/mono/pkg/shared
│   ├── tokens/           # released as example.com/mono/pkg/tokens
│   └── billing/          # released as example.com/mono/pkg/billing
└── cmd/
    ├── api/              # an internal binary, never released
    └── worker/           # an internal binary, never released
```

The workspace exists for development convenience: every developer can edit `pkg/shared` and see the change in `cmd/api` instantly. The releasable modules under `pkg/` are tagged and consumed by *external* projects.

The `cmd/` modules are deliberately not released; they are deployed as binaries from the repo's CI. They consume `pkg/*` via the workspace at dev time and via published versions at release time.

This separation — releasable libraries vs internal binaries — is the cleanest workspace shape we know of for backend monorepos.

---

## Cross-Module Refactors at Scale

The killer feature of workspaces is making cross-module refactors safe and atomic. To rename a function in `shared` and update every consumer in the same PR:

```bash
cd ~/proj                         # workspace root
gopls rename ./shared/util.go:OldName=NewName
go test ./...                     # all modules tested with the rename
```

`gopls` is workspace-aware: the rename touches every module. Without a workspace, you would either (a) tag a new version of `shared`, bump every consumer, and rename in three PRs over two days, or (b) use `replace` directives and risk shipping them.

### When the refactor crosses module boundaries with breaking semantics

If the rename is part of a breaking change (signature change, return type, etc.), tag the change as a new major version of `shared`. The workspace lets you validate every consumer compiles against the new major before you publish:

```bash
cd ~/proj
go work edit -replace=example.com/mono/pkg/shared=./pkg/shared/v2
# build every consumer
go build ./...
```

Once green, publish `pkg/shared/v2` and let consumers migrate at their own pace. Drop the workspace `replace` once everyone is on v2.

---

## Workspace Boundaries: When to Split

A workspace is a logical grouping. Sometimes the right architectural answer is *more* workspaces, not one giant one.

### Symptoms a workspace has grown too big

- `go test ./...` at the workspace root takes longer than ten minutes.
- A change in module A regularly breaks tests in unrelated module Z.
- Engineers complain that they have to keep modules they never touch checked out.
- The workspace's `go.work` has more than a dozen `use` directives.
- CI matrix expansion is impractical.

### How to split

Identify natural seams: which modules are tightly coupled (same team, frequent cross-edits) vs loosely coupled (different teams, communicate through versioned interfaces)?

- Tightly coupled: keep in one workspace.
- Loosely coupled: split into separate workspaces or even separate repos.

The split is non-disruptive: each workspace is just a `go.work` file. Add new ones, remove modules from the old one, and continue.

---

## Avoiding Workspace-Induced Tight Coupling

A workspace makes "import a sibling" friction-free. That is excellent for development but a *risk* for architecture. If every team imports every other team's internal types directly, the modules' published interfaces stop being load-bearing — only the local layout works.

### Symptoms

- A module's exported API is small but its internal package surface is large and freely consumed by siblings.
- Removing a single line in a "core" module breaks ten others.
- Consumers cannot use the published version because they never tested it without the workspace.

### Mitigation

- **Treat each module's published API as a contract, even between siblings.** Internal packages (`internal/`) should remain internal even when the workspace makes "internal" technically reachable.
- **Run `GOWORK=off` builds in CI for every module, every PR.** This is the only way to keep each module's published surface honest.
- **Periodically review module-level `go.mod` changes.** A sudden increase in `require` lines often indicates over-coupling.

A useful mental model: the workspace is a *develop-time fiction*. The release boundary is real. Code that crosses the workspace must be designed as if it crossed a published version boundary — because eventually it will.

---

## Reproducibility, Audit, and Provenance

Workspaces complicate reproducibility because the build's input set depends on local files outside any one module.

### Strategies

- **Pin the workspace.** If `go.work` is committed and `go.work.sum` is committed, two developers with the same checkout get the same workspace build.
- **Disable workspaces for the canonical release artefact.** Release binaries should be built with `GOWORK=off` from the relevant module. This makes the build a function of `go.mod` + `go.sum` alone, which is easy to audit.
- **Emit provenance metadata.** Tools like `go version -m binary` show what versions ended up in the binary. For a workspace build, this includes the local module paths.

### SBOM considerations

If you produce SBOMs (CycloneDX, SPDX), make them from the released module, not from a workspace build. A workspace SBOM is a snapshot of one developer's machine; a published SBOM is a property of the published artefact.

### Audit trail

For supply-chain compliance, treat workspace `replace` lines as risk-bearing. They are not in the released `go.mod`, but they were in the build at some point. If a workspace `replace` introduced a vulnerability that survived as a local-only patch into a release, you have a hard story to tell. A compensating control: forbid workspace `replace` lines in CI by parsing `go.work` and failing on any.

---

## Anti-Patterns at this Level

### Anti-pattern 1 — One giant workspace at the org root

Every team's modules listed in one `go.work`. CI rebuilds everything on every PR. Engineers rebuild dozens of unrelated modules locally. Split.

### Anti-pattern 2 — Workspace as substitute for releases

A team avoids tagging modules entirely because "the workspace handles it." External consumers are stuck on six-month-old tags. Tag releases regularly; treat the workspace as a development tool, not a release strategy.

### Anti-pattern 3 — Workspace `replace` becomes permanent

A workspace `replace` was added "just for a week" two years ago. It is now load-bearing. The fork it points at has diverged from upstream. Audit and remove every quarter.

### Anti-pattern 4 — `GOWORK=off` only in release CI

Only the release pipeline runs the isolated build. PRs pass; release fails. Add `GOWORK=off` to PR CI as well.

### Anti-pattern 5 — Workspace listed in published `go.mod`

This cannot happen — `go.mod` does not have a `use` directive — but the variant *does* happen: a `replace` in `go.mod` pointing at a sibling path that only exists in the workspace layout. Consumers who clone only one module fail to build. Move all such `replace` lines to `go.work`.

### Anti-pattern 6 — Hand-edited `go.work.sum`

Same as `go.sum`: never edit by hand. Regenerate.

### Anti-pattern 7 — Different workspaces in different branches

A feature branch has its own `go.work` listing extra modules; the main branch does not. Merging is a nightmare. Either commit both or neither, but pick one and stick to it.

---

## Senior-Level Checklist

Before claiming workspace mastery in a multi-team setting:

- [ ] You can articulate when a workspace is the wrong answer.
- [ ] You have a CI strategy with both workspace-on and workspace-off builds.
- [ ] Your release process has an explicit topological order and a `GOWORK=off` pre-flight.
- [ ] You have a policy on commit-vs-gitignore for `go.work` documented in your repo.
- [ ] You have audited every workspace `replace` directive in the last quarter.
- [ ] You can describe the relationship between workspaces and SBOM/provenance.
- [ ] You have an architectural plan for splitting a workspace when it grows too large.
- [ ] You treat `internal/` boundaries as real even though the workspace makes them porous.

---

## Summary

A workspace is one command at junior level, a workflow at middle level, and an architectural decision at senior level. The two highest-leverage senior moves are: (1) running both workspace-on and workspace-off builds in CI, so release-time bugs cannot hide; and (2) keeping the workspace's `replace` directives under code-review discipline equivalent to `go.mod` ones. Beyond that, treat the workspace as a develop-time convenience layered over real releases, never as a substitute for them. The release boundary is where the workspace's helpfulness ends and where consumers' reality begins; a senior engineer's job is to keep those two views aligned.
