# Memory Fences — Hands-On Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Beginner Tasks](#beginner-tasks)
3. [Intermediate Tasks](#intermediate-tasks)
4. [Advanced Tasks](#advanced-tasks)
5. [Research / Open-Ended Tasks](#research--open-ended-tasks)
6. [Reading Tasks](#reading-tasks)
7. [Summary](#summary)

---

## How to Use This File

Each task is self-contained: a problem statement, the expected approach, and a brief solution sketch. The tasks build up: you can start with the publish/observe pattern at task 1 and finish with reading the Go runtime's atomic assembly at task 30.

For each task, the recommended flow is:

1. Read the problem.
2. Write your solution in a fresh directory.
3. Run with `-race` and `-cpu=1,2,4,8`.
4. Compare your solution to the sketch.
5. Inspect the compiler output with `go tool compile -S` when relevant.

Where a task says "benchmark," use `go test -bench=. -benchmem`. Where it says "inspect assembly," use `go build -gcflags=-S` or `go tool objdump`.

---

## Beginner Tasks

### Task 1 — Publish a struct safely

Write a goroutine that initialises a `*User` struct and publishes it through an `atomic.Pointer[User]`. The main goroutine should spin on `Load` returning non-nil and then print the user's name.

**Expected approach.** Producer creates the struct, calls `Store`. Consumer calls `Load` in a loop until non-nil.

**Solution sketch.**

```go
type User struct {
    Name string
    Age  int
}

var current atomic.Pointer[User]

func main() {
    go func() {
        time.Sleep(10 * time.Millisecond)
        current.Store(&User{Name: "Bakhodir", Age: 21})
    }()

    for {
        u := current.Load()
        if u != nil {
            fmt.Println(u.Name)
            return
        }
        runtime.Gosched()
    }
}
```

The fence inside `Store` and `Load` guarantees that all fields of `User` are visible to the reader once `Load` returns non-nil.

### Task 2 — Demonstrate a missing fence

Write a program that has two `bool` flags, written by two goroutines in opposite order, and read by a third. Without atomics, prove the race detector catches it.

**Expected approach.** Use plain `bool` first; run with `-race`. Then replace with `atomic.Bool`; observe the race detector goes silent.

**Solution sketch.**

```go
var a, b bool

func main() {
    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); a = true }()
    go func() { defer wg.Done(); b = true }()
    wg.Wait()
    fmt.Println(a, b)
}
```

Run `go run -race main.go`. Expect a race report on each variable. Replace with `var a, b atomic.Bool` and `a.Store(true)` / `b.Store(true)` and the report disappears.

### Task 3 — Stop a worker promptly

Write a worker goroutine that loops on `atomic.Bool.Load()` and exits when the flag is set. Measure the time from `Store(true)` to the worker actually exiting. Aim for under 1 microsecond.

**Expected approach.** Time stamp before `Store(true)`; channel close inside worker just before return; measure the receive.

**Solution sketch.**

```go
var stop atomic.Bool
done := make(chan struct{})

go func() {
    for !stop.Load() {
        runtime.Gosched()
    }
    close(done)
}()

t := time.Now()
stop.Store(true)
<-done
fmt.Println(time.Since(t))
```

Typical result: under 1 μs on a modern desktop, often around 100–500 ns.

### Task 4 — Verify mutex contains a fence

Write two goroutines, one writes `data = 42` then releases a mutex; the other acquires the same mutex and reads `data`. The read must observe 42 with no atomic on `data`.

**Expected approach.** The mutex's Unlock/Lock pair gives a release/acquire edge.

**Solution sketch.**

```go
var (
    data int
    mu   sync.Mutex
)

func main() {
    mu.Lock()
    go func() {
        mu.Lock()
        data = 42
        mu.Unlock()
    }()
    mu.Unlock()

    mu.Lock()
    fmt.Println(data) // observes 42
    mu.Unlock()
}
```

The fences inside the mutex provide the synchronisation; no atomic on `data` is needed.

### Task 5 — `sync.Once` versus hand-rolled CAS

Implement a lazy initialiser using `atomic.Bool` and a CAS. Compare to `sync.Once`. Show why the CAS version is wrong: two goroutines can both call the initialiser.

**Expected approach.** A CAS on the flag does not protect the initialiser body — only the flag flip. Use `sync.Once` instead.

**Solution sketch.**

```go
// Wrong:
var initialized atomic.Bool
var value *Resource

func getWrong() *Resource {
    if !initialized.Load() {
        value = build() // race — two goroutines can both reach here
        initialized.Store(true)
    }
    return value
}

// Right:
var once sync.Once
var goodValue *Resource

func getRight() *Resource {
    once.Do(func() { goodValue = build() })
    return goodValue
}
```

---

## Intermediate Tasks

### Task 6 — SPSC ring buffer

Build a single-producer single-consumer ring buffer with two `atomic.Uint64` indices (write, read). Show that it works without a mutex.

**Solution sketch.**

```go
type Ring struct {
    buf  []int
    head atomic.Uint64 // consumer reads here
    tail atomic.Uint64 // producer writes here
}

func (r *Ring) Push(v int) bool {
    t := r.tail.Load()
    h := r.head.Load()
    if t-h >= uint64(len(r.buf)) {
        return false
    }
    r.buf[t%uint64(len(r.buf))] = v
    r.tail.Store(t + 1)
    return true
}

func (r *Ring) Pop() (int, bool) {
    h := r.head.Load()
    t := r.tail.Load()
    if h == t {
        return 0, false
    }
    v := r.buf[h%uint64(len(r.buf))]
    r.head.Store(h + 1)
    return v, true
}
```

The release on `r.tail.Store` publishes the slot write to the consumer; the release on `r.head.Store` publishes the read to the producer. Each goroutine reads the other's index with acquire semantics.

### Task 7 — Demonstrate store buffer reordering (or fail to)

On an x86 machine, write a program with two goroutines, each doing `Store(1); val = Load(other)`. Run it millions of times. Try to observe `r1 == 0 && r2 == 0`. With `sync/atomic`, you will not see it because Go is seq_cst.

**Expected approach.** This task is designed to confirm Go's seq_cst guarantee in practice. The "failure" to observe the reorder is the success.

**Solution sketch.**

```go
var x, y atomic.Int64

func runOnce() (int64, int64) {
    x.Store(0)
    y.Store(0)
    var r1, r2 int64
    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); x.Store(1); r1 = y.Load() }()
    go func() { defer wg.Done(); y.Store(1); r2 = x.Load() }()
    wg.Wait()
    return r1, r2
}

func main() {
    for i := 0; i < 10_000_000; i++ {
        r1, r2 := runOnce()
        if r1 == 0 && r2 == 0 {
            fmt.Println("REORDER seen at iter", i)
            return
        }
    }
    fmt.Println("no reorder in 10M iterations (as expected with Go seq_cst)")
}
```

You will see "no reorder." If you replace the atomics with plain `int64` and remove `-race`, you may see the reorder on TSO — but at this point the program has UB.

### Task 8 — Dekker's algorithm in Go

Implement two-thread Dekker's mutual exclusion using `atomic.Bool` and `atomic.Int32`. Run two goroutines incrementing a shared counter inside the critical section a million times; assert the final count is exactly 2,000,000.

**Solution sketch.** See the worked example in `middle.md`. The counter increment inside the critical section can be a plain `int64` because mutual exclusion holds.

```go
var (
    flag    [2]atomic.Bool
    turn    atomic.Int32
    counter int64
)

func acquire(i int) { /* as in middle.md */ }
func release(i int) { /* as in middle.md */ }

func work(i int) {
    for k := 0; k < 1_000_000; k++ {
        acquire(i)
        counter++
        release(i)
    }
}
```

Final `counter` should equal 2,000,000. If you implement Dekker without the release/acquire fences (impossible in Go, but think it through), the counter can be less.

### Task 9 — Sharded counter

Build a counter that supports many concurrent increments. Use 128 cache-line-padded buckets; each goroutine increments its own bucket. A reader sums all buckets.

**Solution sketch.**

```go
type Counter struct {
    cells [128]struct {
        v atomic.Int64
        _ [56]byte // pad to 64 bytes
    }
}

func (c *Counter) Add(delta int64) {
    i := goroutineID() % 128
    c.cells[i].v.Add(delta)
}

func (c *Counter) Load() int64 {
    var sum int64
    for i := range c.cells {
        sum += c.cells[i].v.Load()
    }
    return sum
}
```

`goroutineID` can be obtained from a thread-local mechanism; for benchmarks, a `uint32` per goroutine drawn from a stripe counter works. Compare throughput against a naive `atomic.Int64.Add` from 16 goroutines.

### Task 10 — Fence cost benchmark

Benchmark `atomic.Int64.Add`, `atomic.Int64.Load`, `atomic.Int64.Store`, and a plain `int64++`. Run on x86 and on ARM (Apple Silicon will do). Report the ratios.

**Solution sketch.**

```go
var counter atomic.Int64
var plain int64

func BenchmarkPlain(b *testing.B)        { for i := 0; i < b.N; i++ { plain++ } }
func BenchmarkAtomicAdd(b *testing.B)    { for i := 0; i < b.N; i++ { counter.Add(1) } }
func BenchmarkAtomicLoad(b *testing.B)   { for i := 0; i < b.N; i++ { _ = counter.Load() } }
func BenchmarkAtomicStore(b *testing.B)  { for i := 0; i < b.N; i++ { counter.Store(int64(i)) } }
```

Typical findings on x86: plain ~0.3 ns, atomic load ~0.5 ns, atomic add ~3 ns, atomic store ~3 ns.
On ARM (M2): plain ~0.2 ns, atomic load ~1 ns, atomic add ~5 ns, atomic store ~3 ns.

---

## Advanced Tasks

### Task 11 — Implement an atomic configuration with `atomic.Pointer`

Build a config service with `Reload(*Config)` and `Current() *Config`. Ensure that under heavy reader load, hot-reload happens with no lock contention.

**Solution sketch.**

```go
type Config struct {
    Endpoints []string
    Timeout   time.Duration
}

type Service struct {
    cfg atomic.Pointer[Config]
}

func (s *Service) Reload(c *Config) { s.cfg.Store(c) }
func (s *Service) Current() *Config { return s.cfg.Load() }
```

Benchmark with `-race` and many reader goroutines. The reader cost is one atomic load — typically 1–2 ns on x86.

### Task 12 — Lock-free queue (Michael & Scott)

Implement Michael & Scott's lock-free queue using `atomic.Pointer[node]`. Walk through each CAS and verify the algorithm is race-free under `-race`.

**Solution sketch.** See `senior.md`. Test with multiple producers and one consumer first; then multiple consumers. Verify FIFO order under low contention.

### Task 13 — Lock-free stack (Treiber)

Implement Treiber's lock-free stack. Use `atomic.Pointer[node]` for the head; push and pop CAS on the head. Show how the ABA problem can arise if you ever reuse nodes.

**Solution sketch.**

```go
type node struct {
    val  int
    next *node
}

type Stack struct {
    head atomic.Pointer[node]
}

func (s *Stack) Push(v int) {
    n := &node{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        old := s.head.Load()
        if old == nil {
            return 0, false
        }
        if s.head.CompareAndSwap(old, old.next) {
            return old.val, true
        }
    }
}
```

Go's garbage collector handles ABA in this case because the popped node remains live until all references drop. If you build the same algorithm in C with manual memory, ABA shows up.

### Task 14 — Verify the fence with a generated reordering

Use the `https://godbolt.org` compiler explorer (or local `go tool compile -S`) to view the assembly Go emits for `atomic.Int64.Add` on amd64 and arm64. Identify the fence instruction in each.

**Expected output.**
- On amd64: `LOCK XADDQ`. The `LOCK` prefix is the fence.
- On arm64 pre-8.1: `LDAXR ... STLXR ... CBNZ retry` LL/SC loop. The acquire/release semantics are on the load and store.
- On arm64 8.1+: `LDADDAL`. The `AL` suffix carries both acquire and release.

### Task 15 — Race detector instrumentation

Read the Go runtime's source for the race detector. Files: `runtime/race.go`, `runtime/racecallback.go`. Identify the hooks for `sync/atomic` operations.

**Expected outcome.** You should be able to point to the runtime functions `racefuncenter`, `raceread`, `racewrite`, `racereadrange`, `racewriterange`, and explain that atomic operations call `raceacquire` and `racerelease` to propagate happens-before edges through ThreadSanitizer's vector clocks.

### Task 16 — Build a sequence lock (seqlock)

A seqlock is a lock-free read pattern: writers increment a sequence counter (becomes odd while writing); readers spin until the counter is even and unchanged after the read. Build one in Go using `atomic.Uint64` for the sequence.

**Solution sketch.**

```go
type Seqlock[T any] struct {
    seq atomic.Uint64
    val T
}

func (s *Seqlock[T]) Write(v T) {
    seq := s.seq.Load()
    s.seq.Store(seq + 1) // odd; begin write
    s.val = v
    s.seq.Store(seq + 2) // even; end write
}

func (s *Seqlock[T]) Read() T {
    for {
        s1 := s.seq.Load()
        if s1&1 != 0 {
            continue
        }
        v := s.val
        s2 := s.seq.Load()
        if s1 == s2 {
            return v
        }
    }
}
```

Note this seqlock has a race on `s.val` from the race detector's point of view. In Go, the idiomatic fix is to use an `atomic.Pointer[T]` instead. Seqlocks are more idiomatic in C/C++ where you control alignment and memory orderings.

### Task 17 — Cgo boundary with shared atomic

Write a Cgo program where the C side increments a counter using `__atomic_fetch_add(..., __ATOMIC_SEQ_CST)` and the Go side reads it with `atomic.LoadInt64`. Verify the values agree.

**Solution sketch.**

```c
// stub.c
#include <stdatomic.h>
extern _Atomic long long counter;
void c_incr() { atomic_fetch_add_explicit(&counter, 1, memory_order_seq_cst); }
```

```go
// main.go
/*
#include <stdatomic.h>
_Atomic long long counter = 0;
void c_incr();
*/
import "C"

func main() {
    for i := 0; i < 1000; i++ {
        C.c_incr()
    }
    v := atomic.LoadInt64((*int64)(unsafe.Pointer(&C.counter)))
    fmt.Println(v)
}
```

This is tricky to get right; the demo shows that with matching seq_cst on both sides, behaviour is consistent.

### Task 18 — Benchmark contention

Vary the number of producers in Task 13's Treiber stack. Run with 1, 2, 4, 8, 16 producer goroutines. Plot throughput. Identify the contention knee.

**Expected outcome.** Single-threaded throughput is high (perhaps 50–100 million ops/sec on a desktop). With 8 contending producers, throughput per goroutine drops by 5–10x due to CAS retries and cache-line bouncing. The aggregate throughput often plateaus or decreases.

### Task 19 — Read `runtime/internal/atomic/asm_arm64.s`

Open the file. Identify the implementation of `Cas64`, `Xadd64`, `Load64`, `Store64`. Match each to the description in `professional.md`.

**Expected outcome.** You can point to the lines that emit `LDAXR`, `STLXR`, `LDAR`, `STLR`, `DMB ISH`. You can explain why `Store64` is `STLR` rather than plain `STR`.

### Task 20 — Implement RCU-like read patterns

Read-copy-update: writers replace the entire data structure via an atomic pointer swap; readers grab a snapshot pointer and use it. Build this for a `map[string]string`.

**Solution sketch.**

```go
type Cache struct {
    data atomic.Pointer[map[string]string]
}

func (c *Cache) Get(k string) string {
    m := *c.data.Load()
    return m[k]
}

func (c *Cache) Set(k, v string) {
    for {
        old := c.data.Load()
        oldMap := *old
        newMap := make(map[string]string, len(oldMap)+1)
        for kk, vv := range oldMap {
            newMap[kk] = vv
        }
        newMap[k] = v
        if c.data.CompareAndSwap(old, &newMap) {
            return
        }
    }
}
```

Readers are wait-free and lock-free. Writers may retry under contention. Trade-off: each writer allocates a full copy. Good for read-heavy workloads.

---

## Research / Open-Ended Tasks

### Task 21 — Survey real-world atomic usage

Pick three Go projects you respect (e.g., the standard library, kubernetes, etcd, vitess). Find their largest user of `sync/atomic`. Document each occurrence: what it protects, what alternatives were considered, and what fence it implicitly emits.

### Task 22 — Compare Go and Rust atomic ergonomics

Pick a small lock-free algorithm (Treiber stack or SPSC ring). Implement in both Go and Rust. Compare line counts, runtime correctness, and ease of reasoning. Note where Rust's explicit orderings help or hurt clarity.

### Task 23 — Read Sewell et al.'s TSO paper

Read the 2010 paper start to finish. Reproduce the SB and IRIW litmus tests in Go using atomics; confirm seq_cst forbids both. Reproduce the same tests in C with relaxed atomics; observe the relaxed cases that show up.

### Task 24 — Read Russ Cox's memory model series

Start at [https://research.swtch.com/mm](https://research.swtch.com/mm). Read all four posts: introduction, hardware, programming-language, and Go memory model updates. Write a one-page summary in your own words.

### Task 25 — Map Go atomics to ARM LSE instructions

For each public function in `sync/atomic`, identify the ARM LSE atomic instruction (if any) that the runtime emits. Source: `runtime/internal/atomic/atomic_arm64.s`. Build a table.

---

## Reading Tasks

### Task 26 — Read the Go memory model

Read [https://go.dev/ref/mem](https://go.dev/ref/mem) carefully. List the seven happens-before rules. Test your understanding by predicting the output of three small programs using each rule.

### Task 27 — Read `runtime/internal/atomic/atomic_amd64.go`

Identify the inline assembly for each operation. Note where the `LOCK` prefix appears and where it does not.

### Task 28 — Read `sync/mutex.go`

Find the state word and the bit layout. Identify the CAS that performs Lock (acquire fence) and the atomic store that performs Unlock (release fence). Note the slow path that calls into `runtime.semacquire` and `runtime.semrelease`.

### Task 29 — Read `runtime/chan.go`

Trace a `c <- x` send through to its corresponding `<-c` receive. Identify where the memory model edge is established (it is via the mutex inside the channel struct, not via atomics in the data path).

### Task 30 — Read Adve and Boehm 2010

Read "Memory Models: A Case for Rethinking Parallel Languages and Hardware." Note their argument for high-level memory models. Compare their proposed model to Go's current model. Identify where Go followed their advice and where it diverged.

---

## Summary

The tasks here build from "publish a struct safely" to "read the runtime's ARM assembly and explain each fence." Work through them at the pace that matches your level: a junior Go developer should expect to finish tasks 1–10; a senior, 1–25; a runtime contributor, all 30. The benchmarks alone teach you more about fence cost than any paragraph of prose. The reading tasks teach you the formal language. The implementation tasks teach you what fences feel like to design with.
