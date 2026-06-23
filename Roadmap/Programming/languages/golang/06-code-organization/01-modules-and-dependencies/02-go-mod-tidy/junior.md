# `go mod tidy` — Junior Level

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
> Focus: "I added an `import` line — now what makes my project actually build?"

You have a module. You wrote `import "github.com/spf13/cobra"` somewhere. You hit save. Now `go build` shouts at you, or — worse — works mysteriously, leaves `go.mod` slightly wrong, and ships a project that breaks on someone else's laptop. There is one command that fixes that whole situation, and you will run it more often than any other module-related command in your career:

```bash
go mod tidy
```

That single command walks every `.go` file in your module, looks at every `import` line, and rewrites `go.mod` and `go.sum` so they exactly match what your code uses. It adds dependencies that imports need, removes dependencies that nothing imports any more, and writes cryptographic checksums so the next builder gets the *same bytes* you did.

After reading this file you will:
- Understand what `go mod tidy` does mechanically
- Know exactly when to run it (and why "after every import change" is the answer)
- Read a `go.sum` file without panic
- Distinguish direct from indirect dependencies
- Recognise the common error messages and know how to fix them
- Use `go mod tidy` as a CI guard against drift

You do **not** need to know about minimum-version selection, vendor directories, replace directives, or workspaces yet. Those come later. This file is about the moment your imports change and you need the toolchain to catch up.

---

## Prerequisites

- **Required:** A working Go module (you ran `go mod init` already). Check with `cat go.mod`.
- **Required:** Go 1.16 or newer; `go mod tidy` got a major upgrade in 1.17 (the indirect-dependency bookkeeping changed). 1.22+ is recommended.
- **Required:** Network access. `go mod tidy` may reach `proxy.golang.org` (or your configured `GOPROXY`) to resolve versions.
- **Required:** A terminal and basic command-line comfort.
- **Helpful:** Having read [01-go-mod-init/junior.md](../01-go-mod-init/junior.md). This file builds on that one.
- **Helpful:** Having seen `import` blocks in Go source code.

If `go version` works, `cat go.mod` shows a real file, and you can ping `proxy.golang.org`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`go mod tidy`** | The Go command that synchronises `go.mod` and `go.sum` with the actual `import` statements in the code. |
| **`go.mod`** | The text file declaring the module path, the Go version, and the **direct** and **indirect** dependencies of the module. |
| **`go.sum`** | A sister file recording cryptographic checksums (SHA-256, base64) of every dependency in the build graph. Used to detect tampering and pin exact bytes. |
| **Direct dependency** | A package that is imported (by path) somewhere in your own module's `.go` files. |
| **Indirect dependency** | A package your code does *not* import directly, but that is needed by one of your direct dependencies. Marked `// indirect` in `go.mod`. |
| **Module graph** | The full transitive closure of every module that your build depends on. `go mod tidy` resolves this graph completely. |
| **Module proxy** | A network service (default: `proxy.golang.org`) that hosts cached copies of public modules. `go mod tidy` queries it. |
| **Minimum Version Selection (MVS)** | Go's algorithm for picking which version of a dependency to use when several are requested. `go mod tidy` runs MVS to its conclusion. |
| **Drift** | The state where `go.mod`/`go.sum` no longer match the imports — common after a manual edit, a merge, or a forgotten `tidy`. |
| **`GOPROXY`** | An environment variable controlling where Go downloads modules from. Defaults to `https://proxy.golang.org,direct`. |
| **`GOSUMDB`** | The checksum database Go consults to verify downloads. Defaults to `sum.golang.org`. |
| **Build list** | The exact set of (module, version) pairs the compiler will use for one build. `go mod tidy` produces it as a side effect. |

---

## Core Concepts

### `go mod tidy` syncs `go.mod`/`go.sum` to your imports

That is the whole job. Imagine `go.mod` and your `import` lines as two lists. They should be the *same* list (with versions added). Tidy compares them and rewrites `go.mod` to match.

If your code imports `github.com/spf13/cobra`, `go.mod` ends up with a `require github.com/spf13/cobra vX.Y.Z` line. If you delete every `import` of `cobra`, the next `go mod tidy` removes that `require` line.

### It scans every `.go` file under the module root

Tidy walks the directory tree starting from the module root (where `go.mod` lives), reads every `.go` file (including `_test.go` files), parses each `import` block, and builds a set of *needed* import paths. That set is the source of truth.

It is purely static — it does not run your code, it does not even compile your code. It just reads imports.

### It populates `go.sum` with checksums

For every module in the build graph (direct *and* indirect), `go mod tidy` writes two lines to `go.sum`:

```
github.com/spf13/cobra v1.8.0 h1:...checksum...
github.com/spf13/cobra v1.8.0/go.mod h1:...checksum...
```

The first line hashes the module's source tree. The second hashes its `go.mod`. Both are needed for full reproducibility.

### It marks indirect-only dependencies with `// indirect`

A direct dependency appears in `go.mod` like this:

```
require github.com/spf13/cobra v1.8.0
```

An indirect one looks like this:

```
require github.com/inconshreveable/mousetrap v1.1.0 // indirect
```

The `// indirect` comment is **not** a stylistic flourish — it is a real piece of metadata that tooling reads. Tidy adds, removes, and maintains those markers automatically. Do not edit them by hand.

### It runs the full Minimum Version Selection algorithm

When two packages in your graph ask for two different versions of the same module, Go picks the *highest of the minimums*. Tidy resolves all of these constraints and writes the resulting versions into `go.mod`.

You do not have to understand MVS in depth as a junior. Just know: tidy makes a definite, deterministic choice, and writes it down.

### `go build` is *not* the same as `go mod tidy`

`go build` will sometimes auto-add a missing dependency to `go.mod` *just enough* to make the build succeed. But it will **not**:

- Remove unused dependencies
- Update `// indirect` markers correctly
- Write *every* checksum to `go.sum`

So a build that works today is not the same as a tidy `go.mod`. Always finish a session of import-changes with `go mod tidy` before committing.

---

## Real-World Analogies

**1. The kitchen pantry inventory.** Your recipes are the `.go` files; the ingredient list on the fridge is `go.mod`. Every time you change a recipe, the list drifts. `go mod tidy` is the chore of going through the kitchen and rewriting the list to *exactly* match what your recipes call for — adding spices you forgot, removing ingredients no recipe uses any more.

**2. The receipts in your travel folder.** `go.mod` is the trip itinerary; `go.sum` is the box of receipts proving the prices. `go mod tidy` re-collects every receipt for everything currently on the itinerary and discards receipts for cancelled stops.

**3. A `package.json` + `package-lock.json` regeneration.** If you have used Node, `go mod tidy` plays the role of `npm prune && npm install` rolled into one — except it is part of the language toolchain, not a third-party tool.

**4. A spell-checker for dependencies.** It does not care what the dependencies *do*; it only ensures the list of dependencies is *spelled correctly* — every word your text uses is in the dictionary, no extra words sit unused.

---

## Mental Models

### Model 1 — Tidy is a fixpoint

Think of tidy as a function that takes (`code`, `go.mod`, `go.sum`) and returns (`go.mod'`, `go.sum'`). Run it once on a fresh codebase and it produces a result. Run it twice — the second run does nothing. The output is a *fixpoint* of the inputs. CI relies on this: "running tidy should be a no-op on a clean repo" is a strong invariant.

### Model 2 — Imports are the source of truth, `go.mod` is derived

This is backwards from how dependency files usually feel (in many ecosystems you edit `package.json` first and then your code adapts). In Go, **the imports are authoritative**. `go.mod` is generated from them. Once you internalise this, the workflow clicks: change imports first, run tidy second.

### Model 3 — `go.sum` is append-mostly

Tidy may add entries to `go.sum`, and over time it may rewrite them when versions change. Entries are not strictly removed every run — historical hashes can linger if any version is still referenced. The file therefore tends to grow. That is fine; it is intentional, and it preserves verifiability across history.

### Model 4 — Direct vs indirect is a graph property

Whether a dependency is direct or indirect is not a personal preference; it is a fact about your code. If your `.go` files contain `import "X/Y/Z"`, then the module containing `X/Y/Z` is **direct**. If they do not, but a transitive dependency does, it is **indirect**. Tidy computes this fact and writes it down.

---

## Pros & Cons

### Pros

- **One command, full sync.** No need to remember separate add/remove commands for normal cases.
- **Idempotent.** Running it twice is safe. The second run does nothing.
- **Reproducible builds.** After tidy, `go.mod` + `go.sum` together pin every byte that goes into your build.
- **Deterministic.** Same inputs (code + module versions on the proxy) always produce the same output.
- **Catches drift.** Running it in CI flags surprises before they reach main.
- **Self-cleaning.** Removes orphaned `require` lines automatically — your `go.mod` stays minimal.

### Cons

- **Requires network access** by default. An air-gapped machine without a populated module cache cannot run tidy.
- **Can change versions silently** if a transitive dependency releases a new patch. You may notice later than expected.
- **Slow on large modules.** Hundreds of dependencies plus a cold cache can mean a multi-minute first run.
- **Can fail confusingly** if a module path moved, was deleted, or your local clone is out of sync.

The pros vastly outweigh the cons. The cons are mostly mitigated by version control plus a populated module cache.

---

## Use Cases

You should run `go mod tidy` when:

- **You added an `import` line.** Always. Run tidy before you commit.
- **You removed an `import` line.** So the orphaned dependency is dropped from `go.mod`.
- **You merged or rebased.** Imports may have changed in either branch.
- **You upgraded the Go version** in `go.mod`. Tidy adjusts the indirect-marker bookkeeping.
- **CI is checking for drift.** `go mod tidy && git diff --exit-code go.mod go.sum` is a great pre-merge gate.
- **You inherited a project that fails to build with "missing go.sum entry."** Tidy populates the missing checksums.
- **You want to clean up after a long session of experimenting** with multiple libraries.

You should **not** run `go mod tidy` when:

- You only want to **add** a *specific version* of a library — use `go get module@version` first, then tidy.
- You are mid-conflict in a merge with `go.mod` markers — resolve the merge first, then tidy.
- The build is failing for a reason unrelated to dependencies (a syntax error, for instance). Tidy will not help.

---

## Code Examples

### Example 1 — Tidy on a fresh module after adding an import

```bash
mkdir myapp
cd myapp
go mod init example.com/myapp
```

Now create `main.go`:

```go
package main

import (
    "github.com/spf13/cobra"
)

func main() {
    cmd := &cobra.Command{Use: "myapp"}
    _ = cmd.Execute()
}
```

At this point `go.mod` does not know about cobra. Try to build and you may see:

```
main.go:4:5: no required module provides package github.com/spf13/cobra
```

Run:

```bash
go mod tidy
```

`go.mod` now contains:

```
module example.com/myapp

go 1.22

require github.com/spf13/cobra v1.8.0

require (
    github.com/inconshreveable/mousetrap v1.1.0 // indirect
    github.com/spf13/pflag v1.0.5 // indirect
)
```

And `go.sum` (a new file) has lines like:

```
github.com/inconshreveable/mousetrap v1.1.0 h1:...
github.com/inconshreveable/mousetrap v1.1.0/go.mod h1:...
github.com/spf13/cobra v1.8.0 h1:...
github.com/spf13/cobra v1.8.0/go.mod h1:...
github.com/spf13/pflag v1.0.5 h1:...
github.com/spf13/pflag v1.0.5/go.mod h1:...
```

Now `go build` succeeds.

### Example 2 — Tidy after removing an import

Take the previous module and edit `main.go` so it no longer uses cobra:

```go
package main

import "fmt"

func main() {
    fmt.Println("hello")
}
```

If you build now, it works — but `go.mod` still lists cobra. Run:

```bash
go mod tidy
```

`go.mod` shrinks to:

```
module example.com/myapp

go 1.22
```

Cobra and its indirect deps are gone. `go.sum` may still hold their entries for a while; subsequent `tidy` runs prune them as the build graph stabilises.

### Example 3 — Verbose mode

```bash
go mod tidy -v
```

Output (abridged):

```
unused github.com/foo/bar
```

The `-v` flag prints every module that tidy *removed* from `go.mod`. Useful when you want to know what just happened.

### Example 4 — Continue on errors

```bash
go mod tidy -e
```

Without `-e`, tidy aborts on the first error. With `-e`, it presses on, fixing what it can. Useful when several imports are broken at once and you want a list rather than fixing them one by one.

### Example 5 — Tidy to a specific Go-language version

Since Go 1.17 the layout of `go.mod` (with separate direct/indirect blocks) is determined by the `go` directive. To force a particular target you can pass the older language flag (Go 1.21+):

```bash
go mod tidy -go=1.21
```

This rewrites `go.mod` so its `go` directive is `1.21`, which controls the indirect-dependency bookkeeping style. As a junior you will rarely need this — accept the default — but you should recognise the flag when you see it.

### Example 6 — Detecting drift in CI

A common CI step:

```bash
go mod tidy
git diff --exit-code go.mod go.sum
```

If tidy changes anything, the `git diff` exits non-zero and CI fails. The fix: run `go mod tidy` locally and commit the changes.

---

## Coding Patterns

### Pattern: Add import, run tidy, commit together

The unit of work is "import change + go.mod/go.sum change". Treat them as one commit:

```bash
# 1. Edit code, add import.
# 2. Run tidy.
go mod tidy
# 3. Stage and commit together.
git add main.go go.mod go.sum
git commit -m "Add cobra-based CLI"
```

Splitting these into two commits causes one of them to be broken by itself — bad for `git bisect` later.

### Pattern: Tidy before every push

A short habit: just before `git push`, run `go mod tidy` to catch any forgotten drift. It costs less than a second on a warm cache.

### Pattern: Tidy + diff in CI

Make CI fail if `go.mod` or `go.sum` are not tidy. A drifted `go.mod` is a latent bug; CI is the right place to enforce.

### Pattern: Use `go get` to pin a version, then tidy to clean up

```bash
go get github.com/foo/bar@v1.4.2
go mod tidy
```

`go get` adds (or upgrades) a specific version. Tidy then re-balances the rest of the graph and ensures all checksums are in `go.sum`.

### Pattern: After cloning, tidy is unnecessary; build is enough

If you `git clone` someone else's tidy repository and just want to compile, you do **not** need to run `go mod tidy`. Their `go.mod`/`go.sum` are already authoritative. `go build` will download the right versions and verify the checksums.

---

## Clean Code

- **Always commit `go.mod` and `go.sum` together** when imports change. Never one without the other.
- **Never edit the `// indirect` markers by hand.** Let tidy maintain them.
- **Do not delete `go.sum`** to "clean up." It will be re-created, but your `git diff` will be enormous and impossible to review.
- **Prefer `go get module@version` + `go mod tidy`** over editing `go.mod` directly to change a version.
- **Run tidy before each commit that touches `.go` files.** It is cheap and prevents drift.
- **Group `require` blocks logically.** Tidy keeps directs and indirects in separate blocks; do not re-order the blocks manually.

A clean Go module is one where `go mod tidy && git status` produces no diff.

---

## Product Use / Feature

When you ship software professionally:

- The exact versions in `go.mod` + `go.sum` are part of your **release artifact**. They determine what runs in production.
- The checksums in `go.sum` are checked at **every build** — yours, your colleague's, your CI's. Mismatches fail loudly. This is a security feature.
- A drifted `go.mod` causes mystery failures across machines: "works on my laptop but not on the build server" is often a tidy that was forgotten.
- Auditors and security scanners read `go.mod`/`go.sum` to enumerate dependencies. Keeping them tidy means audits are accurate.
- Tools like Dependabot open pull requests against `go.mod`; running tidy is part of accepting those PRs.

`go mod tidy` is a load-bearing piece of your delivery pipeline, not a developer convenience.

---

## Error Handling

`go mod tidy` itself rarely "fails" silently — it produces explicit error messages. Here are the ones a junior will see most often.

### "no required module provides package <path>"

You have an `import "github.com/foo/bar"` but no module on the proxy claims to ship that path. Causes:

- Typo in the import path.
- The module was renamed or deleted.
- You are offline and the cache is empty.

Fix: check the import path on pkg.go.dev or the upstream repository.

### "missing go.sum entry for module providing package <path>"

`go.mod` says you need module X but `go.sum` does not have its checksum. Common after a partial merge or after someone hand-edited `go.mod`. Fix:

```bash
go mod tidy
```

### "ambiguous import: found package X in multiple modules"

Two modules in your graph both claim to ship the same import path. Often happens when a module was forked and renamed but old references survive in transitive deps. Fix is usually a targeted `go get` to upgrade the offending consumer.

### "module declares its path as: A but was required as: B"

You (or your dependency) require a module by one path while the module's own `go.mod` declares a different path. Either the module was renamed, or there is a `replace` directive missing/wrong. Fix is to use the module's canonical path.

### "verifying module: checksum mismatch"

The bytes the proxy returned do not match the hash in `go.sum`. This is either a serious security signal or, more commonly, a corrupted local cache. Try:

```bash
go clean -modcache
go mod tidy
```

If it persists, do not silence the error — investigate.

### Errors when offline

If `GOPROXY=off` (or you are simply offline), tidy fails when it needs a module not in the local cache. Fix is to populate the cache while online or set up a local mirror.

---

## Security Considerations

- **`go.sum` is a tamper-detection device.** Tidy populates it and the toolchain verifies every download against it forever after. Do not delete it; do not silence checksum errors.
- **Checksum DB.** By default, `go mod tidy` cross-checks new entries against `sum.golang.org`. You can disable this (`GOSUMDB=off`) but doing so weakens supply-chain security. As a junior, leave it alone.
- **Private modules.** If your module pulls from a private repository, configure `GOPRIVATE` (and possibly `GONOSUMCHECK`) so tidy does not leak the path to the public proxy. Consult your team's docs.
- **Network leak.** Running tidy on confidential code can leak the names of your dependencies (and possibly your own module path) to `proxy.golang.org` and `sum.golang.org`. For internal-only code, use a private proxy.
- **Typosquatting risk.** A subtle typo in an import path (`github.com/golamg/...` vs `github.com/golang/...`) can pull in a malicious lookalike. Tidy will *happily* download what you asked for. Read your imports.
- **Don't ignore checksum mismatches.** They are the loudest signal you will ever get that something has gone wrong. Investigate every one.

---

## Performance Tips

- **Warm cache wins.** First run after a fresh clone is slow; subsequent runs are fast. The module cache lives in `$GOMODCACHE` (usually `$HOME/go/pkg/mod`).
- **Use a corporate proxy** if your team shares dependencies. `GOPROXY=https://corp-proxy,...` cuts internet round-trips dramatically.
- **Don't run `go mod tidy` in a tight loop in CI.** It is idempotent — once is enough per build.
- **Vendor for the build hot path.** If your CI runs many builds per minute, `go mod vendor` (see [03-go-mod-vendor](../03-go-mod-vendor/junior.md)) makes builds fully offline and fast. Run tidy beforehand, then vendor.
- **Keep `go.mod` minimal.** Tidy already does this for you; the point is, do not manually pad it.
- **Use `-e` only when you need it.** It does extra work. The default fail-fast mode is faster on healthy modules.

---

## Best Practices

1. **Run `go mod tidy` after every change to imports.** Make it muscle memory.
2. **Commit `go.mod` and `go.sum` together.** Same commit. Always.
3. **Never hand-edit `// indirect` comments** — tidy owns them.
4. **CI must enforce a tidy module.** A diff after `go mod tidy` should fail the build.
5. **Use `go get module@version` to pin or upgrade specific versions**, then tidy to settle the graph.
6. **Trust the toolchain over the documentation in your head.** When in doubt about `go.mod` content, run tidy and read the output.
7. **Do not ignore tidy warnings.** They almost always indicate a real problem.
8. **Keep your Go version reasonably current.** Tidy's behaviour improves substantially across Go versions; staying within one or two minor versions of the latest release pays off.
9. **Tidy *before* `go test ./...` in CI.** A drifted `go.mod` can cause tests to fail for non-test reasons.
10. **Document any non-default flags** (like `-go=1.21` or `-compat=1.20`) in your project's CONTRIBUTING file so future contributors know what to do.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Build added a require but tidy removed it

You ran `go build`, it auto-added a require line. You then ran `go mod tidy` and the line vanished. Usually this means the build added the dep for one platform/build-tag and tidy considers the file irrelevant on the current build. The fix is to ensure tidy considers all relevant files — see Pitfall 4.

### Pitfall 2 — Conditional imports under build tags

A file guarded by `//go:build linux` is invisible to tidy when you run on macOS — *unless* you tell tidy otherwise. By default, modern Go (`1.17+`) considers all build tags in tidy. But on older Go versions you may need:

```bash
go mod tidy -compat=1.17
```

Or explicitly:

```bash
GOOS=linux go mod tidy
```

When in doubt, run on every supported `GOOS`/`GOARCH`.

### Pitfall 3 — Test-only imports

Imports that appear only in `_test.go` files **are** tracked by tidy. They appear in `go.mod` as `// indirect` if they are needed only by tests of other modules in your graph. Do not assume "test imports do not count."

### Pitfall 4 — A folder excluded by `.go` ignore patterns

Tidy walks the directory tree but ignores certain folders (e.g. anything starting with `.` or `_`, plus `testdata/`). If you keep example code in `testdata/`, those imports are invisible to tidy. This is intentional but surprises new users.

### Pitfall 5 — Replace directives changing the graph

A `replace` directive in `go.mod` redirects a module to a different source. Tidy honours replaces. If you remove a replace, the next tidy may pull the upstream version, which can change the graph dramatically.

### Pitfall 6 — Out-of-sync after a merge

Two branches each ran tidy; merging produces a `go.mod`/`go.sum` that no longer matches imports. Run tidy after every merge of a branch that touched imports.

### Pitfall 7 — Tidy on a sub-folder that is not the module root

`go mod tidy` operates on the *module*, not the current directory. Running it from `myapp/internal/` still tidies the module rooted at `myapp/`. That is correct, but new users sometimes expect a sub-folder mode. There isn't one.

### Pitfall 8 — Modules with no Go files

A module that contains only `.proto` files or `.md` files (and no `.go` files at all) confuses tidy: it has nothing to scan. Add at least one `.go` file (even an empty `package doc`).

---

## Common Mistakes

- **Editing `go.mod` to add a `require` line by hand.** Use `go get module@version` instead — it picks a real version and updates `go.sum`.
- **Deleting `go.sum` "to clean up."** Always wrong. The diff after the next tidy will be enormous and unreadable.
- **Forgetting to commit `go.sum`.** Other developers' builds will fail mysteriously.
- **Running tidy from a different folder than the module root.** Works (tidy figures it out), but confuses people watching your terminal.
- **Removing `// indirect` markers because they look ugly.** They are not decorative.
- **Running tidy *only* in CI and being surprised when local builds drift.** Run it locally too.
- **Assuming `go build` is enough.** It is not — tidy is.
- **Running tidy with `GOFLAGS=-mod=readonly`.** Tidy's whole job is to *write* `go.mod`. The flag combination is contradictory; some Go versions will refuse.
- **Ignoring the network roundtrip on a new machine.** First tidy in a fresh checkout pulls the cache; this is normal.

---

## Common Misconceptions

> *"`go mod tidy` upgrades my dependencies."*

No. Tidy keeps existing versions whenever possible. To *upgrade*, use `go get -u`. Tidy is conservative.

> *"`go mod tidy` is the same as `go get`."*

No. `go get` is for adding/removing/upgrading specific modules. Tidy reconciles the entire graph after the imports have changed.

> *"`go mod tidy` requires the internet."*

It can be satisfied by the local module cache if every needed version is already there. In practice it usually does hit the network, but a fully populated cache makes it offline-capable.

> *"`go.sum` only matters in CI."*

It matters in every build. The toolchain verifies hashes on every compile. CI just makes the failure visible.

> *"If `go build` succeeds, my `go.mod` is correct."*

Not quite. `go build` succeeds with a *minimal* `go.mod` that may be missing checksums for indirect deps. Tidy ensures the graph is *complete*.

> *"Indirect dependencies are not my problem."*

They become your problem the moment one of them has a CVE or a breaking bug. Tidy at least makes them visible.

> *"`go mod tidy` is destructive."*

It mutates `go.mod` and `go.sum`, but only in ways the toolchain can re-derive. The mutations are deterministic and version-controlled. The risk is exactly zero if you commit the result.

---

## Tricky Points

- **The `go` directive controls tidy behaviour.** Pre-1.17 modules listed every transitive in one block; 1.17+ split direct from indirect. Bumping `go 1.16` to `go 1.17` and running tidy reshapes `go.mod`.
- **`-compat` flag.** `go mod tidy -compat=1.17` ensures the resulting `go.mod` is buildable by Go 1.17. Useful for libraries with broad version support.
- **Tidy updates checksums for *every* module in the build graph**, including ones referenced only by `go.mod` files of dependencies. That is why `go.sum` is twice as long as you might expect.
- **Tidy can change between Go versions.** A `go.mod` tidy for 1.20 may differ slightly from one tidy for 1.22. CI on multiple Go versions can produce diffs. Standardise the Go version in CI.
- **A module without any imports needs no `go.sum`.** That file is created the first time tidy encounters a dependency.
- **Replace directives shadow tidy.** A `replace foo => ./local` keeps `foo`'s version frozen — tidy will not pull a different version for it.
- **Two `// indirect` lines for the same module are not allowed.** Tidy collapses them. If a merge produces duplicates, run tidy.
- **`go mod tidy` does not run `go vet`, does not run tests, does not check syntax.** It only looks at imports.

---

## Test

Try this hands-on test in a scratch folder.

```bash
mkdir tidy-test
cd tidy-test
go mod init example.com/tidy-test
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
cat go.mod
ls
```

Expected:
- `go.mod` now contains a `require github.com/google/uuid vX.Y.Z` line.
- A new file `go.sum` exists with at least two lines.
- `go build` succeeds.

Now answer:
1. What happens to `go.mod` if you delete the `import "github.com/google/uuid"` line and re-run `go mod tidy`?
   (Answer: the require line for `uuid` disappears.)
2. What happens if you delete `go.sum` and re-run `go mod tidy`?
   (Answer: it is re-created with the same entries.)
3. What happens if you delete `go.mod` and re-run `go mod tidy`?
   (Answer: error — there is no module to tidy.)
4. What does `go mod tidy -v` add to the output?
   (Answer: it lists modules that were removed from `go.mod`.)

---

## Tricky Questions

**Q1.** I added an import. `go build` works fine. Do I still need `go mod tidy`?

A. Yes. `go build` may have added a minimal `require` line, but `go.sum` may be missing checksums for indirect dependencies, and any `// indirect` markers may be wrong. CI on a clean clone will fail. Always finish with tidy.

**Q2.** What is the difference between `go get foo` and `go mod tidy`?

A. `go get foo` *adds or upgrades* a specific module to a specific version (or latest). `go mod tidy` *reconciles* the entire `go.mod`/`go.sum` to whatever your imports currently say. Use `go get` to make a deliberate version change; use tidy after every import change.

**Q3.** Tidy keeps adding `github.com/foo/bar // indirect` even though I do not import it. Why?

A. Some module in your dependency graph imports it. Tidy is correctly recording that fact. To remove it, remove the dependency that pulls it in.

**Q4.** Can I run `go mod tidy` on someone else's clone?

A. Yes, but on a clean repo it should be a no-op. If it produces a diff, the upstream repo is drifted — open a PR or notify the maintainer.

**Q5.** I get "missing go.sum entry" inside Docker but not on my laptop. What is happening?

A. Your laptop probably has the entries cached and the file is partially missing. Run tidy locally, commit the fully-populated `go.sum`, and rebuild the image. Inside CI/Docker, the cache is cold; the file must be authoritative.

**Q6.** Should I check `go.sum` into version control?

A. Always. It is part of the source code. Treat it like a lockfile.

**Q7.** What happens if I run `go mod tidy` on a module with zero `.go` files?

A. Tidy succeeds but `go.mod` ends up nearly empty (just module + go directive). With no imports, there is nothing to require.

**Q8.** Why does `go.sum` sometimes contain entries I do not see in `go.mod`?

A. Because `go.sum` records hashes for every module in the **build graph**, including modules referenced only by other `go.mod` files in the chain. This is normal and required for reproducibility.

**Q9.** I ran `go mod tidy` and a dependency *upgraded* itself. Why?

A. Probably because someone else upstream released a new patch and your previous `require` was looser than you thought, or a transitive dep bumped its requirement. Tidy chose the new minimum-of-maximums. To pin, use `go get module@oldversion`.

**Q10.** `go mod tidy` is hanging for minutes. Is it broken?

A. Probably not. First runs on a cold cache for a deep dependency tree can take a long time, especially on slow networks. Try `GOFLAGS=-x go mod tidy` to see what it is doing. If genuinely stuck, check `GOPROXY` is reachable.

---

## Cheat Sheet

```bash
# The default: tidy go.mod and go.sum
go mod tidy

# Verbose: show modules that were removed
go mod tidy -v

# Continue past errors
go mod tidy -e

# Target a specific Go language version
go mod tidy -go=1.21

# Drift check (CI-style)
go mod tidy && git diff --exit-code go.mod go.sum

# After cloning someone else's repo (NOT needed; build verifies)
go build ./...

# Add a specific version then settle the graph
go get github.com/foo/bar@v1.4.2
go mod tidy

# Investigate a slow tidy
GOFLAGS=-x go mod tidy
```

| Symptom | Likely Cause | Quick Fix |
|---------|-------------|-----------|
| `no required module provides package X` | Typo or unknown module | Verify path on pkg.go.dev |
| `missing go.sum entry` | Drifted `go.sum` | `go mod tidy` |
| `module declares its path as A but was required as B` | Module rename / mis-spelled require | Use canonical path |
| `checksum mismatch` | Corrupted cache or tampering | `go clean -modcache && go mod tidy`, then investigate |
| Unexpected diff in `go.mod` after tidy | Drift from a prior commit | Commit the diff |
| Tidy adds `// indirect` markers I do not want | A transitive dep needs them | Leave them; they are correct |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what `go mod tidy` does
- [ ] Distinguish a direct from an indirect dependency
- [ ] Read `// indirect` markers correctly
- [ ] Predict whether a tidy run will add or remove a `require` line
- [ ] Explain why `go build` is not a substitute for tidy
- [ ] Describe what `go.sum` is for and why it has two lines per module
- [ ] Recover from "missing go.sum entry" without panic
- [ ] Recognise the four most common tidy error messages
- [ ] Use tidy as a CI drift detector
- [ ] Know which flags exist (`-v`, `-e`, `-go`, `-compat`) and what they do at a high level
- [ ] Run `go get module@version` followed by `go mod tidy` to pin a specific version

---

## Summary

`go mod tidy` is the synchronisation command that keeps `go.mod` and `go.sum` in lockstep with the actual `import` statements in your code. It walks your `.go` files, builds the set of required imports, resolves the full module graph, and rewrites the two metadata files: `go.mod` for human-readable dependency declarations (with `// indirect` markers where appropriate), `go.sum` for cryptographic checksums of every byte in the build graph.

Run it after every change to imports. Commit `go.mod` and `go.sum` together. Use it in CI as a drift detector. It is idempotent, deterministic, and the single most-used `go mod` subcommand in daily Go life.

You do not need to understand Minimum Version Selection, build tags, or `replace` directives at depth as a junior — just know that tidy handles them, and that the imports in your code are the source of truth.

---

## What You Can Build

After learning this:

- **A CLI app that uses cobra/viper/spf13** — confidently add the imports, tidy, build.
- **A small HTTP service** that uses `github.com/gorilla/mux` or `github.com/go-chi/chi`.
- **A JSON-driven tool** that pulls in a YAML or TOML library.
- **A CI pipeline step** that fails on drift between code imports and `go.mod`.
- **A library you publish on GitHub** that consumers can `go get` and that builds reproducibly thanks to your tidy `go.sum`.

You cannot yet:
- Vendor your dependencies for offline-first builds (next: 6.1.3 `go mod vendor`)
- Override module sources with `replace` directives (later: 6.1.4)
- Manage multiple modules in a workspace (later: 6.1.5 `go work`)
- Publish a v2+ module with the major-version path suffix (later: 6.2.3)

---

## Further Reading

- [Go Modules Reference](https://go.dev/ref/mod) — the authoritative spec.
- [`go mod tidy`](https://go.dev/ref/mod#go-mod-tidy) — the subcommand reference.
- [Module version numbering](https://go.dev/ref/mod#versions) — how versions are chosen.
- [Minimum Version Selection](https://research.swtch.com/vgo-mvs) — Russ Cox's original essay.
- [Go 1.17 release notes — go mod tidy improvements](https://go.dev/doc/go1.17#go-command) — the indirect-block split.
- [Module proxy protocol](https://go.dev/ref/mod#module-proxy) — how tidy talks to the network.

---

## Related Topics

- [6.1.1 `go mod init`](../01-go-mod-init/junior.md) — the prerequisite step
- [6.1.3 `go mod vendor`](../03-go-mod-vendor/junior.md) — capture the tidy graph as a folder
- 6.1.4 `replace` directives — overriding what tidy sees
- 6.1.5 Multi-module workspaces (`go work`) — tidy across multiple modules
- [6.2.1 Package import rules](../../02-packages/01-package-import-rules/junior.md) — how imports become module references
- [6.2.3 Publishing modules](../../02-packages/03-publishing-modules/junior.md) — making *your* module tidyable by others
- 11.1.5 `go mod` subcommand reference — every `go mod` flag

---

## Diagrams & Visual Aids

```
The tidy loop:

    .go files (with imports)
            │
            │  go mod tidy
            ▼
    +------------------------+
    | scan every .go file    |
    | collect import paths   |
    +------------------------+
            │
            ▼
    +------------------------+
    | resolve module graph   |
    | (Minimum Version Sel.) |
    +------------------------+
            │
            ▼
    +------------------------+
    | rewrite go.mod         |
    | rewrite go.sum         |
    +------------------------+
            │
            ▼
    Tidy module ready to build
```

```
Direct vs indirect (after tidy):

    main.go ──── imports ────► github.com/spf13/cobra      (DIRECT)
                                       │
                                       │ depends on
                                       ▼
                              github.com/spf13/pflag        (INDIRECT)
                                       │
                                       │ depends on
                                       ▼
                              github.com/incon...mousetrap  (INDIRECT)

go.mod:
    require github.com/spf13/cobra v1.8.0          ← direct, no // indirect

    require (
        github.com/spf13/pflag v1.0.5 // indirect
        github.com/inconshreveable/mousetrap v1.1.0 // indirect
    )
```

```
go.sum lines (two per module):

    github.com/spf13/cobra v1.8.0 h1:<hash-of-source>
    github.com/spf13/cobra v1.8.0/go.mod h1:<hash-of-go.mod>
                            ───────
                            second line: hashes the dep's go.mod file
                            ────
                            first line: hashes the dep's source tree
```

```
"I added an import" workflow:

    edit code  ──►  go mod tidy  ──►  go build / go test  ──►  git commit
       │                                                            │
       │                                                            │
       └──── if build fails with "no required module ..." ──────────┘
             (fix the import path, rerun tidy)
```

```
Tidy as a drift detector in CI:

       developer laptop                       CI machine
       ----------------                       ----------
       edit imports                           git clone
       (forget to tidy)                       go mod tidy
       git push                               git diff go.mod go.sum
                                              │
                                              ├── empty?  ✓ pass
                                              └── non-empty?  ✗ FAIL
                                                  → developer fixes locally
                                                    and re-pushes
```

```
Module cache and proxy:

    your code  ─►  go mod tidy
                       │
                       ▼
                  $GOMODCACHE  ◄──── (warm cache; no network)
                       │
                       ▼ (cache miss)
                   $GOPROXY  (proxy.golang.org)
                       │
                       ▼ (proxy miss)
                  origin VCS (github.com, etc.)
```
