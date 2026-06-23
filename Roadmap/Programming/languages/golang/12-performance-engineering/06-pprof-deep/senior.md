# pprof Deep Dive — Senior

## 1. What a `.pb.gz` actually contains

A pprof profile is a gzip-compressed protocol buffer message defined by [`profile.proto`](https://github.com/google/pprof/blob/main/proto/profile.proto). The whole format fits on one page; the key fields:

```proto
message Profile {
  repeated ValueType sample_type = 1;   // e.g. ("cpu", "nanoseconds")
  repeated Sample sample = 2;           // one stack + N values + labels
  repeated Mapping mapping = 3;         // binary → address range
  repeated Location location = 4;       // address → list of Lines
  repeated Function function = 5;       // name, filename, start_line
  repeated string string_table = 6;     // all strings, indexed
  int64 time_nanos = 9;
  int64 duration_nanos = 10;
  ValueType period_type = 11;           // sampling unit
  int64 period = 12;                    // 1 sample per this many units
  int64 default_sample_type = 14;
}

message Sample {
  repeated uint64 location_id = 1;      // stack, leaf first
  repeated int64 value = 2;             // one per sample_type column
  repeated Label label = 3;             // string or numeric tags
}
```

Two consequences worth internalizing:

1. **A profile is self-describing.** It knows what its values mean (`(cpu, nanoseconds)` vs `(inuse_space, bytes)`), so the tool doesn't need to be told. That's why `go tool pprof` reads cpu, heap, block, mutex, goroutine, and custom profiles with no flag changes.
2. **Symbols are inlined.** The `function` table carries `name`, `filename`, `start_line`. As long as the producer (your Go binary) had symbols when it generated the file, the consumer (your laptop running `pprof`) does not need the binary.

You can dump a profile to readable form without rendering:

```
go tool pprof -raw cpu.pb.gz | head -60
```

And to textual proto:

```
go tool pprof -proto cpu.pb.gz > cpu.txt
```

The proto form is shockingly readable; once you've seen it, the rest of pprof's behavior stops being magic.

---

## 2. How sampling actually works (CPU)

A Go CPU profile is built by `SIGPROF` delivered to the program at ~100 Hz (overridable via `runtime.SetCPUProfileRate`). On signal, the runtime walks the current goroutine's stack and records it. Each sample is "100 Hz × number of times this stack appeared" — so the **unit is CPU nanoseconds**, not wall-clock.

| Fact | Implication |
|------|-------------|
| 100 Hz default | Functions taking less than ~10 ms total are invisible |
| On-CPU only | I/O wait, channel parks, GC blocking don't show |
| Per-goroutine sampling | Multi-goroutine work sums naturally |
| Signal-driven | Programs running with `GOMAXPROCS=1` and a tight loop in `runtime.cgocall` may under-sample |

For a 10 s profile you collect ~1000 samples per CPU. If your hot function appears in <10 samples, its bucket is statistically meaningless. Profile longer.

---

## 3. How sampling actually works (heap)

The heap profile is **also** sampled: roughly one sample per `runtime.MemProfileRate` bytes allocated (default 512 KiB). Each sample records the stack at allocation time and the bytes allocated.

```go
runtime.MemProfileRate = 1        // record every allocation (tests only)
runtime.MemProfileRate = 524288   // default
runtime.MemProfileRate = 0        // disable heap profiling entirely
```

When you set it to a smaller number, you get more samples but the program runs slower and the heap profile gets bigger. Production rule: leave at default.

A small allocation (e.g., `*int`) is sampled with probability `size / MemProfileRate`. The profile scales values up so the totals match reality on average. For very small or very rare allocations, the variance is high — don't read individual numbers, read *shapes*.

The `inuse_*` columns and the `alloc_*` columns come from the **same** samples; the runtime maintains a count of how many of each sampled object are still live.

---

## 4. Block and mutex sampling

```go
runtime.SetBlockProfileRate(1)     // record every blocking event
runtime.SetBlockProfileRate(100)   // record only events that blocked ≥ 100 ns
runtime.SetMutexProfileFraction(1) // record every contention event
runtime.SetMutexProfileFraction(N) // record 1/N events on average
```

Block profile semantics: each sample is a *blocking event* — a moment when a goroutine paused (channel, select, sync.WaitGroup, etc.). The `delay` value is how long that block lasted. The `contentions` column is event count.

Mutex profile semantics: each sample is a *contention event* — a `Lock` call that had to wait. The `delay` is wait time.

For a steady-state service, set both to a low fraction (e.g., 100) at process startup. Re-enabling them on a live binary is awkward (no public RPC); the workaround is an admin endpoint.

```go
http.HandleFunc("/admin/blockprofile", func(w http.ResponseWriter, r *http.Request) {
    rate, _ := strconv.Atoi(r.URL.Query().Get("rate"))
    runtime.SetBlockProfileRate(rate)
    fmt.Fprintf(w, "block profile rate = %d\n", rate)
})
```

---

## 5. Profile labels

Labels are string key/value pairs attached to **CPU**, **block**, and **mutex** samples (not heap, not goroutine count). They turn one big profile into many smaller ones, slice-able by any dimension you choose.

```go
ctx := pprof.WithLabels(r.Context(), pprof.Labels(
    "route", routePattern,
    "tenant", tenantID,
    "method", r.Method,
))

pprof.Do(ctx, pprof.Labels(), func(ctx context.Context) {
    handleRequest(ctx, r)
})
```

What `pprof.Do` does:

1. Attaches the labels to the current goroutine (`pprof.SetGoroutineLabels`).
2. Runs `fn`.
3. Restores the previous labels.

Inside the profile, every sample taken while the labels are attached carries them. In the shell:

```
(pprof) tagfocus=route=/api/v1/orders
(pprof) tagignore=tenant=internal
```

In the web UI, the "Refine → Tag focus" menu does the same interactively.

A few important rules:

- **Labels do not propagate via `go fn()`.** When you spawn a goroutine, the labels are *not* inherited. `pprof.Do` runs `fn` synchronously and uses the current goroutine, so labels apply naturally; but if your handler launches workers via `go ...`, those workers are unlabeled. Either pass a labeled context and re-apply with `pprof.SetGoroutineLabels(ctx)` in the worker, or use `pprof.Do` recursively.
- **Labels add a small overhead to every sample.** A few labels are free; hundreds per request are not.
- **Labels do not attach to allocations.** Heap profile labels are technically supported by the format but Go does not currently populate them.

---

## 6. Custom profiles

Beyond the built-in profile types, you can define your own:

```go
var openFiles = pprof.NewProfile("openfiles")

func open(path string) (*os.File, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    openFiles.Add(f, 2)   // 2 = skip frames; record stack of the caller's caller
    return f, nil
}

func closeFile(f *os.File) error {
    openFiles.Remove(f)
    return f.Close()
}
```

Then expose it the same way the built-ins are exposed:

```go
import _ "net/http/pprof"   // registers the standard set
// register the custom one explicitly:
http.HandleFunc("/debug/pprof/openfiles", func(w http.ResponseWriter, r *http.Request) {
    openFiles.WriteTo(w, 0)
})
```

`go tool pprof http://.../debug/pprof/openfiles` shows you the stacks of every still-open file. The same pattern works for any "currently held" resource: DB transactions, HTTP requests, leases, locks you implement, anything.

`Add` records a stack and increments a counter keyed by the first argument; `Remove` decrements. When the counter reaches zero, the stack is dropped.

---

## 7. Reading the call graph rigorously

Each edge in the graph view has a weight. That weight is "of all the cumulative time charged to the parent, how much came from this child?". Edge weights into a single node sum to the node's `cum`.

The default `edgefraction=0.001` hides edges below 0.1% of the *total*. If a node has 50 callers each contributing 0.05%, all 50 vanish. To see them:

```
(pprof) edgefraction=0
(pprof) web
```

Conversely, on a complicated profile the graph is unreadable until you raise `nodefraction` and `edgefraction`:

```
(pprof) nodefraction=0.02
(pprof) edgefraction=0.01
```

A useful mental model: graph view is for "what shape does this profile have?". Top + list is for "what should I change?". They answer different questions; you'll usually want both open.

---

## 8. Symbolization

When `go tool pprof` loads a profile, it tries to resolve every `Location.address` to a `Function`. There are four modes (set with `-symbolize`):

| Mode | Behavior |
|------|----------|
| `none` | Don't symbolize at all; show raw addresses |
| `local` | Use the local binary (`go tool pprof <binary> <profile>`) |
| `fastlocal` | Like local, but only if symbols already present in the profile |
| `remote` | Fetch from the profile's source URL (the `/debug/pprof/symbol` endpoint) |

For Go binaries built with default flags, the profile already has symbols, and `fastlocal` (the default) is a no-op. If you stripped symbols (`-ldflags="-s -w"`), the profile is unsymbolized. Provide the original binary:

```
go tool pprof /path/to/myserver cpu.pb.gz
```

The binary's `gopclntab` section maps PCs to functions; pprof reads it directly.

---

## 9. Source paths

`function.filename` in the profile is an **absolute** path on the producer machine. `list <regex>` needs that file at that path on the consumer machine. The two options:

```
go tool pprof -trim_path=/build/src cpu.pb.gz
```

Strip a known prefix. Now `/build/src/app/parse.go` becomes `app/parse.go`, which pprof resolves relative to the current working directory.

```
go tool pprof -source_path=/home/me/repo cpu.pb.gz
```

Add a search root. pprof tries that prefix when a filename is missing.

Both flags accept colon-separated lists. In CI environments where the producer and consumer have different mount points, set `-trim_path` so profiles open cleanly on any developer's laptop.

---

## 10. Period and rate

```
period_type = (cpu, nanoseconds)
period = 10_000_000          // 10 ms = 100 Hz
```

The `period` field tells pprof how to convert sample counts into time. For a CPU profile, "this stack appeared 7 times" × 10 ms = 70 ms of CPU. You'll never edit this manually, but you should know it exists: if a tool produces a profile with the wrong `period`, every number is off by a constant factor.

For heap profiles, `period` is `runtime.MemProfileRate`; for block profiles, it's the rate you set with `SetBlockProfileRate`. The runtime sets these correctly; third-party producers occasionally don't.

---

## 11. Combining profiles, the careful way

Naive union is `a + b + c`. Issues to watch for:

| Issue | Resolution |
|-------|------------|
| Different sample_type lists | Tool errors; profile types must match |
| Different binaries | Function names align by string; if you renamed a function between builds, it splits into two entries |
| Different durations | `duration_nanos` is summed; per-sample values are summed; rates per-second still work after division |
| Different MemProfileRate | The runtime scales each profile's values before recording, so the union is *roughly* right but variance compounds |

A practical recipe to aggregate a fleet:

```
for i in $(seq 1 100); do
  curl -s "http://host$i:6060/debug/pprof/profile?seconds=30" -o /tmp/p$i.pb.gz
done

go tool pprof -http=: /tmp/p*.pb.gz
```

You now have a fleet-wide CPU profile with much better signal than any single replica.

---

## 12. Programmatic profile access

You don't have to use the HTTP endpoints. The `runtime/pprof` API gives direct access:

```go
import "runtime/pprof"

// CPU
f, _ := os.Create("cpu.pb.gz")
_ = pprof.StartCPUProfile(f)
work()
pprof.StopCPUProfile()
_ = f.Close()

// Built-in named profiles
for _, name := range []string{"heap", "allocs", "goroutine", "block", "mutex", "threadcreate"} {
    out, _ := os.Create(name + ".pb.gz")
    _ = pprof.Lookup(name).WriteTo(out, 0)
    _ = out.Close()
}
```

`debug` parameter to `WriteTo`:

- `0` — gzipped protobuf (what `go tool pprof` wants).
- `1` — text format, function names + counts.
- `2` (goroutine only) — text format with full goroutine stacks.

The text formats are great for `grep` and incident response when you can't get the binary profile out.

---

## 13. Sampling vs. tracing

`pprof` is a *sampling* profiler — it sees a statistical view. Sampling profilers have two crucial properties:

- **Low overhead.** Even at 100 Hz, the cost is sub-percent.
- **Bounded resolution.** Anything taking less than a sampling period is statistically invisible. Anything that happens once is statistically invisible.

If you need "every event, in order" (e.g., why one specific request was slow), you need a *tracing* tool. That's `go tool trace`, covered in `../07-trace-tool/`. The two are complementary:

| Question | Tool |
|----------|------|
| Where is CPU spent on average? | pprof CPU |
| Why is this one request slow? | trace |
| What allocates? | pprof heap (allocs index) |
| What causes goroutine wake latency? | trace |
| Are there mutex contention hotspots? | pprof mutex |
| Did GC pause near this event? | trace |

`pprof` is the first thing to reach for; `trace` is the second.

---

## 14. The default_sample_type field

A profile can declare a preferred `sample_index` via `default_sample_type`. When the Go runtime writes a heap profile, it sets the default to `inuse_space`. When it writes via `/debug/pprof/allocs`, it sets it to `alloc_space`. Same bytes on disk; different default view. This is why "heap" and "allocs" feel like different profiles even though they aren't.

If you build a custom profile and want a sensible default view, set `default_sample_type` yourself.

---

## 15. Summary

Under the hood, pprof is a small, well-specified protobuf format paired with a flexible regex-and-filter REPL. CPU profiles are signal-driven samples at ~100 Hz; heap profiles are byte-rate samples at one per 512 KiB; block and mutex profiles must be explicitly enabled. Labels turn a profile into a slice-able dataset by request/tenant/route. Custom profiles let you instrument any "currently held resource" with no new tooling. Symbolization, source paths, periods, and default sample types are the few details you need to know when profiles produced elsewhere need to render here.

---

## Further reading
- `profile.proto`: https://github.com/google/pprof/blob/main/proto/profile.proto
- `pprof` internals: https://github.com/google/pprof/tree/main/internal
- `runtime/pprof` source: https://github.com/golang/go/tree/master/src/runtime/pprof
- "Profiling Go programs with sample labels": https://rakyll.org/profiler-labels/
