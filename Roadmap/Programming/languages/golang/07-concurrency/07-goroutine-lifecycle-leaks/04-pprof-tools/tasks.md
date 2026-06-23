# pprof and Profiling Tools — Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Setup](#setup)
3. [Beginner Tasks](#beginner-tasks)
4. [Intermediate Tasks](#intermediate-tasks)
5. [Advanced Tasks](#advanced-tasks)
6. [Production-Grade Tasks](#production-grade-tasks)
7. [Stretch Tasks](#stretch-tasks)
8. [Reference Solutions](#reference-solutions)

---

## How to Use This File

Each task gives:

- A goal (what you should be able to do at the end).
- A starting state (often a small program).
- A workflow (the commands and observations).
- Expected output or a hint to recognise success.

Work through them in order. The earlier tasks build the muscle memory you need for the harder ones.

---

## Setup

Create a working directory:

```bash
mkdir -p ~/go/pprof-lab
cd ~/go/pprof-lab
go mod init pproflab
```

Install graphviz (one-time):

```bash
# macOS
brew install graphviz
# Debian/Ubuntu
sudo apt-get install graphviz
```

Confirm:

```bash
go version
which dot
go tool pprof -h | head -3
```

You should have Go 1.21+, `dot` from graphviz, and `go tool pprof` available.

---

## Beginner Tasks

### Task 1: First HTTP pprof endpoint

**Goal:** Get pprof responding to curl.

```go
// main.go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
    "time"
)

func main() {
    go func() {
        log.Println(http.ListenAndServe("127.0.0.1:6060", nil))
    }()
    for {
        time.Sleep(time.Second)
    }
}
```

Run:

```bash
go run main.go &
curl -s http://127.0.0.1:6060/debug/pprof/goroutine?debug=1 | head -5
```

**Expected:** first line is `goroutine profile: total <small number>`.

### Task 2: Manual goroutine count

**Goal:** Use `runtime.NumGoroutine` and a profile to confirm the same count.

Extend `main.go`:

```go
import "runtime"

http.HandleFunc("/count", func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "%d\n", runtime.NumGoroutine())
})
```

```bash
curl http://127.0.0.1:6060/count
curl -s http://127.0.0.1:6060/debug/pprof/goroutine?debug=1 | head -1
```

The two numbers should match (the `total` from the profile equals `NumGoroutine()`).

### Task 3: Take a binary profile and analyse it

```bash
curl -o g.prof http://127.0.0.1:6060/debug/pprof/goroutine
go tool pprof g.prof
```

In the REPL:

```
(pprof) top
(pprof) traces
(pprof) quit
```

You should see system goroutines (`runtime.gopark`, `runtime.netpoll`, etc.) and your `main` goroutine.

### Task 4: Cause a small leak and find it

```go
for i := 0; i < 10; i++ {
    go func(id int) {
        ch := make(chan int)
        <-ch
    }(i)
}
```

Restart the program. Curl `?debug=1`:

```bash
curl http://127.0.0.1:6060/debug/pprof/goroutine?debug=1 | head -20
```

Look for the group of 10 goroutines parked on `chan receive`. The stack should point to `main.main.func<N>`.

### Task 5: All three debug levels

Run each:

```bash
curl http://127.0.0.1:6060/debug/pprof/goroutine?debug=1 > d1.txt
curl http://127.0.0.1:6060/debug/pprof/goroutine?debug=2 > d2.txt
curl -o d0.prof http://127.0.0.1:6060/debug/pprof/goroutine
```

Compare:

- `wc -l d1.txt d2.txt` — count lines.
- `file d0.prof` — should report binary data.
- Skim `d1.txt` for grouped stacks with counts.
- Skim `d2.txt` for per-goroutine state in square brackets.

### Task 6: Open the web UI

```bash
go tool pprof -http=:9090 d0.prof
```

Open `http://localhost:9090`. Navigate through Top, Graph, Flame Graph.

In Flame Graph, click the widest tower. Does it correspond to the leaked goroutines?

---

## Intermediate Tasks

### Task 7: CPU profile of a busy loop

```go
import "math/rand"

func spin() int {
    n := 0
    for i := 0; i < 100_000_000; i++ {
        n += rand.Intn(100)
    }
    return n
}

http.HandleFunc("/spin", func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, spin())
})
```

In one terminal:

```bash
while true; do curl -s http://127.0.0.1:6060/spin > /dev/null; done
```

In another:

```bash
go tool pprof http://127.0.0.1:6060/debug/pprof/profile?seconds=10
```

In the REPL:

```
(pprof) top
(pprof) list spin
```

The hottest function should be `main.spin` with most time on the inner loop.

### Task 8: Heap profile differential

Program that grows a slice forever:

```go
var leak [][]byte

http.HandleFunc("/alloc", func(w http.ResponseWriter, r *http.Request) {
    leak = append(leak, make([]byte, 1<<20)) // 1 MB
    fmt.Fprintln(w, len(leak))
})
```

Hit it 50 times:

```bash
for i in $(seq 1 50); do curl -s http://127.0.0.1:6060/alloc > /dev/null; done
curl -o h1.prof "http://127.0.0.1:6060/debug/pprof/heap?gc=1"

for i in $(seq 1 50); do curl -s http://127.0.0.1:6060/alloc > /dev/null; done
curl -o h2.prof "http://127.0.0.1:6060/debug/pprof/heap?gc=1"

go tool pprof -base h1.prof h2.prof
```

Inside:

```
(pprof) top
(pprof) list main.main.func
```

You should see ~50 MB attributed to `/alloc`.

### Task 9: Block profile

Add at startup:

```go
runtime.SetBlockProfileRate(int(time.Millisecond))
```

Program with a slow channel:

```go
ch := make(chan int)
go func() {
    for v := range ch {
        time.Sleep(100 * time.Millisecond)
        _ = v
    }
}()
for i := 0; i < 10; i++ {
    ch <- i
}
```

After running, fetch:

```bash
curl -o block.prof http://127.0.0.1:6060/debug/pprof/block
go tool pprof block.prof
```

```
(pprof) top
```

The hottest stack should involve channel send blocking.

### Task 10: Mutex profile

```go
runtime.SetMutexProfileFraction(1)

var mu sync.Mutex
go func() {
    for {
        mu.Lock()
        time.Sleep(50 * time.Millisecond)
        mu.Unlock()
    }
}()
for i := 0; i < 5; i++ {
    go func() {
        for {
            mu.Lock()
            mu.Unlock()
        }
    }()
}
```

```bash
curl -o mu.prof http://127.0.0.1:6060/debug/pprof/mutex
go tool pprof mu.prof
```

`top` should show the long-holding goroutine as the culprit.

### Task 11: `peek` and `list`

Pick any profile from earlier. In the REPL:

```
(pprof) peek main.spin
(pprof) list main.spin
```

`peek` shows callers. `list` shows annotated source. Practise both until they feel natural.

### Task 12: trace

```bash
curl -o trace.out http://127.0.0.1:6060/debug/pprof/trace?seconds=5
go tool trace trace.out
```

Browser opens automatically. Click **View trace** and **Goroutine analysis**.

Find the timeline. Hover a coloured bar to see the function. Count GC events.

---

## Advanced Tasks

### Task 13: Goroutine labels

```go
import (
    "context"
    "runtime/pprof"
)

func handler(w http.ResponseWriter, r *http.Request) {
    labels := pprof.Labels(
        "endpoint", r.URL.Path,
        "method", r.Method,
    )
    pprof.Do(r.Context(), labels, func(ctx context.Context) {
        time.Sleep(200 * time.Millisecond)
        fmt.Fprintln(w, "ok")
    })
}

http.HandleFunc("/a", handler)
http.HandleFunc("/b", handler)
http.HandleFunc("/c", handler)
```

In another terminal:

```bash
for p in a b c a a a a b; do curl -s http://127.0.0.1:6060/$p & done
wait
```

While the requests are running, in a third terminal:

```bash
curl -o g.prof http://127.0.0.1:6060/debug/pprof/goroutine
go tool pprof g.prof
```

```
(pprof) tags
(pprof) tagfocus=endpoint=/a
(pprof) top
```

You should see endpoint counts under `tags`, and the filter shows only `/a` traffic.

### Task 14: Label propagation across `go f()`

Add a spawned goroutine inside the handler:

```go
pprof.Do(r.Context(), labels, func(ctx context.Context) {
    go func() {
        pprof.SetGoroutineLabels(ctx) // critical line
        slowBackground()
    }()
    fmt.Fprintln(w, "ok")
})
```

Comment out `SetGoroutineLabels` and confirm via `tagfocus=endpoint=/a` that the background goroutine disappears from the filtered view. Add it back and confirm it returns.

### Task 15: Custom profile

```go
var openFiles = pprof.NewProfile("open_files")

func open(path string) (*os.File, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    openFiles.Add(f, 0)
    return f, nil
}

func close(f *os.File) {
    openFiles.Remove(f)
    f.Close()
}
```

Open ten files and "forget" to close two. Curl `/debug/pprof/open_files?debug=1`. The output should show two live entries with the creation stack.

### Task 16: Hourly snapshot loop

```go
func snapshotLoop(ctx context.Context, dir string) {
    t := time.NewTicker(time.Minute) // use Minute for testing
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            ts := time.Now().UTC().Format("20060102T150405")
            for _, name := range []string{"goroutine", "heap"} {
                path := filepath.Join(dir, fmt.Sprintf("%s-%s.prof", name, ts))
                f, _ := os.Create(path)
                _ = pprof.Lookup(name).WriteTo(f, 0)
                _ = f.Close()
            }
        }
    }
}
```

Run for 5 minutes. `ls -la <dir>` should show 10 files. Diff two: `go tool pprof -base ...`.

### Task 17: Profile-guided optimisation (PGO)

```bash
# build with no PGO
go build -o app-nopgo .

# run under load, collect 30s CPU profile
curl -o default.pgo http://127.0.0.1:6060/debug/pprof/profile?seconds=30

# rebuild with PGO
go build -pgo=default.pgo -o app-pgo .
```

Benchmark both. The PGO binary should be ~2–5% faster on the dominant workload.

### Task 18: Authenticated pprof

```go
func basicAuth(secret string, h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        _, pw, ok := r.BasicAuth()
        if !ok || subtle.ConstantTimeCompare([]byte(pw), []byte(secret)) != 1 {
            w.Header().Set("WWW-Authenticate", `Basic realm="pprof"`)
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        h.ServeHTTP(w, r)
    })
}

adminMux := http.NewServeMux()
adminMux.Handle("/debug/pprof/", basicAuth(secret, http.HandlerFunc(pprof.Index)))
adminMux.Handle("/debug/pprof/cmdline", basicAuth(secret, http.HandlerFunc(pprof.Cmdline)))
adminMux.Handle("/debug/pprof/profile", basicAuth(secret, http.HandlerFunc(pprof.Profile)))
adminMux.Handle("/debug/pprof/symbol", basicAuth(secret, http.HandlerFunc(pprof.Symbol)))
adminMux.Handle("/debug/pprof/trace", basicAuth(secret, http.HandlerFunc(pprof.Trace)))
go http.ListenAndServe("127.0.0.1:6060", adminMux)
```

Curl without auth — 401. With auth — 200.

```bash
curl -i http://127.0.0.1:6060/debug/pprof/goroutine
curl -i -u :secretpw http://127.0.0.1:6060/debug/pprof/goroutine
```

### Task 19: Clamp `seconds=`

Extend the gate to clamp:

```go
func clampSeconds(h http.HandlerFunc, max int) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        q := r.URL.Query()
        if s := q.Get("seconds"); s != "" {
            if n, err := strconv.Atoi(s); err == nil && n > max {
                q.Set("seconds", strconv.Itoa(max))
                r.URL.RawQuery = q.Encode()
            }
        }
        h(w, r)
    }
}
```

Request `?seconds=600` and confirm the profile completes in the clamped time.

### Task 20: Diff with `go tool pprof -http`

```bash
go tool pprof -http=:9090 -base h1.prof h2.prof
```

The web UI shows the diff. Red squares are growth, green squares are shrinkage (or the reverse — verify your version).

---

## Production-Grade Tasks

### Task 21: Continuous profiling agent

Install Pyroscope locally:

```bash
docker run -p 4040:4040 grafana/pyroscope:latest
```

Add the Go agent:

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "pproflab",
    ServerAddress:   "http://localhost:4040",
    ProfileTypes: []pyroscope.ProfileType{
        pyroscope.ProfileCPU,
        pyroscope.ProfileGoroutines,
        pyroscope.ProfileAllocSpace,
        pyroscope.ProfileInuseSpace,
    },
})
```

Run your program for ~5 minutes. Open `http://localhost:4040`. You should see flame graphs for goroutines, CPU, and memory.

### Task 22: Leak alerter

```go
const threshold = 10_000

func monitor(ctx context.Context) {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            n := runtime.NumGoroutine()
            if n > threshold {
                path := fmt.Sprintf("/tmp/g-overflow-%d.prof", time.Now().Unix())
                f, _ := os.Create(path)
                _ = pprof.Lookup("goroutine").WriteTo(f, 0)
                _ = f.Close()
                log.Printf("ALERT goroutines=%d, snapshot=%s", n, path)
            }
        }
    }
}
```

Drive a leak by hitting an endpoint that spawns goroutines without bounds. Confirm the snapshot lands in `/tmp` when threshold is crossed.

### Task 23: Signal-triggered snapshot

```go
c := make(chan os.Signal, 1)
signal.Notify(c, syscall.SIGUSR1)
go func() {
    for range c {
        path := fmt.Sprintf("/tmp/g-%d.prof", time.Now().Unix())
        f, _ := os.Create(path)
        _ = pprof.Lookup("goroutine").WriteTo(f, 0)
        _ = f.Close()
        log.Printf("snapshot to %s", path)
    }
}()
```

```bash
kill -SIGUSR1 $(pgrep -f pproflab)
ls -la /tmp/g-*.prof
```

### Task 24: pprof in a unit test

```go
package leak_test

import (
    "bytes"
    "runtime"
    "runtime/pprof"
    "testing"
    "time"
)

func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()

    DoWork() // function under test

    time.Sleep(100 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before {
        var buf bytes.Buffer
        _ = pprof.Lookup("goroutine").WriteTo(&buf, 1)
        t.Fatalf("leak: %d -> %d\n%s", before, after, buf.String())
    }
}
```

Plant a leak in `DoWork`. Run the test. The failure message should include the leaked stack.

### Task 25: Benchmarks with profiles

Write a benchmark and capture profiles:

```go
func BenchmarkSpin(b *testing.B) {
    for i := 0; i < b.N; i++ {
        spin()
    }
}
```

```bash
go test -bench=Spin -benchtime=3s -cpuprofile=cpu.prof -memprofile=mem.prof
go tool pprof cpu.prof
go tool pprof mem.prof
```

---

## Stretch Tasks

### Task 26: Parse a profile with the Go library

```go
import "github.com/google/pprof/profile"

f, _ := os.Open("g.prof")
p, _ := profile.Parse(f)
for _, s := range p.Sample {
    fmt.Printf("count=%v frames=%v labels=%v\n", s.Value, len(s.Location), s.Label)
}
```

Run on a goroutine profile from earlier tasks. Confirm sample counts match `?debug=1` totals.

### Task 27: Build a tiny pprof viewer

Write a 100-line Go program that:

1. Fetches `/debug/pprof/goroutine` from a URL.
2. Parses it.
3. Prints the top N stacks by goroutine count.
4. Accepts a `-label key=value` flag and filters.

Use `github.com/google/pprof/profile` for parsing.

### Task 28: Custom profile for in-flight requests

Combine custom profiles with HTTP middleware:

```go
var inflight = pprof.NewProfile("inflight_requests")

func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := struct{}{}
        inflight.Add(&token, 0)
        defer inflight.Remove(&token)
        next.ServeHTTP(w, r)
    })
}
```

Curl `/debug/pprof/inflight_requests?debug=1` during heavy load.

### Task 29: Build a goroutine-count Prometheus exporter

Expose:

```go
var goroutineCount = prometheus.NewGauge(prometheus.GaugeOpts{
    Name: "go_goroutines_observed",
})

go func() {
    for {
        goroutineCount.Set(float64(runtime.NumGoroutine()))
        time.Sleep(10 * time.Second)
    }
}()
```

Scrape with Prometheus. Alert on `deriv(go_goroutines_observed[5m]) > 50`.

### Task 30: Compare in-process pprof with eBPF

If you have a Linux host, install Parca or `perf` and capture a CPU profile from outside the Go runtime. Compare the call graph to one collected by `runtime/pprof`. Note differences: cgo frames visible to eBPF but not to pprof, goroutine labels visible to pprof but not to eBPF.

---

## Reference Solutions

A complete worked example combining tasks 1, 4, 7, 13, 18, 22:

```go
package main

import (
    "context"
    "crypto/subtle"
    "fmt"
    "log"
    "math/rand"
    "net/http"
    "net/http/pprof"
    "os"
    rtpprof "runtime/pprof"
    "runtime"
    "time"
)

func spin() int {
    n := 0
    for i := 0; i < 50_000_000; i++ {
        n += rand.Intn(100)
    }
    return n
}

func leak() {
    ch := make(chan int)
    <-ch
}

func basicAuth(pw string, h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        _, got, ok := r.BasicAuth()
        if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(pw)) != 1 {
            w.Header().Set("WWW-Authenticate", `Basic realm="pprof"`)
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        h.ServeHTTP(w, r)
    })
}

func handler(w http.ResponseWriter, r *http.Request) {
    rtpprof.Do(r.Context(), rtpprof.Labels("endpoint", r.URL.Path), func(ctx context.Context) {
        switch r.URL.Path {
        case "/spin":
            fmt.Fprintln(w, spin())
        case "/leak":
            go leak()
            fmt.Fprintln(w, "leaked one goroutine")
        default:
            fmt.Fprintln(w, "ok")
        }
    })
}

func monitor(ctx context.Context, threshold int) {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            n := runtime.NumGoroutine()
            if n > threshold {
                path := fmt.Sprintf("/tmp/g-%d.prof", time.Now().Unix())
                f, _ := os.Create(path)
                _ = rtpprof.Lookup("goroutine").WriteTo(f, 0)
                _ = f.Close()
                log.Printf("ALERT goroutines=%d snapshot=%s", n, path)
            }
        }
    }
}

func main() {
    secret := os.Getenv("PPROF_SECRET")
    if secret == "" {
        secret = "letmein"
    }

    api := http.NewServeMux()
    api.HandleFunc("/spin", handler)
    api.HandleFunc("/leak", handler)
    api.HandleFunc("/healthz", handler)

    admin := http.NewServeMux()
    admin.Handle("/debug/pprof/", basicAuth(secret, http.HandlerFunc(pprof.Index)))
    admin.Handle("/debug/pprof/cmdline", basicAuth(secret, http.HandlerFunc(pprof.Cmdline)))
    admin.Handle("/debug/pprof/profile", basicAuth(secret, http.HandlerFunc(pprof.Profile)))
    admin.Handle("/debug/pprof/symbol", basicAuth(secret, http.HandlerFunc(pprof.Symbol)))
    admin.Handle("/debug/pprof/trace", basicAuth(secret, http.HandlerFunc(pprof.Trace)))

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go monitor(ctx, 500)

    go func() {
        log.Println("admin on 127.0.0.1:6060")
        log.Fatal(http.ListenAndServe("127.0.0.1:6060", admin))
    }()
    log.Println("api on :8080")
    log.Fatal(http.ListenAndServe(":8080", api))
}
```

Build and run:

```bash
go build -o lab .
PPROF_SECRET=hello ./lab
```

Exercise:

```bash
curl http://localhost:8080/spin &
curl http://localhost:8080/leak
curl http://localhost:8080/leak
curl http://localhost:8080/leak

curl -u :hello http://127.0.0.1:6060/debug/pprof/goroutine?debug=1 | head
go tool pprof -http=:9090 "http://:hello@127.0.0.1:6060/debug/pprof/profile?seconds=10"
```

You now have one program demonstrating labelled handlers, authenticated pprof, and a leak watchdog. Iterate from here.
