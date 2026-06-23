# Coverage-Guided Dynamic Analysis — Junior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Coverage-Guided Dynamic Analysis
> *A sanitizer is a smoke detector that only goes off when there's smoke in the room it's standing in. Fuzzing is the robot that walks into every room in the building, lighting tiny fires, until it finds the one that's already smouldering.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Problem: Sanitizers Only See Code That Runs](#core-concept-1--the-problem-sanitizers-only-see-code-that-runs)
5. [Core Concept 2 — Fuzzing: Generate Inputs by the Million](#core-concept-2--fuzzing-generate-inputs-by-the-million)
6. [Core Concept 3 — Coverage-Guided: A Fuzzer That Learns](#core-concept-3--coverage-guided-a-fuzzer-that-learns)
7. [Core Concept 4 — The Killer Combo: Fuzzer Drives, Sanitizer Judges](#core-concept-4--the-killer-combo-fuzzer-drives-sanitizer-judges)
8. [Core Concept 5 — Writing Your First Fuzz Target](#core-concept-5--writing-your-first-fuzz-target)
9. [Core Concept 6 — The Tool Landscape](#core-concept-6--the-tool-landscape)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do you actually find the bugs a sanitizer can catch?**

A sanitizer like AddressSanitizer (ASan) is a brilliant bug detector. Compile your program with `-fsanitize=address` and it will catch buffer overflows, use-after-free, and memory leaks *the instant they happen*. There is just one catch, and it's the whole game: **a sanitizer can only catch a bug on code that actually executes.** If the buggy line never runs during your test, the sanitizer sits there silently, smelling nothing.

So the real problem isn't "do I have a detector?" — it's "do I have an **input** that drives my program down the dark, rarely-travelled path where the bug lives?" Your hand-written tests cover the happy path and a few obvious edge cases. They will never cover the input that is 4,097 bytes of `0xFF` followed by a single newline, which is precisely the input that overflows a fixed `char buf[4096]`. Nobody writes that test by hand. Nobody *can*.

**Fuzzing** is the answer. A fuzzer is a program that automatically generates a flood of inputs — thousands per second — and feeds each one to your code, watching for a crash. **Coverage-guided** fuzzing is the smart version: it watches which lines and branches each input reaches, keeps the inputs that reach *new* code, and mutates them to go deeper. It is a search that *learns the shape of your program* and burrows toward the corners you never tested.

This page teaches you the whole loop: what a fuzzer is, what "coverage-guided" adds, why a fuzzer *needs* a sanitizer to be useful, and how to write a fuzz target in C/C++ and Go in about ten lines.

> **Mindset shift:** stop thinking "I write tests; each test is one input I chose." Start thinking "I write a *target* — a function that accepts arbitrary bytes — and let a machine choose millions of inputs for me, keeping the ones that surprise it." You stop authoring examples and start authoring the *thing being tested*. The fuzzer becomes a tireless, adversarial QA engineer that never sleeps and has no respect for your assumptions.

---

## Prerequisites

- **Required:** You can write a function and a basic unit test in at least one language (examples use **C/C++** and **Go**).
- **Required:** You've run a command in a terminal and read a stack trace or error message.
- **Helpful:** You've seen a sanitizer report once — even a confusing one. The companion topic [01 — AddressSanitizer](../01-address-sanitizer-asan/junior.md) covers what those reports mean.
- **Helpful:** You have a rough idea of "code coverage" — the percentage of lines a test suite executes. You don't need to have measured it; we'll define it.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Fuzzing** | Automatically generating many inputs and feeding them to a program to find crashes. |
| **Fuzzer** | The tool that does the generating, running, and crash-watching (libFuzzer, AFL++, Go's `go test -fuzz`). |
| **Fuzz target / harness** | The small function *you* write that takes raw bytes and feeds them to the code under test. |
| **Input / test case** | One blob of bytes the fuzzer hands to your target. |
| **Seed** | A starting example input *you* provide — a real, valid input to give the fuzzer a head start. |
| **Corpus** | The growing collection of "interesting" inputs the fuzzer has saved (seeds + everything it discovered). |
| **Mutation** | A small random change the fuzzer makes to an existing input (flip a bit, insert a byte, splice two inputs). |
| **Code coverage** | Which lines/branches of the program actually ran for a given input. |
| **Coverage-guided** | A fuzzer that uses coverage to decide which inputs are worth keeping and mutating. |
| **Oracle / bug detector** | The thing that *decides* an input found a bug. A crash, an assertion, or a **sanitizer** report. |
| **Reproducer** | The exact input file the fuzzer saves when it finds a crash, so you can replay it. |
| **Property-based testing** | A gentler cousin: you assert a property; the framework generates inputs to try to break it. |

---

## Core Concept 1 — The Problem: Sanitizers Only See Code That Runs

A sanitizer is a **runtime** tool. It instruments your program so that, *as it executes*, every memory access (ASan) or every arithmetic operation (UBSan) is checked. When a check fails, it prints a precise report and aborts. This is enormously powerful — but it is utterly dependent on the buggy code being *reached*.

Here is a function with a real bug:

```c
#include <string.h>
#include <stdint.h>

// Parses a length-prefixed record. BUG: trusts the length byte blindly.
void parse_record(const uint8_t *data, size_t size) {
    if (size < 1) return;
    uint8_t claimed_len = data[0];   // attacker controls this
    char buf[16];
    memcpy(buf, data + 1, claimed_len);   // overflow if claimed_len > 16
    (void)buf;
}
```

Compile it with ASan and run your normal test:

```c
parse_record((const uint8_t *)"\x05hello", 6);   // claimed_len = 5, fits in buf[16]
```

ASan says **nothing**. The input is well-behaved: it copies 5 bytes into a 16-byte buffer. The bug is real, but your test never *triggers* it. The overflow only happens when `data[0]` is greater than 16 — an input no sane human would type, because no sane *protocol* would send it. But an attacker would. And a fuzzer will find it in milliseconds.

> **Key insight:** A sanitizer is a **detector without a search**. It tells you the truth about whatever code you run — but it can't pick what to run. Pair it with nothing and it only ever inspects your happy path. The entire value of coverage-guided fuzzing is that it supplies the *search* the sanitizer is missing: it manufactures the inputs that reach the dangerous lines.

The lesson generalizes: ASan, UBSan, TSan, MSan — every dynamic tool — is only as good as the inputs you feed it. "I ran the test suite under ASan and it was clean" means "the *paths my tests happened to cover* are clean," which is a far weaker statement than people assume.

---

## Core Concept 2 — Fuzzing: Generate Inputs by the Million

The crudest fuzzer is almost insultingly simple. Generate random bytes, feed them to the program, see if it crashes:

```python
import subprocess, os
while True:
    data = os.urandom(64)              # 64 random bytes
    subprocess.run(["./parser"], input=data)   # did it crash?
```

This is **dumb fuzzing** (also called black-box fuzzing). It sometimes works — it famously found crashes in Unix utilities in the original 1990 fuzzing study by Barton Miller. But it's wildly inefficient. To trigger our `parse_record` bug, random bytes would need `data[0] > 16` *and* enough following bytes to actually run past `buf` — and to get *deeper* than that into a real parser, dumb fuzzing has essentially no chance. A parser that expects `{"key":` will reject 99.999% of random byte streams at the first character, so the fuzzer spends its entire life bouncing off the front door.

What dumb fuzzing lacks is **feedback**. It has no idea whether the input it just tried got further into the program than the last one. Every input is a fresh roll of the dice, with no memory.

> **Key insight:** Throwing random bytes at a program is real fuzzing, and it's better than nothing — but it's blind. It can't tell "this input got 1% deeper" from "this input bounced off the first `if`." Without that signal, it can never *build* on progress. The breakthrough that made fuzzing the dominant bug-finding technique is adding exactly that signal: **coverage**.

The vocabulary to lock in now:

- **Fuzz target / harness** — the function you write that accepts bytes and exercises the code under test.
- **Input / test case** — one blob of bytes tried against the target.
- **Crash** — the target died (segfault, abort, or a sanitizer report). This is a *finding*.

A fuzzer just runs the target on input after input, as fast as the CPU allows — often tens of thousands of executions per second for a small target — watching for crashes.

---

## Core Concept 3 — Coverage-Guided: A Fuzzer That Learns

Here is the idea that changed everything. The compiler **instruments** your code at every branch — it inserts a tiny counter at each `if`, each loop, each `case`. Now, when the fuzzer runs an input, it can ask: *"Which branches did this input hit? Did it reach any branch no previous input reached?"*

That single question turns blind generation into a **guided search**:

```
1. Pick an input from the corpus (start with the seeds).
2. Mutate it slightly (flip a bit, insert a byte, splice with another input).
3. Run the target. Record which branches were hit (the coverage).
4. Did it hit NEW coverage?
      YES → this input is "interesting." SAVE it to the corpus.
      NO  → throw it away.
5. Did it crash? → save the input as a REPRODUCER. (the bug!)
6. Go to 1.
```

The **corpus** is the fuzzer's memory: the set of inputs it has decided are worth keeping because each one unlocked new code. The corpus *evolves*. An input that gets one byte past the `{"key":` check survives; its mutated children push one level deeper into the value parser; their children reach the array handler; and so on. The fuzzer is effectively doing a search through the space of program states, using coverage as its compass. People describe it as the fuzzer "learning the input format" — it doesn't understand JSON, but by keeping whatever reaches new code, it *rediscovers* the structure JSON requires.

This is why it's called **coverage-guided fuzzing** (sometimes "feedback-driven" or "grey-box" fuzzing — grey because it peeks at coverage without truly understanding the source).

Here's what real libFuzzer output looks like as it learns. Each line is a *new* corpus entry — a moment it found code it had never reached:

```text
INFO: Seed: 2891729037
INFO: Loaded 1 modules   (412 inline 8-bit counters)
INFO:        4 files found in corpus/
#5      INITED cov: 28 ft: 29 corp: 4/52b exec/s: 0 rss: 28Mb
#128    NEW    cov: 31 ft: 34 corp: 5/61b lim: 8 exec/s: 0 rss: 28Mb L: 9/16 MS: 3 ChangeBit-InsertByte-
#291    NEW    cov: 35 ft: 41 corp: 6/79b lim: 8 exec/s: 0 rss: 28Mb L: 18/18 MS: 2 InsertByte-CopyPart-
#1024   NEW    cov: 38 ft: 47 corp: 7/96b lim: 11 exec/s: 0 rss: 28Mb L: 17/18 MS: 4 ...
#65536  pulse  cov: 38 ft: 47 corp: 7/96b exec/s: 218453 rss: 41Mb
```

Read it like a dashboard:

- **`cov: 38`** — number of code blocks covered so far. When this number rises, the fuzzer is making progress. When it plateaus, it's stuck.
- **`corp: 7/96b`** — the corpus holds 7 inputs totalling 96 bytes.
- **`NEW`** — this input reached new coverage, so it was kept.
- **`exec/s: 218453`** — 218,000 executions per second. That's the throughput your bug-finding rate depends on.
- **`MS: 3 ChangeBit-InsertByte-`** — the *mutations* applied to produce this input (it flipped a bit, then inserted a byte). This is the fuzzer showing its work.

> **Key insight:** Coverage is the fuzzer's reward signal. "Did I reach new code?" is the only question it needs to turn a random walk into a directed climb. This is the entire difference between a tool that gives up at the front door and one that, given a few hours, ends up deep inside your parser's error-recovery logic — the place no human test ever visits.

---

## Core Concept 4 — The Killer Combo: Fuzzer Drives, Sanitizer Judges

Now the two halves snap together, and this is the most important paragraph on the page.

A fuzzer is great at *generating inputs that reach weird code*. But once an input reaches the buggy `memcpy` from Concept 1, **how does the fuzzer know a bug happened?** A buffer overflow does not necessarily crash. It often just scribbles over adjacent memory and *keeps running*, returning garbage. The program doesn't segfault; it carries on, subtly corrupted. The fuzzer sees "no crash" and moves on, never realizing it just walked over a landmine.

This is where the **sanitizer** earns its keep. It is the **oracle** — the judge that decides "this input is a bug." Compile the target with both the fuzzer *and* a sanitizer, and the overflow that would have been silent now becomes a loud, immediate, precise crash that the fuzzer cannot miss:

| Without ASan | With ASan |
|---|---|
| Out-of-bounds read returns adjacent garbage | **Immediate crash** with exact address & offset |
| Use-after-free silently reads stale data | **Immediate crash** + alloc/free stack traces |
| Overflow corrupts memory, crashes later (or never) | **Crash at the exact line** that overflowed |
| Fuzzer records: nothing | Fuzzer records: the **reproducer input** |

> **Key insight:** The fuzzer is the **input generator**; the sanitizer is the **bug detector (oracle)**. Neither is enough alone. A fuzzer without a sanitizer finds only inputs that *visibly* crash — a small fraction of real bugs. A sanitizer without a fuzzer only ever inspects the inputs you happened to write. Bolt them together and you get the most effective bug-finding setup in all of systems software: a tireless input generator wired to a microscope-grade detector.

When the combo fires, libFuzzer stops everything and hands you the bug *and* the input that caused it:

```text
==15823==ERROR: AddressSanitizer: stack-buffer-overflow on address 0x7ffe...
WRITE of size 200 at 0x7ffe9c3f0a40 thread T0
    #0 0x4f8a2b in __asan_memcpy
    #1 0x4f9c10 in parse_record record.c:9:5
    #2 0x4f9e44 in LLVMFuzzerTestOneInput fuzz_record.c:5:5

SUMMARY: AddressSanitizer: stack-buffer-overflow record.c:9:5 in parse_record
==15823==ABORTING
MS: 2 InsertByte-ChangeByte-; base unit: 7d865e959b2466918c9863afca942d0fb89d7c9a
artifact_prefix='./'; Test unit written to ./crash-0eb8e4ed35c8...
Base64: BWhlbGxvAA==
```

That last line is gold: **`crash-0eb8e4ed35c8...`** is a file on disk containing the *exact bytes* that triggered the bug. You can replay it deterministically, attach a debugger, and — once fixed — keep it forever as a regression test. The sanitizer told you *what* broke and *where* (`record.c:9`); the fuzzer told you *which input* did it.

---

## Core Concept 5 — Writing Your First Fuzz Target

A fuzz target is not magic. It's a function with a fixed signature that takes raw bytes and does something with them. Your only job: route those bytes into the code you want to test.

### C/C++ with libFuzzer

The contract is one function named `LLVMFuzzerTestOneInput`:

```c
#include <stddef.h>
#include <stdint.h>

extern void parse_record(const uint8_t *data, size_t size);  // code under test

// The fuzzer calls THIS, over and over, with different (data, size).
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    parse_record(data, size);   // just hand the bytes to the parser
    return 0;                   // 0 = "input handled, no opinion" (always return 0)
}
```

Compile it with the fuzzer engine **and** a sanitizer in one flag, then run it:

```bash
# clang builds in libFuzzer; "address" adds the ASan oracle
clang -g -O1 -fsanitize=fuzzer,address fuzz_record.c record.c -o fuzz_record

./fuzz_record                  # run forever (Ctrl-C to stop)
./fuzz_record -max_total_time=60   # or: stop after 60 seconds
./fuzz_record corpus/          # run, saving discovered inputs into corpus/
```

That `-fsanitize=fuzzer,address` is the whole combo in one flag: `fuzzer` wires in the coverage-guided engine, `address` wires in ASan as the oracle. Run it and within milliseconds it prints the `stack-buffer-overflow` from Concept 4 and drops a `crash-…` file.

### Go with native fuzzing

Go has fuzzing built into the standard `testing` package since Go 1.18 — no external tool to install. A fuzz target is a function whose name starts with `Fuzz`:

```go
package record

import "testing"

func FuzzParseRecord(f *testing.F) {
    // Seeds: real example inputs to give the fuzzer a head start.
    f.Add([]byte("\x05hello"))
    f.Add([]byte("\x00"))

    // The fuzzer calls this with mutated inputs derived from the seeds.
    f.Fuzz(func(t *testing.T, data []byte) {
        ParseRecord(data)   // a panic or an out-of-bounds here = a finding
    })
}
```

Run it with the `-fuzz` flag:

```bash
go test -fuzz=FuzzParseRecord            # fuzz forever
go test -fuzz=FuzzParseRecord -fuzztime=30s   # fuzz for 30 seconds
go test                                   # NO -fuzz: just replays seeds + saved crashes as normal tests
```

Go's memory safety means it doesn't need ASan for out-of-bounds — an over-read *panics* on its own, and the panic is the oracle. When it finds a crash, it prints this and **writes the reproducer into your repo**:

```text
fuzz: elapsed: 3s, gathering baseline coverage: 4/4 completed, now fuzzing
fuzz: elapsed: 6s, execs: 412300 (137000/sec), new interesting: 18 (total: 22)
--- FAIL: FuzzParseRecord (4.41s)
    --- FAIL: FuzzParseRecord (0.00s)
        record_test.go:14: runtime error: slice bounds out of range [:200] with capacity 5

    Failing input written to testdata/fuzz/FuzzParseRecord/582528ff...
    To re-run:
    go test -run=FuzzParseRecord/582528ff...
FAIL
```

Two things to notice. First, **`new interesting: 18`** is Go's name for coverage-guided corpus entries — same idea as libFuzzer's `NEW`. Second, the reproducer lands in `testdata/fuzz/...` **inside your repository**, and a plain `go test` (no `-fuzz`) automatically replays it. That's the loop closing: a crash the fuzzer found yesterday becomes a permanent unit test today, with zero extra work from you.

### Seeds and the corpus, concretely

- **Seeds** are example inputs *you* hand the fuzzer (`f.Add(...)` in Go, files in `corpus/` for libFuzzer). A good seed is a *real, valid* input — an actual JSON document, a small PNG, one network packet. Seeds save the fuzzer from having to *discover* the basic format from scratch, so it spends its time finding bugs instead of reinventing your file structure.
- The **corpus** is seeds plus everything the fuzzer discovered that reached new coverage. It persists between runs (point the fuzzer at the same directory and it picks up where it left off). A healthy corpus is the fuzzer's accumulated knowledge of your program — back it up; it's expensive to regenerate.

---

## Core Concept 6 — The Tool Landscape

You don't need to master all of these. Know the names and roughly what each is for.

| Tool | What it is | When you'll meet it |
|---|---|---|
| **libFuzzer** | Coverage-guided engine built into LLVM/Clang. In-process (fast); the `LLVMFuzzerTestOneInput` API. | C/C++ projects; the default for OSS-Fuzz. |
| **AFL++** | The modern, actively-maintained fork of AFL. Out-of-process, huge feature set, persistent mode. | C/C++ binaries, including ones you can't easily modify. |
| **Go fuzzing** | Native `go test -fuzz`. No install, corpus in `testdata/`. | Any Go code. The easiest on-ramp to fuzzing in any language. |
| **Honggfuzz** | Coverage-guided fuzzer from Google; strong at multi-threaded and persistent fuzzing. | C/C++, alternative to AFL++. |
| **OSS-Fuzz** | Google's service that runs these fuzzers **continuously** on 1,000+ open-source projects, 24/7, on Google's machines. | If you maintain a popular OSS library, you can enrol it. |
| **Property-based testing** | A *gentler cousin*: you state a property; the framework generates inputs. (Hypothesis for Python, jqwik/QuickCheck-style libs, Go's `testing/quick`.) | Logic/algorithm bugs in any language, not just memory safety. |

A word on the **gentler cousin**. In **property-based testing** you don't look for crashes — you assert a *property* that should always hold, and the framework throws generated inputs at it trying to falsify it. The classic example is a round-trip: *"for any input `x`, `decode(encode(x)) == x`."*

```python
# Python, using Hypothesis
from hypothesis import given, strategies as st

@given(st.binary())                     # "for any bytes value..."
def test_roundtrip(data):
    assert decode(encode(data)) == data  # ...this property must hold
```

Hypothesis generates hundreds of `data` values, and if it finds one that breaks the property, it **shrinks** it to the smallest failing example before reporting. Property-based testing is usually *not* coverage-guided and targets *logic* bugs rather than memory corruption — but it shares the soul of fuzzing: *let the machine generate the inputs; you only specify what "correct" means.* It's the friendliest first step if "compile with a sanitizer" feels like a lot.

> **Key insight:** All of these tools are the same idea wearing different clothes: **machine-generated inputs + an automatic correctness check.** Memory-safety fuzzing uses a sanitizer as the check; property-based testing uses your assertion as the check. Pick the tool that matches your language and your bug class; the *technique* is one technique.

---

## Real-World Examples

**1. Heartbleed would have been caught in minutes.** The 2014 OpenSSL "Heartbleed" bug was a missing bounds check: a heartbeat request claimed a length, and the server copied *that many* bytes out of a buffer, leaking adjacent memory (private keys included). It is, structurally, the `parse_record` bug from Concept 1. A coverage-guided fuzzer with ASan on the TLS parser would have hit it almost instantly — the over-read is exactly what ASan screams about. After Heartbleed, OpenSSL was one of the first projects onboarded to OSS-Fuzz, which now finds such bugs *before* release.

**2. OSS-Fuzz, the bug-finding machine.** Google's OSS-Fuzz runs libFuzzer/AFL++/Honggfuzz continuously against thousands of open-source C/C++ projects (and increasingly other languages). As of the mid-2020s it has reported **tens of thousands** of bugs, the large majority memory-safety issues caught by the fuzzer-plus-sanitizer combo. The pattern is always the same: someone writes a small fuzz target around a parser, OSS-Fuzz runs it on Google's fleet 24/7, and a steady stream of `crash-…` reproducers arrives with the exact failing input attached.

**3. The Go standard library fuzzes itself.** Go's own `encoding/json`, `image/png`, `archive/zip`, and many other packages ship `Fuzz...` functions in their test files. When the Go team added native fuzzing in 1.18, running these targets immediately surfaced crashes in parsers that had been "battle-tested" for years — because no human test had ever fed them a 2-byte truncated PNG header followed by garbage. The reproducers live in `testdata/fuzz/` to this day, replayed on every `go test`.

---

## Mental Models

- **Sanitizer = detector, fuzzer = search.** The sanitizer is a metal detector; it beeps over buried treasure. The fuzzer is the person walking the beach in a grid, covering every square. A detector with no one walking finds nothing; a walker with no detector steps over the gold. You need both.

- **Coverage is a compass, not a map.** The fuzzer can't *see* your program's structure. All it has is one needle: "am I reaching new code?" By always stepping in the direction the needle moves, it climbs from the front door into the deepest rooms — without ever owning a floor plan.

- **The corpus is the fuzzer's memory.** Every saved input is a remembered route to somewhere interesting. Delete the corpus and the fuzzer has amnesia — it must rediscover your input format from scratch. Keep it, feed it, back it up; it *is* the fuzzer's accumulated intelligence about your code.

- **Seeds are a head start, not a requirement.** Give the fuzzer one real JSON file and it skips the hours it would spend rediscovering that JSON starts with `{`. A coverage-guided fuzzer *can* start from nothing, but a good seed is the difference between "deep in the parser by lunch" and "still rattling the front door."

- **A fuzz target is a funnel.** Your harness's only job is to pour arbitrary bytes into the one function you want to stress. Keep the funnel short and deterministic; everything clever happens *inside* the code under test and *outside* in the fuzzer.

---

## Common Mistakes

1. **Fuzzing without a sanitizer.** This is the cardinal error. A fuzzer alone catches only inputs that *visibly* crash, missing the silent overflows and use-after-frees that are the *whole point*. Always compile with `-fsanitize=fuzzer,address` (or `,undefined`), not just `,fuzzer`. The sanitizer is the oracle; without it you're fuzzing blind.

2. **Believing "tests passed under ASan" means "the code is safe."** It means *the paths your tests covered* are safe. That's a fraction of the program. Fuzzing exists precisely to cover the paths your tests don't.

3. **A non-deterministic fuzz target.** If your target reads the clock, touches the network, uses a random seed, or depends on global state left over from the previous run, the fuzzer can't reproduce its own findings and coverage signal turns to noise. A target must be a *pure function of its input bytes*.

4. **No seeds (or useless seeds) for a structured format.** Fuzzing a JSON or protobuf parser from zero bytes wastes enormous time rediscovering the format. Drop a few real, valid examples into the corpus and the fuzzer reaches the interesting code far sooner.

5. **Catching all exceptions / swallowing crashes inside the target.** If your harness wraps the call in a `try/catch` (or `recover()` in Go) that hides errors, you've muzzled the oracle. Let it crash — the crash *is* the result.

6. **Running the fuzzer once for 30 seconds and declaring victory.** Fuzzing is a *continuous* activity. A 30-second run barely warms up. Real value comes from minutes-to-hours per run (CI) and, for important code, continuous fuzzing (OSS-Fuzz-style). Coverage that's still climbing means there are bugs you haven't reached yet.

7. **Throwing away the corpus and the reproducers.** The corpus is hard-won knowledge; the `crash-…` files are free regression tests. Commit reproducers to the repo (Go does this for you in `testdata/fuzz/`) so a fixed bug can never silently return.

---

## Test Yourself

1. You compiled your parser with ASan and ran your whole unit-test suite. It was clean. Can you conclude the parser is memory-safe? Why or why not?
2. In one sentence each, state the job of the *fuzzer* and the job of the *sanitizer* in coverage-guided fuzzing.
3. What does "coverage-guided" add over "dumb" (random-byte) fuzzing? What signal does the fuzzer use, and how?
4. What is a *corpus*, and what's the difference between a corpus and a *seed*?
5. You fuzz a C parser with `-fsanitize=fuzzer` (no `address`). It runs for an hour, finds nothing, and you conclude the parser is solid. What's the flaw in that conclusion?
6. The fuzzer prints `crash-0eb8e4ed...`. What is that file, and what two things should you do with it?
7. How is property-based testing similar to fuzzing, and how is it different?

<details>
<summary>Answers</summary>

1. **No.** A clean ASan run only proves that the *code paths your tests executed* are memory-safe. Bugs on the paths your tests never reached (the dark corners) remain undetected. ASan is a detector with no search; you need a fuzzer to supply the inputs that reach those paths.
2. The **fuzzer** generates and mutates inputs and keeps the ones that reach new code (it's the input generator / search). The **sanitizer** decides whether any given input triggered a bug (it's the oracle / detector).
3. Coverage-guided fuzzing uses **code coverage** as feedback: after each input it checks whether new branches/blocks were hit; if so it **saves that input to the corpus and mutates it further**, building progressively deeper inputs. Dumb fuzzing has no feedback — every input is an independent random roll with no memory, so it can't build on progress.
4. A **corpus** is the fuzzer's saved collection of "interesting" inputs (every input that reached new coverage), and it persists across runs. A **seed** is an example input *you* provide up front to give the fuzzer a head start; seeds are the corpus's starting contents.
5. Without ASan there is **no oracle for silent memory bugs**. An out-of-bounds read or use-after-free often doesn't crash — it returns garbage and keeps running — so the fuzzer sees "no crash" and misses the bug. "Found nothing" really means "found nothing that crashed *on its own*," which excludes most memory-corruption bugs. Add `,address`.
6. It's the **reproducer**: the exact input bytes that triggered the crash. You should (a) replay it under a debugger to fix the bug, and (b) keep it as a permanent **regression test** so the bug can't silently return.
7. **Similar:** both let the machine *generate* the inputs instead of you hand-picking them. **Different:** property-based testing checks a *property/assertion you wrote* (usually for logic bugs, often not coverage-guided), whereas memory-safety fuzzing checks for *crashes/sanitizer reports* and is coverage-guided to dig deeper.

</details>

---

## Cheat Sheet

```
THE LOOP (coverage-guided fuzzing)
  pick input from corpus → mutate → run target → did it hit NEW coverage?
     yes → save to corpus      did it crash? → save crash-… reproducer (BUG)

THE COMBO (memorize this)
  fuzzer   = INPUT GENERATOR (the search)   → makes inputs that reach weird code
  sanitizer= BUG DETECTOR  (the oracle)     → turns silent corruption into a crash
  neither alone is enough.

C / C++  (libFuzzer + ASan)
  int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
      target(data, size); return 0;
  }
  clang -g -O1 -fsanitize=fuzzer,address f.c target.c -o fuzz
  ./fuzz corpus/ -max_total_time=60      # ← fuzzer,address = combo in one flag

GO  (native, no install)
  func FuzzX(f *testing.F) {
      f.Add([]byte("seed"))               # seed = example input
      f.Fuzz(func(t *testing.T, b []byte){ Target(b) })
  }
  go test -fuzz=FuzzX -fuzztime=30s       # fuzz
  go test                                 # replay seeds + saved crashes as tests

READING libFuzzer OUTPUT
  NEW          → input reached new code, kept in corpus
  cov: 38      → blocks covered (rising = progress, flat = stuck)
  exec/s: ...  → throughput; higher = more bugs per minute
  crash-…      → REPRODUCER file: the exact failing bytes

VOCABULARY
  seed     = example input you provide
  corpus   = all saved interesting inputs (persists between runs)
  harness  = the LLVMFuzzerTestOneInput / f.Fuzz function you write
  oracle   = what decides "this is a bug" (a sanitizer, or a panic/assert)

GENTLER COUSIN
  property-based testing: assert decode(encode(x))==x; framework generates x
```

---

## Summary

- A **sanitizer only catches bugs on code that runs**, so the hard part isn't detection — it's manufacturing the *inputs* that drive the program into its dark corners. Hand-writing those inputs is impossible.
- **Fuzzing** automates input generation: it feeds a flood of inputs to your program watching for crashes. **Dumb** fuzzing is blind (no feedback); it bounces off any structured format's front door.
- **Coverage-guided** fuzzing adds the breakthrough: it watches which branches each input reaches, **keeps and mutates** inputs that reach *new* code, and so evolves a **corpus** that burrows deeper and deeper — a search that learns the program's shape using coverage as its compass.
- The **killer combo**: the *fuzzer* is the input generator (the search) and a *sanitizer* is the bug detector (the oracle). Without ASan a silent overflow goes unnoticed; with it, the same input crashes precisely and the fuzzer saves the **reproducer**. Together they are systems software's most effective bug-finding setup.
- Writing a target is ~10 lines: C/C++'s `LLVMFuzzerTestOneInput` built with `-fsanitize=fuzzer,address`, or Go's `func FuzzX(f *testing.F)` run with `go test -fuzz`. Provide **seeds**, let it run, fix the first crash, and **keep the reproducer as a regression test**.
- The tools — **libFuzzer, AFL++, Go fuzzing, Honggfuzz**, and **OSS-Fuzz** running continuously on open-source projects — are one idea in different clothes. **Property-based testing** is the gentler cousin: you assert a property; the framework generates the inputs.

You now have the loop. The [middle.md](middle.md) of this topic goes deeper: writing effective harnesses, structure-aware fuzzing, corpus minimization, measuring coverage properly, and wiring fuzzing into CI so it runs on every change.

---

## Further Reading

- [LLVM libFuzzer tutorial](https://llvm.org/docs/LibFuzzer.html) and the [Fuzzing tutorial](https://github.com/google/fuzzing/blob/master/tutorial/libFuzzerTutorial.md) — the canonical hands-on intro to writing and running a target.
- [Go fuzzing documentation](https://go.dev/security/fuzz/) and the [tutorial: Fuzzing](https://go.dev/doc/tutorial/fuzz) — native fuzzing end to end, including the corpus in `testdata/`.
- [OSS-Fuzz](https://google.github.io/oss-fuzz/) — how continuous, large-scale fuzzing works and how to enrol a project.
- *The Fuzzing Book* (Zeller et al., online) — a free, deep, runnable treatment of every technique on this page.
- The [middle.md](middle.md) of this topic — effective harnesses, structure-aware fuzzing, corpus minimization, and fuzzing in CI.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/junior.md) — the oracle that makes silent memory bugs crash; fuzzing's essential partner.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/junior.md) — a second oracle to combine with the fuzzer (`-fsanitize=fuzzer,undefined`).
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/junior.md) — your own `assert`s as oracles the fuzzer can trip.
- [Testing](../../testing/) — where fuzzing and property-based testing sit in the wider testing toolbox.
- [Code Coverage](../../code-coverage/) — the signal that makes coverage-guided fuzzing "guided."
