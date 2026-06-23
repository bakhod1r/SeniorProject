# Internal Packages — Optimization

> Honest framing first: `internal/` is a build-time visibility rule. There is nothing to optimize about *the rule itself*. What deserves attention is everything that flows from how you use it: the breadth of your public API, the freedom you have to refactor, the coupling between packages, and the long-term cost of every public name you commit to.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain. The goal is not "use `internal/` more" — it is to use it *intentionally* so that what is exposed and what is hidden reflects a deliberate decision.

---

## Optimization 1 — Shrink the public API surface

**Problem:** A library has accumulated a sprawling public surface: every helper, every utility type, every internal interface is exported because nobody ever moved them. Each one is a contract you owe stability to. Every release is a stress test of how much you can change without breaking somebody.

**Before:**
```
mylib/
├── go.mod
├── parser.go
├── tokens.go        ← public, but only used by parser internally
├── ast.go           ← public, but only the parser produces it
├── codegen.go       ← public, but only the parser drives it
└── util.go          ← public, used everywhere as a junk drawer
```
`go list ./... | wc -l` = 5 public packages. Every refactor is a major version bump.

**After:**
```
mylib/
├── go.mod
├── parser.go        ← public: Parse, Tree, the small intentional API
└── internal/
    ├── tokens/
    ├── ast/
    ├── codegen/
    └── util/
```
`go list ./... | grep -v internal | wc -l` = 1 public package. Internals churn freely.

**Gain:** Refactor cost on the internals drops to zero — no consumer can hold a stable handle. Major version bumps become rare. Documentation tightens. New contributors see one entry point and read the public surface in minutes instead of hours.

---

## Optimization 2 — Stop leaking implementation types through public functions

**Problem:** A public function returns a type defined in an `internal/` package. Consumers can hold it, pass it around, call exported methods on it — but cannot reference it by name. The type is *de facto* part of your API because callers' code shape depends on it, but you have no name in the public docs to anchor the contract on.

**Before:**
```go
package api

import "example.com/lib/internal/foo"

func Get() *foo.Thing { return &foo.Thing{} }   // leaks foo.Thing
```

A consumer:
```go
t := api.Get()
fmt.Println(t.Name)        // works
var x foo.Thing            // FAILS — foo is internal
```

The library's freedom to refactor `Thing` is now bounded by what existing callers can observe. Renaming a method is a breaking change even though `foo` is "internal."

**After:**
```go
package api

type Thing struct {
    Name string
}

func Get() *Thing { return &Thing{} }
```

Or, even better, return an interface:
```go
package api

type Thing interface { Name() string }

func Get() Thing { return implFromInternal() }
```

**Gain:** The public type is now intentionally public. The library can change the *internal* implementation freely as long as the interface is stable. Consumers can name the type without importing internals.

---

## Optimization 3 — Promote shared helpers from "junk-drawer public" to a deliberate `internal/`

**Problem:** A `util` package at the project root holds a grab-bag of helpers used by every other package: string manipulation, time helpers, error wrappers, retry logic. Half of it is generic, the other half is application-specific. Because it is public, every change is a potential breaking change for anyone who imported it.

**Before:**
```
project/
├── util/
│   ├── strings.go
│   ├── time.go
│   ├── errors.go
│   └── retry.go         ← all public
```

**After:**
```
project/
└── internal/
    ├── strutil/
    ├── timeutil/
    ├── errs/
    └── retry/
```
Or, if some helpers really are generic enough to be public, separate them into a small dedicated module instead of conflating with internals.

**Gain:** No external surface to maintain for the helpers. Refactoring the retry logic doesn't require a major version bump. Each sub-package becomes a small, focused unit instead of a sprawling junk drawer.

---

## Optimization 4 — Apply multi-level `internal/` to enforce architectural direction

**Problem:** A multi-feature module has a layered architecture (handler → service → repo → db). The architecture is a *convention* — nothing prevents `handler` from importing `db` directly, and over time it does. The graph degrades. Tests start mocking three layers at once.

**Before:** `internal/handler`, `internal/service`, `internal/repo`, `internal/db` are all peers under `internal/`. Any can import any.

**After:**
```
project/
└── internal/
    ├── handler/         ← may import service
    ├── service/         ← may import repo
    │   └── internal/
    │       └── domain/   ← visible only to service/
    ├── repo/            ← may import db
    │   └── internal/
    │       └── db/       ← visible only to repo/
    └── shared/
```

By placing `db` under `repo/internal/db`, only `repo` can import it. By placing `domain` under `service/internal/domain`, only `service` can import it. The toolchain now enforces a slice of the architecture for free.

**Gain:** Layer violations become impossible at build time, not just at code-review time. New contributors discover the architecture by reading the directory tree.

---

## Optimization 5 — Replace a "second module just for sharing" with an `internal/` package

**Problem:** The team created a second module just to share a helper between two parts of the same project. Now they maintain two `go.mod` files, two release tags, two import-path conventions, and a deployment dance for "internal-only" releases.

**Before:**
```
mono/
├── server/
│   └── go.mod          ← imports example.com/shared
├── client/
│   └── go.mod          ← imports example.com/shared
└── shared/
    └── go.mod          ← module example.com/shared (private — only consumed internally)
```

Three `go.mod` files for what is conceptually one project.

**After:** merge into a single module with `internal/` doing the privacy work:
```
mono/
├── go.mod                    ← module example.com/mono
└── internal/
    ├── server/
    ├── client/
    └── shared/                ← no second module needed
```

**Gain:** One `go.mod`, one release cycle, one `internal/` boundary. The previously separate "shared" code is now genuinely private — the toolchain enforces what was previously documentation.

The reverse is also valid: if the helper truly *is* meant to be reused across truly independent modules, then a second module is correct. The optimization is to use the *minimum* number of modules for the actual sharing requirements.

---

## Optimization 6 — Default new packages to `internal/`

**Problem:** Every new package is created at the module root by default. Contributors do not think about visibility because the path of least resistance is "public." Three months later, half the new packages turn out to be implementation details that should never have been public.

**Before:**
```
project/
├── newthing/         ← created public by reflex
├── oldthing/         ← public, justifiably
└── internal/
    └── ...
```

**After (default for new packages):**
```
project/
├── oldthing/
└── internal/
    ├── newthing/     ← starts here; promote later if needed
    └── ...
```

Codify this as a contributor guideline in `CONTRIBUTING.md` or `CLAUDE.md`. Add a CI check that flags new top-level packages and requires explicit reviewer approval for promotion.

**Gain:** The default direction becomes "private." Promotion to public becomes a deliberate act with reviewer attention. The rate of accidental API surface growth drops to near zero.

---

## Optimization 7 — Replace a sprawling shared `internal/` with feature-scoped `internal/`s

**Problem:** A medium-sized module has one fat `internal/` with twenty packages. Over time, packages from different features have grown to depend on each other. The dependency graph looks like a hairball.

**Before:**
```
project/
└── internal/
    ├── auth/
    ├── billing/
    ├── reports/
    ├── auth-utils/        ← used only by auth
    ├── billing-utils/     ← used only by billing
    ├── report-utils/      ← used only by reports
    ├── shared-utils/      ← used by all
    └── ... (dozen more)
```

Every package is module-private; nothing is feature-private. `auth` reaches into `billing-utils` whenever convenient.

**After:**
```
project/
└── internal/
    ├── auth/
    │   ├── auth.go
    │   └── internal/
    │       └── utils/        ← visible only to auth
    ├── billing/
    │   ├── billing.go
    │   └── internal/
    │       └── utils/        ← visible only to billing
    ├── reports/
    │   ├── reports.go
    │   └── internal/
    │       └── utils/        ← visible only to reports
    └── shared/                ← genuinely shared, module-private
```

**Gain:** Cross-feature reaching is forbidden at the toolchain level. Each feature's helpers belong unambiguously to that feature. The dependency graph cleans up because the boundaries are now mechanical.

---

## Optimization 8 — Stop treating `internal/` as a runtime mechanism

**Problem:** A team uses `internal/` to "secure" a function that handles secret keys. They are surprised when the binary's stack traces, profiles, and panics show the package name plainly. Then they consider obscuring the source.

**Before:** The team adds reflection workarounds, build-time obfuscation, and trusted-only release pipelines around `internal/auth`.

**After:** Stop. `internal/` is a *build-time* rule. It does not hide anything at runtime. Symbols, package names, and source paths are still visible in:
- Stack traces (`runtime/debug.Stack()`)
- Profiles (`pprof`)
- Reflection (`reflect.TypeOf(x).PkgPath()`)
- Binaries (`go version -m ./yourapp`)

For runtime privacy of secrets, use `crypto/...` and key-management patterns. For preventing imports, use `internal/`. Don't conflate the two.

**Gain:** Developer time saved trying to misuse `internal/` for runtime concerns. The project picks the right mechanism for each requirement.

---

## Optimization 9 — Use `internal/` to enable aggressive refactoring

**Problem:** A package has been public since v1.0. The team wants to refactor it (rename methods, restructure types, move logic), but every change forces a major version bump. They keep delaying the refactor.

**Before:** `mylib/foo` is public. Methods are stable not because the design is good but because changing them is expensive.

**After:** Refactor in two steps:

1. **Plan a v2.** Move `foo` into `internal/foo`. Promote a small, intentional public façade in its place.
2. **Refactor freely.** Now `internal/foo` can change at every minor release without breaking anyone.

```go
// new package: mylib/foo (public façade — small)
package foo

import "example.com/mylib/internal/foo"

func Process(input string) (Output, error) {
    return foo.Process(input)
}

type Output = foo.Output    // type alias keeps the type accessible
```

**Gain:** The team gets back the freedom to refactor. The public surface stays stable; the implementation evolves underneath. This is `internal/` working as a *refactor budget*.

The opposite framing — "internal/ is what you do to outsiders" — produces hesitation. The right framing — "internal/ is what you do for yourself" — produces action.

---

## Optimization 10 — Reduce the cost of cross-cutting changes with deliberate `internal/` placement

**Problem:** A change to a shared helper requires updating a dozen public packages. Each of them is a separate import-path namespace; tests must be updated; documentation must be updated; release notes must mention each.

**Before:** `helper.Format()` lives in a public package. Twelve other public packages call it. A signature change touches twelve docs, twelve test files, twelve release-note items.

**After:** Move `helper` to `internal/helper`. Now twelve internal callers update; nothing public changes; release notes for the next minor release simply say "internal: refactored helper signature." If you do this for many such utilities, the per-change cost drops dramatically.

**Gain:** Cross-cutting changes become low-friction. Cost is concentrated in the public *contract*, not in the implementation. This compounds: a project where 90% of code is internal pays 10% of the public-API cost on every change.

---

## Optimization 11 — Audit the public surface as part of every release

**Problem:** Public packages drift in over time. Nobody notices. Eventually the surface grows from 5 packages to 20, and de-promoting any of them requires a major version bump.

**Before:** Releases happen without any review of what is public.

**After:** Add a CI check:

```bash
go list ./... | grep -v '/internal/' | sort > public.txt
```

Commit `public.txt` to the repository. Make every PR that adds or removes lines from `public.txt` require an extra reviewer. The reviewer's job is to ask: *should this really be public?*

**Gain:** Surface drift becomes visible. Promotion becomes a deliberate act. Demotion happens on time, before downstream consumers come to depend on accidentally-public packages.

---

## Optimization 12 — Use `internal/` to break a big breaking change into a small one

**Problem:** A v2 release would change ten public packages at once. Consumers have to update ten import paths, fix ten sets of breaking changes, and read ten sections of release notes.

**Before:** All ten public packages exist. A v2 changes all of them.

**After:** Over several v1.x releases, *gradually* hide nine of them under `internal/`, replacing each with a tiny public façade. Each step is technically a breaking change for anyone who imported the package directly — but if your deprecation periods overlap, consumers see one warning per release instead of ten at once.

By the time v2 ships, only one public package needs to change. The breakage is concentrated; the migration is small.

**Gain:** Big-bang releases become incremental ones. The pain of upgrading is amortised across the v1.x deprecation window. Consumers who upgrade at every release pay close to zero cost; those who skip several pay all of it at once, but in one bounded chunk.

This is `internal/` as a release-engineering tool. The trick is to start the migration *before* you need v2, not at the moment you tag v2.

---

## Optimization 13 — Drop `pkg/` if `internal/` does the work

**Problem:** A team uses both a `pkg/` directory (for "public" packages) and an `internal/` directory (for "private" packages). Half the team puts new packages in `pkg/`, the other half puts them at the root. Neither convention is enforced. Newcomers cannot tell what is public.

**Before:**
```
project/
├── pkg/
│   ├── foo/
│   └── bar/
├── api/             ← also public, why not in pkg/?
├── parser/          ← also public, why not in pkg/?
└── internal/
```

**After:** Pick one convention. The Go standard library does not use `pkg/`. A common simplification:
```
project/
├── api/
├── parser/          ← top level is public
└── internal/
```

Or, if `pkg/` helps your team see "this is public" at a glance, use it consistently:
```
project/
├── pkg/
│   ├── api/
│   ├── parser/
│   ├── foo/
│   └── bar/
└── internal/
```

**Gain:** Clarity. New contributors know where to put new code. Reviewers know what counts as public. The double convention burns mental cycles for no benefit; pick one.

---

## Optimization 14 — Use `internal/` to enable a confident `// Deprecated:` flow

**Problem:** Deprecating a public function in place is awkward — the deprecated code still lives next to the new code, polluting the package's surface. Removing it later is a breaking change.

**Before:**
```go
package mylib

// Deprecated: use NewProcess instead.
func Process(in string) error { return nil }

func NewProcess(in string, opts Options) error { return nil }
```

The deprecated function lingers indefinitely.

**After:** Move the deprecated entry point to a thin wrapper, with the real implementation moved into `internal/`. When you eventually remove `Process`, the implementation is already separate; deletion is a one-line change in the public façade:

```go
package mylib

import "example.com/mylib/internal/process"

// Deprecated: use NewProcess instead.
func Process(in string) error { return process.Run(in, process.Defaults()) }

func NewProcess(in string, opts Options) error {
    return process.Run(in, process.Apply(opts))
}
```

When you cut v2, `Process` disappears from the public surface; `process.Run` continues to back `NewProcess`. The internal implementation didn't have to change.

**Gain:** Deprecation becomes a cheap, low-risk operation. The eventual removal in v2 is mechanical.

---

## Summary

`internal/` itself has nothing to optimize. What you optimize is *how you use it*:

- Shrink the public surface; widen the internal one.
- Stop leaking implementation types through public APIs.
- Default new packages to `internal/`; promote deliberately.
- Use multi-level `internal/` only when it solves an observed leak.
- Treat `internal/` as a refactor budget, not a punishment.
- Audit the public surface every release; codify the audit in CI.
- Use `internal/` plus `// Deprecated:` plus thin façades to make migrations cheap.

The pattern is consistent: a small, intentional public surface plus a fat, free-to-reshape `internal/` is the shape of a healthy Go module. Every optimization above is a different way of arriving at that same shape.
