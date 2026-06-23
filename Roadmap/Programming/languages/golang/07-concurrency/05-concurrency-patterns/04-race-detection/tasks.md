# Race Detection — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end. Every task assumes Go 1.22+ unless stated.

---

## Easy

### Task 1 — Reproduce your first race

Create a file `racy_counter.go`:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var counter int
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

Run it three ways:

1. `go run racy_counter.go` — note the output. Run several times. Record the values.
2. `go run -race racy_counter.go` — confirm the race detector prints `WARNING: DATA RACE`.
3. `GORACE="halt_on_error=1 exitcode=66" go run -race racy_counter.go` — confirm exit code is 66 (`echo $?`).

**Goal.** Feel the difference between a race that produces wrong values silently vs. one detected by `-race`.

---

### Task 2 — Fix Task 1 with a mutex

Modify the counter to use `sync.Mutex`. Run with `-race -count=10` and confirm:

- The output is always `1000`.
- The detector reports no race.

Measure rough timing with `time go run main.go` before and after the fix. The mutex version is slower per operation but correct.

**Goal.** Internalise the mutex Lock/Unlock pattern and observe race-free output.

---

### Task 3 — Fix Task 1 with `sync/atomic`

Replace the mutex version with `atomic.Int64` (or `atomic.AddInt64` on a plain `int64`). Confirm output is `1000` and no race is reported.

Compare the elapsed time of the atomic version against the mutex version using `time`. The atomic version should be slightly faster on contended workloads.

**Goal.** See that single-cell counters are best served by atomics, not mutexes.

---

### Task 4 — Fix Task 1 with channels

Replace the shared counter with a channel:

- Each goroutine sends `1` on a buffered channel.
- A separate aggregator goroutine receives until the channel closes, summing into a local variable.
- After `wg.Wait`, close the channel; after the aggregator returns, print the sum.

Run with `-race`. Confirm correctness and no race.

**Goal.** Practise the "share by communicating" idiom. Notice that no shared variable means no race surface.

---

### Task 5 — Build a race-free counter package

Create a small package `counter` with:

```go
type Counter struct { /* fields */ }

func New() *Counter
func (c *Counter) Inc()
func (c *Counter) Value() int64
```

Internally, use `atomic.Int64`. Write a test that spawns 100 goroutines, each incrementing 100 times, and asserts the total is 10000. Run `go test -race -count=20`.

**Goal.** Practise wrapping an atomic in a clean API. Verify the contract under race testing.

---

## Medium

### Task 6 — Demonstrate the captured loop variable bug

Write a file using Go 1.21 or earlier semantics (or simulate by manually capturing a single var):

```go
//go:build go1.21

package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i)
        }()
    }
    wg.Wait()
}
```

Run with `-race` on Go 1.21. Note that the same `i` is printed multiple times *and* a race is reported.

Then fix it two ways:
1. Shadow: add `i := i` inside the loop.
2. Parameter: `go func(i int) { ... }(i)`.

For Go 1.22+, document that the bug is fixed by language semantics and explain *why*.

**Goal.** Make the captured-loop-variable bug visceral, including the race aspect (not only the logic surprise).

---

### Task 7 — Race-free LRU cache

Build a small LRU cache that is safe for concurrent use:

```go
type LRU struct { /* ... */ }

func NewLRU(capacity int) *LRU
func (l *LRU) Get(key string) (val string, ok bool)
func (l *LRU) Put(key, val string)
```

Constraints:

- Internal data structure: `map[string]*list.Element` plus a `container/list` doubly linked list.
- All public methods are race-safe.
- Eviction happens on `Put` if size exceeds capacity.

Write a test with 50 goroutines doing mixed Get/Put on a 128-entry cache for 10 seconds. Run with `-race -count=10`.

**Goal.** Practise mutex-protected stateful concurrent code. Observe how a simple `sync.Mutex` covers both the map and list invariants — they must move together.

---

### Task 8 — Fix a shared-map race three ways

Start from this racy program:

```go
package main

import "sync"

var m = map[string]int{}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(k string) {
            defer wg.Done()
            m[k] = len(k)
            _ = m[k]
        }(strings.Repeat("x", i+1))
    }
    wg.Wait()
}
```

Produce three race-free versions:

1. Use `sync.RWMutex` around all map accesses.
2. Use `sync.Map`.
3. Use a single writer goroutine receiving from a channel; readers send a request struct over a channel and receive the result.

Compare benchmarks (`go test -bench=.`) for the three versions on a workload of 80% reads, 20% writes.

**Goal.** Build intuition that there are several race-free designs, and the right one depends on the workload.

---

### Task 9 — CI workflow with `-race`

Add a `.github/workflows/test.yml` to a Go project containing:

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }
      - run: go test ./...
      - run: go test -race ./...
        env:
          GORACE: "halt_on_error=1 exitcode=66"
```

Push a deliberate race-introducing commit (e.g., remove a mutex). Confirm the CI job fails with the race report visible in the logs.

Then add a stress-test stage that runs nightly:

```yaml
stress:
  schedule: [{ cron: '0 3 * * *' }]
  steps:
    - run: go test -race -count=100 -timeout=20m ./...
```

**Goal.** Make `-race` a real CI gate, not a local-only habit.

---

### Task 10 — Benchmark race-detector overhead

Pick a non-trivial concurrent test or benchmark in your codebase. Run:

```bash
go test -bench=. -benchmem -run=^$ ./yourpkg/...      # without race
go test -bench=. -benchmem -run=^$ -race ./yourpkg/.. # with race
```

Compare ns/op and B/op. Document the slowdown factor and the memory overhead. Confirm that the slowdown is in the 5x–10x range for CPU and 2x–3x for memory.

If your code is mostly I/O, the slowdown will be smaller; if mostly tight CPU loops, larger.

**Goal.** Build a personal sense of `-race` cost so you can argue informedly when someone asks "should we run this in production?".

---

## Hard

### Task 11 — Build a race that `-race` cannot detect (logic race)

Write a small bank-balance program with a properly mutex-protected `Account.Balance() int` and `Account.Withdraw(amount int) bool`. Spawn many concurrent withdrawers; each does:

```go
if acct.Balance() >= amount {
    acct.Withdraw(amount)
}
```

The check and the withdraw are each individually locked, but the *gap* between them is not. Two goroutines can both observe sufficient balance and both withdraw — overdrafting the account.

- Run with `-race`. Confirm: no data race reported.
- Stress-test with 1000 goroutines and assert balance never goes negative. Show the assertion fires.
- Fix by atomically combining check-and-withdraw inside a single locked region (or by `CompareAndSwap` on an atomic balance).

**Goal.** Internalise that `-race` finds *data races*, not *race conditions*. The fix is logic-aware design, not more locks blindly.

---

### Task 12 — Sharded counter for high contention

Build:

```go
type Sharded struct {
    shards [N]struct {
        _ [56]byte // pad against false sharing
        v atomic.Int64
    }
}

func (s *Sharded) Inc(goroutineID int)
func (s *Sharded) Sum() int64
```

Choose a shard via `goroutineID % N`. Compare under a benchmark with 64 goroutines, each calling Inc tens of millions of times, against:

- A single `atomic.Int64`.
- A single `int64` under `sync.Mutex`.

Plot or tabulate ns/op. The sharded counter should be the fastest under contention. Sum is O(N) but rare.

**Goal.** Apply a real-world technique used in highly concurrent counters (e.g. Prometheus client libraries).

---

### Task 13 — Single-writer pattern (pin to one goroutine)

Build a small in-memory key-value store where:

- All writes go through one dedicated goroutine.
- Reads consult an atomically published snapshot (`atomic.Pointer[map[string]string]`).
- The writer goroutine receives `set(k, v)` and `delete(k)` requests over a channel, builds a *new* map from the current snapshot plus the change, and atomically Stores it.

Readers do `snap := store.Load(); v := snap[k]` — single atomic load, no mutex on the hot path.

Stress-test with 64 reader goroutines and 1 writer goroutine, all running for 10 seconds with `-race`. Assert no race.

**Goal.** Implement the canonical "many readers, one writer" lock-free pattern using `atomic.Pointer`. Note that this works *only* because each map is immutable after Store.

---

### Task 14 — Compare `sync.Map` to `map+RWMutex` empirically

Build two implementations of a thread-safe `map[string]int`:

1. `RWMap` using a single `map[string]int` under a `sync.RWMutex`.
2. `SyncMap` using `sync.Map` with type assertion.

Benchmark each under three workloads:

- 99% read, 1% write — single hot key.
- 99% read, 1% write — uniformly random keys among 10000.
- 50% read, 50% write — uniformly random keys among 10000.

Document where `sync.Map` wins and where `RWMap` wins. Confirm the rule of thumb from middle.md: `sync.Map` shines when each key is mostly written once and read many times.

**Goal.** Develop the muscle to pick the right concurrent map for the workload, not by folklore.

---

### Task 15 — Goroutine leak detector alongside `-race`

Add the [`uber-go/goleak`](https://github.com/uber-go/goleak) package to a small project. Add to a test:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Write a test that intentionally leaks a goroutine (spawn one that blocks on a channel that is never closed). Run `go test -race`. Confirm:

- `-race` does not report a goroutine leak.
- `goleak` reports the leaked goroutine with its stack.

Fix the leak (close the channel or use a context).

**Goal.** Show that race detection and leak detection are complementary tools, not substitutes.

---

## Solutions

### Solution to Task 2 — Mutex counter

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var (
        counter int
        mu      sync.Mutex
    )
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            counter++
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println(counter) // always 1000
}
```

Output under `-race`: `1000`, no warnings.

---

### Solution to Task 3 — Atomic counter

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println(counter.Load())
}
```

Atomic `Add` provides both atomicity and happens-before ordering for the value of `counter`.

---

### Solution to Task 4 — Channel-based counter

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 1024)
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            ch <- 1
        }()
    }
    done := make(chan int)
    go func() {
        sum := 0
        for v := range ch {
            sum += v
        }
        done <- sum
    }()
    wg.Wait()
    close(ch)
    fmt.Println(<-done) // 1000
}
```

The aggregator owns the variable `sum`; no other goroutine reads or writes it. Race-free by construction.

---

### Solution to Task 5 — Counter package

```go
// counter/counter.go
package counter

import "sync/atomic"

type Counter struct {
    v atomic.Int64
}

func New() *Counter         { return &Counter{} }
func (c *Counter) Inc()      { c.v.Add(1) }
func (c *Counter) Value() int64 { return c.v.Load() }
```

```go
// counter/counter_test.go
package counter

import (
    "sync"
    "testing"
)

func TestConcurrent(t *testing.T) {
    c := New()
    var wg sync.WaitGroup
    const goroutines = 100
    const perG = 100
    for i := 0; i < goroutines; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < perG; j++ {
                c.Inc()
            }
        }()
    }
    wg.Wait()
    if got, want := c.Value(), int64(goroutines*perG); got != want {
        t.Fatalf("got %d, want %d", got, want)
    }
}
```

Run with `go test -race -count=20`.

---

### Solution to Task 7 — Race-free LRU

```go
package lru

import (
    "container/list"
    "sync"
)

type entry struct {
    key, val string
}

type LRU struct {
    mu    sync.Mutex
    cap   int
    ll    *list.List
    items map[string]*list.Element
}

func NewLRU(capacity int) *LRU {
    return &LRU{
        cap:   capacity,
        ll:    list.New(),
        items: make(map[string]*list.Element, capacity),
    }
}

func (l *LRU) Get(key string) (string, bool) {
    l.mu.Lock()
    defer l.mu.Unlock()
    if e, ok := l.items[key]; ok {
        l.ll.MoveToFront(e)
        return e.Value.(*entry).val, true
    }
    return "", false
}

func (l *LRU) Put(key, val string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    if e, ok := l.items[key]; ok {
        l.ll.MoveToFront(e)
        e.Value.(*entry).val = val
        return
    }
    e := l.ll.PushFront(&entry{key, val})
    l.items[key] = e
    if l.ll.Len() > l.cap {
        old := l.ll.Back()
        l.ll.Remove(old)
        delete(l.items, old.Value.(*entry).key)
    }
}
```

The whole struct is guarded by one mutex; the map and list invariants stay coherent because they always move together inside the locked region.

---

### Solution to Task 11 — Logic race demo

```go
package bank

import "sync"

type Account struct {
    mu      sync.Mutex
    balance int
}

func (a *Account) Balance() int {
    a.mu.Lock()
    defer a.mu.Unlock()
    return a.balance
}

func (a *Account) Withdraw(amount int) bool {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.balance < amount {
        return false
    }
    a.balance -= amount
    return true
}

// Caller code (the bug):
//   if acct.Balance() >= amount { acct.Withdraw(amount) }
// Two goroutines can both observe balance >= amount and both Withdraw.
```

Fix by collapsing the check and the action under a single Lock:

```go
func (a *Account) WithdrawIfPossible(amount int) bool {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.balance < amount {
        return false
    }
    a.balance -= amount
    return true
}
```

Now `WithdrawIfPossible` is the *atomic operation* the protocol needs. Caller code becomes a single call. The race detector still says nothing — there was never a *data* race — but the program is now correct.

---

### Solution to Task 13 — Single writer with `atomic.Pointer`

```go
package store

import (
    "sync/atomic"
)

type Store struct {
    snap atomic.Pointer[map[string]string]
    ops  chan op
}

type op struct {
    key, val string
    del      bool
    done     chan struct{}
}

func New() *Store {
    s := &Store{ops: make(chan op, 1024)}
    init := map[string]string{}
    s.snap.Store(&init)
    go s.writer()
    return s
}

func (s *Store) writer() {
    for o := range s.ops {
        cur := *s.snap.Load()
        next := make(map[string]string, len(cur)+1)
        for k, v := range cur {
            next[k] = v
        }
        if o.del {
            delete(next, o.key)
        } else {
            next[o.key] = o.val
        }
        s.snap.Store(&next)
        close(o.done)
    }
}

func (s *Store) Get(k string) (string, bool) {
    v, ok := (*s.snap.Load())[k]
    return v, ok
}

func (s *Store) Set(k, v string) {
    done := make(chan struct{})
    s.ops <- op{key: k, val: v, done: done}
    <-done
}

func (s *Store) Delete(k string) {
    done := make(chan struct{})
    s.ops <- op{key: k, del: true, done: done}
    <-done
}
```

Reader hot path: one atomic load and a map read. No mutex, no contention.

The trade-off: every Set/Delete copies the map. Use this pattern when reads vastly outnumber writes (config, feature flags, routing tables).

---

### Solution to Task 12 — Sharded counter

```go
package shard

import (
    "runtime"
    "sync/atomic"
)

const cacheLine = 64

type Sharded struct {
    shards []paddedCounter
}

type paddedCounter struct {
    v atomic.Int64
    _ [cacheLine - 8]byte
}

func New() *Sharded {
    n := runtime.GOMAXPROCS(0)
    return &Sharded{shards: make([]paddedCounter, n)}
}

func (s *Sharded) Inc(id int) {
    s.shards[id%len(s.shards)].v.Add(1)
}

func (s *Sharded) Sum() int64 {
    var total int64
    for i := range s.shards {
        total += s.shards[i].v.Load()
    }
    return total
}
```

Padding to a cache line eliminates *false sharing*: two CPU cores writing different `atomic.Int64`s that happen to live in the same cache line bounce the line back and forth and lose all the speed gains. Pad each counter so each lives alone in its cache line.

Benchmarks under heavy contention typically show: single atomic ≈ 60ns/op, mutex ≈ 90ns/op, sharded with 8 shards ≈ 8ns/op (almost linear scaling).

---

## Self-Assessment

After completing tasks 1-15 you should be able to:

- [ ] Reproduce a counter race and read the report.
- [ ] Fix a race three ways (mutex, atomic, channel) and pick the right one for a workload.
- [ ] Distinguish data race from race condition in code review.
- [ ] Build a race-free stateful container (LRU) and stress-test it under `-race`.
- [ ] Build a sharded counter and explain false sharing.
- [ ] Build a single-writer / many-readers store using `atomic.Pointer`.
- [ ] Set up a CI gate that fails on race reports.
- [ ] Quantify race-detector overhead on your own benchmarks.
- [ ] Combine `-race` with `goleak` for orthogonal coverage.

If any box is unchecked, redo the corresponding task. Race detection is one of the few areas in Go where reading the manual cannot replace running the code.
