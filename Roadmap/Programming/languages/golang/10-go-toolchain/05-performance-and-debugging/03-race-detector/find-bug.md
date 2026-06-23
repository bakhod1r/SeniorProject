# Race Detector — Find the Bug

Each scenario shows a command or program that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — `-race` silently does nothing

```bash
$ go run main.go -race
```

**Bug:** `-race` is positioned *after* the file, so it is forwarded to the program as a command-line argument. The build is not instrumented; the detector never runs.
**Fix:** put build flags before the package/file: `go run -race main.go` (or `go run -race .`). To confirm, trigger a known race and verify the report appears.

---

## Bug 2 — Expecting a race report on single-goroutine code

```go
package main

import "fmt"

func main() {
    x := 0
    for i := 0; i < 1000; i++ {
        x++
    }
    fmt.Println(x)
}
```

```bash
$ go run -race main.go   # no DATA RACE — why?
```

**Bug:** there is only one goroutine. A race requires **two** goroutines accessing the same memory; `x++` on the main goroutine alone is sequential. The detector is doing its job — there is nothing to find.
**Fix:** none needed; this is a misunderstanding of what a data race is. If you wanted to test the detector, spawn goroutines.

---

## Bug 3 — Concurrent map read/write

```go
m := map[string]int{}
go func() {
    for i := 0; i < 1000; i++ { m[strconv.Itoa(i)] = i }
}()
go func() {
    for i := 0; i < 1000; i++ { _ = m[strconv.Itoa(i)] }
}()
```

**Bug:** Go maps are not safe for concurrent read+write. Even with `-race` off, the runtime may panic with `fatal error: concurrent map read and map write`. With `-race` on, you get a clear `DATA RACE` report first.
**Fix:** wrap accesses with a `sync.RWMutex`, use `sync.Map` for the right access patterns, or shard the map. Do not assume map operations are atomic.

---

## Bug 4 — `sync.Once` misused for "init then read"

```go
var (
    once   sync.Once
    config map[string]string
)

func reload() {
    once.Do(func() { config = loadConfig() })
}

func get(k string) string {
    return config[k]   // racy with reload() called from another goroutine the first time
}
```

**Bug:** `sync.Once` guarantees `Do`'s body runs once and that subsequent `Do` calls observe the body's effects. But `get` reads `config` **without** going through `once.Do`, so the very first reader has no happens-before edge to the writer.
**Fix:** read `config` through a helper that calls `once.Do` first, or initialize `config` at package init, or use `atomic.Pointer[map[string]string]` for live reload.

---

## Bug 5 — `time.Now()`-based "synchronization" in a benchmark

```go
go produce()
time.Sleep(10 * time.Millisecond)
go consume()
```

**Bug:** `time.Sleep` is not a synchronization primitive. The detector sees no happens-before edge between `produce` and `consume`; any shared state they touch races. The sleep just *usually* hides the race in benchmark timings.
**Fix:** synchronize properly — a channel `done` send/receive, a `sync.WaitGroup`, or a mutex protecting the shared state.

---

## Bug 6 — Race on a slice header even with disjoint indices

```go
var s []int
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        s = append(s, i)   // "each goroutine touches a different element" — wrong
    }(i)
}
wg.Wait()
```

**Bug:** `append` reads and writes the slice header (pointer, length, capacity) and may reallocate the backing array. All goroutines race on the header even if their values would land in different positions.
**Fix:** preallocate `s := make([]int, 100)` and have each goroutine write `s[i] = i` (disjoint indices, no append), or send results over a channel and have one goroutine collect them.

---

## Bug 7 — `atomic.Value` vs `interface{}` race

```go
var current interface{}
go func() { current = newConfig() }()
go func() { _ = current.(*Config) }()
```

**Bug:** assigning to and reading from an `interface{}` is **two-word** (type pointer + data pointer). A reader can observe a half-updated interface — wrong type pointer with new data, or vice versa — which the detector reports as a race (and which can crash). Plain `interface{}` is not atomic.
**Fix:** use `atomic.Value` (or `atomic.Pointer[Config]` in Go 1.19+):

```go
var current atomic.Value
current.Store(newConfig())
cfg := current.Load().(*Config)
```

---

## Bug 8 — "Channels prevent all races"

```go
type Cache struct{ m map[string]int }
ch := make(chan *Cache)
go func() {
    c := &Cache{m: map[string]int{}}
    ch <- c
    c.m["x"] = 1      // writer keeps mutating after handing the value over
}()
c := <-ch
_ = c.m["x"]          // racy — the sender did not relinquish ownership
```

**Bug:** the channel transferred the pointer correctly, but the sending goroutine **continued to mutate** the value after sending. The channel only synchronizes the moment of send/recv; ongoing access to shared memory still requires the sender to stop touching it.
**Fix:** the sender must not touch the value after sending (ownership transfer). Or use a `sync.Mutex` inside `Cache`. The Go idiom: *"Do not communicate by sharing memory; share memory by communicating"* — and stop sharing once you have communicated.

---

## Bug 9 — Long-running benchmark with `-race` and skewed results

```bash
go test -bench=. -race ./...   # numbers are 5x worse than real, used for capacity planning
```

**Bug:** `-race` is on, so the benchmark numbers reflect the instrumented overhead, not real production cost. Decisions based on these numbers will be wrong.
**Fix:** run benchmarks without `-race`. Use `-race` for correctness (`go test -race`), `-bench=.` (without `-race`) for performance.

---

## Bug 10 — "Detector is flaky" excuse

A failing `-race` report appears once in 50 CI runs and the team marks the test "flaky."

**Bug:** the detector does not produce false positives. A single `DATA RACE` report is a real bug — it just only manifests in certain interleavings. Marking it "flaky" hides a real concurrency defect that will eventually corrupt data or crash production.
**Fix:** treat every `DATA RACE` report as a P1 bug. Reproduce with `-count=N -run=...` and fix the underlying synchronization.

---

## How to approach these
1. Did the detector even run? → check `-race` is before the package, not after.
2. Did the test exercise concurrency? → no goroutines means no race to find.
3. Map/slice/interface looks safe? → check whether the *header* (not just the elements) is shared.
4. Did you "synchronize" with `time.Sleep` or a flag? → that is not synchronization; replace with channel/mutex/atomic.
5. `sync.Once`-protected init? → readers must also go through the same edge.
6. Benchmarks under `-race`? → numbers are not real; drop `-race`.
7. A `DATA RACE` report? → it is real. Always real. No "flaky detector."
