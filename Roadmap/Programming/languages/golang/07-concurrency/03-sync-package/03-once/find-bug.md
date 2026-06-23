---
layout: default
title: sync.Once — Find the Bug
parent: sync.Once
grand_parent: sync Package
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/find-bug/
---

# sync.Once — Find the Bug

← Back to sync.Once

A graded collection of programs that contain `sync.Once` bugs. Read each, predict the behaviour, then check the analysis. The bugs range from "obvious to a reader who knows the rules" to "production incident that took a day to diagnose."

---

## Bug 1 — The local `Once`

```go
package main

import (
    "fmt"
    "sync"
)

func Setup() {
    var once sync.Once
    once.Do(func() {
        fmt.Println("setup")
    })
}

func main() {
    Setup()
    Setup()
    Setup()
}
```

**Predicted output by author:** `setup` once.
**Actual output:** `setup` three times.

**Why:** `once` is a local variable. Each call to `Setup` creates a fresh `Once`, runs `f`, and discards everything. "Exactly once" was meant across calls but the value's lifetime is per-call.

**Fix:** Move `once` to package level.

```go
var once sync.Once

func Setup() {
    once.Do(func() {
        fmt.Println("setup")
    })
}
```

---

## Bug 2 — Copied struct

```go
package main

import (
    "fmt"
    "sync"
)

type Service struct {
    once sync.Once
    name string
}

func (s Service) Init() { // receiver is a value, not a pointer
    s.once.Do(func() {
        s.name = "loaded"
    })
    fmt.Println(s.name)
}

func main() {
    s := Service{}
    s.Init()
    s.Init()
}
```

**Predicted output:** `loaded` twice.
**Actual output:** empty string both times.

**Why:** `Init` takes `s` by value. Inside `Init`, `s` is a copy. `s.once.Do(...)` operates on the copy's `Once`. The assignment `s.name = "loaded"` writes to the copy's field. When `Init` returns, the copy is discarded. The caller's `s` is unchanged.

`go vet` warns:

```
./main.go:11:8: Init passes lock by value: main.Service contains sync.Once
```

**Fix:** Use a pointer receiver.

```go
func (s *Service) Init() {
    s.once.Do(func() {
        s.name = "loaded"
    })
    fmt.Println(s.name)
}
```

---

## Bug 3 — Retry on error

```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

var (
    once  sync.Once
    val   string
    err   error
)

func Load() (string, error) {
    once.Do(func() {
        val, err = errors.New("transient"), errors.New("transient")
    })
    return val, err
}

func main() {
    for i := 0; i < 3; i++ {
        v, e := Load()
        fmt.Println(i, v, e)
    }
}
```

The author wanted: "If `Load` fails, the next call should retry."
**Actual behaviour:** `Load` returns the same error forever.

**Why:** `Once` does not retry. After the first call, `Once` is done. The captured `err` is the error from the first attempt; every later call returns it unchanged.

**Fix:** Do not use `Once` for retry. Use a mutex-guarded nil check:

```go
var (
    mu  sync.Mutex
    val string
)

func Load() (string, error) {
    mu.Lock()
    defer mu.Unlock()
    if val != "" {
        return val, nil
    }
    v, err := tryLoad()
    if err != nil {
        return "", err
    }
    val = v
    return val, nil
}
```

Now failed attempts can be retried by a subsequent caller.

---

## Bug 4 — `defer once.Do`

```go
package main

import (
    "fmt"
    "sync"
)

var once sync.Once

func handler() {
    defer once.Do(func() {
        fmt.Println("setup")
    })
    fmt.Println("work")
}

func main() {
    handler()
    handler()
}
```

**Predicted output:** "setup" once, "work" twice.
**Actual output:** "work" then "setup" then "work" — the setup runs at the end of the first `handler` call, not at the beginning.

**Why:** `defer` postpones the call until function return. The setup runs at the wrong time (after the work), defeating the lazy-init intent. And because `Once` is in effect, the setup runs only once, but by then the first `handler`'s "work" has already executed without it.

**Fix:** Drop the `defer`.

```go
func handler() {
    once.Do(func() {
        fmt.Println("setup")
    })
    fmt.Println("work")
}
```

---

## Bug 5 — Recursive `Do`

```go
package main

import (
    "fmt"
    "sync"
)

var once sync.Once

func setup() {
    fmt.Println("entering setup")
    once.Do(setup) // recursive call
    fmt.Println("leaving setup")
}

func main() {
    once.Do(setup)
}
```

**Predicted output:** "entering setup" then "leaving setup".
**Actual output:** "entering setup" then a deadlock-detector fatal: `fatal error: all goroutines are asleep - deadlock!`

**Why:** The outer `once.Do(setup)` acquires the mutex inside `Once`. Inside `setup`, the inner `once.Do(setup)` tries to take the same mutex — held by the same goroutine. Deadlock.

**Fix:** Restructure to avoid the recursive call. If `setup` needs to call itself, it does not need a `Once` for the inner call.

---

## Bug 6 — Goroutine inside `f` that outlives `Do`

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

var once sync.Once

func Init() {
    once.Do(func() {
        go func() {
            time.Sleep(100 * time.Millisecond)
            fmt.Println("background ready")
        }()
    })
    fmt.Println("init returned")
}

func main() {
    Init()
    Init()
    time.Sleep(200 * time.Millisecond)
}
```

**Predicted output:** "background ready" once, "init returned" twice.
**Actual output:** Correct order, but the author may have wanted `Init` to wait for "background ready" before returning. It does not.

**Why:** `Once.Do` returns when `f` returns. `f` returned immediately after spawning the goroutine. The goroutine's work is unrelated to `Once`. The second `Init()` call returns instantly; it does not wait for the still-running background work.

**Fix:** Use a `WaitGroup` (or channel) inside `f` to wait for the background work, or restructure so the background work is started after `Init` returns but tracked separately.

```go
func Init() {
    once.Do(func() {
        var wg sync.WaitGroup
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(100 * time.Millisecond)
            fmt.Println("background ready")
        }()
        wg.Wait() // now Do does not return until background is done
    })
}
```

---

## Bug 7 — `Once` in a slice, ranged

```go
package main

import (
    "fmt"
    "sync"
)

type Slot struct {
    once sync.Once
    val  string
}

func main() {
    slots := make([]Slot, 3)
    for i, s := range slots {
        s.once.Do(func() {
            s.val = fmt.Sprintf("slot %d", i)
        })
    }
    for _, s := range slots {
        fmt.Println(s.val) // expected slot 0, slot 1, slot 2
    }
}
```

**Predicted output:** "slot 0", "slot 1", "slot 2".
**Actual output:** three empty strings.

**Why:** The range loop copies `slots[i]` into `s`. `s.once.Do(...)` operates on the copy. The assignment `s.val = ...` writes to the copy. When the loop iteration ends, the copy is discarded. The original `slots[i]` is unchanged.

**Fix:** Index by position.

```go
for i := range slots {
    slots[i].once.Do(func() {
        slots[i].val = fmt.Sprintf("slot %d", i)
    })
}
```

`go vet` catches this too.

---

## Bug 8 — Closure captures loop variable

```go
package main

import (
    "fmt"
    "sync"
)

var onces [3]sync.Once

func main() {
    for i := 0; i < 3; i++ {
        onces[i].Do(func() {
            fmt.Println("slot", i)
        })
    }
}
```

Before Go 1.22:

**Predicted output:** slot 0, slot 1, slot 2.
**Actual output:** slot 3, slot 3, slot 3 — because `i` is captured by reference and is 3 by the time each `Do` runs.

After Go 1.22:

Output is correct because the loop variable is now per-iteration.

**Fix (pre-1.22):** Capture `i` as a parameter.

```go
for i := 0; i < 3; i++ {
    i := i // shadow
    onces[i].Do(func() {
        fmt.Println("slot", i)
    })
}
```

This is a more general goroutines/closure bug, but it surfaces often around `Once`-protected init that depends on iteration state.

---

## Bug 9 — `Once` in a `nil`-able struct

```go
package main

import (
    "fmt"
    "sync"
)

type Service struct {
    once sync.Once
}

func (s *Service) Init() {
    s.once.Do(func() {
        fmt.Println("setup")
    })
}

func main() {
    var s *Service // nil
    s.Init()
}
```

**Predicted output:** "setup".
**Actual output:** panic — nil pointer dereference.

**Why:** `s.once` requires `s` to be non-nil. Even though `Once`'s zero value is usable, the *receiver* must be a valid struct.

**Fix:** Initialise the struct.

```go
s := &Service{}
s.Init()
```

---

## Bug 10 — Panic-then-no-op masks the real problem

```go
package main

import (
    "fmt"
    "sync"
)

var (
    once sync.Once
    val  string
)

func GetValue() string {
    once.Do(func() {
        val = mustLoad() // panics on bad config
    })
    return val
}

func mustLoad() string {
    panic("bad config")
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    fmt.Println(GetValue())
    fmt.Println(GetValue())
}
```

**Output:** `recovered: bad config` then the program continues with `GetValue` returning empty string forever.

**Why:** The first call's `f` panicked. The panic propagated up and was caught by `recover`. But `Once` considers itself done. The second call to `GetValue` skips `f` entirely — it returns the empty `val`. No error is reported; the program runs in a broken state.

This is one of the worst real-world `Once` traps: a transient panic on the first call permanently disables the service.

**Fix:** Either validate config eagerly (use `init()`), or catch the panic inside `f` and surface it:

```go
once.Do(func() {
    defer func() {
        if r := recover(); r != nil {
            val = "" // or set an error flag
        }
    }()
    val = mustLoad()
})
```

Better: in Go 1.21+, use `OnceFunc` / `OnceValues`, which re-panic on every subsequent call so the failure cannot be silently swept under the rug.

---

## Bug 11 — `Once` reset by goroutine

```go
package main

import (
    "fmt"
    "sync"
)

var once sync.Once

func Reset() {
    once = sync.Once{} // races
}

func Setup() {
    once.Do(func() {
        fmt.Println("setup")
    })
}

func main() {
    go Setup()
    Reset()
    Setup()
}
```

**Output (with `-race`):** data race detected.

**Why:** Assigning `once = sync.Once{}` is a write to the `Once` struct. Another goroutine reading `once.done` via `Do` races with it. Even if it "worked," the second `Setup` may or may not see "setup" printed; it depends on timing.

**Fix:** If reset is really required, guard the reset and the read with the same mutex:

```go
var (
    mu   sync.Mutex
    once sync.Once
)

func Reset() {
    mu.Lock()
    defer mu.Unlock()
    once = sync.Once{}
}

func Setup() {
    mu.Lock()
    cur := &once
    mu.Unlock()
    cur.Do(func() { fmt.Println("setup") })
}
```

But really, this is a smell. If you need reset, use `atomic.Pointer` for the value instead of resetting a `Once`.

---

## Bug 12 — Shared `Once` across two unrelated values

```go
package main

import (
    "fmt"
    "sync"
)

var sharedOnce sync.Once

type A struct{}
type B struct{}

func (a *A) Init() {
    sharedOnce.Do(func() {
        fmt.Println("A init")
    })
}

func (b *B) Init() {
    sharedOnce.Do(func() {
        fmt.Println("B init")
    })
}

func main() {
    (&A{}).Init()
    (&B{}).Init()
}
```

**Predicted output:** "A init" then "B init".
**Actual output:** "A init" only.

**Why:** Both `Init` methods share the same `sharedOnce`. The first call (on `A`) marks it done. The second call (on `B`) is a no-op — its function never runs.

The author wanted "each type initialises once." They got "the first type initialises; the second is silently skipped."

**Fix:** Give each type its own `Once`, either as a package-level variable or as a struct field.

```go
var aOnce, bOnce sync.Once

func (a *A) Init() { aOnce.Do(func() { fmt.Println("A init") }) }
func (b *B) Init() { bOnce.Do(func() { fmt.Println("B init") }) }
```

---

## Bug 13 — Read outside `Once.Do`

```go
package main

import (
    "fmt"
    "sync"
)

var (
    once sync.Once
    val  string
)

func main() {
    go once.Do(func() {
        val = "loaded"
    })

    // read in another goroutine without calling Do
    fmt.Println(val)
}
```

**Output (with `-race`):** data race detected.

**Why:** Goroutine A writes `val` inside `f`. Goroutine B (the main goroutine) reads `val` without calling `Do`. There is no synchronisation edge from the write to the read. Even though `Once` would give B the happens-before relation if B *called* `Do`, B did not.

**Fix:** Always read the value through an accessor that itself calls `Do`.

```go
func GetVal() string {
    once.Do(func() {
        val = "loaded"
    })
    return val
}
```

Now the read happens-after the write, even on the fast path.

---

## Bug 14 — Forgetting `defer` on `Done` in a `Once`-protected setup

```go
package main

import (
    "fmt"
    "sync"
)

var (
    once sync.Once
    wg   sync.WaitGroup
)

func Start() {
    once.Do(func() {
        wg.Add(2)
        go func() {
            doWork()
            wg.Done()
        }()
        go func() {
            doWork()
            wg.Done()
        }()
    })
}

func doWork() {
    if cond() {
        panic("oops") // wg.Done() never reached
    }
    fmt.Println("done")
}

func cond() bool { return false }

func main() {
    Start()
    wg.Wait()
}
```

**Bug:** If `doWork` panics, `wg.Done()` does not run. `wg.Wait()` hangs forever.

The `Once` itself is fine — but the goroutines spawned inside `f` have brittle exit logic. This is a common compound bug: `Once` runs once successfully, but the work it kicked off is unreliable.

**Fix:** `defer wg.Done()` at the top of each goroutine.

```go
go func() {
    defer wg.Done()
    doWork()
}()
```

---

## Bug 15 — `Once` and `init()` racing

```go
package main

import (
    "fmt"
    "sync"
)

var (
    once  sync.Once
    cache map[string]string
)

func init() {
    once.Do(func() {
        cache = map[string]string{"foo": "bar"}
    })
}

func Get(k string) string {
    return cache[k]
}

func main() {
    fmt.Println(Get("foo"))
}
```

This "works" but is suspicious. The `Once` is consumed inside `init`. By the time any other goroutine could see the package, `cache` is already populated. The `Once` adds no value; it is unconditionally fired in single-threaded `init`.

**Why it is a "bug":** Misleading code. A reader of `Get` may wonder if `cache` could be nil. Tracing it requires understanding that `init` ran the `Once`. Simpler:

```go
var cache = map[string]string{"foo": "bar"}
```

Or, if construction is conditional, drop `init` and let `Get` do the `Once.Do`. Mixing `init` with `Once` is rarely the right design.

---

## Bug 16 — Loud panic silently swallowed in goroutine

```go
package main

import (
    "sync"
)

var once sync.Once

func main() {
    go func() {
        once.Do(func() {
            panic("nope")
        })
    }()

    select {} // wait forever
}
```

**Output:** the program crashes with the panic.

**Why is this a bug?** Because the author might have thought: "the panic is inside a `Once`, which is inside a goroutine. The goroutine crashing should not crash the program." Wrong. An unrecovered panic in any goroutine terminates the whole process. `Once` does not catch panics; it just stores them as "done."

**Fix:** Always `recover` at the goroutine boundary if the code may panic.

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered:", r)
        }
    }()
    once.Do(func() { panic("nope") })
}()
```

After this, the goroutine dies cleanly. But `Once` is still marked done — subsequent `Do` calls on this `Once` are no-ops.

---

## Bug 17 — `Once` confused with `Once`-per-key

```go
package main

import (
    "fmt"
    "sync"
)

var once sync.Once

func GetUser(id string) string {
    var user string
    once.Do(func() {
        user = fetchUser(id) // only the first id is fetched
    })
    return user
}

func fetchUser(id string) string {
    return "user-" + id
}

func main() {
    fmt.Println(GetUser("1"))
    fmt.Println(GetUser("2"))
    fmt.Println(GetUser("3"))
}
```

**Predicted output:** user-1, user-2, user-3.
**Actual output:** user-1, empty, empty.

**Why:** The `Once` runs only on the first call. After that, `f` is skipped. The local `user` is always the zero value on subsequent calls.

**Fix:** Use `singleflight` for per-key deduplication, or a `sync.Map`-keyed cache. `Once` is for a single global value, not per-input.

```go
import "golang.org/x/sync/singleflight"

var g singleflight.Group

func GetUser(id string) string {
    v, _, _ := g.Do(id, func() (any, error) {
        return fetchUser(id), nil
    })
    return v.(string)
}
```

---

## Bug 18 — `OnceFunc` panic surprise

```go
package main

import (
    "fmt"
    "sync"
)

var f = sync.OnceFunc(func() {
    panic("first call panics")
})

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("outer recover:", r)
        }
    }()
    func() {
        defer func() { recover() }()
        f()
    }()
    fmt.Println("between calls")
    f() // surprise — also panics
}
```

**Predicted output:** "between calls" then normal exit.
**Actual output:** "between calls" then panic, caught by the outer recover.

**Why:** `OnceFunc` re-panics on every subsequent call after a panicking first call. This is different from raw `Once.Do`. The author assumed it would silently no-op. It does not.

**Fix:** Choose the panic semantics deliberately. If silent no-op is wanted, use raw `Once`. If loud panic replay is wanted, use `OnceFunc`. Document the choice.

---

## Bug 19 — Memory leak via captured closure

```go
package main

import (
    "sync"
)

var once sync.Once

func RegisterHandler(huge []byte) {
    once.Do(func() {
        _ = huge[0]
        // does small work; huge is captured by the closure
    })
}
```

If `RegisterHandler` is called with a 100 MB slice, the closure inside `Once` captures it. Even after `Do` returns, the `Once` keeps the closure alive (until 1.21+'s `OnceFunc`-style release is used by raw `Once`, which it is not).

In raw `sync.Once`, the function passed to `Do` is *not* released after the first call. The closure (and its captured state) lives as long as the `Once` value.

**Fix:** Either use `sync.OnceFunc`/`OnceValue` (Go 1.21+, which release the function reference), or avoid capturing large state in the closure:

```go
var stored []byte

func RegisterHandler(huge []byte) {
    once.Do(func() {
        stored = huge // explicit; aware of lifetime
    })
}
```

---

## Bug 20 — A `Once` you can read but cannot trust

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    once sync.Once
    data map[string]int
}

func (c *Cache) Get(k string) int {
    c.once.Do(c.load)
    return c.data[k]
}

func (c *Cache) load() {
    c.data = map[string]int{"a": 1, "b": 2}
}

func main() {
    c := &Cache{}
    fmt.Println(c.Get("a"))

    // someone, somewhere, sets c.data to nil:
    c.data = nil

    fmt.Println(c.Get("a")) // panics: nil map read
}
```

**Why:** `Once` only protects *its own invocation*. It does not protect the underlying `data` map from being mutated later by buggy code. The second call to `Get` re-uses the cached "I already ran" flag and skips `load`, but the field has been clobbered.

**Fix:** Either make `c.data` private and unexported (cannot be reached from outside the package), or use a more defensive design with `atomic.Pointer[map[string]int]` for replaceable state. `Once` is the wrong abstraction if the state is mutable.

---

## Bug 21 — Test cross-contamination

```go
package main

import (
    "sync"
    "testing"
)

var (
    setupOnce sync.Once
    state     int
)

func setup() {
    state = 42
}

func TestA(t *testing.T) {
    setupOnce.Do(setup)
    state = 99 // mutate
}

func TestB(t *testing.T) {
    setupOnce.Do(setup)
    if state != 42 {
        t.Fatalf("want 42, got %d", state)
    }
}
```

**Output:** `TestA` passes; `TestB` fails (state is 99).

**Why:** The `setupOnce` is package-level. `TestA` ran first, ran `setup`, then mutated `state`. `TestB` calls `Do` — it is a no-op (already done). `state` is still 99.

**Fix:** Move `Once` and `state` into a fresh struct per test:

```go
type fixture struct {
    once  sync.Once
    state int
}
func newFixture() *fixture { return &fixture{} }
```

Each test instantiates its own fixture. No cross-contamination.

---

## Bug 22 — `Once` from `Once` in different packages

```go
// package a
var Once sync.Once // exported, BAD design

func Init() { Once.Do(func() { ... }) }

// package b
import "a"

func Reuse() {
    a.Once.Do(func() { ... }) // shares a's done flag
}
```

If `package a` already used `Once`, `package b`'s call is a no-op. If `b` runs first, `a.Init` is a no-op.

**Why is it a bug?** Cross-package mutation of shared state via exported `Once` defeats encapsulation. The two packages are coupled in a way that is impossible to follow without grepping every importer of `a`.

**Fix:** Never export a `sync.Once`. Each package owns its own.

---

## Bug 23 — Pre-warming gone wrong

```go
package main

import (
    "fmt"
    "sync"
)

var once sync.Once

func Init() {
    once.Do(func() {
        fmt.Println("init")
    })
}

func main() {
    Init()      // pre-warm
    go Init()   // concurrent worker
    go Init()
    // ...
}
```

Looks fine. But what if `Init` is renamed to `MaybeInit` and one of the goroutines starts before `MaybeInit` is called from main? Or what if a future refactor moves the pre-warm to a sibling function?

This is not a bug per se, but a fragility. Pre-warming relies on the *order* of calls in `main`. A future maintainer who reorders code may inadvertently lose the pre-warm and introduce a brief first-touch stampede.

**Fix:** Use `init()` for guaranteed pre-warm, not a function call in `main`:

```go
func init() {
    Init() // always runs once, before main
}
```

Now the pre-warm is structural; no `main` ordering required.

---

## Bug 24 — `Once.Do(nil)`

```go
package main

import "sync"

var once sync.Once

func main() {
    once.Do(nil)
}
```

**Predicted:** "does nothing."
**Actual:** panic — nil function dereference.

**Why:** `Do(f)` calls `f`. If `f` is nil, calling it panics. The panic counts as completion; the `Once` is permanently done. Subsequent `Do(realF)` calls are no-ops.

**Fix:** Do not pass nil. Validate before calling.

---

## Bug 25 — Production incident — "init succeeded once, never again"

A real-world story, distilled. A service used `Once` to load TLS certificates on first request. The cert path was wrong in the first deployment. The first request panicked. The panic was recovered in middleware, logged, and the service kept running. Every subsequent request hit the now-done `Once`, saw the nil cert, and returned 500.

The team spent half a day diagnosing because:

- Logs showed "loaded cert" was never printed after the first attempt.
- The cert variable was `nil`, but no one knew why.
- The original panic was buried in old logs.

**Root cause:** `Once`'s "panic counts as done" behaviour combined with middleware that silently swallowed the panic.

**Fix and lessons:**

1. Validate critical config *eagerly* (in `init()` or right after flag parsing).
2. If using `Once`, either capture the error and surface it on every subsequent call, or use `OnceFunc`/`OnceValues` (1.21+) which re-panic.
3. Do not silently recover panics in middleware; at minimum, set a global "service unhealthy" flag.
4. Add a health check that verifies the cert is loaded.

---

## Summary

`sync.Once` bugs cluster into a few categories:

1. **Lifetime mistakes** — Once declared in the wrong scope (Bugs 1, 5, 9).
2. **Copy mistakes** — passing by value (Bugs 2, 7).
3. **Semantic mistakes** — using `Once` for retry, reset, per-key, or with `init` (Bugs 3, 11, 17, 23).
4. **Panic surprises** — silent no-op masks real failures (Bugs 10, 25).
5. **Memory model mistakes** — reading the value outside `Do` (Bug 13).
6. **Closure mistakes** — captured loop variables, memory pinned by `f` (Bugs 8, 19).
7. **Composition mistakes** — goroutines spawned inside `f`, mixed primitives (Bugs 6, 14).

After working through these, you should be able to scan a `sync.Once` usage in code review and spot the most common 80% of bugs at a glance. The remaining 20% are subtle: walk through the lifetime, the goroutine boundaries, and the panic paths every time.
