# Go Memory Management — Tasks

---

## Task 1 — Verify Stack Allocation

**Difficulty**: Beginner

```go
func leaf() int {
    n := 5
    return n
}
```

Run `go build -gcflags="-m" .` and verify `n` doesn't escape.

---

## Task 2 — Verify Heap Escape

**Difficulty**: Beginner

```go
func makePtr() *int {
    n := 5
    return &n
}
```

Run `go build -gcflags="-m"`. Should see "moved to heap: n".

---

## Task 3 — Pre-Allocate Slice

**Difficulty**: Beginner

Before:
```go
var s []int
for i := 0; i < 1000; i++ { s = append(s, i) }
```

After:
```go
s := make([]int, 0, 1000)
// same loop
```

Benchmark with `go test -bench -benchmem`. Pre-allocated should be ~3× faster.

---

## Task 4 — `sync.Pool` for Buffer Reuse

**Difficulty**: Intermediate

```go
var pool = sync.Pool{New: func() any { return new(Buffer) }}

func use() {
    b := pool.Get().(*Buffer)
    defer func() { b.Reset(); pool.Put(b) }()
    // use b
}
```

Implement `Buffer.Reset` to clear state.

---

## Task 5 — Monitor MemStats

**Difficulty**: Intermediate

```go
import "runtime"
import "time"

func monitor() {
    var ms runtime.MemStats
    for {
        runtime.ReadMemStats(&ms)
        fmt.Printf("Heap: %d MB, GC: %d\n",
            ms.HeapAlloc/(1024*1024), ms.NumGC)
        time.Sleep(5 * time.Second)
    }
}

go monitor()
```

Run for a few minutes; observe heap fluctuations.

---

## Task 6 — Set Memory Limit

**Difficulty**: Intermediate

```go
import "runtime/debug"

func main() {
    debug.SetMemoryLimit(int64(100 * 1024 * 1024)) // 100 MB
    // Allocate progressively; observe how GC adapts
}
```

Verify by allocating a lot; the GC should run more aggressively as you approach the limit.

---

## Task 7 — Sub-Slice Memory Release

**Difficulty**: Advanced

```go
big := make([]byte, 1<<20) // 1 MB
small := big[:10]
// Goal: release 1 MB while keeping `small`
```

Solution: copy out:
```go
small := make([]byte, 10)
copy(small, big[:10])
big = nil
runtime.GC()
```

Verify with `MemStats.HeapAlloc`.

---

## Task 8 — Allocation Profile

**Difficulty**: Advanced

```bash
go test -bench=. -benchmem -memprofile=mem.out
go tool pprof -alloc_space mem.out
# At pprof prompt: top
```

Identify top allocators in your code.

---

## Task 9 — Heap Profile in Live Service

**Difficulty**: Advanced

```go
import _ "net/http/pprof"

go func() {
    http.ListenAndServe("localhost:6060", nil)
}()
```

Then:
```bash
go tool pprof http://localhost:6060/debug/pprof/heap
```

Inspect live heap.

---

## Task 10 — GC Trace Analysis

**Difficulty**: Advanced

```bash
GODEBUG=gctrace=1 ./prog 2>gc.log
```

Parse `gc.log` to extract heap size at each GC, GC frequency, average pause time. Plot trends.
