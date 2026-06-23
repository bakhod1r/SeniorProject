# go tool trace — Professional

## 1. Trace format v2 — the cutover at Go 1.21

Before Go 1.21, the runtime emitted "trace v1": events were serialized through a single global lock, batched by P, and required `go tool trace` to parse a monolithic timeline. The format had real costs (lock contention on emission) and real limits (single goroutine reading the whole file, hard ceiling on practical trace size).

**Go 1.21 shipped trace format v2** (proposal `#60773`). Highlights:

- **Per-P generation-based batching** — each P writes a stream of batches without coordinating with other Ps; the global lock is gone from the hot path.
- **Self-describing per-generation headers** — the decoder no longer needs the whole file to make sense of any region.
- **Streamable parsing** — `internal/trace` (and its v2 implementation) can process batches as they arrive, enabling tools to scale beyond what fits in RAM.
- **Strict event ordering only within a P / generation** — global timeline is reconstructed by merging.

User code does not change. `runtime/trace.Start`/`Stop` and `go tool trace` work identically; the format on disk is different, and Go 1.21+ tools cannot read v1 traces and vice versa.

The v2 format is also what made the **flight recorder** (Go 1.23+) practical: rolling per-P buffers are exactly v2 generations dropped from the head as new ones arrive.

---

## 2. Per-P ring buffers in the runtime

Each P owns a `traceBuf` (a linked list of fixed-size pages). When a goroutine running on that P performs a traceable action, the runtime calls into `runtime/trace.go` to append an event to the local buffer — no global lock, no cross-P coordination on the fast path.

When a buffer page fills, the runtime hands it to a background trace reader (`runtime.traceReader`), which serializes it out to the user-provided `io.Writer` (the file from `trace.Start(f)`). The flight recorder works the same way but discards old pages from a rolling tail instead of writing them out.

Consequences:
- Per-event overhead is the cost of a few atomic writes plus the rare page-flush.
- Memory pressure is `GOMAXPROCS × page_size × pages_in_flight`.
- A wedged trace reader (slow writer) eventually back-pressures the runtime, which can spike latency. Always write traces to a fast local disk, never directly over the network in production.

---

## 3. Where events come from

Events are emitted from precisely the runtime call sites that change scheduler/GC/syscall state. A non-exhaustive map:

| Subsystem | File / function | Events emitted |
|-----------|-----------------|----------------|
| Scheduler | `src/runtime/proc.go` | `ProcStart`, `ProcStop`, `GoStart`, `GoEnd`, `GoBlock*`, `GoUnblock`, `GoSysCall`, `GoSysExit` |
| GC | `src/runtime/mgc*.go` | `GCStart`, `GCDone`, `GCSTWStart`, `GCSTWDone`, `GCMarkAssistStart`, `GCMarkAssistDone`, `GCSweepStart`, `GCSweepDone` |
| Allocator | `src/runtime/malloc.go` | `HeapAlloc`, `HeapGoal` |
| Network poller | `src/runtime/netpoll.go` | indirectly via `GoUnblock` with `Network` reason |
| User API | `src/runtime/trace/annotation.go` | `UserTaskCreate`, `UserTaskEnd`, `UserRegion`, `UserLog` |

The decoder in `internal/trace` (modernized as `internal/trace/v2`) ingests these batches, validates per-P generation ordering, then merges them into a logical timeline that `go tool trace`'s HTTP/JSON layer serves to the browser UI.

---

## 4. Event taxonomy (the ones you'll see most)

| Class | Event | Meaning |
|-------|-------|---------|
| Proc | `ProcStart` / `ProcStop` | A P attached to / detached from an M |
| Go | `GoCreate` | A goroutine was created (with stack of creator) |
| Go | `GoStart` / `GoEnd` | A goroutine started running / exited |
| Go | `GoBlock`, `GoBlockSend`, `GoBlockRecv`, `GoBlockSync`, `GoBlockNet`, `GoBlockSelect` | A goroutine parked, classified by reason |
| Go | `GoUnblock` | Another goroutine made this one runnable (carries unblocker's identity) |
| Syscall | `GoSysCall` / `GoSysExit` | Enter / exit OS syscall (P handoff happens between them when long) |
| GC | `GCStart` / `GCDone` | Garbage-collection cycle boundaries |
| GC | `GCSTWStart` / `GCSTWDone` | Stop-the-world phase boundaries |
| User | `UserTaskCreate` / `UserTaskEnd` | `trace.NewTask` boundary |
| User | `UserRegion` (start/end) | `trace.WithRegion` boundary |
| User | `UserLog` | `trace.Log(ctx, key, value)` annotation |

Each event carries a timestamp (P-local monotonic, normalized at parse time), the P it occurred on, the G it pertains to, and often a stack trace ID into a shared symbol table to keep events small.

---

## 5. How `go tool trace` reconstructs the timeline

The flow inside `cmd/trace`:

1. **Open and parse** `trace.out` via `internal/trace/v2`. Build the merged event stream.
2. **Build derived views:** per-goroutine state machines, per-P utilization, GC timeline, user task tree, blocking aggregates.
3. **Start a local HTTP server** on an ephemeral port. The landing page (`/`) lists tabs; each tab is a separate URL serving JSON.
4. **Serve the timeline** to the browser, which renders it using a vendored copy of the older **Catapult / Perfetto** trace viewer (the same `chrome://tracing` engine).

The Catapult viewer is JavaScript heavy and single-threaded; very large traces choke its UI before the parser. This is *the* reason the "capture short windows" rule exists — it is a UI scaling limit, not a parser limit.

---

## 6. Reading the source

If you want to ground your mental model in the runtime, the canonical files are:

| Path | What it has |
|------|-------------|
| `src/runtime/trace.go` (older) / `src/runtime/trace/*` (v2) | Public `Start`, `Stop`, `IsEnabled`, internal buffer management |
| `src/runtime/traceback.go` | Stack collection for trace events |
| `src/runtime/trace/annotation.go` | `NewTask`, `WithRegion`, `Log` |
| `src/internal/trace/v2/*` | The parser used by `go tool trace` (and by anyone consuming traces) |
| `src/cmd/trace/*` | The viewer: HTTP server, derived views, embedded UI |

Reading the parser is the fastest way to truly understand the event taxonomy — every event type is a Go struct with documented fields.

---

## 7. Custom analysis (bypassing the UI)

Because `internal/trace/v2` exposes the parsed event stream, you can write your own analysis without the browser:

```go
import "internal/trace" // exported analogue: golang.org/x/exp/trace (subject to change)

r, _ := trace.NewReader(os.Open("trace.out"))
for {
    ev, err := r.ReadEvent()
    if err == io.EOF { break }
    if ev.Kind() == trace.EventStateTransition {
        // custom: count goroutines that went runnable → running > 1ms
    }
}
```

This is how teams build CI checks like "fail the build if any goroutine waited >5ms scheduler latency during the load test." `internal/` is technically unstable; for production, prefer the public mirror at `golang.org/x/exp/trace` or copy the parser source.

---

## 8. Operational notes for large fleets

- Centralize traces with structured filenames (`service-host-timestamp.trace`) and a short TTL bucket. Traces contain stack frames, HTTP paths, `trace.Log` keys/values — treat them as PII-class data.
- Roll out the flight recorder behind a kill switch with conservative buffer sizes (start with 1-2s of history).
- Snapshot on **SLO miss** (latency above threshold) and on **specific error classes**, not on every error.
- Build a small TUI or web UI on top of the `golang.org/x/exp/trace` parser for triage instead of opening every trace in the browser.

---

## 9. Summary

The tracer is a per-P, lock-free event recorder; the v2 format (Go 1.21+) made it streamable and unlocked the flight recorder (Go 1.23+). Events are emitted at every scheduler/GC/syscall transition plus user `trace.NewTask`/`WithRegion`/`Log`. `go tool trace` parses with `internal/trace/v2`, builds derived views, and serves them through a local HTTP server to a vendored Catapult/Perfetto browser UI — whose single-threaded rendering is the binding constraint on capture window size. For automation and CI gates, parse traces directly with `golang.org/x/exp/trace` rather than driving the UI.

---

## Further reading
- Trace v2 proposal: https://github.com/golang/go/issues/60773
- `runtime/trace` package: https://pkg.go.dev/runtime/trace
- `golang.org/x/exp/trace`: https://pkg.go.dev/golang.org/x/exp/trace
- `src/cmd/trace` and `src/internal/trace/v2` in the Go source tree
