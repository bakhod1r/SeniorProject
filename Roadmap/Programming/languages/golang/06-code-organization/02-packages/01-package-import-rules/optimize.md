# Package Import Rules — Optimization

> Honest framing first: imports are a *declaration*, not an algorithm. There is no clever trick that makes the `import` keyword itself faster. What is real, measurable, and worth attention is the *consequence* of imports: every line under an `import (...)` block pulls a transitive subgraph into your build, expands the symbol set the compiler must resolve, widens the surface that linkers, type-checkers, and IDEs walk, and shapes how invasive a small change is across the repo.
>
> The Go compiler is fast precisely because the language imposes strict import rules: explicit, acyclic, file-scoped, with `internal/` enforcement. Those rules are levers. Use them deliberately and a large project compiles in seconds; abuse them and a small project drags.
>
> Each entry below states the problem, shows a "before" and "after," and the realistic gain.

---

## Optimization 1 — Trim heavy transitive imports for trivial needs

**Problem:** A small utility imports a giant ecosystem package "because it has the helper I need." The transitive closure then drags in megabytes of code, dozens of `init()` functions, and several seconds of compile time per cold build.

**Before:**
```go
package healthcheck

import (
    "context"
    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/rest"
)

func InCluster() bool {
    _, err := rest.InClusterConfig()
    return err == nil
}
```
The function only checks two environment variables, but `client-go` pulls in `apimachinery`, `klog`, `protobuf`, `gnostic`, and a long tail of dependencies.

**After:**
```go
package healthcheck

import "os"

func InCluster() bool {
    return os.Getenv("KUBERNETES_SERVICE_HOST") != "" &&
        os.Getenv("KUBERNETES_SERVICE_PORT") != ""
}
```
Zero third-party imports. Same observable behaviour for the actual check.

**Gain:** Cold build of this package can drop from several seconds to milliseconds. The binary shrinks by tens of megabytes when this was the only `client-go` consumer.

---

## Optimization 2 — Use `internal/` to break compile blast radius

**Problem:** Every exported package is a potential import site. When packages are flat and exported, a change in one helper invalidates the build cache of any package that *might* reach it, and tools that walk `./...` traverse the full reachable set.

**Before:**
```
mymod/
  utils/        // exported
  parser/       // imports utils
  api/          // imports parser, utils
  cmd/server/   // imports api, parser, utils
```
A change to `utils.Trim` invalidates `parser`, `api`, and `cmd/server`.

**After:**
```
mymod/
  internal/strutil/    // unexported helpers
  parser/              // imports internal/strutil
  api/                 // imports parser only
  cmd/server/          // imports api only
```
Clear layering with `internal/` as the floor. Refactors stay local; the compiler narrows the rebuild set; reverse-dependency analysis becomes tractable.

**Gain:** Incremental builds touch fewer packages. Refactoring helpers no longer perturbs the public API surface.

---

## Optimization 3 — Avoid blank imports of large packages for trivial side effects

**Problem:** A blank import (`import _ "pkg"`) runs the package's `init()` for its side effect and pays the *full* transitive cost as if you used it normally. People reach for blank imports to register a driver or codec, then forget that the package is now part of every build.

**Before:**
```go
package main

import (
    _ "github.com/lib/pq"           // driver registration
    _ "net/http/pprof"              // pprof handlers
    _ "k8s.io/client-go/plugin/pkg/client/auth" // ALL auth providers
)
```
The third blank import pulls in GCP, Azure, OIDC, and exec auth plugins — even if you only ever use kubeconfig.

**After:**
```go
package main

import (
    _ "github.com/lib/pq"
    _ "net/http/pprof"
    _ "k8s.io/client-go/plugin/pkg/client/auth/gcp" // only what you need
)
```
Or better: gate pprof behind a build tag so production builds do not pay for it.

**Gain:** Smaller binary, faster cold compile, smaller security surface (fewer unused auth plugins).

---

## Optimization 4 — Audit imports with `go list -deps ./... | wc -l`

**Problem:** Import sprawl creeps in silently. Nobody notices that the dependency graph doubled until cold builds become painful.

**Before:** No baseline. Reviewers cannot tell whether a PR adds 2 or 200 transitive packages.

**After (one-liner audit):**
```bash
# Total package count in the build graph
go list -deps ./... | wc -l

# Just third-party (non-stdlib, non-local)
go list -deps ./... | grep -v '^github.com/myorg/' | grep '\.' | wc -l

# What's the biggest single new addition?
go list -deps -f '{{.ImportPath}} {{.Module.Path}}' ./... |
    awk '{print $2}' | sort | uniq -c | sort -rn | head
```

Track the result over time. If a PR moves the count by more than a small threshold, it deserves a second look.

**Gain:** Catches regressions before they bake in. A clear number is easier to defend in review than a hand-wave.

---

## Optimization 5 — Use `go list -f` to graph imports per package

**Problem:** "Why does this package even import that?" is a question with no obvious answer when the chain is three hops deep.

**Before:** Manual reading of source files, hoping to find the offender.

**After:**
```bash
# Direct imports of one package
go list -f '{{.ImportPath}}: {{.Imports}}' ./internal/parser

# Reverse: who imports a given package?
go list -f '{{.ImportPath}} {{.Imports}}' ./... |
    grep 'github.com/myorg/mymod/internal/utils'

# Why does X end up depending on Y? (path of imports)
go mod why -m k8s.io/client-go
```
For a richer view, pipe to `dot` and render with Graphviz, or use the community tool `goda` which is built on top of `go list`.

**Gain:** Makes import surgery deliberate instead of guessed. Five-minute investigation replaces a two-hour spelunk.

---

## Optimization 6 — Group with `goimports -local <module>` to reduce diff churn

**Problem:** Different editors group imports differently. Some teams have stdlib mixed with third-party, some sort by length, some leave them in arrival order. Every PR ends up with import-only churn that buries the actual change.

**Before (raw `gofmt`-only output):**
```go
import (
    "github.com/myorg/mymod/internal/utils"
    "context"
    "fmt"
    "github.com/sirupsen/logrus"
    "github.com/myorg/mymod/internal/parser"
    "os"
)
```

**After (`goimports -local github.com/myorg/mymod`):**
```go
import (
    "context"
    "fmt"
    "os"

    "github.com/sirupsen/logrus"

    "github.com/myorg/mymod/internal/parser"
    "github.com/myorg/mymod/internal/utils"
)
```
Three groups: stdlib, third-party, local. Sorted within each group. Stable across machines.

**Gain:** PR diffs stop including spurious import reorderings. Code review focuses on logic. Run it in a pre-commit hook or CI lint step to keep the invariant.

---

## Optimization 7 — Replace dot imports with explicit names

**Problem:** `import . "pkg"` injects the package's exported identifiers directly into the file scope. It looks tidy in a test or a DSL, but it costs the reader: every bare identifier is now ambiguous, and tools must resolve every name through the dot import. It also makes `goimports` and IDE rename refactors fragile.

**Before:**
```go
package matchers_test

import (
    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

var _ = Describe("Matcher", func() {
    It("matches", func() {
        Expect(value).To(Equal(42))
    })
})
```

**After:**
```go
package matchers_test

import (
    "github.com/onsi/ginkgo/v2"
    "github.com/onsi/gomega"
)

var _ = ginkgo.Describe("Matcher", func() {
    ginkgo.It("matches", func() {
        gomega.Expect(value).To(gomega.Equal(42))
    })
})
```

**Gain:** Resolves faster in editors, no ambiguity for readers, refactors do not break across files. The verbosity is a feature, not a defect.

---

## Optimization 8 — Refactor cyclic imports with interface segregation

**Problem:** Go forbids import cycles outright. When two packages need to talk both ways, the temptation is to merge them into one big package. The merged package then becomes a god-package that drags everything along on rebuild.

**Before (illegal cycle):**
```
package store    // wants to call notifier.Send
package notifier // wants to read store.Record
```

**After (interface in the consumer, implementation injected):**
```go
// package store
type Notifier interface {
    Send(event Event) error
}

type Store struct {
    n Notifier
}

func (s *Store) Save(...) {
    s.n.Send(Event{...})
}

// package notifier
import "myorg/store"

type Real struct{}

func (Real) Send(e store.Event) error { /* ... */ }
```
`store` depends on the *interface* it owns. `notifier` depends on `store`. No cycle, and `store`'s rebuild does not cascade to all callers of `notifier`.

**Gain:** Cycles become pull-this-up moments instead of merge-everything moments. Build cache stays effective.

---

## Optimization 9 — Avoid heavy generic instantiation cost

**Problem:** Generics are zero-cost only at the source level. The compiler's GC shape stenciling means each unique type instantiation can produce real code. A package that exposes one generic helper used with thirty different concrete types will compile slower and produce a larger binary than its non-generic counterpart.

**Before (overly generic API):**
```go
package collections

func Map[S ~[]E, E any, R any](s S, f func(E) R) []R {
    out := make([]R, len(s))
    for i, v := range s {
        out[i] = f(v)
    }
    return out
}
```
Imported and instantiated dozens of times across the codebase, each call site is a fresh instantiation.

**After (concrete helpers where the type set is small and known):**
```go
package collections

func MapStrings(s []string, f func(string) string) []string {
    out := make([]string, len(s))
    for i, v := range s {
        out[i] = f(v)
    }
    return out
}
```
Keep the generic version where it pays its way; collapse to concrete versions for the hot, well-known shapes.

**Gain:** Faster compile of dependent packages. Smaller binary. Fewer surprise allocations from the GC-shape boxing path.

---

## Optimization 10 — Use build tags to exclude feature trees from non-relevant binaries

**Problem:** A monolith repo has cloud-provider-specific code, debugging tools, and admin commands all imported into a single binary, "just so it works in every environment." Each binary then carries every variant.

**Before:**
```go
package cloud

import (
    "myorg/cloud/aws"
    "myorg/cloud/gcp"
    "myorg/cloud/azure"
)

func New(provider string) Provider {
    switch provider {
    case "aws":   return aws.New()
    case "gcp":   return gcp.New()
    case "azure": return azure.New()
    }
    return nil
}
```

**After (build tags per provider):**
```go
//go:build aws
// +build aws

package cloud

import "myorg/cloud/aws"

func defaultProvider() Provider { return aws.New() }
```
Build with `go build -tags aws ./cmd/agent`. Each binary only compiles and links the provider it actually needs.

**Gain:** Smaller binary, faster build, simpler release matrix. The build tag is a precise scalpel that the import system honours natively.

---

## Optimization 11 — Cache compile artifacts (`GOCACHE`)

**Problem:** Every CI job starts cold, recompiling identical package versions. The Go build cache is the single biggest win for repeated builds, and it is keyed on import + content + flags, so it is very precise.

**Before (CI):**
```yaml
- run: go build ./...
- run: go test ./...
```
No cache between jobs or runs.

**After (GitHub Actions example):**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true               # caches GOCACHE and GOMODCACHE
    cache-dependency-path: |
      go.sum
      **/go.sum
- run: go env GOCACHE
- run: go build ./...
- run: go test ./...
```
For self-hosted runners, persist `${GOCACHE}` (default `~/.cache/go-build`) across jobs explicitly.

**Gain:** Repeat builds where imports did not change become near-instant. Test cycles drop from minutes to seconds when only a few packages were touched.

---

## Optimization 12 — CI guard against import sprawl on PRs

**Problem:** Without a guard, every contributor adds "just one more dependency," and a year later the build graph has tripled. There is no obvious moment to push back.

**Before:** Reviewer eyeballs the diff and hopes.

**After (CI step):**
```yaml
- name: Check dependency growth
  run: |
    git fetch origin main
    git checkout origin/main -- .
    BASE=$(go list -deps ./... | wc -l)
    git checkout -
    HEAD=$(go list -deps ./... | wc -l)
    DELTA=$((HEAD - BASE))
    echo "Dependency package count delta: $DELTA"
    if [ "$DELTA" -gt 25 ]; then
      echo "PR adds more than 25 transitive packages — please review."
      exit 1
    fi
```
Pair with a `go mod why` printout for any newly added module, so the reviewer sees the justification path automatically.

**Gain:** A defensible, automatic checkpoint. Bad imports get caught at the PR; good imports proceed with context.

---

## Optimization 13 — Move test-only imports into `_test.go` files

**Problem:** A non-test file imports a heavy testing helper or fixture package "because it is convenient." Production builds now compile and link the test machinery.

**Before (`store.go`):**
```go
package store

import (
    "context"
    "github.com/stretchr/testify/require" // pulled into prod build
)

// production helper that uses require for "convenience"
func MustOpen(t TB, dsn string) *DB { /* ... */ }
```

**After:**
```go
// store.go — production
package store

func Open(dsn string) (*DB, error) { /* ... */ }

// store_test.go — test only
package store

import (
    "testing"
    "github.com/stretchr/testify/require"
)

func mustOpen(t *testing.T, dsn string) *DB {
    t.Helper()
    db, err := Open(dsn)
    require.NoError(t, err)
    return db
}
```
The Go build system only compiles `_test.go` files for `go test`. Importing a test helper from a non-test file leaks it into the production binary.

**Gain:** Production build closure shrinks by everything in `testify` and friends. Faster cold builds. Cleaner production binary with no test-helper symbols.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For import-related work the most useful signals are:

```bash
# How many compile actions does a build issue, and what does each cost?
go build -x ./... 2>&1 | grep -c '^compile'

# Full transitive package count for the build graph.
go list -deps ./... | wc -l

# Per-package compile time via toolexec.
go build -a -toolexec='time -p' ./... 2>compile.log
sort -k2 -n compile.log | tail -20

# Cold vs warm wall time.
go clean -cache
time go build ./...
time go build ./...        # second run hits the cache

# Why is package X in my graph?
go mod why -m github.com/example/heavy
```

Track these numbers before and after each change. If a "fix" does not move them measurably, it was not a fix — it was a preference.

---

## When NOT to Optimize

- **A library with three packages and ten users:** the import graph fits in your head; tooling will not pay for itself.
- **A prototype:** ship with whatever imports you need; trim later when the project earns its keep.
- **Imports inside a single internal package:** Go's compiler does not care whether you organise types into 1 or 5 files within one package — there is no per-import cost there.
- **Hot debate over import ordering:** pick `goimports -local` once, run it in CI, and stop arguing.
- **The `import` statement itself:** it has no runtime cost. There is nothing to micro-optimize at the keyword.

---

## Summary

Imports are how you tell the Go compiler — and your future self — exactly which code is in scope. The compiler is fast because the rules are strict: explicit, acyclic, file-scoped, `internal/`-enforced. Every optimization above is a way of leaning further into those rules: keep the graph small, keep the layering clear, keep the test-only and feature-flagged code out of the production closure, and measure the result. Get the imports right and the compiler rewards you with sub-second incremental builds for years. Get them wrong and you pay a tax on every build, every test, and every editor save.
