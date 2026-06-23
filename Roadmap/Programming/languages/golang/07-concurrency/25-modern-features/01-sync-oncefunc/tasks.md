---
layout: default
title: sync.OnceFunc — Tasks
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/tasks/
---

# sync.OnceFunc — Tasks

[← Back](../)

## Task 1 — Rewrite a sync.Once usage as OnceFunc

You are handed this code:

```go
package logger

import (
    "log/slog"
    "os"
    "sync"
)

var (
    initOnce sync.Once
    logger   *slog.Logger
)

func Get() *slog.Logger {
    initOnce.Do(func() {
        f, err := os.OpenFile("/var/log/app.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
        if err != nil {
            panic(err)
        }
        logger = slog.New(slog.NewJSONHandler(f, nil))
    })
    return logger
}
```

Rewrite it using `sync.OnceValue` so that:

- There is no package-level `*slog.Logger` variable.
- There is no `sync.Once` variable.
- The `Get` function returns the same logger every call.
- A panic in initialization still propagates.

Expected solution:

```go
package logger

import (
    "log/slog"
    "os"
    "sync"
)

var Get = sync.OnceValue(func() *slog.Logger {
    f, err := os.OpenFile("/var/log/app.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
    if err != nil {
        panic(err)
    }
    return slog.New(slog.NewJSONHandler(f, nil))
})
```

`Get` is now a `func() *slog.Logger` value, called the same way (`logger.Get()`).

## Task 2 — Build a lazy config loader

Write a package `config` that exposes `Load() (*Config, error)` where:

- `Config` is `struct{ DSN string; Workers int }`.
- The first call reads `CONFIG_DSN` and `CONFIG_WORKERS` from the environment, parses `Workers` as an int, and returns a `(*Config, error)`.
- Every subsequent call returns the *exact same* `(*Config, error)` pair without re-reading the environment.
- Concurrent calls are safe.

Solution:

```go
package config

import (
    "fmt"
    "os"
    "strconv"
    "sync"
)

type Config struct {
    DSN     string
    Workers int
}

var Load = sync.OnceValues(func() (*Config, error) {
    dsn := os.Getenv("CONFIG_DSN")
    if dsn == "" {
        return nil, fmt.Errorf("CONFIG_DSN is empty")
    }
    workers, err := strconv.Atoi(os.Getenv("CONFIG_WORKERS"))
    if err != nil {
        return nil, fmt.Errorf("CONFIG_WORKERS: %w", err)
    }
    return &Config{DSN: dsn, Workers: workers}, nil
})
```

Test it with two goroutines that both call `Load()` and confirm both get the same `*Config` pointer:

```go
func TestLoadOnce(t *testing.T) {
    os.Setenv("CONFIG_DSN", "postgres://x")
    os.Setenv("CONFIG_WORKERS", "4")
    var wg sync.WaitGroup
    var a, b *Config
    wg.Add(2)
    go func() { defer wg.Done(); a, _ = Load() }()
    go func() { defer wg.Done(); b, _ = Load() }()
    wg.Wait()
    if a != b {
        t.Fatalf("expected same pointer, got %p and %p", a, b)
    }
}
```

## Task 3 — Observe panic-reuse behavior

Write a program that:

1. Wraps a function that panics with `"boom"` using `sync.OnceFunc`.
2. Calls the wrapper from three goroutines.
3. Each goroutine catches its panic with `recover` and prints the value.
4. Verifies that all three goroutines print `"boom"`.

Solution:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    wrapped := sync.OnceFunc(func() {
        panic("boom")
    })
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            defer func() {
                if r := recover(); r != nil {
                    fmt.Printf("goroutine %d recovered: %v\n", i, r)
                }
            }()
            wrapped()
        }(i)
    }
    wg.Wait()
}
```

Expected output (order will vary):

```
goroutine 1 recovered: boom
goroutine 2 recovered: boom
goroutine 0 recovered: boom
```

Compare this to the same program with `sync.Once.Do`: two of the three goroutines will print nothing, because after the first panic the `Once` is consumed and later `Do` calls return silently.

## Task 4 — Idempotent close

You have a `Connection` struct with a `Close()` method that must be safe to call any number of times. Implement it using `sync.OnceFunc`.

```go
package conn

import (
    "fmt"
    "sync"
)

type Connection struct {
    name  string
    close func()
}

func New(name string) *Connection {
    c := &Connection{name: name}
    c.close = sync.OnceFunc(func() {
        fmt.Printf("closing %s\n", c.name)
        // ...release resources...
    })
    return c
}

func (c *Connection) Close() { c.close() }
```

Test:

```go
func TestCloseIdempotent(t *testing.T) {
    c := New("alpha")
    c.Close()
    c.Close()
    c.Close()
    // Should print "closing alpha" exactly once.
}
```

Run it under `go test -race` to confirm concurrent `Close` calls do not race.

## Task 5 — Replace three sync.Once patterns in a file

Find the file in your own codebase (or any open-source Go 1.21+ project) and identify three usages of `sync.Once`. For each one, decide:

- Is the wrapped function value-producing? (Then it should be `OnceValue` or `OnceValues`.)
- Is it side-effect only? (Then `OnceFunc`.)
- Is the panic-on-second-call contract better, worse, or irrelevant?
- After replacing, does any unused state at package scope go away?

Write up the three rewrites side-by-side. The point is to internalize the pattern through real code, not toy examples.

## Task 6 — Confirm GC of captured state

Demonstrate that after a successful `sync.OnceValue` call, the wrapped function's captured state is collected. Use `runtime.SetFinalizer`:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

type Big struct{ buf [1 << 20]byte } // 1 MiB

func main() {
    big := &Big{}
    runtime.SetFinalizer(big, func(*Big) {
        fmt.Println("big collected")
    })

    load := sync.OnceValue(func() int {
        // big is captured here; OnceValue drops the closure after success.
        return len(big.buf)
    })
    fmt.Println("len:", load())
    big = nil

    runtime.GC()
    runtime.GC()
    fmt.Println("done")
}
```

Expected output:

```
len: 1048576
big collected
done
```

If you replace `sync.OnceValue` with a hand-rolled `sync.Once` that keeps the closure captured indefinitely, the finalizer never runs.

## Task 7 — Lazy compiled regex with a feature flag

Write a function `ValidateEmail(addr string) bool` that:

- Uses a moderately complex email regex compiled lazily with `sync.OnceValue`.
- Returns `true` for valid email addresses, `false` for invalid.
- If a global `featureFlagEmailValidation` is `false`, returns `true` unconditionally and *does not* compile the regex.

Solution:

```go
package validator

import (
    "regexp"
    "sync"
)

var featureFlagEmailValidation = true

var emailRx = sync.OnceValue(func() *regexp.Regexp {
    return regexp.MustCompile(`^[\w.+-]+@[\w-]+\.[\w.-]+$`)
})

func ValidateEmail(addr string) bool {
    if !featureFlagEmailValidation {
        return true
    }
    return emailRx().MatchString(addr)
}
```

The regex is compiled only when the flag is on *and* `ValidateEmail` is actually called. If the flag is off across the entire run, the regex is never compiled.

## Task 8 — OnceFunc-based shutdown coordination

Write a small program with:

- A `shutdown` function wrapped in `sync.OnceFunc` that prints "flushing logs", "closing connections", "goodbye".
- A signal handler goroutine that calls `shutdown` on `SIGINT`.
- A deferred call to `shutdown` from `main`.
- Verify that on Ctrl+C, the shutdown messages print exactly once (and not twice — once from the signal handler, once from the deferred call).

Solution:

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

var shutdown = sync.OnceFunc(func() {
    fmt.Println("flushing logs")
    fmt.Println("closing connections")
    fmt.Println("goodbye")
})

func main() {
    defer shutdown()

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
    go func() {
        <-sigs
        shutdown()
        os.Exit(0)
    }()

    fmt.Println("running; press Ctrl+C")
    time.Sleep(30 * time.Second)
}
```

Run it, press Ctrl+C, observe that the three shutdown messages print exactly once.

## Task 9 — Convert a struct method using sync.Once

Given:

```go
type Server struct {
    cfgOnce sync.Once
    cfg     *Config
    cfgErr  error
}

func (s *Server) Config() (*Config, error) {
    s.cfgOnce.Do(func() {
        s.cfg, s.cfgErr = loadServerConfig()
    })
    return s.cfg, s.cfgErr
}
```

Rewrite `Server` so that there is no `sync.Once` field and no `cfgErr` field — only a wrapper function.

Solution:

```go
type Server struct {
    config func() (*Config, error)
}

func NewServer() *Server {
    s := &Server{}
    s.config = sync.OnceValues(loadServerConfig)
    return s
}

func (s *Server) Config() (*Config, error) { return s.config() }
```

`Config` is now a method that delegates to the wrapper. The struct has one field instead of three.

## Task 10 — Verify the GC reclaims the loader closure

Write a benchmark that:

- Creates a `sync.OnceValue` wrapping a closure that captures a 10 MiB byte slice.
- Calls the wrapper.
- Forces GC.
- Reads memory stats and verifies the 10 MiB is freed.

Skeleton:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var m1, m2 runtime.MemStats

    buf := make([]byte, 10<<20)
    load := sync.OnceValue(func() int {
        return len(buf)
    })

    runtime.GC()
    runtime.ReadMemStats(&m1)

    fmt.Println("loaded:", load())
    buf = nil

    runtime.GC()
    runtime.GC()
    runtime.ReadMemStats(&m2)

    fmt.Printf("HeapAlloc before: %d KB\n", m1.HeapAlloc/1024)
    fmt.Printf("HeapAlloc after:  %d KB\n", m2.HeapAlloc/1024)
}
```

You should see the "after" HeapAlloc significantly lower than "before" — the closure's reference to `buf` was dropped after `load()` succeeded.
