# Concurrent Fuzzing — Interview Questions

> A focused set of interview questions, organised from foundational to advanced, with model answers. Use to self-test before an interview or to ask candidates yourself.

## Table of Contents

1. [Foundational questions](#foundational-questions)
2. [API and tooling questions](#api-and-tooling-questions)
3. [Concurrent fuzzing questions](#concurrent-fuzzing-questions)
4. [Property-based testing comparison](#property-based-testing-comparison)
5. [System-design-style questions](#system-design-style-questions)
6. [Tricky and corner-case questions](#tricky-and-corner-case-questions)

---

## Foundational questions

### Q1. What is fuzz testing?

Fuzz testing is an automated input-generation technique. The framework generates random or mutated inputs, runs a target function, and watches for crashes, panics, or invariant violations. Modern fuzzers are **coverage-guided**: they keep inputs that reach new code paths and mutate them further. Unlike example-based unit tests, fuzz tests express *properties* — "for any input, this should hold" — rather than specific input/output pairs.

### Q2. When did Go gain native fuzzing support?

Go 1.18, released March 2022. Before that the community used `dvyukov/go-fuzz` as an out-of-tree tool.

### Q3. What is a `Fuzz` target?

A function with signature `func FuzzXxx(f *testing.F)`, placed in a `_test.go` file. It registers seed inputs via `f.Add` and a fuzz function via `f.Fuzz`. The fuzz function takes `*testing.T` plus parameters matching the seed types. The framework drives the seeds (always) and mutated inputs (when `-fuzz` is set).

### Q4. What is the difference between running `go test` and `go test -fuzz=FuzzXxx`?

Without `-fuzz`, the framework runs the seed corpus (`f.Add` calls plus committed `testdata/fuzz/FuzzXxx/` files) once each, like ordinary tests. With `-fuzz`, after running seeds the framework launches worker processes that mutate inputs and run the fuzz function repeatedly, looking for new coverage and failures.

### Q5. Why is fuzz testing especially valuable for concurrent code?

Two reasons:

1. Concurrent bugs (races, deadlocks, lost updates) often depend on rare input + rare scheduling. Fuzzing supplies the rare inputs; running under `-race` catches the rare scheduling.
2. Concurrent code is hard to cover well with example-based tests. The state space of inputs × scheduling explodes. Fuzzing automates the exploration.

---

## API and tooling questions

### Q6. What types can you pass to `f.Add`?

`[]byte`, `string`, `bool`, `byte`, `rune`, all integer types (`int`, `uint`, `int8`...`int64`, `uint8`...`uint64`, `uintptr`), `float32`, `float64`. No slices of integers, no maps, no structs. Complex inputs must be encoded as `[]byte` and decoded inside the fuzz function.

### Q7. What does `-fuzztime` accept?

A duration (`30s`, `5m`, `2h`) or an iteration count with the `x` suffix (`10000x`). Default: no limit.

### Q8. Where is the persistent corpus stored?

Two places:

- **Committed reproducers:** `<module>/<package>/testdata/fuzz/FuzzXxx/<hash>`. Created by the framework when a failure is found, intended to be committed.
- **Generated corpus:** `$GOCACHE/fuzz/<module>/<package>/FuzzXxx/`. Holds inputs the fuzzer discovered while exploring coverage. Override with `-fuzzcachedir`.

### Q9. How do you clear the generated corpus?

```
go clean -fuzzcache
```

### Q10. What does `-fuzzminimizetime` control?

The maximum time the framework spends shrinking a failing input. Default `60s`. `-fuzzminimizetime=0x` disables minimisation; you get the raw failing input as the reproducer.

### Q11. How do you run the fuzzer with the race detector?

```
go test -fuzz=FuzzXxx -fuzztime=1m -race ./pkg
```

The race detector slows iteration 5–10× but catches data races that the fuzzer's inputs trigger.

### Q12. How do you skip ordinary tests when fuzzing?

Pass `-run=^$`:

```
go test -run=^$ -fuzz=FuzzXxx -fuzztime=1m
```

This skips all `TestXxx` functions so the workers focus entirely on fuzzing.

---

## Concurrent fuzzing questions

### Q13. What is a concurrent invariant?

A property of a concurrent program that must hold for any interleaving the scheduler can produce. Examples: a counter incremented N times and decremented M times reads `N - M`; a semaphore never permits more than `K` simultaneous holders; a queue's length never goes negative.

### Q14. Give an example of a concurrent invariant a fuzz test can check.

Final-state conservation for a concurrent counter:

```go
f.Fuzz(func(t *testing.T, ops uint64) {
    c := &Counter{}
    var expected int64
    var wg sync.WaitGroup
    for i := 0; i < 32; i++ {
        wg.Add(1)
        if (ops>>i)&1 == 1 {
            expected++
            go func() { defer wg.Done(); c.Inc() }()
        } else {
            expected--
            go func() { defer wg.Done(); c.Dec() }()
        }
    }
    wg.Wait()
    if int64(c.Value()) != expected {
        t.Fatalf("expected %d, got %d", expected, c.Value())
    }
})
```

### Q15. Why must the fuzz function be deterministic?

So that failures reproduce. The fuzzer saves the input that triggered the failure; later runs re-load the input and expect to see the same failure. If the function depends on `time.Now()`, unseeded `rand`, or external state, the reproducer is unreliable.

### Q16. Can you call `t.Parallel()` inside a fuzz body?

You can, but it usually does not help. The fuzzer already parallelises across worker processes. `t.Parallel()` parallelises within a single worker, which mainly contends on CPU. For CPU-bound fuzz bodies, leave it off.

### Q17. What is "stress replay"?

After the fuzzer finds a failure, you copy the failing input into a regular `TestXxx` and run it in a loop (1000–10,000 times) with `-race`. The rare interleaving that the fuzzer happened upon becomes near-certain, providing a reliable regression test that does not require running the fuzzer.

### Q18. What happens if a goroutine spawned by the fuzz function panics?

The panic crashes the worker process. The coordinator captures the input that was being fuzzed, saves it as a reproducer, and starts a fresh worker. The race detector or panic message is recorded in the report. To avoid losing context, `recover` inside spawned goroutines and propagate via channels or test-failure calls.

---

## Property-based testing comparison

### Q19. Compare `testing.F` and `pgregory.net/rapid`.

- `testing.F` is built into the standard library; `rapid` is a third-party library.
- `testing.F` supports only primitive parameter types; `rapid` supports any type via combinators.
- `testing.F` uses coverage-guided mutation (libFuzzer-style); `rapid` uses random generation with shrinkers.
- `testing.F` persists corpora to disk; `rapid` reproduces failures via deterministic seeds.
- `rapid` has built-in state-machine testing; `testing.F` requires you to roll your own.

Use both: `testing.F` for byte-oriented inputs and CI corpus persistence; `rapid` for structured inputs and state-machine invariants.

### Q20. What is `gopter`?

`github.com/leanovate/gopter` is an older Go property-based testing library, modelled after Haskell's QuickCheck. Still maintained, but `rapid` is the modern choice. You will encounter `gopter` in older codebases.

### Q21. How does `rapid`'s state-machine testing work?

You define a struct with methods. Each method represents one operation on the system under test, with an optional model side-effect. You pass the struct to `t.Repeat(rapid.StateMachineActions(machine))`. The framework picks methods at random, runs them, and after each call invokes an optional `Check` method to assert invariants. On failure it shrinks the action sequence to the minimum that still reproduces the bug.

### Q22. When would you choose `rapid` over the native fuzzer?

- Input is naturally structured (a tree, a map, a sequence of typed ops) and encoding to bytes feels artificial.
- You need rich shrinking on structured inputs.
- You want a quick state-machine test without writing a custom decoder.
- The system under test is sequential and you do not need coverage-guided exploration.

### Q23. When would you choose the native fuzzer over `rapid`?

- Input is naturally bytes (a parser, a decoder, a network frame).
- You want corpus persistence so failures are committed as regression seeds.
- You want coverage-guided exploration to push into rarely-reached code.
- You want to compose with `-race` as a built-in feature.

---

## System-design-style questions

### Q24. Design a fuzz strategy for a new lock-free queue you wrote.

1. Write `FuzzQueueConcurrent` that takes `[]byte`, decodes into a list of push/pop ops, spawns 4 goroutines that apply ops in parallel.
2. Run under `-race` for at least 10 minutes per release candidate.
3. Add invariants: queue length never negative, no value pushed but lost (track pushed values, after wait check that observed pops are a subset of pushes).
4. For ordering claims (FIFO under single-producer), add a linearisability check with `porcupine`.
5. Commit every failing reproducer under `testdata/fuzz/FuzzQueueConcurrent/`.
6. Stress-replay each one as a `TestRegression_Queue_<date>` test.
7. Nightly CI job runs `-fuzztime=10m -race`.

### Q25. Your team wants to add fuzzing to a 200-package monorepo. How do you roll it out?

- Identify the 5–10 packages with the most attack surface (parsers, decoders, public APIs).
- Write one fuzz target per public input-handling function in those packages.
- Add a nightly CI matrix that fuzzes each target for 5 minutes with `-race`.
- After the first week, audit the new corpus entries — these are existing latent bugs.
- Once those are fixed, expand to the next batch of packages.
- Document a fuzz-target template in your internal style guide.

### Q26. How would you decide if a package needs a fuzz target?

If the package takes input from outside trust boundaries (network, file, user), it needs fuzzing. If it has concurrent code paths (goroutines, channels, mutexes), it needs fuzzing + `-race`. Purely internal sequential code (a helper for string formatting used only by your own code) is a lower priority, but a fuzz target adds little cost and may still find bugs.

---

## Tricky and corner-case questions

### Q27. The fuzzer reports a failure but `go test -run=FuzzXxx/<hash>` does not reproduce it. What is wrong?

The fuzz function is non-deterministic. Common causes: time-dependent code, unseeded `rand`, scheduler-dependent assertions made before a `WaitGroup` waits, shared state across iterations. Fix the non-determinism first; flaky reproducers are worse than no fuzz at all.

### Q28. Why does `-fuzz` only allow one target per run?

The fuzzer is heavyweight: persistent corpus, coverage tracking, mutation state, worker processes. Sharing across targets would require partitioning all of this state. The Go team chose to keep the model simple: one target, one run. To fuzz several targets, run several `go test -fuzz` commands or several CI jobs.

### Q29. Can the fuzzer find a deadlock?

Yes, indirectly. The framework kills any iteration that exceeds a timeout (default 10s) and reports the offending input. So deadlocks that block the fuzz function are caught. Deadlocks that only manifest as a slowdown without hanging are not — the iteration completes, just slowly.

### Q30. Your fuzz target works for 10 seconds, then crashes the worker repeatedly. What is going on?

Likely a memory leak in the fuzz function. The worker accumulates memory across iterations, eventually OOMs or hits a runtime limit. Audit the fuzz body for `make`, append, or closure-captured slices that grow. Construct fresh state inside the fuzz function; never share state across iterations.

### Q31. You see a race report from `-fuzz -race`, but the stacks point inside the standard library. What now?

Check whether you are using a stdlib feature in an unsupported way (e.g. `http.ServeMux` mutation while serving). If your usage is correct, it may be a stdlib bug — search the Go issue tracker for the package and the type involved. Otherwise the race may be in your code's interaction with stdlib (you racing your `*http.Request` mutation with the server). Minimise the input and add the harness as a test in your repo; submit upstream if confirmed.

### Q32. Why might `-fuzz` find a bug that `-race` alone does not?

`-race` watches whatever happens during the run. Without `-fuzz`, the inputs are whatever your hand-written tests supply. Many race conditions trigger only on specific inputs (a parser that fails to lock when handling a malformed UTF-8 byte). `-fuzz` supplies those inputs; `-race` then catches the race.

### Q33. A senior engineer says "the corpus is bigger than the code." Is that a problem?

Not necessarily. A corpus of thousands of small inputs is normal for well-fuzzed parsers. What matters is whether the entries are unique and meaningful. Duplicates and obsolete entries (paths that no longer exist) are waste; periodic `go clean -fuzzcache` resolves them. Committed reproducers are smaller (dozens to hundreds typically) and are part of the test suite.

### Q34. Can fuzzing prove the absence of bugs?

No. Fuzzing is unsound — it explores a subset of inputs. The absence of failures after a finite run does not imply correctness. What it provides is *empirical confidence*: the more inputs fuzzed without finding a bug, the lower the probability of finding one in the same path. For correctness proofs, use formal verification (TLA+, etc.), not fuzzing.

### Q35. Compare `go test -fuzz` and OSS-Fuzz.

`go test -fuzz` is the local/CI fuzzer. OSS-Fuzz is a Google-operated service that runs your fuzz targets on Google infrastructure 24/7 for free (for open-source projects). OSS-Fuzz finds bugs neither of your tests nor your nightly CI would find because it runs much longer. Wiring your project into OSS-Fuzz takes one Dockerfile and one build script. Highly recommended for open-source security-critical code.

---

## Summary

The interview questions cover three layers: the API surface (`testing.F`, flags, corpus layout), the practice of concurrent fuzzing (invariants, `-race`, stress replay), and the broader testing ecosystem (`rapid`, `gopter`, OSS-Fuzz, property-based vs example-based). A strong candidate can explain *why* `-fuzz -race` is uniquely powerful, distinguish coverage-guided mutation from random generation, and design a fuzz strategy for a real concurrent data structure. The trickiest questions probe deterministic-reproduction, when fuzzing can and cannot find a bug class, and the relationship between fuzzing and formal correctness.
