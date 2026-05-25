# pprof Deep Dive — Middle

## 1. The full interactive command set

Once you go beyond `top` and `list`, the shell becomes a small DSL. Here's everything you'll actually use, in roughly the order you'll need it.

| Command | What it does | When |
|---------|--------------|------|
| `top [N]` | Top N by flat self | First pass |
| `top -cum [N]` | Sort by cumulative | "Where does this subtree spend its time?" |
| `top -flat` | Force flat sort | After switching cumulative=true |
| `list <regex>` | Annotated source for matching functions | Once you have a suspect |
| `disasm <regex>` | Annotated assembly | When source isn't enough (loops, branches) |
| `web` | Open SVG call graph | Big-picture shape |
| `weblist <regex>` | Source + assembly side by side, in a browser | Deep inspection |
| `peek <regex>` | Callers and callees with edge weights | "Who calls this hot function?" |
| `traces` | Print every sample as a full stack | Rare paths, attribution |
| `tree` | Caller-to-callee tree (text) | Like `web`, in the terminal |
| `granularity=lines\|files\|functions\|addresses` | Aggregation level | Line-level when you suspect one expression |
| `focus=<regex>` | Keep only samples whose stack touches the regex | Slice to one subsystem |
| `ignore=<regex>` | Drop samples whose stack touches the regex | Hide noise (e.g., `runtime\.`) |
| `hide=<regex>` | Hide *frames* (not whole samples) | Clean up output |
| `show=<regex>` | Keep only matching frames | Force a narrow view |
| `sample_index=<name>` | Switch value column | Heap: inuse vs. alloc |
| `nodecount=N` | Limit nodes in graph views | Big profiles |
| `nodefraction=F` | Drop nodes below F (default 0.005) | Big profiles |
| `unit=<unit>` | Display unit (`ms`, `kb`, `mb`) | Readability |
| `o` | Print current options | Sanity-check filters |
| `quit` / Ctrl-D | Exit | — |

`granularity=lines` is the underused one. With it, `top` shows you which *line* of source carried the cost, not just which function.

---

## 2. Focus, ignore, hide, show — the regex language

These four are the filter primitives:

```
focus=parser           # only samples whose stack contains a frame matching "parser"
ignore=runtime\.       # drop samples that are mostly runtime overhead
hide=^runtime\.        # don't print runtime frames, but keep samples
show=^(main|service)\. # only show frames in main or service package
```

Regexes are RE2 and match against `package.Func` or `(*Type).Method`. The escape `\.` is important — `runtime.` is technically a wildcard.

A common combo for "look at my code only":

```
ignore=runtime\.|reflect\.|encoding/
hide=^runtime\.
```

Then `top` is dominated by *your* hot paths instead of allocator and reflection frames.

---

## 3. Peek — the function-centric view

```
(pprof) peek parseLine
Showing nodes accounting for 2.10s, 42.51% of 4.94s total
----------------------------------------------------------+-------------
      flat  flat%   sum%        cum   cum%   calls calls% + context
----------------------------------------------------------+-------------
                                            1.30s 61.90% |   main.parseLine
                                            0.50s 23.81% |   main.parseHeader
                                            0.30s 14.29% |   main.parseFooter
     800ms 16.19% 16.19%      2.10s 42.51%                | main.parseLine
                                            0.90s 42.86% |   strings.Split
                                            0.60s 28.57% |   runtime.mallocgc
                                            0.20s  9.52% |   strconv.Atoi
```

The middle row is `parseLine` itself; above it are **callers** (and how much of `parseLine`'s cum came from each); below are **callees** (and how much they cost). This is the fastest way to answer "is this function expensive because of *what it calls* or because of *what it does*?"

---

## 4. Granularity

By default, samples aggregate to **functions**. Change that:

```
(pprof) granularity=lines
(pprof) top
```

Now `top` ranks individual source lines. A function with one expensive line and many cheap ones suddenly tells the truth: you see exactly which line is hot.

`granularity=files` collapses to files — useful when one package dominates and you want a per-file split. `granularity=addresses` is rarely needed outside disassembly work.

---

## 5. The web UI in detail

```
go tool pprof -http=:8080 cpu.pb.gz
```

Five views, switched in the top-left menu:

- **Top.** Sortable table. Search box filters by function name.
- **Graph.** Hot subtrees pop visually. Right-click a node for "Focus" / "Hide" / "Show source".
- **Flame Graph.** Width = share of selected sample type. Click to zoom; the breadcrumb at the top lets you zoom out.
- **Peek.** Type a function name to see callers/callees.
- **Source.** Annotated source for a chosen function.

Two non-obvious controls:

- The **"Refine"** menu applies `focus`, `ignore`, `hide`, `show` interactively. The current URL encodes them, so the page is shareable.
- The **"Sample"** menu in the top-right switches `sample_index` — flame graph of `alloc_objects` looks very different from `inuse_space`.

`-http=:` (empty port) picks a free port at random. `-no_browser` prints the URL without opening anything — useful when you're SSH'd into a server with port forwarding.

---

## 6. Heap profiling, slightly more carefully

`/debug/pprof/heap` and `/debug/pprof/allocs` return the same underlying profile. The difference is the default `sample_index`:

| Endpoint | Default `sample_index` |
|----------|------------------------|
| `/heap` | `inuse_space` |
| `/allocs` | `alloc_space` |

So if you grab `/heap` and then ask `sample_index=alloc_objects`, you get exactly what `/allocs` would have given you. Save one profile, query both.

`go tool pprof -alloc_objects cpu_or_heap.pb.gz` is a synonym for `-sample_index=alloc_objects`.

```
# Bytes currently alive (RSS-like)
go tool pprof -inuse_space -http=: heap.pb.gz

# Bytes ever allocated (GC pressure)
go tool pprof -alloc_space -http=: heap.pb.gz
```

If one function dominates `alloc_objects` but is invisible in `inuse_space`, it's a *churn* problem — short-lived allocations the GC handles fine but that cost CPU. The fix is usually a `sync.Pool` or pre-sized buffer, not a leak hunt.

---

## 7. Diff two profiles

The single most valuable habit when optimizing: save a baseline, change one thing, diff.

```
curl -o before.pb.gz "http://localhost:6060/debug/pprof/profile?seconds=30"
# deploy a change
curl -o after.pb.gz  "http://localhost:6060/debug/pprof/profile?seconds=30"

go tool pprof -http=: -base=before.pb.gz after.pb.gz
```

`-base` shows only what *increased* — your top is the cost the new version added. Anything that got faster (negative delta) is omitted.

```
go tool pprof -http=: -diff_base=before.pb.gz after.pb.gz
```

`-diff_base` is the signed view: red boxes in the web UI got worse, green boxes got better. Use this in code review.

Both require the profiles to have the same `sample_type`. You can't diff a CPU profile against a heap profile.

---

## 8. Goroutine profiles

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

A goroutine profile has one sample per stack, not per goroutine. The `count` value is "how many goroutines are currently at this exact stack".

```
(pprof) top
Showing nodes accounting for 4203, 99.95% of 4205 total
      flat  flat%   sum%        cum   cum%
      4000 95.13% 95.13%       4000 95.13%  runtime.gopark
       200  4.76% 99.88%        200  4.76%  net/http.(*persistConn).readLoop
```

That `4000` is "4000 goroutines parked". `peek runtime.gopark` then shows what they're parked on. The text dump (`?debug=2`) is often easier:

```
curl -s "http://localhost:6060/debug/pprof/goroutine?debug=2" | less
```

…shows the full stack of every goroutine, with a duration ("goroutine has been blocked for 5 minutes"). The fastest way to find a deadlock or stuck worker pool.

---

## 9. Block and mutex profiles

Both are **disabled by default**. Enable them in your program before they produce anything useful:

```go
import "runtime"

runtime.SetBlockProfileRate(1)        // sample every blocking event (high overhead)
runtime.SetBlockProfileRate(10000)    // sample 1 in ~10000 blocking ns
runtime.SetMutexProfileFraction(1)    // sample every mutex contention
runtime.SetMutexProfileFraction(100)  // sample 1%
```

In production, use a fraction (e.g., `100`) to bound overhead. In a benchmark, `1` is fine.

```
go tool pprof -http=: http://localhost:6060/debug/pprof/block
go tool pprof -http=: http://localhost:6060/debug/pprof/mutex
```

`block` shows wall-clock blocking time (channels, select, network I/O usually appears here). `mutex` shows time blocked specifically on `sync.Mutex` / `sync.RWMutex` contention. They overlap but are distinct.

---

## 10. The `traces` command

```
(pprof) traces
-----------+-------------------------------------------------
       80ms   runtime.mallocgc
              runtime.makeslice
              main.parseLine
              main.handleRequest
              main.(*server).serveHTTP
-----------+-------------------------------------------------
       30ms   runtime.mallocgc
              runtime.makeslice
              main.encodeResponse
              main.handleRequest
              main.(*server).serveHTTP
```

Every sample, with its full stack and its `flat` value. Slow to read for big profiles but invaluable when:

- You suspect *one specific call path* is responsible.
- The graph view collapsed the path you care about.
- You want to grep for a string in your stacks.

`traces | grep parseLine` gives you every sample that touched `parseLine`, in order.

---

## 11. List, with line-level precision

```
(pprof) granularity=lines
(pprof) list parseLine
ROUTINE ======================== main.parseLine in /home/me/app/parse.go
     800ms      2.10s (flat, cum) 42.51% of Total
         .          .     12:func parseLine(s string) (Record, error) {
      90ms       90ms     13:    parts := strings.Split(s, ",")
     700ms      1.30s     14:    for _, p := range parts {
         .       50ms     15:        n, err := strconv.Atoi(p)
         .          .     16:        if err != nil { return Record{}, err }
       10ms       10ms     17:        r.values = append(r.values, n)
         .          .     18:    }
         .          .     19:    return r, nil
         .          .     20:}
```

Read it line by line. The `for _, p := range parts {` line is *itself* 700 ms. Why? Because each iteration's `append` is `growslice`-ing. The fix: pre-size `r.values = make([]int, 0, len(parts))`.

This is the form in which `pprof` answers most real questions. Get comfortable with it.

---

## 12. Combining profiles

`go tool pprof a.pb.gz b.pb.gz c.pb.gz` does a **union**: same-stack samples are added. Useful for:

- Aggregating profiles from many replicas of the same service.
- Combining short profiles into one with enough samples to be useful.
- Building a "fleet-wide" view from a sample set.

The profiles must agree on `sample_type`. Mixing CPU profiles from different binaries also works — symbols are embedded — but the union only makes sense if the binaries share code.

---

## 13. Reading the graph view

Each node is `function — flat (flat%) cum (cum%)`. Edge width = how much of the parent's cumulative time was spent in the child. A wide edge into a single child means that child explains the parent.

Three patterns to recognize:

- **Wide self-loop or wide flat in a leaf** — the function itself is slow.
- **One wide outgoing edge** — the function exists mainly as a wrapper; look at the child.
- **Many narrow outgoing edges** — the function dispatches; cost is distributed.

The default `nodefraction=0.005` hides anything below 0.5%. For complex programs, bump it to `0.02` to declutter; for missing context, drop to `0.001`.

---

## 14. The `--seconds` trap

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
```

If your workload only runs for 5 seconds inside that 30-second window, **25 seconds of your profile is idle**. Idle time samples almost nothing — but they dilute the percentages. The profile will look like "CPU is mostly idle" because, well, it was.

Match `seconds=N` to your workload. For HTTP services under load, 30 s is fine. For short batch jobs, profile from inside the program with `pprof.StartCPUProfile` instead.

---

## 15. Summary

The interactive shell is a small filter language: `focus`, `ignore`, `hide`, `show`, `sample_index`, `granularity`. The web UI exposes all of that interactively. `peek` answers "what calls this?" and "what does this call?"; `traces` answers "show me every sample". Saving profiles to disk and diffing with `-base` turns optimization from guesswork into a measured loop. Beyond this, the topics are: how the format works (senior), how labels and continuous profiling work (professional), and how to read flame graphs really well (optimize).

---

## Further reading
- `pprof` README, especially the "How to read profiles" section: https://github.com/google/pprof/blob/main/doc/README.md
- "Profiling Go Programs" blog post: https://go.dev/blog/pprof
- Felix Geisendörfer's pprof posts: https://www.polarsignals.com/blog
