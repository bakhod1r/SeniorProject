# Detecting Goroutine Leaks — Tasks

> Hands-on exercises. Each task gives a goal, a starting point, an expected output, and "what to learn." Solutions appear after each task. Type the code yourself; do not just read. The whole point of leak detection is muscle memory.

---

## Task Index

1. [Count goroutines around a suspect function](#task-1)
2. [Spawn a leak intentionally, observe in pprof](#task-2)
3. [Add `goleak.VerifyTestMain` to a package](#task-3)
4. [Catch a leak with `goleak.VerifyNone`](#task-4)
5. [Dump goroutines on SIGUSR1](#task-5)
6. [Read a `debug=2` stack and identify the parked line](#task-6)
7. [Diff two profiles taken minutes apart](#task-7)
8. [Use `pprof.Do` to label and filter](#task-8)
9. [Build a leak watcher with thresholds](#task-9)
10. [Compare `runtime.Stack` and `pprof.Lookup` output](#task-10)
11. [Drive `go tool pprof` interactively](#task-11)
12. [Capture a `runtime/trace` and find a never-ending goroutine](#task-12)
13. [Detect leaks in a streaming server](#task-13)
14. [Write a custom detector](#task-14)
15. [Integrate a leak gate into CI](#task-15)

---

## <a id="task-1"></a>Task 1 — Count goroutines around a suspect function

**Goal:** Write a helper `countAround(fn func()) (before, after int)` that runs `fn`, returns goroutine counts before and after.

**Expected output:**
```
before=1 after=11 delta=10
```

**Starter:**

```go
package main

func countAround(fn func()) (int, int) {
    // your code
}

func suspect() {
    for i := 0; i < 10; i++ {
        go func() { ch := make(chan int); <-ch }()
    }
}

func main() {
    b, a := countAround(suspect)
    fmt.Printf("before=%d after=%d delta=%d\n", b, a, a-b)
}
```

**Solution:**

```go
import (
    "runtime"
    "time"
)

func countAround(fn func()) (int, int) {
    runtime.GC()
    before := runtime.NumGoroutine()
    fn()
    time.Sleep(20 * time.Millisecond) // let spawned goroutines actually start
    runtime.GC()
    after := runtime.NumGoroutine()
    return before, after
}
```

**What to learn:** Always GC and sleep briefly before counting. A spawned goroutine may not yet be scheduled.

---

## <a id="task-2"></a>Task 2 — Spawn a leak intentionally, observe in pprof

**Goal:** Write a tiny HTTP server with one handler that leaks one goroutine per request. Hit it 5 times. Curl `/debug/pprof/goroutine?debug=2` and confirm you see 5 goroutines parked.

**Expected:** Each leaked goroutine appears as a block starting with `goroutine N [chan send]:` and a stack ending in `created by main.leakHandler`.

**Solution:**

```go
package main

import (
    "fmt"
    "log"
    "net/http"
    _ "net/http/pprof"
)

func leakHandler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan int)
    go func() {
        ch <- 1 // leak: no receiver
    }()
    fmt.Fprintln(w, "ok")
}

func main() {
    http.HandleFunc("/leak", leakHandler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Run, then:

```
for i in 1 2 3 4 5; do curl -s localhost:8080/leak; done
curl -s 'localhost:8080/debug/pprof/goroutine?debug=2' | grep -c 'chan send'
```

Expected count: at least 5 (plus any incidental ones).

**What to learn:** Importing `net/http/pprof` is one line and gives you the full inspection toolkit.

---

## <a id="task-3"></a>Task 3 — Add `goleak.VerifyTestMain` to a package

**Goal:** Take a small package with a passing test that secretly leaks a goroutine; adopt `goleak.VerifyTestMain`; watch the test fail; fix the leak; watch it pass.

**Starter (`worker.go`):**

```go
package worker

func StartWorker() {
    go func() {
        ch := make(chan int)
        <-ch // leak
    }()
}
```

**Test:**

```go
package worker

import "testing"

func TestStart(t *testing.T) {
    StartWorker()
}
```

`go test` passes. Now add `goleak`:

```go
package worker

import (
    "testing"
    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`go test` now fails:

```
goleak: Errors on successful test run: found unexpected goroutines:
[Goroutine N in state chan receive, with worker.StartWorker.func1 on top of the stack:
goroutine N [chan receive]:
worker.StartWorker.func1()
        /tmp/worker.go:7 +0x...
created by worker.StartWorker
        /tmp/worker.go:5 +0x...
]
```

Fix by giving `StartWorker` a stop signal:

```go
package worker

type Worker struct {
    stop chan struct{}
}

func StartWorker() *Worker {
    w := &Worker{stop: make(chan struct{})}
    go func() {
        ch := make(chan int)
        select {
        case <-ch:
        case <-w.stop:
        }
    }()
    return w
}

func (w *Worker) Stop() { close(w.stop) }
```

Test:

```go
func TestStart(t *testing.T) {
    w := StartWorker()
    w.Stop()
}
```

Now `go test` passes with `goleak` enabled.

**What to learn:** `goleak` turns silent leaks into loud test failures. Every package gets a `TestMain`.

---

## <a id="task-4"></a>Task 4 — Catch a leak with `goleak.VerifyNone`

**Goal:** Use `goleak.VerifyNone(t)` inside a single test instead of `TestMain`.

**Solution:**

```go
func TestPipeline_NoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)

    in := make(chan int)
    out := make(chan int)
    done := make(chan struct{})

    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- v * 2:
            case <-done:
                return
            }
        }
    }()

    close(in)
    close(done)
    for range out {
    }
}
```

If you forget `close(in)`, the goroutine leaks waiting for input, and `VerifyNone` fails the test.

**What to learn:** `VerifyNone` is per-test, ideal for granular assertions about a specific scenario.

---

## <a id="task-5"></a>Task 5 — Dump goroutines on SIGUSR1

**Goal:** Write a small program that prints a full goroutine dump to stderr when it receives `SIGUSR1`.

**Solution:**

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "runtime/pprof"
    "syscall"
    "time"
)

func main() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    go func() {
        for range c {
            fmt.Fprintln(os.Stderr, "--- goroutine dump ---")
            _ = pprof.Lookup("goroutine").WriteTo(os.Stderr, 2)
            fmt.Fprintln(os.Stderr, "--- end ---")
        }
    }()

    // leak a few goroutines for the demo
    for i := 0; i < 3; i++ {
        go func() { ch := make(chan int); <-ch }()
    }

    fmt.Println("pid:", os.Getpid(), "send SIGUSR1 to dump")
    time.Sleep(1 * time.Hour)
}
```

Run, then in another terminal:

```
kill -USR1 <pid>
```

You see the dump on stderr.

**What to learn:** Signal-driven dumps are the lightest production debugging tool. No HTTP, no agent, just `kill`.

---

## <a id="task-6"></a>Task 6 — Read a `debug=2` stack and identify the parked line

**Goal:** Given the following stack, name the file:line where the goroutine is parked and the function that spawned it.

```
goroutine 47 [chan receive, 14 minutes]:
internal/pkg.(*Stream).readLoop(0xc0001a0080)
        /src/internal/pkg/stream.go:88 +0x142
created by internal/pkg.(*Stream).Start
        /src/internal/pkg/stream.go:31 +0x6b
```

**Solution:**

- **Parked line:** `/src/internal/pkg/stream.go:88`, inside `(*Stream).readLoop`.
- **Spawner:** `(*Stream).Start` at `/src/internal/pkg/stream.go:31`.
- **State:** `chan receive`, parked for 14 minutes — strong leak indicator.
- **Next step:** open `stream.go:88` and see what channel `readLoop` is reading from, and trace whether anyone still sends to or closes it.

**What to learn:** Stack reading is two lines: where it is parked, and who spawned it. That is enough to start a fix.

---

## <a id="task-7"></a>Task 7 — Diff two profiles taken minutes apart

**Goal:** Capture a baseline goroutine profile, run a leaky workload, capture another profile, and diff them with `go tool pprof -base`.

**Solution:**

```bash
# Terminal 1: start a leaky server
go run leaky.go &

# Terminal 2: baseline
curl -s -o base.pb.gz http://localhost:8080/debug/pprof/goroutine

# Hit the leaky endpoint 100 times
for i in $(seq 1 100); do curl -s localhost:8080/leak > /dev/null; done

# After
curl -s -o now.pb.gz http://localhost:8080/debug/pprof/goroutine

# Diff
go tool pprof -base base.pb.gz now.pb.gz <<< 'top'
```

Expected output: the leaky function with a count of about 100, dominating.

**What to learn:** `-base` is the single most useful pprof flag. It hides the static baseline noise and surfaces the delta.

---

## <a id="task-8"></a>Task 8 — Use `pprof.Do` to label and filter

**Goal:** A server handles two subsystems, "billing" and "search". Both can leak. Label goroutines per subsystem, then use `go tool pprof -tagfocus` to inspect each in isolation.

**Solution:**

```go
import "runtime/pprof"

func handleBilling(ctx context.Context, req *BillingReq) {
    pprof.Do(ctx, pprof.Labels("subsystem", "billing"), func(ctx context.Context) {
        doBilling(ctx, req)
    })
}

func handleSearch(ctx context.Context, req *SearchReq) {
    pprof.Do(ctx, pprof.Labels("subsystem", "search"), func(ctx context.Context) {
        doSearch(ctx, req)
    })
}
```

Now:

```
go tool pprof -tagfocus='subsystem=billing' http://host:6060/debug/pprof/goroutine
(pprof) top
```

Only billing's goroutines appear.

**What to learn:** Labels turn a server-wide profile into per-subsystem profiles without rebuilding anything.

---

## <a id="task-9"></a>Task 9 — Build a leak watcher with thresholds

**Goal:** A background goroutine that, every 30 seconds, checks `NumGoroutine` and dumps a profile to disk if the count has grown by more than 500 since the last dump.

**Solution:**

```go
func watchLeaks(ctx context.Context) {
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    last := runtime.NumGoroutine()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            now := runtime.NumGoroutine()
            if now-last > 500 {
                path := fmt.Sprintf("/var/log/goroutines-%d.txt", time.Now().Unix())
                f, err := os.Create(path)
                if err != nil {
                    log.Println("watcher:", err)
                    continue
                }
                _ = pprof.Lookup("goroutine").WriteTo(f, 1)
                f.Close()
                log.Printf("watcher: %d (+%d), dumped %s", now, now-last, path)
                last = now
            }
        }
    }
}
```

**What to learn:** Self-instrumenting binaries make incident response one step shorter — when the alert fires, the evidence is already on disk.

---

## <a id="task-10"></a>Task 10 — Compare `runtime.Stack` and `pprof.Lookup` output

**Goal:** Take a goroutine dump using both APIs. Diff them. Note what is the same and what differs.

**Solution:**

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "runtime/pprof"
)

func main() {
    // create some traffic
    for i := 0; i < 3; i++ {
        go func() { ch := make(chan int); <-ch }()
    }
    time.Sleep(50 * time.Millisecond)

    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    fmt.Println("=== runtime.Stack ===")
    fmt.Println(string(buf[:n]))

    fmt.Println("=== pprof debug=2 ===")
    _ = pprof.Lookup("goroutine").WriteTo(os.Stdout, 2)
}
```

**Observations:**

- The two outputs are nearly identical. `pprof debug=2` is built on `runtime.Stack`.
- `pprof debug=0` (protobuf) is a totally different format.
- `pprof debug=1` (text counts) aggregates; `runtime.Stack` does not.

**What to learn:** For human reading, both work. For machine consumption, use the protobuf form.

---

## <a id="task-11"></a>Task 11 — Drive `go tool pprof` interactively

**Goal:** Capture a goroutine profile and run an interactive session: `top`, `list`, `peek`, `traces`.

**Solution:**

```
$ go tool pprof http://localhost:6060/debug/pprof/goroutine
(pprof) top 10
(pprof) list leakyFunc
(pprof) peek leakyFunc
(pprof) traces
```

- `top 10` — top 10 stacks by goroutine count.
- `list leakyFunc` — annotated source code with goroutine counts per line.
- `peek leakyFunc` — show callers and callees.
- `traces` — every individual stack with its count.

**What to learn:** `list` is the most underused command. It points at the exact line with the most goroutines parked.

---

## <a id="task-12"></a>Task 12 — Capture a `runtime/trace` and find a never-ending goroutine

**Goal:** Capture a 5-second trace while running a leaky workload. Open it in `go tool trace`. Find a goroutine in the timeline that begins but never ends within the window.

**Solution:**

```go
import "runtime/trace"

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    _ = trace.Start(f)
    defer trace.Stop()

    for i := 0; i < 10; i++ {
        go func() { ch := make(chan int); <-ch }()
    }
    time.Sleep(5 * time.Second)
}
```

Then:

```
go tool trace trace.out
```

Browser opens. Click "Goroutine analysis". Each goroutine has a row in the timeline; the 10 leaky ones have bars that start in the first 100 ms and stretch to the right edge without ending.

**What to learn:** The trace shows lifetimes graphically. Leaked goroutines are the bars without right edges.

---

## <a id="task-13"></a>Task 13 — Detect leaks in a streaming server

**Goal:** A WebSocket-style server keeps one goroutine per connection. When a client disconnects, the goroutine should exit. Write a test that simulates connecting, disconnecting, and asserts the count returns to baseline.

**Solution:**

```go
func TestStreamServer_NoLeakOnDisconnect(t *testing.T) {
    defer goleak.VerifyNone(t)
    srv := NewServer()
    go srv.Run()
    defer srv.Stop()

    for i := 0; i < 100; i++ {
        c := srv.Connect()
        c.Close()
    }

    // give the server time to clean up
    time.Sleep(100 * time.Millisecond)
    // goleak will check the count vs baseline
}
```

**What to learn:** `goleak` works for streaming servers too — as long as the server has a clean shutdown that reaps connections.

---

## <a id="task-14"></a>Task 14 — Write a custom detector

**Goal:** Implement a `LeakDetector` type with `Start` and `Check` methods. `Start` records the baseline. `Check` reports any goroutine whose top frame is not in a known-runtime list.

**Solution:**

```go
type LeakDetector struct {
    baseline   int
    knownPaths []string
}

func NewLeakDetector() *LeakDetector {
    runtime.GC()
    time.Sleep(10 * time.Millisecond)
    return &LeakDetector{
        baseline: runtime.NumGoroutine(),
        knownPaths: []string{
            "runtime.gopark",
            "runtime.bgsweep",
            "runtime.bgscavenge",
            "runtime.forcegchelper",
            "runtime.runfinq",
            "internal/poll.runtime_pollWait",
        },
    }
}

func (d *LeakDetector) Check() ([]string, error) {
    runtime.GC()
    time.Sleep(10 * time.Millisecond)
    var sb strings.Builder
    if err := pprof.Lookup("goroutine").WriteTo(&sb, 2); err != nil {
        return nil, err
    }
    blocks := strings.Split(sb.String(), "\n\n")
    var leaks []string
    for _, b := range blocks {
        if d.isRuntime(b) || len(b) == 0 {
            continue
        }
        leaks = append(leaks, b)
    }
    return leaks, nil
}

func (d *LeakDetector) isRuntime(block string) bool {
    for _, p := range d.knownPaths {
        if strings.Contains(block, p) {
            return true
        }
    }
    return false
}
```

**What to learn:** `goleak` is a hundred lines of code. You can write your own when you need custom rules.

---

## <a id="task-15"></a>Task 15 — Integrate a leak gate into CI

**Goal:** Add a CI step that fails if any package leaks. Use `goleak.VerifyTestMain` everywhere; add a `make leak-test` target.

**Solution:**

`Makefile`:

```
.PHONY: leak-test
leak-test:
	go test -count=1 -race ./...
```

Each package's `TestMain`:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreTopFunction("internal/poll.runtime_pollWait"),
    )
}
```

GitHub Actions snippet:

```yaml
- name: Leak gate
  run: make leak-test
```

**What to learn:** A failing leak gate in CI is the cheapest insurance you can buy. Every PR is checked. No leak reaches main.

---

## Stretch goals

- Build a `make leak-audit` target that hits the staging environment, takes a goroutine profile, and diffs against a checked-in reference profile. Fail the build on more than a 10% delta.
- Write a Prometheus alert rule for `deriv(go_goroutines[10m]) > 1` and test it with `promtool`.
- Write a Grafana dashboard JSON that surfaces goroutine count, heap, and OS threads on one panel.
- Extend the custom detector from task 14 to output the leak in JSON for ingestion into a SIEM or log pipeline.
- Use `pprof.SetGoroutineLabels` in a real service and write a query in Pyroscope to focus on one tenant's goroutines.

---

## Mastery rubric

You have mastered detection when:

- You can recognise a leak in an unfamiliar codebase within five minutes of opening the goroutine profile.
- Your `TestMain` files contain `goleak.VerifyTestMain` by reflex.
- Your services expose `go_goroutines` to Prometheus and you can quote your slope-alert rule from memory.
- You have used `dlv` at least once to inspect a leaked goroutine's captured state.
- You have written a postmortem for a goroutine-leak incident that includes a "how this would have been caught earlier" section.

When you can do all five, return to [03-preventing-leaks](../03-preventing-leaks/) and study the patterns that make leaks impossible in the first place.
