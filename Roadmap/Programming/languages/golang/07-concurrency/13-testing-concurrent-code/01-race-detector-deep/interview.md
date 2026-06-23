# Race Detector Deep Dive — Interview Questions

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Junior-Level Questions](#junior-level-questions)
3. [Middle-Level Questions](#middle-level-questions)
4. [Senior-Level Questions](#senior-level-questions)
5. [Professional-Level Questions](#professional-level-questions)
6. [Trick Questions](#trick-questions)
7. [System-Design Discussions](#system-design-discussions)

---

## How to Use This File

Each question lists what an interviewer is looking for. Read the question, attempt an answer aloud, then read the model answer. If you missed a key point, mark the question and re-read the corresponding section in `junior.md`, `middle.md`, `senior.md`, or `professional.md`.

---

## Junior-Level Questions

### Q1. What is a data race in Go?

**Expected:** Two or more goroutines accessing the same memory location, at least one of which is a write, with no happens-before edge between them. The Go memory model treats races as undefined behaviour.

**Bonus:** Distinguish from "race condition" in general — a data race is specifically a memory-model violation; a race condition can be a higher-level logical bug.

### Q2. How do you enable the race detector?

**Expected:** Pass `-race` to `go test`, `go run`, `go build`, or `go install`. Example: `go test -race ./...`.

**Bonus:** Mention `-count=1` to defeat the test cache so the race actually runs.

### Q3. What does the race detector cost?

**Expected:** About 5–15x CPU and 5–10x memory. Run in CI and during development; do not ship race binaries to production.

### Q4. The detector says "WARNING: DATA RACE." How do you read the report?

**Expected:** Identify the two access lines (file:line for each), check the goroutine creators, and ask "what synchronisation should be between these two accesses?" The fix is adding the missing edge.

### Q5. Can the race detector find deadlocks?

**Expected:** No. Use `-timeout` on `go test` (or `time.After` inside the test) to catch deadlocks. The Go runtime also panics with "all goroutines are asleep" when every goroutine is blocked.

### Q6. What happens if `-race` fires during `go test`?

**Expected:** The test is marked failed. The process exits with status 66 by default, or non-zero through the `go test` driver. The race report appears on stderr.

### Q7. Is the race detector deterministic?

**Expected:** Deterministic on a given execution trace, but Go's scheduler is nondeterministic, so different runs may exercise different schedules and report different races.

### Q8. Why might a race not be detected even with `-race` on?

**Expected:** The detector only sees code paths that actually execute. If the test never spawns the racing goroutines together, no instrumentation runs on those lines.

### Q9. Show a simple race and its fix.

**Expected:**

```go
var x int
go func() { x++ }()
go func() { x++ }()
```

Fix with `sync.Mutex` or `sync/atomic`. Demonstrate one of them.

### Q10. Why does Go choose to make data races undefined behaviour?

**Expected:** Allows the compiler and CPU to reorder freely on race-free code, enabling performance. Defined-behaviour memory models (e.g., Java's sequentially consistent races) are slower. The trade-off: programmers must add synchronisation.

---

## Middle-Level Questions

### Q11. Why include `-count=1` with `go test -race`?

**Expected:** `go test` caches results by source hash + flags. Without `-count=1`, a cached PASS may skip re-execution. Races are schedule-sensitive; you want every run to actually run.

### Q12. What does `GORACE=halt_on_error=1` do?

**Expected:** Stops the process at the first race report. Useful in CI so the failing report is the last thing in the log and not buried under noise.

### Q13. How do you stress-test for rare races?

**Expected:** Higher `-count`, more goroutines, vary `GOMAXPROCS`, run in nightly job, optionally insert `runtime.Gosched()` between suspicious operations. Use `-failfast` once you can repro.

### Q14. You see "concurrent map writes" panic in production. Is that a race?

**Expected:** Yes — Go's map runtime detects concurrent writes and panics. The race detector would have caught it. Both indicate the same root cause: unsynchronised map mutation.

### Q15. Design a CI job for race testing.

**Expected:** GitHub Actions / GitLab / CircleCI YAML with `go test -race -count=1 -timeout 5m ./...`, `GORACE=halt_on_error=1`, artifact upload of race reports on failure.

### Q16. Why does `-race` not catch a logical race in a bank-transfer example?

**Expected:** The detector finds *data* races — unsynchronised memory accesses. A bank transfer that locks for the read and locks for the write but allows another transaction between them is a logical race (TOCTOU). The detector sees nothing wrong with the individual accesses.

### Q17. What is the `race` build tag?

**Expected:** A build tag automatically set when `-race` is on. Files with `//go:build race` compile only under `-race`; files with `//go:build !race` compile only without.

### Q18. How would you confirm that a flaky test is caused by a data race?

**Expected:** Run repeatedly with `-race -count=N`. If `-race` consistently fires, race confirmed. If not, look at logical races, timing, or test framework issues.

### Q19. Two goroutines write to the same channel. Race?

**Expected:** No, channel operations are themselves synchronised. The internal state of the channel is managed by the runtime; multiple senders are safe. The runtime also publishes happens-before edges from send to receive.

### Q20. Two goroutines call `defer wg.Done()`, but the order is undefined. Race?

**Expected:** No. `WaitGroup.Done` is synchronised by the runtime. Order does not matter; the counter atomically decrements. `wg.Wait()` sees a happens-before edge from each `Done`.

### Q21. How does the race detector interact with cgo?

**Expected:** Instruments Go-side memory accesses. C code is opaque unless compiled with `-fsanitize=thread`. Cross-language races on Go-allocated memory mutated by C may produce confusing reports.

### Q22. The same race fires sometimes and not always. Is the code correct sometimes?

**Expected:** No. The race exists; the schedule determines whether the access pair occurs. The code is broken on every run; only manifestations differ.

---

## Senior-Level Questions

### Q23. Your CI race job takes 30 minutes. How do you cut it down?

**Expected:** Shard tests across N parallel runners (by package or by test name). Aggregate reports. Consider per-test sharding once one package dominates. Use `gotestsum` or similar tools for splitting.

### Q24. When (if ever) would you run `-race` in production?

**Expected:** Rarely. Possible exceptions: a canary instance handling a small fraction of traffic to reproduce a race that does not surface in test environments. Risks: 5–15x slowdown, 5–10x memory, container limits, cascading timeouts. Almost always, the right answer is "more stress tests, not production sampling."

### Q25. How do you guard against accidentally deploying a race binary to production?

**Expected:** A `//go:build race` `init()` function that panics if the environment is production. Tag binary names (`myapp-race`). CI workflow that refuses to push race builds. Build pipeline separation.

### Q26. How do you detect that a flake is environmental (CI runner load) vs a real race?

**Expected:** Real races show under `-race` reproducibly with enough iterations. Environmental flakes pass even under `-race` stress. Investigate by reproducing on multiple runner sizes and varying `GOMAXPROCS`.

### Q27. A test passes under `-race` 99 of 100 times. Is it correct?

**Expected:** The 1 failure is a race or a logical bug. Investigate by capturing the race report from that one run, then fix. "Mostly passing" is not passing.

### Q28. How do you reproduce a CI race on a developer laptop?

**Expected:** Copy the exact CI invocation including `GORACE` env. Check out the same commit. Run with high `-count`. Vary `GOMAXPROCS`. If still no repro, instrument with `Gosched` calls. Worst case, use `git bisect` to isolate the introducing commit.

### Q29. You have a monorepo with 20 `go.mod` files. How do you race-test them all?

**Expected:** CI matrix job per module, parallel. A wrapper script that iterates `find . -name go.mod -execdir go test -race ./... \;` for serial runs. Track total race-job duration as a metric.

### Q30. What is the trade-off of `history_size=7`?

**Expected:** Larger per-goroutine history buffer (16x default). Better stack traces for old accesses in reports, especially useful when racing accesses are temporally distant. Costs more memory (significant for million-goroutine workloads). Use in tests, not production.

---

## Professional-Level Questions

### Q31. Explain shadow memory.

**Expected:** Parallel memory area that mirrors program memory. For each byte of program memory, several shadow slots (typically four 8-byte slots) record recent accesses by goroutines along with vector-clock entries. The mapping is computed by a fixed bit-twiddling function from the program address. The shadow region is enormous in virtual memory but lazily faulted; resident memory is much less.

### Q32. Why are vector clocks the right abstraction?

**Expected:** Vector clocks compactly represent the happens-before partial order across multiple "threads" (goroutines). Comparison is element-wise; an update on synchronisation is a per-element max plus a self-increment. The classical Lamport mechanism scales to arbitrary numbers of goroutines (with reuse of clock slots).

### Q33. The race detector seems to miss a race I can prove exists. What is happening?

**Expected:** Most likely the race never executed in the observed schedule (different goroutines did not actually interleave at that address). Less likely: `unsafe.Pointer` games confused the instrumentation. Very unlikely: a bug in TSan or the runtime. Re-run with stress, vary `GOMAXPROCS`, add `Gosched`.

### Q34. Compare Go's race detector to C/C++'s `-fsanitize=thread`.

**Expected:** Same TSan algorithm under the hood. C/C++ overhead slightly higher (10–30x vs 5–15x) because Go's compiler can be smarter about which accesses to instrument. Same report format and exit code. Go integrates TSan with its channel and goroutine runtime; C/C++ TSan integrates with pthreads and atomics.

### Q35. Compare with Java's race detection landscape.

**Expected:** Java has no single blessed detector. Research tools (RoadRunner, FastTrack) use vector clocks. IntelliJ and OpenJDK research builds include TSan ports. JIT and reflection make dynamic instrumentation harder. Go's static compilation makes a single, well-supported tool feasible.

### Q36. Why does `-race` require a 64-bit platform?

**Expected:** Shadow memory mapping demands tens of TB of virtual address space. 32-bit platforms have only 4 GB, insufficient. WebAssembly likewise lacks the address-space tricks (and 64-bit hardware integer support varies). The algorithm fundamentally needs a large, sparse virtual mapping.

### Q37. What is in `runtime/race/race_amd64.s`?

**Expected:** Per-platform assembly entry points that call into TSan C functions. Handles stack switching from goroutine stacks to system stacks, since TSan is C code and expects a C stack. Implements `runtime.raceread`, `runtime.racewrite`, and the public ABI used by the compiler-inserted calls.

### Q38. The race report does not include a stack trace for the previous access. Why?

**Expected:** The history buffer (controlled by `GORACE=history_size`) was too small and the prior access's call stack was overwritten before the conflict was detected. Increase `history_size`.

### Q39. How does the race runtime integrate with channels?

**Expected:** Channel send calls `__tsan_release(&ch)`, receive calls `__tsan_acquire(&ch)`. For buffered channels, the runtime tracks happens-before per element, not per channel, so a send to one slot does not synchronise with a receive from another. The same applies to `close`.

### Q40. Could TSan produce a false positive?

**Expected:** In well-formed Go, essentially never. Theoretical possibilities: bugs in TSan, unsafe code that bypasses the type system, platform-specific instrumentation bugs. In practice, treat every report as a real bug and look for the missing edge.

---

## Trick Questions

### Q41. Two goroutines, no shared memory, both call `time.Now()`. Race?

**Expected:** No. Each call returns its own value. No shared state. The detector is silent.

### Q42. A read-only goroutine reads a variable. A writer writes it with a mutex held. The reader does not lock. Race?

**Expected:** Yes. Both sides must hold the mutex. The reader's plain read can observe a partial write or stale value.

### Q43. `sync/atomic` write paired with a plain read. Race?

**Expected:** Yes. The atomic write publishes; the plain read does not subscribe. Both sides must use atomics for a clean happens-before edge.

### Q44. Reading from a `nil` channel. Race?

**Expected:** No. A read from a `nil` channel blocks forever. No memory access, no race. The goroutine simply hangs.

### Q45. Two goroutines, one writes a `string`, the other reads it, no sync. Race?

**Expected:** Yes. A Go `string` is a header (pointer + length); writes are not atomic. The reader can see torn state.

### Q46. Two goroutines, one writes `int` on a 64-bit platform, the other reads, no sync. Race?

**Expected:** Yes — even though the underlying store may be atomic on hardware, the Go memory model says no synchronisation = data race.

---

## System-Design Discussions

### D1. Design a CI strategy for a high-volume monorepo where race testing must complete in under 10 minutes.

Areas to cover: per-module matrix, package sharding, race-only vs unit-only suites, nightly stress, log archival, race-detection metrics, quarantine policy.

### D2. Your application uses many `sync/atomic` operations. How do you verify correctness?

Areas: `-race` covers correctness on tested paths; stress tests covering producer/consumer patterns; property tests against a sequentially consistent reference model; review against the Go memory model.

### D3. You inherit a service that has never been run under `-race`. Walk through the on-boarding plan.

Areas: turn on `-race` in CI; expect many failures; prioritise by reproducibility; quarantine non-blocking flakes; stress matrix; fix categories systematically (maps, slices, captured loops, missing mutexes); track race count over time.

### D4. Race detection finds nothing for two weeks. Should the team relax?

Areas: no. Coverage of concurrent paths is the actual signal. Track race-test code coverage in concurrent code. Add stress tests for under-exercised paths. New goroutines in code review should add stress tests.

### D5. Compare strategies for testing concurrent Go vs concurrent Rust vs concurrent Java.

Areas: Go has `-race` (TSan) — central, easy. Rust has the borrow checker — race-by-construction guarantees for safe code. Java has fragmented options — FastTrack, IntelliJ tools, none ubiquitous. Trade-offs in ergonomics, soundness, and runtime overhead.
