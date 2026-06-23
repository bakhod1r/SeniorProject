# Using Third-Party Packages — Junior Level

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
> Focus: "How do I add someone else's code to my project?" and "How do I keep it healthy?"

You have a module. You can run `go mod tidy`. Now you want to actually *use* code that other people wrote — a UUID generator, a CLI framework, a Postgres driver, a router, a logger. The standard library is excellent, but most real applications stand on a few well-chosen third-party libraries.

The single command that does the heavy lifting is:

```bash
go get github.com/google/uuid
```

Run that, and three things happen at once:

1. The package source is downloaded into Go's module cache (under `$GOPATH/pkg/mod/`).
2. Your `go.mod` gets a new `require` line.
3. Your `go.sum` gets cryptographic fingerprints for the downloaded files.

After that, you can write `import "github.com/google/uuid"` in any `.go` file in the module and call `uuid.New()` like it always belonged there.

After reading this file you will:
- Add a third-party package to your project with one command
- Pin to a specific version, upgrade, and roll back
- Read a library's documentation on `pkg.go.dev` confidently
- Tell a healthy library from a dead one in 60 seconds
- See available updates and choose which to apply
- Remove a dependency cleanly

You do **not** need to know about replace directives, vendoring, private modules, version selection algorithms, or workspace files yet. Those are middle and senior topics.

---

## Prerequisites

- **Required:** A Go module — i.e., you have run `go mod init` and have a `go.mod` file.
- **Required:** A working Go installation (1.16+; ideally 1.21+).
- **Required:** Internet access. Adding a third-party dependency for the first time talks to the network.
- **Required:** Comfort with `go mod init`, `go mod tidy`, and reading a `go.mod` file.
- **Helpful:** A terminal with copy-paste, because you will paste import paths from web pages.
- **Helpful:** A text editor with Go support (VS Code, GoLand, Neovim with `gopls`). It will auto-import as you type, which removes friction.

If `go mod tidy` runs without error in your project, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Third-party package** | Any Go package not part of the Go standard library and not part of your own module. |
| **Dependency** | A module your code imports. Listed under `require` in `go.mod`. |
| **`go get`** | The command that adds, upgrades, downgrades, or removes dependencies. Edits `go.mod` and `go.sum`. |
| **Module cache** | A read-only on-disk cache under `$GOPATH/pkg/mod/` where downloaded modules are stored, keyed by version. |
| **Module proxy** | A server (default: `proxy.golang.org`) that mirrors public modules. The Go toolchain talks to it instead of cloning Git directly. |
| **`pkg.go.dev`** | The official documentation site for Go packages. Every published module has a page there. |
| **godoc** | The doc generator that turns Go comments into `pkg.go.dev` pages. Also a local CLI tool (`go doc`). |
| **Semantic version (semver)** | A version string of the form `vMAJOR.MINOR.PATCH`. Go modules require the leading `v`. |
| **Pseudo-version** | A version string Go invents when a commit has no tag, e.g. `v0.0.0-20231012103515-abcdef123456`. |
| **`go.sum`** | The lockfile of cryptographic hashes for every dependency (and its dependencies). |
| **Transitive dependency** | A dependency of one of your dependencies. You did not import it directly, but it ends up in `go.sum`. |
| **Major version** | The `X` in `vX.Y.Z`. Bumps signal **breaking changes**. |
| **Deprecated package** | A package the maintainers tell you to stop using — usually marked with a `// Deprecated:` comment. |

---

## Core Concepts

### `go get` is the verb for "change my dependencies"

There are exactly four things `go get` does:

1. **Add** a new dependency: `go get github.com/google/uuid`
2. **Upgrade** an existing dependency: `go get github.com/google/uuid@latest`
3. **Pin** to a specific version: `go get github.com/google/uuid@v1.3.0`
4. **Remove** a dependency: `go get github.com/google/uuid@none` (or delete the import and run `go mod tidy`)

That is the whole API. Every other dependency change is a variation on these four.

### Three things change when you run `go get pkg`

1. **The module cache** under `~/go/pkg/mod/...` gets a frozen, read-only copy of the version.
2. **`go.mod`** gains (or updates) a `require` line: `require github.com/google/uuid v1.6.0`.
3. **`go.sum`** gains cryptographic hashes proving "the bytes I built against were exactly these bytes."

Commit `go.mod` and `go.sum` to git. The cache is local to your machine and is regenerated on demand.

### Importing is independent from `go get`

You can write `import "github.com/google/uuid"` in your source file *first*, then run `go mod tidy` — Go figures out which version you need, downloads it, and updates `go.mod` and `go.sum` for you. Many engineers prefer this workflow over remembering `go get` flags.

`go get pkg` and `go mod tidy` are two roads to the same place. Both are fine.

### Semantic versioning expectations

Library authors who use semver promise:

- **Patch bumps** (`v1.2.3` to `v1.2.4`) — bug fixes only. Safe to upgrade.
- **Minor bumps** (`v1.2.3` to `v1.3.0`) — new features, no breaking changes. Safe to upgrade.
- **Major bumps** (`v1.x.x` to `v2.x.x`) — breaking changes. Read the changelog before upgrading.

In Go, a major version bump above 1 also changes the **import path**. `v2` of a library at `github.com/foo/bar` is imported as `github.com/foo/bar/v2`. This is unusual and protects you from accidentally pulling breaking changes.

### `pkg.go.dev` is your map

For any third-party package, the page at `https://pkg.go.dev/<import path>` shows:

- The package's documentation, generated from comments in the source.
- The list of functions, types, and constants.
- Example code blocks (often runnable in the browser).
- A list of tagged versions.
- A "Imported By" count — a rough popularity signal.
- Links to the source repository, license, and README.

If you cannot find a package on `pkg.go.dev`, it either does not exist or has a typo in its import path.

---

## Real-World Analogies

**1. Borrowing a book from the library.** `go get` is checking the book out — except it is also a copy machine, so you have your own bound, dated edition forever. Even if the original library burns down, your copy is fine.

**2. A grocery list with brand names.** `go.mod` is your shopping list: "one bag of UUIDs, brand `google/uuid`, version 1.6 or newer." `go.sum` is the receipt with the SKU bar codes — proof that what you bought matches what is in the cart.

**3. Citing a paper.** When you write a research paper, you cite specific editions: "Smith, 2019, *Journal of X*, vol. 42." You cannot cite "Smith, latest." Pinning a Go version is the same — you reference an exact published artifact, not a moving target.

**4. A restaurant menu.** `pkg.go.dev` is the menu. You read what is on offer, decide what you want, then place an order with `go get`. The kitchen (module proxy) cooks (downloads), and the food (code) appears on your table (project).

---

## Mental Models

### Model 1 — `go.mod` is a contract; `go.sum` is the receipt

`go.mod` says *what versions you want*. `go.sum` says *which exact bytes you got the first time*. If anyone ever tampers with the bytes, the hashes mismatch and the build fails loudly. This is good — it is how Go protects you from a malicious mirror.

### Model 2 — Versions are selected upward

If your project needs `uuid v1.3.0` and one of your other dependencies needs `uuid v1.6.0`, Go picks **the higher** of the two — the **Minimum Version Selection** algorithm. You will rarely see two incompatible versions at the same time, because semver promises minor/patch bumps are non-breaking.

### Model 3 — A dependency is a tree, not a list

When you add one library, you also add everything *it* depends on. A typical `cobra` install pulls in `pflag`, `viper`'s helpers, and a handful of others. Open `go.mod` after `go get cobra` and you will see only `cobra` listed under `require`; the transitives are listed too, but with `// indirect` comments. They are real dependencies, just not ones you imported by name.

### Model 4 — The cache is shared; the lockfile is per-project

The module cache (`~/go/pkg/mod/`) is shared across every Go project on your machine. If two projects both depend on `uuid v1.6.0`, the bytes are downloaded once. `go.sum` is per-project — it records which versions *this* project decided to use.

### Model 5 — `go get` without `go mod tidy` leaves cruft; `go mod tidy` without `go get` is fine

`go get pkg` adds a `require` line even if you never `import` the package. Over time, an unused `require` line lingers. `go mod tidy` is the cleanup tool — it adds missing requires *and* removes unused ones. Run it before every commit.

---

## Pros & Cons

### Pros

- **Reuse beats reinvent.** Stable libraries solve hard problems (UUID generation, time parsing, SQL drivers) that you should not write from scratch.
- **One command, end-to-end.** `go get` downloads, registers, and hashes in a single step.
- **Reproducible.** `go.mod` + `go.sum` means anyone with your code gets identical builds.
- **No lockfile drama.** Go's lockfile is tiny, deterministic, and merge-friendly compared to `package-lock.json` or `Gemfile.lock`.
- **Versioned forever.** Once a version is published and proxied, it cannot be silently rewritten.

### Cons

- **Supply-chain risk.** Every dependency is code you did not audit. A compromised library is a compromised binary.
- **Bitrot.** Today's hot library is tomorrow's archived repo. You will eventually have to migrate.
- **Transitive bloat.** A small library that depends on 80 other modules will balloon your `go.sum`.
- **Choice paralysis.** "Which logging library should I use?" — there are at least six popular ones.
- **Outdated examples.** Tutorials on the open web often show `v1` APIs that have been replaced by `v2` or `v3`.

The pros dominate for almost every real project. The cons are the reason this file exists.

---

## Use Cases

You should add a third-party package when:

- **The standard library does not cover the need.** UUID generation, JWT signing, Postgres driver, Kafka client.
- **The standard library covers it badly for your case.** `flag` for tiny CLIs is fine; for a real CLI with subcommands, use `cobra`.
- **The library is mature, well-documented, and has lots of users.** Time saved is measurable.
- **You can read the library's code in an afternoon.** A small, readable library is replaceable; a giant, opaque one is a liability.

You should *not* add a third-party package when:

- **The standard library has it.** Do not pull in a `time` replacement; `time` works.
- **You only need one tiny function.** Copying twenty lines (with attribution) is sometimes saner than taking on a whole module.
- **The library has not been touched in three years and has open issues.** That is a maintenance burden waiting to land on you.
- **You cannot find the source.** Closed-source dependencies are a different game (private modules) — not for the junior path.

---

## Code Examples

### Example 1 — Adding `uuid` and using it

```bash
go get github.com/google/uuid
```

`go.mod` after the command:

```
module example.com/myapp

go 1.22

require github.com/google/uuid v1.6.0
```

`go.sum` (excerpt):

```
github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=
```

Source `main.go`:

```go
package main

import (
    "fmt"

    "github.com/google/uuid"
)

func main() {
    id := uuid.New()
    fmt.Println(id)
}
```

Run it:

```bash
go run .
# 7c4e9b00-4c10-4c2c-8a7e-2cbd0f3a9b21
```

That is the full workflow. One `go get`, one `import`, one function call.

### Example 2 — Pinning to a specific version

```bash
go get github.com/google/uuid@v1.3.0
```

`go.mod`:

```
require github.com/google/uuid v1.3.0
```

You just downgraded (or pinned). Run `go build` to verify nothing breaks.

### Example 3 — Pinning to a commit hash

If a fix is on `main` but not yet released, you can pin to a commit:

```bash
go get github.com/google/uuid@abcdef123456
```

`go.mod` will show a pseudo-version:

```
require github.com/google/uuid v1.6.1-0.20240101120000-abcdef123456
```

Use this sparingly. Pseudo-versions are awkward to reason about and signal "I am ahead of the latest tag."

### Example 4 — Pinning to a branch

```bash
go get github.com/google/uuid@main
```

This resolves to the latest commit on the `main` branch and produces a pseudo-version. Avoid in production — branches move under your feet.

### Example 5 — Upgrading to the latest

```bash
go get github.com/google/uuid@latest
```

Equivalent to `go get -u github.com/google/uuid` for that one package. Updates `go.mod` to whatever the highest tagged release is.

### Example 6 — Upgrading everything

```bash
go get -u ./...
```

Upgrade *all* direct dependencies of the current module to their latest minor/patch versions. Run your tests immediately after.

### Example 7 — Listing available updates

```bash
go list -m -u all
```

Output (excerpt):

```
github.com/google/uuid v1.3.0 [v1.6.0]
github.com/spf13/cobra v1.7.0 [v1.8.0]
github.com/stretchr/testify v1.8.4
```

The `[vX.Y.Z]` after the current version is the latest available. Lines without brackets are already up-to-date.

### Example 8 — Removing a dependency

Delete the import statement from your code, then:

```bash
go mod tidy
```

The `require` line and the `go.sum` entries vanish. No special command needed.

Or, explicitly:

```bash
go get github.com/google/uuid@none
```

Both work; `go mod tidy` is the cleaner habit.

### Example 9 — Using `cobra` for a CLI

```bash
go get github.com/spf13/cobra@latest
```

```go
package main

import (
    "fmt"

    "github.com/spf13/cobra"
)

func main() {
    root := &cobra.Command{
        Use:   "hello",
        Short: "Says hello",
        Run: func(cmd *cobra.Command, args []string) {
            fmt.Println("hello, world")
        },
    }
    root.Execute()
}
```

### Example 10 — Postgres driver (`pq`)

```bash
go get github.com/lib/pq
```

```go
import (
    "database/sql"

    _ "github.com/lib/pq" // imported for side effect: register driver
)

db, err := sql.Open("postgres", "postgres://...")
```

The leading underscore is the **blank import** — used purely to register the driver with `database/sql`. It is a common pattern for SQL drivers.

---

## Coding Patterns

### Pattern: Import then tidy

The smoothest workflow for adding a dep:

1. Open your editor.
2. Type the import: `import "github.com/google/uuid"`.
3. Use it: `id := uuid.New()`.
4. Save.
5. From the terminal, run `go mod tidy`.

`go mod tidy` does what `go get` would have done, plus removes any unused requires in the same pass. Many engineers never type `go get` for *adding* — only for upgrading or pinning.

### Pattern: Pin during development, upgrade deliberately

Once you have a stable version, leave it alone. Schedule a "dependency upgrade" task once a month or once a sprint, run `go get -u ./...`, run all tests, fix breakage, and commit. Random mid-feature upgrades are a recipe for confusing bugs.

### Pattern: One commit per dependency change

When you add or upgrade a dependency, commit `go.mod` and `go.sum` together as a separate, focused commit:

```
chore(deps): add github.com/google/uuid@v1.6.0
```

This makes it trivial to bisect or revert.

### Pattern: Read the README before importing

Spend two minutes on the project's README and the first paragraph of `pkg.go.dev` documentation before committing to a library. The cost is two minutes; the savings are hours.

### Pattern: Prefer fewer, larger libraries over many small ones

A single well-maintained library (like `cobra` for CLIs) beats stitching together five tiny helpers. Each dependency is a future migration; minimize the count.

---

## Clean Code

- **Sort imports.** Most editors do this for you. The standard layout is: stdlib block, blank line, third-party block, blank line, local module block.
- **Do not alias imports unless you must.** `import uuid "github.com/google/uuid"` is unnecessary because the package is already called `uuid`. Aliases are for collisions or unreadable package names.
- **Comment the reason for an unusual pin.** If your `require` line is `github.com/foo/bar v1.2.3 // pinned: v1.3 has a memory leak`, future you will be grateful.
- **Keep `go.mod` minimal.** Run `go mod tidy` regularly. An untidy `go.mod` accumulates dead `require` lines.
- **Quote the import path exactly.** Copy-paste from `pkg.go.dev`; do not retype.

---

## Product Use / Feature

When you ship a product:

- Every `require` line in `go.mod` is a **third-party signature** in your binary.
- Tools like `go version -m ./your-binary` or `runtime/debug.ReadBuildInfo()` reveal those signatures to anyone with the binary.
- License headers from your dependencies must be honored (BSD, MIT, Apache 2.0, etc.) — many require attribution in distributed binaries.
- Vulnerability scanners (e.g., `govulncheck`) read `go.sum` to find known CVEs in your dependency tree. Run it in CI.
- Renovate, Dependabot, and similar bots can auto-open PRs upgrading your dependencies. Worth setting up once your project is stable.

The dependency tree is part of the product. Treat it that way.

---

## Error Handling

`go get` fails in several common ways. Recognize them.

### "module not found"

```
go: github.com/foo/bar: module github.com/foo/bar: not found
```

Cause: typo in the import path, the repo is private and you have no auth, or it does not exist.

Fix: double-check the path on `pkg.go.dev`. For private modules, see middle-level docs.

### "no matching versions"

```
go: github.com/foo/bar@v9.9.9: no matching versions for query "v9.9.9"
```

Cause: the version you typed does not exist.

Fix: check the tags on the project's GitHub releases page or run `go list -m -versions github.com/foo/bar`.

### "ambiguous import"

```
ambiguous import: found package foo in multiple modules
```

Cause: two of your dependencies declare the same import path. Rare but possible with forks.

Fix: pin one of the conflicting modules to a version that does not include the duplicate, or use a `replace` directive (middle topic).

### Network errors during `go get`

```
dial tcp: lookup proxy.golang.org: no such host
```

Cause: no internet, corporate proxy, or `GOPROXY` misconfigured.

Fix: check connectivity. If behind a firewall, set `GOPROXY=direct` or to your company proxy.

### "verifying module: checksum mismatch"

```
verifying github.com/foo/bar@v1.2.3: checksum mismatch
```

Cause: the bytes you downloaded differ from what `go.sum` recorded earlier. Could be a corrupted cache, a tampered mirror, or a maintainer who force-pushed a tag (illegal in semver).

Fix: clear the cache (`go clean -modcache`) and retry. If it persists, do not trust the source.

---

## Security Considerations

- **Every dependency is code that runs.** When you import a library, its `init()` functions execute when your program starts. A malicious library could leak data, mine crypto, or open a backdoor.
- **`go.sum` is your tamper detector.** Never delete it. Commit it. Review changes to it in code review the same way you review changes to `go.mod`.
- **`govulncheck` is the official scanner.** Run it in CI:
  ```bash
  go install golang.org/x/vuln/cmd/govulncheck@latest
  govulncheck ./...
  ```
  It tells you if any of your transitive dependencies have known CVEs *and* whether your code actually calls the vulnerable function.
- **Pin majors carefully.** A `v1.x` dep is auto-bumped to the latest `v1.x` on `go get -u`. A `v2.x` requires changing the import path — Go protects you here.
- **Prefer libraries with reproducible, signed releases.** A library whose tags are signed (visible on GitHub releases page) is harder to tamper with.
- **Watch for typosquats.** `github.com/glang/...` is not `github.com/golang/...`. Always copy-paste import paths from official sources.
- **Avoid pinning to `main` in production.** A branch head can change at any moment, including to malicious code.

---

## Performance Tips

- **The download is one-time per machine.** After the first `go get`, subsequent builds use the cache and are network-free.
- **`go mod download` warms the cache before a build.** Useful in Docker images:
  ```dockerfile
  COPY go.mod go.sum ./
  RUN go mod download
  COPY . .
  RUN go build
  ```
  This means rebuilds skip dependency download as long as `go.mod` and `go.sum` did not change.
- **`GOPROXY=off`** disables the proxy and forces local-cache-only mode. Useful for air-gapped environments.
- **Bigger `go.sum` does not slow your builds** — it slows your `go mod tidy` slightly, but negligibly.
- **Avoid pulling in massive dependencies for tiny needs.** A library that pulls 50 transitive deps to give you one helper function bloats your binary by megabytes.

---

## Best Practices

1. **Always use `go mod tidy` before committing.** It keeps `go.mod` honest.
2. **Commit `go.mod` and `go.sum` together.** Never one without the other.
3. **Pin major versions; let minor/patch float (within a single major).** `v1` stays `v1`, but `v1.6.0` to `v1.7.0` is fine.
4. **Read `pkg.go.dev` before importing.** Spend two minutes; it pays back hours.
5. **Run `govulncheck` in CI.** A free safety net.
6. **Upgrade deliberately, on a schedule.** Not in the middle of a feature.
7. **Prefer libraries with >1 year of activity, recent commits, low open-issue count, and a clear license.**
8. **Avoid forks unless you have a reason.** Use the canonical repository.
9. **One commit per dependency change.** Easy to bisect.
10. **Keep transitive dep count low.** Watch `go.sum` line count over time. Sudden growth is suspicious.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting `@latest` or `@vX.Y.Z`

```bash
go get github.com/google/uuid
```

This is fine for a *new* dependency — it picks the latest. But if you already have `uuid v1.3.0` and want to upgrade, plain `go get` will not bump it. Use `go get pkg@latest` or `go get -u pkg`.

### Pitfall 2 — Major version 2+ requires path change

A library at `v2.0.0` of `github.com/foo/bar` is imported as `github.com/foo/bar/v2`. If you write `import "github.com/foo/bar"` and ask for `@v2.0.0`, Go refuses. This is a feature, not a bug — it forces you to update both the import path and the version in one go.

### Pitfall 3 — `// indirect` lines in `go.mod`

After `go mod tidy`, you may see:

```
require (
    github.com/google/uuid v1.6.0
    github.com/spf13/pflag v1.0.5 // indirect
)
```

`// indirect` means "I do not import this directly; one of my dependencies does." Do not delete these lines manually — `go mod tidy` will add them back. They are part of the lockfile.

### Pitfall 4 — Replacing a dep without committing the change

Some teams use `replace` directives during local development (e.g., to point a dep at a sibling folder). If those land in `go.mod` and get committed, *every* CI build breaks because the local path does not exist on the build machine. Keep `replace` directives out of committed `go.mod` unless they are intentional.

### Pitfall 5 — Outdated example code on Stack Overflow

The top Stack Overflow answer for "how to use library X" was probably written three years ago against `v1.x`. The library is now on `v3.x` with a different API. Always cross-reference with `pkg.go.dev` for the version you have.

### Pitfall 6 — Pulling in `cgo`-heavy dependencies

Some libraries (especially database drivers, image processing) pull in `cgo`. They build fine on your laptop but fail in your minimal Alpine Docker image because `gcc` and `musl` headers are missing. Read the README for `cgo` warnings before adding.

### Pitfall 7 — Upgrading one library breaks another

Library A pins `protobuf v1.30`. You upgrade library B, which now requires `protobuf v1.34`. Minimum Version Selection picks `v1.34`. Library A may not work with `v1.34`. This is rare for well-behaved libraries but real. Run your tests after every upgrade.

### Pitfall 8 — Forgetting to commit after `go get`

`go get` modifies `go.mod` and `go.sum`. Stage and commit them, or your teammates will not get the change. Many CI pipelines fail with `git diff --exit-code` if `go.mod` or `go.sum` would change after `go mod tidy`.

---

## Common Mistakes

- **Importing without running `go get` or `go mod tidy`.** The build fails; the fix is one command.
- **Running `go get pkg` and expecting it to also import the package.** It does not. You still have to write the `import` line.
- **Editing `go.mod` by hand to bump a version.** Works, but `go get pkg@version` is the safer habit because it also updates `go.sum`.
- **Pinning to `master` or `main`.** That is a moving target and will bite you.
- **Using `replace` to "fix" a missing version when the right answer is `go get pkg@version`.**
- **Adding a dependency for a five-line problem.** Sometimes the answer is to write the five lines yourself.
- **Ignoring CVEs.** `govulncheck` is fast and free. Run it.
- **Mixing major versions of the same library by mistake** — e.g., importing both `github.com/foo/bar` (`v1`) and `github.com/foo/bar/v2`. They are *different* modules to Go and your binary now contains both. Almost always a bug.

---

## Common Misconceptions

> *"`go get` runs my code."*

No. `go get` only downloads, hashes, and registers. It does not execute anything from the dependency. Execution happens when you `go run` or `go build` and the dependency's `init()` and other code runs as part of your binary.

> *"I have to commit the dependency source code."*

No. You commit `go.mod` and `go.sum`. The source lives in the module cache and is re-downloaded on demand. (Exception: `go mod vendor` opts you into committing source — a separate workflow.)

> *"`go.sum` is just a debug file."*

No. `go.sum` is your security boundary. Without it, an attacker who controls the module proxy can swap library bytes silently. With it, any tamper attempt fails the build.

> *"`go get -u` is safe."*

It is *usually* safe — minor and patch bumps should not break you. But "should not" is not "will not." Always run tests after `go get -u`.

> *"Bigger version number always means better."*

Not always. A `v3` library may have shed features you depended on. Read changelogs.

> *"Once a dependency is in `go.mod`, it stays forever."*

No. Delete the import, run `go mod tidy`, and the require line vanishes. Keeping `go.mod` lean is your job.

---

## Tricky Points

- **`go.mod` lists what you require; the *resolved* graph also includes transitives.** `go list -m all` prints the resolved graph (every module that ends up in the build).
- **Pseudo-versions sort like real semver.** `v0.0.0-20231012103515-abcdef123456` is older than `v0.1.0`. The leading `v0.0.0-...` is intentional.
- **The leading `v` in versions is mandatory.** `go get pkg@1.0.0` fails; `go get pkg@v1.0.0` succeeds.
- **`@latest` means latest *tagged* release, not latest commit.** If a project hasn't tagged in two years, `@latest` returns a two-year-old tag.
- **A package with no tags at all gets a pseudo-version.** Pre-`v1` projects are common in Go — not a red flag by itself, but check the README for stability claims.
- **`go get` with no module argument is a special case.** In modern Go, plain `go get` without a target is deprecated; use `go install` for installing tools.
- **Major-version paths require a `/vN` suffix only for `vN >= 2`.** `v1.x.x` does *not* use a path suffix.

---

## Test

Do this in a scratch folder.

```bash
mkdir uuid-test
cd uuid-test
go mod init example.com/uuid-test
go get github.com/google/uuid
```

Create `main.go`:

```go
package main

import (
    "fmt"

    "github.com/google/uuid"
)

func main() {
    fmt.Println(uuid.New())
}
```

Run:

```bash
go run .
```

Expected: a UUID prints. `cat go.mod` should show a `require` line. `cat go.sum` should be non-empty.

Now answer:

1. What is in `go.sum` that was not there before? (Hashes for `uuid` and its transitive deps.)
2. Run `go list -m -u all`. Is `uuid` listed? With or without an upgrade hint?
3. Run `go get github.com/google/uuid@v1.3.0`. Does `go.mod` change? Does the program still compile?
4. Delete the import line and run `go mod tidy`. Is `uuid` still in `go.mod`?

---

## Tricky Questions

**Q1.** I ran `go get github.com/foo/bar` but the import in my source still shows red. Why?

A. `go get` updates `go.mod` and downloads the source, but your editor's language server may not have re-indexed yet. Save the file, run `go mod tidy`, or restart `gopls`. The package is there; the editor just hasn't noticed.

**Q2.** Can I commit only `go.mod` and not `go.sum`?

A. No — well, you can, but builds will be unreproducible. `go.sum` is the integrity record. Always commit both together.

**Q3.** What is the difference between `go get pkg`, `go get pkg@latest`, and `go get -u pkg`?

A.
- `go get pkg` — adds `pkg` if absent at the latest version; if already present, leaves the version alone.
- `go get pkg@latest` — forces an upgrade to the latest tagged version.
- `go get -u pkg` — also upgrades, and additionally bumps `pkg`'s direct dependencies to their latest minor/patch.

For everyday upgrades, `go get pkg@latest` is the cleanest.

**Q4.** I see `// indirect` next to a require line. Should I delete it?

A. No. Indirect requires are real dependencies. `go mod tidy` keeps them in `go.mod` so the lockfile is stable. Leave them.

**Q5.** I want to use a fork of a library. How?

A. Two options. (a) Use `go get github.com/myfork/bar@latest` and update imports if the fork's path differs. (b) Use a `replace` directive in `go.mod` to redirect the original path to your fork — middle-level topic, but read about it when needed.

**Q6.** A library I depend on was archived on GitHub. What now?

A. Search for an actively maintained fork (often listed in a banner on the archived repo). Migrate to the fork. If no fork exists, you may have to vendor the code, fork it yourself, or replace the dependency.

**Q7.** Is `pkg.go.dev` the only place to find Go libraries?

A. It is the *index* (every published module is on it), but discovery often starts elsewhere: Awesome Go (a curated list at github.com/avelino/awesome-go), Reddit's r/golang, GitHub's Trending Go list, conference talks, blog posts. Use `pkg.go.dev` to *evaluate* what you find.

**Q8.** What if `pkg.go.dev` shows the package but I cannot `go get` it?

A. Possible causes: the module path on `pkg.go.dev` is for a sub-package and the module root is different; the version you typed does not exist; your `GOPROXY` is misconfigured; the module's repo is temporarily down. Try `go list -m -versions <path>` to see what versions exist.

**Q9.** Can I have two versions of the same package in one binary?

A. No, not at the same major version. At different majors, yes — `github.com/foo/bar` and `github.com/foo/bar/v2` coexist as separate modules. This is legal but usually a code smell.

**Q10.** How do I know a library is healthy in 60 seconds?

A. Check (a) latest commit date — within the last 6 months is good; (b) open vs. closed issues ratio — a flood of stale open issues is a red flag; (c) GitHub stars trending up; (d) a clear README with examples; (e) a license you can use; (f) `pkg.go.dev` shows godoc and example blocks.

---

## Cheat Sheet

```bash
# Add a dep (latest)
go get github.com/google/uuid

# Pin to a specific version
go get github.com/google/uuid@v1.3.0

# Pin to a commit hash
go get github.com/google/uuid@abcdef1

# Pin to a branch (avoid in prod)
go get github.com/google/uuid@main

# Upgrade one dep to latest
go get github.com/google/uuid@latest

# Upgrade all direct deps
go get -u ./...

# See available updates
go list -m -u all

# Remove a dep (delete the import, then)
go mod tidy

# Or remove explicitly
go get github.com/google/uuid@none

# Show all versions of a module
go list -m -versions github.com/google/uuid

# Pre-download deps (e.g., in Docker)
go mod download

# Verify module integrity
go mod verify

# Scan for known vulnerabilities
govulncheck ./...
```

```
Workflow recap:

   import "github.com/x/y" in code
                │
                ▼
   go mod tidy   (downloads + go.mod + go.sum)
                │
                ▼
   git add go.mod go.sum && git commit
```

| Symptom | Likely Cause |
|---------|--------------|
| `module not found` | Typo, private module, or doesn't exist. |
| `no matching versions` | Wrong version string. |
| `checksum mismatch` | Cache corruption or tampered mirror. |
| Editor shows red but `go build` works | LSP not re-indexed; restart `gopls`. |
| `go.mod` keeps adding `// indirect` | Normal; do not delete. |
| `go get -u` broke everything | Roll back with `go get pkg@v<previous>`. |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Add a third-party package with one command and verify the change in `go.mod` and `go.sum`
- [ ] Pin to a specific version, a commit, and a branch — and explain when each is appropriate
- [ ] Upgrade a single dependency and all dependencies
- [ ] List available updates with `go list -m -u all`
- [ ] Read a `pkg.go.dev` page and find the function you need
- [ ] Decide whether a library is worth depending on in under two minutes
- [ ] Recognize a deprecated package and find the recommended replacement
- [ ] Remove a dependency cleanly with `go mod tidy`
- [ ] Explain why `// indirect` lines exist and why not to delete them
- [ ] Explain the difference between `v1` and `v2+` import paths
- [ ] Run `govulncheck` and read its output
- [ ] Identify three popular Go libraries (e.g., `uuid`, `cobra`, `gin`, `pq`) and what they do

---

## Summary

`go get pkg` is the single command that adds, upgrades, downgrades, or removes a dependency. It edits `go.mod`, edits `go.sum`, and downloads the source into the module cache. Pair it with `go mod tidy` and you have everything you need for everyday dependency management.

Pin to specific versions during normal work; upgrade deliberately on a schedule. Read `pkg.go.dev` before adopting a library — it tells you the API, the versions, and whether the project is alive. Watch for major-version changes (the `/v2` suffix), deprecated packages, and transitive bloat.

Commit `go.mod` and `go.sum` together. Run `govulncheck` in CI. Keep your `go.mod` lean. That is the entire junior-level discipline.

---

## What You Can Build

After learning this:

- **A CLI app** built on `cobra` with subcommands, flags, and help text.
- **A small HTTP service** using `chi` or `gin` for routing.
- **A UUID-issuing tool** using `google/uuid`.
- **A Postgres-backed app** using `lib/pq` or `jackc/pgx`.
- **A scriptable utility** that signs JWTs (`golang-jwt/jwt`), parses YAML (`yaml.v3`), or reads `.env` files (`joho/godotenv`).
- **A program that survives a year of dependency churn** — you can upgrade, pin, and roll back.

You cannot yet:
- Use `replace` directives to redirect dependencies (next: middle.md)
- Work with private modules and authentication (middle/senior)
- Vendor dependencies for offline or audited builds (6.1.3 `go mod vendor`)
- Publish your own module so others can `go get` it (6.2.3 Publishing Modules)

---

## Further Reading

- [pkg.go.dev](https://pkg.go.dev) — the package index. Bookmark it.
- [Go Modules Reference: `go get`](https://go.dev/ref/mod#go-get) — authoritative behavior.
- [Awesome Go](https://github.com/avelino/awesome-go) — curated list of popular libraries by category.
- [`govulncheck` docs](https://go.dev/doc/security/vuln/) — official vulnerability scanner.
- [Module version numbering](https://go.dev/doc/modules/version-numbers) — semver rules in Go.
- [Go Blog: Using Go Modules](https://go.dev/blog/using-go-modules) — the original tutorial series.

---

## Related Topics

- [6.1.1 `go mod init`](../../01-modules-and-dependencies/01-go-mod-init/junior.md) — start a module before adding deps to it
- [6.1.2 `go mod tidy`](../../01-modules-and-dependencies/02-go-mod-tidy/junior.md) — the cleanup companion to `go get`
- [6.1.3 `go mod vendor`](../../01-modules-and-dependencies/03-go-mod-vendor/junior.md) — when you want dependency source committed
- [6.2.1 Package Import Rules](../01-package-import-rules/junior.md) — how Go resolves imports
- [6.2.3 Publishing Modules](../03-publishing-modules/junior.md) — be the third-party for someone else
- 11.1.5 `go mod` — full toolchain reference

---

## Diagrams & Visual Aids

```
What `go get pkg` touches:

   ~/go/pkg/mod/...        ← downloaded source (read-only cache)
   <project>/go.mod        ← + require line
   <project>/go.sum        ← + hash entries (direct + transitive)

   nothing else.
```

```
Version selection at a glance:

   you require: github.com/foo/bar v1.2.0
   dep A requires: github.com/foo/bar v1.5.0
   dep B requires: github.com/foo/bar v1.3.0
                       │
                       ▼   Minimum Version Selection
                  picks v1.5.0   (the highest required)
```

```
Major version path rules:

   v0.x.x  →  github.com/foo/bar
   v1.x.x  →  github.com/foo/bar
   v2.x.x  →  github.com/foo/bar/v2     ← path changes
   v3.x.x  →  github.com/foo/bar/v3
```

```
The dependency lifecycle:

   discover  →  evaluate  →  add  →  use  →  upgrade  →  retire
   (Awesome   (pkg.go.dev,  (go    (import (go get -u  (delete
    Go,        README,       get)   pkg)    ./...)      import,
    blogs)     activity)                                go mod
                                                       tidy)
```

```
Healthy library checklist (60-second scan):

   [ ] Latest commit < 6 months ago
   [ ] Tagged releases follow semver
   [ ] Open issues are being responded to
   [ ] README has runnable examples
   [ ] License is permissive (MIT, BSD, Apache 2.0)
   [ ] pkg.go.dev page shows godoc + examples
   [ ] No "DEPRECATED" or "ARCHIVED" banner on the repo
```
