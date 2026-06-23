# Go Garbage Collection — Tasks

---

## Task 1 — GC Trace

**Difficulty**: Beginner

```bash
GODEBUG=gctrace=1 go run main.go 2>gc.log
```

Run a small program and inspect each line. Decode each field.

---

## Task 2 — Tune GOGC

**Difficulty**: Beginner

Run a benchmark with different GOGC values:
```bash
GOGC=50  go test -bench=. -benchmem
GOGC=100 go test -bench=.
GOGC=200 go test -bench=.
```

Compare allocation rate and CPU time.

---

## Task 3 — Memory Limit

**Difficulty**: Intermediate

```go
import "runtime/debug"

func main() {
    debug.SetMemoryLimit(int64(50 * 1024 * 1024)) // 50 MB
    
    // Allocate progressively
    var alloc [][]byte
    for i := 0; i < 100; i++ {
        alloc = append(alloc, make([]byte, 1<<20)) // 1 MB
        time.Sleep(100 * time.Millisecond)
    }
}
```

Observe how GC adapts as you approach the limit.

---

## Task 4 — Force GC and Measure Pause

**Difficulty**: Intermediate

```go
import "runtime"

func measurePause() {
    var ms runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&ms)
    pause := ms.PauseNs[(ms.NumGC+255)%256]
    fmt.Printf("Last GC pause: %d ns\n", pause)
}
```

---

## Task 5 — Heap Profile

**Difficulty**: Intermediate

```bash
go test -bench=. -memprofile=mem.out
go tool pprof mem.out
top
```

Identify top allocators.

---

## Task 6 — sync.Pool to Reduce GC

**Difficulty**: Advanced

Convert a hot allocation site to use sync.Pool. Compare GC frequency before/after with `gctrace`.

```go
var pool = sync.Pool{New: func() any { return new(Buffer) }}

func use() {
    b := pool.Get().(*Buffer)
    defer func() { b.Reset(); pool.Put(b) }()
    // use b
}
```

---

## Task 7 — Reduce Pointer Density

**Difficulty**: Advanced

Convert `[]*Item` to `[]Item` where ownership is exclusive. Measure GC pause time with both variants.

---

## Task 8 — Live Profile Heap

**Difficulty**: Advanced

```go
import _ "net/http/pprof"

go http.ListenAndServe("localhost:6060", nil)
```

Then:
```bash
go tool pprof http://localhost:6060/debug/pprof/heap
```

Inspect live heap of a running service.

---

## Task 9 — `debug.FreeOSMemory`

**Difficulty**: Advanced

```go
runtime.GC()
debug.FreeOSMemory()
```

Run after a known-large data structure is dropped. Observe RSS reduction (via `ps` or `/proc/PID/status`).

---

## Task 10 — Detect Goroutine Leak

**Difficulty**: Advanced

```go
import "runtime"

n := runtime.NumGoroutine()
// run suspect code
runtime.GC()
n2 := runtime.NumGoroutine()
if n2 > n { fmt.Println("leak detected") }
```

For deeper analysis: `pprof goroutine`.
