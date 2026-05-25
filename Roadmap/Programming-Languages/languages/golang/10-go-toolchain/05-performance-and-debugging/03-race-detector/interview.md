# Race Detector — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is a data race in Go?**
Two goroutines access the same memory location concurrently, at least one of the accesses is a write, and there is no synchronization (mutex, channel, atomic) ordering them. Data races are undefined behavior.

**Q2. How do you enable the race detector?**
Pass `-race` to `go test`, `go run`, `go build`, or `go install`. Most common: `go test -race ./...`. The flag must come **before** the package, not after.

**Q3. What does a `WARNING: DATA RACE` report tell you?**
The kind and address of the current access, the previous conflicting access (read/write), and where each involved goroutine was created. You read the user-code stack frames first; the goroutine creation lines tell you who is racing.

**Q4. Does `-race` cost anything?**
Yes — roughly 2x–20x CPU, 5x–10x memory, and a larger binary. It is fine for tests and CI, not for normal production traffic.

---

## Middle

**Q5. Does a clean `go test -race ./...` run prove your code has no data races?**
No. The detector is dynamic and only sees races in interleavings the run actually executed. A clean run is evidence, not proof. The other direction holds: when it fires, the race is real (no false positives).

**Q6. Why is `go test -race -count=10 -shuffle=on` useful?**
It widens the set of observed interleavings — more chances for an actual race to manifest. The detector cannot find what your tests never trigger.

**Q7. How do channels, mutexes, and atomics avoid being flagged as races?**
They install happens-before edges that the detector recognizes. Channel send/recv, mutex unlock/lock, `sync.Once.Do`, `sync.WaitGroup.Wait`, and `sync/atomic` operations all emit edges the runtime tells the detector about; ordinary shared variables do not.

**Q8. On which platforms does `-race` work?**
Linux (amd64, arm64, ppc64le, s390x), macOS (amd64, arm64), Windows (amd64, arm64), FreeBSD/NetBSD (amd64). 32-bit and mobile/WASM are not supported.

---

## Senior

**Q9. Should you run `-race` in production?**
Not by default. The overhead changes capacity and SLOs. Some teams run a small fraction of replicas with `-race` behind a flag; that is reasonable only when the workload can absorb the cost and CI/staging have already filtered the easy bugs.

**Q10. Can you instrument only some packages with `-race`?**
No. `-race` instruments the whole binary. You can only scope what *tests* you run with it (e.g., `go test -race ./internal/cache/...`). The build cache keeps race and non-race objects separate.

**Q11. What is the `race` build tag used for?**
It is set by the toolchain when the build is instrumented (`//go:build race`). Use it to gate diagnostic code that should only exist in race builds — expensive invariant checks, paranoid assertions — paired with a `!race` file containing no-op stubs.

**Q12. A report shows "Previous access" with an empty stack. What now?**
The event history was overwritten before the report fired. Bump `GORACE=history_size=7` (the max, log2 of event history) so the detector retains more of the past per goroutine.

---

## Professional

**Q13. What is the race detector actually built on?**
LLVM's ThreadSanitizer (TSan), vendored into the Go runtime under `src/runtime/race`. The Go compiler injects load/store instrumentation, `sync`/`atomic`/channel/runtime code emits happens-before edges, and TSan tracks them with vector clocks against shadow memory.

**Q14. Why does a race report sometimes point at runtime code?**
Usually because user-code goroutines were created by the runtime scheduler in response to library code (e.g., `net/http.(*Server).Serve` spawning per-request handlers). The fix lives in the *user-code* frames; the runtime frames just identify where the goroutines came from.

**Q15. What does `GORACE=halt_on_error=1` change?**
The process exits (with code 66 by default, configurable via `exitcode=`) on the first race report instead of continuing to run. Useful in CI and during reproducer scripts where you want the first failure to terminate the run.

---

## Common traps

- Putting `-race` after the package, so it goes to your program instead of the build (`go test ./... -race` does **not** enable the detector for the build action — flag position rules differ across tools, so prefer `go test -race ./...`).
- Treating a clean `-race` run as a proof of correctness.
- Believing the detector slows things down "a little" — production-realistic services often see 5x–10x slowdowns under load.
- Trying to scope `-race` to specific packages (you can't — only `-tags` scopes via build tags, not race instrumentation).
- Synchronizing through `time.Sleep` or a non-atomic boolean and being surprised the detector reports a race (it is right; the Go Memory Model gives you nothing there).
- Expecting the detector to find data races inside C code reached via cgo (it cannot — it only instruments Go memory accesses).
- Running `-race` with a tiny `GOMAXPROCS` and observing few races; raise it (e.g., `GOMAXPROCS=8`) for more real parallelism.
- Mixing `-race` with `-msan` or `-asan` in one build (they are mutually exclusive).
