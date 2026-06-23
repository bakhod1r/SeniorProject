# AddressSanitizer (ASan) — Professional Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → AddressSanitizer (ASan)
> *The senior page taught you what the shadow memory and redzones do. This page is about turning one engineer's `-fsanitize=address` habit into an org-wide safety net — surviving the first flood of 4,000 findings, paying the 2× CI bill without the runners OOMing, and answering the question that follows every memory-safety CVE: "could we have caught this, and why didn't we?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Introducing a Sanitizer CI Variant](#core-concept-1--introducing-a-sanitizer-ci-variant)
5. [Core Concept 2 — Surviving the First Flood: Triage, Suppressions, and the Ratchet](#core-concept-2--surviving-the-first-flood-triage-suppressions-and-the-ratchet)
6. [Core Concept 3 — Build-Time and CI-Cost Management](#core-concept-3--build-time-and-ci-cost-management)
7. [Core Concept 4 — ASan + Fuzzing for Continuous Coverage](#core-concept-4--asan--fuzzing-for-continuous-coverage)
8. [Core Concept 5 — Production Sampling: GWP-ASan and HWASan/MTE](#core-concept-5--production-sampling-gwp-asan-and-hwasanmte)
9. [Core Concept 6 — The Portfolio: A Sanitizer Strategy Matrix](#core-concept-6--the-portfolio-a-sanitizer-strategy-matrix)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
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

> Focus: **Leading ASan adoption across a real org and codebase — rollout, cost, triage, production sampling, and the portfolio decisions that decide what gets sanitized at all.**

The senior page framed ASan as a tool: compile with `-fsanitize=address`, run, read the report. At the professional level the tool is the easy part. The hard parts are organizational and economic:

- You flip on the sanitizer CI variant and get **4,000 findings on day one** — most in third-party code, some in test fixtures, a handful that are real and exploitable. How do you keep the signal without telling 200 engineers to fix 4,000 things this sprint?
- A sanitizer build runs **~2× slower and uses ~3× the RAM**. Your CI bill and your runner fleet both notice. How do you afford continuous coverage?
- ASan is an **oracle, not a shield** — it never ships to most users. But sampling sanitizers (GWP-ASan, HWASan/ARM MTE) *do* run in production at Google, Chrome, and Android scale. When is that worth the perf and privacy budget?
- You can't run ASan, TSan, MSan, and UBSan simultaneously. Which build gets which, and why?

None of this is about understanding shadow memory better. It's judgment at scale: knowing that the **ratchet** (gate only on *new* errors) is the only way to adopt a sanitizer on a million-line codebase without a six-month freeze; that **fuzzing is what makes ASan find the bugs your tests never reach**; that the ~70%-of-vulns-are-memory-safety statistic is simultaneously the business case for sanitizers *and* the business case for the Rust rewrite that might make them moot. This page is the battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — shadow memory, redzones, quarantine, the bug classes ASan catches (heap/stack/global overflow, UAF, double-free), and `ASAN_OPTIONS`.
- **Required:** You've operated a C or C++ codebase in production and shipped a fix for a memory-safety bug.
- **Helpful:** You've owned a CI pipeline and felt the pain of a slow or flaky required check.
- **Helpful:** You've triaged a crash from a field-telemetry pipeline (Crashpad, Breakpad, or similar) and symbolized a stack from a stripped binary.

---

## Glossary

- **Oracle vs shield:** A sanitizer used as an *oracle* runs in test/fuzz and **tells you a bug exists**; it doesn't run in production, so it protects nobody at runtime. A *shield* runs in production and **mitigates** an attack. ASan is an oracle; HWASan/MTE sampling and GWP-ASan are partial production shields-plus-oracles.
- **Ratchet / baseline:** A recorded snapshot of *existing* findings so CI gates only on **new** ones. Also called "gate-on-new."
- **Suppression file:** A list of known-issue patterns (`ASAN_OPTIONS=suppressions=...`, or interceptor/leak suppressions) that silence specific reports without code changes — a controlled, time-bounded debt instrument.
- **Escape rate:** Fraction of a bug class that reaches production despite your gates — your sanitizer program's outcome metric.
- **GWP-ASan:** *Sampling* allocator-level detector (guard pages) cheap enough to run in production at a tiny per-allocation probability; catches heap UAF/overflow in the field.
- **HWASan:** Hardware-assisted ASan using pointer tagging (top-byte-ignore / ARM MTE). ~2× memory instead of ASan's ~3×, low enough overhead to ship on Android fleets and as `MODE=SYNC`/`ASYNC` MTE.
- **MTE:** ARMv8.5 Memory Tagging Extension — silicon support for the tag-check HWASan does in software.
- **Redzone / quarantine:** ASan's poisoned padding around allocations / delayed-free pool — the mechanisms behind overflow and UAF detection (from senior.md).
- **`__asan_*` annotations:** Manual poisoning API (e.g., `ASAN_POISON_MEMORY_REGION`) used to teach ASan about custom allocators and arenas.

---

## Core Concept 1 — Introducing a Sanitizer CI Variant

The first deliverable is not "find bugs" — it's **a new build configuration that exists, compiles, and runs the test suite green-ish**, without disturbing the existing pipeline. ASan changes ABI-adjacent behavior (it intercepts allocators, instruments every memory access), so it is a *separate build*, not a flag you toss onto the normal one.

```bash
# The ASan build variant — its own configure, its own artifacts
CFLAGS="-fsanitize=address -fno-omit-frame-pointer -O1 -g"
CXXFLAGS="$CFLAGS"
LDFLAGS="-fsanitize=address"
# -O1 (not -O0): ASan + -O0 is brutally slow; -O1 keeps inlining sane for stacks.
# -fno-omit-frame-pointer: readable, fast unwinds without DWARF gymnastics.
```

Runtime configuration belongs in the CI environment, not scattered in scripts:

```bash
export ASAN_OPTIONS="detect_leaks=1:abort_on_error=1:strict_string_checks=1:\
detect_stack_use_after_return=1:check_initialization_order=1:\
suppressions=/ci/asan.supp:halt_on_error=0"
# halt_on_error=0 → collect MANY findings per run instead of dying on the first.
# That single flag turns "fix one, re-run, fix one" into "see the whole flood at once."
export ASAN_SYMBOLIZER_PATH=/usr/lib/llvm/bin/llvm-symbolizer
```

**The rollout sequencing that works:**

1. **Land the variant as non-required, allowed-to-fail.** It runs, posts results, gates nothing. Engineers see it; nobody is blocked.
2. **Run it on a schedule first, not per-PR.** A nightly ASan run on `main` surfaces the flood without 2×-ing every PR's latency on day one.
3. **Capture the baseline** (next section) so you know your starting debt.
4. **Flip to gate-on-new for per-PR.** Now a PR fails only if *it* introduced a finding. This is the moment the sanitizer becomes a real safety net.
5. **Burn down the baseline** opportunistically — never as a big-bang freeze.

> **The professional reality:** the failure mode of sanitizer rollout is making it a *required* gate-on-*all* check on day one. The suite lights up red, every PR is blocked on pre-existing bugs nobody on that PR caused, and within a week someone with merge rights disables the check "temporarily." You don't get a second first impression. Land it dark, baseline it, *then* gate — on new only.

---

## Core Concept 2 — Surviving the First Flood: Triage, Suppressions, and the Ratchet

The first full ASan run on a mature C/C++ codebase produces hundreds to thousands of findings. The instinct — "file 4,000 bugs" — guarantees failure. The discipline is **triage → baseline → ratchet**.

**Triage buckets** (a finding goes to exactly one):

| Bucket | Action | Example |
|---|---|---|
| **Real + reachable** | Fix now; this is the point of the program | UAF in your request path |
| **Real + in your code, cold** | File, prioritize, fix over time | Overflow in an error path |
| **Third-party / vendored** | Suppress by file/lib; upstream a patch if you can | OpenSSL/zlib internal |
| **Test-only fixture leak** | `LSAN` leak suppression or fix the test | Test allocates, never frees |
| **False alarm (custom allocator / intentional)** | **Annotate** (`ASAN_POISON_MEMORY_REGION`) or suppress with a comment | Arena allocator's pooled reuse |

**The suppression file is a debt instrument, not a trash can.** Every entry needs an owner and a reason:

```
# asan.supp — each line is tracked debt, not "make it go away"
# JIRA-4821 (owner: @platform): zlib inflate redzone; upstream fix in 1.3.1, bump pending
interceptor_via_lib:libz.so
# JIRA-4822 (owner: @net): custom slab allocator; needs __asan poisoning, see slab.c
leak:slab_arena_alloc
```

**The ratchet (gate-on-new) is the keystone of the whole program.** You record the baseline set of findings; CI fails a PR only if it adds a finding *not* in the baseline:

```bash
# Conceptual ratchet. Real impls: a fingerprint set keyed on (bug-type, top-N frames).
asan_run --json > current.json
# New = in current, not in baseline (compare on stable fingerprints, NOT line numbers,
# which shift on every refactor and cause false "new" findings).
comm -13 <(jq -r .fingerprint baseline.json | sort) \
         <(jq -r .fingerprint current.json | sort) > new_findings.txt
[ -s new_findings.txt ] && { echo "NEW ASan findings:"; cat new_findings.txt; exit 1; }
```

The baseline only ever **shrinks**: a finding removed from the codebase is removed from the baseline (a small CI step that rebases it), and you never *add* to it except via an explicit, reviewed "accept this debt" change. That asymmetry is what makes the codebase monotonically safer.

> **Why fingerprints, not line numbers:** the rookie ratchet keys on file:line. The first reformat or import-reorder shifts every line, the diff explodes into thousands of "new" findings, and the gate is useless by Tuesday. Fingerprint on **bug class + a few top stack frames** (function names, not addresses), tolerant to line drift. This single design choice decides whether your ratchet survives contact with a real repo.

---

## Core Concept 3 — Build-Time and CI-Cost Management

ASan builds are slow to compile, slow to run, and memory-hungry to execute. At org scale this is a real budget line and a real reliability problem (OOM-killed runners look like flaky tests).

**The cost profile, concretely:**

| Dimension | Typical ASan multiplier vs normal build | Why |
|---|---|---|
| Compile time | ~1.5–2× | Instrumentation on every memory op |
| Run time | ~2× (worse at `-O0`) | Shadow lookups, redzone checks |
| **RSS / memory** | **~3×** | Shadow memory is 1/8 of address space + redzones + quarantine |
| Binary size | 2–3× | Instrumentation + ASan runtime |

**Levers, roughly in order of payoff:**

- **Don't run ASan on every job.** Run the *normal* fast suite on every PR; run ASan on a **subset that matters** (gate-on-new) plus a fuller **nightly**. Continuous fuzzing (Concept 4) does the deep coverage; per-PR ASan catches regressions cheaply.
- **Shard the suite.** ASan's run-time penalty is embarrassingly parallel — split tests across N runners so wall-clock stays flat even at 2× per-test. This is the single biggest win on suite latency.
- **Cache the sanitizer build separately.** ASan artifacts must **not** share a cache key with normal artifacts (different flags = different bytes). Give the variant its own ccache/sccache/Bazel cache namespace, or you get silent cross-contamination and cache misses.
- **Set RSS limits and right-size runners.** The 3× memory is what OOM-kills runners. Either give the ASan jobs **dedicated, higher-memory runners** or cap concurrency per host. `ASAN_OPTIONS=hard_rss_limit_mb=N` makes ASan fail *loudly* (a clear OOM report) instead of the kernel OOM-killer nuking the job opaquely.
- **Tune quarantine for memory, not just speed.** `quarantine_size_mb` trades UAF-detection window for RSS. On memory-starved runners, shrinking it recovers headroom (at some loss of late-UAF detection); on a UAF hunt, grow it.

```bash
# Make OOM legible instead of a mystery "runner died"
export ASAN_OPTIONS="hard_rss_limit_mb=6144:allocator_may_return_null=1:\
quarantine_size_mb=256:halt_on_error=0"
```

> **The professional reality:** the rollout that stalls is the one where the ASan suite OOMs the standard CI runners, jobs die without a sanitizer report (just "exit 137"), and the team concludes "ASan is flaky" and shelves it. The fix is operational, not technical: dedicated high-memory runners (or capped concurrency), an explicit `hard_rss_limit_mb` so the failure is a *legible* sanitizer message, and sharding so wall-clock doesn't balloon. Budget the memory before you flip the switch.

---

## Core Concept 4 — ASan + Fuzzing for Continuous Coverage

ASan only reports a bug on a code path that **actually executes**. Your test suite executes the paths you thought of. The bugs that reach production are, almost by definition, on paths you *didn't* think of. **Fuzzing is the engine that drives execution into those paths; ASan is the oracle that notices when one of them is buggy.** Neither is sufficient alone:

- Fuzzing without a sanitizer only catches crashes and hangs — a silent heap-overflow that doesn't immediately segfault sails right through.
- ASan without fuzzing only inspects the inputs your tests happen to provide.

Together they are the standard for memory-safety assurance, codified by **OSS-Fuzz** (Google runs libFuzzer/AFL++ harnesses *under ASan/MSan/UBSan* continuously against thousands of open-source projects, files bugs automatically, and enforces a disclosure deadline).

```cpp
// A libFuzzer harness, compiled with -fsanitize=address,fuzzer.
// OSS-Fuzz runs millions of these executions/day; ASan turns each into an oracle.
extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
  ParsePacket(data, size);   // ASan flags any OOB/UAF the fuzzer's inputs trigger
  return 0;
}
```

**The professional integration pattern:**

- **Corpus is an asset.** The accumulated fuzzing corpus is institutional knowledge — back it up, share it across runs, and **replay it under ASan in CI** as a fast regression suite. A crash the fuzzer found last month must never silently come back.
- **Coverage-guided, not blind.** Coverage feedback (`-fsanitize-coverage`) is what makes the fuzzer reach deep paths — see [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md). ASan + coverage instrumentation is the combination OSS-Fuzz uses.
- **Track fuzzer-found vs ASan-in-CI-found.** Two different metrics. CI-ASan catches *regressions on known paths*; fuzzing+ASan finds *new bugs on unknown paths*. A healthy program shows fuzzing finding the deep ones and CI catching their reintroduction.

> **The leverage:** continuous fuzzing under ASan is how you find the use-after-free that lives on the malformed-input path no human wrote a test for. The senior tier taught you ASan reports the bug; the professional realization is that **ASan's value is bounded by the coverage you feed it**, and fuzzing is the cheapest way to buy enormous coverage. See [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md) for the harness/corpus mechanics.

---

## Core Concept 5 — Production Sampling: GWP-ASan and HWASan/MTE

ASan is an oracle — it almost never ships to end users (3× RAM, 2× CPU make it a non-starter in production). But the bugs that matter most are the ones that *only* manifest in the field: a UAF that needs a specific concurrent timing, a heap-overflow gated on a customer's data shape. The industry's answer is **sampling sanitizers cheap enough to run in production**.

**GWP-ASan** (Guard With Probability — ASan) places a tiny fraction of allocations on **guard pages** so that an overflow or use-after-free on *that* allocation faults immediately, with a sanitizer-quality report. The per-allocation probability is tuned so the average overhead is negligible (a guard page every ~thousands of allocations). It ships in **Chrome, Android (libc), and server fleets**. The trade is statistical: any single instance has a low chance of catching a given bug, but **across millions of devices/processes**, rare field bugs surface that no test ever reproduced.

**HWASan / ARM MTE** uses **pointer tagging** (top-byte-ignore in software, or hardware tag checks via ARMv8.5 MTE) instead of redzones. It costs **~2× memory rather than ASan's ~3×** and far less CPU — low enough to run on **whole Android fleets** (Google has shipped MTE-on builds on Pixel) as `SYNC` (precise, slower) or `ASYNC` (sampled tag-check exceptions, cheaper). MTE is the closest thing to a production memory-safety *shield* that's also an oracle.

**The telemetry pipeline this implies:**

```
device/process (sampled detector) → minidump/crash report (Crashpad/Breakpad)
   → upload (privacy-filtered, rate-limited)        ← perf & privacy budgets live HERE
   → server-side SYMBOLIZATION against stored debug syms (binary is stripped in field)
   → dedup by stack fingerprint → triage queue → bug
```

The professional concerns are not "does it detect" but **the budgets around it**:

- **Perf budget:** sampling rate is the dial. Too high, you regress users' latency/battery; too low, rare bugs never accumulate enough hits. You tune it like an error-budget.
- **Privacy budget:** crash reports can contain user memory. You **scrub** (no raw heap dumps off-device without consent), rate-limit, and often only ship stacks + minimal context. This is a hard requirement, not a nicety.
- **Symbolization:** field binaries are stripped. You **store debug symbols server-side** keyed by build ID and symbolize crashes *there*. No symbol pipeline → unactionable hex addresses.

> **The professional reality:** production sampling is worth it when (a) you have a **large fleet** (the statistics only work at scale), (b) you have a **field-crash pipeline already** (Crashpad/Breakpad + server symbolization), and (c) memory-safety bugs are a top cause of your field crashes/CVEs. For a small server fleet with good fuzzing, GWP-ASan's marginal value is low and the privacy/telemetry plumbing is real work. At Android/Chrome scale it's transformative. Match the investment to the fleet.

---

## Core Concept 6 — The Portfolio: A Sanitizer Strategy Matrix

ASan is one of a family, and a defining professional constraint is that **you cannot run them all at once**. ASan and MSan are mutually exclusive (both reinterpret memory); TSan needs its own instrumented build and a 5–15× memory blowup; MSan requires *all* dependencies instrumented or it drowns in false positives. So you run **multiple build variants, each its own CI lane**, and you decide which code gets which.

| Sanitizer | Catches | Overhead (CPU / mem) | Key constraint |
|---|---|---|---|
| **ASan** | Heap/stack/global overflow, UAF, double-free | ~2× / ~3× | The default first sanitizer; not for data races |
| **TSan** | Data races, deadlock-order | ~5–15× / ~5–10× | Own build; can't combine with ASan; concurrency code only |
| **UBSan** | Undefined behavior (int overflow, bad shifts, misaligned, null deref) | **near-free** / small | Cheapest; often run *alongside* ASan in the same build |
| **MSan** | Use of uninitialized memory | ~3× / ~2× | Needs **all** deps instrumented; exclusive with ASan |
| **Valgrind/Memcheck** | Leaks, UAF, uninit (no recompile) | **10–50×** / high | No recompile needed; far slower; for binaries you can't rebuild |

**Why you can't merge them:** ASan and MSan both own the memory model; TSan's shadow model is incompatible with ASan's. The practical portfolio is therefore *layered lanes*:

- **ASan + UBSan together** (UBSan is cheap and composes) — the everyday, run-most-often lane.
- **TSan** as a **separate** lane, focused on the concurrent subsystems (it's wasteful to TSan single-threaded code).
- **MSan** only where uninit-memory bugs are a real risk *and* you can instrument the whole dependency closure (often only the most security-sensitive parsers).
- **Valgrind** reserved for the **can't-recompile** case (third-party binary, exotic toolchain) — covered in [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/professional.md).

> **The portfolio principle:** don't ask "which sanitizer is best" — ask "which symptom am I chasing, on which code, and what can I afford to run continuously?" ASan+UBSan continuously on everything; TSan on concurrency; MSan surgically; Valgrind for the unrecompilable. The matrix above *is* the decision. See [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/professional.md) and [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/professional.md) for the lanes that pair with ASan.

---

## War Stories

**The UAF fuzzing reached before any human did.** A media-parsing library had passed ASan in CI for a year — green every run. A use-after-free lived on a code path triggered only by a frame with a specific corrupt header field nobody had written a test for. When the team stood up continuous libFuzzer-under-ASan and the corpus mutated its way into that header shape after ~40 hours of fuzzing, ASan fired instantly with a clean UAF report: freed in the error handler, read in a deferred callback. The bug had been latent and remotely reachable the whole time. The lesson wasn't about ASan — ASan would have caught it on day one *if the path had executed*. It was that **ASan's reach equals your coverage**, and fuzzing is how you buy coverage you can't write by hand.

**The container-overflow false alarm from a custom slab allocator.** A networking team's ASan lane lit up with `container-overflow` and heap-buffer-overflow reports inside their hot path — all in their own arena/slab allocator. The "bugs" were ASan misreading the allocator's *intentional* pooled reuse: it carved sub-buffers out of a big slab, and ASan, not knowing the slab's internal structure, saw reads/writes into "freed" or "redzone" regions that were legitimately the allocator's. The fix was **manual poisoning annotations** — `ASAN_POISON_MEMORY_REGION` / `ASAN_UNPOISON_MEMORY_REGION` around slab carve/release so ASan's shadow tracked the *real* liveness, plus `ASAN_OPTIONS=detect_container_overflow=0` while the annotations were being added. The lesson: a **custom allocator is invisible to ASan until you teach it**, and the first ASan run over one produces false alarms that look terrifying but are annotation gaps, not bugs. Suppress-with-a-ticket, annotate, then re-enable.

**The prod heisenbug only GWP-ASan could see.** A server fleet had a once-a-week segfault that no test, no fuzzing run, and no ASan build ever reproduced — it needed a specific concurrent allocation pattern under real production load. With ASan far too expensive to run in prod, the team enabled **GWP-ASan sampling** across the fleet. Over two weeks the guard-page sampling caught the freed-then-reused allocation on a handful of machines, server-side symbolization turned the minidumps into a clean stack, dedup collapsed them into one report, and the root cause — a lifetime bug across a callback boundary — was finally actionable. No reproducer in a lab ever existed; **the fleet was the reproducer.** The lesson: some bugs only exist at production scale and timing, and sampling sanitizers are the only oracle that runs there.

**The ASan rollout that OOM-killed the runners.** A team flipped ASan to a required per-PR gate-on-*all* in one change. Two problems compounded: the 3× memory blew past the standard runners' RAM, so jobs died with bare `exit 137` (no ASan report, just "the runner died"); and gate-on-all meant every PR was red over hundreds of pre-existing findings nobody on that PR had introduced. Within a week the check was disabled "for now," and "for now" lasted a quarter. The eventual successful rollout did three things differently: **dedicated high-memory runners with `hard_rss_limit_mb` set** (so OOM produced a legible sanitizer message and the failure was diagnosable), **sharding** to keep wall-clock flat, and **gate-on-new with a fingerprinted baseline** so PRs only failed on findings they actually introduced. Same tool, opposite outcome — the difference was entirely operational.

---

## Decision Frameworks

**Which sanitizer for which symptom?**

| Symptom | Reach for | Notes |
|---|---|---|
| Segfault / heap corruption / "wild" pointer | **ASan** | The default; overflow/UAF/double-free |
| Intermittent wrong results, only under load/threads | **TSan** | Data race signature; ASan won't see it |
| "Works in debug, breaks in release"; weird int/shift behavior | **UBSan** | Often UB the optimizer exploited |
| Garbage values that depend on stale memory | **MSan** | Uninitialized read (needs instrumented deps) |
| Leak / corruption in a binary you **can't recompile** | **Valgrind** | No source/rebuild required; slow |
| Once-a-week prod crash, no lab repro | **GWP-ASan / MTE** | Sampling in the field; needs a fleet |

**Recompile-able vs not → ASan vs Valgrind:**

| Situation | Choose | Why |
|---|---|---|
| You own the source and toolchain | **ASan** | ~10× faster than Valgrind, richer reports, fuzzing-friendly |
| Third-party/closed binary, exotic arch, no rebuild | **Valgrind/Memcheck** | Works on the unmodified binary |
| Need leak + uninit on a one-off, recompile too costly | **Valgrind** | One command, no build changes |
| Continuous CI / fuzzing | **ASan** | Valgrind's 10–50× makes it impractical at scale |

**When to invest in production sampling (GWP-ASan / MTE):**

| Condition | Lean toward sampling | Lean away |
|---|---|---|
| Fleet size | Millions of devices/processes | Handful of servers |
| Field-crash pipeline exists | Yes (Crashpad/Breakpad + symbol store) | No telemetry plumbing |
| Memory bugs are top crash/CVE cause | Yes | Rare; other classes dominate |
| Privacy/perf budget available | Yes, can scrub + rate-limit | No appetite for user-data risk |
| Lab/fuzzing reproduces the bugs | No (heisenbugs) | Yes (fuzzing already catches them) |

**Gate-on-new vs gate-on-all:**

| Context | Policy | Rationale |
|---|---|---|
| Adopting on an existing large codebase | **Gate-on-new** (ratchet) | Gate-on-all blocks every PR on pre-existing debt → check gets disabled |
| Greenfield / already-clean module | **Gate-on-all** | No legacy debt; keep it pristine from line one |
| Security-critical parser, post-cleanup | **Gate-on-all** | Zero tolerance once baselined to zero |
| Vendored/third-party code | **Suppress + upstream** | You don't own the fix; track as debt |

---

## Real-World Examples

- **OSS-Fuzz (Google):** thousands of open-source projects fuzzed **under ASan/MSan/UBSan** continuously; auto-files bugs with a 90-day disclosure deadline. The canonical "fuzzing + sanitizer as oracle" program — and the reason a huge swath of critical C/C++ libraries now ship with libFuzzer harnesses. (See [05](../05-coverage-guided-dynamic-analysis/professional.md).)
- **Chrome:** ships **GWP-ASan** to stable channel users for in-the-field heap-bug detection at negligible overhead, and runs ASan/MSan/TSan bots ("ClusterFuzz") on every change. A textbook portfolio: oracles in CI, a sampling shield-plus-oracle in production.
- **Android:** **HWASan** builds for system testing and **MTE** on supported silicon (Pixel) across the fleet — the largest production deployment of hardware-assisted memory safety, with sampling tuned against perf/battery budgets.
- **The ~70% statistic:** Microsoft (MSRC) and Google (Chrome) both reported that **~70% of their serious security vulnerabilities are memory-safety bugs**. This is simultaneously the business case for sanitizers + fuzzing *and* the business case for memory-safe languages — see the Rust discussion below.

---

## Mental Models

- **ASan is an oracle, not a shield.** It tells you a bug exists; it does not protect production (too expensive to ship). The only sanitizers that *also* run in prod are the **sampling** ones (GWP-ASan, MTE), and they trade certainty for cheapness.

- **ASan's reach equals your coverage.** It can only report a bug on a path that executes. Your tests cover the paths you imagined; the bugs that escape live on the paths you didn't. **Fuzzing is the cheapest way to buy the coverage ASan needs.**

- **The ratchet makes a million-line codebase adoptable.** You cannot fix 4,000 findings before turning the gate on. You *can* baseline them and gate on new ones, so the codebase gets monotonically safer without a freeze. Fingerprint on stack frames, not line numbers.

- **Sanitizers are a portfolio, not a pick.** ASan, TSan, MSan, UBSan, Valgrind catch different symptoms and **can't all run at once**. Run ASan+UBSan everywhere, TSan on concurrency, MSan surgically, Valgrind for the unrecompilable.

- **Production sampling only works at scale.** A guard page hit once in thousands of allocations catches nothing on three servers and catches everything across a million devices. The statistics — and the symbolization/privacy plumbing — are the whole game.

- **The 70% number cuts both ways.** It justifies investing in sanitizers + fuzzing *and* justifies asking whether the hottest unsafe components should be rewritten in a memory-safe language. Sanitizers find bugs; Rust/safe-Rust can make the class structurally impossible. Mature orgs do both: sanitize the C/C++ you have, and steer the highest-risk new code to memory-safe languages.

---

## Common Mistakes

1. **Flipping ASan to required gate-on-all on day one.** The suite goes red on pre-existing debt, every PR is blocked on bugs nobody on that PR caused, and the check gets disabled within a week. Land dark → baseline → **gate-on-new**.

2. **Fingerprinting the ratchet on file:line.** The first reformat shifts every line and the diff explodes into thousands of phantom "new" findings. Fingerprint on **bug class + top stack frames**.

3. **Treating the suppressions file as a trash can.** Untracked suppressions become permanent blindness. Every entry needs an **owner, a ticket, and a reason**, and the file should shrink over time.

4. **Ignoring the 3× memory cost until the runners OOM.** Jobs die with `exit 137` and no sanitizer report, and the team blames "flaky ASan." Set `hard_rss_limit_mb` for legible failures, use **dedicated high-memory runners**, and **shard**.

5. **Running ASan without fuzzing and assuming you're covered.** ASan only inspects the inputs your tests provide. Without fuzzing you're blind to the malformed-input paths where most escaped memory bugs live.

6. **Not annotating custom allocators.** Arena/slab/pool allocators are invisible to ASan and produce false `container-overflow`/heap-overflow alarms. **Poison/unpoison** them with `__asan_*` so the shadow tracks real liveness.

7. **Sharing the cache between normal and sanitizer builds.** Different flags = different bytes; a shared cache key silently corrupts or thrashes. Give the ASan variant its **own cache namespace**.

8. **Deploying GWP-ASan/MTE without the symbolization and privacy pipeline.** Field crashes come back as hex on stripped binaries (unactionable), or worse, ship user memory off-device. **Server-side symbolization + scrubbing + rate-limiting** are prerequisites, not follow-ups.

---

## Test Yourself

1. You enable an ASan CI variant on a mature codebase and get 3,000 findings. Outline your rollout sequence so the check ends up *required* without ever blocking PRs on pre-existing debt.
2. Why fingerprint the ratchet on stack frames rather than file:line? What breaks if you don't?
3. Your ASan CI jobs intermittently die with `exit 137` and no report. Diagnose the likely cause and give three operational fixes.
4. Explain why "ASan passed in CI for a year" did not prevent a remotely-reachable UAF, and what you'd add to find it.
5. Your custom slab allocator triggers `container-overflow` reports you're sure are false. What's happening, and what's the correct fix (not just suppression)?
6. A once-a-week production segfault has no lab reproducer. What tool runs in production to catch it, what conditions make it worthwhile, and what two pipeline pieces must exist first?
7. You can run ASan, TSan, MSan, or UBSan — but not all at once. Describe the lanes you'd actually run on a large concurrent C++ service and why.
8. Given that ~70% of serious vulns are memory-safety bugs, argue both (a) for investing in ASan+fuzzing and (b) for a Rust rewrite of a component. When do you do which?

<details>
<summary>Answers</summary>

1. **Land the variant non-required and allowed-to-fail** so it runs and posts results but gates nothing; **run it nightly on `main` first** to surface the flood without 2×-ing every PR; **capture a baseline** of existing findings; **flip to gate-on-new per-PR** so a PR fails only if *it* adds a finding; **burn down the baseline opportunistically**. Never gate-on-all on day one.
2. Line numbers shift on every refactor/reformat/import-reorder, so a file:line ratchet reports thousands of phantom "new" findings after the first cleanup and becomes useless. **Bug class + top stack frames** are stable across line drift, so the ratchet flags genuinely new bugs only.
3. `exit 137` = OOM-kill; ASan's **~3× RSS** blew past the runner's RAM and the kernel killed the job before ASan could report. Fixes: **`ASAN_OPTIONS=hard_rss_limit_mb=N`** so ASan fails with a legible message instead of being silently killed; **dedicated high-memory runners** (or cap concurrency per host); **shard the suite** so per-host memory and wall-clock stay bounded. Optionally shrink `quarantine_size_mb`.
4. ASan only reports bugs on **paths that execute**; the UAF lived on a malformed-input path no test exercised, so every green run was simply never running that code. Add **continuous coverage-guided fuzzing under ASan** (libFuzzer/AFL++), keep and **replay the corpus in CI** so found bugs can't silently return.
5. ASan doesn't know your slab's internal structure, so it sees reads/writes into regions it considers freed/redzone — but which the allocator legitimately reuses. Correct fix: **manual poisoning** with `ASAN_POISON_MEMORY_REGION`/`ASAN_UNPOISON_MEMORY_REGION` around carve/release so the shadow tracks real liveness (suppress temporarily with a ticket while you add annotations).
6. **GWP-ASan** (or HWASan/MTE) sampling in production. Worthwhile when you have a **large fleet** (statistics only work at scale) and memory bugs are a top crash cause. Prerequisites: a **field-crash pipeline** (Crashpad/Breakpad) and **server-side symbolization** against stored debug symbols (field binaries are stripped) — plus privacy scrubbing/rate-limiting.
7. **ASan + UBSan together** as the everyday lane on all code (UBSan is near-free and composes with ASan). **TSan as a separate lane** focused on the concurrent subsystems (its 5–15× cost is wasted on single-threaded code, and it can't combine with ASan). Optionally **MSan surgically** on security-sensitive parsers if the full dependency closure can be instrumented. They're separate builds because ASan/MSan/TSan own incompatible memory models.
8. (a) Most of your existing C/C++ is staying; **ASan+fuzzing** is the highest-leverage way to find and prevent memory bugs in code you already have, at every CI run. (b) For a **hot, high-risk, frequently-changing component**, a Rust rewrite makes the entire bug *class* structurally impossible rather than merely detectable. Do **both**: sanitize the C/C++ you keep; steer the highest-risk new/rewritten code to a memory-safe language. The decision hinges on rewrite cost vs the component's risk and churn.

</details>

---

## Cheat Sheet

```
ASAN BUILD VARIANT (its own pipeline, its own cache namespace)
  CFLAGS=-fsanitize=address -fno-omit-frame-pointer -O1 -g
  ASAN_OPTIONS=halt_on_error=0:detect_leaks=1:suppressions=asan.supp
    halt_on_error=0  → collect MANY findings/run (see the whole flood)

ROLLOUT (never gate-on-all on day 1)
  1 land non-required  2 nightly on main  3 baseline
  4 gate-on-NEW per-PR  5 burn down baseline

RATCHET (gate-on-new)
  fingerprint on BUG CLASS + TOP STACK FRAMES  (NOT file:line)
  baseline only SHRINKS; add debt only via reviewed change

COST CONTROL  (~2× CPU, ~3× RAM)
  shard the suite              (wall-clock flat)
  separate cache namespace     (flags differ → bytes differ)
  hard_rss_limit_mb=N          (legible OOM, not exit 137)
  dedicated high-mem runners   (3× RAM kills standard ones)
  quarantine_size_mb           (trade UAF window for RSS)

PORTFOLIO (can't run all at once)
  ASan+UBSan  everywhere      overflow/UAF + UB (UBSan ~free)
  TSan        concurrency     data races; own build; 5-15×
  MSan        surgical        uninit; needs ALL deps instrumented
  Valgrind    can't-recompile leaks/UAF, no rebuild; 10-50×

ORACLE vs SHIELD
  ASan          = oracle (CI/fuzzing only)
  fuzzing+ASan  = coverage that finds the escaped bugs
  GWP-ASan/MTE  = SAMPLING in production (needs fleet + symbol pipeline)

CUSTOM ALLOCATOR
  ASAN_(UN)POISON_MEMORY_REGION around carve/release   (else false alarms)
```

---

## Summary

- **The rollout, not the tool, is the hard part.** Land the ASan variant **dark** (non-required), surface the flood on a **nightly**, **baseline** it, then flip to **gate-on-new**. Gate-on-all on day one gets the check disabled within a week.
- **The ratchet is the keystone.** Gate only on *new* findings, fingerprinted on **bug class + top stack frames** (never file:line), with a baseline that only shrinks. That's what makes a million-line codebase adoptable without a freeze.
- **Budget the cost before flipping the switch.** ASan is ~2× CPU and **~3× RAM**; **shard** for wall-clock, give it a **separate cache namespace**, set **`hard_rss_limit_mb`** for legible OOMs, and put it on **dedicated high-memory runners**. OOM-killed jobs are why rollouts stall.
- **ASan is an oracle; its reach equals your coverage.** It only reports bugs on executed paths, so **continuous fuzzing under ASan** (the OSS-Fuzz model — see [05](../05-coverage-guided-dynamic-analysis/professional.md)) is what finds the escaped memory bugs on inputs no human tested.
- **Production sampling (GWP-ASan, HWASan/MTE) is the only oracle that runs in prod** — worthwhile at fleet scale with a field-crash + **server-side symbolization** pipeline and a real **privacy/perf budget**. Transformative at Android/Chrome scale; marginal on three servers.
- **Sanitizers are a portfolio you can't run all at once.** ASan+UBSan everywhere, TSan on concurrency, MSan surgically, Valgrind for the unrecompilable. And the ~70%-memory-safety statistic justifies both investing in sanitizers+fuzzing *and* rewriting the hottest components in a memory-safe language — mature orgs do both.

You can now lead ASan adoption as an organizational, economic, and incident-response program — not just a compiler flag. The remaining tier — [interview.md](interview.md) — consolidates this into the questions that probe whether someone has actually run a sanitizer program at scale.

---

## Further Reading

- [Google sanitizers wiki (AddressSanitizer)](https://github.com/google/sanitizers/wiki/AddressSanitizer) — the canonical reference: flags, algorithm, `ASAN_OPTIONS`, manual poisoning API.
- [AddressSanitizerManualPoisoning](https://github.com/google/sanitizers/wiki/AddressSanitizerManualPoisoning) — annotating custom allocators (`ASAN_POISON_MEMORY_REGION`) to eliminate false alarms.
- [GWP-ASan documentation (LLVM)](https://llvm.org/docs/GwpAsan.html) — the sampling allocator-level detector that runs in production.
- [Hardware-assisted AddressSanitizer (HWASan) design](https://clang.llvm.org/docs/HardwareAssistedAddressSanitizerDesign.html) — pointer tagging, the ~2× memory model, and the path to ARM MTE.
- [Arm Memory Tagging Extension (MTE) whitepaper](https://developer.arm.com/documentation/108035/latest/) — the silicon behind hardware memory safety on Android.
- [OSS-Fuzz](https://google.github.io/oss-fuzz/) — the continuous-fuzzing-under-sanitizers program; the reference model for combining ASan with fuzzing.
- [Microsoft (MSRC) and Chrome "70% memory safety" analyses](https://www.chromium.org/Home/chromium-security/memory-safety/) — the data behind the business case for sanitizers and memory-safe languages.
- [interview.md](interview.md) — the questions that probe real, at-scale sanitizer experience.

---

## Related Topics

- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/professional.md) — the concurrency lane that runs as its own build alongside ASan.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/professional.md) — the near-free sanitizer you compose *into* the ASan build.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/professional.md) — the no-recompile option for binaries you can't rebuild.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md) — fuzzing and the coverage that gives ASan its reach.
- [Security](../../../../Security/) — the supply-chain and vulnerability picture the memory-safety program feeds into.
