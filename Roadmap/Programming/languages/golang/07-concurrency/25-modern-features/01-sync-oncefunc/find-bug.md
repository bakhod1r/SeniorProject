---
layout: default
title: sync.OnceFunc — Find the Bug
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/find-bug/
---

# sync.OnceFunc — Find the Bug

[← Back](../)

## Bug 1 — A fresh wrapper per call

```go
type Service struct {
    name string
}

func (s *Service) Init() {
    once := sync.OnceFunc(func() {
        fmt.Println("init", s.name)
    })
    once()
}
```

What's wrong? Every call to `Init` constructs a brand-new `OnceFunc` and immediately calls it. `OnceFunc` does not look at any global state — it only knows whether *this specific* wrapper has been called before. So `Init` prints `init alpha` on every call, completely defeating the point of `OnceFunc`. The wrapper must be created once and stored, either as a package-level variable or as a field on the receiver. Fix:

```go
type Service struct {
    name string
    init func()
}

func NewService(name string) *Service {
    s := &Service{name: name}
    s.init = sync.OnceFunc(func() { fmt.Println("init", s.name) })
    return s
}

func (s *Service) Init() { s.init() }
```

## Bug 2 — Reassigning the wrapper

```go
var load = sync.OnceValue(func() *Config { return loadFromDisk() })

func Reload() {
    load = sync.OnceValue(func() *Config { return loadFromDisk() })
}
```

This *works*, but in a misleading way. `Reload` replaces the package variable with a new wrapper, and the next call to `load()` runs the loader again. The bug is that any goroutine that captured the old `load` value (`f := load`) is still holding the old wrapper and gets the *old* cached value forever, while goroutines reading `load` directly see the new one. This is a data race on the variable itself (concurrent read and write of an interface/function value), and a logic race on the cache. Use an explicit `sync.Mutex` or `atomic.Pointer[func() *Config]` if you really need to swap, or — far better — do not try to use `OnceValue` for something that needs to be reloadable. It is the wrong primitive.

## Bug 3 — Throwing away the OnceValue return

```go
var loadConfig = sync.OnceValue(func() *Config {
    return parseConfig()
})

func setup() {
    loadConfig() // populate the cache
    // ...
    cfg := getConfigPointer() // some other accessor
}
```

The bug is in `setup` — it calls `loadConfig()` for the side effect of "warming the cache", throws away the return value, and then expects some other accessor to hand it the config. There is no other accessor: the only handle on the cached value is the return value of `loadConfig()`. Compare to `sync.Once.Do`, where the function had a side effect on a package variable; with `OnceValue`, the cached value lives inside the wrapper closure and the only way out is through the return value. Fix: use `cfg := loadConfig()` everywhere, or expose `func Config() *Config { return loadConfig() }` if you really want a named accessor.

## Bug 4 — Capturing the wrong loop variable

```go
var wrappers []func()
for _, h := range handlers {
    wrappers = append(wrappers, sync.OnceFunc(func() {
        h.Cleanup()
    }))
}
```

In Go before 1.22, every iteration's closure captures the *same* `h` variable, which holds the last handler by the time any wrapper runs. So every wrapper calls `Cleanup` on the last handler — and because each wrapper is its own `OnceFunc`, "exactly once per wrapper" does not save you. The bug is the classic loop-variable capture; `OnceFunc` just makes it harder to spot because the wrappers look stateful. Fix (pre-1.22):

```go
for _, h := range handlers {
    h := h
    wrappers = append(wrappers, sync.OnceFunc(func() { h.Cleanup() }))
}
```

Go 1.22+ fixes this at the language level — but the same code on Go 1.21 (which is exactly when `OnceFunc` was introduced!) bites you.

## Bug 5 — Recovering and then expecting the second call to retry

```go
var load = sync.OnceValue(func() *Config {
    cfg, err := parseConfig()
    if err != nil {
        panic(err)
    }
    return cfg
})

func main() {
    for i := 0; i < 3; i++ {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    fmt.Println("retrying:", r)
                }
            }()
            cfg := load()
            fmt.Println(cfg)
        }()
    }
}
```

The author thinks: "if init fails, we recover, then on the next iteration `load` will try again". Wrong. The panic-reuse contract means every call to `load` panics with the same value forever. The loop just prints `retrying: ...` three times and never makes progress. The fix is to not use `OnceValue` for retryable initialization — use a `sync.Mutex` + explicit retry counter, or return `(T, error)` via `OnceValues` and let the caller decide.

## Bug 6 — Using OnceFunc for cleanup tied to a context

```go
func Worker(ctx context.Context) {
    cleanup := sync.OnceFunc(func() {
        fmt.Println("cleanup")
    })
    defer cleanup()
    go func() {
        <-ctx.Done()
        cleanup()
    }()
    // ...do work...
}
```

The bug isn't the `OnceFunc` itself — it correctly guarantees `cleanup` runs once. The bug is the assumption that "cleanup" is a global resource. If `Worker` is called many times, each call creates its *own* `OnceFunc`, captures its *own* `cleanup` function, and the print happens once per `Worker` call. That is probably what the author wanted, but the variable name `cleanup` and the global feel of "init" patterns easily misleads a reviewer into thinking it deduplicates across workers. If you do want global single-shot cleanup, hoist the `OnceFunc` to package scope. Naming matters: prefer `closeOnce` or `runCleanup` for per-instance wrappers.

## Bug 7 — Comparing wrapper function values

```go
a := sync.OnceFunc(initA)
b := a
if reflect.ValueOf(a).Pointer() == reflect.ValueOf(b).Pointer() {
    fmt.Println("same wrapper")
}
```

This compiles and *seems* to work, but `reflect.Value.Pointer()` on a function value returns the address of the underlying code, not the closure. Two distinct `OnceFunc` calls — say, both wrapping `initA` — would compare equal even though they are completely independent wrappers with independent caches. The correct test (if you really need it) is to compare the wrappers via an interface and a sentinel, or simply by storing the wrapper in a package-level variable so there is only one. Comparing function values for identity is almost never what you want in Go.

## Bug 8 — OnceValues with mismatched returns

```go
var load = sync.OnceValues(func() (*Config, error) {
    cfg, err := parseConfig()
    return cfg, err
})

func main() {
    cfg, _ := load()
    fmt.Println(cfg.DSN)
}
```

What happens if `parseConfig` returns `(nil, someError)`? `load` caches `(nil, someError)` forever. The first caller discards `err`, dereferences `cfg`, and crashes. The bug is not in `OnceValues` — it correctly preserved the `(nil, err)` pair — but in the calling code that ignored the error. The general lesson: `OnceValues` is no safer than the function it wraps; if your loader can fail, every caller must check the error, every time.

## Bug 9 — Passing the same wrapper to multiple goroutines without storing it

```go
func Process(items []Item) {
    for _, item := range items {
        go func(it Item) {
            initOnce := sync.OnceFunc(globalSetup)
            initOnce()
            handle(it)
        }(item)
    }
}
```

This is the per-call-construction bug from earlier, in a more subtle wrapper. Each goroutine creates its own `OnceFunc`, so each goroutine triggers `globalSetup` exactly once — and there are `len(items)` goroutines, so `globalSetup` runs `len(items)` times total. The fix is to hoist `initOnce` outside the loop:

```go
var initOnce = sync.OnceFunc(globalSetup)

func Process(items []Item) {
    for _, item := range items {
        go func(it Item) {
            initOnce()
            handle(it)
        }(item)
    }
}
```

Now `initOnce` is a single package-level wrapper, and `globalSetup` runs exactly once across all goroutines.

## Bug 10 — Initialization order with multiple OnceValues

```go
var (
    db = sync.OnceValue(func() *sql.DB {
        cfg := config()
        db, _ := sql.Open(cfg.Driver, cfg.DSN)
        return db
    })
    config = sync.OnceValue(func() *Config {
        return loadConfig()
    })
)
```

There's no bug *yet*, but the order of declarations is fragile. If you (or a tool) reorder the `var` block, you risk a forward reference (Go allows this for package-level variables, but it's confusing) — and worse, if `config` and `db` were in different files, you'd be at the mercy of Go's file-ordering rules for init. The bug is that the wrappers' internal closures freely call each other, hiding the dependency. Better:

```go
var loadConfig = sync.OnceValue(parseConfigFile)

var db = sync.OnceValue(func() *sql.DB {
    cfg := loadConfig()
    d, _ := sql.Open(cfg.Driver, cfg.DSN)
    return d
})
```

Use clear distinct names for the wrapper vs the underlying impl, and document or graph the dependency.

## Bug 11 — Forgetting that OnceFunc swallows return values

```go
var setup = sync.OnceFunc(func() {
    err := riskyInit()
    if err != nil {
        log.Println("setup error:", err)
    }
})
```

The author wanted a one-shot init with error logging. `setup()` doesn't return anything — that's what `OnceFunc` does. But the *underlying* function returns an error. Without the inner `if err != nil`, the error would be silently discarded.

Even with the log line, this is fragile: callers of `setup()` cannot distinguish success from failure, and a partial init might leave the system in a broken state with only a log message to show for it. The right choice for fallible init is `sync.OnceValue[error]` or `sync.OnceValues[T, error]`, not `OnceFunc` + logging.

## Bug 12 — Misusing OnceFunc with a stateful goroutine

```go
func StartWorker() {
    ch := make(chan Job)
    start := sync.OnceFunc(func() {
        go func() {
            for job := range ch {
                process(job)
            }
        }()
    })
    start()
    enqueue(ch, currentJob)
}
```

Each call to `StartWorker` creates a fresh channel and a fresh `OnceFunc`. The `OnceFunc` "starts the worker exactly once" — but for *this* call's wrapper. The next call to `StartWorker` makes another channel, another `OnceFunc`, another worker goroutine. The user thinks they're starting one worker; they're actually starting one per call.

The fix is the same shape as Bug 9 — store the wrapper somewhere durable (package var, struct field).

## Bug 13 — Returning the wrapper itself, by mistake

```go
func getLoader() func() *Config {
    return sync.OnceValue(func() *Config {
        return loadConfig()
    })
}

func main() {
    cfg1 := getLoader()()
    cfg2 := getLoader()()
    // ...
}
```

Each call to `getLoader` returns a *new* wrapper, so `cfg1` and `cfg2` are produced by independent loaders — `loadConfig` runs twice. If the intent was "memoize across all callers", `getLoader` must return a singleton wrapper. Either store the wrapper at package scope, or pass it down explicitly.

## Bug 14 — Treating panic propagation as recoverable retry

```go
var loadFlaky = sync.OnceValues(func() (*Config, error) {
    cfg, err := parseFlakyAPI()
    if err != nil {
        panic(err)
    }
    return cfg, nil
})

func getConfig() *Config {
    for i := 0; i < 3; i++ {
        defer func() { recover() }()
        cfg, _ := loadFlaky()
        if cfg != nil {
            return cfg
        }
    }
    return nil
}
```

Two bugs in one. First, `defer func(){recover()}()` inside a loop adds *new* defers each iteration; only the last one will see the panic. Second, and more fundamentally, `loadFlaky` is a `OnceValues` — after the first panic it re-panics on every call. The retry loop accomplishes nothing. The author should return the error normally rather than panic, and they should not use these helpers for retry-prone code at all.

## Bug 15 — Misreading "exactly once" as "atomic with the function body"

```go
var initialized atomic.Bool
var setup = sync.OnceFunc(func() {
    doExpensiveWork()
    initialized.Store(true)
})

func IsReady() bool {
    return initialized.Load()
}
```

This *works*, but the author thinks "if `IsReady` returns true, setup has completed". That's true here, but only because they happened to put `Store(true)` at the end of `setup`. There is no guarantee from `sync.OnceFunc` about *when* during `f`'s execution side effects become visible to other goroutines — only that after `f` completes, every subsequent wrapper call sees the completed state. A goroutine that calls `IsReady` *while* `setup` is running can observe either `false` or `true` (since `initialized` is atomic, it's at least race-free, but the answer doesn't tell you anything semantic).

If "is setup complete" is a meaningful question, build it explicitly. The cleanest answer is to *call* the wrapper rather than ask if it has run:

```go
func Ensure() { setup() } // blocks until setup is complete
```

`Ensure` is now your readiness check: it returns when (and only when) `setup` is done.

## Bug 16 — Capturing a method value at the wrong time

```go
type S struct {
    cfg *Config
}

func (s *S) init() { /* ... */ }

func NewS() *S {
    s := &S{}
    s.cfg = loadInitial()
    // OOPS: takes s.init bound to s as it is *right now*
    go sync.OnceFunc(s.init)()
    return s
}
```

The expression `sync.OnceFunc(s.init)` creates a method value, binding the receiver to the current `s`. That's fine. The problem is the `go ... ()` at the end — it starts a goroutine that immediately calls the wrapper. The wrapper is created and called in the same statement, then discarded. Subsequent code has no handle on it. Worse, the goroutine and the rest of the function run concurrently, so `s.init` may execute before or after `loadInitial` finishes mutating `s.cfg`.

Two fixes: either run `s.init` synchronously (no goroutine), or store the wrapper as a field and call it explicitly later.
