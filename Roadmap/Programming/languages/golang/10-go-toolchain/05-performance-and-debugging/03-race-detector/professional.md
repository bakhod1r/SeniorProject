# Race Detector — Professional

## 1. What is actually running under `-race`

Go's race detector is a port of **LLVM's ThreadSanitizer (TSan)**, integrated into the Go runtime. When you pass `-race`:

1. `cmd/compile` injects **race instrumentation** at every read and write to addressable Go memory. Each instrumented access becomes a call into the TSan runtime alongside the original load/store.
2. The Go linker links in the TSan runtime, vendored under `src/runtime/race` with the C/C++ shared object built per supported platform (e.g., `race_linux_amd64.syso`).
3. Synchronization primitives in `sync`, `sync/atomic`, and the runtime scheduler call into TSan to record happens-before edges (mutex acquire/release, channel send/recv, goroutine create/join).
4. The `runtime/race` package (`runtime/race.go`) wires the Go runtime to TSan: goroutine lifecycle, allocation events, and access events.

The TSan algorithm uses **vector clocks**: every goroutine has a logical clock, every memory location stores the vector clock of recent accesses, and synchronization operations merge clocks. A race is reported when an access happens at a clock value that is not strictly greater than the last conflicting access's clock — i.e., the two are concurrent in the happens-before lattice.

---

## 2. Shadow memory

Each application byte is shadowed by several **shadow cells** (in TSan, typically 4 per byte). A shadow cell stores:

- The goroutine (epoch) that performed the access.
- Whether the access was a read or a write.
- The access size (1/2/4/8 bytes).
- The position within the 8-byte word.

When N accesses to the same byte from N different goroutines pile up, older entries are evicted. That is why `GORACE=history_size=N` matters — it controls how far back the detector can attribute the *other* side of a race. With too small a history, the detector still notices the race but its "Previous access" trace may be empty.

Memory cost: 5x–10x heap (the shadow plus per-goroutine clock state plus runtime overhead).

---

## 3. Compile-time injection

You can see the instrumentation by looking at generated code:

```bash
go build -race -gcflags='-S' ./pkg 2>&1 | head -100
```

You will see calls to `runtime.racefuncenter`, `runtime.raceread`, `runtime.racewrite` (and the range/atomic variants) wrapping ordinary loads and stores. The generation lives in `cmd/compile/internal/ssagen` (formerly `ssa/race.go` / `gc/racewalk.go` in older versions); the runtime side is `src/runtime/race.go` and the C bridge `src/runtime/race/race.go`.

Atomic operations in `sync/atomic` go through their own `runtime.race{Acquire,Release,ReleaseMerge}` calls so the detector models them as full sync primitives rather than as raw reads/writes — that is why a correct `atomic.Load`/`atomic.Store` pair is race-free under `-race`.

---

## 4. Happens-before tracking

Examples of edges the runtime explicitly tells TSan about:

- `runtime.raceacquire` / `runtime.racerelease` on mutex Lock/Unlock.
- `runtime.raceacquireg` / `runtime.racereleaseg` for cross-goroutine edges via channels: every send/recv pair, every close/recv.
- Goroutine spawn (`go f()`) calls `runtime.racegostart`, establishing that everything before the spawn happens before everything inside the new goroutine.
- `sync.WaitGroup.Wait` returning establishes a join edge from each `Done` call.
- `sync.Once.Do` establishes an edge from the first invocation's body to all subsequent `Do` returns.

If you bypass these — e.g., synchronize through a non-atomic boolean — there is no edge. The detector treats your "sync" as nothing and reports the race correctly.

---

## 5. The `GORACE` environment variable

Configures the TSan runtime at process start. Format is space- or `_`-separated `key=value` pairs:

```bash
GORACE="log_path=/var/log/race halt_on_error=1 history_size=7" ./app
```

| Key | Meaning |
|-----|---------|
| `log_path` | Write reports to `log_path.<pid>` instead of stderr |
| `exitcode` | Exit status when a race is detected (default 66) |
| `strip_path_prefix` | Strip this prefix from filenames in reports |
| `history_size` | log2 of per-goroutine event history (default 1, max 7); higher = better "previous access" but more memory |
| `halt_on_error` | 1 = exit on first race report; 0 = keep running |
| `atexit_sleep_ms` | Wait this long before exit, letting background goroutines flush |

`history_size` is the most common knob worth tuning when you keep seeing "Previous access" with empty stacks in long-running services.

---

## 6. Performance budget

Concrete cost model (illustrative; measure your own workload):

| Operation | Non-race | -race | Factor |
|-----------|----------|-------|--------|
| Hot loop, mostly arithmetic | 100 ns/op | 200 ns/op | 2x |
| Tight allocator-heavy code | 50 ns/op | 500 ns/op | 10x |
| Channel-heavy concurrency | 1 µs/op | 5 µs/op | 5x |
| Process RSS (steady state) | 200 MB | 1.4 GB | 7x |
| Binary size | 12 MB | 25 MB | 2x |

Plan accordingly. Race-instrumented services need bigger pods, smaller traffic share, and revisited timeouts (some library code measures elapsed wall time and races itself if you wait too long).

---

## 7. Limits and known sharp edges

- **8128 goroutine cap (historical).** Older Go versions had a hard cap on goroutines the detector could track simultaneously; modern Go (1.19+) lifted it but TSan still has internal limits — extremely high goroutine counts can exhaust shadow state.
- **cgo and races into C memory.** The detector instruments Go reads/writes. It does **not** see what C code does to memory shared with Go via unsafe.Pointer. Races that originate in C code are invisible.
- **Signal handlers and asynchronous preemption** can have unusual interactions; very rarely you see a race report whose "previous access" is in runtime code — usually a real race in user code combined with runtime poll observations.
- **`runtime/race`** is an internal package; user code cannot call `Disable/Enable` from outside the standard library. If you genuinely need to silence the detector around a known-benign pattern (rare), rethink the design first.

---

## 8. Reading binaries and reports forensically

```bash
file ./app-race
# ELF 64-bit LSB executable, ..., not stripped

go tool nm ./app-race | grep runtime.race | head
# many runtime.race* symbols indicate this is a -race binary
```

A useful confirmation in incident response: if someone hands you a binary and you need to know whether it was built with `-race`, look for `runtime.race` symbols. The presence of `__tsan_*` symbols (the LLVM TSan runtime) is the smoking gun.

---

## 9. Where to read the source

The interesting files in the Go tree:

- `src/runtime/race.go` — Go-side glue to TSan (raceread, racewrite, raceacquire, racerelease, etc.).
- `src/runtime/race/` — the vendored TSan runtime per platform (`race_linux_amd64.syso` and friends).
- `src/cmd/compile/internal/ssagen/ssa.go` and related — instrumentation injection.
- `src/sync/mutex.go`, `src/sync/atomic/*.go`, `src/runtime/chan.go` — call sites that emit race edges.

Reading these once gives a working mental model of why `-race` catches what it catches.

---

## 10. Summary

Go's race detector is LLVM ThreadSanitizer compiled into the Go runtime, with the compiler injecting load/store instrumentation and the runtime emitting happens-before edges for every `sync`/`atomic`/channel/goroutine event. Shadow memory tracks recent accesses with vector clocks; reports fire when two accesses are concurrent under the happens-before lattice and at least one is a write. Cost is real and budgetable (2–20x CPU, 5–10x memory, 2x binary). Tune behavior with `GORACE` (`history_size`, `halt_on_error`, `log_path`), use the `race` build tag for race-only code, and remember the detector cannot see into C, cannot prove absence of races, and never reports a false positive.

---

## Further reading
- Source: `src/runtime/race.go`, `src/runtime/race/`
- ThreadSanitizer (LLVM): https://clang.llvm.org/docs/ThreadSanitizer.html
- TSan algorithm paper: https://research.google/pubs/pub35604/
- Go Memory Model: https://go.dev/ref/mem
- `GORACE` reference: https://go.dev/doc/articles/race_detector
