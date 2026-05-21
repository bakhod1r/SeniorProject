---
layout: default
title: Fuzzing — Interview
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/interview/
---

# Fuzzing — Interview

[← Back](../)

This page collects interview questions on Go's native fuzzing facility introduced in Go 1.18. Questions are grouped by depth so you can use them as a self-check before a systems/Go-heavy interview, or as a script to run with a candidate.

## Conceptual questions

### 1. What problem does fuzz testing solve that table-driven tests do not?

Table-driven tests cover the inputs you, the author, thought of. Fuzzing automatically generates new inputs by mutating seed corpora and replaying any input that produces a crash, panic, hang, or assertion failure. The point is to expose paths a human did not anticipate — overflow on a 16-bit length field, a UTF-8 boundary case, a parser state machine that loops forever on a malformed header. Fuzzing is therefore complementary to, not a replacement for, table-driven tests.

### 2. How is Go's native fuzzing different from property-based testing (PBT)?

PBT, as in QuickCheck or `gopter`, lets you express invariants over typed properties and generates samples from those types using shrinking on failure. Native Go fuzzing operates on a narrower input alphabet (primitive types and `[]byte`/`string` only) and is coverage-guided — it instruments the binary and biases the mutator toward inputs that hit new branches. PBT shrinks failures to minimal cases automatically; Go fuzz saves the failing input verbatim under `testdata/fuzz/FuzzXxx/` and the developer reduces by hand or re-runs.

### 3. Which input types are allowed in `f.Fuzz` and `f.Add`?

Currently allowed: `string`, `[]byte`, `bool`, `byte`, `rune`, all sized integer types (`int`, `int8`, `int16`, `int32`, `int64`, `uint`, `uint8`, `uint16`, `uint32`, `uint64`), and `float32`/`float64`. Composite types such as structs, slices of non-byte types, maps, and channels are not supported as fuzz parameters. To fuzz a struct you typically take `[]byte`, decode it deterministically, and treat the decoder as part of the system under test.

### 4. What does the `-fuzz` flag actually do?

Without `-fuzz`, `go test` runs the `FuzzXxx` function exactly like a unit test — it executes the seed corpus from `f.Add` calls and any inputs already saved in `testdata/fuzz/FuzzXxx/` and exits. With `-fuzz=FuzzXxx`, the test runner enters fuzzing mode: it instruments the binary with coverage probes, spins up parallel workers (`-parallel` defaults to GOMAXPROCS), and continuously generates mutated inputs until the time budget specified by `-fuzztime` expires or a failure is recorded.

### 5. Where are crash inputs stored and why does that matter?

Crashes are persisted to `testdata/fuzz/FuzzXxx/<hash>` as a small, human-readable file containing the typed values that triggered the failure. Because this file lives inside the repository, it is committed to source control and becomes part of the regression suite — every subsequent `go test` (without `-fuzz`) replays it, so a fix accompanied by a fresh corpus entry is provably a regression test.

### 6. How do you reproduce a saved failure?

`go test -run=FuzzXxx/<hash>` will execute the function against just that saved input. You can also pass the failing input by editing `f.Add(...)` in the source and running the function as a normal unit test. Either form yields a deterministic, single-shot reproduction with full debugger and logging support.

### 7. What is the role of the seed corpus?

Seed inputs provided via `f.Add` give the mutator a starting point that already exercises interesting code paths. Without seeds, the fuzzer starts from random bytes and may take a long time to discover even basic structure (a valid JSON object, a well-formed PNG header). Well-chosen seeds dramatically reduce time-to-first-bug. They also act as documentation: a reader of the test can see typical inputs without running anything.

### 8. Explain coverage-guided mutation in one paragraph.

The fuzzer maintains a corpus of "interesting" inputs — those that, when executed, hit branches not previously hit. Mutators (bit flips, arithmetic offsets, splice operations between two corpus members, dictionary-based insertions) generate candidates. If a candidate hits a new edge in the coverage map, it joins the corpus. Over time the corpus grows in the directions of higher program complexity, which is why fuzzers find bugs deep inside parsers that pure-random generators never reach.

### 9. What is a "minimization" step and does Go's native fuzzer perform it?

Minimization tries to find a smaller input with the same coverage signature or the same crash. Go's native fuzzer performs corpus minimization at startup (it removes corpus entries whose coverage is subsumed by others) and value reduction on failures (it tries to shrink each typed argument while preserving the failure). The minimized failure is what gets written to `testdata/fuzz/FuzzXxx/`.

### 10. Can a single fuzz target take multiple inputs?

Yes. `f.Fuzz(func(t *testing.T, a int, b string, c []byte) { ... })` is legal. `f.Add` must then be called with three positional arguments of matching types. Multi-input fuzzers are useful when the system under test takes a key plus a value, or a configuration plus a payload — the fuzzer mutates each parameter independently.

## Practical questions

### 11. Write a fuzz target for a function `func ReverseRunes(s string) string` that should be an involution.

```go
func FuzzReverseRunes(f *testing.F) {
    f.Add("hello")
    f.Add("")
    f.Add("a")
    f.Add("Здравствуй")
    f.Fuzz(func(t *testing.T, s string) {
        if !utf8.ValidString(s) {
            t.Skip()
        }
        if got := ReverseRunes(ReverseRunes(s)); got != s {
            t.Fatalf("not involution: input=%q got=%q", s, got)
        }
    })
}
```

The `t.Skip` for invalid UTF-8 keeps the property well-defined; without it the fuzzer will report a failure for inputs that the function does not claim to handle.

### 12. How would you fuzz a JSON parser without your fuzz target panicking on every malformed input?

Wrap the call so that *expected* errors (i.e., `json.SyntaxError` or `json.UnmarshalTypeError`) are tolerated, and only crashes/panics or round-trip mismatches count as failures:

```go
f.Fuzz(func(t *testing.T, b []byte) {
    var v any
    if err := json.Unmarshal(b, &v); err != nil {
        return // expected for malformed input
    }
    out, err := json.Marshal(v)
    if err != nil {
        t.Fatalf("re-marshal failed for previously valid value: %v", err)
    }
    var v2 any
    if err := json.Unmarshal(out, &v2); err != nil {
        t.Fatalf("re-unmarshal of valid marshal failed: %v", err)
    }
})
```

### 13. What is the difference between `t.Skip()` and `t.Fatal()` inside a fuzz body?

`t.Skip()` tells the runner that this input is uninteresting and should not count against the corpus; the input is discarded and not retained. `t.Fatal()` records a failure, the input is persisted to `testdata/fuzz/`, and the fuzzer exits with non-zero status (unless `-keepfuzzing` is set). Using `t.Skip()` for *any* input that violates a precondition is the canonical way to make fuzz targets robust against the wide range of generated inputs.

### 14. Your fuzz target passes locally but the CI run finds a failure. How do you reproduce it?

CI should upload the contents of `testdata/fuzz/FuzzXxx/` as a build artifact. Download the artifact into your local repo at the same path and run `go test -run=FuzzXxx/<hash>` — this is a deterministic replay that does not require the fuzzing engine, just the saved file. If your CI does not upload the corpus, the workflow is misconfigured: failing inputs would be lost on the next build.

### 15. How do you fuzz a function whose input is a `struct`?

You cannot fuzz a struct directly. The idiomatic pattern is to fuzz on `[]byte`, decode deterministically inside the fuzz body using a stable encoding (gob, protobuf, or a custom unmarshaller that uses every byte), and treat decode failures as `t.Skip()`. The decoder becomes part of the system under test; if the decoder panics, you have already found a bug.

```go
f.Fuzz(func(t *testing.T, b []byte) {
    var cfg Config
    if err := cfg.UnmarshalBinary(b); err != nil {
        t.Skip()
    }
    _ = Apply(cfg) // must not panic
})
```

### 16. What is "structured fuzzing" and why does it matter?

Structured fuzzing means the fuzzer mutates parsed structures rather than raw bytes. In Go's native facility this is achieved indirectly by combining `[]byte` inputs with a custom decoder; in tools like `go-fuzz-headers` you build typed mutators that respect grammar. It matters because purely byte-level mutation rarely produces inputs that survive a strict parser, so the actually-tested code path is shallow. With structured mutators, the fuzzer reaches semantic-level bugs (e.g., off-by-one in a state machine after parsing succeeds).

### 17. How does Go's fuzzer interact with `GOCACHE`?

The compiled, instrumented fuzz binary is cached like any other test binary, and the corpus directory under `~/.cache/go-build/fuzz/<pkg>/FuzzXxx/` (or `$GOCACHE/fuzz/...`) holds the live corpus discovered during fuzzing runs. The `testdata/fuzz/` repo-tracked corpus is for crashes only; the GOCACHE corpus is the larger, coverage-driven working set. Clearing GOCACHE wipes that working set but not crashes.

### 18. How long should you fuzz?

There is no universal answer, but useful heuristics: in CI, allocate a fixed time budget per fuzz target (5–15 minutes per target on a PR; multiple hours nightly). During development of a new parser, fuzz interactively for at least an hour after each significant change. The diminishing-returns curve flattens after the working corpus saturates the coverage map; if you see no new corpus entries for several hours, you are no longer learning much and should mutate the seeds or the dictionary.

### 19. What does `-fuzzminimizetime` control?

It bounds how long the fuzzer spends shrinking each failing input. Default is one minute. Aggressive minimization can produce nicer failing inputs but slows the discovery loop; for CI you may set it to `10s` so the build does not stall on a hard-to-minimize crash.

### 20. Can fuzz targets run in parallel? What about determinism?

Workers run in parallel by default (`-parallel`). Inside a single worker, the fuzz body runs sequentially. Determinism is per-input: replaying the same saved corpus entry under `-run` is deterministic. Across a *fuzzing run*, the mutation sequence depends on coverage, scheduling, and timing, so two runs will not visit the same inputs. This is intentional — searching the same patch of input space twice is wasted effort.

### 21. Your fuzz target shares a global cache. The first input passes but the second crashes. What is wrong?

You are mutating shared global state between fuzz invocations. Each call to the fuzz body is supposed to be independent; if global state persists, you have a hidden coupling and the saved failure will not reproduce in isolation. Fix: reset the global at the top of the fuzz body, or refactor the system under test to thread the state explicitly. Otherwise `go test -run=FuzzXxx/<hash>` will not reproduce.

### 22. How do you fuzz code that performs I/O?

Either stub the I/O behind an interface so the fuzz body can supply an in-memory implementation, or scope the fuzz target to the pure portion of the code (the parsing or encoding step). Real I/O inside a fuzz body is slow, non-deterministic, and prevents the fuzzer from running thousands of inputs per second.

### 23. What is the workflow for triaging a fuzz finding?

1. Reproduce locally with `go test -run=FuzzXxx/<hash>`.
2. Read the saved input file — it is human-readable text.
3. Reduce by hand if the input is large.
4. Write a failing unit test using the reduced input.
5. Fix.
6. Run the same fuzz target for several hours to confirm no related failures.
7. Commit the `testdata/fuzz/FuzzXxx/<hash>` entry as a permanent regression.

### 24. How do you decide what to fuzz?

Fuzz code that parses or interprets untrusted input. Concretely: protocol decoders, file format parsers, expression evaluators, template engines, sanitizers, validators, deserializers. Algorithms with mathematical invariants (sorting, hashing, compression round-trips) are also great targets because the property is easy to state. Pure business logic with closed input domains is less rewarding to fuzz — table-driven tests give better return on effort.

### 25. What are the limits of native fuzzing?

Native fuzz can find: panics, data races (when `-race` is enabled), assertion failures, round-trip mismatches, infinite loops (via timeout). It does not directly find: logic errors with subtle semantic correctness criteria, performance regressions, memory exhaustion (unless paired with a watchdog), bugs requiring concurrent inputs from multiple goroutines, or bugs gated by external state. For those you still need unit tests, benchmarks, and integration tests.

### 26. Compare native fuzz with `go-fuzz` (dvyukov).

`go-fuzz` predates native fuzzing and is still widely used, especially against older projects and inside OSS-Fuzz. Differences: `go-fuzz` requires building an instrumented binary out of band (`go-fuzz-build`), uses libFuzzer-style harness functions that take a single `[]byte`, and integrates more tightly with OSS-Fuzz infrastructure. Native fuzz is part of the toolchain, supports typed multi-parameter targets, and stores its corpus in a way that is easy to commit. For new projects, native is the default; for OSS-Fuzz integration you may still write a thin `go-fuzz`-style harness.

### 27. Walk me through integrating fuzz into CI.

Add a separate workflow job that runs `go test -run=^$ -fuzz=FuzzXxx -fuzztime=10m ./...` per target. Upload `testdata/fuzz/` as an artifact on failure. Pin a budget per PR (short) and a nightly budget (longer). Make sure the corpus committed by humans is kept fresh — periodically minimize and remove redundant entries. Track new findings as issues, not as build failures, unless they are reproducible on `main`.

### 28. Common pitfalls you've seen?

Non-deterministic assertions inside the fuzz body (uses `time.Now`, `rand`, map iteration order), missing seed corpus (so the fuzzer wastes hours discovering basic shape), forgetting to commit the regression corpus after a fix, using `t.Errorf` instead of `t.Fatal` so the input is not saved, fuzz targets that take forever per input (slow targets discover few bugs per CPU-hour).

### 29. How would you fuzz a TLS handshake parser?

Pre-seed with captured ClientHello and ServerHello bytes. Mutate at the byte level. Use `t.Skip()` for inputs that fail the length-prefix sanity check very early. Watch for: unbounded memory allocation triggered by a 4-byte length, deeply nested extensions, certificate chains that exceed the limit, ASN.1 parser panics. This is exactly the class of code where native fuzz pays its rent.

### 30. Final question — how do you explain fuzzing to a non-technical stakeholder?

Fuzzing is automated stress testing for the parts of your system that read untrusted data. It is what a determined attacker would do to your code over a weekend; we run it for ten minutes a day in CI. Every bug it finds is one an attacker would otherwise find later.

[← Back](../)
