---
layout: default
title: sync.Once — Tasks
parent: sync.Once
grand_parent: sync Package
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/tasks/
---

# sync.Once — Hands-on Tasks

← Back to sync.Once

A graded set of exercises, from "five-line warm-up" to "design and benchmark." Each task includes the problem, hints, and a reference solution. Skim the hints only if stuck.

---

## Task 1 — Counter that increments at most once

Write a function `IncOnce()` that increments a package-level counter on its first call and is a no-op on every subsequent call. The function must be safe to call from any number of goroutines.

**Hints**
- Use `var counter int64` and `var once sync.Once`.
- Atomic increment with `atomic.AddInt64`.

**Reference**

```go
package inconce

import (
    "sync"
    "sync/atomic"
)

var (
    once    sync.Once
    counter int64
)

func IncOnce() {
    once.Do(func() {
        atomic.AddInt64(&counter, 1)
    })
}

func Counter() int64 {
    return atomic.LoadInt64(&counter)
}
```

Test:

```go
func TestIncOnce(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            IncOnce()
        }()
    }
    wg.Wait()
    if Counter() != 1 {
        t.Fatalf("want 1, got %d", Counter())
    }
}
```

---

## Task 2 — Lazy regex

Write a function `IsEmail(s string) bool` that uses a regex to validate email-like strings. The regex must compile lazily, on the first call, and be reused thereafter.

**Hints**
- Use `regexp.MustCompile` inside the `Once.Do` closure.

**Reference**

```go
package email

import (
    "regexp"
    "sync"
)

var (
    emailOnce sync.Once
    emailRE   *regexp.Regexp
)

func IsEmail(s string) bool {
    emailOnce.Do(func() {
        emailRE = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
    })
    return emailRE.MatchString(s)
}
```

---

## Task 3 — Lazy regex with `sync.OnceValue`

Repeat Task 2 using `sync.OnceValue` (Go 1.21+). The package-level state should be reduced to a single `var`.

**Reference**

```go
package email

import (
    "regexp"
    "sync"
)

var emailRE = sync.OnceValue(func() *regexp.Regexp {
    return regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
})

func IsEmail(s string) bool {
    return emailRE().MatchString(s)
}
```

One `var` instead of two. The function form is also slightly faster (the closure is released after first call).

---

## Task 4 — Idempotent `Close()`

Implement a `Resource` type with a `Close() error` method that may be called any number of times from any number of goroutines but only closes the underlying `io.Closer` once. Subsequent calls return `nil`.

**Hints**
- `closeOnce sync.Once`.
- Capture the close error inside the `Do` closure.

**Reference**

```go
package resource

import (
    "io"
    "sync"
)

type Resource struct {
    closeOnce sync.Once
    closeErr  error
    inner     io.Closer
}

func New(inner io.Closer) *Resource {
    return &Resource{inner: inner}
}

func (r *Resource) Close() error {
    r.closeOnce.Do(func() {
        r.closeErr = r.inner.Close()
    })
    return r.closeErr
}
```

Note: subsequent calls return the same `closeErr` as the first call. If you want subsequent calls to return `nil`, return a local variable instead of `r.closeErr` outside `Do`.

---

## Task 5 — One-time deprecation warning

Add `OldAPI()` that prints a deprecation message to `stderr` the first time it is called, then silently delegates to a `NewAPI()` function. Subsequent calls to `OldAPI` must not print again.

**Hints**
- `log.Println` to `os.Stderr`.

**Reference**

```go
package legacy

import (
    "log"
    "sync"
)

var deprecationOnce sync.Once

func OldAPI() {
    deprecationOnce.Do(func() {
        log.Println("WARNING: OldAPI is deprecated, use NewAPI")
    })
    NewAPI()
}

func NewAPI() {
    // ...
}
```

---

## Task 6 — Lazy database connection with error capture

Implement `func GetDB() (*sql.DB, error)` that opens a connection on first call and returns the cached handle on subsequent calls. The error from the first attempt must be visible to all callers.

**Hints**
- Capture `*sql.DB` and `error` in package vars.
- Or use `sync.OnceValues` (Go 1.21+).

**Reference (classic)**

```go
package db

import (
    "database/sql"
    "sync"

    _ "github.com/lib/pq"
)

var (
    once   sync.Once
    handle *sql.DB
    err    error
)

func GetDB(dsn string) (*sql.DB, error) {
    once.Do(func() {
        handle, err = sql.Open("postgres", dsn)
    })
    return handle, err
}
```

**Reference (1.21+)**

```go
var GetDB = sync.OnceValues(func() (*sql.DB, error) {
    return sql.Open("postgres", "postgres://...")
})
```

The 1.21 form does not take parameters; if you need a parameter (like the DSN), use a closure or stick with the classic form.

---

## Task 7 — Server with `startOnce` and `stopOnce`

Build a `Server` type with `Start()` and `Stop()` methods. Multiple calls to `Start` must spin up the background loop only once. Multiple calls to `Stop` must close the quit channel only once. The server runs a goroutine that ticks every 100ms until stopped.

**Reference**

```go
package server

import (
    "sync"
    "time"
)

type Server struct {
    startOnce sync.Once
    stopOnce  sync.Once
    quit      chan struct{}
    wg        sync.WaitGroup
}

func New() *Server {
    return &Server{quit: make(chan struct{})}
}

func (s *Server) Start() {
    s.startOnce.Do(func() {
        s.wg.Add(1)
        go s.loop()
    })
}

func (s *Server) Stop() {
    s.stopOnce.Do(func() {
        close(s.quit)
    })
    s.wg.Wait()
}

func (s *Server) loop() {
    defer s.wg.Done()
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            // tick
        case <-s.quit:
            return
        }
    }
}
```

Test that calling `Start` 10 times still runs only one goroutine; that calling `Stop` 10 times does not panic.

---

## Task 8 — `Once` per slot in a slice

You have a slice of `Slot` structs, each with its own lazy initialiser. Implement `Slot.Get()` that returns the slot's value, initialised on first call.

**Hints**
- Each `Slot` has its own `sync.Once`.
- Beware: range loops copy the element. Use index access.

**Reference**

```go
package slots

import "sync"

type Slot struct {
    once sync.Once
    val  string
    init func() string
}

func (s *Slot) Get() string {
    s.once.Do(func() { s.val = s.init() })
    return s.val
}

func Init(slots []Slot, fs []func() string) {
    for i := range slots {
        slots[i].init = fs[i]
    }
}

// Use:
// var slots [10]Slot
// for i := range slots {
//     idx := i
//     slots[idx].init = func() string { return fmt.Sprintf("slot %d", idx) }
// }
// slots[3].Get() // initialises slot 3
```

The trap to avoid:

```go
for _, s := range slots { s.Get() } // BUG — s is a copy
```

Use index: `for i := range slots { slots[i].Get() }`.

---

## Task 9 — `OnceFunc` for graceful shutdown

Use `sync.OnceFunc` (Go 1.21+) to build a shutdown closure that closes a list of `io.Closer`s in reverse order. The closure must be safe to call from a signal handler, an HTTP admin endpoint, and a `defer` in `main`.

**Hints**
- `sync.OnceFunc(func() { ... })` returns the wrapper.
- Iterate the closers in reverse.

**Reference**

```go
package shutdown

import (
    "io"
    "log"
    "sync"
)

func New(closers ...io.Closer) func() {
    return sync.OnceFunc(func() {
        for i := len(closers) - 1; i >= 0; i-- {
            if err := closers[i].Close(); err != nil {
                log.Printf("close error: %v", err)
            }
        }
    })
}

// Use:
// shutdown := New(server, db, file)
// defer shutdown()
// http.HandleFunc("/admin/shutdown", func(...) { shutdown() })
// go func() { <-sigCh; shutdown() }()
```

---

## Task 10 — Implement a tiny `Once` from scratch

Write your own `MyOnce` type with the same behaviour as `sync.Once`. Use only `sync.Mutex` and `sync/atomic`. The fast path must not take the mutex.

**Hints**
- A `uint32` for the done flag.
- A `sync.Mutex` for the slow path.
- Double-check the flag inside the mutex.

**Reference**

```go
package myonce

import (
    "sync"
    "sync/atomic"
)

type MyOnce struct {
    done uint32
    m    sync.Mutex
}

func (o *MyOnce) Do(f func()) {
    if atomic.LoadUint32(&o.done) == 0 {
        o.doSlow(f)
    }
}

func (o *MyOnce) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if atomic.LoadUint32(&o.done) == 0 {
        defer atomic.StoreUint32(&o.done, 1)
        f()
    }
}
```

Compare your version to `src/sync/once.go`. If it does not match line-for-line, you have learned something.

---

## Task 11 — `OnceErr` — `Do` that allows retry on error

`sync.Once` does not retry. Build a `OnceErr` type with a `Do(f func() error) error` method that runs `f` exactly once if `f` returns `nil`, but allows re-running `f` if it returned an error.

**Hints**
- A mutex.
- A `bool succeeded`.
- Inside `Do`: if `succeeded` is true, return `nil`. Otherwise run `f`. If `f` returns `nil`, set `succeeded = true`. Otherwise return the error and stay unset.

**Reference**

```go
package onceerr

import "sync"

type OnceErr struct {
    mu        sync.Mutex
    succeeded bool
}

func (o *OnceErr) Do(f func() error) error {
    o.mu.Lock()
    defer o.mu.Unlock()
    if o.succeeded {
        return nil
    }
    if err := f(); err != nil {
        return err
    }
    o.succeeded = true
    return nil
}
```

Trade-off: no fast path. Every call takes the mutex. If `f` is expensive and the success case is hot, performance is worse than `sync.Once`. For init-or-retry semantics this is the price.

For a fast-path version, replace `succeeded` with `atomic.Uint32` and do a load-then-mutex-then-load dance similar to `Once`.

---

## Task 12 — Lazy thread-safe map

Build a `LazyMap[K comparable, V any]` where `Get(k)` builds and caches the value for `k` using a builder function `f func(K) V`. Each key should be built at most once. Concurrent `Get(k)` for the same `k` should block until the first one finishes.

**Hints**
- A `sync.Map` to store keys to a `*entry`.
- Each `entry` has its own `sync.Once`.

**Reference**

```go
package lazymap

import "sync"

type entry[V any] struct {
    once sync.Once
    val  V
}

type LazyMap[K comparable, V any] struct {
    m sync.Map
    f func(K) V
}

func New[K comparable, V any](f func(K) V) *LazyMap[K, V] {
    return &LazyMap[K, V]{f: f}
}

func (l *LazyMap[K, V]) Get(k K) V {
    e, _ := l.m.LoadOrStore(k, &entry[V]{})
    ent := e.(*entry[V])
    ent.once.Do(func() {
        ent.val = l.f(k)
    })
    return ent.val
}
```

Note: many goroutines may race to `LoadOrStore` the same key. Only one succeeds; the others get the existing `*entry`. They all then call `Do` on that entry's `Once` — only one builds, the rest wait.

---

## Task 13 — `Once` in tests

Write a test helper `SetupDB(t *testing.T)` that spins up a test database the first time it is called in a test binary and reuses it on subsequent calls. The setup must be safe with `t.Parallel()`.

**Hints**
- Package-level `sync.Once` and a `*sql.DB`.
- Register `t.Cleanup` to nothing — the DB lives for the whole test binary.

**Reference**

```go
package dbtest

import (
    "database/sql"
    "sync"
    "testing"
)

var (
    setupOnce sync.Once
    db        *sql.DB
)

func SetupDB(t *testing.T) *sql.DB {
    t.Helper()
    setupOnce.Do(func() {
        var err error
        db, err = sql.Open("sqlite3", ":memory:")
        if err != nil {
            t.Fatal(err)
        }
        if _, err := db.Exec("CREATE TABLE foo(id INT)"); err != nil {
            t.Fatal(err)
        }
    })
    return db
}
```

Tests can call `SetupDB(t)` freely; the first one triggers the build, the rest are no-ops.

---

## Task 14 — Benchmarking `Once` versus `init`

Write a benchmark that measures the overhead of calling a `Once`-protected accessor compared to a directly-initialised package variable. Run both with -benchmem.

**Reference**

```go
package oncebench

import (
    "sync"
    "testing"
)

var (
    eager = "ready"

    lazyOnce sync.Once
    lazy     string
)

func getLazy() string {
    lazyOnce.Do(func() { lazy = "ready" })
    return lazy
}

func BenchmarkEager(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = eager
    }
}

func BenchmarkLazy(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = getLazy()
    }
}
```

Expected: `BenchmarkEager` ~0.5 ns/op; `BenchmarkLazy` ~1.5 ns/op. The `Once` overhead is one atomic load.

---

## Task 15 — Replace `Once` with `atomic.Pointer`

Refactor a `Once`-protected singleton to use `atomic.Pointer[T]`, then benchmark both. Discuss the trade-off.

**Reference**

```go
package compare

import (
    "sync"
    "sync/atomic"
)

type Big struct{ X [1024]int }

// Once version
var (
    once sync.Once
    bigO *Big
)

func GetOnce() *Big {
    once.Do(func() { bigO = &Big{} })
    return bigO
}

// atomic.Pointer version
var bigA atomic.Pointer[Big]

func init() {
    bigA.Store(&Big{})
}

func GetAtomic() *Big {
    return bigA.Load()
}
```

`GetAtomic` is slightly faster on the hot path because it skips the comparison-to-zero in `Once.Do` (the load returns directly). The trade-off: `atomic.Pointer` requires eager init (`init()`); `Once` is lazy. Choose based on whether you ever skip the code path.

---

## Task 16 — Audit a codebase for `Once` misuse

Take any open-source Go project and grep for `sync.Once`. For each occurrence, evaluate:

1. Is the `Once` at package level or inside a struct?
2. Is the function it guards idempotent (could it run twice safely)?
3. Is there error handling? Is retry possible?
4. Could `OnceValue`/`OnceValues` simplify the code?
5. Is the value passed by pointer everywhere?

Write a one-page report. Pick the most interesting finding and submit a PR if appropriate. Real-world `Once` usage varies from "perfect" to "should obviously be `init()`" — train your eye to tell which is which.

---

## Closing notes

These tasks build the muscle memory for `sync.Once`. After completing them you should be able to:

- Spot a Lazy-init pattern and write the `Once` boilerplate in 10 seconds.
- Recognise when `Once` is wrong (retry, reset, per-key) and reach for `singleflight`, `atomic.Pointer`, or mutex-guarded alternatives.
- Write your own `Once`-like primitive when the standard one does not fit (e.g., `OnceErr`).
- Profile and benchmark `Once` versus alternatives, with informed expectations.

Next, the bug-finding page poses programs that look fine but contain subtle `Once` issues. Test your skill.
