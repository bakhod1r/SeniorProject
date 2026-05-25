# pprof Deep Dive — Interview

Twenty questions, each with a short answer that a working engineer should be able to give without preparation.

---

### Q1. What does `go tool pprof` actually consume?

**A.** A gzipped protobuf file (`.pb.gz`) defined by `profile.proto`. The file is self-describing — it carries `sample_type` columns (e.g., `("cpu","nanoseconds")`), a stack of locations per sample, a function table with names and filenames, a mapping table for binaries, and optional labels per sample. The tool reads cpu, heap, block, mutex, goroutine, and custom profiles with no change in invocation because they all share this format.

---

### Q2. List the profile types that `net/http/pprof` exposes.

**A.** `profile` (CPU), `heap` (live + cumulative allocations, same data, different default), `allocs` (same data, default `alloc_space`), `goroutine`, `block`, `mutex`, `threadcreate`, `cmdline`, `symbol`, and `trace` (the execution trace, which is a different tool). All under `/debug/pprof/<name>`.

---

### Q3. What does `runtime.MemProfileRate` control?

**A.** The heap profile is sampled: on average one sample per `MemProfileRate` bytes allocated (default 524288 = 512 KiB). Smaller values increase fidelity and overhead. Setting it to `1` records every allocation; setting it to `0` disables heap profiling. In production, leave it default; in tests where you need exact attribution, lower it temporarily.

---

### Q4. Block and mutex profiles are usually empty. Why?

**A.** They're disabled by default. The runtime won't record blocking or contention events until you call `runtime.SetBlockProfileRate(rate)` and/or `runtime.SetMutexProfileFraction(fraction)`. A rate of `1` records every event (high overhead); higher numbers sample proportionally.

---

### Q5. What's the difference between `flat` and `cum` in `top`?

**A.** `flat` is the time spent inside the function itself, not counting callees. `cum` is `flat` plus all the time spent in functions called by it (transitively). A leaf function's `flat` equals its `cum`. A pure wrapper has `flat ≈ 0` and `cum` = its callee's `cum`.

---

### Q6. What's the difference between `inuse_space` and `alloc_space`?

**A.** `inuse_space` is bytes currently live on the heap (since the last GC update). `alloc_space` is total bytes allocated since the program started (never decreases). The same underlying samples produce both views; only the value column changes. `inuse_space` answers "what is retained?", `alloc_space` answers "what produced the GC pressure?".

---

### Q7. How do profile labels work, and on which profiles?

**A.** `pprof.Labels("k","v",...)` builds a label set; `pprof.Do(ctx, labels, fn)` runs `fn` with those labels attached to every CPU/block/mutex sample taken during the call. Labels do not attach to heap, goroutine, or threadcreate profiles. Inside the shell, `tagfocus=k=v` and `tagignore=k=v` filter by label.

---

### Q8. Do labels propagate to `go fn()` spawns?

**A.** No. `pprof.Do` labels the current goroutine. A `go fn()` spawned inside `pprof.Do` runs without labels. To label child goroutines, either call `pprof.SetGoroutineLabels(ctx)` at the top of the goroutine or wrap the work in another `pprof.Do`.

---

### Q9. What does `-base` do?

**A.** `go tool pprof -base=before.pb.gz after.pb.gz` shows only the positive delta between the two profiles. Functions that got cheaper are omitted. Both profiles must have the same `sample_type`. `-diff_base` is the signed version — shows both gains and losses (red/green in the web UI).

---

### Q10. Why is `runtime.mallocgc` at the top of a CPU profile not the GC's fault?

**A.** `runtime.mallocgc` is the heap allocator; it ran because your code asked for memory. The fix is to allocate less (pools, pre-sized slices, fewer interface conversions), not to make the allocator faster. To find the responsible code, switch to the heap profile with `sample_index=alloc_objects` or `alloc_space`.

---

### Q11. How does a CPU profile sample stacks?

**A.** The runtime registers a SIGPROF handler that fires at the CPU sample rate (default 100 Hz). On signal, the handler walks the currently running goroutine's stack and records the location IDs. Sample value is "1" per occurrence; the tool multiplies by the period (10 ms by default) to convert to nanoseconds. Only on-CPU goroutines tick — parked goroutines are invisible.

---

### Q12. How do you collect a profile programmatically?

**A.** For CPU: `pprof.StartCPUProfile(w)` + `pprof.StopCPUProfile()`. For named profiles (heap, allocs, goroutine, block, mutex, threadcreate, or custom): `pprof.Lookup(name).WriteTo(w, debug)`. `debug=0` writes the gzipped protobuf; `debug=1` writes a text format; `debug=2` (goroutine only) writes full stacks with timing.

---

### Q13. What does `pprof.NewProfile` do?

**A.** Registers a custom profile by name. `profile.Add(key, skip)` records the current stack and counts a sample keyed by `key`; `profile.Remove(key)` decrements. The standard library uses this internally for goroutine, threadcreate, block, and mutex profiles. You can use it to track any held resource — open files, leases, transactions — and read it back with the same `go tool pprof` tooling.

---

### Q14. Where in the profile do you look for source location?

**A.** The `function` table carries `name`, `system_name`, `filename`, `start_line`. The `location` table maps an address to a list of `Line` entries (multiple lines per location handle inlining). `pprof` resolves a sample's stack by walking from `Sample.location_id` → `Location` → `Line` → `Function`.

---

### Q15. Why is symbolization sometimes wrong?

**A.** If the binary was built with `-ldflags="-s -w"`, the symbol table is stripped — the profile's function names may be incomplete. Fix: pass the original binary to pprof (`go tool pprof binary cpu.pb.gz`) so it can read symbols from the binary's `gopclntab` section. Default Go builds include symbols, so this is rarely an issue.

---

### Q16. What does `peek` show?

**A.** For each function matching the regex: the callers (with how much of the function's `cum` each contributed) and the callees (with how much of the function's `cum` each consumed). It's the fastest way to attribute cumulative cost — "is this function expensive because of what it does, or because of what it calls?".

---

### Q17. Compare pprof and `go tool trace`. When do you use which?

**A.** `pprof` is a sampling profiler — statistical view, low overhead, good for "where on average". `go tool trace` is a tracer — every scheduling event recorded, high overhead, good for "what happened in this one window". Use pprof for "where is CPU going?", trace for "why was this request slow?" or "why did GC pause here?". The two are complementary.

---

### Q18. How would you find a goroutine leak?

**A.** Hit `/debug/pprof/goroutine?debug=2` and look at the text dump. Sort by occurrence — the most common stack is the leak. The line where the goroutine is parked tells you what it's waiting on (channel receive, send, select, sync.Cond). Then trace back from there to find the caller that doesn't unblock it. The binary profile (`/debug/pprof/goroutine`) aggregates stacks but doesn't show individual goroutine durations.

---

### Q19. What does `granularity=lines` do?

**A.** Aggregates samples by source line instead of function. `top` now shows the hottest lines across the program; `list` shows per-line cost. Useful when a function has one expensive line and many cheap ones — function-level aggregation hides the asymmetry.

---

### Q20. How do you safely expose a pprof endpoint in production?

**A.** Bind to `127.0.0.1` (or a Unix socket) on a dedicated mux and dedicated port — never on the public listener. Don't import `_ "net/http/pprof"` if you also serve real traffic on `http.DefaultServeMux`, because that shares the mux. Enable block and mutex profiling with bounded fractions (e.g., `SetBlockProfileRate(10000)`, `SetMutexProfileFraction(100)`), not `1`. Access via `kubectl port-forward` or an authenticated tunnel.

---

## Bonus: rapid-fire

| Question | Answer |
|----------|--------|
| Default CPU sample rate? | 100 Hz |
| Default `MemProfileRate`? | 524288 (512 KiB) |
| Default `nodefraction`? | 0.005 (0.5%) |
| File extension of a profile? | `.pb.gz` |
| Default `sample_index` for `/heap`? | `inuse_space` |
| Default `sample_index` for `/allocs`? | `alloc_space` |
| What `?debug=2` does on goroutine? | Returns full text stacks |
| Required to read source in `list`? | Source file at the path embedded in the profile (or `-trim_path`/`-source_path`) |
| What `web` requires? | `graphviz` installed |
| Default `-http=` port? | None — must specify; `:` picks a random free port |
| Format for diff profiles? | Same `sample_type` and same period |
| Custom profile API entry point? | `pprof.NewProfile(name)` |
| Mutex profile records what? | Time + count of contention on `sync.Mutex`/`sync.RWMutex` |
| Block profile records what? | Time goroutines spent blocked on any sync primitive |
| Source of CPU samples? | SIGPROF handler walking the current goroutine's stack |

---

## Summary

If you can answer all of these without looking, you understand pprof at the level required for most Go performance work. The most common gaps in interviews: (a) confusing `inuse_*` with `alloc_*`, (b) not knowing block/mutex are disabled by default, (c) not understanding the on-CPU vs. off-CPU split between CPU profile and goroutine/trace, and (d) not knowing that labels don't propagate to `go fn()`. Fix those four and you'll surprise an interviewer.

---

## Further reading
- `pprof` README: https://github.com/google/pprof/blob/main/doc/README.md
- `runtime/pprof` API docs: https://pkg.go.dev/runtime/pprof
- Go diagnostics guide: https://go.dev/doc/diagnostics
