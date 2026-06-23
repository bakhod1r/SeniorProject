---
layout: default
title: Sequential Consistency — Find the Bug
parent: Sequential Consistency
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/03-sequential-consistency/find-bug/
---

# Sequential Consistency — Find the Bug

Bug-finding exercises focused on memory-model violations and SC-related issues. Each exercise shows code with a subtle bug; identify it and propose a fix.

---

## Bug 1: The Hanging Loop

```go
package main

import (
    "fmt"
    "time"
)

var ready bool

func main() {
    go func() {
        time.Sleep(10 * time.Millisecond)
        ready = true
    }()
    for !ready {
    }
    fmt.Println("ready!")
}
```

**Bug:** `ready` is a plain bool. The compiler may hoist the read out of the loop, causing the goroutine to spin forever.

**Fix:** Use `atomic.Bool`:

```go
var ready atomic.Bool
// ...
ready.Store(true)
// ...
for !ready.Load() { }
```

---

## Bug 2: The Lost Increment

```go
package main

import (
    "fmt"
    "sync"
)

var counter int

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++
        }()
    }
    wg.Wait()
    fmt.Println(counter)
}
```

**Bug:** `counter++` is read-modify-write, not atomic. Concurrent goroutines lose increments.

**Fix:** Use `atomic.Int64`:

```go
var counter atomic.Int64
counter.Add(1)
fmt.Println(counter.Load())
```

---

## Bug 3: The Half-Constructed Pointer

```go
package main

import (
    "fmt"
    "sync/atomic"
)

type Config struct {
    A int
    B int
}

var cfg atomic.Pointer[Config]

func init() {
    c := &Config{}
    cfg.Store(c)
    c.A = 1
    c.B = 2
}

func main() {
    if c := cfg.Load(); c != nil {
        fmt.Println(c.A, c.B)
    }
}
```

**Bug:** Setting fields after `cfg.Store(c)` is a race with any reader of `c.A` or `c.B`.

**Fix:** Set fields before Store:

```go
c := &Config{A: 1, B: 2}
cfg.Store(c)
```

---

## Bug 4: The Mixed Access

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var counter int64

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&counter, 1)
        }()
    }
    wg.Wait()
    fmt.Println(counter) // plain read of atomic-written variable
}
```

**Bug:** The `fmt.Println(counter)` reads `counter` plainly. After `wg.Wait()`, this is technically safe (Wait synchronises with Done), but mixing atomic writes with plain reads is fragile and the race detector may flag inconsistent treatment.

**Fix:** Use atomic everywhere:

```go
fmt.Println(atomic.LoadInt64(&counter))
// or, with typed API:
var counter atomic.Int64
counter.Add(1)
fmt.Println(counter.Load())
```

---

## Bug 5: The Copying Atomic

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Counter struct {
    n atomic.Int64
}

func work(c Counter) {
    c.n.Add(1) // operates on a copy
}

func main() {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            work(c)
        }()
    }
    wg.Wait()
    fmt.Println(c.n.Load()) // always 0
}
```

**Bug:** Passing `c` by value copies the atomic. The increments are on copies.

**Fix:** Pass by pointer:

```go
func work(c *Counter) {
    c.n.Add(1)
}
// ...
work(&c)
```

---

## Bug 6: The Mutated Published Pointer

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Item struct{ Name string }

var current atomic.Pointer[Item]

func setName(s string) {
    if i := current.Load(); i != nil {
        i.Name = s // RACE
    }
}

func main() {
    current.Store(&Item{Name: "initial"})
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            setName(fmt.Sprintf("name-%d", i))
        }()
    }
    wg.Wait()
    fmt.Println(current.Load().Name)
}
```

**Bug:** Mutating the pointed-to struct after publication races with other goroutines.

**Fix:** Swap pointers:

```go
func setName(s string) {
    n := &Item{Name: s}
    current.Store(n)
}
```

---

## Bug 7: The Time-Based Sync

```go
package main

import (
    "fmt"
    "time"
)

var data int

func main() {
    go func() {
        data = 42
    }()
    time.Sleep(time.Millisecond)
    fmt.Println(data)
}
```

**Bug:** `time.Sleep` is not a memory barrier. The write may not be visible.

**Fix:** Use a synchronisation primitive:

```go
done := make(chan struct{})
go func() {
    data = 42
    close(done)
}()
<-done
fmt.Println(data)
```

---

## Bug 8: The False-Shared Counters

```go
package main

import (
    "sync"
    "sync/atomic"
)

type Stats struct {
    A atomic.Int64
    B atomic.Int64
    C atomic.Int64
    D atomic.Int64
}

func main() {
    var s Stats
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000000; j++ {
                switch i {
                case 0: s.A.Add(1)
                case 1: s.B.Add(1)
                case 2: s.C.Add(1)
                case 3: s.D.Add(1)
                }
            }
        }()
    }
    wg.Wait()
}
```

**Bug:** All four fields fit in one cache line. Concurrent updates cause false sharing; performance plateaus.

**Fix:** Pad to cache lines:

```go
type Stats struct {
    A atomic.Int64; _ [56]byte
    B atomic.Int64; _ [56]byte
    C atomic.Int64; _ [56]byte
    D atomic.Int64; _ [56]byte
}
```

---

## Bug 9: The Singleton Race

```go
package main

import (
    "sync"
)

type Singleton struct{ Name string }

var instance *Singleton
var mu sync.Mutex

func Get() *Singleton {
    if instance == nil { // RACE
        mu.Lock()
        defer mu.Unlock()
        if instance == nil {
            instance = &Singleton{Name: "default"}
        }
    }
    return instance
}
```

**Bug:** First `if instance == nil` is racy with the write `instance = ...`.

**Fix:** Use `atomic.Pointer[T]`:

```go
var instance atomic.Pointer[Singleton]

func Get() *Singleton {
    if s := instance.Load(); s != nil {
        return s
    }
    mu.Lock()
    defer mu.Unlock()
    if s := instance.Load(); s != nil {
        return s
    }
    s := &Singleton{Name: "default"}
    instance.Store(s)
    return s
}
```

---

## Bug 10: The Atomic-of-Plain

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var done bool

func main() {
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        atomic.StoreInt32((*int32)(unsafe.Pointer(&done)), 1) // unsafe cast
    }()
    go func() {
        defer wg.Done()
        for !done {
        }
    }()
    wg.Wait()
    fmt.Println("done")
}
```

**Bug:** Storing via atomic but reading via plain. The race detector will flag (the loop reads `done` plainly). Also, `bool` is not `int32`; the cast is fragile.

**Fix:** Use `atomic.Bool`:

```go
var done atomic.Bool
done.Store(true)
for !done.Load() {}
```

---

## Bug 11: The Sneaky Map Race

```go
package main

import "sync"

var cache = map[string]string{}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            cache[fmt.Sprint(i)] = fmt.Sprint(i * 2)
        }()
    }
    wg.Wait()
}
```

**Bug:** Built-in maps are not concurrent-safe.

**Fix:** Use `sync.Map` or a mutex-protected map:

```go
var cache sync.Map
// ...
cache.Store(fmt.Sprint(i), fmt.Sprint(i*2))
```

---

## Bug 12: The Wait Group Misuse

```go
package main

import "sync"

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        go func() {
            wg.Add(1) // BUG: Add inside goroutine
            defer wg.Done()
            // work
        }()
    }
    wg.Wait()
}
```

**Bug:** `Add` is called inside the goroutine. `Wait` may run before any `Add`, returning immediately.

**Fix:** `Add` before `go`:

```go
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        // work
    }()
}
wg.Wait()
```

---

## Bug 13: The Spin Without Yield

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

func main() {
    var ready atomic.Bool
    go func() {
        time.Sleep(time.Second)
        ready.Store(true)
    }()
    for !ready.Load() {
        // tight spin
    }
    fmt.Println("ready")
}
```

**Bug:** The tight spin wastes CPU and may starve the producer goroutine.

**Fix:** Add `runtime.Gosched` or use a channel:

```go
for !ready.Load() {
    runtime.Gosched()
}
```

---

## Bug 14: The Closed-Channel Panic

```go
package main

import "sync"

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            close(ch) // RACE / panic
        }()
    }
    wg.Wait()
}
```

**Bug:** Multiple goroutines closing the same channel cause a panic.

**Fix:** Use `sync.Once`:

```go
var once sync.Once
once.Do(func() { close(ch) })
```

---

## Bug 15: The Stale Field After Publish

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type State struct {
    Step int
    Msg  string
}

var cur atomic.Pointer[State]

func main() {
    s := &State{}
    cur.Store(s)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        s.Step = 1
        s.Msg = "hello"
    }()
    wg.Wait()
    fmt.Println(cur.Load().Msg)
}
```

**Bug:** Storing the pointer before populating the fields. Concurrent readers may see partial state.

**Fix:** Build the struct first, then Store:

```go
s := &State{Step: 1, Msg: "hello"}
cur.Store(s)
```

---

## Bug 16: The Forgotten Mutex

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    return c.m[k] // missing lock
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
}

func main() {
    c := &Cache{m: map[string]string{}}
    // concurrent Get/Set races
    _ = c
    fmt.Println("done")
}
```

**Bug:** `Get` doesn't lock; races with `Set`.

**Fix:** Lock in `Get` too, or use `sync.RWMutex` with RLock.

---

## Bug 17: The Loop Variable

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i) // captures loop variable
        }()
    }
    wg.Wait()
}
```

**Bug:** Pre-Go 1.22, `i` is shared across iterations; goroutines may all print the same value.

**Fix:** Use Go 1.22+ semantics (each iteration has its own variable), or shadow explicitly:

```go
for i := 0; i < 10; i++ {
    i := i
    go func() {
        defer wg.Done()
        fmt.Println(i)
    }()
}
```

---

## Bug 18: The Channel Reuse

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch)
    ch <- 1 // panic: send on closed channel
    fmt.Println("done")
}
```

**Bug:** Sending on a closed channel panics.

**Fix:** Don't reuse closed channels. Use sync.Once for one-shot close. Use new channel for new use.

---

## Bug 19: The Nil-Check Race

```go
package main

import "sync/atomic"

type Service struct{}

var svc *Service

func init() {
    svc = &Service{}
}

func use() {
    if svc != nil { // racy if svc could be reassigned
        // do something
    }
}
```

**Bug:** If `svc` is reassigned by another goroutine, the nil-check races.

**Fix:** Use `atomic.Pointer[Service]`:

```go
var svc atomic.Pointer[Service]

func init() { svc.Store(&Service{}) }
func use() {
    if s := svc.Load(); s != nil {
        // use s
    }
}
```

---

## Bug 20: The Order-of-Operations

```go
package main

import (
    "fmt"
    "sync/atomic"
)

type State struct {
    Counter atomic.Int64
    Done    atomic.Bool
}

func writer(s *State) {
    s.Counter.Add(1)
    s.Done.Store(true)
}

func reader(s *State) {
    if s.Done.Load() {
        fmt.Println(s.Counter.Load())
    }
}
```

**Bug:** None — this is correct. The SC ordering ensures `Counter.Add` happens-before `Done.Store`, and the reader's `Done.Load == true` implies it sees the post-Add counter.

This is a "no bug" example. Important to recognise correct code.

---

## Closing

These 20 bugs cover the spectrum of common SC-related issues. Each is real; each has been seen in production code.

For each bug:
1. Run with `-race`.
2. Identify the violation.
3. Apply the fix.
4. Re-test.

Mastering bug-finding is the practical skill of senior Go engineers.

End.
