---
layout: default
title: sync.OnceFunc — Junior
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/junior/
---

# sync.OnceFunc — Junior

[← Back](../)

## The problem these helpers solve

Sometimes you want a piece of code to run *exactly once*, no matter how many goroutines try to trigger it and no matter how many times each goroutine calls in. Three classic examples:

- Opening a log file the first time anything wants to log.
- Parsing a config file lazily, on the first call to any function that needs the config.
- Closing a network connection — every call to `Close()` after the first should be a no-op.

All three are variants of the same problem: "run this initialization exactly once, then keep handing out the result".

Before Go 1.21 you wrote this with `sync.Once`. After Go 1.21 you almost never need to type `sync.Once` again — there are three small helpers (`sync.OnceFunc`, `sync.OnceValue`, `sync.OnceValues`) that capture the pattern more directly. This page is about understanding the old pattern, why it was awkward, and how the new helpers replace it.

## The old way: sync.Once

Here is the canonical pre-1.21 lazy logger:

```go
package logger

import (
    "log"
    "os"
    "sync"
)

var (
    initOnce sync.Once
    logger   *log.Logger
)

func Get() *log.Logger {
    initOnce.Do(func() {
        f, err := os.OpenFile("/tmp/app.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
        if err != nil {
            panic(err)
        }
        logger = log.New(f, "", log.LstdFlags)
    })
    return logger
}
```

Let me count the moving parts:

1. A `sync.Once` value at package scope, just to track whether init has happened.
2. A `*log.Logger` value at package scope, to hold the result.
3. A `Get` function that hides both.
4. A closure passed to `initOnce.Do` that does the actual work.

Four pieces of state for one idea ("a logger that is created on first use"). The closure inside `Do` cannot return anything — `Do` ignores return values — so the only way to communicate the result back is to assign it to the package-level `logger` variable.

This works. It is correct. It has been the standard Go pattern for a decade. But it is verbose, and there are two specific footguns worth pointing out before showing the replacement.

### Footgun 1 — sync.Once.Do does not return anything

The signature of `Once.Do` is `func (o *Once) Do(f func())`. The wrapped function has signature `func()`. No arguments, no return. If you want to compute a value, you must use a side effect:

```go
var (
    loadOnce sync.Once
    config   *Config
    loadErr  error
)

func Load() (*Config, error) {
    loadOnce.Do(func() {
        config, loadErr = parseConfig() // assign to package vars
    })
    return config, loadErr
}
```

You end up with three package-level variables — the `Once`, the result, and the error — instead of one accessor function. Every developer reading the file has to track all four pieces.

### Footgun 2 — sync.Once.Do on panic

If `f` panics inside `Do`, the `Once` is *consumed* — internally it has already been marked as "done" before `f` runs. So the panic propagates to the first caller, but every subsequent caller of `Do` sees the `Once` as done and returns immediately, as if everything had worked.

```go
var once sync.Once
var x int

func init1() {
    once.Do(func() { panic("boom") })
}

func init2() {
    once.Do(func() { x = 42 }) // never runs
}
```

If goroutine A calls `init1` and panics, then goroutine B calls `init2`, goroutine B's function is silently skipped — `x` stays zero. This is rarely what you want for a real initializer.

## The new way: sync.OnceFunc, OnceValue, OnceValues

Go 1.21 added three functions to the `sync` package:

```go
func OnceFunc(f func()) func()
func OnceValue[T any](f func() T) func() T
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)
```

Each one takes a function and returns a wrapped function. The wrapper:

- Runs the wrapped function at most once, no matter how many calls or goroutines.
- Caches and returns the wrapped function's return value(s), for `OnceValue` and `OnceValues`.
- Re-panics with the same value on every subsequent call, if the wrapped function panicked.
- Drops its reference to the wrapped function after a successful first call, so any state it captured can be garbage-collected.

Rewriting the lazy logger:

```go
package logger

import (
    "log"
    "os"
    "sync"
)

var Get = sync.OnceValue(func() *log.Logger {
    f, err := os.OpenFile("/tmp/app.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
    if err != nil {
        panic(err)
    }
    return log.New(f, "", log.LstdFlags)
})
```

That's it. `Get` is now a function value of type `func() *log.Logger`. Callers use `logger.Get()` exactly as before. There is no `sync.Once`, no package-level `logger` variable, no separate `Get` function. One variable, one closure, done.

## Three flavors, three shapes

Each helper is for a different return-value shape:

| Helper | Wrapped signature | Wrapper signature | Use when |
|--------|-------------------|-------------------|----------|
| `sync.OnceFunc` | `func()` | `func()` | The work has side effects but produces nothing to cache (close a file, send a metric, fire a one-shot signal). |
| `sync.OnceValue` | `func() T` | `func() T` | The work produces a single value and you want every caller to receive that same value (lazy config, compiled regex, opened resource). |
| `sync.OnceValues` | `func() (T1, T2)` | `func() (T1, T2)` | The work produces a `(value, error)` pair, the most common Go idiom for fallible initialization. |

There is no `OnceValues3` for three return values. The proposal authors decided that three-or-more return signatures are rare enough that callers can pack them into a struct and use `OnceValue[Struct]`.

## A first runnable example

Let's run something concrete. Save this as `main.go`:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    greet := sync.OnceFunc(func() {
        fmt.Println("hello, world")
    })

    for i := 0; i < 5; i++ {
        greet()
    }
}
```

Running it (`go run main.go`):

```
hello, world
```

The closure printed once. Calls 2 through 5 just returned without doing anything.

Now let's do the same with `OnceValue`:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    expensive := sync.OnceValue(func() int {
        fmt.Println("computing...")
        time.Sleep(500 * time.Millisecond)
        return 42
    })

    for i := 0; i < 3; i++ {
        fmt.Println("got", expensive())
    }
}
```

Output:

```
computing...
got 42
got 42
got 42
```

The first call to `expensive()` prints `computing...` and sleeps for 500 ms before returning 42. The next two calls return immediately with the cached 42.

And `OnceValues`:

```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

func main() {
    open := sync.OnceValues(func() (string, error) {
        fmt.Println("opening connection")
        return "conn://abc", nil
    })

    for i := 0; i < 3; i++ {
        conn, err := open()
        if err != nil {
            fmt.Println("error:", err)
            return
        }
        fmt.Println("conn:", conn)
    }
    _ = errors.New
}
```

Output:

```
opening connection
conn: conn://abc
conn: conn://abc
conn: conn://abc
```

Same shape — one print of "opening connection", three returns of `("conn://abc", nil)`.

## Comparison side by side

Old:

```go
var (
    once  sync.Once
    cfg   *Config
    cfgErr error
)

func Load() (*Config, error) {
    once.Do(func() {
        cfg, cfgErr = parseConfig()
    })
    return cfg, cfgErr
}
```

New:

```go
var Load = sync.OnceValues(parseConfig)
```

(Where `parseConfig` has signature `func() (*Config, error)`.) Three package variables and an accessor become a single variable that *is* the accessor.

## Why "drop the captured function" matters

When you wrap a closure with `sync.OnceValue`, the closure can reference local variables, parameters, large data structures. As long as the wrapper is alive, anything the closure references is kept alive too. That would be bad — you'd be holding onto build-time scratch data forever.

The implementation deals with this by setting its internal pointer to the closure to `nil` after a successful first call. The closure becomes unreachable; everything it captured (other than the return value) becomes garbage-collectable.

Demonstration with a finalizer:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

type Big struct {
    buf [1 << 20]byte // 1 MiB
}

func main() {
    big := &Big{}
    runtime.SetFinalizer(big, func(*Big) {
        fmt.Println("big collected")
    })

    load := sync.OnceValue(func() int {
        return len(big.buf) // captures big
    })

    fmt.Println("len:", load())
    big = nil

    runtime.GC()
    runtime.GC()
    fmt.Println("done")
}
```

Output (on a Go 1.21+ build):

```
len: 1048576
big collected
done
```

After `load()` returned, the closure was discarded inside the wrapper, the only other reference (`big` in `main`) was set to nil, and the GC was free to collect the 1 MiB struct.

If you had used a hand-rolled `sync.Once` that kept the closure forever, the finalizer would never run and the 1 MiB would leak for the process lifetime. This is a real benefit, not a microbenchmark trick — `OnceValue` makes lazy loaders cleaner *and* less leaky.

## The panic story

Take this code:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    bad := sync.OnceFunc(func() {
        panic("boom")
    })

    for i := 0; i < 3; i++ {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    fmt.Println("call", i, "recovered:", r)
                }
            }()
            bad()
        }()
    }
}
```

Output:

```
call 0 recovered: boom
call 1 recovered: boom
call 2 recovered: boom
```

Every call to `bad()` panics with the value `"boom"`. The first panic carries a stack trace into the user's function; later panics carry a stack trace into the wrapper. But the value is identical.

Compare to `sync.Once`:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var once sync.Once
    bad := func() {
        once.Do(func() {
            panic("boom")
        })
    }

    for i := 0; i < 3; i++ {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    fmt.Println("call", i, "recovered:", r)
                }
            }()
            bad()
        }()
    }
}
```

Output:

```
call 0 recovered: boom
```

Only the first call panicked. Calls 1 and 2 hit `once.Do`, saw that the `Once` was already marked done, and returned silently. This is the footgun mentioned earlier: a panicking initializer fails for the first caller and *silently succeeds* for everybody else.

For real code, the `OnceFunc` behavior is almost always what you want. If your config file is corrupted, you want every caller that asks for the config to know that — not for them to receive a nil pointer because the first caller already crashed.

## Concurrent safety

You can call the wrapper from any number of goroutines simultaneously. The very first one to reach the wrapper triggers the wrapped function; all others block until that first one returns; then everybody returns at once with the cached value.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    load := sync.OnceValue(func() int {
        fmt.Println("loading...")
        time.Sleep(200 * time.Millisecond)
        return 7
    })

    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            v := load()
            fmt.Println("goroutine", i, "got", v)
        }(i)
    }
    wg.Wait()
}
```

Output (order of goroutine prints will vary):

```
loading...
goroutine 0 got 7
goroutine 4 got 7
goroutine 1 got 7
goroutine 2 got 7
goroutine 3 got 7
```

There is exactly one `loading...` line. The five goroutines either ran the loader (one of them) or blocked on the internal `sync.Once` (the other four). After the 200 ms wait, all five received the same value.

## When to use each helper

A quick decision tree:

- "I just want to run code once, no result." → `OnceFunc`.
- "I want one value." → `OnceValue`.
- "I want a value and an error." → `OnceValues`.
- "I want more than two values." → Pack into a struct, use `OnceValue[Struct]`.
- "I want to retry on failure." → None of these. Use a `sync.Mutex` + manual flag, or a different pattern entirely.
- "I want to reset and run again later." → None of these. Same.

## Common patterns

### Idempotent Close

A struct that holds a resource, with `Close()` safe to call multiple times:

```go
type Conn struct {
    raw   io.Closer
    close func() error
}

func NewConn(raw io.Closer) *Conn {
    c := &Conn{raw: raw}
    c.close = sync.OnceValue(func() error {
        return c.raw.Close()
    })
    return c
}

func (c *Conn) Close() error { return c.close() }
```

`Conn.Close()` runs `raw.Close()` exactly once. Subsequent calls return the same error (which is `nil` for a successful close). No `sync.Once` field on the struct, no separate `closeErr` field.

### Lazy config

A package whose config is computed on first access:

```go
package settings

import (
    "encoding/json"
    "os"
    "sync"
)

type Settings struct {
    Port int    `json:"port"`
    Host string `json:"host"`
}

var Load = sync.OnceValues(func() (*Settings, error) {
    data, err := os.ReadFile("/etc/app/settings.json")
    if err != nil {
        return nil, err
    }
    var s Settings
    if err := json.Unmarshal(data, &s); err != nil {
        return nil, err
    }
    return &s, nil
})
```

Callers say `settings.Load()` and get `(*Settings, error)`. The file is read at most once.

### Compiled-regex cache

```go
var emailRx = sync.OnceValue(func() *regexp.Regexp {
    return regexp.MustCompile(`^[\w.+-]+@[\w-]+\.[\w.-]+$`)
})

func ValidEmail(s string) bool {
    return emailRx().MatchString(s)
}
```

This is slightly more useful than `var emailRx = regexp.MustCompile(...)` because it defers compilation until the first call to `ValidEmail`. For a simple regex the saving is microseconds. For a complex one with hundreds of alternations, it can be milliseconds — paid only if the feature is used.

### One-shot shutdown

```go
var shutdown = sync.OnceFunc(func() {
    fmt.Println("flushing logs")
    fmt.Println("closing DB pool")
    fmt.Println("done")
})

func main() {
    defer shutdown()

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
    go func() {
        <-sigs
        shutdown()
        os.Exit(0)
    }()

    serve()
}
```

If the process receives `SIGTERM`, the signal handler calls `shutdown` and `os.Exit(0)`. If the process returns from `main` normally, the deferred `shutdown` runs. Either path, `shutdown` runs exactly once.

## Things you should not do

### Don't recreate the wrapper inside a function that runs more than once

```go
func handler(w http.ResponseWriter, r *http.Request) {
    init := sync.OnceFunc(setup)
    init()
    // ...
}
```

Every HTTP request creates a brand-new `OnceFunc`. Each new wrapper runs `setup` exactly once — but there is a new wrapper per request, so `setup` actually runs on every request. The `OnceFunc` is not magic; it doesn't deduplicate across calls of the surrounding function. The wrapper must be created exactly once, typically at package scope or as a struct field initialized in a constructor.

### Don't try to retry on error

If `parseConfig` fails, you want a retry, right?

```go
var Load = sync.OnceValues(func() (*Config, error) {
    return parseConfig()
})

func main() {
    for i := 0; i < 3; i++ {
        cfg, err := Load()
        if err != nil {
            time.Sleep(time.Second)
            continue
        }
        use(cfg)
        break
    }
}
```

This does *not* retry. The first call ran `parseConfig`, got `(nil, err)`, cached that pair, and returned. Calls 2 and 3 return the same `(nil, err)` without calling `parseConfig` again. If you need retry, use a `sync.Mutex` and a retry loop, or — even simpler — handle retries inside the wrapped function.

### Don't reset by reassigning

```go
var Load = sync.OnceValue(...)

func Reload() {
    Load = sync.OnceValue(...)
}
```

This is a race: goroutines reading `Load` while `Reload` writes to it form a data race on the function-value slot, and even with synchronization, callers that copied `Load` into a local variable still see the old cached value forever. Don't use these helpers for anything that needs reloading.

## Reading the source

The implementation in `src/sync/oncefunc.go` is short and worth reading once. The full `OnceFunc`:

```go
func OnceFunc(f func()) func() {
    var (
        once  Once
        valid bool
        p     any
    )
    g := func() {
        defer func() {
            p = recover()
            if !valid {
                panic(p)
            }
        }()
        f()
        f = nil
        valid = true
    }
    return func() {
        once.Do(g)
        if !valid {
            panic(p)
        }
    }
}
```

The key lines:

- `f()` runs the user's function.
- `f = nil` drops the reference *after* `f` returns successfully.
- `valid = true` records success.
- The deferred recover captures any panic value into `p`.
- The outer wrapper rechecks `valid` after `once.Do` — if init failed, every call re-panics with `p`.

`OnceValue` and `OnceValues` differ only in that they capture and return one or two values respectively. The bookkeeping is identical.

## Summary

- `sync.Once` is still in the language and still works. You just rarely have a reason to type it.
- For a side-effect-only one-shot operation, use `sync.OnceFunc`.
- For a single cached value, use `sync.OnceValue`.
- For a `(value, error)` pair, use `sync.OnceValues`.
- Define the wrapper once (package variable or struct field), not per call.
- Don't expect retry on failure — panic-on-second-call (or cached-error-forever) is the contract.
- The wrapper is safe to call from any number of goroutines.
- After a successful first call, the wrapped closure is dropped so its captures can be GC'd.

If you find yourself writing `var foo sync.Once` in new Go 1.21+ code, stop and ask whether one of these three helpers does the same job in one variable. Almost always, the answer is yes.

## Detail: what "exactly once" really means

There's a subtle distinction worth absorbing. "Exactly once" in the context of `sync.OnceFunc` means "the wrapped function `f` is invoked exactly once across all callers of the wrapper, ever". It does *not* mean "the wrapper itself runs exactly once" — the wrapper can run a billion times, it just only invokes `f` on the very first call.

Here's a small experiment to make that concrete:

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var inner int64
    var outer int64

    wrapped := sync.OnceFunc(func() {
        atomic.AddInt64(&inner, 1)
    })

    for i := 0; i < 1000; i++ {
        wrapped()
        atomic.AddInt64(&outer, 1)
    }

    fmt.Println("inner:", inner)
    fmt.Println("outer:", outer)
}
```

Output:

```
inner: 1
outer: 1000
```

The wrapped closure incremented `inner` exactly once. The outer loop incremented `outer` 1000 times, calling the wrapper each iteration. The wrapper itself ran 1000 times; the wrapped closure ran once.

This is the same shape as the underlying `sync.Once`: `once.Do(f)` can be called any number of times; `f` is invoked exactly once.

## Detail: what counts as "the first call"?

If two goroutines call the wrapper simultaneously, exactly one of them — the runtime picks — will be the goroutine that executes `f`. The other one blocks on the internal `sync.Once`. When the first goroutine returns from `f`, both goroutines complete their wrapper call.

This is important for understanding panic semantics. The first call — the one that actually executes `f` — is the one whose stack trace is preserved when `f` panics. The other concurrent caller, even if it entered the wrapper at almost the same time, gets the "re-panic with cached value" path.

You should not write code that depends on which goroutine wins the race. It is undefined which one starts `f`. All you are promised is that `f` runs once and that all callers observe the result.

## Detail: zero values vs uninitialized

A subtle point about `OnceValue`. The wrapper closure has a captured slot of type `T` to store the result. Until the first call, that slot holds the zero value of `T`. After the first call, it holds the value returned by `f`.

This matters because, from the outside, you cannot tell whether a `sync.OnceValue` wrapper has been called yet. There's no `IsInitialized()` method, no `Reset()`, no way to inspect state. The wrapper is opaque: a `func() T` that you call, and that's it.

If you need to know whether the underlying init has happened, you're using the wrong primitive. Use a `sync.Mutex` + an explicit `bool`.

## Detail: the wrapper closure captures `T` by value

When `OnceValue` stores the result, it stores the actual value, not a pointer to it. So:

```go
type Big struct {
    data [4096]byte
}

var get = sync.OnceValue(func() Big {
    return Big{}
})
```

Every call to `get()` returns a fresh copy of the 4 KiB struct. The wrapper holds one canonical copy internally; each call returns a value-copy out. For large structs this is wasteful — you almost always want `*Big`:

```go
var get = sync.OnceValue(func() *Big {
    return &Big{}
})
```

Now every call returns the same 8-byte pointer. Callers share the underlying struct (which is fine for read-only data — config, regex, lookup tables).

If you accidentally let two callers mutate the same returned `*Big`, you have a data race. The OnceValue layer does nothing to protect the *contents* of `*Big` — only the initialization is synchronized. Treat the returned pointer as immutable, or wrap the struct in your own synchronization.

## Detail: closures vs named functions

Both work:

```go
// Named function:
func loadConfig() *Config { /* ... */ }
var Load = sync.OnceValue(loadConfig)

// Closure:
var Load = sync.OnceValue(func() *Config {
    return &Config{Port: 8080}
})
```

When you pass a closure, it can capture local variables from the surrounding scope. When you pass a named function, it does not capture anything from `sync.OnceValue`'s caller — it has access only to package-level state and its arguments (which is zero, since the wrapped function takes no arguments).

A common mistake is to wrap a *method* instead of a *function*:

```go
type Service struct {
    cfg *Config
}

func (s *Service) loadConfig() *Config { /* ... */ }

func NewService() *Service {
    s := &Service{}
    s.cfg = sync.OnceValue(s.loadConfig)() // compiles, but...
    return s
}
```

The line `sync.OnceValue(s.loadConfig)` works because Go method values are functions that have the receiver bound. But notice the `()` at the end — it immediately calls the wrapper. That doesn't "lazy-init"; it eagerly inits at construction. To get lazy init, store the wrapper:

```go
type Service struct {
    loadCfg func() *Config
}

func NewService() *Service {
    s := &Service{}
    s.loadCfg = sync.OnceValue(s.loadConfigImpl)
    return s
}

func (s *Service) loadConfigImpl() *Config { /* ... */ }

func (s *Service) Config() *Config { return s.loadCfg() }
```

Now `Service.Config()` is the public accessor and `loadConfigImpl` runs on the first call to `Config()`.

## A look at common signatures you'll convert

When porting old code, you'll meet these shapes most often:

### Shape A: `Once.Do` with no result

Before:

```go
var initOnce sync.Once

func ensureInit() {
    initOnce.Do(func() {
        registerMetrics()
        startReporter()
    })
}
```

After:

```go
var ensureInit = sync.OnceFunc(func() {
    registerMetrics()
    startReporter()
})
```

### Shape B: `Once.Do` storing one value

Before:

```go
var (
    onceLogger sync.Once
    logger     *Logger
)

func L() *Logger {
    onceLogger.Do(func() {
        logger = newLogger()
    })
    return logger
}
```

After:

```go
var L = sync.OnceValue(newLogger)
```

### Shape C: `Once.Do` storing a value and an error

Before:

```go
var (
    onceDB sync.Once
    db     *sql.DB
    dbErr  error
)

func DB() (*sql.DB, error) {
    onceDB.Do(func() {
        db, dbErr = sql.Open("postgres", "...")
    })
    return db, dbErr
}
```

After:

```go
var DB = sync.OnceValues(func() (*sql.DB, error) {
    return sql.Open("postgres", "...")
})
```

### Shape D: `Once.Do` inside a method, per-instance

Before:

```go
type Service struct {
    initOnce sync.Once
    pool     *Pool
}

func (s *Service) Pool() *Pool {
    s.initOnce.Do(func() {
        s.pool = newPool()
    })
    return s.pool
}
```

After:

```go
type Service struct {
    pool func() *Pool
}

func NewService() *Service {
    s := &Service{}
    s.pool = sync.OnceValue(newPool)
    return s
}

func (s *Service) Pool() *Pool { return s.pool() }
```

### Shape E: idempotent close

Before:

```go
type Conn struct {
    closeOnce sync.Once
    closeErr  error
    raw       net.Conn
}

func (c *Conn) Close() error {
    c.closeOnce.Do(func() {
        c.closeErr = c.raw.Close()
    })
    return c.closeErr
}
```

After:

```go
type Conn struct {
    close func() error
    raw   net.Conn
}

func NewConn(raw net.Conn) *Conn {
    c := &Conn{raw: raw}
    c.close = sync.OnceValue(func() error {
        return c.raw.Close()
    })
    return c
}

func (c *Conn) Close() error { return c.close() }
```

In every "after" version, the struct or package has one fewer field, and the accessor function shrinks to a one-liner.

## Detail: what about init() functions?

You might wonder, "if I want to do something lazily at package load, why not just use Go's `init()` function?" Two reasons:

1. `init()` runs *eagerly*, every time the program starts, whether or not the package's lazy resource is actually used. `sync.OnceValue` is lazy — it runs on first use.
2. `init()` runs before `main`, but you cannot give it parameters and you cannot make it return values. Anything it sets up must live in a package variable.

If your initialization is cheap and always needed (compiling a small regex, building a lookup map of 10 entries), `var rx = regexp.MustCompile(...)` at package scope is the simplest answer — Go runs that during package init.

If your initialization is expensive, conditional, or might panic, `sync.OnceValue` defers it to actual usage and lets you handle the panic at the call site.

## Detail: comparison with sync.Once and atomic.Bool

You might be tempted to "do it yourself" with `atomic.Bool`:

```go
var (
    inited atomic.Bool
    value  int
)

func Get() int {
    if !inited.Load() {
        if inited.CompareAndSwap(false, true) {
            value = compute()
        }
        // else: someone else is computing; ???
    }
    return value
}
```

This is broken. If goroutine A wins the CAS and starts computing, goroutine B reads `inited == true` but `value` is still zero — A hasn't finished writing it yet. There's no happens-before relationship.

Neither `sync.Once` nor `sync.OnceFunc` have this problem — they internally use a mutex (or a more careful sequence of atomics) to ensure callers observe the completed value. Don't try to recreate them with raw atomics.

## Detail: the wrapper as a value

The wrapper is a regular `func()` (or `func() T`, or `func() (T1, T2)`) value. You can:

- Pass it as an argument.
- Store it in a struct field.
- Store it in a map.
- Compare it for nil-ness (`if load == nil`).

You cannot:

- Compare two wrappers for equality. (Go does not let you compare function values for equality, period.)
- "Reset" the wrapper. Once it's been called and returned, the cache is locked.

A useful idiom is to make the wrapper a *factory parameter*:

```go
type Worker struct {
    loadConfig func() *Config
}

func NewWorker(loadConfig func() *Config) *Worker {
    return &Worker{loadConfig: loadConfig}
}

// In production:
w := NewWorker(sync.OnceValue(realLoadConfig))

// In tests:
w := NewWorker(func() *Config { return &Config{Port: 9999} })
```

The production worker gets cached lazy loading. The test worker gets a plain function that returns a fixed config. The `Worker` doesn't know or care which it has — it just calls `loadConfig()`.

## Detail: works fine across packages

The wrapper is just a function value; it can be exported, imported, passed around freely. A common style:

```go
// package settings
var Load = sync.OnceValues(loadFromDisk)

// package main
import "myapp/settings"

func main() {
    cfg, err := settings.Load()
    // ...
}
```

`settings.Load` is the lazy loader. Every caller, in every package, calls `settings.Load()`. Together they invoke `loadFromDisk` exactly once.

## Detail: testing code that uses these helpers

A package-level `var Load = sync.OnceValue(...)` is hard to test because the cache survives across tests in the same test binary. Two common approaches:

### Approach 1 — Inject the wrapper

Don't make `Load` a package var. Make it a parameter to whatever uses it:

```go
type Server struct {
    load func() *Config
}

func New(load func() *Config) *Server { return &Server{load: load} }
```

In production:

```go
s := New(sync.OnceValue(realLoad))
```

In tests:

```go
s := New(func() *Config { return testConfig })
```

Each test creates its own `*Server`, with its own (or no) caching.

### Approach 2 — Don't test the cache layer at all

The cache layer is two lines and trivially correct. Test the wrapped function directly:

```go
func TestRealLoad(t *testing.T) {
    cfg, err := realLoad()
    // ...
}
```

You don't need to test that `sync.OnceValue` returns the cached value — that's the stdlib's job.

## Detail: composition with other primitives

You can combine `sync.OnceValue` with other concurrency tools:

```go
// Lazy WaitGroup-based parallel init:
var loadAll = sync.OnceValue(func() (*Config, *Tables, error) {
    var wg sync.WaitGroup
    var cfg *Config
    var tbl *Tables
    var errC, errT error

    wg.Add(2)
    go func() { defer wg.Done(); cfg, errC = loadConfig() }()
    go func() { defer wg.Done(); tbl, errT = loadTables() }()
    wg.Wait()

    if errC != nil {
        return nil, nil, errC
    }
    if errT != nil {
        return nil, nil, errT
    }
    return cfg, tbl, nil
})
```

Note that this returns three values — too many for `OnceValues`. The workaround is to repack into a struct or use `OnceValue[*struct{...}]`.

## Detail: how it relates to the Go memory model

The Go memory model has an explicit clause for `sync.Once.Do`: the completion of `f` is synchronized before the return of every subsequent call. Since `sync.OnceFunc` is implemented in terms of `sync.Once.Do`, the same guarantee transfers: every call to the wrapper observes the effects of `f` as if `f` had completed before the call.

In practical terms: if `f` writes to some shared memory and the wrapper is called afterward, the read of that memory is safe — no separate atomic or mutex is required.

```go
var (
    setup = sync.OnceFunc(func() {
        globalConfig = parseConfig() // assignment to package var
    })
)

func handler(...) {
    setup()
    use(globalConfig) // safe — happens-after the write inside setup
}
```

You can rely on this without thinking about it, but it's worth knowing it exists when reading code that does similar tricks.

## A worked example: lazy DB pool with everything

Let's pull every concept together into one realistic example. A package that:

- Lazily opens a database connection on first use.
- Returns the same pool to every caller.
- Reports an error if opening fails.
- Has an idempotent `Close()` that waits for the lazy init to finish before closing.

```go
package store

import (
    "database/sql"
    "fmt"
    "sync"

    _ "github.com/lib/pq"
)

type Store struct {
    dsn   string
    open  func() (*sql.DB, error)
    close func() error
    db    *sql.DB
}

func New(dsn string) *Store {
    s := &Store{dsn: dsn}

    s.open = sync.OnceValues(func() (*sql.DB, error) {
        db, err := sql.Open("postgres", s.dsn)
        if err != nil {
            return nil, fmt.Errorf("open: %w", err)
        }
        if err := db.Ping(); err != nil {
            db.Close()
            return nil, fmt.Errorf("ping: %w", err)
        }
        s.db = db
        return db, nil
    })

    s.close = sync.OnceValue(func() error {
        // Force the open call to finish before we close.
        _, _ = s.open()
        if s.db == nil {
            return nil // open never succeeded; nothing to close
        }
        return s.db.Close()
    })

    return s
}

func (s *Store) DB() (*sql.DB, error) { return s.open() }
func (s *Store) Close() error          { return s.close() }
```

Notable details:

- `s.open` is captured as a closure that uses `s.dsn`. The wrapper holds onto `s.open`'s body only until it succeeds; after that, the body is dropped (the wrapper closure inside `OnceValues` sets its `f` to nil). The captured `s.dsn` string would still live, indirectly, but it's tiny.
- `s.close` triggers `s.open` before closing. If `Close()` is called before any `DB()`, this forces the lazy open and then immediately closes — which is the safe behavior if you want `Close` to release whatever was opened.
- Both `DB()` and `Close()` are safe under concurrent calls.

The same logic with raw `sync.Once` would be twice as long and would need to keep a separate `dbErr` field and an `openOnce`/`closeOnce` pair plus a `closeErr` field. Five extra fields for the same behavior.

## Another worked example: lazy global rate limiter

```go
package ratelimit

import (
    "context"
    "sync"
    "time"

    "golang.org/x/time/rate"
)

var Limiter = sync.OnceValue(func() *rate.Limiter {
    return rate.NewLimiter(rate.Every(100*time.Millisecond), 10)
})

func Allow(ctx context.Context) error {
    return Limiter().Wait(ctx)
}
```

A package-level lazy limiter. The limiter is constructed on the first call to `Allow`. Every subsequent call uses the same limiter. There is no `init()` function (so the limiter is not built if the package is imported but never used), no `sync.Once` variable, no separate `var lim *rate.Limiter`.

## Frequently asked beginner questions

**Q: Can I write `sync.OnceFunc(myFunc)` and just throw away the return value?**

No — well, you can, but it does nothing useful. `sync.OnceFunc` doesn't *run* the function; it returns a wrapper. If you throw the wrapper away, you have no way to call it. You always have to store the wrapper somewhere.

**Q: Does the wrapped function run when I call `sync.OnceValue(f)` (the constructor), or only on first call to the wrapper?**

Only on the first call to the wrapper. Construction is cheap — it just sets up the internal state. The actual work of `f` is deferred to whenever the wrapper is first invoked.

**Q: Can I use `sync.OnceFunc` with a function that takes arguments?**

Not directly — `OnceFunc` accepts `func()`. To pass arguments, capture them in a closure:

```go
load := sync.OnceValue(func() *Config {
    return loadFromPath("/etc/app/config.json") // path captured by closure
})
```

The arguments are fixed at the time you build the wrapper. There's no way to pass different arguments to different calls — they'd all collapse to the same single execution anyway.

**Q: What if I want to pass arguments to the wrapper itself?**

You can't, by design. "Run exactly once with these arguments" is ambiguous when multiple callers pass different arguments. If you need that, you want `singleflight.Group.Do`, not `sync.OnceFunc`.

**Q: Is there a way to clear the cache and force re-init?**

No. The wrapper has no reset. If you need that, use a `sync.Mutex` + a `bool` flag yourself.

**Q: Can I nest `sync.OnceValue` calls?**

You can, but it's almost always wrong. If `f` inside `OnceValue` itself calls another `OnceValue`-wrapped function, that's fine — they're independent caches. But if you wrap a wrapper (`sync.OnceValue(sync.OnceValue(f))`), the outer one wraps the *construction* of the inner one, which doesn't do what you'd expect. Just use one wrapper.

**Q: Performance impact?**

A wrapper allocates a small closure (~64 bytes) once at construction. Each subsequent call does one atomic load + one indirect call + one branch — under 2 ns on modern hardware. Compared to the work most wrapped functions do, this is invisible.

## Practice problems

Try these without looking back at the page:

1. Write a function `Memoize(f func() int) func() int` that returns a function that runs `f` exactly once and caches the result. Use `sync.OnceValue`.
2. Write a `type Server struct` whose `Close() error` is safe to call any number of times. Use `sync.OnceValue[error]` for the underlying close.
3. Write a `LoadOrFail` package-level function that reads `/etc/myapp/config.json`, parses it as JSON into a `Config`, and panics on any error. Subsequent calls should return the same `*Config`. Use `sync.OnceValue[*Config]`.
4. Demonstrate that calling a `sync.OnceFunc`-wrapped panicking function from three goroutines causes all three to recover the same panic value.
5. Replace this old code with the new helpers:

   ```go
   var (
       dbOnce sync.Once
       db     *sql.DB
       dbErr  error
   )

   func DB() (*sql.DB, error) {
       dbOnce.Do(func() {
           db, dbErr = sql.Open("postgres", dsn)
       })
       return db, dbErr
   }
   ```

6. Write a test that verifies your `Memoize` from problem 1 calls the underlying `f` exactly once even when invoked from 100 concurrent goroutines.

Solutions in [tasks.md](tasks.md).
