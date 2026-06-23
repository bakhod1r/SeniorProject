# CPU Profiling in Go — Junior

## 1. What is a CPU profile?

A CPU profile is a record of **where your program spent its time**. If your program runs for 30 seconds, the profile will tell you something like: "12 seconds in `parseJSON`, 8 seconds in `compress`, 3 seconds in the garbage collector, 7 seconds idle." That's the whole point — to point a finger at the slow parts so you can speed them up (or leave them alone if they don't matter).

Go has CPU profiling built into the standard library. You don't need any external tool to *capture* a profile. You only need a tool to *read* it (`go tool pprof`, which also ships with Go).

---

## 2. How does Go capture a profile?

Roughly: every 10 ms, the operating system interrupts your program and the Go runtime writes down "what function was running right now". After many of these snapshots, the functions you see most often are the ones using the most CPU.

| Term | Meaning |
|------|---------|
| **Sample** | One snapshot of the call stack |
| **Sampling rate** | How often a snapshot is taken (default: 100 Hz = every 10 ms) |
| **Profile** | The collected set of samples, saved to a file |

A 30-second profile contains roughly 3,000 samples per CPU. That's plenty of data to find any function that uses more than ~1% of your CPU time.

---

## 3. Your first profile, via tests

The easiest way to start is from a benchmark.

```go
// math_bench_test.go
package math

import "testing"

func BenchmarkSum(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sum(1_000_000)
    }
}

func sum(n int) int {
    total := 0
    for i := 0; i < n; i++ {
        total += i
    }
    return total
}
```

Run it with the `-cpuprofile` flag:

```bash
go test -bench=BenchmarkSum -cpuprofile=cpu.out
```

You now have a file `cpu.out`. Open it:

```bash
go tool pprof cpu.out
```

You get an interactive prompt. Type `top`:

```
(pprof) top
Showing nodes accounting for 1.20s, 100% of 1.20s total
      flat  flat%   sum%        cum   cum%
     1.20s   100%   100%      1.20s   100%  math.sum
```

`math.sum` took all the time. Of course — that's the only thing the benchmark does.

---

## 4. Your first profile, via a running program

You can also profile any program by importing one package:

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
)

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()

    // ... your real program here ...
}
```

While the program runs, capture 30 seconds of CPU:

```bash
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
```

It will fetch the profile, save it, and open the interactive shell. Same `top`, `list`, `web` commands apply.

> The `_ "net/http/pprof"` import has a side effect: it registers the `/debug/pprof/...` endpoints on the default HTTP server. You don't have to call anything yourself.

---

## 5. Reading the output

Two columns matter most:

| Column | Meaning |
|--------|---------|
| **flat** | Time spent in this function (not counting functions it called) |
| **cum** | Time spent in this function *and* everything it called |

A function with **high flat** is doing actual work — that's where to optimize. A function with **low flat but high cum** is just a wrapper around something slower deeper down.

```
      flat  flat%   sum%        cum   cum%
     2.10s 35.0%  35.0%      2.10s  35.0%  encoding/json.(*decodeState).object
     0.00s     0  35.0%      4.50s  75.0%  net/http.HandlerFunc.ServeHTTP
```

`json.(*decodeState).object` is doing the work. `HandlerFunc.ServeHTTP` is just calling it.

---

## 6. Looking at the source

Once you know the hotspot, ask pprof to show the source with timings on each line:

```
(pprof) list sum
Total: 1.20s
ROUTINE ======================== math.sum
     1.20s      1.20s (flat, cum) 100% of Total
         .          .      4:func sum(n int) int {
         .          .      5:    total := 0
     830ms      830ms      6:    for i := 0; i < n; i++ {
     370ms      370ms      7:        total += i
         .          .      8:    }
         .          .      9:    return total
        10ms       10ms     10:}
```

Now you can see exactly which lines burned the CPU.

---

## 7. The visual call graph

```
(pprof) web
```

This opens an SVG in your browser showing the call graph: boxes are functions, sizes reflect time, arrows show calls. It needs Graphviz installed (`brew install graphviz` or `apt install graphviz`).

A more modern option is to launch the full web UI:

```bash
go tool pprof -http=:8080 cpu.out
```

That gives you flame graphs, a source view, and a call graph in one browser tab.

---

## 8. A small experiment

Save this to `main.go`:

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
    "strings"
)

func main() {
    go http.ListenAndServe("localhost:6060", nil)

    s := strings.Repeat("a", 1<<20) // 1 MiB string
    for {
        slow(s)
    }
}

func slow(s string) {
    out := ""
    for _, c := range s {
        out += string(c)
    }
    _ = out
}
```

Run it (`go run .`) and in another shell:

```bash
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=10
```

In the browser, click "Flame Graph". You'll see `slow` and `runtime.concatstrings` dominating. That tells you exactly what to fix.

---

## 9. Things you can do today

1. Add `go test -cpuprofile=cpu.out -bench=.` to a project you have and read the output.
2. Add `import _ "net/http/pprof"` to a side-project HTTP server and try `go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile`.
3. Practice the `top`, `list <funcname>`, and `web` commands until they feel natural.
4. Open the flame graph for one of your benchmarks and identify the widest box.

---

## 10. Common beginner misunderstandings

| Misconception | Reality |
|---------------|---------|
| "The profile tells me how slow my code is." | It tells you where CPU went. A slow request waiting on a database has zero CPU samples. |
| "If `flat` is small, the function isn't the problem." | True. Look elsewhere. |
| "Profiling slows my program down." | At 100 Hz, the overhead is 1–5%. Production-safe at modest rates. |
| "I need to start the profile before the work begins." | The HTTP endpoint captures the next N seconds; just hit it during load. |
| "I should profile in debug builds." | No. Profile builds with the same flags you ship — inlining and optimizations change which functions show up. |

---

## 11. Summary

A CPU profile is a periodic snapshot of which Go functions are running. The simplest entry points are `go test -cpuprofile=cpu.out -bench=.` and `import _ "net/http/pprof"` followed by `go tool pprof http://.../debug/pprof/profile`. Read profiles by sorting on `flat` time, drilling into hot functions with `list`, and visualizing with `web` or `-http=:8080`. Once you can do that, you can already find 80% of the CPU bottlenecks you'll meet.

---

## Further reading
- "Profiling Go Programs" (Go blog): https://go.dev/blog/pprof
- `runtime/pprof`: https://pkg.go.dev/runtime/pprof
- `net/http/pprof`: https://pkg.go.dev/net/http/pprof
