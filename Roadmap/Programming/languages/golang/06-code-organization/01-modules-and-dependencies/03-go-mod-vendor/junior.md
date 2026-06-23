# `go mod vendor` — Junior Level

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
> Focus: "What is vendoring?" and "Why would I copy my dependencies into the project?"

After you have run `go mod init` and started using third-party libraries, your code does not actually contain those libraries. Instead, `go.mod` lists the names and versions, and Go downloads them on demand into a *module cache* that lives outside your project (somewhere under `$GOPATH/pkg/mod`). When you build, Go reads them from there.

That is fine 95% of the time. But sometimes you want every byte of every dependency to live *inside* your project — committed to Git, visible in pull requests, frozen forever. That is what `go mod vendor` is for.

```bash
go mod vendor
```

Run that one command in a module's root, and Go will create a folder named `vendor/` next to `go.mod`. Inside it, you will find a copy of the source code of every package your module imports — directly or transitively. From that point on, `go build` will use the `vendor/` folder *instead of* the module cache, automatically.

After reading this file you will:
- Understand what vendoring is and why it exists
- Know what `go mod vendor` produces, line by line
- Know when to use it and when not to
- Read the `vendor/modules.txt` file
- Understand the relationship between `go mod tidy` and `go mod vendor`
- Recover from "inconsistent vendoring" errors

You do **not** need to understand workspaces, replace directives, or private module proxies yet. This file is about the moment you say "I want my dependencies *here*, in this folder, forever."

---

## Prerequisites

- **Required:** A working Go installation, version 1.14 or newer. Auto-detection of `vendor/` was added in 1.14. Check with `go version`.
- **Required:** A Go module — that is, a folder with a `go.mod` file. If you are not sure, see [01-go-mod-init/junior.md](../01-go-mod-init/junior.md).
- **Required:** Familiarity with `go mod tidy`. Vendor is normally run *after* tidy. See [02-go-mod-tidy/junior.md](../02-go-mod-tidy/junior.md).
- **Required:** Comfort with `cd`, `ls`, and basic Git (you will be committing the `vendor/` folder).
- **Helpful:** Having added at least one external dependency to a module via `go get` so you have something to vendor.

If `go version` prints `go version go1.14` or higher, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Vendoring** | Copying the source of every dependency into the project itself, so that builds do not need network access or the module cache. |
| **`vendor/` directory** | The top-level folder, sibling to `go.mod`, that holds the vendored copies. |
| **`vendor/modules.txt`** | An auto-generated index inside `vendor/` listing every vendored module, its version, and which packages of it were copied. |
| **Module cache** | The system-wide read-only cache (under `$GOPATH/pkg/mod`) where Go stores downloaded modules. The default source of dependencies *unless* `vendor/` is present. |
| **`-mod=vendor`** | Build flag telling Go to use `vendor/` as the source of truth. Implicit when `vendor/` exists (since Go 1.14). |
| **`-mod=mod`** | Build flag telling Go to ignore `vendor/` and use the module cache (and possibly download). |
| **`-mod=readonly`** | Build flag telling Go not to modify `go.mod` or `go.sum`; compatible with vendoring. |
| **Transitive dependency** | A dependency of a dependency. Vendoring includes the transitive closure of imports. |
| **`go.sum`** | The cryptographic-hash file that records exactly which bytes of which modules were used. Vendoring does not replace `go.sum`. |
| **Inconsistent vendoring** | The error you get when `vendor/modules.txt` disagrees with `go.mod`. Fix: re-run `go mod vendor`. |

---

## Core Concepts

### What `go mod vendor` actually does

Mechanically, the command performs five steps:

1. Reads `go.mod` to learn which modules and versions you depend on.
2. Reads `go.sum` to verify the integrity of the source it is about to copy.
3. Walks the import graph of your module to determine which *packages* (not whole modules) are actually needed for a build.
4. Copies the source of those packages from the module cache into a new top-level folder named `vendor/`, preserving the import path layout.
5. Writes a manifest at `vendor/modules.txt` that records what was copied.

That is all. It does not download anything new (the cache is already populated; `go mod tidy` did that). It does not modify `go.mod`. It does not run tests.

### `vendor/` is a snapshot, not a live mirror

Once `vendor/` exists, it does not auto-update. If you run `go get example.com/foo@v1.5.0` and bump a dependency, the *new* version is in the module cache, but the *old* version is still in `vendor/`. Your build will silently use the old vendored copy until you re-run `go mod vendor`.

This is by design. Vendoring is the act of "freezing" a snapshot of your dependencies at a point in time. The freezing is valuable — but it requires manual refresh.

### Auto-detection: vendor wins when present

Since Go 1.14, when the toolchain runs `go build`, `go test`, `go vet`, etc., it checks whether a `vendor/` directory exists at the module root. If yes, it behaves *as if* you passed `-mod=vendor` — meaning it reads source from `vendor/` and refuses to download anything.

To force the toolchain to ignore `vendor/`, pass `-mod=mod`:

```bash
go build -mod=mod ./...
```

But if `vendor/` exists, you almost never want to ignore it. The whole point of having it is to use it.

### Only imported packages are vendored

A dependency module might contain dozens of packages. `go mod vendor` only copies the packages your module's import graph actually reaches. If you import `github.com/some/lib/foo`, you get `foo/` and any package `foo/` imports — but not unrelated sibling packages of the same module.

This keeps `vendor/` smaller than a naive "copy the whole dependency" approach. It also means the contents of `vendor/` change when *your* imports change, even if `go.mod` does not.

### Test files are *not* vendored by default

Files ending in `_test.go` belonging to dependencies are not copied into `vendor/`. The reasoning: you are vendoring to build *your* program, not to re-run *their* tests. If you do need test sources for some reason, pass `-e` and inspect — there is also a long-form `-include-tests`-style invocation in some tooling, but the default is "no test files."

### Order matters: tidy first, then vendor

The canonical sequence is:

```bash
go mod tidy
go mod vendor
```

`go mod tidy` decides which modules are required and updates `go.mod`/`go.sum`. `go mod vendor` then reads those files and copies bytes. If you reverse the order, `vendor/` may include stale dependencies or omit needed ones.

### What gets committed to Git

This is the question every team eventually argues about. The standard answer is:

- **Yes, commit the entire `vendor/` directory.** That is the entire point — reproducible, no-network, no-surprises builds.
- **Yes, also commit `go.mod` and `go.sum`.** They are not redundant; they remain the canonical source of "what versions did we ask for."
- **Yes, commit `vendor/modules.txt`.** It is part of `vendor/`.

If you are not going to commit `vendor/`, do not vendor in the first place.

---

## Real-World Analogies

**1. A photocopied reference packet.** Imagine a researcher who needs to read 30 articles. They could rely on the public library being open whenever they want — or they could photocopy all 30 articles and put them in a binder on their desk. The binder is `vendor/`. No internet, no library hours, no "the journal moved its archive." Everything is right there.

**2. The "emergency rations" pantry.** Most days you cook with fresh groceries (the module cache). But once in a while — a snowstorm, a power outage, a strict audit — you reach for the pantry of canned goods. Vendoring is keeping a sealed pantry of dependencies, cans dated and labelled, ready when the network is unreliable.

**3. A frozen photograph.** A digital photo that lives only on a server can disappear when the server changes. A printed copy in an album is yours forever, exactly as it was at the moment of printing. Vendoring is printing the album.

**4. A briefcase before a long flight.** You will not have Wi-Fi for ten hours. Anything you do not have already is unreachable. So you pack: every PDF, every dataset, every dependency. `vendor/` is the briefcase.

---

## Mental Models

### Model 1 — `vendor/` is a sibling of `go.mod`

It sits at the module root. It is not nested, not under `internal/`, not under `pkg/`. It is one level deep. The toolchain looks for it in exactly that one place.

### Model 2 — Vendoring trades disk for determinism

You spend disk space (sometimes hundreds of MB) and Git history bloat in exchange for not depending on any network resource at build time. For some teams that trade is a no-brainer; for others it is overkill.

### Model 3 — `vendor/modules.txt` is the contract

`go.mod` says "these versions." `vendor/modules.txt` says "these versions, and these packages within them, were copied." If those two disagree, the toolchain refuses to build until you re-vendor.

### Model 4 — Vendoring is a *publication step*

Just like compiling a binary, vendoring is a *snapshot operation*: you do it deliberately, you commit the result, and then you stop touching it until you intentionally want a new snapshot. It is not part of your inner-loop edit cycle.

### Model 5 — Build sources, layered

When `go build` needs a package, it consults sources in this order:

```
[1] standard library    (always; built into the toolchain)
[2] vendor/             (if it exists; falls back only when the import is std)
[3] module cache        (if vendor/ does not exist or -mod=mod is set)
[4] network proxy       (if cache is missing the version)
```

Vendoring "short-circuits" steps 3 and 4 entirely.

---

## Pros & Cons

### Pros

- **Builds work offline.** No network, no proxy, no DNS, no surprise.
- **Builds are deterministic.** Anyone with the same source tree gets the same dependency bytes.
- **Audits are easy.** Reviewers can read every line of every dependency in a pull request.
- **Compliance friendly.** Legal can scan the `vendor/` tree for licenses; it is all right there.
- **No reliance on a third-party proxy.** If `proxy.golang.org` is down or geo-blocked, you still build.
- **Old projects keep building.** Even if a dependency is taken down (yanked from GitHub), your vendored copy is unaffected.

### Cons

- **Repository size grows.** A medium project can balloon to 50–500 MB.
- **Pull requests get noisy.** A dependency bump touches hundreds of files in `vendor/`.
- **Easy to forget to re-vendor.** You change `go.mod` but forget `go mod vendor`; CI breaks.
- **Stale snapshot risk.** Security patches in upstream do not reach you until you re-vendor.
- **Tooling friction.** Some linters and IDEs scan `vendor/` and produce noise. You have to teach them to skip it.

The tradeoff is acceptable when offline determinism is non-negotiable. Otherwise, modern Go without vendoring is usually fine.

---

## Use Cases

You should run `go mod vendor` when:

- **Your CI runs without internet access.** Some hardened CI systems have egress rules.
- **You build inside an air-gapped environment.** Government, defence, regulated finance.
- **You ship to embedded or edge devices** that build at deploy time without network.
- **You want pull-request-level visibility into dependency changes.** Reviewers see exact byte-for-byte changes in `vendor/`.
- **You require legal/compliance review of every dependency line.** License scanning is straightforward over `vendor/`.
- **You want to insulate yourself from upstream takedowns.** A vendored copy survives a deleted GitHub repo.
- **You want maximum reproducibility.** Even five years from now, given this commit, the build will succeed.

You should **not** run `go mod vendor` when:

- You do not commit `vendor/`. Then you got nothing — only disk noise.
- You are working on a small library and have no special requirements.
- Your team is allergic to large diffs and cannot tolerate noisy reviews.
- You believe `proxy.golang.org` and the module cache are sufficient (which, for most people, they are).

---

## Code Examples

### Example 1 — Vendoring a single-dependency module

Start fresh.

```bash
mkdir hello
cd hello
go mod init example.com/hello
```

Now write a `main.go` that uses `github.com/google/uuid`:

```go
package main

import (
    "fmt"

    "github.com/google/uuid"
)

func main() {
    id := uuid.New()
    fmt.Println("new id:", id)
}
```

Tidy and vendor:

```bash
go mod tidy
go mod vendor
```

Now look around:

```bash
$ ls
go.mod  go.sum  main.go  vendor

$ ls vendor
github.com  modules.txt

$ ls vendor/github.com/google/uuid
CHANGELOG.md  LICENSE  README.md  doc.go  hash.go  ...
```

Build with vendoring (no internet needed):

```bash
go build .
./hello
# new id: 5b8c...
```

### Example 2 — Inspecting `vendor/modules.txt`

Open the file:

```bash
$ cat vendor/modules.txt
# github.com/google/uuid v1.6.0
## explicit; go 1.19
github.com/google/uuid
```

Decoding it line by line:

- `# github.com/google/uuid v1.6.0` — module path and version.
- `## explicit; go 1.19` — `explicit` means *your* `go.mod` mentions this directly; `go 1.19` is the dependency's required Go version.
- `github.com/google/uuid` — the import path of the vendored package.

A larger project will have dozens of these blocks.

### Example 3 — Forcing a non-vendored build

If for some reason you want to bypass `vendor/` and use the cache:

```bash
go build -mod=mod .
```

This is rarely useful in day-to-day work; mostly it is for debugging "is my vendor folder out of date?".

### Example 4 — Refreshing after a dependency bump

You decide to upgrade a dependency:

```bash
go get github.com/google/uuid@v1.6.0
go mod tidy
go mod vendor
git add go.mod go.sum vendor/
git commit -m "bump uuid to v1.6.0"
```

The three-command dance — `get`, `tidy`, `vendor` — is the standard refresh recipe.

### Example 5 — Cleaning up

If you decide vendoring is not for you:

```bash
rm -rf vendor
git add -A
git commit -m "stop vendoring deps"
```

The next `go build` will silently fall back to the module cache. Nothing else changes.

### Example 6 — A multi-import vendored project

```go
package main

import (
    "fmt"

    "github.com/google/uuid"
    "github.com/spf13/pflag"
)

func main() {
    name := pflag.String("name", "world", "who to greet")
    pflag.Parse()
    fmt.Printf("hello, %s — your id is %s\n", *name, uuid.New())
}
```

After `go mod tidy && go mod vendor`:

```
vendor/
├── github.com/
│   ├── google/
│   │   └── uuid/
│   └── spf13/
│       └── pflag/
└── modules.txt
```

The transitive dependencies of `pflag` would also appear, if any.

---

## Coding Patterns

### Pattern: tidy-then-vendor as a Make target

Most teams encode the dance in a Makefile or shell script:

```Makefile
.PHONY: deps
deps:
	go mod tidy
	go mod vendor
```

Then everyone says `make deps` instead of remembering two commands.

### Pattern: CI verification

CI should refuse to merge a PR whose `vendor/` is out of sync:

```bash
go mod tidy
go mod vendor
git diff --exit-code go.mod go.sum vendor
```

If `git diff --exit-code` returns non-zero, the contributor forgot to re-vendor.

### Pattern: `.gitignore` *does not* exclude `vendor/`

The most common newbie reflex is to add `vendor/` to `.gitignore`. **Do not.** That defeats the entire purpose. If you do not commit `vendor/`, you have all of vendoring's costs and none of its benefits.

### Pattern: Treat vendor changes like content changes

A pull request that bumps a dependency will touch hundreds of files. Reviewers should learn to focus on `go.mod` and `go.sum` — those tell the human story — and treat the `vendor/` diff as scaffolding generated from those.

---

## Clean Code

- **Always run `go mod tidy` before `go mod vendor`.** They form a pair.
- **Commit `go.mod`, `go.sum`, and `vendor/` together** in a single commit. Splitting them into separate commits leaves the repo in an inconsistent intermediate state.
- **Do not edit files inside `vendor/` by hand.** The next `go mod vendor` will overwrite your changes. If you must patch a dependency, use `replace` directives in `go.mod` (advanced topic).
- **Keep `vendor/` out of code coverage and lint reports.** Add explicit excludes:
  - `golangci-lint`: `--skip-dirs vendor`
  - `gofmt`: it skips `vendor/` automatically since 1.13.
- **Do not vendor and then partially commit.** The tree must be all-or-nothing.

---

## Product Use / Feature

When you ship software professionally, vendoring affects:

- **Build pipelines.** Slightly longer cloning (more files), faster build (no download step).
- **License compliance.** Tools like `go-licenses` work great over `vendor/`.
- **Security scanning.** SAST tools can examine vendored code directly.
- **Reproducibility audits.** "Can we rebuild a 2022 release in 2026?" is a yes if `vendor/` is committed and Go is installed.
- **Onboarding.** New developers `git clone` and immediately `go build` without configuring proxies.

For some industries — finance, healthcare, defence, automotive — vendoring is effectively a requirement, not a preference.

---

## Error Handling

`go mod vendor` itself rarely fails, but its consumers (subsequent `go build`/`go test` calls) may.

### "inconsistent vendoring in <module>"

The most famous error. It means `vendor/modules.txt` does not match `go.mod`. Causes:

- You edited `go.mod` (added/removed a `require`) without re-running `go mod vendor`.
- You hand-edited `vendor/modules.txt`.
- You merged a branch and the conflict resolution missed `vendor/`.

Fix:

```bash
go mod tidy
go mod vendor
```

### "missing go.sum entry"

You ran `go mod vendor` before `go mod tidy`, so `go.sum` has no hash for some module the import graph reached. Fix: tidy first.

### "package <X> is not in std (...)"

You imported a package that is not in any module listed by `go.mod`. Fix: `go get example.com/X` first, then `go mod tidy`, then `go mod vendor`.

### Network errors during `go mod vendor`

If your module cache is missing some versions, `go mod vendor` will try to download them. On a restricted network this fails. Fix: ensure you have network access *for the one-time vendoring step*, or pre-populate the cache from another machine.

### "vendor/modules.txt does not exist"

You created a `vendor/` folder by hand and Go is confused. Fix: delete the folder and re-run `go mod vendor` so it creates a real one.

---

## Security Considerations

- **Vendoring freezes a *known* snapshot.** That is good for reproducibility and bad for security: a CVE in a vendored dependency does not get patched until you re-vendor.
- **Code review benefits.** Vendoring forces every dependency change to appear as a diff in PR review. Malicious upstream changes become visible.
- **Supply-chain insulation.** A compromised proxy or a yanked package cannot affect your build if your `vendor/` already contains the trusted bytes.
- **Hash integrity is preserved.** `go.sum` still validates the cache bytes that get copied; you cannot vendor a tampered dependency without `go.sum` flagging it.
- **Do not store secrets in `vendor/`.** Obvious, but worth saying — the folder is committed to Git and in some industries treated as "third-party code only," so do not pollute it with internal artifacts.
- **Keep an eye on upstream advisories.** Run `govulncheck` or similar against your vendored tree on a schedule.

---

## Performance Tips

- **First `go mod vendor` is slow** (it copies thousands of files); subsequent runs only update what changed.
- **Build performance is *better* with vendoring** — Go does not have to consult the cache or proxy. For large projects this can shave seconds.
- **CI cache warmup is unnecessary.** With vendoring, you do not need to cache `$GOPATH/pkg/mod` between builds; the deps are in the repo.
- **Watch repository size.** A 200 MB `vendor/` slows down `git clone`. Use shallow clones in CI (`git clone --depth 1`) when possible.
- **`vendor/` is excluded from `go vet ./...` automatically** — vet skips vendored packages.

---

## Best Practices

1. **Always pair `go mod tidy` with `go mod vendor`.** Even if it feels redundant.
2. **Commit the entire `vendor/` directory.** Or do not vendor.
3. **Verify in CI** that `vendor/` is in sync with `go.mod`/`go.sum`.
4. **Document in your README** that the project is vendored and any contributor must run the tidy-vendor pair before pushing.
5. **Update vendored dependencies on a regular cadence.** Monthly is reasonable; never is dangerous.
6. **Do not mix vendored and unvendored modules in a workspace** — workspaces (`go.work`) and vendoring have specific interactions that are out of scope for junior level.
7. **Use `-mod=vendor` explicitly in CI** to be safe, even though it is the default when `vendor/` exists.
8. **Treat `vendor/` as read-only**. Patches go in `replace` directives, not in-place edits.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting to re-vendor after `go get`

You upgrade a dep, push, and CI fails with "inconsistent vendoring." Always: `go get` -> `go mod tidy` -> `go mod vendor` -> commit all four (`go.mod`, `go.sum`, `vendor/`, your code).

### Pitfall 2 — `.gitignore` containing `vendor/`

Common in projects that *used* to not vendor. The result: every developer vendors locally, but no one's `vendor/` is committed. Catastrophic — you have all the noise, none of the benefit.

### Pitfall 3 — Hand-editing `vendor/`

Every junior tries it: "I just want this one bug fix." A re-vendor erases your edit silently. Use `replace` in `go.mod` instead.

### Pitfall 4 — Vendoring then changing the import without re-vendoring

You add `import "example.com/foo/bar"` in code. Build fails: `bar` is not in `vendor/`. Fix: re-vendor. The folder is a snapshot, not magic.

### Pitfall 5 — Cross-platform line endings

On Windows, Git can normalize line endings inside `vendor/` and break diffs. Add to `.gitattributes`:

```
vendor/** -text
```

This tells Git to leave vendored files alone.

### Pitfall 6 — Submodule-style nesting

If you place a Go module inside another module (rare, advanced), `vendor/` only applies to the *outer* module. Inner modules are independent.

### Pitfall 7 — Build tags hiding required imports

A package guarded by `//go:build linux` may be needed on Linux but not on macOS. `go mod vendor` is supposed to handle build tags correctly — but if you vendor on macOS only, double-check that the linux-only deps were included. They should be; the algorithm is platform-aware.

### Pitfall 8 — IDE confusion

Some IDEs index `vendor/` and report duplicate symbols. Configure the IDE to treat `vendor/` as a vendored dependency tree (most modern IDEs do this automatically).

---

## Common Mistakes

- **Adding `vendor/` to `.gitignore`.** The single most common mistake. Defeats the purpose.
- **Running `go mod vendor` once and forgetting it forever.** Vendoring is a habit, not a one-time event.
- **Editing files in `vendor/` to "fix" a dependency.** Use `replace`. Or fork upstream.
- **Running `go mod vendor` without `go mod tidy` first.** Produces stale or incomplete vendor trees.
- **Forgetting to commit `vendor/modules.txt`.** Some scripts only `git add vendor/github.com/...` and miss the manifest.
- **Mixing `-mod=mod` and `-mod=vendor` between developers.** Pick one stance per project.
- **Vendoring a private module that was already in a private cache.** Sometimes wasteful; sometimes necessary. Decide deliberately.
- **Vendoring just to "see what is in there."** OK once, as a learning exercise; do not commit it.

---

## Common Misconceptions

> *"Vendoring downloads my dependencies for me."*

No. `go mod tidy` (or `go get`) downloads them. `go mod vendor` only *copies* what is already in the cache. If the cache is empty, `go mod vendor` will trigger downloads as a side effect, but that is incidental.

> *"`vendor/` replaces `go.mod` and `go.sum`."*

No. All three coexist. `go.mod` declares; `go.sum` proves; `vendor/` materializes. Removing `go.mod` would make the project not even a module.

> *"Vendoring includes test files."*

No. `_test.go` files of dependencies are excluded by default.

> *"Vendoring is deprecated; modules replaced it."*

No. Modules and vendoring are designed to coexist. Vendoring is fully supported and actively maintained.

> *"If I vendor, my project no longer needs internet."*

For builds, mostly true. For other operations (`go get` to update, `go mod download` to refresh) you still need internet. Vendoring isolates the *build* path.

> *"`vendor/` is the same as `node_modules/`."*

Spiritually similar, mechanically very different. `node_modules/` is a per-platform install with binaries; `vendor/` is a portable, source-only, pre-pruned snapshot.

---

## Tricky Points

- **Auto-detection requires `vendor/modules.txt` to exist** — a `vendor/` without that manifest is treated as broken, not as "use it."
- **`go mod vendor` skips packages from the standard library.** Std is part of the toolchain, not the module cache.
- **The `go` directive in `go.mod` interacts with vendoring.** A `go 1.14` directive enables auto-vendoring. Older directives (`go 1.13`) require explicit `-mod=vendor`.
- **The vendor folder's path layout mirrors import paths exactly.** `github.com/google/uuid` becomes `vendor/github.com/google/uuid/...`. There is no flattening.
- **Replace directives are honoured during vendoring.** If `go.mod` has `replace example.com/foo => ./local/foo`, the local copy is what gets vendored.
- **`go list -mod=vendor all` shows you what is vendored** — useful for debugging.
- **Removing a dependency means three steps:** delete the import, run `go mod tidy`, run `go mod vendor`. Skipping the last leaves dead code in `vendor/`.

---

## Test

Try this in a scratch folder.

```bash
mkdir vendor-test
cd vendor-test
go mod init example.com/vt
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "github.com/google/uuid"
)

func main() {
    fmt.Println(uuid.New())
}
EOF
go mod tidy
go mod vendor
ls vendor
cat vendor/modules.txt
```

Expected: a `vendor/` directory exists, contains `github.com/google/uuid/`, and `vendor/modules.txt` mentions `github.com/google/uuid` with a version.

Now answer:
1. What happens if you delete `vendor/modules.txt` and run `go build`? (Answer: the toolchain reports vendoring is broken.)
2. What happens if you change the import in `main.go` to a different package and build without re-vendoring? (Answer: build fails — package not in vendor.)
3. What does `go build -mod=mod` do? (Answer: ignores `vendor/`, falls back to the cache.)
4. Are there `_test.go` files inside `vendor/github.com/google/uuid/`? (Answer: no.)

---

## Tricky Questions

**Q1.** I ran `go mod vendor` and `vendor/` is huge. Is something wrong?

A. Not necessarily. A real-world web service can vendor 100–500 MB. If the size shocks you, run `du -sh vendor/* | sort -h` to see which dependencies are largest. Often one or two transitive deps dominate.

**Q2.** Can I vendor only some dependencies and leave others to the cache?

A. No. Vendoring is all-or-nothing for a given module. If `vendor/` exists, every non-stdlib import must be inside it.

**Q3.** Do I still need `go.sum` if I have `vendor/`?

A. Yes. `go.sum` verifies the integrity of any cache fetch (e.g., when adding new deps before re-vendoring) and is consulted by tools like `govulncheck`. Always commit it.

**Q4.** What happens if I delete `vendor/` accidentally?

A. Builds will silently fall back to the module cache. No data loss in your code. Recover with `go mod vendor`. Commit the result.

**Q5.** Can `vendor/` and `go.work` (workspaces) coexist?

A. Carefully. As of Go 1.22, `go.work` files take precedence over `vendor/` for the modules they list. Junior advice: do not mix them; pick one mode per repository.

**Q6.** Why is `vendor/modules.txt` not just regenerated automatically when I build?

A. To keep builds deterministic and fast. The toolchain assumes you re-vendored deliberately. Auto-regeneration could mask staleness bugs.

**Q7.** I vendored a private internal module. Is that wise?

A. Often yes — it makes the build self-contained. But your private module's source is now in two places (its own repo and your `vendor/`), and a security advisory must be applied in both. Decide based on your team's workflow.

**Q8.** I deleted my entire module cache (`rm -rf $GOPATH/pkg/mod`). Will `go build` still work?

A. Yes, if `vendor/` is committed and intact. That is precisely the reproducibility property vendoring buys.

**Q9.** Can I use `go mod vendor` with Go 1.13?

A. The command exists, but auto-detection is 1.14+. On 1.13 you must pass `-mod=vendor` explicitly to `go build`. Upgrade to a current toolchain.

**Q10.** Does `go mod vendor` include `cgo` files?

A. Yes — `.c`, `.h`, `.m`, `.s` and similar files are copied alongside `.go` files when needed.

---

## Cheat Sheet

```bash
# The standard refresh dance
go mod tidy
go mod vendor

# Build using vendor/ (default when vendor/ exists)
go build ./...

# Force ignore vendor/ for one build
go build -mod=mod ./...

# Force using vendor/ explicitly (older Go versions)
go build -mod=vendor ./...

# What is vendored?
cat vendor/modules.txt

# How big is it?
du -sh vendor

# Verify CI: vendor must be in sync
go mod tidy
go mod vendor
git diff --exit-code -- go.mod go.sum vendor
```

```
After running `go mod vendor`, you have:

    project/
    ├── go.mod
    ├── go.sum
    ├── main.go
    └── vendor/
        ├── github.com/
        │   └── google/
        │       └── uuid/
        │           ├── LICENSE
        │           ├── doc.go
        │           ├── hash.go
        │           └── ...
        └── modules.txt
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `inconsistent vendoring` | `go.mod` changed; `vendor/` did not | `go mod tidy && go mod vendor` |
| `package X is not in std` | Imported a dep not in `go.mod` | `go get X && go mod tidy && go mod vendor` |
| Stale dep version used in build | Vendor not refreshed since `go get` | Re-vendor |
| Huge PR diff | Dependency bump | Normal; review `go.mod` instead |
| Vendor missing in clone | Someone gitignored `vendor/` | Remove from `.gitignore`, commit |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what `go mod vendor` does
- [ ] Name the two files you must commit alongside `vendor/`
- [ ] Read `vendor/modules.txt` and understand each line
- [ ] Predict the path inside `vendor/` for a given import path
- [ ] Explain the order of `go mod tidy` and `go mod vendor` and why
- [ ] Diagnose and fix an "inconsistent vendoring" error
- [ ] Decide whether vendoring is appropriate for a given project
- [ ] Explain why test files are not vendored
- [ ] Explain the difference between the module cache and `vendor/`
- [ ] Describe what happens when `vendor/` is deleted vs. when `go.mod` is deleted
- [ ] Override vendor auto-detection with `-mod=mod`

---

## Summary

`go mod vendor` is the command that copies the source of your module's dependencies — exactly the packages your imports actually need — into a top-level `vendor/` directory, with an index at `vendor/modules.txt`. Once that folder exists, the Go toolchain (since 1.14) automatically uses it for builds, ignoring the module cache.

The point is reproducibility, isolation from network failures, and visibility for code review and audits. The price is a larger repository and an extra step (re-vendor) every time dependencies change.

Run it after `go mod tidy`. Commit the entire `vendor/` directory or do not vendor at all. Treat the folder as read-only. Refresh on a deliberate cadence. Trust the toolchain to do the right thing during builds.

---

## What You Can Build

After learning this:

- **A self-contained CLI** that can be cloned and built on a flight with no Wi-Fi.
- **A reproducible CI pipeline** that does not rely on any external proxy or network.
- **A compliance-friendly service** whose every dependency is reviewable in PR diffs.
- **A long-lived archival project** that will still build years from now even if upstream repos vanish.
- **An air-gapped deployment** where the only artifacts crossing the gap are code (no module cache to ship).

You cannot yet:
- Patch a vendored dependency cleanly (next: `replace` directives in middle.md)
- Vendor in a multi-module workspace (advanced topic)
- Configure a private module proxy as a vendoring alternative (later, in 6.2)
- Mix vendoring with `GOPRIVATE` and authenticated registries (senior-level)

---

## Further Reading

- [Go Modules Reference — Vendoring](https://go.dev/ref/mod#vendoring) — official, authoritative.
- [`go help mod vendor`](https://pkg.go.dev/cmd/go#hdr-Make_vendored_copy_of_dependencies) — terse, accurate.
- [Go 1.14 Release Notes](https://go.dev/doc/go1.14#go-command) — the version that introduced auto-vendoring.
- [Russ Cox: "Vendoring should be a last resort"](https://research.swtch.com/) — opinionated counterpoint, worth reading.
- [Tutorial: Vendor your dependencies](https://go.dev/doc/tutorial/) — short walkthrough.

---

## Related Topics

- [6.1.1 `go mod init`](../01-go-mod-init/junior.md) — start a module
- [6.1.2 `go mod tidy`](../02-go-mod-tidy/junior.md) — synchronize `go.mod` with imports; precedes vendoring
- 6.1.4 Replace and Exclude Directives — patch dependencies without forking
- [6.2.1 Package Import Rules](../../02-packages/01-package-import-rules/junior.md) — how imports resolve under vendoring
- 11.1.5 `go mod` — full subcommand reference

---

## Diagrams & Visual Aids

```
The two build modes:

    Without vendor/:                With vendor/:
    -----------------               -----------------
    project/                        project/
    ├── go.mod                      ├── go.mod
    ├── go.sum                      ├── go.sum
    └── main.go                     ├── main.go
                                    └── vendor/
       │                                ├── github.com/...
       │                                └── modules.txt
       ▼                                    │
    [module cache]                          ▼
    $GOPATH/pkg/mod/...               [used directly]

         │                                  │
         └── network proxy ──┐              │
                             │              │
                       [bytes used]    [bytes used]
```

```
Refresh lifecycle:

    [edit go file]
          │
          │   go get example.com/foo@v1.5.0
          ▼
    [go.mod updated]
          │
          │   go mod tidy
          ▼
    [go.mod + go.sum consistent]
          │
          │   go mod vendor
          ▼
    [vendor/ matches go.mod]
          │
          │   git add go.mod go.sum vendor/
          │   git commit
          ▼
    [reproducible snapshot]
```

```
vendor/modules.txt anatomy:

    # github.com/google/uuid v1.6.0      ← module + version
    ## explicit; go 1.19                 ← directly required, min Go ver
    github.com/google/uuid               ← package(s) vendored

    # github.com/spf13/pflag v1.0.5      ← next module block
    ## explicit; go 1.12
    github.com/spf13/pflag
```

```
Build resolution order (with vendor/ present):

    import "github.com/google/uuid"
                  │
                  ▼
       Is it stdlib?  ── yes ──> use toolchain
                  │
                  no
                  │
                  ▼
       Look in vendor/github.com/google/uuid/
                  │
                  ▼
       Found? ── yes ──> use vendored source
                  │
                  no
                  │
                  ▼
       Error: "package X is not in vendor"
       (does NOT fall through to module cache when vendor/ is present)
```
