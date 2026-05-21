---
layout: default
title: Fuzzing — Interview
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/06-interview/
---

# Fuzzing — Interview

[← Back](../)

A working set of questions and answers you can be asked when interviewing
for a Go backend, platform, or security role. Answers stay short, mention
the runtime mechanics, and reference the original proposal where relevant.
The Junior, Middle, and Senior pages are the source material; this page is
a distillation.

## Q1. What is the difference between a Fuzz and a Test function in Go?

A `Test` function takes `*testing.T` and runs once per `go test`. A `Fuzz`
function takes `*testing.F`, registers a seed corpus with `f.Add`, and a
fuzz target with `f.Fuzz`. With the `-fuzz` flag, the runtime mutates seeds
for coverage-guided exploration of new inputs. Without `-fuzz`, the corpus
is run as ordinary table-style subtests, so the saved crashers become
permanent regression tests.

## Q2. Which types can be passed to f.Add and the fuzz target?

`[]byte`, `string`, all sized integer types (`int`, `int8`, `int16`,
`int32`, `int64`, `uint`, `uint8`, `uint16`, `uint32`, `uint64`),
`float32`, `float64`, `bool`, `byte`, and `rune`. Composite types, slices
of non-byte types, maps, structs, interfaces, and channels are not
supported. This is documented in the `testing.F` godoc and was an
intentional simplification in proposal golang/go#44551.

## Q3. Where does Go store discovered crashes?

In `testdata/fuzz/<FuzzName>/` next to the test file. These files are
plain-text, hash-named, and are committed to source control. Generated
mutation corpus that improves coverage during a fuzz run lives under
`$GOCACHE/fuzz/<modpath>/<FuzzName>/` and is not committed.

## Q4. How do you reproduce a failing input?

Run `go test -run=FuzzName/<hash>` where `<hash>` is the file name inside
`testdata/fuzz/FuzzName/`. The runtime parses the file header
(`go test fuzz v1`), reads each Go-syntax literal as a parameter, and
replays the inputs through the fuzz target as a deterministic subtest. No
mutation happens in replay mode.

## Q5. Is Go fuzzing the same as property-based testing?

No, although they share a philosophy. Property-based testing (Haskell's
QuickCheck, Go's `pgregory.net/rapid`) generates inputs from
user-declared generators and shrinks failing inputs through generator-
aware transformations. Go fuzzing is coverage-guided: it observes which
branches execute and biases mutations toward inputs that hit new edges.
Both check invariants; only fuzzing uses coverage feedback.

## Q6. How long should a fuzz target run in CI?

A typical pattern is `-fuzztime=60s` to `10m` per commit on the main
branch. The seed corpus (committed `testdata/fuzz/...`) always runs as
table tests on every PR. Continuous fuzzing for hours or days is
delegated to OSS-Fuzz or a nightly job. Short CI fuzz windows only catch
regressions on inputs close to existing seeds; deep exploration needs
long-running infrastructure.

## Q7. What does t.Skip mean inside the fuzz target?

`t.Skip` inside the inner function tells the runtime that this input is
not interesting (for example, it failed a precondition). The runtime
does not count it as a failure but also does not save it to the corpus.
Use it for filtering inputs that you do not want to crash on, like
inputs over a size threshold or with invalid UTF-8.

## Q8. Why does the corpus on disk grow during fuzzing?

Each time the runtime finds an input that triggers a new coverage edge,
it stores it as a permanent corpus entry in `$GOCACHE/fuzz/...`.
Subsequent runs reuse this corpus as a starting seed set, so coverage
accumulates across runs on the same machine. The growth is bounded by
the number of distinct coverage signatures the code under test can
produce.

## Q9. Name two pre-1.18 fuzzers and one reason they still matter.

`github.com/dvyukov/go-fuzz` and `github.com/google/gofuzz`. They still
matter because go-fuzz supports fuzzing arbitrary struct types via
`go-fuzz-build`-instrumented binaries (native fuzzing only supports
basic types), while gofuzz seeds random struct values for property-style
tests (used heavily by Kubernetes for API round-trip tests). Both
predate native fuzzing by years and remain in active use for these
niches.

## Q10. What is the relationship between fuzzing and security?

Fuzzing is the standard tool for finding memory-unsafety, parser bugs,
and panic-inducing inputs in untrusted-data code paths. CVEs in
`encoding/xml`, `encoding/gob`, `net/http`, `crypto/x509`, and
`archive/zip` were all caught with native fuzzing after 1.18. OSS-Fuzz
runs continuous fuzzing on Go's standard library and many open-source
projects. Any function on a service that consumes external bytes should
have at least a no-panic fuzz target.

## Q11. Explain coverage-guided mutation in two sentences.

The runtime compiles the test binary with coverage instrumentation that
records which control-flow edges each input exercised. After each
execution, if the coverage bitmap differs from anything seen so far,
the input is added to the corpus and used as a starting point for
further byte-level mutations.

## Q12. What is the difference between go test and go test -fuzz=Fuzz?

`go test` runs every seed in `testdata/fuzz/Fuzz*/` and every `f.Add`
seed as a regular subtest with no mutation. `go test -fuzz=Fuzz`
selects exactly one fuzz target matching the regex, runs the seeds to
establish baseline coverage, then spawns workers that mutate inputs and
look for new coverage. Only one fuzz target may match `-fuzz` per
invocation.

## Q13. How do you fuzz a function that takes a struct?

Decompose the struct fields into supported types and assemble inside
the inner function:

```go
f.Fuzz(func(t *testing.T, name string, age int, active bool) {
    u := User{Name: name, Age: age, Active: active}
    _ = process(u)
})
```

Or use a pre-1.18 fuzzer like `go-fuzz` with `go-fuzz-headers` to
decode bytes into structs. Native fuzzing does not support struct
parameters directly.

## Q14. What is input minimization and why is it useful?

When the fuzz target fails, the runtime tries shrinking the input
(removing bytes, halving lengths, replacing values with smaller
equivalents) and retries until it can no longer shrink while still
reproducing the failure. The minimized input is saved. Minimization
turns a hundred-byte random blob into the smallest input that still
fails, making the bug easier to understand and fix.

## Q15. Can you fuzz code that uses goroutines?

Yes, but the engine sees the fuzz target as a single execution. If the
target spawns goroutines that crash after the target returns, the panic
will be reported but cannot be reliably reproduced because of
scheduling nondeterminism. For concurrency bugs, prefer the race
detector. For panics that propagate up before return, fuzzing works
fine.

## Q16. What does fuzztime=0s do?

Setting `-fuzztime=0s` runs no mutation iterations but still loads the
seed corpus and reports baseline coverage. It is useful in scripts when
you want to validate the fuzz target syntactically without burning CPU.

## Q17. How does fuzz minimization differ from QuickCheck shrinking?

QuickCheck uses generator-aware shrinking — the generator knows how to
produce a smaller, well-typed version of a failing input. Go's fuzz
minimization works at the byte level: it tries to remove bytes,
truncate, set values to zero. It cannot reason about syntactic
correctness, so the minimized input may be lexically simpler but
semantically arbitrary.

## Q18. What is OSS-Fuzz?

A Google-run continuous-fuzzing service for open-source projects. You
add a `project.yaml` and `build.sh` in the OSS-Fuzz repository; the
infrastructure builds your fuzz targets as libFuzzer-compatible
binaries and runs them 24/7 across many cores. Findings are filed as
private bugs with a 90-day disclosure window. The Go standard library,
many community projects (containerd, prometheus, helm) are on
OSS-Fuzz.

## Q19. Should I commit testdata/fuzz/... to my repository?

Yes. Files in `testdata/fuzz/FuzzXxx/` are seeds and minimized
crashers. They are both a regression test corpus and a documentation
of known-edge inputs. Without them, the next developer to run the
fuzz test starts from scratch and may not rediscover the bugs you
already fixed.

## Q11.5. How would you measure whether your fuzz target is good?

Three signals:

- Exec/s: at least 10,000 per second on a typical machine.
- Findings: produces at least one finding when run against
  deliberately introduced bugs (mutation testing).
- Coverage: the fuzz run hits significantly more lines than the
  unit tests for the same package.

If any of these is weak, the target is not pulling its weight.

## Q12.5. What is differential fuzzing?

A pattern where the fuzz target compares two implementations of
the same function — typically your hand-rolled code against a
reference implementation. Any disagreement is a finding without
having to specify the correct answer up front. Useful for
migrations, alternative implementations, and verifying
compatibility.

## Q13.5. What is the role of `-fuzzminimizetime`?

After a fuzz target fails, the engine spends up to
`-fuzzminimizetime` (default 60s) trying to shrink the failing
input to its minimal form. Setting this to `0s` disables
minimization — the raw failing input is saved without shrinking.
Useful for very fast CI runs where you do not want to wait for
minimization; the trade-off is harder-to-debug saved files.

## Q14.5. How do you fuzz a generic function?

You cannot directly. Native fuzzing's basic-types limitation
means generic functions cannot be fuzzed without monomorphizing.
Pick a concrete instantiation and fuzz that:

```go
func FuzzMaxInt(f *testing.F) {
    f.Fuzz(func(t *testing.T, a, b int) {
        _ = Max[int](a, b)
    })
}
```

For multiple instantiations, write multiple fuzz functions.

## Q20. Name one limitation of Go's native fuzzer and one workaround.

Limitation: only basic types as fuzz target parameters. Workaround:
take basic types in the target and decode them into the rich type
yourself, or use `go-fuzz` for struct-typed inputs.

Another limitation: no built-in support for stateful protocol
fuzzing. Workaround: drive a deterministic state machine from the
byte input — each input byte chooses the next action.

## Q21. How do you know when to stop fuzzing?

A fuzz run has diminishing returns. The first few minutes find
easy bugs. After an hour with no new findings, the engine has
likely plateaued on the current seeds. The cure is more or richer
seeds, not more time.

For new targets, run several minutes locally. If silent, commit
and let nightly CI take over. The cumulative coverage across many
nights eventually finds harder bugs.

## Q22. What is the trade-off between strong properties and
broad properties?

Strong properties find more bugs but produce false positives if
the spec is wrong. "Round trip is byte-for-byte identical" is
strong but wrong for parsers that accept non-canonical inputs.

Broad properties find fewer bugs but rarely produce false
positives. "Does not panic" is broad and almost always correct.

In practice, layer both. Start with broad, add strong as you
understand the spec.

## Q22.5. What is fuzz target throughput and why does it matter?

The number of times the engine calls the fuzz target per second.
Healthy targets run at 10,000 to 100,000 exec/s. Slow targets at
under 1000/s explore very little in a finite time budget.

Throughput matters because coverage-guided fuzzing is essentially
a search problem. More iterations equal more search. A target
that runs 100x slower finds 100x fewer bugs in the same wall
time.

## Q23. Should fuzz tests run on every PR?

The seed corpus runs as table tests on every PR; that costs
milliseconds. The actual `-fuzz` mode does not run on PRs because
it takes minutes-to-hours and the findings are non-deterministic.
Reserve `-fuzz` for nightly CI on the main branch.

## Q24. How do you handle a fuzz finding in production-critical code?

Treat it as a P0 security issue. Reproduce, scope the impact
(can an attacker trigger this in production?), fix, deploy. The
saved fuzz input is your regression test forever.

If the impact is high — denial of service, memory exhaustion,
crash in a public-facing component — coordinate with the security
team for disclosure. Patch first, disclose second.

## Q25. What is the most common fuzz target mistake juniors make?

Putting expensive setup inside the inner function. The target
runs millions of times per second; reading a config file inside
the inner function drops throughput to under 1000/s. Setup goes
outside `f.Fuzz`, in the outer fuzz function body.
