---
layout: default
title: sync.OnceFunc — Senior
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/senior/
---

# sync.OnceFunc — Senior

[← Back](../)

## Table of Contents
1. [What this file is](#what-this-file-is)
2. [How the helpers are implemented](#how-the-helpers-are-implemented)
3. [The fast path: why it's nearly free](#the-fast-path-why-its-nearly-free)
4. [Allocation and closure cost](#allocation-and-closure-cost)
5. [Lazy init vs eager init at scale](#lazy-init-vs-eager-init-at-scale)
6. [The retry problem and how to solve it properly](#the-retry-problem-and-how-to-solve-it-properly)
7. [Testing once-initialized code](#testing-once-initialized-code)
8. [API design with lazy singletons](#api-design-with-lazy-singletons)
9. [Anti-patterns at scale](#anti-patterns-at-scale)
10. [Cheat sheet](#cheat-sheet)
11. [Self-assessment checklist](#self-assessment-checklist)
12. [Summary](#summary)
13. [Further reading](#further-reading)

---

## What this file is
Middle taught the semantics; this file is about the cost, the implementation, and the production patterns. The senior questions are: what does the fast path cost, when does lazy init hurt you, how do you get retry semantics the helpers refuse to give, and how do you keep lazy singletons testable.

---

## How the helpers are implemented
Conceptually, each helper closes over a `sync.Once` (or an equivalent atomic-guarded slot) plus result storage, and returns a closure:

```go
// Simplified model of OnceValue.
func OnceValue[T any](f func() T) func() T {
    var (
        once   sync.Once
        valid  bool
        p      any // captured panic
        result T
    )
    g := func() T {
        once.Do(func() {
            defer func() {
                if r := recover(); r != nil {
                    p = r       // remember the panic
                    panic(r)    // still propagate to this caller
                }
                valid = true
            }()
            result = f()
        })
        if !valid {
            panic(p) // re-panic on every later call after a failed run
        }
        return result
    }
    return g
}
```

The real `src/sync/oncefunc.go` is close to this. The key design points: the panic is captured and re-raised so failure is permanent and observable, and `f` is dropped after the run.

---

## The fast path: why it's nearly free
After the first call, `once.Do` checks a single atomically-loaded "done" word and returns immediately — no lock acquired on the fast path. So the steady-state cost of a `OnceValue` call is roughly one atomic load plus a function-call indirection: a few nanoseconds. For most code this is negligible; you can call the wrapper on every request without measurable overhead.

```go
var region = sync.OnceValue(func() string { return detectRegion() })

func Handle() {
    r := region() // ~atomic load after first call
    _ = r
}
```

If you need to shave even that, hoist the result into a local once at startup. Rarely worth it.

---

## Allocation and closure cost
- Constructing the wrapper allocates: the closure plus its captured cells (the `Once`, result, panic slot) live on the heap because the returned function escapes. This is a **one-time** cost at construction, not per call.
- The captured `f` and anything it closes over stay alive until the first call runs (then `f` is released; the value variants keep the result).
- For thousands of independent lazy singletons this is fine. For a hot-path *factory* that builds millions of one-shot wrappers, the construction allocation matters — don't use `OnceValue` to model per-request once-ness.

---

## Lazy init vs eager init at scale
Lazy init via these helpers defers cost to first use. Trade-offs:

- **Pro:** fast process startup, no import-time ordering hazards, work avoided entirely if the path is never hit.
- **Con:** the first request that triggers init pays the full latency (a cold-start spike). Under a thundering first-second of traffic, many goroutines block on that first init.

For latency-sensitive services, consider **warming** lazy singletons during startup or readiness checks so the cold-start cost is paid before traffic arrives:

```go
func warm() {
    _ = db()       // force init now
    _ = loadCfg()  // ...
}
```

You keep the clean `OnceValue` definition but control *when* the cost lands.

---

## The retry problem and how to solve it properly
The helpers cache failure permanently. Real systems often need "try to init; if it fails transiently, retry next time." Do not fight the helpers — use a different tool:

```go
type lazy[T any] struct {
    mu    sync.Mutex
    val   T
    ok    bool
}

func (l *lazy[T]) Get(build func() (T, error)) (T, error) {
    l.mu.Lock()
    defer l.mu.Unlock()
    if l.ok {
        return l.val, nil
    }
    v, err := build()
    if err != nil {
        var zero T
        return zero, err // NOT cached: next call retries
    }
    l.val, l.ok = v, true
    return l.val, nil
}
```

This caches success but allows retry on failure — the semantics `OnceValues` deliberately does not provide. Use `OnceValues` for "valid at startup or the process is broken"; use a retrying lazy for "transient dependency that may come up later." For deduplicating concurrent retries, `golang.org/x/sync/singleflight` is the right tool.

---

## Testing once-initialized code
Package-level `var x = sync.OnceValue(f)` is a global; tests that need different init can't reset it. Mitigations:

- Inject the initializer rather than hardcoding it, so tests pass a fake `f`.
- Keep the once-wrapper inside a struct instance you can re-create per test, not a package global.
- For unavoidable globals, ensure `f` reads from injectable configuration so behavior is controllable without resetting the once.

```go
type Service struct {
    cfg func() Config // injected; tests supply their own
}
func New(load func() Config) *Service {
    return &Service{cfg: sync.OnceValue(load)}
}
```

---

## API design with lazy singletons
- Don't export the wrapper's identity in a way that promises laziness; export a method (`s.Config()`), so you can switch between lazy and eager without breaking callers.
- Document the panic/permanent-error behavior loudly — callers must know that a startup misconfiguration is fatal and won't self-heal.
- Avoid hidden global lazy state in libraries; prefer constructor-injected initializers so applications control lifecycle and testing.

---

## Anti-patterns at scale
1. **`OnceValue` for transient-failure init** — caches the failure forever; use a retrying lazy or singleflight.
2. **Per-request wrapper construction** — allocates each time; defeats the purpose.
3. **Cold-start latency spikes** unaddressed — warm critical singletons at startup.
4. **Untestable package-global lazy singletons** — inject the initializer instead.
5. **Panicking initializers for recoverable errors** — return errors via `OnceValues`.
6. **Relying on init ordering** that the lazy form silently changed — be explicit about eager vs lazy.

---

## Cheat sheet

| Situation | Tool |
|---|---|
| Init valid-or-fatal at startup | `OnceValue` / `OnceValues` |
| Transient dependency, retry allowed | retrying lazy / `singleflight` |
| Per-instance once-state | `sync.Once` field |
| Cold-start sensitive | `OnceValue` + warm at startup |
| Testable init | inject the initializer |

---

## Self-assessment checklist
- [ ] I can sketch how `OnceValue` captures and re-raises a panic.
- [ ] I know the steady-state call cost is ~one atomic load.
- [ ] I know construction allocates once and `f` is released after the run.
- [ ] I warm critical lazy singletons to avoid cold-start spikes.
- [ ] I implement retrying lazy init when failure may be transient.
- [ ] I keep lazy init testable via injection.

---

## Summary
The once-helpers are cheap after the first call (an atomic load) and allocate only at construction. Their hard rule — failure is permanent — makes them perfect for "valid at startup or the process is broken" and wrong for transient-failure init, where a retrying lazy or `singleflight` is correct. At scale, manage *when* lazy cost lands by warming critical singletons, avoid per-request wrapper construction, and keep initializers injectable so the global laziness stays testable.

---

## Further reading
- `src/sync/oncefunc.go` — the real implementation
- Go 1.21 release notes — https://go.dev/doc/go1.21#sync
- `golang.org/x/sync/singleflight` — https://pkg.go.dev/golang.org/x/sync/singleflight
- The Go Memory Model — https://go.dev/ref/mem

---

[← Back](../)
