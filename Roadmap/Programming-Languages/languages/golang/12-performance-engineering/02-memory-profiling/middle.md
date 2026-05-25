# Memory Profiling in Go — Middle

## 1. A workflow you can repeat

A memory investigation almost always follows the same loop:

1. **Reproduce** the symptom under load. A profile of an idle server tells you nothing.
2. **Capture** two profiles — one near the start of the symptom, one near the peak.
3. **Diff** them (`pprof -base`) so you see what *grew*, not what's merely big.
4. **Drill** into the top growing site with `list <fn>` to find the offending lines.
5. **Hypothesize** a fix; rebuild; bench with `-benchmem`; re-profile.
6. **Confirm** the new profile no longer shows the site, or shows it dramatically smaller.

The steps that newcomers skip are 1 and 3. Without load there's nothing to see; without a diff you'll chase the biggest allocator even if it's been steady forever.

---

## 2. Four metrics, one shell

In an open `pprof` shell, you can switch metrics at any time:

```
(pprof) sample_index=inuse_space       # live bytes
(pprof) sample_index=inuse_objects     # live object count
(pprof) sample_index=alloc_space       # cumulative bytes
(pprof) sample_index=alloc_objects     # cumulative object count
(pprof) top
```

Or from the command line:

```bash
go tool pprof -inuse_space  heap.pb.gz
go tool pprof -alloc_objects heap.pb.gz
```

Switching between them in a single session is how you tell apart "lots of small allocations" (high `alloc_objects`, low per-object size) from "few large allocations that stick around" (low `alloc_objects`, high `inuse_space`). Both can crush a server, but they need different fixes.

---

## 3. `top`, `list`, `peek`, `web`

Four commands cover 95% of the work.

| Command | What you learn |
|---------|----------------|
| `top` | Ranked list of allocators (sort by `flat` by default) |
| `top -cum` | Same list sorted by cumulative (including callees) |
| `list <regex>` | Source view, allocations annotated per line |
| `peek <regex>` | All callers and callees of a function with their share |
| `web` | Opens an SVG callgraph in your browser |
| `tree` | Text version of the callgraph |

```
(pprof) top
Showing nodes accounting for 220MB, 88.0% of 250MB total
Dropped 47 nodes (cum <= 1.25MB)
      flat  flat%   sum%        cum   cum%
   120MB 48.0% 48.0%    180MB 72.0%  myapp.(*Handler).process
    60MB 24.0% 72.0%     60MB 24.0%  encoding/json.(*decodeState).literalStore
    40MB 16.0% 88.0%     40MB 16.0%  bytes.makeSlice
```

`flat` is what this function allocated **directly**. `cum` includes everything its callees allocated. A function with high `cum` but low `flat` is a "manager" — the real work is in its children. Use `peek` to find them.

---

## 4. Interpreting `flat` vs `cum`

A common source of confusion. Consider:

```go
func handle(r *Request) Response {
    raw := parseBody(r)     // allocates 1 MiB
    return decode(raw)      // allocates 500 KiB
}
```

The profile would show:

| Function | flat | cum |
|----------|------|-----|
| `handle` | 0 | 1.5 MiB |
| `parseBody` | 1 MiB | 1 MiB |
| `decode` | 500 KiB | 500 KiB |

`handle` itself allocates nothing — it just calls things that do. If you only sort by `flat`, you miss the importance of `handle`. If you only sort by `cum`, every function near `main` looks important. You need both views; that's why `top` ships with `-cum` and `peek` ships at all.

---

## 5. The `pprof -base` diff

A single profile shows a snapshot. A diff shows the *change*:

```bash
go tool pprof -base baseline.pb.gz current.pb.gz
(pprof) top
```

Positive entries are sites that allocated more after the baseline. Negative entries allocated less. For a leak hunt, save a baseline early in the run and compare every 5–10 minutes:

```bash
curl -o t0.pb.gz http://localhost:6060/debug/pprof/heap
# ... wait for the leak to grow ...
curl -o t1.pb.gz http://localhost:6060/debug/pprof/heap
go tool pprof -base t0.pb.gz -http=:8080 t1.pb.gz
```

The flame graph of a diff is the single best leak-hunting tool the Go ecosystem ships.

---

## 6. The HTTP endpoints, with parameters

| URL | Behavior |
|-----|----------|
| `/debug/pprof/heap` | Heap profile (default: `inuse_space`) |
| `/debug/pprof/heap?gc=1` | Forces a GC first; "cleaner" inuse counts |
| `/debug/pprof/heap?debug=1` | Text dump instead of protobuf |
| `/debug/pprof/heap?debug=2` | Even more verbose (per-record stacks) |
| `/debug/pprof/allocs` | Cumulative allocations since process start |

`?gc=1` is worth knowing. Without it, the profile may include garbage that simply hasn't been swept yet, which inflates `inuse_space` numbers in a noisy way. With it, the profile reflects only what survived a forced collection — far more meaningful for leak analysis. The trade-off: forcing a GC takes some milliseconds and briefly pegs CPU.

---

## 7. `-memprofile` and `-memprofilerate` in tests

```bash
go test -bench=. -benchmem -memprofile=mem.out -memprofilerate=1 ./pkg
```

| Flag | Effect |
|------|--------|
| `-memprofile=mem.out` | Write a heap profile when the test ends |
| `-memprofilerate=1` | Record **every** allocation (default is 512 KiB sampling) |
| `-benchmem` | Print `B/op` and `allocs/op` per benchmark |
| `-benchtime=10s` | Run longer for more stable numbers |
| `-count=10` | Repeat to compute variance with `benchstat` |

For microbenchmarks, set `-memprofilerate=1`. The sampled default loses tiny allocations entirely, and microbenchmarks are exactly where you care about them. Don't ship that setting to production — it logs every allocation.

---

## 8. The shape of common allocation hotspots

Once you've seen these once, you'll recognize them in every profile.

| Hotspot | What the stack looks like | Fix |
|---------|---------------------------|-----|
| `runtime.growslice` | A loop appending without `make([]T, 0, cap)` | Pre-size the slice |
| `runtime.mapassign` | A function inserting into a map without sizing | `make(map[K]V, n)` |
| `runtime.convT*` | Boxing a value into an `interface{}` per call | Pass a pointer; box once |
| `fmt.Sprintf` / `fmt.Sprintln` | String formatting in a tight loop | `strings.Builder`, `strconv.*` |
| `bytes.makeSlice` | `bytes.Buffer.Write` exceeding capacity | `buf.Grow(n)` upfront |
| `encoding/json.(*decodeState)` | Decoding into `map[string]interface{}` | Decode into a typed struct |
| `runtime.stringtoslicebyte` | `[]byte(s)` in a hot loop | `io.WriteString`, `unsafe.StringData` (advanced) |
| `runtime.mallocgc` near `make([]byte, ...)` | Allocating scratch buffers per request | `sync.Pool` |

Memorize this table. When you open a profile, the first question to ask is "which of these does the top look like?" — most often the answer is one of them.

---

## 9. `pprof` flame graph reading

```bash
go tool pprof -http=:8080 heap.pb.gz
```

In the flame graph:

| Visual cue | Meaning |
|------------|---------|
| Wide block | Many sampled bytes attributed there |
| Tall stack | Deep call chain |
| Top frames | Where the bytes actually came from |
| Bottom frames | Entry points (often `main`, `goroutine`, handlers) |

Tips:

- Click a frame to zoom into its subtree.
- Switch metric in the upper-left dropdown to see `alloc_objects` vs `inuse_space`.
- Hover for the full function name; long names get truncated.
- Right-click → "Search" filters to frames matching a regex (useful for "show me only my package").

---

## 10. Capturing on a schedule

For a slow-leak hunt, take periodic snapshots:

```bash
mkdir -p /tmp/heaps
while true; do
    curl -s -o /tmp/heaps/heap-$(date +%s).pb.gz http://localhost:6060/debug/pprof/heap
    sleep 600
done
```

Then diff the oldest against the newest:

```bash
go tool pprof -base /tmp/heaps/heap-FIRST.pb.gz /tmp/heaps/heap-LAST.pb.gz
```

If the diff shows the same site growing across multiple hour intervals, that's the leak. This loop is the bare-bones version of what Pyroscope/Parca/Datadog do continuously.

---

## 11. Looking at `inuse_objects` deliberately

`inuse_space` shows bytes. `inuse_objects` shows count. For a profile dominated by a few large allocations, `inuse_space` is the right view. But when small structures dominate — millions of `*Node` in a tree, hundreds of thousands of map entries — `inuse_objects` reveals the work the GC actually does.

GC work is roughly proportional to object **count**, not byte total. A heap of one 1 GiB slice marks faster than a heap of one billion 1-byte objects. If your `GCCPUFraction` is high but the profile's `inuse_space` looks fine, switch to `inuse_objects` immediately.

---

## 12. When pprof and `MemStats` disagree

```
(pprof) top
Total: 250MB
runtime.MemStats.HeapAlloc = 80MB
```

This is normal. Three reasons:

1. **Sampling.** pprof extrapolates from samples; the result has variance.
2. **`alloc_*` vs `inuse_*`.** If you opened an allocs profile, you got the cumulative metric.
3. **GC timing.** `MemStats` is read at one instant; the profile was captured at a different one.

Rule: trust `runtime.MemStats` for absolute size; trust pprof for the **distribution** of allocations across call sites. They answer different questions.

---

## 13. Summary

The middle-level memory profiling workflow is: capture under load → diff two snapshots → drill in with `top` / `list` / `peek` → match the top stack against the table of common hotspots → fix → re-profile to confirm. Switch between `inuse_*` (leaks, steady state) and `alloc_*` (GC pressure, allocation rate) deliberately. Use `pprof -http=:8080` for the flame graph and `pprof -base` for diffs — those two flags cover most real investigations.

---

## Further reading
- pprof documentation: https://github.com/google/pprof/blob/main/doc/README.md
- Profiling Go programs: https://go.dev/blog/pprof
- Diagnostics in Go: https://go.dev/doc/diagnostics
- Heap profiling internals: https://github.com/DataDog/go-profiler-notes/blob/main/heap.md
