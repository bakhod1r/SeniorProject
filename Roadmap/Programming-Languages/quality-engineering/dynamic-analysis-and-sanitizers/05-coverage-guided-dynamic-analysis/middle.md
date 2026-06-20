# Coverage-Guided Dynamic Analysis — Middle Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Coverage-Guided Dynamic Analysis
> *The junior page told you a fuzzer throws random bytes at code and a sanitizer catches the wreckage. This page opens the hood: the coverage feedback loop that makes the "random" bytes anything but, the harness you actually write, how the corpus is born and pruned, and how this whole machine lives in CI instead of on one engineer's laptop.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Coverage Feedback Loop](#core-concept-1--the-coverage-feedback-loop)
5. [Core Concept 2 — In-Process vs Out-of-Process Execution](#core-concept-2--in-process-vs-out-of-process-execution)
6. [Core Concept 3 — The Harness (Fuzz Target)](#core-concept-3--the-harness-fuzz-target)
7. [Core Concept 4 — Corpus Management & Dictionaries](#core-concept-4--corpus-management--dictionaries)
8. [Core Concept 5 — Structure-Aware Fuzzing](#core-concept-5--structure-aware-fuzzing)
9. [Core Concept 6 — The Sanitizer as Oracle](#core-concept-6--the-sanitizer-as-oracle)
10. [Core Concept 7 — Running It & Reading the Log](#core-concept-7--running-it--reading-the-log)
11. [Core Concept 8 — CI Integration & Continuous Fuzzing](#core-concept-8--ci-integration--continuous-fuzzing)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does the fuzzer turn random bytes into a directed search, and how do I build and run the loop for real?**

A quick recap, because everything below builds on it. *Coverage-guided dynamic analysis* is the pairing of two tools that are weak alone and devastating together: a **coverage-guided fuzzer** that generates inputs, and a **sanitizer** that watches each run. The fuzzer's job is to drive execution into code that tests never reach; the sanitizer's job is to notice the instant that execution does something illegal — a heap overflow, a use-after-free, a signed-overflow UB — and stop with a precise report. The fuzzer is the input generator; the sanitizer is the bug oracle.

The junior model — "it tries lots of inputs and the sanitizer yells" — is correct but misses the engine that makes it work. Pure random input is hopeless: the odds of randomly producing bytes that pass a PNG's 8-byte magic header, let alone reach the interesting decoder branch behind it, are astronomically small. What makes a modern fuzzer effective is **coverage feedback** — it measures which code each input exercises and keeps the inputs that reach *new* code, then mutates those. Coverage becomes the fitness function of a guided search. Understand that loop, the harness it calls, and the corpus it feeds on, and fuzzing stops being "spray and pray" and becomes a tool you can reason about, tune, and trust in CI.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can describe the fuzzer + sanitizer pairing in one sentence.
- **Required:** You can compile a C/C++ program with `clang` and you've run a sanitizer at least once — see [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md).
- **Required:** A rough sense of a control-flow graph — basic blocks joined by branches (edges). See [Build Fundamentals](../../build-systems/01-build-fundamentals/middle.md) for how the toolchain instruments compiled code.
- **Helpful:** You've written a unit test and understand a test harness as "set up input → call the unit → check the result."
- **Helpful:** Familiarity with running jobs in CI.

---

## Glossary

| Term | Meaning |
|---|---|
| **Edge** | A directed transition between two basic blocks in the control-flow graph (CFG). The unit of coverage most fuzzers track — strictly more informative than block coverage. |
| **Corpus** | The set of inputs the fuzzer keeps because each one reached new coverage. The fuzzer's accumulated knowledge of how to reach interesting code. |
| **Seed corpus** | The initial, human-supplied inputs you hand the fuzzer to bootstrap the loop — ideally small, valid, format-diverse examples. |
| **Harness / fuzz target** | The function the fuzzer calls in a loop, handed each generated input. In libFuzzer: `LLVMFuzzerTestOneInput`. |
| **Mutation** | A small edit to an existing corpus input: bit/byte flips, arithmetic on integers, splicing two inputs, dictionary-token insertion. |
| **Oracle** | The thing that decides an input found a bug. Usually a sanitizer; also assertions, or a differential comparison against another implementation. |
| **Dictionary** | A list of tokens (magic bytes, keywords) the mutator inserts verbatim, so it can guess format-specific strings it would never stumble on randomly. |
| **In-process** | The harness runs in the fuzzer's own process, called millions of times in a loop (libFuzzer). Fast; one crash ends the run. |
| **Fork server** | The fuzzer `fork()`s a pre-initialized child per input (AFL/AFL++). Robust to crashes and global state; slower per exec. |
| **`exec/s`** | Executions per second — the fuzzer's raw throughput, the denominator of how fast it explores. |

---

## Core Concept 1 — The Coverage Feedback Loop

This is the whole idea; everything else is plumbing around it. The fuzzer runs a **genetic search** where the fitness of an input is *the new code it reaches*.

**Step 1 — Instrument the target for coverage.** At compile time the toolchain inserts a tiny probe at every CFG edge. With Clang, `-fsanitize=fuzzer` (or the standalone `-fsanitize-coverage=...`) wires in **SanitizerCoverage**: each edge gets a counter, and libFuzzer reads the counter array after every run to see which edges fired. AFL inserts its own instrumentation (classically via a patched assembler or `afl-clang-fast`); **AFL++** can use the same LLVM passes for sharper, edge-level signal. Either way, the contract is the same: *after one input runs, the fuzzer can ask "which edges did that touch?"*

**Step 2 — Run an input, read its coverage.** The fuzzer executes the harness on an input and snapshots the edge set it covered. It compares against the **global** coverage seen so far across the whole campaign.

**Step 3 — Keep it only if it's new.** If the input hit an edge never seen before — or pushed an edge into a new *hit-count bucket* (AFL/AFL++ bucket counts as 1, 2, 3, 4–7, 8–15, …, so "this loop ran 9 times" is distinguishable from "it ran twice") — the input is **interesting**: add it to the corpus. Otherwise discard it. Almost everything is discarded; that's expected.

**Step 4 — Mutate the corpus to find more.** Pick an interesting input and apply mutations — bit flips, byte arithmetic, **splices** (graft a chunk of one corpus input onto another), dictionary insertions. Feed the mutant back to Step 2. Over millions of iterations the corpus accretes inputs that, between them, reach deeper and deeper into the code.

```
        ┌──────────────┐
        │  pick input  │◄──────────────────────┐
        │ from corpus  │                        │
        └──────┬───────┘                        │
               ▼                                │
        ┌──────────────┐    ┌───────────────┐   │
        │   mutate it  │───►│ run harness   │   │
        └──────────────┘    │ + read edges  │   │
                            └──────┬────────┘   │
                                   ▼            │
                         new edge / new bucket? │
                          yes │       │ no      │
                              ▼       ▼          │
                        add to corpus  discard ──┘
```

> **Key insight:** Coverage is the fitness function. The fuzzer never "understands" your format — it climbs a gradient where the only signal is *new code reached*. This is why a 50-byte seed that already parses a valid header can be worth more than a million random inputs: it places the search at the foot of the gradient instead of at the bottom of a cliff the random search will essentially never scale.

---

## Core Concept 2 — In-Process vs Out-of-Process Execution

Two architectures dominate, and the choice shapes speed, robustness, and how you write the harness.

**In-process (libFuzzer).** The harness is compiled *into* the fuzzer binary, and libFuzzer calls it in a tight loop **inside one process** — hundreds of thousands to millions of times. There is no `fork()`, no `exec()`, no process teardown per input. That's why libFuzzer routinely hits **100k–1M+ exec/s** on a small target.

The cost of in-process speed is fragility to state: because the same process is reused, any global state your harness leaves behind (a static cache, an un-freed buffer, a registered signal handler) leaks into the next run and can make results non-reproducible. And the *first* crash takes down the whole process — libFuzzer recovers by relaunching and replaying, but the model assumes most runs return cleanly.

**Out-of-process / fork server (AFL, AFL++).** The fuzzer initializes the target once, then `fork()`s a fresh child for each input. Each run starts from the same clean, post-initialization state, so leaked global state and a crash in one input don't poison the next — far more robust for messy, stateful, or crash-prone targets. The cost is the per-`fork()` overhead, which caps throughput lower than in-process.

**Persistent mode** bridges the two: AFL++'s `AFL_LOOP(N)` (and its libFuzzer-compatible harness support) runs the target *in a loop within a forked child* for `N` iterations before refreshing, recovering much of the in-process speed while keeping periodic clean-slate resets.

> **Key insight:** In-process buys raw `exec/s`; the fork server buys robustness to state and crashes. AFL++ deliberately supports the libFuzzer `LLVMFuzzerTestOneInput` entry point so you can write **one** harness and run it under either engine — which is exactly what OSS-Fuzz expects.

---

## Core Concept 3 — The Harness (Fuzz Target)

The fuzzer generates bytes; the **harness** decides what those bytes *mean* and which API they exercise. It is the single most important piece of code you write, and a good one follows a few hard rules.

The libFuzzer entry point is a single function:

```cpp
// fuzz_parse.cc  — build: clang++ -g -O1 -fsanitize=fuzzer,address,undefined fuzz_parse.cc parser.cc -o fuzz_parse
#include <cstdint>
#include <cstddef>
#include "parser.h"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    parse_config(data, size);   // the API under test; must tolerate ANY bytes
    return 0;                   // non-zero is reserved; always return 0
}
```

That's a complete fuzz target. libFuzzer calls it for every input. The rules that separate a useful harness from a useless one:

- **Tolerate any input.** The harness must never crash *on its own* on malformed bytes — that's the library's job to handle gracefully, and a harness bug looks identical to a real finding.
- **Deterministic.** Same input → same path, every time. No clocks, no RNG (or seed it fixed), no reading the network. Non-determinism makes coverage feedback lie and crashes irreproducible.
- **Fast and side-effect-free.** No disk writes, no `sleep`, no global state that survives the call. At a million exec/s, a 1 ms syscall is a 1000× slowdown.
- **One harness per API surface.** A harness that fuzzes the JSON parser and a harness that fuzzes the image decoder are two files. Mixing them blurs the coverage signal and the crash attribution.

Raw `(data, size)` is awkward when the API wants *typed* arguments. **`FuzzedDataProvider`** carves typed values out of the byte buffer deterministically, so the fuzzer's mutations map onto your parameters:

```cpp
#include <fuzzer/FuzzedDataProvider.h>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    FuzzedDataProvider fdp(data, size);
    int    level   = fdp.ConsumeIntegralInRange<int>(0, 9);   // bound the knob
    bool   strict  = fdp.ConsumeBool();
    std::string body = fdp.ConsumeRemainingBytesAsString();   // rest is the payload

    Decoder d(level, strict);
    d.decode(body);
    return 0;
}
```

In Go the native fuzzing harness is a test function, and the corpus types are declared up front via `f.Fuzz`:

```go
// parse_test.go  — run: go test -fuzz=FuzzParseConfig -fuzztime=60s
func FuzzParseConfig(f *testing.F) {
    f.Add([]byte("timeout=30\nretries=3\n"))   // seed input
    f.Fuzz(func(t *testing.T, data []byte) {
        _ = ParseConfig(data)                    // must not panic on bad input
    })
}
```

> **Key insight:** The harness is a contract: *"here is one API, here is how raw bytes become its arguments, and I promise to behave for any bytes."* Most of the value (and most of the bugs in fuzzing setups) live in this function. A slow or non-deterministic harness silently kneecaps the entire campaign no matter how good the fuzzer is.

---

## Core Concept 4 — Corpus Management & Dictionaries

The corpus is the fuzzer's memory. Curating it is the highest-leverage tuning you can do.

**Seed corpus quality.** Hand the fuzzer a handful of small, *valid*, diverse examples — one minimal PNG, one with transparency, one interlaced — and it starts the search at the foot of the gradient. Hand it nothing and it must rediscover your file format byte by byte. Seeds should be **minimal**: a 50-byte seed mutates faster and more meaningfully than a 5 MB one.

**Corpus minimization.** Campaigns accumulate thousands of redundant inputs. Two tools prune them:

- **`-merge=1`** (libFuzzer): re-runs every input and keeps only the minimal subset that preserves *total coverage*. `./fuzzer -merge=1 corpus_min/ corpus/` distills a bloated `corpus/` into a tight `corpus_min/`.
- **`afl-cmin`** (corpus minimization) and **`afl-tmin`** (test-case minimization — shrink one crashing input to the smallest bytes that still crash) do the same for AFL++.

A minimized corpus runs faster (fewer redundant execs per cycle), starts faster, and is cheaper to store and share.

**Dictionaries.** Mutation alone almost never invents the exact string `<?xml` or a 4-byte magic number. A **dictionary** feeds those tokens to the mutator so it can insert them verbatim:

```
# http.dict
"GET"
"POST"
"Content-Length:"
header_magic="\xCA\xFE\xBA\xBE"
```

Run with `./fuzzer -dict=http.dict corpus/`. For any format with keywords, magic bytes, or a fixed vocabulary, a dictionary is often the single biggest coverage win after seeds.

**Growing and sharing.** Corpora are durable assets. Store the minimized corpus in a bucket or repo; new CI runs start from it instead of from scratch, and multiple `-jobs` workers (or a fleet) share one corpus directory so coverage discovered by one worker bootstraps the others.

> **Key insight:** Seeds + a dictionary + periodic minimization usually beat raw fuzzing horsepower. A coverage plateau is most often a *corpus* problem — the search can't reach the next region from where it is — not a "needs more CPU" problem.

---

## Core Concept 5 — Structure-Aware Fuzzing

Byte-level mutation hits a wall the moment the input has a **checksum, length prefix, or strict grammar**. Flip a byte in a TCP packet with a CRC and the parser rejects it at the checksum *before* reaching any logic — so ~99% of inputs die in the first few branches and coverage flatlines. The mutator is fighting the format.

**Structure-aware fuzzing** mutates the input at the level of its *structure* rather than its bytes, so every generated input is already well-formed enough to get past the front gate:

- **`libprotobuf-mutator` (LPM).** If your input is (or can be modeled as) a protobuf message, LPM mutates the *typed message tree* — adding fields, changing values, growing repeated fields — then serializes a valid wire-format payload. The fuzzer mutates a proto, not bytes:

```cpp
#include "src/libfuzzer/libfuzzer_macro.h"
#include "config.pb.h"                       // your protobuf schema

DEFINE_PROTO_FUZZER(const my::Config& cfg) { // receives a typed, well-formed message
    apply_config(cfg);                       // logic, not parsing, gets exercised
}
```

- **Grammar-based fuzzers** (e.g. tools driven by a context-free grammar) generate inputs from a formal grammar of the language — invaluable for fuzzing SQL engines, JS interpreters, or anything with rich syntax.
- **Custom mutators.** AFL++ and libFuzzer both let you supply a mutator that understands your format — recompute the checksum *after* mutating, fix up length fields, then hand back a valid input.

> **Key insight:** When inputs are structured, byte mutation wastes the campaign failing the parser before it reaches the logic you care about. Teach the fuzzer the structure — proto, grammar, or a custom mutator — and you move the search *past* the front gate to where the real bugs live.

---

## Core Concept 6 — The Sanitizer as Oracle

A fuzzer that only catches segfaults is half-blind. Most memory-safety bugs corrupt silently and don't crash on the spot. The **oracle** is what turns "ran without an obvious crash" into "definitely did something illegal," and the default oracle is a **sanitizer compiled into the same binary**:

```bash
clang++ -g -O1 -fsanitize=fuzzer,address,undefined fuzz_parse.cc parser.cc -o fuzz_parse
```

- **ASan** flags heap/stack/global overflow, use-after-free, double-free — a 1-byte out-of-bounds *read* that would otherwise be invisible now aborts with a stack trace. See [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md).
- **UBSan** flags signed overflow, null deref, bad shifts, misaligned access — undefined behaviour the optimizer might "work" today and miscompile tomorrow. See [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/middle.md).
- **MSan** flags reads of uninitialized memory (note: MSan needs an MSan-instrumented dependency stack, so it's usually run in its own build, *not* combined with ASan).

Beyond sanitizers, two more oracle kinds matter:

- **Assertion-based oracles.** A failed `assert` (or a Go `t.Fatal`) is a crash the fuzzer records. Internal invariants — "this index is in bounds," "this tree is balanced" — become *fuzzable specifications*. This is the bridge to [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/middle.md): contracts are oracles a fuzzer can hammer.
- **Differential oracles.** Run the input through *two* implementations (your parser vs a reference, or your optimized path vs the obvious one) and assert the outputs match. Any divergence is a finding — this catches *logic* bugs no sanitizer can see, because there's nothing illegal happening, just *wrong*.

> **Key insight:** The fuzzer finds the path; the oracle decides if the path was illegal. Compiling `-fsanitize=fuzzer,address,undefined` gives you a generator and a memory-safety/UB oracle in one binary — and assertions and differential checks extend the oracle to logic bugs the sanitizers can't perceive.

---

## Core Concept 7 — Running It & Reading the Log

Invoking the fuzzer and reading its output is a skill; the log tells you whether the campaign is healthy or stuck.

```bash
# libFuzzer: 4 parallel jobs, 1 hour, persist the corpus
./fuzz_parse -jobs=4 -workers=4 -max_total_time=3600 corpus/

# Replay a single crash to reproduce (deterministic):
./fuzz_parse crash-2f8a...                  # re-runs that one input, prints the report

# Go native fuzzing:
go test -fuzz=FuzzParseConfig -fuzztime=5m
```

A healthy libFuzzer log looks like this:

```
#2      INITED cov: 41 ft: 41 corp: 1/24b exec/s: 0 rss: 28Mb
#512    NEW    cov: 88 ft: 120 corp: 9/310b lim: 16 exec/s: 256000 rss: 31Mb L: 41
#16384  pulse  cov: 213 ft: 410 corp: 47/2114b exec/s: 410000 rss: 39Mb
#262144 NEW    cov: 219 ft: 433 corp: 51/2380b exec/s: 398000 rss: 41Mb L: 73
==4127==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x6020...
SUMMARY: AddressSanitizer: heap-buffer-overflow parser.cc:88:14 in parse_config
artifact_prefix='./'; Test unit written to ./crash-2f8a3b...
```

Decode it field by field:

| Field | Meaning |
|---|---|
| `#262144` | Total executions so far. |
| `NEW` | This input reached new coverage and was added to the corpus. `pulse` = periodic status, no new coverage. `RELOAD` = picked up new corpus files from another worker. |
| `cov: 219` | Number of CFG edges covered — your headline progress metric. When this **stops climbing**, the search has plateaued. |
| `ft: 433` | "Features" — coverage *plus* hit-count buckets and value-profile signals; finer-grained than `cov`. |
| `corp: 51/2380b` | Corpus holds 51 inputs totaling 2380 bytes. |
| `exec/s: 398000` | Throughput. A sudden drop usually means the harness got slow (often: a path that allocates a lot or loops). |
| `rss: 41Mb` | Resident memory; watch for steady growth → a leak in the harness or target. |
| `L: 73` | Length of the newest interesting input. |
| `crash-<hash>` | The reproducer file is written to disk, named by content hash. Also: `oom-<hash>` (out-of-memory) and `timeout-<hash>` (exceeded `-timeout=`). |

> **Key insight:** Three numbers tell you the health of a run: `cov` climbing (the search is making progress), `exec/s` high and stable (the harness isn't choking), and `rss` flat (nothing's leaking). When `cov` plateaus while `exec/s` stays high, you don't need more CPU — you need better seeds, a dictionary, or structure-aware mutation.

---

## Core Concept 8 — CI Integration & Continuous Fuzzing

Fuzzing only pays off when it runs continuously and *prevents regressions*, not when it's a one-off heroics session. There are three distinct cadences, and you want all three.

**1. Per-PR smoke run (seconds to a few minutes).** On every pull request, run each fuzz target over the *existing corpus* as a regression test (replay all known-interesting inputs — this is just `go test` for Go's native fuzzing, which runs the seed corpus on every `go test` even without `-fuzz`), then fuzz for a short, bounded time:

```bash
./fuzz_parse -runs=0 corpus/                 # replay corpus only — fast regression gate
./fuzz_parse -max_total_time=120 corpus/     # + 2 minutes of fresh fuzzing
```

This catches the obvious "someone reintroduced a known crash" and shallow new bugs without blocking the PR for long.

**2. Scheduled deep runs (hours, nightly/weekly).** A cron job fuzzes each target for hours on more cores, starting from the persisted corpus and writing the grown corpus back. This is where the deep bugs surface, off the PR critical path.

**3. Continuous fuzzing (OSS-Fuzz / ClusterFuzz).** For projects that qualify, **OSS-Fuzz** runs your harnesses continuously on Google's fleet via **ClusterFuzz**, which runs a full lifecycle for every finding:

```
find  → a fuzzer hits a crash
dedupe → group by crash signature (stack hash) so 10,000 crashes ≠ 10,000 bugs
bisect → binary-search the commit range to pin the regressing change
file   → open a tracked bug (with reproducer + the offending commit)
verify → re-run after the fix lands; auto-close when the reproducer no longer crashes
```

That lifecycle — dedupe and bisect especially — is what makes continuous fuzzing *operable*: without it, a single bug producing a flood of crashes would bury the signal.

> **Key insight:** The corpus is the unit of continuity. A per-PR run replays it as a regression gate; scheduled runs grow it; continuous fuzzing finds-dedupes-bisects-files-verifies against it. Persisting and sharing that corpus is what turns isolated fuzzing sessions into a ratchet that only ever tightens.

---

## Real-World Examples

**Heartbleed, in hindsight (OpenSSL).** The `heartbleed` buffer over-read (CVE-2014-0160) sat in OpenSSL for two years. A coverage-guided fuzzer with ASan, given a TLS-heartbeat harness, reaches the vulnerable read in *minutes* — ASan flags the over-read the instant a crafted length field drives the copy past the buffer. The aftermath of Heartbleed is a large part of *why* OSS-Fuzz exists, and OpenSSL is now continuously fuzzed there.

**Go standard library.** Go added native fuzzing in 1.18 precisely so that parsing-heavy packages (`encoding/json`, `image`, `net/http`, `archive/zip`) could be fuzzed with a one-line test. Each ships seed corpora under `testdata/fuzz/`, and `go test` replays those seeds on every run — so a regression that re-breaks a previously-found input fails CI *without* anyone running `-fuzz`. A typical finding:

```
--- FAIL: FuzzParseConfig (0.03s)
    --- FAIL: FuzzParseConfig (0.00s)
        parse_test.go:14: panic: runtime error: index out of range [4] with length 4
    Failing input written to testdata/fuzz/FuzzParseConfig/a1b2c3...
    To re-run: go test -run=FuzzParseConfig/a1b2c3...
```

Note that Go writes the failing input *into the repo* as a seed — the crash becomes a permanent regression test the moment it's found.

**A structure-aware win.** Fuzzing a protobuf-configured service with raw bytes wastes nearly every input failing wire-format parsing. Switching to `libprotobuf-mutator` (`DEFINE_PROTO_FUZZER`) means every input is a valid message, so coverage of the *config-application logic* — the part with the bugs — jumps immediately. The fix wasn't more CPU; it was mutating at the right level.

---

## Mental Models

- **Coverage is a gradient; the corpus is your foothold on it.** The fuzzer climbs toward new code one mutation at a time. A good seed corpus and dictionary place you partway up the slope; nothing places you at the summit. A plateau means you're stuck on a ledge — change *where you're standing* (seeds, dictionary, structure-awareness), not how hard you push.

- **The harness is the lens; the fuzzer is the light.** The light is generic and powerful, but it only illuminates what the lens points at. A blurry lens (slow, non-deterministic, multi-API harness) wastes the brightest light. Most of the engineering — and most of the mistakes — are in the lens.

- **The fuzzer finds the door; the oracle tells you it was locked.** Reaching new code is worthless without something that recognizes a violation. A sanitizer is a memory-safety/UB oracle; an assertion is an invariant oracle; a differential check is a correctness oracle. No oracle, no bug — just a tour of your codebase.

- **`exec/s` is the denominator of luck.** Fuzzing is a search measured in inputs tried. Halve `exec/s` and you halve how much of the space you cover per hour. A slow harness doesn't just feel sluggish — it directly shrinks how many bugs you'll find.

---

## Common Mistakes

1. **No seed corpus.** Starting from empty forces the fuzzer to rediscover your file format byte by byte — most campaigns never escape the first few branches. Always seed with small, valid, diverse examples.

2. **A non-deterministic harness.** Reading the clock, the network, or unseeded RNG makes coverage feedback lie and crashes irreproducible. The fuzzer's entire model assumes input fully determines path. Strip the non-determinism.

3. **A slow or side-effectful harness.** Disk writes, `sleep`, or per-call allocation drop `exec/s` by orders of magnitude. At a million exec/s a single 1 ms syscall is a 1000× tax. Keep the harness pure and fast.

4. **Fuzzing without a sanitizer.** Catching only hard crashes misses the silent memory corruption that is *the* reason to fuzz native code. Always compile `-fsanitize=fuzzer,address` (add `,undefined`) so the oracle can see the bugs.

5. **Byte-fuzzing a checksummed or grammared format.** ~99% of inputs die at the front gate (CRC/parser) and coverage flatlines. Use `libprotobuf-mutator`, a grammar, or a custom mutator so inputs are well-formed enough to reach the logic.

6. **Treating fuzzing as a one-off.** A weekend campaign that finds three bugs and then never runs again lets regressions creep back. Persist the corpus and wire a per-PR replay plus scheduled runs so it becomes a ratchet.

7. **A harness that crashes on its own.** If the harness itself can't tolerate arbitrary bytes (e.g. it indexes `data[4]` without checking `size`), every "finding" is a harness bug masquerading as a real one. Make the harness bulletproof; let the *target* be the thing under test.

---

## Test Yourself

1. Why is a coverage-guided fuzzer dramatically more effective than a purely random one? What signal does it use?
2. What decides whether the fuzzer keeps a given input in the corpus?
3. Name one advantage of libFuzzer's in-process model and one advantage of AFL++'s fork-server model.
4. Your harness reads the system clock to pick a code path. Name two distinct ways this breaks fuzzing.
5. You're fuzzing a parser for a format with a 4-byte CRC at the end. Coverage plateaus almost immediately. What's happening, and what do you change?
6. The fuzzer runs for an hour, `exec/s` stays at 400k, but `cov` hasn't moved in 40 minutes. Do you add more CPU? If not, what do you do?
7. What is the oracle's job, and why is fuzzing without a sanitizer half-blind for C/C++?

<details>
<summary>Answers</summary>

1. It measures which CFG **edges** each input covers and keeps inputs that reach *new* edges, then mutates those — using **coverage as the fitness function** of a guided (genetic) search. Random fuzzing has no feedback, so it can't climb toward inputs that pass a magic header or checksum and reach deep code.
2. The input is kept (becomes part of the **corpus**) if it triggers a **new edge** — or pushes an edge into a new **hit-count bucket** (e.g. a loop running 9 times vs 2). Otherwise it's discarded.
3. **In-process (libFuzzer):** no per-input `fork`/`exec`, so far higher `exec/s` (100k–1M+). **Fork server (AFL++):** each input runs from a clean post-init state, so it's robust to leaked global state and to crashes that would poison a shared process.
4. (a) **Non-determinism breaks coverage feedback** — the same input takes different paths, so the fuzzer can't tell whether an input is "interesting." (b) **Crashes become irreproducible** — a recorded `crash-<hash>` won't reliably re-crash on replay, making it impossible to debug or use as a regression test.
5. Byte mutations almost always invalidate the **CRC**, so nearly every input is rejected at the checksum before reaching real logic — the search is fighting the format. Switch to **structure-aware fuzzing**: a custom mutator that recomputes the CRC after mutating (or `libprotobuf-mutator`/grammar if the format fits), so inputs pass the front gate.
6. **No** — `exec/s` is high, so the bottleneck isn't CPU; the search has **plateaued** because it can't reach the next region from its current corpus. Improve the **seed corpus**, add a **dictionary** of the format's tokens, or adopt **structure-aware** mutation.
7. The oracle **decides whether an input found a bug**. Without a sanitizer, the only oracle is "did it crash?" — but most memory-safety bugs (a 1-byte over-read, a use-after-free that reads plausible garbage) **don't crash on the spot**; ASan/UBSan turn that silent corruption into an immediate, located failure.

</details>

---

## Cheat Sheet

```
THE LOOP
  instrument edges → run input → new edge/bucket? → keep in corpus → mutate → repeat
  coverage = the fitness function

BUILD (libFuzzer + oracle)
  clang++ -g -O1 -fsanitize=fuzzer,address,undefined harness.cc target.cc -o fuzz
  # MSan runs in its own build (needs instrumented deps), not with ASan

RUN
  ./fuzz -jobs=4 -workers=4 -max_total_time=3600 corpus/   parallel, time-boxed
  ./fuzz crash-<hash>                                       reproduce one input
  ./fuzz -merge=1 corpus_min/ corpus/                       minimize the corpus
  ./fuzz -dict=fmt.dict corpus/                             use a dictionary
  go test -fuzz=FuzzX -fuzztime=5m                          Go native fuzzing

HARNESS RULES
  tolerate any bytes · deterministic · fast · side-effect-free · one API per target
  FuzzedDataProvider  → carve typed args out of (data,size)

READ THE LOG
  cov:    edges covered   → headline progress; flat = plateau
  ft:     features        → cov + hit-count buckets + value profile (finer)
  exec/s: throughput      → sudden drop = harness got slow
  rss:    memory          → steady growth = leak
  NEW = new coverage · pulse = status · crash-/oom-/timeout-<hash> = reproducers

WHEN COVERAGE PLATEAUS (and exec/s is fine)
  better seeds → add a dictionary → structure-aware (libprotobuf-mutator / grammar / custom mutator)

CI CADENCES
  per-PR:      replay corpus (regression) + a few min fuzzing
  scheduled:   hours nightly, grow + persist corpus
  continuous:  OSS-Fuzz/ClusterFuzz → find → dedupe → bisect → file → verify-fixed
```

---

## Summary

- Coverage-guided fuzzing is a **genetic search where new code reached is the fitness function**: instrument CFG edges, keep inputs that hit a new edge or hit-count bucket, mutate those, repeat. This is what separates a directed search from "spray and pray."
- **In-process** (libFuzzer) buys raw `exec/s`; the **fork server** (AFL/AFL++) buys robustness to state and crashes; **persistent mode** bridges them, and AFL++ runs the same `LLVMFuzzerTestOneInput` harness under either engine.
- The **harness** is the highest-value code you write: it maps raw bytes to one API (use `FuzzedDataProvider` for typed args) and must tolerate any input, be deterministic, fast, and side-effect-free. A bad harness kneecaps the whole campaign.
- The **corpus** is the fuzzer's memory: seed it with small valid examples, minimize it (`-merge=1`, `afl-cmin`/`afl-tmin`), feed it a **dictionary** of format tokens, and persist/share it. A plateau is usually a corpus problem, not a CPU problem.
- For checksummed or grammared inputs, **structure-aware fuzzing** (`libprotobuf-mutator`, grammars, custom mutators) moves the search past the front gate to where the bugs are.
- The **sanitizer is the oracle**: `-fsanitize=fuzzer,address,undefined` turns silent corruption and UB into recorded crashes; **assertions** and **differential** checks extend the oracle to logic bugs.
- Read the log by `cov` (progress), `exec/s` (throughput), and `rss` (leaks). Wire it into CI at three cadences — **per-PR** replay, **scheduled** deep runs, and **continuous** fuzzing (OSS-Fuzz/ClusterFuzz: find → dedupe → bisect → file → verify-fixed) — with the corpus as the thread of continuity. This is the bridge from [Testing](../../testing/) (input generation) to [Code Coverage](../../code-coverage/) (what got reached).

---

## Further Reading

- **libFuzzer documentation** (llvm.org/docs/LibFuzzer.html) — the entry point, flags (`-merge`, `-dict`, `-jobs`, `-max_total_time`), and the log format, from the source.
- **AFL++ documentation** (github.com/AFLplusplus/AFLplusplus) — fork server, persistent mode (`AFL_LOOP`), `afl-cmin`/`afl-tmin`, custom mutators, and the LLVM instrumentation modes.
- **Go fuzzing documentation** (go.dev/doc/security/fuzz, go.dev/doc/tutorial/fuzz) — native `f.Fuzz`, seed corpora, the `testdata/fuzz` regression model.
- **libprotobuf-mutator** (github.com/google/libprotobuf-mutator) — structure-aware fuzzing with `DEFINE_PROTO_FUZZER`.
- **OSS-Fuzz** (google.github.io/oss-fuzz/) — continuous fuzzing, ClusterFuzz's find→dedupe→bisect→file→verify lifecycle, and how to onboard a project.
- [senior.md](senior.md) — value-profile and CMP instrumentation, fuzzing stateful/binary-only targets, corpus-distillation strategy, sanitizer interaction details, and designing a fuzzing program across a large codebase.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md) — the memory-safety oracle you compile into the fuzz target.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/middle.md) — the UB oracle; add `,undefined` to catch overflow, bad shifts, null deref.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/middle.md) — assertions and contracts as fuzzable invariant oracles.
- [Testing](../../testing/) — fuzz testing as a discipline; where the inputs come from.
- [Code Coverage](../../code-coverage/) — what "coverage" means and measures, the metric the loop optimizes.
