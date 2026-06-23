# Concurrent Fuzzing — Professional Level

> Focus: how the Go fuzzer works under the hood, coverage-guided mutation internals, the worker process model, the historical `dvyukov/go-fuzz`, and the engineering decisions that shape `testing.F`.

This page is about the implementation. If you have ever asked "what exactly is the fuzzer doing in the second between iterations?" this is the page for that.

## Table of Contents

1. [Architecture overview](#architecture-overview)
2. [Coverage-guided mutation](#coverage-guided-mutation)
3. [The persistent corpus on disk](#the-persistent-corpus-on-disk)
4. [Fuzz worker isolation](#fuzz-worker-isolation)
5. [Minimisation algorithm](#minimisation-algorithm)
6. [The `dvyukov/go-fuzz` predecessor](#the-dvyukovgo-fuzz-predecessor)
7. [Interaction with `-race`](#interaction-with--race)
8. [Performance characteristics](#performance-characteristics)
9. [Limits and engineering trade-offs](#limits-and-engineering-trade-offs)
10. [Summary](#summary)

---

## Architecture overview

The native Go fuzzer is implemented in `src/testing/`, `src/cmd/go/internal/test/`, and `src/internal/fuzz/`. At a high level it consists of:

- **Coordinator process.** The `go test` invocation. Holds the master corpus in memory, schedules work to workers, collects findings.
- **Worker processes.** N child processes, where N defaults to `GOMAXPROCS`. Each runs the compiled test binary with `-test.fuzzworker` set, communicating with the coordinator over a pipe.
- **The fuzz target binary.** Compiled with coverage instrumentation. Each worker invokes the fuzz function repeatedly with inputs the coordinator sends.

When you run `go test -fuzz=FuzzX -fuzztime=1m`, the toolchain compiles the test binary with `-cover` (light instrumentation, distinct from `-coverprofile`) and launches one coordinator. The coordinator spawns workers, distributes seed inputs, collects coverage, mutates inputs, and watches for failures.

```
   go test
      |
      v
+-------------+        +----------+
| Coordinator |<------>| Worker 1 |  --- runs fuzz function
|  - corpus   |        +----------+
|  - mutator  |<------>| Worker 2 |
|  - schedule |        +----------+
|             |<------>| Worker N |
+-------------+        +----------+
```

The pipe protocol is binary, internal, and not documented for external consumers. It transmits:
- Inputs (the byte representation of fuzz arguments).
- Coverage feedback (a hash of the basic-block bitmap).
- Crash reports (input, panic message, stack).

### Why separate processes?

Because a worker may crash. A panic, an OOM, or a `-race` halt would take down the test binary. With workers as separate processes, the coordinator survives, restarts the worker, and reports the failure cleanly. This is the same architecture used by libFuzzer and AFL.

---

## Coverage-guided mutation

The fuzzer prioritises inputs that expand code coverage. The implementation is light:

### Coverage instrumentation

When building with the fuzz flag, the toolchain inserts a counter increment at every basic block of the target package. The counter is stored in a global array. Each fuzz iteration starts by resetting the array. After the iteration, the array is hashed; if the hash is new (no previous iteration produced this hash), the input is interesting and saved.

This is a simplification — the actual instrumentation tracks edges (basic block transitions), not just blocks, using the `_8bit` counter style from libFuzzer. Edges are richer than blocks: they distinguish "we reached block B" from "we reached block B via path A → B" versus "via C → B."

### Mutation operators

The mutator applies one or more of these operations per iteration:

- **Bit flip.** A single bit in the input.
- **Byte flip.** A single byte to a random value.
- **Byte insert.** Adds a byte at a random offset.
- **Byte delete.** Removes a byte.
- **Length double.** Concatenates the input with itself.
- **Arithmetic.** Adds/subtracts a small constant to a multi-byte integer interpretation.
- **Interesting values.** Replaces a span with values from a built-in dictionary (`0`, `1`, `-1`, `0x7f`, `0x80`, `0xff`, `0x7fffffff`, `INT_MAX`).
- **Splice.** Concatenates portions of two different corpus inputs.

For string inputs the mutator is biased toward UTF-8 boundary cases. For integer inputs it picks edge values directly without going through bytes.

### The selection loop

```
loop forever:
    pick input I from corpus (weighted by recency, depth, executions-since-last-find)
    apply 1..k mutations to I, producing I'
    run fuzz function on I' under worker process
    if panic / t.Fatal:
        report failure, minimise, save reproducer
    elif new coverage:
        save I' to generated corpus
    else:
        discard I'
```

Weights are heuristic. Inputs that recently produced findings get higher weight. Inputs that have produced many uninteresting children get lower weight ("execution-since-last-find" dampening).

---

## The persistent corpus on disk

Two corpora exist on disk:

### `testdata/fuzz/FuzzXxx/`

Inside the module source tree. Contains:
- Hand-curated seeds (rarely — most use `f.Add`).
- Minimised reproducers from past failures.

Each file is plain text in `go test fuzz v1` format:

```
go test fuzz v1
[]byte("\x00\x01")
int(42)
```

The format is line-oriented: a version header, then one `type(literal)` line per fuzz parameter. The parser is in `internal/fuzz/encoding.go`.

### `$GOCACHE/fuzz/<module>/<package>/<target>/`

Outside the source tree. Contains the *generated* corpus — inputs the fuzzer found while exploring. Subdirectories per worker (`0`, `1`, etc.) hold per-worker discoveries; they are de-duplicated periodically.

Each input is stored as a single binary file. The filename is the hex SHA-256 of the contents (truncated). On startup the coordinator scans these directories and loads them as part of the seed pool.

`go clean -fuzzcache` deletes everything under `$GOCACHE/fuzz/`. Useful when:

- Upgrading Go (basic-block layout may have changed).
- Corpus has grown to gigabytes.
- You want a clean repro of a fuzz session.

### `-fuzzcachedir`

Overrides the location of the generated corpus. Useful in CI when `$GOCACHE` is ephemeral but you want to persist corpora to an artifact bucket:

```
go test -fuzz=FuzzParse -fuzztime=10m -fuzzcachedir=$HOME/fuzz-corpus ./parser
```

After the run, archive `$HOME/fuzz-corpus`. The next run can restore it before fuzzing.

---

## Fuzz worker isolation

A worker process runs the test binary in "fuzz worker" mode. Key behaviours:

### Cooperative shutdown

The coordinator sends a control message asking the worker to exit. The worker drains its current input, returns coverage, and exits. The coordinator restarts a fresh worker if more work remains.

### Hard timeouts

If the fuzz function does not return within a configurable timeout (default 10 seconds), the coordinator kills the worker. The input that caused the hang is saved as a "timeout" reproducer. Common cause: deadlocked goroutines inside the fuzz body.

### Crash isolation

If the worker crashes (panic, segfault, race detector halt), the coordinator reads the captured input from the pipe before reaping, saves the reproducer, and starts a new worker. This is why a crashing fuzz function still produces a clean report.

### Memory isolation

Workers share no memory with the coordinator. A memory-leaking fuzz iteration affects only its worker; the coordinator restarts that worker periodically (every N iterations) to bound resource usage.

---

## Minimisation algorithm

When a worker reports a failing input, the coordinator runs minimisation:

```
input = failing input
budget = -fuzzminimizetime (default 60s)
while budget remaining:
    for each mutation operator M:
        candidate = M(input)
        if candidate is smaller than input and still fails:
            input = candidate
            break (restart from new input)
        if no operator helped:
            return input  // local minimum
```

Mutations during minimisation are constrained to *shrinking* moves: delete bytes, replace with shorter values, simplify integers toward zero. The result is the smallest input the algorithm found that still triggers the same failure.

Minimisation is best-effort, not optimal. A 60-second budget often yields a 5–20 byte reproducer for a 5000-byte original. Increase the budget for harder cases:

```
-fuzzminimizetime=10m
```

For pure-coverage failures (panics with deterministic stacks) minimisation is fast. For races, minimisation is unreliable because the race may not reproduce every run; the algorithm needs many runs per candidate to be confident, and a `-race` build is already slow.

---

## The `dvyukov/go-fuzz` predecessor

Before Go 1.18, the de-facto fuzzer was `github.com/dvyukov/go-fuzz`, written by Dmitry Vyukov (also the author of the race detector). Understanding it helps you read older codebases and appreciate the design of the native fuzzer.

### Architecture

`go-fuzz` was a separate binary that:

1. Took a Go package as input.
2. Used `go-fuzz-build` to compile the target with libFuzzer-style coverage instrumentation.
3. Spawned a coordinator and workers in much the same model as today's native fuzzer.
4. Discovered the fuzz target by looking for a `Fuzz([]byte) int` function.

### The `Fuzz` function signature

```go
package mypkg

func Fuzz(data []byte) int {
    _ = Parse(data)
    return 0 // or 1 for "interesting"
}
```

The return value was a hint to the fuzzer: 0 = uninteresting, 1 = interesting, -1 = skip. Today's native fuzzer infers interestingness from coverage automatically.

### Differences from the native fuzzer

| Aspect | `go-fuzz` | Native (`testing.F`) |
|--------|-----------|----------------------|
| Single function signature | `func Fuzz([]byte) int` | `func FuzzX(f *testing.F)` |
| Multi-parameter inputs | Encoded as bytes | Native multiple parameters |
| Corpus format | Raw bytes | `go test fuzz v1` text |
| Discovery | External `go-fuzz-build` | Standard `go test` |
| Persistence | Manual | Automatic in `testdata/` and `$GOCACHE` |
| Integration with `-race` | Required custom builds | Just add `-race` |

The native fuzzer is the strict successor. Use `go-fuzz` only when you must target Go versions older than 1.18.

### `dvyukov/go-fuzz-corpus`

A companion repo with curated seed corpora for common Go packages (gob, image, html). If you fuzz one of those packages today, those seeds are still excellent starting points for `f.Add`.

### `gotri`

`gotri` (referenced in some discussions) is an experimental triplet-style fuzzer built on top of native `testing.F`. Less established than `rapid` or `go-fuzz`; mentioned here for completeness. For production code, use `testing.F` plus `rapid`.

---

## Interaction with `-race`

`-race` and `-fuzz` compose, but the composition has subtleties.

### Build cost

`-race` builds the binary with full TSan instrumentation. Build times go from 5 seconds to 20–60 seconds for a non-trivial package. Each fuzz run starts with this cost.

### Runtime cost

TSan instrumentation slows execution 5–15×. Memory usage grows 5–10× because TSan stores per-address shadow memory tracking happens-before edges. Adjust expectations: a fuzz target that managed 50,000 iterations/second without `-race` may manage 5,000 with it.

### Failure semantics

A `-race` detected race halts the worker with exit code 66 (`testing/internal/testdeps` defines `racy_exit_code`). The coordinator interprets this as a failure, saves the input, and reports both the race report and the input.

### Why `-race` matters for fuzzing

Without `-race`, fuzzing can only find:
- Panics.
- Explicit `t.Fatal` invariant violations.
- Hangs (via timeout).

With `-race`, you additionally find:
- Unsynchronised memory access on any input.
- Use of un-initialised happens-before edges.

The latter class is *enormous* in real concurrent code. A function may produce correct outputs under all single-threaded tests but contain a data race on a rare input. Only `-fuzz -race` finds it.

### When to omit `-race`

For purely sequential code, `-race` is unnecessary overhead. A parser, a string formatter, a numeric routine — all can be fuzzed without `-race`. Reserve `-race` for code that uses goroutines, channels, mutexes, or atomics.

---

## Performance characteristics

A useful mental model of fuzzer performance:

### Iterations per second

- Pure-Go fuzz function, no allocations, no I/O: 100,000–1,000,000 iter/sec per worker.
- Typical parser fuzz target: 10,000–100,000 iter/sec.
- Concurrent fuzz harness spawning 4 goroutines per iteration: 1,000–10,000 iter/sec.
- All of the above with `-race`: divide by 5–10.

### What dominates

For most targets, two things dominate:

1. **Allocation.** Every `make`, every interface boxing, every string conversion costs. Aggressive escape-analysis hostile code is slow to fuzz.
2. **Mutex contention.** A fuzz harness with `sync.Mutex` is bottlenecked on lock acquisition under `-race`.

### Tuning

- Drop unnecessary allocations from the fuzz body.
- Cap loop bounds derived from input (`min(n, 32)`).
- Use buffered channels of fixed capacity, not unbuffered.
- Reuse buffers via `sync.Pool` where safe.

### Memory ceiling

Workers may grow without bound if the fuzz function leaks. The coordinator restarts workers every ~100,000 iterations to reset memory. You can tune this via `GOFUZZRESTART` (undocumented; check the `internal/fuzz` source if you need it).

---

## Limits and engineering trade-offs

The native fuzzer is good, but it is not magic.

### Limit: input is bytes plus a few primitives

For structured input (an AST, a protobuf, a map), you encode and decode by hand. Decoding overhead and the coverage signal of "did the decoder reach the interesting code" are both costs.

### Limit: no built-in shrinking for `[]byte`

Minimisation shrinks raw bytes, but the result may not be the minimal *semantic* input — for example, removing one operation in your decoded op-list may require removing a specific byte span. The fuzzer does not know the structure.

### Limit: coverage is intra-package

Coverage tracks the package being fuzzed. Bugs in dependencies are still findable but the fuzzer optimises for the local coverage, which may miss interesting paths in deeper packages.

### Limit: timeout-based hang detection is coarse

A 10-second timeout per iteration is the default. A deadlock that takes 11 seconds to manifest is caught; a deadlock that takes 1 second per call but happens every call is not (the iteration completes, just slowly). For deadlock-prone code, lower the timeout or add explicit watchdogs inside the fuzz function.

### Trade-off: corpus persistence

Persistent corpora speed up subsequent runs but couple results across runs. A bug fixed in code may leave behind "obsolete" corpus entries that exercise paths no longer present, wasting future fuzzing time. Periodic `go clean -fuzzcache` resolves this.

### Trade-off: race detector cost

`-race` is the right default for concurrent code, but it makes the fuzzer 5–10× slower. In high-throughput environments you may run both: one job with `-race` for race detection, one without for raw coverage exploration. Combine corpora at the end.

---

## Summary

The native Go fuzzer is a coordinator-plus-workers libFuzzer-style fuzzer integrated into `go test`. It performs coverage-guided mutation, persists corpora to `$GOCACHE` and `testdata/`, isolates worker crashes via process boundaries, and supports cooperative shutdown and minimisation. The combination with `-race` makes it the most powerful concurrent-bug-finding tool in the Go toolchain. Its predecessor `dvyukov/go-fuzz` shaped the design and is still useful for pre-1.18 codebases. The engineering trade-offs are around input shape (bytes + primitives only), coverage scope (one package), and the cost of `-race` instrumentation. At professional level you understand these mechanics well enough to reason about why a given fuzz target finds (or fails to find) a given bug, to tune `-fuzzcachedir` and `-fuzzminimizetime` deliberately, and to build CI infrastructure that uses both the native fuzzer and complementary tools (`rapid`, `porcupine`, OSS-Fuzz).
