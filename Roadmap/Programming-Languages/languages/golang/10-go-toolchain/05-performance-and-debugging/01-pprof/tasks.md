# pprof — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+. Install Graphviz first (`brew install graphviz` or `apt install graphviz`) for the `web` / `-http` views.

---

## Task 1: First CPU profile from a benchmark

Write a benchmark that does some real work (e.g., sum 1M ints in a loop).

```go
func BenchmarkSum(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := 0
        for j := 0; j < 1_000_000; j++ { s += j }
        _ = s
    }
}
```

**Acceptance criteria**
- [ ] `go test -bench=BenchmarkSum -cpuprofile=cpu.prof -benchtime=3s` succeeds and produces `cpu.prof`.
- [ ] `ls -l cpu.prof` shows a non-empty file.
- [ ] `go tool pprof -top cpu.prof` lists `BenchmarkSum` (or the loop's caller) in the top entries.

---

## Task 2: Open the profile in the browser

Open the profile from Task 1 in the web UI.

**Acceptance criteria**
- [ ] `go tool pprof -http=:8080 cpu.prof` opens a browser tab.
- [ ] You navigate to **View → Flame Graph** and see the call stack.
- [ ] You identify the widest box near the top and can name the function it represents.

---

## Task 3: Read source line attribution

In the terminal pprof, look at per-line samples of the hot function.

**Acceptance criteria**
- [ ] `go tool pprof cpu.prof` → `list BenchmarkSum` prints annotated source with per-line sample counts.
- [ ] You can point to the single hottest source line.
- [ ] You run `peek BenchmarkSum` and identify its caller and callees.

---

## Task 4: Profile a live HTTP server

Build a tiny server with `net/http/pprof` and capture from it.

```go
package main

import (
    "net/http"
    _ "net/http/pprof"
    "time"
)

func main() {
    http.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
        end := time.Now().Add(50 * time.Millisecond)
        for time.Now().Before(end) {} // burn CPU
        w.Write([]byte("ok"))
    })
    http.ListenAndServe("127.0.0.1:6060", nil)
}
```

Run it, hit `/work` in a loop, capture a profile.

**Acceptance criteria**
- [ ] The server is running on `127.0.0.1:6060`.
- [ ] `for i in $(seq 200); do curl -s localhost:6060/work >/dev/null; done &` keeps it busy.
- [ ] `curl -o cpu.prof "http://127.0.0.1:6060/debug/pprof/profile?seconds=10"` returns a non-empty file.
- [ ] Opening it shows the busy loop in `/work` as the hot path.

---

## Task 5: Compare two profiles with `-base`

Capture a baseline, optimize a function, capture again, view the delta.

**Acceptance criteria**
- [ ] You have `before.prof` from the original code and `after.prof` after a change.
- [ ] `go tool pprof -http=:8080 -base=before.prof after.prof` opens.
- [ ] You can identify a function whose sample delta is **negative** (improved) and explain why.

---

## Task 6: Capture and analyze a heap profile

Write a program that builds a 100MB `[]byte` slice and holds it.

```go
package main

import (
    "net/http"
    _ "net/http/pprof"
    "time"
)

var leak [][]byte

func main() {
    go func() {
        for {
            leak = append(leak, make([]byte, 1<<20)) // 1MB each
            time.Sleep(10 * time.Millisecond)
        }
    }()
    http.ListenAndServe("127.0.0.1:6060", nil)
}
```

Capture and identify the largest live type.

**Acceptance criteria**
- [ ] `curl -o heap.prof http://127.0.0.1:6060/debug/pprof/heap` after ~5s.
- [ ] `go tool pprof -inuse_space -top heap.prof` shows `main.main.func1` or similar holding ~tens of MB.
- [ ] You can name the source line that allocates the slices.

---

## Task 7: Identify a goroutine leak

Modify the server: every request starts a goroutine that waits forever on a channel.

```go
http.HandleFunc("/leak", func(w http.ResponseWriter, r *http.Request) {
    go func() { ch := make(chan struct{}); <-ch }()
    w.Write([]byte("ok"))
})
```

Hit it 1000 times.

**Acceptance criteria**
- [ ] `curl http://127.0.0.1:6060/debug/pprof/goroutine?debug=1` shows >1000 goroutines.
- [ ] One stack frame is dominated by `main.main.func2` (or your leak func) parked in `chan receive` / `runtime.gopark`.
- [ ] You can explain why the CPU profile does **not** show this leak (parked goroutines are off-CPU).

---

## Task 8: Configure block and mutex profiling

Add a contended mutex to your program and capture its profile.

```go
var mu sync.Mutex
http.HandleFunc("/contend", func(w http.ResponseWriter, r *http.Request) {
    mu.Lock(); defer mu.Unlock()
    time.Sleep(20 * time.Millisecond)
    w.Write([]byte("ok"))
})
```

In `main`, call:

```go
runtime.SetBlockProfileRate(1)
runtime.SetMutexProfileFraction(1)
```

Hit `/contend` from 50 parallel curls.

**Acceptance criteria**
- [ ] `curl -o block.prof http://127.0.0.1:6060/debug/pprof/block` is non-empty.
- [ ] `curl -o mutex.prof http://127.0.0.1:6060/debug/pprof/mutex` is non-empty.
- [ ] `go tool pprof -top mutex.prof` lists your handler as the top contender.
- [ ] You disable the rates again (`SetBlockProfileRate(0)`, `SetMutexProfileFraction(0)`) and confirm new captures are empty.

---

## Task 9: Label slices of work with `pprof.Do`

Add labels around two distinct code paths and view them separately.

```go
import "runtime/pprof"

pprof.Do(r.Context(), pprof.Labels("op", "search"), func(ctx context.Context) {
    runSearch()
})
pprof.Do(r.Context(), pprof.Labels("op", "render"), func(ctx context.Context) {
    runRender()
})
```

**Acceptance criteria**
- [ ] After a CPU capture under load, `go tool pprof cpu.prof` → `tags` lists `op: search` and `op: render`.
- [ ] `top -tagfocus=op:search` shows samples only from the search path.
- [ ] The same in the `-http` UI under the **Refine** menu (Tag focus).
