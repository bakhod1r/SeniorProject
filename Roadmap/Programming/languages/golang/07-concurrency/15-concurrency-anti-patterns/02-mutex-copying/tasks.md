---
layout: default
title: Tasks
parent: Mutex Copying
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/tasks/
---

# Mutex Copying — Hands-on Tasks

18 graded exercises. Each task includes a problem statement, success criteria, and (where applicable) starter code. Work through them in order; later tasks build on earlier ones.

---

## Task 1: Build a thread-safe counter

**Goal**: Implement a `Counter` type that supports `Inc`, `Add(n int64)`, `Load`, and `Reset`. The type must not be copyable.

**Constraints**:
- All methods must be safe for concurrent use.
- `go vet` must flag any copy attempt.
- Provide a constructor `NewCounter() *Counter`.
- Use either `sync.Mutex` or `atomic.Int64` internally.

**Success criteria**:
- Test: spawn 1000 goroutines, each calling `Inc` 1000 times. After joining, `Load` returns exactly 1000000.
- `go vet ./...` is clean.
- `go test -race ./...` is clean.

**Starter**:
```go
package counter

// TODO: define Counter type
// TODO: implement Inc, Add, Load, Reset, NewCounter
```

---

## Task 2: Audit a struct for copy hazards

**Goal**: You are given a struct with multiple fields. Identify which fields cause vet's copylocks pass to flag the struct, and propose fixes.

**Code**:
```go
type Service struct {
    mu       sync.Mutex
    cache    map[string]int
    wg       sync.WaitGroup
    once     sync.Once
    log      *log.Logger
    requests chan Request
    config   atomic.Pointer[Config]
}
```

**Tasks**:
1. List which fields are Locker-containing (and therefore make `Service` non-copyable).
2. Write a `func use(s Service)` and observe vet's diagnostic.
3. Write a `func use(s *Service)` and observe vet is silent.
4. Add `noCopy` documentation to `Service`.

**Success criteria**: Correct identification of `mu`, `wg`, `once`, and `config` as Locker-containing. The pointer-parameter version is vet-clean.

---

## Task 3: Write a vet linter rule (custom analysis)

**Goal**: Write a custom `golang.org/x/tools/go/analysis` pass that flags any function whose name starts with "New" but returns a value type that contains a `sync.Mutex`. (The convention is to return pointers.)

**Skeleton**:
```go
package nopointerconstructor

import (
    "go/ast"
    "go/types"
    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "nopointerconstructor",
    Doc:      "reports New* functions returning struct-with-Mutex by value",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    inspect := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    // TODO: visit FuncDecl nodes; check name prefix; inspect return type
    return nil, nil
}
```

**Success criteria**: The analyser correctly flags `func NewCounter() Counter` (value return with Mutex) but not `func NewCounter() *Counter`.

---

## Task 4: Detect and fix a range copy bug

**Goal**: The following code processes a slice of workers. Identify the bug and fix it.

**Code**:
```go
type Worker struct {
    mu   sync.Mutex
    id   int
    runs int
}

func RunAll(workers []Worker) {
    var wg sync.WaitGroup
    for _, w := range workers {
        wg.Add(1)
        go func(w Worker) {
            defer wg.Done()
            w.mu.Lock()
            w.runs++
            w.mu.Unlock()
        }(w)
    }
    wg.Wait()
}
```

**Success criteria**: Identify both copy sites (range copy and closure parameter copy). Provide a fix that ensures each `workers[i].runs` is correctly incremented.

---

## Task 5: Sharded counter

**Goal**: Implement a sharded counter optimised for very high concurrent throughput. Use one atomic counter per shard; aggregate on read.

**Spec**:
```go
type ShardedCounter struct { ... }

func NewShardedCounter() *ShardedCounter
func (s *ShardedCounter) Inc()
func (s *ShardedCounter) Load() int64
```

**Constraints**:
- Number of shards equals `runtime.NumCPU()`.
- Each shard's counter is padded to a 64-byte cache line to avoid false sharing.
- `Inc` distributes across shards (use any reasonable hashing).

**Success criteria**:
- Benchmark against a plain `atomic.Int64` counter at 16-core saturation. Show throughput improvement.
- `go vet` is clean.

---

## Task 6: Copy-on-write config

**Goal**: Implement a `Config` type that holds a `map[string]string`. Reads are lock-free; writes copy-on-write swap the entire map.

**Spec**:
```go
type Config struct { ... }
func NewConfig() *Config
func (c *Config) Get(k string) (string, bool)
func (c *Config) Set(k, v string)
func (c *Config) Delete(k string)
```

**Success criteria**:
- Concurrent benchmark: 90% reads, 10% writes, 10000 ops/goroutine, 100 goroutines. Verify no data races and final state is consistent.
- Use `atomic.Pointer[map[string]string]` internally.

---

## Task 7: Refactor a legacy API

**Goal**: The following package has value-typed methods. Refactor to pointer-typed without breaking the existing test suite (write tests first if missing).

**Code**:
```go
package inventory

type Inventory struct {
    mu    sync.Mutex
    items map[string]int
}

func (inv Inventory) Add(item string, qty int) { ... }
func (inv Inventory) Get(item string) int { ... }
func (inv Inventory) Restock(item string, qty int) error { ... }
```

**Steps**:
1. Add a test that creates `Inventory`, performs concurrent Adds, then verifies Get.
2. Run `go vet`. Observe diagnostics.
3. Change receivers to pointers. Add a constructor. Re-run vet.
4. Update tests to use `*Inventory`.
5. Document the no-copy rule.

**Success criteria**: All tests pass under `-race`; vet is clean; documentation present.

---

## Task 8: Detect a sync.Once copy bug

**Goal**: The following type fails to initialise its singleton correctly. Identify the bug and provide a fix and a test that demonstrates the bug.

**Code**:
```go
type Initializer struct {
    once sync.Once
    val  int
}

func (i Initializer) Get() int {
    i.once.Do(func() {
        i.val = expensive()
    })
    return i.val
}

func expensive() int {
    fmt.Println("expensive called")
    return 42
}
```

**Success criteria**: A test that demonstrates `expensive` is called more than once (or `Get` returns 0). The fix uses a pointer receiver.

---

## Task 9: Map storing struct-with-mutex

**Goal**: The following registry stores Tasks by name. It does not work as intended. Diagnose and fix.

**Code**:
```go
type Task struct {
    mu     sync.Mutex
    status string
}

type Registry struct {
    mu    sync.Mutex
    tasks map[string]Task
}

func (r *Registry) Register(name string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.tasks[name] = Task{status: "pending"}
}

func (r *Registry) Complete(name string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    t := r.tasks[name]
    t.mu.Lock()
    t.status = "done"
    t.mu.Unlock()
    r.tasks[name] = t
}
```

**Success criteria**: Identify the value-typed map elements (each access copies). Refactor to `map[string]*Task`. Show that vet flags the original.

---

## Task 10: Channel with mutex-containing message

**Goal**: A pipeline of producers and consumers carries `Task` values through a channel. Identify the bug and fix.

**Code**:
```go
type Task struct {
    ID  string
    mu  sync.Mutex
    done bool
}

func producer(out chan Task) {
    for i := 0; i < 100; i++ {
        out <- Task{ID: fmt.Sprintf("task-%d", i)}
    }
    close(out)
}

func consumer(in chan Task, results []Task) {
    for t := range in {
        t.mu.Lock()
        t.done = true
        t.mu.Unlock()
        results = append(results, t)
    }
}
```

**Success criteria**: Identify the channel-send copy and the range-receive copy. Refactor to `chan *Task`. Note also that `results = append(results, t)` does not propagate to the caller because `results` is a slice parameter — separate issue, but worth noting.

---

## Task 11: Write a benchmark for mutex contention

**Goal**: Write a benchmark that demonstrates contention on a single mutex. Measure throughput vs. number of goroutines.

**Spec**:
- Use `testing.B` and `RunParallel`.
- Measure ops/sec for: 1, 2, 4, 8, 16, 32 goroutines.
- Output as a table.

**Starter**:
```go
func BenchmarkContended(b *testing.B) {
    var mu sync.Mutex
    var n int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            n++
            mu.Unlock()
        }
    })
}
```

**Success criteria**: Run with `-cpu=1,2,4,8,16,32`. Observe throughput plateau at high goroutine counts. Discuss why.

---

## Task 12: Profile mutex contention with pprof

**Goal**: Set up mutex profiling on a benchmark and inspect the profile.

**Steps**:
1. Add `runtime.SetMutexProfileFraction(1)` to your test setup.
2. Run the benchmark with `-mutexprofile=mutex.out`.
3. Inspect: `go tool pprof mutex.out`.
4. Run the `top` and `list` commands. Identify the contended functions.

**Success criteria**: A short write-up explaining what the profile shows. Identify which function name appears at the top and why.

---

## Task 13: Spotting closure capture by value

**Goal**: The following code has a closure capture bug. Identify and fix.

**Code**:
```go
func StartProcessors(workers []Worker) {
    for _, w := range workers {
        go func() {
            w.mu.Lock()
            // ... work ...
            w.mu.Unlock()
        }()
    }
}
```

**Success criteria**: Identify that `w` in the closure is the loop's range-copy variable; each goroutine captures its own `w`, but all of them have copied mutexes. The "shared" workers slice elements are never accessed. Fix: pass `&workers[i]` into the goroutine explicitly, or use indexed access in the loop.

---

## Task 14: Build a Pool of resources

**Goal**: Implement a `Pool[T]` type that holds a fixed number of `*T` items and dispenses them with `Get` and `Put`.

**Spec**:
```go
type Pool[T any] struct { ... }
func NewPool[T any](items []*T) *Pool[T]
func (p *Pool[T]) Get() *T   // blocks if pool is empty
func (p *Pool[T]) Put(t *T)  // returns an item to the pool
```

**Constraints**:
- Use a channel internally (avoid mutex entirely).
- Show that the channel-based design has no copy hazards.
- The `Pool` itself must not be copied.

**Success criteria**: A correct, concurrent, vet-clean implementation. Test with a small pool size and many goroutines.

---

## Task 15: Distinguish between mutex profile and block profile

**Goal**: Write a small program that exhibits both mutex contention and channel blocking. Enable both profiles. Compare the output.

**Steps**:
1. Create a function that spawns many goroutines competing for one mutex.
2. Create a function that spawns many goroutines reading from a slow channel.
3. Enable both `SetMutexProfileFraction(1)` and `SetBlockProfileRate(1)`.
4. Run; capture both profiles via pprof.
5. Compare what each shows.

**Success criteria**: Profile output for both. A written explanation of which contention shows up in which profile.

---

## Task 16: noCopy for a non-Mutex type

**Goal**: Define a type that holds a unique resource (e.g., a session ID) and must not be copied even though it contains no Mutex. Use the `noCopy` idiom.

**Spec**:
```go
type Session struct {
    _  noCopy
    id string
    fd int
}

type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

**Success criteria**: Write a function that copies a Session. Verify vet flags it. Document why.

---

## Task 17: Mutex copy in a worker pool

**Goal**: Build a worker pool using a `sync.Mutex` per worker (to serialise task processing per worker). Demonstrate one design that has a copy bug, and a correct design.

**Constraints**:
- Workers should be `*Worker` pointers throughout (channels, slices, etc.).
- Show the broken version (channels of `Worker`) producing wrong results under load.
- Show the correct version producing correct results.

**Success criteria**: Two complete programs (one broken, one correct), with tests and benchmarks.

---

## Task 18: End-to-end production-style implementation

**Goal**: Build a small in-memory key-value cache with TTL eviction, optimised for concurrent reads. Apply all the lessons of this section.

**Spec**:
```go
type Cache[K comparable, V any] struct { ... }
func NewCache[K comparable, V any]() *Cache[K, V]
func (c *Cache[K, V]) Get(k K) (V, bool)
func (c *Cache[K, V]) Set(k K, v V, ttl time.Duration)
func (c *Cache[K, V]) Delete(k K)
func (c *Cache[K, V]) Stats() Stats
```

**Constraints**:
- Sharded internally (configurable shard count, default = NumCPU).
- Each shard uses `sync.RWMutex`.
- TTL eviction via a periodic sweeper goroutine.
- All types non-copyable; vet clean.
- Provide benchmarks against `sync.Map` for read-heavy workloads.

**Success criteria**:
- Full test coverage (unit + concurrent stress tests).
- `go vet ./...` clean.
- `go test -race ./...` clean.
- Benchmark results documented.
- Code passes `golangci-lint`.

---

## Bonus task: Custom analyser to detect mutex-in-map

**Goal**: Extend Task 3 to write an analyser that detects when a map value type contains a `sync.Locker`. The map should hold `*T`, not `T`.

**Success criteria**: Analyser flags `var m map[string]Counter` when `Counter` contains a Mutex. Does not flag `map[string]*Counter`.

---

## Summary

These tasks cover:
- Basic detection (Tasks 1, 8, 9, 10, 13)
- Defensive design (Tasks 1, 4, 7, 16, 17)
- Performance work (Tasks 5, 6, 11, 12, 15)
- Tooling and analysis (Tasks 3, bonus)
- End-to-end production code (Task 18)

After completing all tasks, you should be able to design, implement, profile, and refactor concurrent Go code without introducing mutex copy bugs, and explain the techniques to others.
