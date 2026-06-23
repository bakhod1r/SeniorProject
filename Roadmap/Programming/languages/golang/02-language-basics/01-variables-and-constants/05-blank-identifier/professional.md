# Go Blank Identifier — Professional / Internals Level

## 1. Overview

This document maps the blank identifier patterns to **real OSS code** you can read today. It also covers team conventions, code review checklists, and lint configurations that production Go shops use.

---

## 2. Compile-Time Interface Assertions in OSS

### 2.1 CockroachDB

CockroachDB uses compile-time interface assertions extensively. A single grep over the repo turns up hundreds of them. Examples:

`pkg/sql/sem/tree/expr.go`:

```go
var _ Expr = &AndExpr{}
var _ Expr = &OrExpr{}
var _ Expr = &NotExpr{}
var _ Expr = &ParenExpr{}
var _ Expr = &ComparisonExpr{}
// ... dozens of similar lines
```

The `tree.Expr` interface is the AST node base in CRDB's SQL planner. Every concrete AST node has an assertion ensuring it implements `Expr`. When someone refactors the interface (e.g., adds a new method), the compiler points at every assertion that breaks.

Other CRDB examples:

- `pkg/sql/types/types.go` — `var _ TypeBase = ...` for each type kind.
- `pkg/storage/engine.go` — `var _ Engine = (*RocksDB)(nil)` style checks for storage backends.

### 2.2 Kubernetes

`k8s.io/apimachinery` and the API types use the same pattern. Look at `staging/src/k8s.io/api/core/v1/types.go` and the corresponding `zz_generated_deepcopy.go`:

```go
var _ runtime.Object = (*Pod)(nil)
var _ runtime.Object = (*Service)(nil)
var _ runtime.Object = (*ConfigMap)(nil)
```

Each generated deep-copy file ends with assertions that the new type implements `runtime.Object`. Code generators emit these blank assignments precisely so a generation bug is caught at compile time.

In `client-go`, you see assertions for the various informer/lister interfaces:

```go
var _ cache.SharedInformer = (*sharedIndexInformer)(nil)
var _ cache.SharedIndexInformer = (*sharedIndexInformer)(nil)
```

### 2.3 Prometheus

In `prometheus/client_golang`:

```go
var _ Metric = &counter{}
var _ Collector = &CounterVec{}
var _ Gauge = &gauge{}
```

Every metric type has a compile-time assertion that it satisfies the public `Metric` and/or `Collector` interfaces.

### 2.4 Standard Library

`net/http`:

```go
var _ Handler = HandlerFunc(nil) // in net/http/server.go (functionally equivalent)
```

The standard library uses the pattern more sparingly than third-party code (the std lib's tests already cover the interface satisfaction), but the idiom is recognized everywhere in the ecosystem.

### 2.5 etcd

In `go.etcd.io/etcd`:

```go
var _ raft.Storage = (*MemoryStorage)(nil)
```

Storage backends, transport implementations, and consensus participants all use blank assertions to lock in their interface contracts.

---

## 3. Side-Effect Imports in OSS

### 3.1 `database/sql` Drivers

Every Go SQL driver follows the same recipe. Examples:

- `github.com/lib/pq`:
  ```go
  // in pq's main file:
  func init() {
      sql.Register("postgres", &Driver{})
  }
  ```
  Consumed as `import _ "github.com/lib/pq"`.

- `github.com/go-sql-driver/mysql`:
  ```go
  func init() {
      sql.Register("mysql", &MySQLDriver{})
  }
  ```
  Consumed as `import _ "github.com/go-sql-driver/mysql"`.

- `modernc.org/sqlite`, `github.com/mattn/go-sqlite3`, `github.com/microsoft/go-mssqldb` — same shape.

The official Go wiki page on database drivers (https://github.com/golang/go/wiki/SQLDrivers) lists dozens; all rely on `_` import.

### 3.2 `image` Decoders

The standard library's `image` package keeps a registry of formats. Each subpackage adds itself in `init`:

- `image/png` — registers via `image.RegisterFormat("png", "\x89PNG\r\n\x1a\n", Decode, DecodeConfig)`.
- `image/jpeg` — same pattern.
- `image/gif` — same pattern.
- Third-party: `golang.org/x/image/webp`, `golang.org/x/image/tiff`, `golang.org/x/image/bmp`.

A typical app imports them blank:

```go
import (
    "image"
    _ "image/png"
    _ "image/jpeg"
    _ "golang.org/x/image/webp"
)
```

### 3.3 `net/http/pprof`

The single most famous side-effect import in Go:

```go
import _ "net/http/pprof"
```

In `net/http/pprof/pprof.go`:

```go
func init() {
    http.HandleFunc("/debug/pprof/", Index)
    http.HandleFunc("/debug/pprof/cmdline", Cmdline)
    http.HandleFunc("/debug/pprof/profile", Profile)
    http.HandleFunc("/debug/pprof/symbol", Symbol)
    http.HandleFunc("/debug/pprof/trace", Trace)
}
```

The handlers attach to `http.DefaultServeMux`. With one blank import, your binary gets profiling endpoints — assuming you serve `DefaultServeMux` somewhere (`http.ListenAndServe(":6060", nil)`).

Production tip: many shops separate pprof onto an internal-only port. The blank import is identical; what differs is the listener.

### 3.4 `expvar`

```go
import _ "expvar"
```

Adds `/debug/vars` to `http.DefaultServeMux`, exposing `cmdline`, `memstats`, and any custom variables registered via `expvar.Publish`.

### 3.5 `runtime/debug` Side-Effect Patterns

Less commonly, you see `runtime/debug` style patterns where loading a package configures GOGC or similar at process start. These are usually wrapped in an explicit function call rather than a blank import.

### 3.6 OpenTelemetry / Tracer Registration

Many tracing libraries use side-effect imports for their default exporter:

```go
import _ "go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
```

The exact policy depends on the library; some prefer explicit registration to avoid the magic of `init`.

---

## 4. Team Conventions

### 4.1 Where to Put Compile-Time Assertions

Three styles, all defensible:

**A. Right under the type declaration.**
```go
type FileLogger struct { /* ... */ }

var _ Logger = (*FileLogger)(nil)

func (f *FileLogger) Log(s string) { /* ... */ }
```

Pros: Reader sees the contract immediately.
Cons: If methods come later in the file, the assertion comes before any visible implementation.

**B. At the bottom of the file.**
```go
type FileLogger struct { /* ... */ }
func (f *FileLogger) Log(s string) { /* ... */ }
// ...
var (
    _ Logger = (*FileLogger)(nil)
    _ Closer = (*FileLogger)(nil)
)
```

Pros: All assertions in one block; easy to spot.
Cons: Reader has to scroll to find them.

**C. In a dedicated `interfaces_test.go` or similar.**

```go
// types_compile_test.go
package mypkg

var (
    _ Logger = (*FileLogger)(nil)
    _ Logger = (*StderrLogger)(nil)
)
```

Pros: Keeps non-runtime checks out of the production source.
Cons: Some teams find this surprising.

Pick one and apply it consistently.

### 4.2 Where to Put Side-Effect Imports

The convention is: side-effect imports go in **`main.go`** or in a small "linkages" file, not in library code. Library packages should not pull in drivers, decoders, or pprof; that decision belongs to the binary.

```
cmd/
  myapp/
    main.go          // imports _ "github.com/lib/pq"
    pprof_enabled.go // build tag, imports _ "net/http/pprof"
```

Build tags help here:

```go
//go:build pprof

package main

import _ "net/http/pprof"
```

Then `go build -tags=pprof` includes profiling.

### 4.3 Discarding Errors

Some teams forbid `_ = err` outright, requiring an explicit `// nolint:errcheck` with a comment. Others accept it for `defer` cleanup:

```go
defer func() { _ = f.Close() }()
```

A balanced policy:

- **Forbid** `_ = err` from any function whose only purpose is checking errors (e.g., `db.Query`).
- **Allow** `_ = err` for best-effort cleanup with a comment.
- **Require** an explicit log for ignored errors that affect data integrity (e.g., `tx.Rollback()`).

### 4.4 Discarding Function Parameters

Two camps:

- **Camp A:** Always name parameters; ignore them by not referencing.
- **Camp B:** Use `_` for parameters that the function genuinely does not use.

Both compile. Camp B is louder; Camp A is more flexible if a refactor needs the parameter later.

---

## 5. Code Review Checklist for `_`

Use this list when reviewing PRs:

- [ ] Every `_, err := ...` is followed by an `if err != nil` check or a deliberate decision to ignore the error.
- [ ] Every `n, _ := ...` has a comment or context proving the second return cannot fail.
- [ ] Every `_ = expr` either has a comment explaining why or is removed.
- [ ] Every `import _ "..."` is in `main` or a dedicated linkage file, not in a library package.
- [ ] Every `var _ Iface = ...` is near the type definition.
- [ ] No `_` in variable names that should be properly named (parameters, struct fields).
- [ ] No `_` shadowing pattern that misleads readers (cannot actually shadow, but newcomers may try).
- [ ] No `_ = nil` or other nonsense patterns.

---

## 6. Lint Configuration

### 6.1 `errcheck`

`errcheck` flags discarded errors. Configuration in `.errcheck`:

```
fmt.Print*
fmt.Fprint*
io.Copy
(*bytes.Buffer).Write
(*bytes.Buffer).WriteString
```

Functions on this list have their return values silently dropped without warning. Anything else triggers a finding when `_, err := f()` ignores the error.

Override per-line:

```go
// nolint:errcheck // intentional best-effort cleanup
_ = file.Close()
```

### 6.2 `golangci-lint`

In `.golangci.yml`:

```yaml
linters:
  enable:
    - errcheck
    - unused
    - revive
    - unparam

linters-settings:
  errcheck:
    check-type-assertions: true
    check-blank: false  # don't flag _, _ = ... assertions
  unused:
    check-exported: false
  revive:
    rules:
      - name: unused-parameter
        disabled: true # too noisy for many teams
```

`check-blank: true` would flag every `_ = f()` — useful in strict shops, noisy in others.

### 6.3 `staticcheck`

The `SA4006` check flags assignments where the result is never used:

```go
x := compute()
x = recompute() // SA4006: previous value of x is never used
```

This does NOT fire on `_` because there is no "previous value". `_ = compute()` is allowed by `staticcheck`.

### 6.4 `revive`

The `unused-parameter` rule (default off in many configs) suggests `_` for parameters not referenced. Some teams enable it; others reject it.

The `var-naming` rule does not affect `_`.

### 6.5 `unparam`

`unparam` flags parameters that are always passed the same value or never used. It does not fire on `_` parameters (since they are explicitly unused).

---

## 7. Production Patterns from Real Codebases

### 7.1 Driver Selection at Build Time

```
// drivers_postgres.go
//go:build postgres
package main
import _ "github.com/lib/pq"

// drivers_mysql.go
//go:build mysql
package main
import _ "github.com/go-sql-driver/mysql"
```

`go build -tags=postgres` selects the postgres driver. The main code is driver-agnostic.

### 7.2 Plugin-Style Registration

```go
// codec/registry.go
var codecs = map[string]Codec{}

func Register(name string, c Codec) { codecs[name] = c }

// codec/json/json.go
package json
func init() { codec.Register("json", &Codec{}) }

// codec/yaml/yaml.go
package yaml
func init() { codec.Register("yaml", &Codec{}) }

// main.go
import (
    _ "myproject/codec/json"
    _ "myproject/codec/yaml"
)
```

Every consumer of `codec` reads `codec.Get("json")` without knowing which codec packages are linked in. The binary's `main` decides.

### 7.3 Generated Assertion Files

Code generators (gRPC, protobuf, deep-copy) emit:

```go
// Generated. Do not edit.

var _ proto.Message = (*MyRequest)(nil)
var _ proto.Message = (*MyResponse)(nil)
```

This catches breakage when the generator changes.

### 7.4 Health Check Endpoints via pprof

```go
import (
    "net/http"
    _ "net/http/pprof"
)

func main() {
    go func() {
        log.Fatal(http.ListenAndServe("127.0.0.1:6060", nil))
    }()
    // serve real traffic on a different listener / mux
}
```

`127.0.0.1:6060` keeps pprof off the public network. The blank import does not gate access.

### 7.5 Best-Effort Cleanups

```go
defer func() {
    _ = listener.Close() // shutdown path; failure is acceptable
}()
```

Common in long-running services where the process is exiting and a stale listener does not matter.

---

## 8. References to Real Files

To read the patterns in production, look at:

- `cockroachdb/cockroach`: `pkg/sql/sem/tree/*.go` (interface assertions).
- `kubernetes/kubernetes`: `staging/src/k8s.io/apimachinery/pkg/runtime/types.go` and any generated `zz_generated_deepcopy.go`.
- `prometheus/client_golang`: `prometheus/counter.go`, `prometheus/gauge.go`.
- `lib/pq`: top of `conn.go` for `func init()` registration.
- `go-sql-driver/mysql`: top of `driver.go` for `func init()`.
- Go standard library: `net/http/pprof/pprof.go`, `image/png/reader.go` (`func init()`), `expvar/expvar.go`.
- `etcd-io/etcd`: `server/storage/wal/wal.go` and similar (interface assertions).

These are read-only references; the patterns there are what the OSS Go community considers idiomatic.

---

## 9. Anti-Patterns Production Reviews Reject

- `_ = err` with no comment in business logic — rejected; either handle or document.
- `_ = json.Unmarshal(b, &v)` — rejected; bad input is a real failure.
- `import _ "somepkg"` in a library package (not `main`) — rejected; lifts the policy decision out of the binary.
- `var _ I = MyType{}` for an exported type with no public consumers — accepted; this is exactly the case where the assertion adds value.
- `_, _ = io.Copy(dst, src)` without comment — rejected; copy errors usually matter.
- `func handler(_ http.ResponseWriter, _ *http.Request)` — rejected unless the handler genuinely returns nothing (e.g., a placeholder).

---

## 10. Summary

The blank identifier is one of the few Go features whose **idiomatic uses are concentrated in a small number of patterns** that you can name and check for. Treat each `_` as a small contract:

- `_, err := f()` — "I want only the error".
- `var _ I = (*T)(nil)` — "T must implement I".
- `import _ "p"` — "run p's `init`, expose nothing".
- `_ = expr` — "I evaluated this on purpose, value not needed".

Anything else deserves a comment, a refactor, or a rejection. Real codebases (CockroachDB, Kubernetes, Prometheus, the standard library) follow these patterns precisely; copying their conventions is a safe default.
