# Minimal Version Selection (MVS) — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Which version of a dependency does my build actually use?" and "Why does Go pick the *oldest* version that works instead of the newest?"

When your `go.mod` says `require github.com/some/lib v1.2.0`, and that library's own `go.mod` says it needs `github.com/other/dep v1.5.0`, Go has to decide which exact version of `other/dep` your build compiles against. The rule it uses is called **Minimal Version Selection**, usually written **MVS**.

The name tells you almost everything. When several parts of your dependency graph each ask for a *different minimum* version of the same module, Go picks the **highest of those minimums** — and nothing higher. It does not jump to the latest release on the internet. It does not solve a puzzle to find the "best" combination. It takes the largest version anyone explicitly asked for, and stops there.

That sounds backwards the first time you hear it. Most package managers you may have met — npm, Cargo, Bundler, pip — try to give you the *newest* compatible version. Go deliberately does the opposite. The payoff is that your build is **reproducible** and **boring**: the same `go.mod` always produces the same versions, today and in five years, with no lockfile and no surprises.

```bash
go list -m all
```

That one command prints the *build list* — the final, chosen version of every module in your build. MVS is the algorithm that produces that list.

After reading this file you will:
- Understand what "minimum version" really means (and what it does *not* mean)
- Know how Go builds the *build list* from `require` directives
- Understand why MVS gives reproducible builds without a lockfile
- Read the output of `go list -m all` and `go mod graph`
- Know what `go get foo@v1.2.3` does and how it changes the build list
- Predict which version of a shared dependency your build will use

You do **not** need to understand the formal four-operation algorithm, pseudo-versions, or graph pruning yet. This file is about the moment you say "wait — *why* did Go pick `v1.5.0` and not `v1.9.0`?"

---

## Prerequisites

- **Required:** A working Go installation, version 1.16 or newer. Modules are the default; MVS is always in effect. Check with `go version`.
- **Required:** A Go module — a folder with a `go.mod` file. If you are unsure, see [01-go-mod-init/junior.md](../01-go-mod-init/junior.md).
- **Required:** Familiarity with `go.mod` and the `require` directive. See [02-go-mod-tidy/junior.md](../02-go-mod-tidy/junior.md).
- **Required:** Comfort reading semantic version numbers like `v1.4.2` (major.minor.patch).
- **Helpful:** Having added at least one dependency with `go get`, so you have a non-trivial `go.mod` to inspect.

If `go version` prints `go1.16` or higher, you are ready. The behaviour described here has been stable since Go 1.11, when modules were introduced.

---

## Glossary

| Term | Definition |
|------|-----------|
| **MVS** | Minimal Version Selection. The algorithm that chooses one version per module: the highest version explicitly required anywhere in the graph. |
| **Build list** | The final set of `(module, version)` pairs your build actually uses — one version per module. Printed by `go list -m all`. |
| **Module graph** | The directed graph of "module A at version X requires module B at version Y," built from every involved `go.mod`. |
| **`require` directive** | A line in `go.mod` declaring a dependency and its *minimum* version, e.g. `require example.com/foo v1.2.0`. |
| **Main module** | The module you are building — the one whose `go.mod` is at the root of your project. |
| **Transitive dependency** | A dependency of a dependency. MVS considers the whole transitive graph. |
| **`// indirect`** | A comment on a `require` line meaning "this module is needed, but my own code does not import it directly." |
| **Selected version** | The version MVS chose for a module — the one in the build list. |
| **Semantic version** | A version like `v1.4.2`: `v` + major.minor.patch. Higher numbers are "newer." |
| **`go.sum`** | The file recording cryptographic hashes of the exact module bytes used. MVS chooses *which* version; `go.sum` verifies *those bytes*. |

---

## Core Concepts

### "Minimum version" means "the minimum that satisfies everyone"

This is the phrase that confuses everyone, so read it slowly.

A `require` line is not a request for *exactly* that version. It is a request for *at least* that version. `require example.com/foo v1.2.0` means: "I need `foo`, and it must be `v1.2.0` or newer — `v1.2.0` is my floor."

Now imagine three different places in your dependency graph each set a floor for the same module `foo`:

- Your `go.mod` says `foo v1.2.0`.
- A library you use says `foo v1.4.0`.
- Another library says `foo v1.3.0`.

Each of those is a *minimum*. To satisfy all three at once, the build needs a version that is at least `v1.4.0` (the highest floor). MVS picks exactly `v1.4.0` — the **highest of the minimums**. It does not go higher, even if `v1.9.0` exists on the internet. Nobody asked for `v1.9.0`, so `v1.9.0` is not used.

That is the entire algorithm in one sentence: **for each module, select the maximum version that anyone explicitly required.**

### MVS picks the *minimum* needed, not the *maximum* available

Other tools ask, "what is the newest version compatible with all the constraints?" Go asks, "what is the oldest version that everyone agreed is good enough?" The difference is enormous in practice:

- With a "newest" tool, running install today versus tomorrow can give you *different* versions, because a new release appeared overnight. Your build is a moving target.
- With MVS, the versions are fixed by the `require` lines in `go.mod`. A new release on the internet changes nothing until *you* edit a `require` line. Your build is frozen by your own files.

This is why Go does not need a separate lockfile (like `package-lock.json` or `Cargo.lock`). The `go.mod` files *are* the lock. The version numbers in them, plus the MVS rule, fully determine the build.

### The build list: one version per module

The output of MVS is the **build list**: a flat list with exactly one version for each module in your build. You can see it directly:

```bash
$ go list -m all
example.com/myapp
github.com/google/uuid v1.6.0
github.com/spf13/pflag v1.0.5
golang.org/x/sys v0.18.0
```

The first line (no version) is your main module. Every other line is a `(module, version)` pair MVS selected. Even if five different libraries each required a different version of `golang.org/x/sys`, this list shows just one — the highest minimum.

### Where the floors come from: `require` directives

Every `go.mod` in the graph contributes floors. Your own `go.mod`:

```
module example.com/myapp

go 1.22

require (
    github.com/google/uuid v1.6.0
    github.com/spf13/cobra v1.8.0
)
```

Each `require` line is a floor *you* set. But `cobra`'s own `go.mod` has its own `require` block, setting more floors. And those dependencies have dependencies, each with floors. MVS gathers every floor from every `go.mod` in the transitive graph, then for each module takes the maximum.

### `// indirect` requirements

You will see lines like this:

```
require (
    github.com/google/uuid v1.6.0
    golang.org/x/sys v0.18.0 // indirect
)
```

The `// indirect` comment means: "my code does not `import` this directly, but it ends up in my build anyway." Usually it is there to *raise a floor* — to make sure a transitive dependency is at least a certain version. MVS treats indirect requires exactly like direct ones: they are floors. The comment is just bookkeeping for humans and `go mod tidy`.

### Why this gives reproducible builds

Because the selected version of every module is fully determined by the `require` lines in the graph, two people who `git clone` the same repo get the **same build list**, today and years from now. No background updates. No "it worked on my machine because I installed yesterday." The version a build uses is a property of the committed files, not of the calendar.

---

## Real-World Analogies

**1. The "minimum age" sign at a ride.** A theme-park ride says "you must be at least 12." That is a floor, not an exact requirement. A 15-year-old satisfies it. Now suppose three signs along the queue say "at least 12," "at least 14," and "at least 10." To ride, you must satisfy *all* of them — so you must be at least 14 (the highest floor). MVS does exactly this: it finds the highest floor and uses the version that just clears it.

**2. A potluck with dietary minimums.** Three guests RSVP with requests: "I need at least 2 vegetarian dishes," "at least 3," "at least 1." To make everyone happy you bring 3 — the largest request. You do not bring 9 just because the store had 9 in stock. You bring exactly what the most demanding guest asked for.

**3. A recipe that says "at least 350°F."** If your cake recipe needs *at least* 350°F and your bread needs *at least* 375°F, you set the oven to 375°F — the higher of the two minimums. You do not crank it to 500°F just because the dial goes that high. MVS sets the "oven temperature" (the version) to the highest minimum anyone declared.

**4. Frozen timetable, not live feed.** A printed train timetable tells you exactly when the train leaves, forever, until a new timetable is printed. A live "next train" app changes every time you look. `go.mod` is the printed timetable: the versions are fixed until *you* reprint (edit `require`). A "newest version" package manager is the live feed — always changing under you.

---

## Mental Models

### Model 1 — A `require` line is a floor, not a pin

Internalise this above all else. `require foo v1.2.0` says "v1.2.0 *or newer*." It is a lower bound. MVS combines all the lower bounds and takes the maximum. There is no upper bound anywhere in the system — Go modules has no "less than v2.0.0" constraint syntax. That absence is deliberate and is what keeps the algorithm simple.

### Model 2 — Selection = max of the floors

For one module, ignore everything else: gather every version anyone required, take the biggest. That is the selected version. Repeat for every module. That is the whole build list.

```
foo required at: v1.2.0, v1.4.0, v1.3.0
selected:        v1.4.0   ← max
```

### Model 3 — `go.mod` is the lockfile

You do not need a separate `Cargo.lock` or `package-lock.json`. The `require` lines, plus the rule "max of the floors," are a complete, deterministic specification of the build. `go.sum` then verifies the *bytes* of those versions; it does not choose versions.

### Model 4 — Newer code on the internet is invisible until you ask for it

A library releases `v1.9.0` tonight. Your build tomorrow still uses whatever your `require` lines floor it to — say `v1.4.0`. Go will not "upgrade" you. The newest version is irrelevant to MVS unless a `require` line names it. Upgrades are something *you* do on purpose with `go get`, not something that happens to you.

### Model 5 — The build list is computed, not stored

There is no file that lists "the build used these versions." The build list is *derived* every time from the module graph. You can print it (`go list -m all`) but it is recomputed, not read from disk. This is why it is always consistent with `go.mod`: it is a function of it.

---

## Pros & Cons

### Pros

- **Reproducible by default.** Same `go.mod` → same versions, forever, no lockfile required.
- **No surprise upgrades.** A new release upstream cannot silently change your build. Upgrades are explicit.
- **Simple and fast.** No SAT solver, no backtracking. Selection is just "max per module" over a graph.
- **Predictable.** You can read the `require` lines and predict the chosen versions by hand.
- **Low-fidelity failures are rare.** You build against the *minimum* versions, which are the ones most likely to have actually been tested by your dependencies' authors.
- **High-fidelity builds.** The versions you use are close to what the dependency authors developed against, reducing "works for them, breaks for me."

### Cons

- **You can lag behind.** MVS will not pull in bug fixes or security patches automatically. You must run `go get -u` deliberately.
- **Counterintuitive at first.** "Why didn't I get the latest version?" trips up almost everyone new to Go.
- **No version ranges.** You cannot say "anything in the 1.x line." You name a floor, and that is it. (This is mostly a feature, but it surprises people from other ecosystems.)
- **Indirect requires can accumulate.** Over time, `// indirect` lines pile up in `go.mod`; `go mod tidy` keeps them honest.

The trade is clear: MVS gives up "always newest" in exchange for "always the same." For production software, "always the same" is usually what you want.

---

## Use Cases

MVS is not something you opt into — it is *always* how Go selects versions. But understanding it matters most when:

- **You are debugging "wrong version" surprises.** "I `go get`'d `v1.9.0` but my build uses `v1.4.0`" — MVS explains why (and usually the answer is: you did not actually change the floor).
- **A shared transitive dependency causes a conflict.** Two libraries need different versions of the same thing; MVS resolves it to the higher minimum, and you need to know which one that is.
- **You are upgrading dependencies.** Knowing that `require` lines are floors tells you exactly what `go get foo@v1.5.0` does to the build list.
- **You need reproducible CI/CD builds.** MVS guarantees them — but only if you understand that the `require` lines are the source of truth.
- **You are reviewing a `go.mod` diff in a PR.** A bumped `require` line is a deliberate floor change; you can reason about its blast radius.
- **You are responding to a security advisory.** A CVE fix in a transitive dependency does not reach you until you raise the floor with `go get`.

You are *not* using MVS deliberately when you just `go build` — it runs invisibly. You only think about it when a version is not what you expected.

---

## Code Examples

### Example 1 — Seeing the build list

Start with a small module.

```bash
mkdir mvsdemo
cd mvsdemo
go mod init example.com/mvsdemo
```

Add a dependency:

```bash
go get github.com/google/uuid@v1.6.0
```

Now print the build list:

```bash
$ go list -m all
example.com/mvsdemo
github.com/google/uuid v1.6.0
```

Two lines: your main module (no version), and the one dependency at the version MVS selected. Since only one floor exists for `uuid`, the selection is trivially that floor.

### Example 2 — The "highest of the minimums" in action

Suppose your `go.mod` ends up looking like this (after pulling in two libraries that both depend on `golang.org/x/text`):

```
module example.com/mvsdemo

go 1.22

require (
    github.com/libA v1.0.0   // requires golang.org/x/text v0.3.0
    github.com/libB v1.0.0   // requires golang.org/x/text v0.9.0
)
```

`libA`'s `go.mod` floors `x/text` at `v0.3.0`. `libB`'s floors it at `v0.9.0`. The build list shows:

```bash
$ go list -m golang.org/x/text
golang.org/x/text v0.9.0
```

MVS chose `v0.9.0` — the higher of the two minimums. Even if `golang.org/x/text v0.14.0` exists, it is not used: nobody required it.

### Example 3 — A new release upstream does NOT upgrade you

Imagine `github.com/google/uuid` releases `v1.7.0` tomorrow. You run a normal build:

```bash
$ go build ./...
$ go list -m github.com/google/uuid
github.com/google/uuid v1.6.0
```

Still `v1.6.0`. MVS does not see the new release as relevant — your floor is still `v1.6.0`. To move to `v1.7.0`, you must ask:

```bash
$ go get github.com/google/uuid@v1.7.0
$ go list -m github.com/google/uuid
github.com/google/uuid v1.7.0
```

Now the floor is raised, and the build list reflects it.

### Example 4 — Inspecting the module graph

The build list is the *result*. To see the raw floors that produced it, look at the graph:

```bash
$ go mod graph
example.com/mvsdemo github.com/spf13/cobra@v1.8.0
example.com/mvsdemo github.com/google/uuid@v1.6.0
github.com/spf13/cobra@v1.8.0 github.com/spf13/pflag@v1.0.5
github.com/spf13/cobra@v1.8.0 github.com/inconshreveable/mousetrap@v1.1.0
```

Each line is "A requires B." The left side is a module-at-version; the right side is the floor it sets. MVS reads all of these edges and computes one version per module from them.

### Example 5 — `go get foo@v1.2.3` raises a floor

The most common version-changing command:

```bash
$ go get github.com/spf13/pflag@v1.0.5
```

This sets (or raises) the floor for `pflag` to `v1.0.5` and writes it into your `go.mod`. The build list updates accordingly. You can pin to an exact version, a branch, or `@latest`:

```bash
go get github.com/spf13/pflag@v1.0.5     # exact version
go get github.com/spf13/pflag@latest     # newest tagged release
go get github.com/spf13/pflag@v1.0.4     # downgrade (lowers your direct floor)
```

### Example 6 — `go mod why` explains a dependency

When you wonder "why is this module even in my build?", ask:

```bash
$ go mod why golang.org/x/sys
# golang.org/x/sys
example.com/mvsdemo
github.com/spf13/cobra
golang.org/x/sys
```

The output is the import chain: your app imports `cobra`, which (transitively) needs `x/sys`. That is why it appears in the build list, and why a floor for it exists.

---

## Coding Patterns

### Pattern: let `go.mod` be the single source of truth

Do not keep a separate notes file of "which versions we use." `go.mod` plus `go list -m all` is authoritative. If you want a snapshot for a release, capture the output of `go list -m all`:

```bash
go list -m all > versions-at-release-v2.3.txt
```

### Pattern: upgrade deliberately, then tidy

Upgrading is a two-step habit:

```bash
go get example.com/foo@v1.5.0
go mod tidy
```

`go get` raises the floor; `go mod tidy` cleans up indirect requires that are no longer needed (or adds ones that now are).

### Pattern: verify the selected version after a change

After any `go get`, confirm what MVS actually selected — it may differ from what you typed if a higher floor exists elsewhere:

```bash
go get example.com/foo@v1.3.0
go list -m example.com/foo   # might show v1.5.0 if a dependency floors it higher
```

### Pattern: do not fight MVS with manual edits

Resist hand-editing version numbers in `go.mod` to "force" a version down below an existing floor. MVS will reselect based on the graph; a floor set by a dependency cannot be undone by lowering *your* line. Use `go get` (and, later, `exclude`/`replace` for advanced cases) instead.

---

## Clean Code

- **Keep your direct `require` lines meaningful.** They are floors you own. A floor higher than necessary forces newer versions on the whole graph; a floor lower than what you tested is a lie.
- **Run `go mod tidy` after every dependency change.** It keeps `// indirect` lines accurate and removes dead floors.
- **Do not commit a `go.mod` with floors you cannot explain.** If you cannot say why a `require` line exists, `go mod why` will tell you.
- **Prefer `go get` over editing `go.mod` by hand.** The tool keeps `go.sum` and indirect requires consistent; manual edits drift.
- **Commit `go.mod` and `go.sum` together.** The first fixes the versions (via MVS); the second verifies their bytes. They are a pair.

---

## Product Use / Feature

MVS shapes how teams ship software:

- **Reproducible releases.** A tagged commit always rebuilds with the same dependency versions, because MVS derives them from the committed `go.mod`. Crucial for hotfixing an old release.
- **Predictable CI.** Two CI runs of the same commit select identical versions. No flaky "a new release broke the build overnight."
- **Controlled upgrade cadence.** Upgrades are explicit `go get` operations, reviewable in PRs. Security teams can mandate "raise this floor to the patched version" and see exactly the diff.
- **Auditability.** The build list (`go list -m all`) is a deterministic manifest of what shipped, derivable from the repo at any commit.

For regulated or long-lived software, "the versions are a property of the source, not the day you built it" is a genuine operational advantage.

---

## Error Handling

MVS itself rarely errors — it is a deterministic computation. The errors you meet are *around* it.

### "missing go.sum entry for module providing package"

MVS selected a version, but `go.sum` has no hash for it. Cause: you edited `go.mod` without running tidy, or added an import. Fix:

```bash
go mod tidy
```

### "module ... found, but does not contain package ..."

A floor names a module that does not provide the package you import (often a version mismatch). Fix: `go get` the correct version, or correct the import path.

### "ambiguous import" / "found in multiple modules"

Two modules in the graph both claim to provide a package — usually a `v2` migration done halfway. Fix: ensure import paths use the right major-version suffix (`/v2`). MVS treats `foo` and `foo/v2` as *different* modules.

### `go: updates to go.mod needed; to update it, run: go mod tidy`

You built with `-mod=readonly` (the default since Go 1.16) and the build wanted to add or change a floor. MVS noticed an import with no satisfying `require` line. Fix: `go mod tidy`. The error is protective, not arbitrary.

### "version ... invalid: unknown revision"

You `go get`'d a version that does not exist as a tag. MVS cannot floor at a version it cannot resolve. Fix: check the available tags (`go list -m -versions example.com/foo`).

---

## Security Considerations

- **MVS will not auto-patch you.** A CVE fix in `v1.4.3` does *not* reach your build if your floor is `v1.4.0` and nothing in the graph raised it. You must `go get example.com/foo@v1.4.3` (or `go get -u`). This is the security cost of reproducibility.
- **Lower floors can hide vulnerabilities.** Because MVS picks the minimum that satisfies everyone, a build can sit on an old, vulnerable version indefinitely. Run `govulncheck ./...` regularly to surface this.
- **`go.sum` still protects the bytes.** MVS chooses *which* version; `go.sum` ensures the bytes you got for that version match what was recorded. A malicious proxy cannot swap in tampered code without `go.sum` flagging it.
- **Raising a floor is the patch mechanism.** To respond to an advisory, you raise the relevant `require` floor (directly or via an `// indirect` line) and re-tidy. The diff is reviewable.
- **Beware `replace` undermining selection.** A `replace` directive overrides MVS entirely for that module — handy for forks, but it means the selected version is no longer what the graph says. Audit `replace` lines carefully.

---

## Performance Tips

- **MVS is cheap.** Selection is a graph walk taking the max per module — no backtracking, no solver. It is not a build-time bottleneck.
- **The expensive part is *loading* the graph**, not selecting from it: fetching every dependency's `go.mod` to read its floors. Modern Go prunes this aggressively (module graph pruning, Go 1.17+) so it rarely loads the *whole* transitive graph.
- **A warm module cache makes graph loading instant.** Once `go.mod` files are cached locally, recomputing the build list is near-instant.
- **`go list -m all` is fast** because it just reports the already-computed build list; it does not re-download anything if the cache is warm.

---

## Best Practices

1. **Treat `require` lines as floors you own.** Set them to versions you actually tested against.
2. **Upgrade with `go get`, never by editing `go.mod` to force a version down.** MVS reselects from the graph; manual lowering below a floor does nothing.
3. **Run `go mod tidy` after every dependency change.** Keep indirect requires honest.
4. **Use `go list -m all` to confirm the selected versions** — the result of MVS, not your intent.
5. **Use `go mod why` to justify every dependency** before committing a `go.mod` change.
6. **Run `govulncheck` regularly**, because MVS will not patch you automatically.
7. **Commit `go.mod` and `go.sum` together**; the first selects, the second verifies.
8. **Remember `v2+` modules have a path suffix** (`/v2`). MVS treats different majors as different modules entirely.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Expecting the latest version

You add a dependency and are surprised it is not the newest release. MVS picks the *minimum* that satisfies the graph. If you want newer, raise the floor explicitly with `go get foo@latest`.

### Pitfall 2 — `go get foo@v1.9.0` but the build still uses something else

If a dependency floors `foo` *higher* than `v1.9.0`, MVS keeps the higher one. Conversely, if you `go get` a version *lower* than an existing floor, your direct require changes but the selected version may not drop. Always check `go list -m foo`.

### Pitfall 3 — Major versions are separate modules

`github.com/foo/bar` and `github.com/foo/bar/v2` are **different modules** to MVS. They can both be in your build list at once. There is no "conflict" — they coexist. This surprises people expecting one version of "bar."

### Pitfall 4 — `// indirect` lines you did not write

`go mod tidy` and `go get` add `// indirect` requires to raise floors for transitive dependencies. They are normal. Do not delete them by hand; tidy manages them.

### Pitfall 5 — Thinking MVS will downgrade for you

MVS never picks a version *below* a floor. If an old build worked with `v1.2.0` but a dependency now floors `foo` at `v1.5.0`, you get `v1.5.0`. To go lower, you must remove or lower the floor that forces it (sometimes impossible without `exclude`/`replace`).

### Pitfall 6 — Pseudo-versions look scary but are normal

Sometimes a floor is a long string like `v0.0.0-20230101120000-abcdef123456`. That is a *pseudo-version* — a stand-in for an untagged commit. MVS compares it like any other version. It is normal; do not panic.

### Pitfall 7 — `+incompatible` suffix

A module at `v2.0.0+incompatible` is a `v2` module that does *not* use the `/v2` path suffix (usually pre-modules code). MVS handles it, but it is a sign of an older dependency. Just know that `+incompatible` is part of the version string.

---

## Common Mistakes

- **Editing a version number down in `go.mod` to "downgrade,"** then being confused when the build list does not change (a higher floor in the graph wins).
- **Assuming `go build` upgrades dependencies.** It does not. Only `go get` (and `go get -u`) raise floors.
- **Deleting `// indirect` lines** thinking they are clutter. They are floors; tidy will re-add them.
- **Confusing the build list with the module graph.** The graph has *all* the edges/floors; the build list has *one* selected version per module.
- **Expecting a version range syntax** like `^1.2.0`. Go modules has none — a `require` is a single floor.
- **Forgetting that `v2+` needs a `/v2` import path,** then getting "ambiguous import" or "does not contain package."
- **Believing a new upstream release will fix your build.** It will not, until you `go get` it.

---

## Common Misconceptions

> *"Go uses the latest version of each dependency."*

No. Go uses the **minimum** version that satisfies all the floors in the graph — the highest of the minimums, never the latest available.

> *"I need a lockfile to get reproducible builds."*

No. `go.mod` plus MVS *is* the lock. The versions are fully determined by the `require` lines. `go.sum` verifies the bytes; it does not select versions.

> *"`go.sum` chooses my versions."*

No. MVS chooses versions; `go.sum` records hashes of the chosen versions' bytes for integrity checking.

> *"A `require` line pins an exact version."*

No. It sets a *minimum*. The selected version can be higher if something else floors it higher.

> *"If I `go get foo@v1.0.0`, my build uses v1.0.0."*

Only if no other floor in the graph is higher. If a dependency requires `foo v1.4.0`, MVS still selects `v1.4.0`.

> *"MVS solves a constraint puzzle like npm or Cargo."*

No. There is no SAT solver, no backtracking. MVS takes the maximum required version per module. That is why it is fast and deterministic.

> *"`v1` and `v2` of a module conflict."*

No. They are different modules (different import paths). Both can appear in the build list.

---

## Tricky Points

- **"Minimal" describes the *result*, not the *intent*.** MVS selects the *smallest* version that still satisfies every floor — which, across the graph, is the *largest* floor anyone set. Small relative to "latest available"; large relative to any single requirement.
- **The main module's floors usually win for direct deps.** Your `go.mod`'s `require` for a direct dependency is typically the highest floor for it, so you "control" its version — until a transitive dependency floors it higher.
- **Indirect requires exist mainly to raise floors.** When `go mod tidy` adds `// indirect`, it is recording a floor needed for reproducibility, often higher than any single dependency would set on its own.
- **The `go` directive matters.** `go 1.17+` enables module graph *pruning*, which changes *how much* of the graph MVS loads (not the result for a tidy module). More on this in middle/professional levels.
- **MVS never consults the latest tag list to make a decision.** It only ever looks at versions named in `go.mod` files in the graph. `@latest` resolves a tag *before* handing a concrete version to the floor logic.
- **Downgrading is a real, separate MVS operation** that may need to *remove* requirements that depended on the higher version — more subtle than upgrading.

---

## Test

Try this in a scratch folder.

```bash
mkdir mvs-test
cd mvs-test
go mod init example.com/mvstest
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "github.com/google/uuid"
)

func main() {
    fmt.Println(uuid.New().String())
}
EOF
go mod tidy
go list -m all
go mod graph
```

Expected: `go list -m all` prints your module plus `github.com/google/uuid` at some version; `go mod graph` shows the edge from your module to `uuid`.

Now answer:
1. If you run `go get github.com/google/uuid@v1.5.0` (an older version), what does `go list -m github.com/google/uuid` show? (Answer: `v1.5.0`, *unless* a transitive dependency floors it higher.)
2. A new `uuid v1.99.0` is released tonight. After a plain `go build`, what version is selected? (Answer: still your current floor — MVS does not auto-upgrade.)
3. Are `github.com/foo/bar` and `github.com/foo/bar/v2` the same module to MVS? (Answer: no — different modules.)
4. Where do the floors come from? (Answer: every `require` line in every `go.mod` in the transitive graph.)

---

## Tricky Questions

**Q1.** I ran `go get foo@v1.2.0` but `go list -m foo` shows `v1.6.0`. Is something broken?

A. No. Some other module in your graph requires `foo v1.6.0`. MVS selects the highest floor, so `v1.6.0` wins. Your direct require was lowered, but the selected version cannot drop below another module's floor. Run `go mod why foo` and `go mod graph | grep foo` to find who sets the higher floor.

**Q2.** Why doesn't Go just use the newest version of everything? Wouldn't that get me the latest bug fixes?

A. It would also get you *untested combinations* that change every day. MVS trades "newest" for "reproducible and tested-against." You opt into newer versions deliberately with `go get -u`, so upgrades are reviewable events, not silent drift.

**Q3.** Do I need a lockfile like `Cargo.lock` or `package-lock.json`?

A. No. The `require` lines plus the MVS rule fully determine the versions. `go.mod` is effectively the lockfile; `go.sum` records hashes for integrity. There is nothing else to lock.

**Q4.** Two of my dependencies need different versions of the same library. Will my build fail?

A. No. MVS selects the higher of the two required versions and builds everything against it. As long as the library follows semantic versioning (no breaking change within a major version), this works. Both dependencies get a version *at least* as new as they asked for.

**Q5.** What is the difference between `go list -m all` and `go mod graph`?

A. `go list -m all` prints the *build list* — the single selected version per module (the MVS result). `go mod graph` prints the raw *edges* — every "A requires B" relationship (the MVS input). The graph has many floors per module; the list has one selected version.

**Q6.** I see a weird version like `v0.0.0-20230101120000-abcdef123456`. What is that?

A. A *pseudo-version* — Go's stand-in for a specific untagged commit. The middle part is a timestamp; the end is a commit hash. MVS compares it like any other version. It is normal when a dependency has no proper release tag.

**Q7.** Can MVS ever pick a version *lower* than what I put in my `go.mod`?

A. No. Your `require` is a floor. MVS never selects below any floor. It can select *higher* (if another module requires higher), but never lower.

**Q8.** If I delete a `// indirect` line, will my build break?

A. Maybe. If that line was raising a floor needed for reproducibility, deleting it could change a selected version. Run `go mod tidy` — it will re-add the line if it is genuinely needed.

**Q9.** How do I downgrade a dependency below a floor a library sets?

A. You usually cannot with `require` alone — MVS will reselect the higher floor. You need an `exclude` directive (to skip a bad version) or a `replace` directive (to substitute a different version/module). Those are advanced topics; for now, raise the *other* floors instead.

**Q10.** Does `@latest` mean MVS uses the latest version?

A. `@latest` is resolved *before* MVS: `go get foo@latest` looks up the newest tag and writes that concrete version into `go.mod` as a floor. After that, MVS does its normal "max of floors" computation. So `@latest` raises your floor to today's newest, but the *selection* is still floor-based.

---

## Cheat Sheet

```bash
# Print the build list (the MVS result: one version per module)
go list -m all

# Print the module graph (the MVS input: all require edges)
go mod graph

# Why is this module in my build?
go mod why example.com/foo

# Selected version of one module
go list -m example.com/foo

# Available versions of a module (to choose a floor)
go list -m -versions example.com/foo

# Raise a floor (upgrade) to an exact version
go get example.com/foo@v1.5.0

# Raise a floor to the newest tagged release
go get example.com/foo@latest

# Lower your direct floor (does NOT drop below other floors)
go get example.com/foo@v1.2.0

# Upgrade everything to newest minor/patch (deliberate)
go get -u ./...

# Clean up require lines and indirect markers
go mod tidy
```

```
The one-sentence rule:

    For each module, MVS selects the HIGHEST version
    that ANY require directive in the graph asked for —
    and nothing higher.

    "Minimal" = the smallest version that still
                satisfies every floor.
```

| Symptom | Likely Cause | Fix / Check |
|---------|--------------|-------------|
| Build uses an old version | That is the highest floor in the graph | `go mod graph \| grep mod`; raise floor with `go get` |
| `go get @v1.2.0` didn't change selected version | A higher floor exists elsewhere | `go mod why mod`; find the higher requirer |
| New upstream release not used | MVS never auto-upgrades | `go get mod@latest` deliberately |
| "ambiguous import" | `v2` module imported without `/v2` | Fix import path to include `/v2` |
| `go.sum` entry missing | `go.mod` changed without tidy | `go mod tidy` |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what MVS selects (the highest of the minimums)
- [ ] State why a `require` line is a floor, not a pin
- [ ] Explain why MVS gives reproducible builds without a lockfile
- [ ] Read `go list -m all` and identify the selected version of any module
- [ ] Read `go mod graph` and find the floors for a given module
- [ ] Predict the selected version when several floors exist for one module
- [ ] Explain why a new upstream release does not change your build
- [ ] Use `go get foo@v1.2.3` to raise a floor and confirm the result
- [ ] Explain why `foo` and `foo/v2` are different modules
- [ ] Use `go mod why` to justify a dependency's presence
- [ ] Explain why MVS will not auto-patch a security vulnerability

---

## Summary

Minimal Version Selection is the algorithm Go uses to choose one version of each dependency. The rule is short: for every module, select the **highest version that any `require` directive in the dependency graph asked for** — and nothing higher. Each `require` is a *floor* (a minimum), not a pin; MVS takes the maximum of the floors. The output is the **build list**, one version per module, which you can print with `go list -m all`.

"Minimal" means the smallest version that still satisfies every requirement — which makes builds **reproducible**: the versions are a property of the committed `go.mod` files, not of when you built. A new release upstream changes nothing until you raise a floor with `go get`. There is no lockfile, no SAT solver, no surprise upgrades, and no version-range syntax.

The trade-off is that MVS will not patch you automatically; upgrades and security fixes are deliberate `go get` operations. Master the mental model — *require lines are floors, selection is max-per-module, the build list is derived not stored* — and Go's "why did it pick that version?" surprises disappear.

---

## What You Can Build

After learning this:

- **A correctly-versioned module** whose `require` floors you can explain and justify line by line.
- **A reproducible CI build** that selects identical versions on every run, derivable from the committed `go.mod`.
- **A confident upgrade workflow:** `go get` to raise floors, `go mod tidy` to clean up, `go list -m all` to verify.
- **A dependency audit:** reading `go mod graph` and `go mod why` to understand exactly why each module and version is in your build.
- **A security-response habit:** raising floors to patched versions and confirming with `govulncheck`.

You cannot yet:
- Walk the formal four-operation MVS algorithm (next: middle.md)
- Reason about graph pruning and lazy module loading (professional.md)
- Use `exclude` and `replace` to override selection (next topic)
- Handle deep version-downgrade propagation (senior.md)

---

## Further Reading

- [Russ Cox: "Minimal Version Selection"](https://research.swtch.com/vgo-mvs) — the original essay that defines MVS. Read it once you are comfortable with this file. Authoritative.
- [Go Modules Reference — Minimal version selection](https://go.dev/ref/mod#minimal-version-selection) — official, precise.
- [Go Modules Reference — `go.mod` `require` directive](https://go.dev/ref/mod#go-mod-file-require) — what a floor is.
- [Using Go Modules (the Go Blog)](https://go.dev/blog/using-go-modules) — gentle introduction to modules and versions.
- [`go help mod graph`](https://pkg.go.dev/cmd/go#hdr-Print_module_requirement_graph) — terse reference for the graph command.

---

## Related Topics

- [6.1.1 `go mod init`](../01-go-mod-init/junior.md) — start a module
- [6.1.2 `go mod tidy`](../02-go-mod-tidy/junior.md) — synchronize `go.mod` floors with imports
- [6.1.3 `go mod vendor`](../03-go-mod-vendor/junior.md) — freeze the selected versions into `vendor/`
- 6.1.5 Replace and Exclude Directives — override what MVS selects
- [6.2.1 Package Import Rules](../../02-packages/01-package-import-rules/junior.md) — how imports resolve to modules

---

## Diagrams & Visual Aids

```
The "highest of the minimums" rule:

    Floors required for module "foo":
        your go.mod   ──> foo v1.2.0
        libA's go.mod ──> foo v1.4.0   ← highest floor
        libB's go.mod ──> foo v1.3.0

    MVS selects: foo v1.4.0
    (NOT v1.9.0, even though it exists — nobody required it)
```

```
Module graph (input)  vs  Build list (output):

    GRAPH (go mod graph)              BUILD LIST (go list -m all)
    ----------------------            ---------------------------
    app  -> foo v1.2.0                app
    app  -> bar v1.0.0                foo v1.4.0   ← max of floors
    bar  -> foo v1.4.0                bar v1.0.0
    bar  -> baz v0.9.0                baz v0.9.0
                                      (one version per module)
```

```
Why builds are reproducible:

    [go.mod require lines]   ← floors, committed to git
              │
              │   MVS: max per module
              ▼
    [build list: one version each]   ← derived, deterministic
              │
              │   same input → same output, forever
              ▼
    [same versions on every machine, every year]

    A new upstream release does NOT enter this picture
    until YOU edit a require line (go get).
```

```
A require line is a FLOOR, not a PIN:

    require foo v1.2.0

    means:  foo >= v1.2.0     (v1.2.0 is the minimum)
    NOT:    foo == v1.2.0     (it is not pinned)

    selected version = max( all floors for foo in the graph )
```

```
Upgrades are deliberate:

    plain build  ──────────────> selected version UNCHANGED
                                  (MVS never auto-upgrades)

    go get foo@v1.5.0  ────────> floor raised to v1.5.0
    go get foo@latest  ────────> floor raised to newest tag
    go get -u ./...    ────────> raise floors across the graph

    Then MVS recomputes: max of the (now higher) floors.
```
