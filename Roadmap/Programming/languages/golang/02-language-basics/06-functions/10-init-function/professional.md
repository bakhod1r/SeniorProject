# Go init() Function — Professional / Real-World Level

## 1. Overview

Professional Go teams treat `init` with caution. Style guides at Google, Uber, and many smaller engineering shops restrict its use. The reasons are operational: tests, cold starts, observability, and team velocity. This document collects the conventions used by serious teams, the lints that enforce them, and postmortem-style stories of init misuse in production.

It also walks through the canonical "good init" examples in well-known open-source code, so you can recognize the legitimate pattern.

---

## 2. Real OSS Examples

### 2.1 database/sql Driver Registration

In `github.com/lib/pq`:

```go
// File: github.com/lib/pq/conn.go
package pq

import "database/sql"

func init() {
    sql.Register("postgres", &Driver{})
}
```

In `github.com/jackc/pgx/v5/stdlib`:

```go
// File: github.com/jackc/pgx/v5/stdlib/sql.go
package stdlib

import "database/sql"

func init() {
    sql.Register("pgx", GetDefaultDriver())
    sql.Register("pgx/v5", GetDefaultDriver())
}
```

These are the canonical good uses of `init`:
- One line of work (or a handful).
- No I/O.
- Deterministic.
- Failure means programmer error (duplicate driver).
- Discoverable via blank import in user code.

### 2.2 image Package Decoder Registration

In the Go standard library, `src/image/png/reader.go`:

```go
// (paraphrased — the upstream uses init to register format detection)
func init() {
    image.RegisterFormat("png", pngHeader, Decode, DecodeConfig)
}
```

`image.RegisterFormat` appends to `image/atomic.go`'s `formats` slice. User code blank-imports decoders:
```go
import (
    "image"
    _ "image/gif"
    _ "image/jpeg"
    _ "image/png"
)
```

Now `image.Decode` can sniff and decode any of those formats. The user's binary only includes the formats they ask for.

### 2.3 expvar Package

`expvar` exposes runtime variables via HTTP. Its `init` registers an HTTP handler on the default mux:

```go
// File: src/expvar/expvar.go
func init() {
    http.HandleFunc("/debug/vars", expvarHandler)
    Publish("cmdline", Func(cmdline))
    Publish("memstats", Func(memstats))
}
```

This is **controversial**. Importing `expvar` (or anything that transitively imports it) installs `/debug/vars` on `http.DefaultServeMux`. If you also `http.ListenAndServe(addr, nil)`, you've inadvertently exposed memory stats publicly. Many companies have a lint rule banning `expvar` in production binaries that listen on public addresses.

### 2.4 net/http/pprof Package

```go
// File: src/net/http/pprof/pprof.go
func init() {
    http.HandleFunc("/debug/pprof/", Index)
    http.HandleFunc("/debug/pprof/cmdline", Cmdline)
    http.HandleFunc("/debug/pprof/profile", Profile)
    http.HandleFunc("/debug/pprof/symbol", Symbol)
    http.HandleFunc("/debug/pprof/trace", Trace)
}
```

Same caveat as `expvar`. The standard mitigation is to expose pprof on a separate, internal-only port:

```go
import _ "net/http/pprof"

go http.ListenAndServe("localhost:6060", nil) // internal mux

mux := http.NewServeMux()
mux.HandleFunc("/", appHandler)
http.ListenAndServe(":8080", mux) // public, clean mux
```

Note: `net/http/pprof` only registers on `http.DefaultServeMux`. Using a custom mux for your public service is sufficient isolation as long as you don't accidentally use `nil` (which means default mux) in `ListenAndServe`.

### 2.5 Kubernetes apimachinery Scheme Registration

In `k8s.io/apimachinery`, the `runtime.Scheme` mechanism is sometimes populated via `init`:

```go
// File: vendor/k8s.io/api/core/v1/register.go (paraphrased)
var SchemeBuilder = runtime.NewSchemeBuilder(addKnownTypes)

func init() {
    if err := AddToScheme(scheme.Scheme); err != nil {
        panic(err)
    }
}
```

This is debated within the Kubernetes community. Some controllers do **explicit** registration in `main` instead, citing test isolation. The pattern is shifting toward explicit registration for new code, while legacy code retains init-based registration for compatibility.

### 2.6 prometheus client_golang

Prometheus Go client registers default Go runtime metrics in `init`:

```go
// File: github.com/prometheus/client_golang/prometheus/registry.go (paraphrased)
var DefaultRegisterer Registerer = NewRegistry()

func init() {
    MustRegister(NewProcessCollector(...))
    MustRegister(NewGoCollector())
}
```

Importing `prometheus/promhttp` causes default metrics to be registered. Tests that import it pay this cost; this is sometimes a measurable overhead in large unit-test runs.

---

## 3. Team Conventions

### 3.1 Google's Internal Go Style Guide
Documented publicly at https://google.github.io/styleguide/go/decisions#init. Excerpts:
- "init functions can make code harder to read, harder to test, and impose ordering constraints."
- Acceptable uses listed: registry registration, validation of static data.
- Not acceptable: state that can fail, network I/O, mutating other packages' globals.

### 3.2 Uber Go Style Guide
https://github.com/uber-go/guide/blob/master/style.md#avoid-init
- "Avoid init() where possible."
- "When init() is unavoidable, the code should: be completely deterministic ... not depend on the order or side-effects of other init() functions ... not access or manipulate global or environment state."

### 3.3 Common Internal Rules
- Library packages SHOULD NOT have `init`. (Some teams enforce this with a lint check.)
- `main` packages MAY have `init`, but reviewers prefer explicit setup.
- Test-only packages MAY have `init` for fixture setup.
- Driver packages are exempt — that's their reason to exist.

---

## 4. Linters

### 4.1 gochecknoinits
https://github.com/leighmcculloch/gochecknoinits

Forbids `init` functions outright. Some teams enable it via `golangci-lint`:
```yaml
linters:
  enable:
    - gochecknoinits
```

You then add `//nolint:gochecknoinits` exemptions to known-good files (the package's driver registration, for example). This makes every init a deliberate choice rather than an accident.

### 4.2 staticcheck
- `SA1019`: detects deprecated APIs (not init-specific, but flags imports of packages whose init pollutes globals when there's a documented replacement, e.g., legacy logging).
- General checks for unused imports, including misused blank imports.

### 4.3 revive
The `unused-receiver` and `argument-limit` rules catch malformed init signatures (e.g., `func init(x int)`).

### 4.4 golangci-lint config example
```yaml
linters:
  enable:
    - gochecknoinits
    - gochecknoglobals  # often paired
    - staticcheck
    - revive

issues:
  exclude-rules:
    - path: 'cmd/.*/main\.go'
      linters: [gochecknoinits]
    - path: 'pkg/drivers/.*\.go'
      linters: [gochecknoinits]
      text: "init.*sql\\.Register"
```

### 4.5 Custom AST Checks
Larger orgs sometimes write a small `analysis.Analyzer` to enforce: "init bodies may only call functions in package `registry`". That kind of check catches accidentally adding I/O later.

---

## 5. Code Review Checklist

When reviewing a PR that adds or modifies `init`:

- [ ] Is this a registry-registration init? If yes, is the registry well-known and documented?
- [ ] Does the body do any of: file I/O, network I/O, env-var read, goroutine spawn, time.Now-dependent compute? If yes, push back hard.
- [ ] If the package is a library, does the init mutate any package's globals other than the registry? If yes, almost certainly wrong.
- [ ] Is there a corresponding blank import in callers? Is it commented?
- [ ] Can the init's body be extracted into a named function and called from a test?
- [ ] Does the init panic on failure? Is the failure clearly a programmer error (not operator error)?
- [ ] If the init touches `http.DefaultServeMux`, does the caller know not to expose that mux publicly?
- [ ] Has the package's `_test.go` been run with `-race`? Init goroutines are subtle.

---

## 6. Postmortem-Style Stories

### Story 1 — "Why is CI taking 8 minutes for a 30-second test?"

A team at a startup discovered their unit-test suite was unaccountably slow. Profiling showed every package import triggered a 2-second DNS lookup. Cause: a logging library they vendored had:
```go
func init() {
    hostname, _ = os.Hostname()
    cluster = lookupCluster(hostname) // DNS!
}
```

Every test binary that linked against the logger paid this cost. They swapped the body into a `sync.Once` accessed only when a log line was actually emitted; the test suite dropped to 45 seconds.

**Lesson**: Unit tests should not pay for production-only setup. Init is the wrong place for it.

### Story 2 — "The pprof leak"

A fintech team shipped a public-facing API. A junior engineer added `import _ "net/http/pprof"` for "easier debugging". Because the API used `http.ListenAndServe(addr, nil)`, the public endpoint exposed `/debug/pprof/heap` — including a memory dump. A penetration test found it within 2 hours of launch.

**Lesson**: Side-effect imports in `main` are first-class architecture decisions. Code review must catch them.

### Story 3 — "Driver-loaded too early"

A monitoring agent had:
```go
import (
    _ "github.com/lib/pq"
    _ "github.com/go-sql-driver/mysql"
    _ "github.com/microsoft/go-mssqldb"
)
```

The mssqldb driver's `init` allocated 4MB of buffer pools. The agent's binary footprint nearly doubled, and on memory-constrained edge devices it OOMed. The fix: split into build tags, only including drivers compiled per platform.

**Lesson**: `init` cost compounds. Be aware of cumulative startup memory and time.

### Story 4 — "Init panic, container restart loop"

Production deploy: the K8s deployment came up, init panicked because `os.Getenv("API_KEY")` returned empty, the container restarted, panicked again, restart loop. The orchestrator's exponential-backoff eventually parked the deployment. Outage: 12 minutes.

The team's mitigation: validate envs in `main`, before any business logic, and structured-log the missing key. Init-time panics are now caught at PR review.

**Lesson**: Operator errors (missing env var) should not crash before logging is set up.

### Story 5 — "Hidden global state"

A team adopted a third-party metrics library. After integration, `expvar.Func` data was suddenly exposed at `/debug/vars` because the metrics library imported `expvar` for internal use. The data included internal queue sizes that competitors could use to estimate traffic.

**Lesson**: Audit all transitive imports for init-side-effects before going public. Tools like `go list -deps` help.

### Story 6 — "Test flakiness from goroutine in init"

A package had:
```go
func init() {
    go func() {
        for {
            updateMetrics()
            time.Sleep(10 * time.Second)
        }
    }()
}
```

Tests intermittently failed because the goroutine touched a global that some tests reset. Race detector caught it once a CI machine got slow enough.

**Lesson**: Goroutines spawned in init outlive any single test. Don't spawn them.

### Story 7 — "Cycle that wasn't"

A package's `init` did `pkg.Cache = pkg.LoadFromB()` where `pkg b`'s init populated `b.Data`. After a refactor, someone moved `LoadFromB` to a different file in package `b`, and now the var-init order changed. `b.Data` wasn't fully populated when `pkg.LoadFromB` was called, so `Cache` was stale until the first miss caused a reload.

**Lesson**: Cross-package init dependencies are fragile. The fix was to reach `b.Data` lazily (on first cache access) rather than in init.

---

## 7. Patterns to Recommend

### 7.1 The Registry + Blank Import Pattern
- Library `pkg/x` has a `Register` function that mutates internal state.
- Plugin `pkg/x/plugin` has `init` that calls `pkg/x.Register`.
- User `main.go` blank-imports `pkg/x/plugin`.

This is the only init pattern most teams universally accept.

### 7.2 The Validate-Static-Data Pattern
- Package has constant maps.
- Init walks the map and panics if invariants violated.
- Acceptable because failure mode is programmer error caught on first run.

### 7.3 Avoid Patterns
- Init that reads env (use `Setup(cfg Config)`).
- Init that opens connections (use `sync.Once` or explicit setup).
- Init that calls `flag.Parse` (forbidden).
- Init in libraries that mutate `http.DefaultServeMux` (or any other global mutable singleton).

---

## 8. Building a Lint Rule

If your team has a strong opinion, encode it. Example: forbid init in non-cmd packages.

```go
// tools/lint/noinit/noinit.go
package main

import (
    "go/ast"
    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/singlechecker"
    "strings"
)

var Analyzer = &analysis.Analyzer{
    Name: "noinit",
    Doc:  "disallow init() in non-cmd packages",
    Run: func(pass *analysis.Pass) (interface{}, error) {
        pkgPath := pass.Pkg.Path()
        if strings.Contains(pkgPath, "/cmd/") {
            return nil, nil
        }
        for _, f := range pass.Files {
            for _, decl := range f.Decls {
                fn, ok := decl.(*ast.FuncDecl)
                if !ok { continue }
                if fn.Name.Name == "init" && fn.Recv == nil {
                    pass.Reportf(fn.Pos(), "init() not allowed in libraries")
                }
            }
        }
        return nil, nil
    },
}

func main() { singlechecker.Main(Analyzer) }
```

You then run `noinit ./...` in CI. Override per-file with `//nolint:noinit driver registration`.

---

## 9. init in Different Build Modes

### 9.1 Standard Build
Inits run at program start; `main` runs after. Already covered.

### 9.2 Test Build
All init runs once per test binary. `TestMain` runs after init.

### 9.3 Plugin Build
The plugin's package inits run at `plugin.Open` time, in the host process. Failure surfaces as a plugin.Open error.

### 9.4 Shared Library Build
Same as plugin in spirit. Inits run at library load.

### 9.5 GAE / Cloud Functions / AWS Lambda
- AWS Lambda's Go runtime invokes `main`, which sits in a request loop. Inits run on cold start, billed to the user.
- GAE Standard's Go runtime is similar.
- Heavy init = slow cold start = unhappy users. Move work to `sync.Once` so cold start only does what's strictly needed for the first request.

---

## 10. Professional Cheat Sheet

| Aspect | Recommendation |
|--------|----------------|
| Use init for | Driver/codec/format registration, validating static data |
| Avoid init for | I/O, env reads, flag parsing, goroutines, time-sensitive compute |
| Library inits | Should not mutate other packages' globals |
| Document blank imports | Always with a comment |
| Heavy work | Refactor to `sync.Once` |
| Operator errors | Validate in `main`, not `init` |
| Lint rule | Consider `gochecknoinits` with selective allow-list |
| Plugin / Lambda | init runs lazily — design for cold-start cost |
| Postmortem flag | If "init" appears in the timeline, scrutinize deeply |

You now know how mature teams treat init. The optimize document covers measurement: how to put numbers on init cost.
