---
layout: default
title: Future Proposals — Junior
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/junior/
---

# Future Proposals — Junior

[← Back](../)

This page surveys the concurrency-related proposals and features that are either freshly landed
(Go 1.23, Go 1.24), experimental (Go 1.24 `GOEXPERIMENT`), or actively discussed for future
versions. Each section follows the same shape: status, what problem it solves, simple
before/after example, the catch.

The goal is to give you a working mental model so that when you hit a future feature in code
review or in production code, you recognize it and can reason about what it does. You are not
expected to be able to use experimental APIs in production — the experimental tag means the API
may change between releases — but you should be able to read code that uses them and contribute
to discussions.

A note before we start: future-looking content is, by nature, going to age. Issue numbers will
change status, APIs marked experimental will graduate or be dropped, declined proposals will
sometimes resurface with new designs. We've cited the canonical issues at the time of writing.
When in doubt, search `github.com/golang/go/issues` for the issue number.

You will see the same set of acronyms throughout this page: GLS for goroutine-local storage,
GC for the garbage collector, ABA for the "value changed and changed back" race, CAS for
compare-and-swap. We define each in context the first time it appears, and there's a vocabulary
summary at the end if you want to skim quickly.

---

## 1. testing/synctest — deterministic concurrency tests

**Status:** experimental in Go 1.24 (`GOEXPERIMENT=synctest`), expected stable in Go 1.25.

**Tracking issue:** [golang/go#67434](https://go.dev/issue/67434).

### The problem it solves

Testing concurrent code that involves time is painful. Consider a retry loop with exponential
backoff:

```go
func Retry(op func() error) error {
    backoff := 100 * time.Millisecond
    for i := 0; i < 5; i++ {
        if err := op(); err == nil {
            return nil
        }
        time.Sleep(backoff)
        backoff *= 2
    }
    return errors.New("max retries exceeded")
}
```

How do you test this?

**Option A: actually wait.** Real-time tests would wait 100ms + 200ms + 400ms + 800ms + 1600ms =
3.1 seconds for each "failure path" test. Multiplied across hundreds of tests, your CI takes
hours.

**Option B: inject a `Clock` interface.** Mock it in tests, never use `time.Sleep` directly.
This works but means every package that uses time has to plumb a clock through every function.
For a large codebase, this is invasive.

**Option C: scale the timeouts.** Set `backoff := 1 * time.Millisecond` in tests. Faster, but
the test is now timing-sensitive — on a slow CI runner, the 1ms can become 50ms and your test
flakes.

None of these is great. `testing/synctest` introduces option D: a synthetic clock that advances
instantly whenever every goroutine in a "bubble" is blocked.

### The API

```go
package synctest

func Run(f func())
func Wait()
```

`Run` creates a bubble and runs `f` inside it. While `f` and its child goroutines are running,
calls to `time.Now`, `time.Sleep`, `time.After`, `time.Tick`, and `context.WithDeadline` use a
synthetic clock that only advances when the runtime detects that every goroutine in the bubble
is blocked on a synctest-aware operation.

`Wait` blocks until every goroutine in the current bubble is "durably blocked" — useful for
setting up assertions before time advances.

### Simple example

```go
//go:build goexperiment.synctest

package retry_test

import (
    "errors"
    "testing"
    "testing/synctest"
    "time"
)

func TestRetryUsesBackoff(t *testing.T) {
    synctest.Run(func() {
        start := time.Now()
        attempts := 0
        err := Retry(func() error {
            attempts++
            if attempts < 3 {
                return errors.New("fail")
            }
            return nil
        })
        if err != nil {
            t.Fatal(err)
        }
        elapsed := time.Since(start)
        if elapsed != 300*time.Millisecond {
            t.Fatalf("elapsed = %v, want 300ms", elapsed)
        }
    })
}
```

This test runs in microseconds of real wall time, but `time.Since(start)` inside the bubble
reports 300ms because that's how much synthetic time the two `time.Sleep` calls consumed.

### How it works under the hood

The runtime keeps a per-bubble counter of "running" goroutines. When you call `time.Sleep`
inside the bubble, the goroutine registers as blocked-with-deadline and decrements the counter.
When the counter reaches zero — every goroutine in the bubble is blocked — the runtime advances
the synthetic clock to the next scheduled wake-up. The earliest blocked goroutine resumes, and
execution continues.

This is similar to how testing tools in other languages work (e.g. RxJS's `TestScheduler`), but
it's built into the Go runtime rather than into a test library. That means your production code
does not need to be aware of synctest at all — no clock injection, no interfaces.

### The catch

Synctest only works for code that uses standard `time` and `context` APIs. Real I/O (network,
file system) is outside the bubble and looks like the goroutine is permanently blocked. The
synthetic clock will not advance because the bubble is not "durably blocked" — it's just
waiting on a real OS event.

If your code under test does network I/O, either mock it (using `httptest.NewServer` or
`net.Pipe`) or accept that synctest is not the right tool for that test. Synctest is for testing
your **timing logic**, not your I/O.

Two more gotchas to remember:

- Goroutines launched outside the bubble are not affected by the synthetic clock. If you call
  into a third-party library that spawns its own background goroutines (a connection pool with
  a janitor goroutine, for instance), the janitor runs in real time.
- The bubble's clock starts at a fixed instant the first time `time.Now` is called inside it.
  Tests that compare `time.Now()` to a wall-clock value will see a value far from the actual
  wall clock.

### Why it matters

For teams that maintain large suites of timing-related tests (retry libraries, rate limiters,
circuit breakers, anything with timeouts), synctest can cut CI minutes from hours to seconds.

It also reduces the temptation to use brittle test helpers like
`time.Sleep(50*time.Millisecond)` to "let the goroutine catch up" — a pattern that flakes under
load. Once `synctest.Wait()` is available, you can express "wait until the goroutine reaches its
blocked state" deterministically instead of with a magic sleep.

---

## 2. Range-over-func iterators and runtime coroutines

**Status:** shipped in Go 1.23, stable.

**Tracking issues:** [#61897](https://go.dev/issue/61897) (range-over-func),
[#61405](https://go.dev/issue/61405) (iter package).

### The problem it solves

Before Go 1.23, you could not easily write a generator function in idiomatic Go. The choices
were:

- **Slice everything:** build a `[]T` and return it. Wastes memory if the consumer only needs
  the first few elements.
- **Callback:** `func Walk(visit func(T) bool)`. Works but cannot be combined with `range`,
  cannot be early-broken cleanly, and chains awkwardly.
- **Goroutine + channel:** `func Walk() <-chan T`. Works, but each step is a channel send and
  receive (~150ns) and you have to remember to close the channel exactly once.

Range-over-func adds a fourth option: a function value that implements the iteration protocol,
usable directly in a `for ... range` loop.

```go
package iter

type Seq[V any] func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

### Simple example

A Fibonacci iterator:

```go
func Fibonacci() iter.Seq[uint64] {
    return func(yield func(uint64) bool) {
        var a, b uint64 = 0, 1
        for {
            if !yield(a) {
                return
            }
            a, b = b, a+b
        }
    }
}

func main() {
    for v := range Fibonacci() {
        if v > 100 {
            break
        }
        fmt.Println(v)
    }
}
```

The `yield` callback returns false when the consumer wants to stop (e.g. the `range` body
called `break`). The iterator function should check and return promptly. This is a push
iterator: the iterator drives, the consumer reacts.

### iter.Pull — push to pull

Sometimes the consumer needs to drive: "give me the next value when I ask, not when you have
one." That's a pull iterator. `iter.Pull` converts a push iterator into a pull iterator:

```go
func Pull[V any](seq iter.Seq[V]) (next func() (V, bool), stop func())
```

```go
fib := Fibonacci()
next, stop := iter.Pull(fib)
defer stop()

a, _ := next()
b, _ := next()
c, _ := next()
fmt.Println(a, b, c) // 0 1 1
```

Under the hood, `iter.Pull` is implemented using a coroutine: a separate stack that runs the
push iterator and yields control back to the consumer on each call to `next`.

It does **not** spawn a goroutine. It's a stack swap on the same OS thread, no scheduler
involvement, no channel. The per-step cost is roughly 20-40 nanoseconds on modern hardware,
compared to 150-300 nanoseconds for a goroutine + channel.

### The hidden coroutine API

To implement `iter.Pull`, the Go runtime gained an internal coroutine API: `runtime.newcoro`,
`runtime.coroswitch`, `runtime.coroexit`. These are **not** exported. They are visible only via
`//go:linkname` from the `iter` package.

The Go team has stated that if user-mode coroutines turn out to be useful beyond iterators
(e.g. for generator-style async code, for state machines that would otherwise be ugly), they
may export the API. As of Go 1.24, no formal proposal exists. The runtime symbols are also
subject to change at any time — they are an internal implementation detail.

### Concurrency implications

A range-over-func iterator is **serial**. It runs on the goroutine that ranges over it. If you
launch goroutines inside the iterator function or the loop body, you must coordinate them with
channels, errgroups, etc. — the iterator itself does not.

`iter.Pull` is also serial. The `next` and `stop` functions must be called from a single
goroutine. If multiple goroutines need to consume, build a channel adapter:

```go
func IterToChan[V any](seq iter.Seq[V]) <-chan V {
    ch := make(chan V)
    go func() {
        defer close(ch)
        for v := range seq {
            ch <- v
        }
    }()
    return ch
}
```

This adapter is the bridge between the new iterator world and the classic channel world. Many
production codebases use it during the migration period: their public APIs continue to expose
channels (for backward compatibility), but internally they use `iter.Seq` so consumers on the
new code path can avoid the channel overhead.

### The catch

Range-over-func iterators have one foot-gun: the `yield` callback must not be called after the
iterator function returns. The compiler enforces this at runtime by panicking if you try (the
Go 1.23 release notes describe the exact diagnostic). In practice, iterators that just `return`
after the loop are fine; iterators that store `yield` in a struct field and call it later are
wrong.

Also: forgetting `defer stop()` on `iter.Pull` leaks the coroutine stack until GC eventually
reclaims it through the cleanup machinery. The leak is not catastrophic — GC will collect it
eventually — but it's a slow drift you don't want in production.

A third gotcha: `iter.Seq` is a function type, not an interface. You cannot have a single value
implement multiple iterator types via methods. If you want a struct that exposes "iterate
forward" and "iterate reverse", you write two methods that each return an `iter.Seq[T]`.

### Why it matters

The iterator design unlocks several patterns that were previously clunky in Go:

- **Tree walks** that yield each node, with early termination on the consumer side.
- **Database cursors** that yield rows without loading the whole result set.
- **Parsers** that emit tokens one at a time without buffering.
- **Streaming transformations** (map, filter, take, drop) that chain without intermediate slices.

Combined with `iter.Pull`, these become much faster than the goroutine+channel equivalents.

---

## 3. weak.Pointer — weak references

**Status:** shipped in Go 1.24, stable.

**Tracking issue:** [golang/go#67552](https://go.dev/issue/67552).

### The problem it solves

A regular pointer keeps its target alive. This is what you want most of the time. But sometimes
you want to reference an object without preventing the GC from collecting it. The classic
example is a cache:

```go
var cache = map[string]*Image{}
```

Every `*Image` you put in the cache lives forever (or until you manually delete it). If your
app loads thousands of images, the cache grows unboundedly.

A common workaround is `sync.Pool`, but `Pool` is designed for reusable temporary buffers, not
identity-keyed caches. Pool entries are reclaimed at unspecified GC moments, and you cannot
look up a specific entry by key.

`weak.Pointer[T]` is a pointer that lets the GC collect the target. To use the target, you call
`Value()` which returns either a normal `*T` (if still alive) or `nil` (if collected).

### The API

```go
package weak

type Pointer[T any] struct { /* unexported */ }

func Make[T any](p *T) Pointer[T]
func (p Pointer[T]) Value() *T
```

That's the whole package: one type, two functions. Simple by design.

### Simple example

A string interning cache that lets unused strings be collected:

```go
package intern

import (
    "sync"
    "weak"
)

var (
    mu    sync.Mutex
    table = map[string]weak.Pointer[string]{}
)

func Intern(s string) *string {
    mu.Lock()
    defer mu.Unlock()
    if wp, ok := table[s]; ok {
        if p := wp.Value(); p != nil {
            return p
        }
    }
    p := &s
    table[s] = weak.Make(p)
    return p
}
```

Calling `Intern("hello")` returns the same `*string` until all external references are gone.
Then the GC collects the string, the weak pointer becomes nil, and the next `Intern("hello")`
call gets a fresh one.

(In practice you would also need to clean up dead entries from the map; we'll cover that in the
`runtime.AddCleanup` section.)

### The catch

Between `wp.Value()` returning a non-nil pointer and your next statement, the object cannot be
collected because you now hold a strong reference. But:

```go
if wp.Value() != nil {
    fmt.Println(*wp.Value()) // BUG: second Value() may return nil
}
```

Two separate calls to `Value()` may return different results. Always capture the result in a
local:

```go
if p := wp.Value(); p != nil {
    fmt.Println(*p)
}
```

The local variable also keeps the object alive for the rest of the function, preventing
collection while you use it.

Also: `weak.Pointer` is safe for concurrent reads (`Value()` from multiple goroutines is fine),
but you still need normal synchronization for what the pointer points to.

A subtle restriction: weak pointers cannot point to interior fields of a struct. You can have
`weak.Pointer[MyStruct]` pointing to the whole struct, but not `weak.Pointer[Field]` pointing
to one field. The runtime needs to track allocations, and interior pointers don't have
allocation headers.

### Why it matters

Before Go 1.24, you could not build a true weak-reference cache in Go. Workarounds using
`sync.Map` + finalizers were buggy (the map entry itself keeps the object alive).
`weak.Pointer` makes this a one-line solution and unlocks several patterns:

- **Interning / canonicalization** of strings, URLs, identifiers.
- **Identity caches** for expensive derived data (parsed AST, decoded image).
- **Observer patterns** that don't leak observers.

The use case the proposal explicitly calls out is "canonicalizing maps" — a map where the keys
are values, and the values are canonical pointers to a unique representative of an equivalence
class.

---

## 4. runtime.AddCleanup — finalizers, done right

**Status:** shipped in Go 1.24, stable. Recommended replacement for `runtime.SetFinalizer`.

**Tracking issue:** [golang/go#67535](https://go.dev/issue/67535).

### The problem it solves

`runtime.SetFinalizer` lets you attach a cleanup function that runs when an object is about to
be collected. It has been in Go since the beginning, with several known problems:

1. **One finalizer per object.** Want to clean up two resources tied to one object? You're out
   of luck.
2. **The finalizer receives the pointer.** You can store it somewhere and "resurrect" the
   object — defeating the GC. This is rare but a real source of bugs.
3. **All finalizers run on one goroutine.** A slow finalizer blocks all others, including ones
   that need to release scarce resources.
4. **Mixing with cgo memory pinning is fragile.**

`runtime.AddCleanup` fixes all four.

### The API

```go
package runtime

func AddCleanup[T, V any](ptr *T, cleanup func(V), arg V) Cleanup

type Cleanup struct { /* ... */ }
func (c Cleanup) Stop()
```

The cleanup function does **not** take the pointer. You give it a captured argument (the
resource you want to clean up), and it cannot resurrect the parent object because it never sees
it.

### Simple example

Cleaning up a file handle tied to a database struct:

```go
type DB struct {
    f *os.File
}

func Open(path string) (*DB, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    db := &DB{f: f}
    runtime.AddCleanup(db, func(f *os.File) { f.Close() }, f)
    return db, nil
}
```

When the user drops the last reference to `db`, the cleanup runs. The cleanup takes `f` (the
file) as its argument, not `db`. There is no way for the cleanup to write code like
`globalDB = db` and revive the object — `db` is just not available.

### Multiple cleanups

```go
db := &DB{f: f, lock: lock}
runtime.AddCleanup(db, func(f *os.File) { f.Close() }, f)
runtime.AddCleanup(db, func(l *FileLock) { l.Release() }, lock)
```

Both run when `db` is collected. Order is unspecified, which means cleanups should be
independent.

### Stopping a cleanup

The `Cleanup` value returned by `AddCleanup` has a `Stop()` method that cancels the cleanup.
This is the equivalent of `runtime.SetFinalizer(ptr, nil)`. Use it when the object is being
closed explicitly (e.g. by `db.Close()`) and the cleanup is no longer needed.

```go
type DB struct {
    f     *os.File
    clean runtime.Cleanup
}

func Open(path string) (*DB, error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    db := &DB{f: f}
    db.clean = runtime.AddCleanup(db, func(f *os.File) { f.Close() }, f)
    return db, nil
}

func (db *DB) Close() error {
    db.clean.Stop()
    return db.f.Close()
}
```

This pattern lets you have both explicit close and GC-driven cleanup, without double-close
problems.

### The catch

If your cleanup function captures the parent object, you've defeated the GC:

```go
// WRONG
runtime.AddCleanup(db, func(d *DB) { d.f.Close() }, db) // captures db
```

This keeps `db` alive forever because the cleanup function holds a strong reference to it. The
compiler will not catch this — review your captures carefully.

The API is shaped to discourage the mistake (the function takes a value of type `V`, not
`*T`), but you can still pass the parent as the arg.

### Why it matters

For services that allocate many short-lived objects tied to OS resources (file descriptors,
sockets, mmap regions), `AddCleanup` lets you express resource lifetimes more naturally. The
finalizer-goroutine bottleneck disappears. The accidental resurrection bug class disappears.

Existing code using `SetFinalizer` does not have to migrate immediately — both APIs coexist.
But new code should prefer `AddCleanup`.

### Combining with weak.Pointer

The interning cache from before leaked map entries — even when the value was collected, the
`weak.Pointer[string]` stayed in the map. With `AddCleanup`, you can fix that:

```go
func Intern(s string) *string {
    mu.Lock()
    defer mu.Unlock()
    if wp, ok := table[s]; ok {
        if p := wp.Value(); p != nil {
            return p
        }
    }
    p := &s
    table[s] = weak.Make(p)
    runtime.AddCleanup(p, func(key string) {
        mu.Lock()
        defer mu.Unlock()
        delete(table, key)
    }, s)
    return p
}
```

When the `*string` is collected, the cleanup removes the dead entry from the map. The cache
stays bounded.

Note: the cleanup function above takes the mutex. Cleanups run on background goroutines, so
they should treat shared state with the same care as any other goroutine. They should also not
block for long, because the cleanup worker pool is shared across the whole program.

---

## 5. Atomic vector ops (proposed)

**Status:** proposed, **on hold**.

**Tracking issue family:** [#50860](https://go.dev/issue/50860).

### The problem it solves

`sync/atomic` operates on single machine words: 32 or 64 bits. For some lock-free data
structures, you need to atomically update two words at once. The classic example is a **tagged
pointer**: a `(pointer, generation)` pair where the generation counter increments on every
write, defeating the ABA problem.

The ABA problem: a goroutine reads a pointer P pointing to node A. The OS preempts it. Another
goroutine pops A, pushes B, then pushes A again (with a new memory address from a freelist
that recycled). The first goroutine wakes up, sees the pointer still equals P (pointing to A),
and proceeds — but the data structure changed underneath. CAS on the pointer alone cannot
detect this.

A double-width CAS on (pointer, generation) would detect it: even if the pointer matches, the
generation has changed.

### The proposed API (sketch)

No accepted API exists. Sketches in the issue thread look like:

```go
type Pair struct {
    Lo, Hi uint64
}

func CompareAndSwapPair(addr *Pair, old, new Pair) bool
```

Or as a typed atomic:

```go
type DoubleWord[T, U any] struct { ... }

func (d *DoubleWord[T, U]) CompareAndSwap(old, new struct{ A T; B U }) bool
```

### Why it's stalled

Portability is hard. Amd64 has `LOCK CMPXCHG16B`. Arm64 has `LDXP/STXP`. 32-bit platforms have
nothing comparable. RISC-V base ISA does not include paired CAS. The Go team prefers APIs that
work on every supported platform, even if performance varies — and atomic vector ops would
either require a software fallback (lock-based, defeating lock-freedom) or be platform-specific
(unusual for the standard library).

There's also a higher-level argument: most "lock-free" code in production Go services has no
ABA window because allocations are tracked by GC. The classic ABA scenario (freelist of nodes,
pointer recycling) is rare. The Go team prefers higher-level concurrency primitives
(`sync.Map`, `errgroup`, channels) and is reluctant to add low-level primitives for narrow use
cases.

### What to do today

If you genuinely need ABA-resistant CAS:

- **Mutex around the operation.** Correct, lock-free lost.
- **Versioned pointer with version in low bits.** On 64-bit, aligned pointers have low 3 bits
  free, but for 64-byte cache-line alignment you have 6 bits, giving 64 generations before
  wrap. Not enough for many use cases.
- **Hazard pointers.** Correct, complex to implement, papers exist.

For 95% of "lock-free" code in Go, none of this matters. You almost certainly do not have an
ABA window in your code.

---

## 6. Automatic GOMAXPROCS from cgroup quota

**Status:** proposed, discussed.

**Tracking issues:** [#33803](https://go.dev/issue/33803), [#73193](https://go.dev/issue/73193).

### The problem it solves

`GOMAXPROCS` controls how many OS threads the Go scheduler can use to run goroutines
simultaneously. By default, it's `runtime.NumCPU()`, which reads the host's CPU affinity mask.

On bare metal, this is correct. On Kubernetes with CPU limits, it is wildly wrong:

- Host: 64 logical cores.
- Pod CPU limit: 100m (10% of one core).
- `runtime.NumCPU()`: returns 64.
- Result: 64 OS threads, each getting ~0.15% of one core, constantly being descheduled by the
  kernel, causing massive scheduler thrash and lock contention.

The cgroup CPU quota is visible in the file system: cgroup v2 exposes `/sys/fs/cgroup/cpu.max`
containing `quota period`. For a 100m limit, you'd see something like `10000 100000` (10ms out
of every 100ms). The proposal is to read this at startup and set `GOMAXPROCS = ceil(quota /
period)`.

### The polyfill

Until the runtime does this, the de-facto solution is the Uber library
[`go.uber.org/automaxprocs`](https://github.com/uber-go/automaxprocs):

```go
import _ "go.uber.org/automaxprocs"
```

That side-effect import calls `runtime.GOMAXPROCS` at init with the cgroup-derived value. It
supports cgroup v1 and v2 and falls back to `NumCPU` on non-Linux.

### Why it matters

For Go services running in containers (i.e. most modern Go services), this single line can
reduce CPU usage by 30-70% under load. The pathological case (high GOMAXPROCS, low real CPU)
causes goroutines to spend most of their time being parked and unparked, not doing work.

The reduction is largest when:

- The pod has a small CPU limit (~1 CPU or less) relative to the node.
- The application is CPU-bound (lots of goroutines doing computation).
- The Go scheduler is contended (many goroutines, each blocking on each other).

For an idle service, the difference is negligible.

### When the proposal lands

The proposal would make the runtime do this automatically. You drop the dependency, the binary
behaves the same way. Backward-incompatible behavior changes are unlikely because the runtime
can fall back to `NumCPU` if the cgroup files are missing.

The likely shape: a new runtime initialization step that probes cgroup v1 and v2, computes the
quota, and overrides the default `GOMAXPROCS`. Existing code that explicitly sets
`GOMAXPROCS` (via the environment variable `GOMAXPROCS=N` or via `runtime.GOMAXPROCS(N)`) is
unaffected — explicit settings always win.

---

## 7. Goroutine-local storage (declined, repeatedly)

**Status:** **declined**, multiple times.

**Tracking issue:** [#21355](https://go.dev/issue/21355).

### The problem it solves (claimed)

In thread-based languages (Java, C++ pthreads), thread-local storage lets a piece of code
read/write a variable that is unique to the current thread. The classic use case: storing a
request ID that all log statements should include, without threading it through every function
signature.

In Go, the equivalent would be goroutine-local storage (GLS): a `Set(key, value)` that
descendants see, even across function calls.

### Why Go rejects it

The Go team has consistently refused to add GLS. The arguments:

1. **Hidden dependencies.** Code that reads from GLS depends on someone setting it earlier, but
   the dependency is invisible at the call site. Reading the code does not tell you what state
   matters.
2. **Goroutine boundaries are unclear.** Should `go f()` inherit GLS from the parent? Doing so
   means a leak (the child outlives the request and still has stale state); not doing so means
   common patterns (logging in a worker pool) don't work.
3. **`context.Context` already does this explicitly.** Carrying a value through a `Context` is
   the Go-idiomatic answer. It's slightly more verbose but visible at every function boundary.

The thread is closed and reopened roughly every two years. Each time, the conclusion is the
same.

### The Go-idiomatic answer

Pass `context.Context`. For libraries that genuinely cannot thread context (e.g. some logging
packages), the closest thing is `runtime/pprof.Labels`:

```go
import "runtime/pprof"

pprof.Do(ctx, pprof.Labels("request_id", id), func(ctx context.Context) {
    // labels are visible to the profiler for goroutines in this scope
    work(ctx)
})
```

But labels are **profiler-only**: your application code cannot read them. They are for
diagnostics, not for control flow.

### What about `slog`?

The standard library's `slog` package (Go 1.21) is sometimes confused with a GLS feature
because of `slog.Default()` and per-handler attribute sets. But `slog.Default()` is a global
logger, not a per-goroutine one. To attach attributes to a specific request, you pass a
`*slog.Logger` with `With(...)` applied — explicitly, through your function arguments. That's
not GLS; that's normal value passing.

---

## 8. Structured concurrency (discussed)

**Status:** discussion, no accepted proposal.

**Tracking issues:** [#40221](https://go.dev/issue/40221), [#61888](https://go.dev/issue/61888).

### The problem it solves

A `go` statement launches a goroutine that runs independently of the parent. If the parent
function returns, the goroutine keeps running. This is flexible but easy to abuse:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go logRequest(r)         // fire and forget — but what if it errors?
    go updateMetrics(r)       // ditto
    w.WriteHeader(200)
}
```

The launched goroutines have no error path back to the handler. If the server is shutting
down, they keep running. If they panic, they crash the whole process. There is no way to say
"wait for these before returning" without manually adding a `sync.WaitGroup`.

**Structured concurrency** is the principle that every concurrent task has a parent scope, and
the scope does not exit until all tasks finish. The term comes from a 2018 essay by Nathaniel
Smith introducing the "nursery" pattern in Trio, a Python async library.

### Sketches in Go

The discussion has produced several sketches. None has consensus.

**Sketch 1: language-level block.**

```go
go group {
    go fetchA(ctx)
    go fetchB(ctx)
    // implicit Wait at end of block
}
```

The block waits for all goroutines launched with `go` inside it. The block returns when they
all finish.

**Sketch 2: library type.**

```go
g := sync.Group{}
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
err := g.Wait()
```

Essentially `golang.org/x/sync/errgroup.Group` promoted to the standard library. Not a language
change.

### Why neither is accepted

For sketch 1, adding language-level syntax is a high bar. Go has resisted adding new keywords
since version 1.0. The committee wants overwhelming evidence the syntax buys safety the library
cannot.

For sketch 2, `errgroup` already exists and is widely used. Promoting it does not change the
rules of the language. Some argue this is "structured concurrency by convention" and is good
enough.

### The pragmatic position

Use `errgroup.WithContext` for everything. It gives you:

- Wait for all children.
- Propagate context cancellation.
- First error wins.
- Easy to read.

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
if err := g.Wait(); err != nil {
    return err
}
```

If a future Go version adds language-level structured concurrency, your `errgroup` code is
roughly one search-and-replace away from the new syntax.

### A note on goroutine leaks

The strongest argument for structured concurrency is the "fire-and-forget" goroutine leak.
Without a Wait, a goroutine launched in a handler keeps running after the handler returns. If
it eventually crashes, it crashes the whole process. If it eventually writes to a response
writer that's already been used by the next handler, it corrupts data.

This is real, and structured concurrency would prevent it by design. The current Go answer is
"use errgroup and discipline" — which works if everyone on the team follows the rule.

---

## 9. Putting it together: what to expect from Go 1.25+

Looking ahead, here is the realistic shape of the next few Go versions for concurrency:

**Go 1.25 (expected late 2025):**

- `testing/synctest` stable.
- `iter.Pull` and `iter.Pull2` already stable.
- Possibly automatic GOMAXPROCS from cgroup quota.
- Possibly minor `weak` and `runtime.AddCleanup` refinements.

**Go 1.26 and beyond (speculative):**

- Atomic vector ops may or may not land.
- Structured concurrency unlikely as syntax; possible as `sync.Group` library promotion.
- Goroutine-local storage will not land.
- User-mode coroutines may be exposed if compelling use cases emerge.

**What is unlikely ever:**

- A new keyword for concurrency. Go's `go`, `chan`, `select` are the entire vocabulary.
- Channel changes (Go 1 compatibility).
- Memory-model changes that break existing race-free code.

---

## 10. A simple decision rule for adopting future features

If you read this page and wonder "should I use feature X today?", here is a rule of thumb:

| Status | Production code | Test code | Polyfill |
|---|---|---|---|
| Stable in current Go | Yes | Yes | Not needed |
| Stable in next Go | No, wait | Sometimes | Yes if win is large |
| Experimental | No | Behind a build tag | Sometimes |
| Proposed | No | No | If trivial |
| Declined | No | No | Don't |

- `testing/synctest` is experimental but **test-only**, so it's safe to put behind a build tag.
- `weak.Pointer` and `runtime.AddCleanup` are stable in Go 1.24, use them.
- `iter.Pull` is stable in Go 1.23, use it.
- Atomic vector ops are proposed — write a mutex-based polyfill.
- Goroutine-local storage is declined — do not emulate it.

---

## 11. Reading the Go proposal process

Future-looking learning means reading proposal documents. The Go proposal process has a
predictable shape:

1. **Discussion issue.** Someone files `proposal: <package>: <feature>` on `golang/go`. The
   community discusses.
2. **Proposal committee review.** A small group (Russ Cox, Ian Lance Taylor, Robert Griesemer,
   others) reviews periodically. They post structured comments.
3. **Likely accept / Likely decline.** A signal from the committee. The author has time to
   respond.
4. **Accept / Decline.** Final decision.
5. **Implementation.** Sometimes by the proposal author, sometimes by a Go team member.
6. **Release.** The feature ships in a Go version (e.g. Go 1.24).

The proposal **issue** is the canonical source. The Go website's release notes summarize what
landed. The Go blog occasionally has long-form posts on major features. Russ Cox's blog
`research.swtch.com` has the deepest design rationale.

For a junior engineer, the easiest entry point is to read the release notes for a recent Go
version (e.g. [go.dev/doc/go1.24](https://go.dev/doc/go1.24)) and click through to the proposal
issues for any concurrency feature that interests you. You'll quickly absorb the vocabulary
and the kinds of trade-offs the committee weighs.

A pattern that helps: read the **proposal review minutes**. The Go committee periodically posts
minutes summarizing what they discussed and decided in a given week. These are short and tell
you the state of every active proposal at once. Search the issue tracker for "proposal review
minutes" to find them.

---

## 12. Vocabulary check

A few terms used above that are worth defining once:

- **GOEXPERIMENT.** A build-time flag (`GOEXPERIMENT=synctest go build ./...`) that enables
  experimental features in the toolchain. Used during a release cycle to give the feature
  real-world feedback before stabilizing.
- **Bubble.** A `testing/synctest` term for a goroutine group with synthetic time.
- **Push iterator.** An iterator that drives execution and calls a callback per value.
  `iter.Seq` is a push iterator.
- **Pull iterator.** An iterator where the consumer drives by calling `next()`. Returned by
  `iter.Pull`.
- **Coroutine.** A unit of execution with its own stack but cooperatively scheduled, not
  preempted. `iter.Pull` is implemented with coroutines.
- **Weak reference.** A pointer that does not prevent garbage collection of its target.
  `weak.Pointer` in Go.
- **Finalizer / cleanup.** A function the runtime calls when an object is about to be
  collected. `runtime.SetFinalizer` (old) and `runtime.AddCleanup` (new).
- **ABA problem.** A subtle race in CAS-based lock-free data structures where a value changes
  from A to B and back to A while a goroutine is suspended, defeating the CAS check.
- **Cgroup quota.** A Linux kernel feature that limits CPU time available to a process group.
  The basis for Kubernetes CPU limits and the future automatic-GOMAXPROCS proposal.
- **Structured concurrency.** A discipline (and possibly a language feature) where every
  concurrent task has a parent scope that waits for it.
- **Errgroup.** The `golang.org/x/sync/errgroup` package, a small library that gives you wait,
  cancellation, and first-error semantics for a group of goroutines.
- **Polyfill.** A user-written implementation of a proposed feature, intended to give you
  similar semantics today and be swappable when the real feature lands. The term comes from web
  development.

---

## 13. Worked example: building a future-aware utility

To tie everything together, let's build a small utility that uses a current-Go-1.24 feature
mix and is designed to migrate cleanly when more features land.

Imagine we want a "background task manager" that:

- Owns a set of long-lived background goroutines (e.g. periodic flushers, log rotators).
- Provides a `Stop()` that waits for all of them.
- Logs progress with a synthetic clock in tests.

```go
package bgtask

import (
    "context"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

type Manager struct {
    g      *errgroup.Group
    ctx    context.Context
    cancel context.CancelFunc
}

func New(parent context.Context) *Manager {
    ctx, cancel := context.WithCancel(parent)
    g, ctx := errgroup.WithContext(ctx)
    return &Manager{g: g, ctx: ctx, cancel: cancel}
}

func (m *Manager) Go(f func(ctx context.Context) error) {
    m.g.Go(func() error { return f(m.ctx) })
}

func (m *Manager) Stop() error {
    m.cancel()
    return m.g.Wait()
}
```

Usage:

```go
func main() {
    m := bgtask.New(context.Background())
    m.Go(func(ctx context.Context) error {
        ticker := time.NewTicker(1 * time.Second)
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done(): return nil
            case <-ticker.C:    fmt.Println("tick")
            }
        }
    })
    time.Sleep(5 * time.Second)
    _ = m.Stop()
}
```

This uses `errgroup` for structured concurrency by convention. When language-level structured
concurrency lands (if it ever does), the migration is replacing the `Manager` with the new
syntax. Until then, you have the same guarantees.

To test it deterministically with synctest:

```go
//go:build goexperiment.synctest

package bgtask_test

import (
    "context"
    "testing"
    "testing/synctest"
    "time"

    "your/module/bgtask"
)

func TestManagerStopsCleanly(t *testing.T) {
    synctest.Run(func() {
        m := bgtask.New(context.Background())
        m.Go(func(ctx context.Context) error {
            ticker := time.NewTicker(1 * time.Second)
            defer ticker.Stop()
            for {
                select {
                case <-ctx.Done(): return nil
                case <-ticker.C:
                }
            }
        })
        synctest.Wait()
        time.Sleep(5 * time.Second)
        if err := m.Stop(); err != nil {
            t.Fatal(err)
        }
    })
}
```

This test runs in microseconds and exercises five synthetic seconds of background work.

---

## 14. What to do with this knowledge

You won't ship code using experimental features in your first job. But you should:

1. Recognize the names when senior engineers mention them in code review.
2. Be able to explain (in a sentence) what each one does.
3. Know which Go version each became stable, or that it is still proposed.
4. Read the relevant release notes when a new Go version drops.

This is mostly literacy work. The proposals in this page will mature over the next 2-5 Go
versions. By the time you are a middle-tier engineer, several of them will be the right answer
to common production problems, and you'll already know where to look them up.

The next page (`professional.md`) goes deeper into how a senior engineer plans codebase
migrations around these proposals — when to polyfill, when to wait, when to refactor
pre-emptively. For now, you have the survey.

A final reminder: this content will age. Re-read the proposal issues when you next encounter
them in code. The status field at the top of each section tells you what to verify. The Go
release notes always tell you the truth about what shipped.
