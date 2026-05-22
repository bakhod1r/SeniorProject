---
layout: default
title: sync.OnceFunc — Middle
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/middle/
---

# sync.OnceFunc — Middle

[← Back](../)

## Table of Contents
1. [What this file assumes](#what-this-file-assumes)
2. [The three helpers and their signatures](#the-three-helpers-and-their-signatures)
3. [Exactly-once semantics, precisely](#exactly-once-semantics-precisely)
4. [Panic propagation](#panic-propagation)
5. [OnceValue for lazy singletons](#oncevalue-for-lazy-singletons)
6. [OnceValues for value-plus-error init](#oncevalues-for-value-plus-error-init)
7. [Choosing between Once and the helpers](#choosing-between-once-and-the-helpers)
8. [Initialization order and package-level vars](#initialization-order-and-package-level-vars)
9. [Common middle-level mistakes](#common-middle-level-mistakes)
10. [Cheat sheet](#cheat-sheet)
11. [Self-assessment checklist](#self-assessment-checklist)
12. [Summary](#summary)
13. [Further reading](#further-reading)

---

## What this file assumes
You know `sync.Once.Do` and the pre-1.21 lazy-init pattern. You will learn the Go 1.21 helpers (`OnceFunc`, `OnceValue`, `OnceValues`), their exact exactly-once and panic semantics, and the rule for choosing among them and plain `Once`.

---

## The three helpers and their signatures

```go
func OnceFunc(f func()) func()
func OnceValue[T any](f func() T) func() T
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)
```

Each takes an initializer and returns a function. The returned function runs `f` on its first call and, on every later call, skips `f` and (for the value variants) returns the cached result. They replace the `sync.Once` + package-level result variable boilerplate.

```go
// Before (Go < 1.21)
var once sync.Once
var conf *Config
func Conf() *Config {
    once.Do(func() { conf = load() })
    return conf
}

// After (Go 1.21+)
var Conf = sync.OnceValue(func() *Config { return load() })
```

---

## Exactly-once semantics, precisely
- `f` runs **at most once**, no matter how many goroutines call the returned function concurrently or how many times each calls.
- Concurrent callers **block** until the first invocation of `f` completes, then all observe the same result.
- After `f` returns, the helper holds no reference to `f` (the value variants keep only the result), so closed-over resources can be garbage collected.

This is the same happens-before guarantee as `sync.Once.Do`: the completion of `f` happens-before the return of any call to the wrapper, so the initialized state is visible to all callers.

---

## Panic propagation
This is the subtle part. If `f` panics:

- The panic propagates to the **caller that triggered the run**.
- The helper records that `f` was "called". **Every subsequent call re-panics with the same value** — `f` is never retried.

```go
var get = sync.OnceValue(func() int {
    panic("boom")
})

func main() {
    defer func() { recover() }()
    _ = get() // panics "boom"
    _ = get() // panics "boom" again — same value, f NOT re-run
}
```

Contrast with `sync.Once.Do`: there, a panic also marks the `Once` as done, so the function won't re-run either. The behavior is consistent — **a panicking initializer is permanently "done"**. If you need retry-on-failure, do not use these helpers; use explicit locking with your own retry logic, or `OnceValues` returning an error you check (an error is a value, not a panic).

---

## OnceValue for lazy singletons
The most common use: a process-wide resource built lazily on first use.

```go
var db = sync.OnceValue(func() *sql.DB {
    conn, err := sql.Open("postgres", dsn)
    if err != nil {
        panic(err) // see panic semantics: this becomes permanent
    }
    return conn
})

func Handler() {
    rows, _ := db().Query("...") // first call opens, rest reuse
}
```

Because a failed open panics permanently, prefer the error-returning form for anything that can fail at runtime.

---

## OnceValues for value-plus-error init
When initialization can fail, return the error as a value so it can be inspected (and so callers can decide whether to retry at a higher level).

```go
var loadCfg = sync.OnceValues(func() (*Config, error) {
    return parseConfigFile("/etc/app.yaml")
})

func Start() error {
    cfg, err := loadCfg()
    if err != nil {
        return fmt.Errorf("config: %w", err) // err is cached and returned every time
    }
    run(cfg)
    return nil
}
```

Note: the error is computed *once* and cached. If the first attempt fails, every later call returns the *same* cached error — it does not retry. This is correct for "config that's either valid at startup or the process is broken," but wrong for "transient failure we should retry." For retry semantics, manage the lifecycle yourself.

---

## Choosing between Once and the helpers

| Need | Use |
|---|---|
| Run a side-effecting init once, no result | `OnceFunc` |
| Lazily build one value | `OnceValue` |
| Lazily build a value that can fail | `OnceValues` |
| Init tied to a struct instance, reset-able, custom retry | `sync.Once` (explicit) |
| Retry on failure | none of these — roll your own |

The helpers win on readability for package-level singletons. Plain `sync.Once` still wins when the once-state is a field of a struct with many instances, or when you need behavior the helpers don't offer (reset, retry).

---

## Initialization order and package-level vars
`var x = sync.OnceValue(f)` does **not** call `f` at package-init time — it only constructs the wrapper. `f` runs on the first *call* to `x()`. This is the point: defer expensive work until first use, avoiding slow package init and import cycles in initialization order. If you actually want eager init, just call `f` directly in an `init()` or a plain `var`.

---

## Common middle-level mistakes
1. **Expecting retry after a panic or cached error** — the helpers never re-run `f`.
2. **`panic` in the initializer for a recoverable runtime failure** — use `OnceValues` and return an error instead.
3. **Using a value helper for per-instance state** — they're function-scoped; for struct fields use `sync.Once`.
4. **Assuming `var x = sync.OnceValue(f)` runs `f` at startup** — it runs on first call.
5. **Capturing a large object in the closure and expecting it freed before first call** — it's held until `f` runs.

---

## Cheat sheet

| Helper | Returns | First call | Later calls |
|---|---|---|---|
| `OnceFunc(f)` | `func()` | runs `f` | no-op (re-panics if `f` panicked) |
| `OnceValue(f)` | `func() T` | runs `f`, caches `T` | returns cached `T` |
| `OnceValues(f)` | `func() (T1,T2)` | runs `f`, caches both | returns cached pair |

---

## Self-assessment checklist
- [ ] I can write all three helpers' signatures from memory.
- [ ] I know `f` runs at most once and concurrent callers block then share the result.
- [ ] I can explain why a panicking initializer is permanent and re-panics.
- [ ] I use `OnceValues` for fallible init instead of panicking.
- [ ] I know `var x = sync.OnceValue(f)` defers `f` to first call.
- [ ] I know when plain `sync.Once` still beats the helpers.

---

## Summary
The Go 1.21 `OnceFunc`/`OnceValue`/`OnceValues` helpers replace the `sync.Once` + result-variable boilerplate with one expression. They guarantee `f` runs at most once, block concurrent first-callers, and cache the result. The critical subtlety is failure handling: a panic (or a cached error) is permanent — `f` never retries — so use `OnceValues` and return errors for fallible init, and keep plain `sync.Once` for per-instance state or custom retry/reset needs.

In `senior.md` we'll cover the implementation, the memory and allocation cost, and the production patterns (and pitfalls) of lazy initialization at scale.

---

## Further reading
- Go 1.21 release notes — https://go.dev/doc/go1.21#sync
- `sync` package docs — https://pkg.go.dev/sync#OnceFunc
- `src/sync/oncefunc.go` — the (short) implementation
- The Go Memory Model — https://go.dev/ref/mem

---

[← Back](../)
