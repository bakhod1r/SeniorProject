# Memory Profiling in Go — Junior

## 1. What problem does profiling solve?

You've written a program. It works. But it's using too much memory, or it's slow because the garbage collector keeps running. Where is the memory going? Which line allocated it?

The Go toolchain ships a profiler that answers exactly that. It captures a list of "every place that allocated memory" along with stack traces, and you read it with `go tool pprof`.

You don't need to instrument your code. You don't need any third-party library. It's already there.

---

## 2. Two things a memory profile can tell you

A heap profile answers two different questions, and beginners often confuse them.

| Question | Profile metric |
|----------|----------------|
| "Where is the memory **right now**?" | `inuse_space` (live bytes) |
| "Where did my program **ever** allocate?" | `alloc_space` (cumulative bytes) |

Think of `inuse_space` as a snapshot of the heap — what's currently alive. `alloc_space` is more like an odometer — it never goes down, even after the garbage collector reclaims the memory.

You usually look at `inuse_space` when you suspect a leak ("memory keeps growing") and `alloc_space` when you suspect GC pressure ("the CPU is spending too much time collecting garbage").

---

## 3. Your first heap profile, three steps

### Step 1: capture

```go
package main

import (
    "os"
    "runtime"
    "runtime/pprof"
)

func main() {
    // ... your program does work ...

    f, _ := os.Create("heap.pb.gz")
    defer f.Close()

    runtime.GC()                     // clean up first
    pprof.WriteHeapProfile(f)
}
```

The call to `runtime.GC()` is a trick to make the profile show only objects that survived a collection — otherwise the profile would include garbage waiting to be swept.

### Step 2: view

```bash
go tool pprof heap.pb.gz
```

You're now in an interactive shell. Try:

```
(pprof) top
```

You'll see something like:

```
Showing nodes accounting for 12.50MB, 100% of 12.50MB total
      flat  flat%   sum%        cum   cum%
   10.00MB 80.00% 80.00%    10.00MB 80.00%  main.loadConfig
    2.50MB 20.00% 100%       2.50MB 20.00%  main.parseRequest
```

That's "where the live memory is, ranked".

### Step 3: drill down

```
(pprof) list loadConfig
```

This shows the source of `loadConfig` with bytes annotated per line. The line that allocated the most is the one to focus on.

---

## 4. The browser version

The terminal is fine, but the web view is much friendlier:

```bash
go tool pprof -http=:8080 heap.pb.gz
```

Open `http://localhost:8080`. You get a **flame graph**, a callgraph, a sortable top list, and a source view, all in one page.

Wider blocks in the flame graph = more bytes attributed to that call site. Click into them to zoom.

---

## 5. Profiling a running web server

If your program is an HTTP server, you don't even need to add code to write a file. Add one line:

```go
import _ "net/http/pprof"
```

That blank import registers handlers under `/debug/pprof/`. Now from another terminal:

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
```

It downloads a fresh profile from the running process. You can do this anytime, including in production (just make sure the endpoint isn't exposed to the public internet — `pprof` reveals function names and source structure).

---

## 6. Profiling a benchmark

For testing a specific function, `go test` writes profiles for you:

```bash
go test -bench=. -benchmem -memprofile=mem.out ./pkg
go tool pprof mem.out
```

`-benchmem` adds two columns to the benchmark output:

```
BenchmarkBuild-8    1000000   1180 ns/op   384 B/op   5 allocs/op
```

| Column | Meaning |
|--------|---------|
| `B/op` | Bytes allocated per operation |
| `allocs/op` | Number of allocations per operation |

These two numbers are exact for the benchmark — they come from `runtime.MemStats`, not from sampling. They're the easiest way to detect a regression: if a refactor doubles `allocs/op`, you have a regression even if the time per op didn't change.

---

## 7. A small worked example

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "runtime/pprof"
)

func buildList(n int) []string {
    out := []string{}
    for i := 0; i < n; i++ {
        out = append(out, fmt.Sprintf("item-%d", i))
    }
    return out
}

func main() {
    _ = buildList(100_000)

    f, _ := os.Create("heap.pb.gz")
    defer f.Close()
    runtime.GC()
    pprof.WriteHeapProfile(f)
}
```

After running and profiling:

```bash
go run main.go
go tool pprof -top heap.pb.gz
```

You'll likely see two big contributors: `fmt.Sprintf` (each formatted string allocates) and `runtime.growslice` (because `out` had to grow many times). Two fixes spring out: preallocate the slice and reuse a `strings.Builder`. Profile again — the numbers go down. That's the entire memory profiling loop.

---

## 8. Common beginner misunderstandings

| Misconception | Reality |
|---------------|---------|
| "The profile shows every allocation" | It shows a sample. By default one record per 512 KiB allocated. |
| "If the profile says 250 MB, my program is using 250 MB" | The sampled estimate is approximate. Trust `runtime.MemStats` for absolutes. |
| "I should always look at `alloc_space`" | Only if you're after GC pressure. For leaks, use `inuse_space`. |
| "I need to add code to my program to profile it" | `go test -memprofile` and `net/http/pprof` need almost no code. |
| "Stack allocations show up in the profile" | They don't. The heap profile is for heap allocations only. |

---

## 9. Things you can do today

1. Pick any existing Go program of yours. Add `import _ "net/http/pprof"` and a goroutine that listens on `:6060`. Capture a heap profile.
2. Run any benchmark with `-benchmem`. Note the `B/op` and `allocs/op`. Try to reduce one.
3. Open a profile in `-http=:8080` mode. Click around. Find the widest leaf in the flame graph.
4. Run `go tool pprof -base before.pb.gz after.pb.gz` on two profiles of the same program at different times. Read the diff.

---

## 10. Summary

A **memory profile** is a sampled list of allocation sites, captured by `pprof.WriteHeapProfile` or fetched from `/debug/pprof/heap`. You read it with `go tool pprof`, and the easiest view is the browser one (`-http=:8080`). The two metrics you'll switch between are **`inuse_space`** (live memory, for leak hunting) and **`alloc_space`** (total allocated, for GC pressure). For benchmarks, `-benchmem` gives you exact `B/op` and `allocs/op` numbers.

---

## Further reading
- Profiling Go programs (Go blog): https://go.dev/blog/pprof
- `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
- `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
