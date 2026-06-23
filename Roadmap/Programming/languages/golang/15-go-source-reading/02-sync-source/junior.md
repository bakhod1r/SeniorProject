# Reading the `sync` Package Source — Junior

## 1. What `sync` is for

The `sync` package is Go's grab-bag of low-level concurrency primitives. Channels handle the "communicate to coordinate" style; `sync` handles the cases where channels would be overkill or wrong — protecting a shared field, waiting for a batch of goroutines to finish, doing one-time initialization, or pooling expensive objects.

What's in the box:

| Primitive | One-line job |
|-----------|-------------|
| `sync.Mutex` | Mutual exclusion. One goroutine in the critical section at a time. |
| `sync.RWMutex` | Many readers OR one writer. |
| `sync.WaitGroup` | "Wait for N goroutines to call `Done`." |
| `sync.Once` | "Run this function exactly once, no matter how many goroutines try." |
| `sync.Cond` | Condition variable — goroutines wait until signaled. |
| `sync.Pool` | A free-list of reusable objects (reset each GC). |
| `sync.Map` | A concurrent map tuned for read-heavy, append-mostly access. |
| `sync.OnceValue`, `OnceFunc`, `OnceValues` | (Go 1.21+) typed helpers around `Once`. |

Every primitive is implemented in pure Go on top of a tiny runtime hook (`runtime_Semacquire` / `runtime_Semrelease`). That hook is the bridge between user-land `sync` and the kernel-aware scheduler.

> If you've never read this package, start with `mutex.go`. It's the smallest interesting file in the standard library — about 250 lines of code and 200 lines of comments.

---

## 2. Where the source lives

```bash
go env GOROOT
ls $(go env GOROOT)/src/sync
```

The file map you should leave with:

| File | Contents |
|------|----------|
| `mutex.go` | `Mutex` — state machine + spinning + sema park |
| `rwmutex.go` | `RWMutex` — built on top of `Mutex` + two semaphores |
| `waitgroup.go` | `WaitGroup` — atomic counter + sema for `Wait` |
| `once.go` | `Once.Do` — atomic flag + slow path |
| `cond.go` | `Cond` — notify list, built on runtime helpers |
| `pool.go` | `Pool` — per-P local pools, drained by GC |
| `map.go` | `Map` — two-tier (read-only + dirty) concurrent map |
| `runtime.go` | The `go:linkname` bridge to the runtime |
| `oncefunc.go` | (1.21+) `OnceFunc`, `OnceValue`, `OnceValues` |

Same code on GitHub: `github.com/golang/go/tree/master/src/sync`. Pin to a tag (e.g. `go1.22.0`) — the internals shift between versions, especially `Map` and `Pool`.

---

## 3. Prerequisites

- Comfort with goroutines and channels.
- A vague feel for what "atomic" means (no torn reads, no interleaving on a single op).
- Willingness to read code that uses `unsafe.Pointer` and `atomic.Int32` — `sync` is a low-level package and it shows.

You do **not** need to know the scheduler internals. The runtime appears here only through two function names (see section 5).

---

## 4. Glossary

| Term | Meaning |
|------|---------|
| **Critical section** | Code between `Lock()` and `Unlock()` — only one goroutine at a time |
| **Race** | Two goroutines touching the same memory, at least one writing, no synchronization between them — undefined behavior |
| **Semaphore (sema)** | A counter-based blocking primitive; the runtime exposes one for `sync` to build on |
| **Spinning** | Busy-looping a few iterations before parking, in case the lock is released immediately |
| **Park / unpark** | Take a goroutine off the run queue (park) and put it back on (unpark) — done via `runtime_Semacquire`/`runtime_Semrelease` |
| **`go:linkname`** | A compiler directive that lets one package call an unexported function in another package |
| **Race detector** | `go run -race` / `go test -race` — instruments memory accesses to find data races |

---

## 5. The bridge: `runtime.go` and `go:linkname`

The `sync` package does not import `runtime`. It can't — `runtime` doesn't export the functions `sync` needs. Instead, `sync/runtime.go` declares them as Go function signatures with no body, and tells the linker to wire them up to runtime internals:

```go
// from sync/runtime.go (paraphrased)

// Semacquire waits until *s > 0, then atomically decrements it.
// Implemented in runtime/sema.go.
func runtime_Semacquire(s *uint32)

// Semrelease atomically increments *s and wakes one waiter, if any.
func runtime_Semrelease(s *uint32, handoff bool, skipframes int)
```

In the runtime source you'll find the matching declarations:

```go
// from runtime/sema.go

//go:linkname sync_runtime_Semacquire sync.runtime_Semacquire
func sync_runtime_Semacquire(addr *uint32) { ... }

//go:linkname sync_runtime_Semrelease sync.runtime_Semrelease
func sync_runtime_Semrelease(addr *uint32, handoff bool, skipframes int) { ... }
```

That's the entire bridge. `Mutex.Lock` calls `runtime_Semacquire` when it has to block; the runtime parks the goroutine, the scheduler runs something else, and when `Unlock` calls `runtime_Semrelease` the goroutine is made runnable again.

> Without this bridge, `sync.Mutex` would have to spin forever or call back into the OS — both terrible. The runtime hook is what makes Go locks cheap.

---

## 6. Why `sync.Mutex` is only 8 bytes

Open `mutex.go`. The type is tiny:

```go
type Mutex struct {
    state int32
    sema  uint32
}
```

That's 8 bytes total (on every architecture). All the cleverness is in how those two fields are used:

- `state` packs three things into one int32: a *locked* bit, a *woken* bit, a *starving* bit, and a waiter count in the high bits. One atomic CAS updates all four at once.
- `sema` is a semaphore address passed to `runtime_Semacquire`. When the fast-path CAS fails, the goroutine parks on this semaphore until `Unlock` releases it.

The fast path of `Lock` is one line:

```go
if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
    return
}
```

If nobody holds the mutex (`state == 0`), set the locked bit and you're done — no system call, no scheduler involvement. That's why uncontended `Mutex` is ~10ns. The slow path (`lockSlow`) handles contention with a bit of spinning and then a sema park.

A `pthread_mutex_t` on Linux is 40 bytes. Go's is 8. That's the win of building locks on a runtime instead of on the OS.

---

## 7. A small worked example

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var (
        mu    sync.Mutex
        wg    sync.WaitGroup
        total int
    )

    for i := 1; i <= 100; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            mu.Lock()
            total += n
            mu.Unlock()
        }(i)
    }
    wg.Wait()
    fmt.Println("total:", total) // 5050
}
```

Two `sync` primitives are doing different jobs:

- **`Mutex`** keeps the `total += n` atomic with respect to other goroutines. Without it, increments are lost (run it with `-race` to see the report).
- **`WaitGroup`** lets `main` block until all 100 goroutines finish. `Add(1)` bumps a counter, `Done()` decrements it, `Wait()` parks on the counter via `runtime_Semacquire`.

Run it:

```bash
go run -race main.go
```

If you delete the `Lock`/`Unlock`, `-race` will print a data race report. If you delete the `WaitGroup`, `main` exits before the goroutines finish and the output is some random partial sum.

---

## 8. The race detector and `sync`

Every `sync` primitive has *race annotations* — calls into the race detector that say "I'm a synchronization point, so any memory writes before `Unlock` happen-before any reads after the matching `Lock`". You'll see them in the source as:

```go
if race.Enabled {
    race.Acquire(unsafe.Pointer(m))
}
```

You don't need to understand the detector internals at this level. The takeaway: `sync` primitives don't just *prevent* races at runtime — they *teach* `-race` what is and isn't a race. That's why a homemade spinlock built on `atomic` alone will pass `-race` only if you remember to add those annotations yourself.

---

## 9. The other primitives in one line each

- **`RWMutex`** (`rwmutex.go`): a `Mutex` for writers plus an atomic reader count. Readers fast-path through `RLock` without touching the writer mutex; writers must wait for readers to drain.
- **`WaitGroup`** (`waitgroup.go`): a single `uint64` holding (counter, waiter count) plus a sema. `Wait` parks if counter > 0; `Done` releases when counter hits 0.
- **`Once`** (`once.go`): an atomic flag + a mutex. Fast path is one atomic load; slow path takes the mutex and runs the function exactly once.
- **`Cond`** (`cond.go`): wraps `runtime_notifyList*` calls. `Wait` releases a paired `Locker`, parks, and re-acquires on wake.
- **`Pool`** (`pool.go`): a per-P local stack of objects + a "victim" pool. Cleared *every GC*.
- **`Map`** (`map.go`): two layers — an atomic read-only snapshot for the hot path, and a `Mutex`-guarded dirty map for misses. Promotes dirty → read after enough misses.

Each is worth opening once. None is more than ~500 lines.

---

## 10. Common confusions

- **"Pass a `Mutex` by pointer." Mostly.** A `Mutex` must not be *copied after first use*. Passing it by value at construction time is fine; passing it by value after `Lock` has been called copies the state and breaks everything. `go vet` will warn (`copies lock value`).
- **"`RWMutex` prefers readers." Not exactly.** Modern `RWMutex` blocks new readers once a writer is waiting, to prevent writer starvation. If you have many readers and one writer, the writer still gets through.
- **"`Pool` is a cache." No.** `sync.Pool` is a *free-list*, not a cache. Anything in it can disappear at the next GC. Never use it for things that must survive (DB connections, compiled regexes you can't rebuild).
- **"`sync.Map` is always faster than a `map` + `Mutex`." No.** It's tuned for *read-mostly, append-mostly* workloads with many keys and few writes. For a small map with mixed reads and writes, a `map[K]V` guarded by a `Mutex` is faster.
- **"`Once.Do(f)` runs `f` in the calling goroutine on the first call." Yes — and *every* subsequent caller blocks until the first call returns.** This is the surprise behind deadlocks where the function passed to `Do` recursively calls `Do` on the same `Once`.
- **"`WaitGroup.Add` can be called inside a goroutine." Don't.** Call `Add` before the `go` statement, otherwise `Wait` may return before that goroutine even starts.

---

## 11. A recipe for reading the source

1. `go env GOROOT` — find it.
2. Open `sync/mutex.go`. Read the top comment block — it's a complete spec of the algorithm.
3. Read `Lock`. It's three lines if uncontended. Follow `lockSlow` only if you're curious; skip it on the first pass.
4. Open `sync/runtime.go`. Note that it's just signatures.
5. Open `runtime/sema.go` and search for `sync_runtime_Semacquire`. That's where the goroutine actually parks.
6. Stop. Come back tomorrow for `waitgroup.go`.

Reading `sync` is much easier than reading `runtime` — there's less of it, the files are independent, and the algorithms are documented in the source itself. Treat the comments as the spec; the code as the implementation of the spec.

---

## 12. Summary

The `sync` package is ~2000 lines of Go that give you mutexes, wait groups, once-init, condition variables, object pools, and a concurrent map. It is built on a single runtime bridge — `runtime_Semacquire` / `runtime_Semrelease` — wired up via `go:linkname`. The fast paths use atomics; the slow paths park goroutines through the runtime. Each primitive is small enough to read in one sitting. Start with `mutex.go`, see how 8 bytes become a working lock, and then walk outward to `waitgroup.go`, `once.go`, and the rest.

---

## Further reading

- Go source: `https://github.com/golang/go/tree/master/src/sync` (pin to a tag like `go1.22.0`)
- `runtime/sema.go` — the other half of the `sync`/runtime bridge
- "Go sync.Mutex: Normal and Starvation Mode" — Vincent Blanchon, Medium
- "sync.Pool: the Right Way to Use It" — Damian Gryski
- `pkg.go.dev/sync` — official docs with rationale for each type
- Russ Cox, "Off to the Races" — background on Go's memory model and race detector
