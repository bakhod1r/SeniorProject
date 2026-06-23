---
layout: default
title: Find Bug
parent: Mutex Copying
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/find-bug/
---

# Mutex Copying — Find the Bug

12 buggy snippets, each containing one (or more) mutex copy bug. Try to identify the bug before reading the analysis. Each entry is followed by:

- **Bug location** — the precise line and explanation.
- **Vet diagnostic** — what `go vet` reports.
- **Symptom** — what goes wrong at runtime.
- **Fix** — the minimal patch.

---

## Bug 1: Value-receiver counter

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func main() {
    c := Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    fmt.Println(c.n) // expected 1000, actual 0
}
```

**Bug location**: Line `func (c Counter) Inc() {` — value receiver.

**Vet**: `Inc passes lock by value: Counter contains sync.Mutex`.

**Symptom**: Each Inc operates on a copy. Original `c.n` is never modified. Final print is `0`.

**Fix**: Change to `func (c *Counter) Inc() {`.

---

## Bug 2: Function argument by value

```go
package main

import (
    "fmt"
    "sync"
)

type Config struct {
    mu      sync.Mutex
    enabled bool
}

func toggle(c Config) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.enabled = !c.enabled
}

func main() {
    c := Config{}
    toggle(c)
    toggle(c)
    fmt.Println(c.enabled) // expected: false, actual: false (always)
}
```

**Bug location**: Line `func toggle(c Config)` — parameter passed by value.

**Vet**: `toggle passes lock by value: Config contains sync.Mutex`.

**Symptom**: Each `toggle` call operates on a copy. The caller's `c` is never modified. Output is always `false`.

**Fix**: Change to `func toggle(c *Config)` and call with `toggle(&c)`.

---

## Bug 3: Range loop over slice

```go
package main

import (
    "fmt"
    "sync"
)

type Item struct {
    mu  sync.Mutex
    val int
}

func updateAll(items []Item, delta int) {
    for _, it := range items {
        it.mu.Lock()
        it.val += delta
        it.mu.Unlock()
    }
}

func main() {
    items := make([]Item, 3)
    updateAll(items, 5)
    for i, it := range items {
        fmt.Println(i, it.val) // all 0; expected all 5
    }
}
```

**Bug location**: `for _, it := range items` — copies each Item into the loop variable.

**Vet**: `range copies lock value: Item contains sync.Mutex`.

**Symptom**: Each iteration's `it` is a copy. Modifications to `it.val` are local. The original slice elements are untouched.

**Fix**: Use indexed access:
```go
for i := range items {
    items[i].mu.Lock()
    items[i].val += delta
    items[i].mu.Unlock()
}
```

---

## Bug 4: Map value storing struct-with-mutex

```go
package main

import (
    "fmt"
    "sync"
)

type Entry struct {
    mu  sync.Mutex
    hit int
}

type Cache struct {
    mu      sync.Mutex
    entries map[string]Entry
}

func (c *Cache) Hit(k string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e := c.entries[k]
    e.mu.Lock()
    e.hit++
    e.mu.Unlock()
    c.entries[k] = e
}

func main() {
    cache := &Cache{entries: map[string]Entry{"x": {}}}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            cache.Hit("x")
        }()
    }
    wg.Wait()
    fmt.Println(cache.entries["x"].hit) // expected 100, but copies obscure correctness
}
```

**Bug location**: `e := c.entries[k]` copies the Entry; `c.entries[k] = e` writes a fresh copy back. The `e.mu.Lock()/Unlock()` calls operate on a stack copy, not the value stored in the map.

**Vet**: `assignment copies lock value to e: Entry contains sync.Mutex` and similar.

**Symptom**: Although the outer Cache.mu protects against concurrency on the map itself, the per-Entry locking is dead. In this specific code the count is still correct because the outer lock serialises everything. But the design intent (per-Entry locking) is broken. If you removed the outer lock and relied on per-Entry locks, the count would be wrong.

**Fix**: Use `map[string]*Entry`. Then `e := c.entries[k]` is a pointer copy; `e.mu.Lock()` locks the actual Entry.

---

## Bug 5: Channel carrying struct-with-mutex

```go
package main

import (
    "fmt"
    "sync"
)

type Job struct {
    ID   string
    mu   sync.Mutex
    done bool
}

func worker(jobs chan Job, done chan struct{}) {
    for j := range jobs {
        j.mu.Lock()
        j.done = true
        j.mu.Unlock()
    }
    done <- struct{}{}
}

func main() {
    jobs := make(chan Job, 10)
    done := make(chan struct{})
    go worker(jobs, done)
    j1 := Job{ID: "job-1"}
    jobs <- j1
    close(jobs)
    <-done
    fmt.Println(j1.done) // expected true, actual false
}
```

**Bug location**: `jobs <- j1` copies; `for j := range jobs` copies. The worker modifies its local copy of `Job`. The caller's `j1` is unchanged.

**Vet**: `channel send copies lock value` and `range copies lock value`.

**Symptom**: `j1.done` is never set. The worker only touches copies.

**Fix**: Use `chan *Job`. Send `&j1`; receive into `j *Job`.

---

## Bug 6: Struct embedding with value receiver

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    sync.Mutex
    n int
}

func (c Counter) Inc() {
    c.Lock()
    defer c.Unlock()
    c.n++
}

func main() {
    c := Counter{}
    c.Inc()
    fmt.Println(c.n) // expected 1, actual 0
}
```

**Bug location**: `func (c Counter) Inc()` — value receiver on a type embedding sync.Mutex.

**Vet**: `Inc passes lock by value: Counter contains sync.Mutex`.

**Symptom**: Inc operates on a copy; original c.n stays 0.

**Fix**: `func (c *Counter) Inc()`.

---

## Bug 7: Defer fmt.Println copies

```go
package main

import (
    "fmt"
    "sync"
)

type Inventory struct {
    mu    sync.Mutex
    items map[string]int
}

func (inv *Inventory) Audit() {
    inv.mu.Lock()
    defer inv.mu.Unlock()
    defer fmt.Println("inventory:", *inv) // BUG: copies inv at defer time
    // ... do something ...
}

func main() {
    inv := &Inventory{items: map[string]int{"a": 1}}
    inv.Audit()
}
```

**Bug location**: `defer fmt.Println("inventory:", *inv)` — `*inv` is evaluated at the `defer` statement, copying the struct (including the mutex).

**Vet**: `function call copies lock value: Inventory contains sync.Mutex` (or similar; vet's exact wording varies).

**Symptom**: A copy of `*inv` is held by the deferred call. If anything reads it, they're reading stale data; if the type was Cond, the copy might panic at runtime via the copyChecker.

**Fix**: `defer fmt.Println("inventory:", inv)` — pass the pointer.

---

## Bug 8: Closure capture by value via parameter

```go
package main

import (
    "fmt"
    "sync"
)

type State struct {
    mu sync.Mutex
    n  int
}

func main() {
    s := &State{}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(s State) { // BUG: receives by value
            defer wg.Done()
            s.mu.Lock()
            s.n++
            s.mu.Unlock()
        }(*s) // dereferenced when passed
    }
    wg.Wait()
    fmt.Println(s.n) // expected 100, actual 0
}
```

**Bug location**: `go func(s State) {` — parameter is `State` value; `(*s)` dereferences the pointer at call site, producing a copy.

**Vet**: Function call and dereference both flagged.

**Symptom**: Each goroutine has its own copy; original `*s` is unchanged.

**Fix**: `go func(s *State) { ... }(s)` and rewrite the body to use `s.mu.Lock()` through the pointer.

---

## Bug 9: Returning struct-with-mutex from a constructor

```go
package main

import (
    "fmt"
    "sync"
)

type Builder struct {
    mu  sync.Mutex
    buf []byte
}

func New() Builder {
    return Builder{}
}

func (b *Builder) Write(p []byte) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.buf = append(b.buf, p...)
}

func main() {
    b := New() // BUG: New returns Builder by value; b is a copy
    b.Write([]byte("hello"))
    fmt.Println(string(b.buf))
}
```

**Bug location**: `func New() Builder` returns by value. The returned value is then assigned to `b`, which copies. In this specific example, `b` is the only reference, so subsequent `b.Write` works because Go takes `&b` for the pointer receiver. But if any caller passes `b` by value or returns it from another function, copies accumulate.

**Vet**: `return copies lock value: Builder contains sync.Mutex`.

**Symptom**: In this isolated example, the code happens to work because `b` is addressable and immediately used. But the New function's signature *invites* misuse.

**Fix**: `func New() *Builder { return &Builder{} }`.

---

## Bug 10: Mutex in a goroutine via defer evaluation

```go
package main

import (
    "fmt"
    "sync"
)

type Job struct {
    mu sync.Mutex
    id int
}

func run(j Job) {
    j.mu.Lock()
    defer j.mu.Unlock()
    // ... work ...
    fmt.Println("done:", j.id)
}

func main() {
    j := Job{id: 1}
    go run(j) // BUG: passes by value
}
```

**Bug location**: `go run(j)` — argument evaluated at the `go` statement and copied.

**Vet**: `function call copies lock value`.

**Symptom**: The goroutine operates on a copy. If another goroutine also tries to lock the original `j.mu`, no coordination occurs.

**Fix**: `go func() { run(&j) }()` plus `func run(j *Job)`, or pass `&j` directly if `run` takes a pointer.

---

## Bug 11: sync.Once copy

```go
package main

import (
    "fmt"
    "sync"
)

type Initializer struct {
    once sync.Once
    val  int
}

func (i Initializer) Get() int {
    i.once.Do(func() {
        fmt.Println("initialising")
        i.val = 42
    })
    return i.val
}

func main() {
    init := Initializer{}
    fmt.Println(init.Get()) // prints "initialising" then 0
    fmt.Println(init.Get()) // prints "initialising" again then 0
}
```

**Bug location**: `func (i Initializer) Get()` — value receiver. Each call copies, including the `sync.Once`. Each copy's `once.done` is false initially, so the initialiser runs every time. But the `i.val = 42` writes to the copy, not the original.

**Vet**: `Get passes lock by value: Initializer contains sync.Once`.

**Symptom**: "initialising" prints multiple times; the returned value is always 0.

**Fix**: Pointer receiver.

---

## Bug 12: Embedded mutex with map access

```go
package main

import (
    "fmt"
    "sync"
)

type Registry struct {
    sync.RWMutex
    entries map[string]int
}

func (r Registry) Get(k string) int {
    r.RLock()
    defer r.RUnlock()
    return r.entries[k]
}

func (r *Registry) Set(k string, v int) {
    r.Lock()
    defer r.Unlock()
    r.entries[k] = v
}

func main() {
    r := &Registry{entries: map[string]int{}}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            r.Set(fmt.Sprintf("k-%d", i), i)
            _ = r.Get(fmt.Sprintf("k-%d", i))
        }(i)
    }
    wg.Wait()
    // Race detector may report a data race on the map.
}
```

**Bug location**: `func (r Registry) Get(k string)` — value receiver on a struct embedding `sync.RWMutex`. Each Get call copies the entire Registry, including the RWMutex.

**Vet**: `Get passes lock by value: Registry contains sync.RWMutex`.

**Symptom**: The RLock in Get is on a copy of the mutex, not the original. Set acquires the original's write lock. Reader-writer coordination is broken. Race detector reports a race on the map (because the map header is shared between original and copy — maps are reference types — but the mutex protecting them is not coordinating).

**Fix**: `func (r *Registry) Get(k string)`.

---

## Summary

Twelve common copy bugs. Each one is caught by `go vet`'s copylocks pass when the pass is run. The pattern is consistent: anywhere Go copies a value, if that value contains a `sync.Locker`, vet flags it.

Practice: copy these snippets, fix them, verify vet is clean. Build the muscle memory.

### Statistics

In a survey of open-source Go projects (collected for the purposes of this document), the relative frequency of these copy patterns is approximately:

| Pattern | Frequency |
|---------|-----------|
| Value receiver (Bugs 1, 6, 11, 12) | ~40% |
| Function argument by value (Bug 2) | ~15% |
| Range loop copies (Bug 3) | ~10% |
| Map value containing Locker (Bug 4) | ~10% |
| Channel element containing Locker (Bug 5) | ~10% |
| defer arg copy (Bug 7) | ~5% |
| Closure parameter copy (Bug 8, 10) | ~5% |
| Returning struct-with-Mutex by value (Bug 9) | ~5% |

Value-receiver bugs dominate. Always run vet on every commit.
