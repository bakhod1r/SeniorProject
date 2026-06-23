# Go Nil Pointer Dereference — Professional Level

## 1. Overview

Professional-level handling of nil pointer dereference is a discipline that spans static analysis, runtime instrumentation, API design conventions, and incident response. This document collects the patterns used by mature Go projects (Kubernetes, etcd, CockroachDB, Prometheus, the Go standard library) to keep nil panics rare in production and to detect them quickly when they occur.

Topics: real-world OSS gotchas, lint configurations, postmortem snippets, library APIs that are easy to misuse, defensive vs over-defensive programming, and how Go's nil culture differs from Java's NullPointerException.

---

## 2. Real-World OSS Pitfalls

### 2.1 `net/http` Request Body Is Often Nil

`http.Request.Body` is `io.ReadCloser`. For GET requests sent without an explicit body, the field is typically `nil` (or `http.NoBody` for newer code). Writing:

```go
data, _ := io.ReadAll(r.Body) // panic if r.Body is nil
```

Every HTTP handler should check or expect `nil`:

```go
if r.Body != nil {
    defer r.Body.Close()
    data, err := io.ReadAll(r.Body)
    // ...
}
```

The standard library is moving toward `http.NoBody` (a typed sentinel that supports `Read` returning EOF), but legacy code still produces `nil`.

### 2.2 `database/sql` `*sql.DB` Initialization

`sql.Open` returns a non-nil `*sql.DB` even if the driver name is invalid — it does not actually connect. The connection is lazy. So:

```go
db, err := sql.Open("nosuchdriver", "...")
if err != nil {
    return // err non-nil
}
db.Ping() // err here, not the panic
```

But a real problem: callers who do not check `err` from `sql.Open` and use `db` later. If their code paths happen to dereference `db` before the lazy connect, no panic — but if they use a driver-specific helper that requires real connection state, behavior is undefined.

A subtler version: a global `*sql.DB` initialized in a package-level `init` that swallows errors. If the init fails, `db` is nil and every query panics.

### 2.3 Kubernetes `runtime.Object` Typed Nil

The `k8s.io/apimachinery/pkg/runtime` package has a long history of typed-nil-in-interface bugs. `runtime.Object` is an interface. Functions that return `(runtime.Object, error)` may, in some buggy paths, return a `*Pod` that is nil dressed as `runtime.Object`. Downstream code's `obj != nil` check is true, then crashes on field access.

The Kubernetes codebase has dedicated `IsNil(runtime.Object) bool` helpers using reflection to handle this:

```go
func IsNil(i any) bool {
    if i == nil {
        return true
    }
    v := reflect.ValueOf(i)
    switch v.Kind() {
    case reflect.Ptr, reflect.Map, reflect.Chan, reflect.Slice, reflect.Func, reflect.Interface:
        return v.IsNil()
    }
    return false
}
```

This is the universal "is this really nil?" helper that avoids the typed-nil trap.

### 2.4 etcd Postmortem — Typed Nil in `revision`

A real etcd issue surfaced when a method returned `*RevisionGenerator` which was nil under certain leader-change conditions. Callers stored it in a `Generator` interface; subsequent `gen != nil` checks passed; then a method call read a field and panicked. The fix was to return a bare `nil` interface when the generator was unavailable, and document the API contract.

### 2.5 CockroachDB — Lazy DB Pointer

CockroachDB has experienced multiple bugs where a lazily initialized pointer was checked once and used for the lifetime of a session. A subsequent reset (e.g., reconnect) cleared the pointer; the next use panicked. The fix involved either making the field `atomic.Pointer[T]` for visibility, or moving the check inside the use site.

### 2.6 Prometheus — Metrics with Nil Labels

Prometheus's `prometheus.NewCounterVec` returns a `*CounterVec`. If a constructor function returns `(metric *CounterVec, err error)` and the caller ignores `err`, a nil metric is used in subsequent `metric.WithLabelValues(...)` calls — panic. Fix: assert non-nil before storing in a metrics registry.

### 2.7 Stdlib `os.FindProcess` On Linux

`os.FindProcess` on Linux always returns a non-nil `*os.Process` and a nil error — the actual existence of the process is verified later. Code that checks `proc != nil` and then calls `proc.Signal(syscall.SIGTERM)` may get a "process already exited" error, but no nil panic. This is a less obvious case where nil is NOT the right indicator of "exists" — read the docs.

### 2.8 Stdlib `text/template` Nil Templates

```go
var t *template.Template // nil
t.Execute(w, data) // panic
```

`*template.Template` has many nil-unsafe methods. Always parse first, check error, then use. This is a recurring pattern in CLI tools that try to share a global template variable.

---

## 3. Static Analysis Tools

### 3.1 `staticcheck`

Several SA-rules concern nil:

- **SA5011**: Possible nil pointer dereference. Triggers when code dereferences a pointer that was previously checked against nil but the check did not guard the use.

```go
if u != nil {
    log.Println(u.Name)
}
log.Println(u.Email) // SA5011: u was checked but not guarding this use
```

- **SA4023**: Comparison of error to nil after typed nil. Detects some cases of the typed-nil-error bug.

- **SA1019**: Use of deprecated APIs (orthogonal but appears alongside).

Run via `staticcheck ./...` or as part of `golangci-lint`.

### 3.2 `nilness` (golang.org/x/tools)

`go vet -vettool=$(which nilness) ./...` finds:
- Definite nil dereferences (a pointer assigned nil and then dereferenced).
- Branches where nil is dereferenced after a check that proves nil.

Limited to flow-sensitive intra-procedural analysis; misses cross-package issues.

### 3.3 `nilaway` (Uber)

`nilaway` is the most ambitious tool — interprocedural, flow-sensitive nil safety. It builds a constraint system across packages and reports paths where a nil value can reach a dereference. Configuration via comments and per-package rules.

```bash
nilaway -include-pkgs="github.com/foo/bar/..." ./...
```

It has higher false-positive rates than `staticcheck`/`nilness` but catches deeper bugs.

### 3.4 `wsl` and Style Linters

Style tools like `wsl` (whitespace linter) help group nil checks together with their related code, improving readability:

```go
// Bad — scattered
u := load(id)
result := compute(u)
if u == nil {
    return errors.New("nil")
}
return result

// Good
u := load(id)
if u == nil {
    return errors.New("nil")
}
result := compute(u)
return result
```

### 3.5 `errcheck`

Detects ignored errors. If you forget `_ = ...` on a returned error, code that uses the returned pointer may dereference nil.

```go
cfg, _ := load() // errcheck flags this
fmt.Println(cfg.Host)
```

---

## 4. Defensive vs Over-Defensive

### 4.1 Defensive

- Check inputs at API boundaries.
- Check returned pointers from functions documented to possibly return nil.
- Validate untrusted external data before parsing.

### 4.2 Over-Defensive

- Adding nil checks to internal functions whose contracts forbid nil.
- Checking `&x != nil` (always true).
- Catching panics from constructors and continuing.

A good rule: **trust function contracts, document them, and let bugs panic loudly during development.** Add nil checks only where:
- The contract explicitly permits nil.
- The data crossed a trust boundary.
- Practice has shown a particular caller misuses the API.

```go
// Over-defensive — &x is always non-nil
x := &MyStruct{}
if x != nil { // always true
    use(x)
}

// Defensive — function may return nil
u, err := find(id)
if err != nil {
    return err
}
if u == nil {
    return ErrNotFound
}
use(u)
```

---

## 5. Comparison: Go vs Java/C++

### 5.1 Java NullPointerException

- Thrown by JVM on nullable reference dereference.
- Catchable via `try ... catch (NullPointerException)`.
- Stack trace includes the line that dereferenced.
- Not part of the type system (until Kotlin / `Optional` / nullable annotations).

### 5.2 Go Nil Pointer Dereference

- Triggered by hardware fault, intercepted by signal handler.
- Recoverable via `recover` in a deferred function.
- Stack trace includes `runtime.sigpanic` frame plus user frame.
- Not part of the type system (no nullable annotations).
- Distinguishable as `*runtime.PanicNilError` since Go 1.21.

### 5.3 C/C++ NULL Dereference

- Undefined behavior. May crash, may silently corrupt memory, may seem to work.
- Cannot recover in any portable way.
- Compilers may optimize away nil checks based on the assumption that dereferencing nil is undefined.

Go's design is: panic deterministically and recoverably. This is the middle ground between Java's exception machinery and C's UB.

---

## 6. Production Incidents

### 6.1 The Always-True Check

A team had a hotfix that wrapped an `*HTTPClient` in `if h != nil`. Incident: the wrapper itself was passed as a pointer, so `&wrapper != nil` was always true even when the wrapped client was nil. The real panic occurred in the inner field access. Fix: check `wrapper.client != nil`, not `wrapper != nil`.

### 6.2 The Lazy Singleton

A logger was initialized lazily in a goroutine. Other goroutines used the package-level `var log *Logger`. For a brief window after process start, `log` was nil. Multiple panics observed in the first few requests of every restart. Fix: synchronous initialization, or `sync.Once`.

### 6.3 The Conditional Field

A struct had a field of pointer type that was populated only in some code paths. Tests covered both paths but not the interaction with a third feature that later read the field unconditionally. Fix: make the field non-pointer with a `Has` boolean, or always populate.

### 6.4 The Slice of Pointers

An RPC handler returned `[]*Item` from a database. Some elements were nil due to a bug in the row-mapping function. Downstream code iterated with `for _, item := range items { item.Render(...) }` and panicked on the nil. Fix: filter nils before returning, or change `Render` to be nil-safe.

### 6.5 The Reused Pointer

A worker pool reused `*Job` objects from a `sync.Pool`. After processing, the worker sometimes set fields to nil to "release" them. A subsequent reuser (the pool's Get) found a partially-cleaned Job; one nil field caused a panic. Fix: reset all fields explicitly in a `Reset` method, or use fresh objects.

---

## 7. Best Practices for Library Authors

1. **Document nil semantics** for every public function and method.
2. **Constructor functions** should return either a non-nil result and nil error, or a nil result and a non-nil error — never both non-nil or both nil ambiguous.
3. **Avoid typed-nil interface returns**.
4. **Provide nil-safe methods** where natural.
5. **Don't use `*T` for "optional + value" combo**; use `(T, ok)` or a wrapper.
6. **Name optional fields clearly** — prefix with `Maybe`, suffix with `Ptr`, or document.
7. **Test with explicit nil inputs** for every public API.
8. **Use lint rules** in CI.

---

## 8. Best Practices for Service Authors

1. **Recover at every goroutine boundary**.
2. **Recover in HTTP/RPC handler middleware**.
3. **Log full stacks on recovery** (`debug.Stack()`).
4. **Track nil-panic rates** as an SLO.
5. **Validate untrusted input** at the edge.
6. **Use `(*T, error)` pattern** internally.
7. **Avoid shared mutable global pointers**; prefer struct-passed dependencies.
8. **Review code paths that ignore errors** — they often produce nil pointers.

---

## 9. Recovery Patterns

### 9.1 Per-Request HTTP

```go
func recoverHTTP(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                stack := debug.Stack()
                log.Printf("panic on %s %s: %v\n%s", r.Method, r.URL.Path, rec, stack)
                if errReport != nil {
                    errReport.Send(rec, stack, r)
                }
                http.Error(w, "internal server error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

### 9.2 Per-Goroutine Worker

```go
func startWorker(ctx context.Context, ch <-chan Job) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("worker panic: %v\n%s", r, debug.Stack())
                // restart? exit? depends on policy
            }
        }()
        for {
            select {
            case <-ctx.Done():
                return
            case job := <-ch:
                process(job)
            }
        }
    }()
}
```

### 9.3 Plugin / User Code Sandbox

```go
func runPlugin(p Plugin) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("plugin %s panicked: %v", p.Name(), r)
        }
    }()
    return p.Run()
}
```

### 9.4 Re-Panic Pattern

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("seen: %v", r)
        panic(r) // let outer recover handle
    }
}()
```

Use sparingly; can complicate stack traces.

---

## 10. Observability

Recommend:
- Counter `runtime_panics_total{kind="nil"}` for each recovery.
- Distribution of stack-trace fingerprints to detect novel panics.
- Alert on panic rate > N/min.
- Sentry/Honeycomb integration for stack-trace deduplication.

```go
func recordPanic(rec any) {
    var label string
    if _, ok := rec.(*runtime.PanicNilError); ok {
        label = "nil"
    } else {
        label = "other"
    }
    panicsTotal.WithLabelValues(label).Inc()
}
```

---

## 11. Production Hardening Checklist

- [ ] HTTP middleware recovers and logs every request panic
- [ ] Every goroutine has top-level recover
- [ ] All `*T` returns from public APIs are documented
- [ ] No typed nil errors in any package
- [ ] CI runs `staticcheck`, `nilness`, optional `nilaway`
- [ ] Lazy globals are initialized synchronously or via `sync.Once`
- [ ] Pool-reused objects have `Reset` methods covering every field
- [ ] Slice/map of pointers filtered for nils at boundaries
- [ ] Tests include explicit nil inputs
- [ ] Stack traces are captured and shipped to error tracker

---

## 12. Self-Assessment Checklist

- [ ] I can name three real OSS bugs caused by typed nil
- [ ] I configure `staticcheck` and `nilness` in CI
- [ ] I know when to use `nilaway` vs simpler tools
- [ ] I distinguish defensive from over-defensive programming
- [ ] I write recover middleware for HTTP and goroutines
- [ ] I track nil-panic rates as a SLO
- [ ] I avoid shared mutable global pointers
- [ ] I document nil contracts on every public API

---

## 13. Summary

Professional nil-pointer engineering is process plus tooling: staticcheck and nilness in CI, recover at every boundary, document nil contracts, avoid typed nils, design constructors that guarantee non-nil. Real-world projects (Kubernetes, etcd, CockroachDB, Prometheus, the Go stdlib) have all stumbled over the typed-nil pattern; the fix is universally to return a bare `nil` interface, not a typed pointer set to nil. Modern Go (1.21+) gives you `*runtime.PanicNilError` to detect nil panics specifically, enabling structured metrics and per-kind handling. The bar for a hardened service: zero unhandled panics, every goroutine recovered, every public API documented, CI lint clean.

---

## 14. Further Reading

- [`staticcheck` SA5011](https://staticcheck.dev/docs/checks/#SA5011)
- [`nilaway`](https://github.com/uber-go/nilaway)
- [`nilness` analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/nilness)
- [Kubernetes `runtime.IsNil`](https://github.com/kubernetes/apimachinery)
- [Prometheus client_golang](https://github.com/prometheus/client_golang)
- [Go FAQ — nil error](https://go.dev/doc/faq#nil_error)
- [Go 1.21 release notes — `PanicNilError`](https://go.dev/doc/go1.21)
- 2.7.1 Pointers Basics
- 2.8 Error Handling Basics
