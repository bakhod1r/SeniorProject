# AddressSanitizer (ASan) — Interview Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → AddressSanitizer (ASan)
> *An ASan interview rarely asks "what is a memory bug." It asks "here's a `heap-use-after-free` report — read it to me, then tell me where the bug is," and watches whether you can name the three stacks, explain why shadow memory makes this fast, and say in one breath what ASan will **never** catch.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Mechanism](#mechanism)
5. [Limits & Comparisons](#limits--comparisons)
6. [Practice at Scale](#practice-at-scale)
7. [Scenario & Debugging](#scenario--debugging)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

ASan shows up in interviews for any role that touches C, C++, Rust FFI, Go cgo, or kernel-adjacent code — and increasingly in "tell me how you'd find this class of bug" rounds for SDET and infra positions. The interviewer is almost never testing trivia. They want to know three things:

- **Do you reach for the right tool?** Given a "random crash that only happens sometimes," does ASan come to mind, and do you know it won't help with a data race?
- **Do you understand the mechanism well enough to trust and bound it?** Shadow memory, redzones, quarantine — knowing these lets you explain the 2× CPU / 3× RAM cost, why a "false positive" is usually a real bug, and why ASan and TSan can't share a build.
- **Can you actually read a report and drive it to a fix?** This is the part candidates fumble: a real ASan report has *three* stack traces and a one-line verdict, and strong candidates read them in the right order.

Each question below carries the **Q**, a note on **what's really being tested**, and a model **A** at the depth a strong candidate gives. The recurring distinctions — *spatial vs temporal* bug, *detection vs exhaustiveness* ("only on executed paths"), *instrumentation vs interception*, and *what each sanitizer owns* — are the spine of the whole topic. Name the distinction before reaching for a flag.

---

## Prerequisites

You should be comfortable with:

- **The memory model of a C/C++ program** — stack vs heap vs globals, what `malloc`/`free` and `new`/`delete` do, what a dangling pointer is.
- **Pointer arithmetic and object lifetime** — off-by-one, out-of-bounds, use-after-free, use-after-return as *concepts*, even if you've never named the bug class.
- **The build pipeline** — compile vs link, instrumentation as a compiler pass, runtime libraries linked into the binary. (See [Build Fundamentals](../../build-systems/01-build-fundamentals/interview.md).)
- **Undefined behavior** — that reading freed memory or indexing past an array is UB, which is *why* it can appear to "work" until it doesn't.

If "use-after-free" and "the heap" are fuzzy, read [junior.md](junior.md) first; this page assumes them.

---

## Fundamentals

### Q: What is AddressSanitizer, in one or two sentences?

> **Testing:** Can you define it crisply without hand-waving "it finds memory bugs"?

**A.** ASan is a **compiler-instrumentation + runtime** memory-error detector built into Clang and GCC. You recompile your program with `-fsanitize=address`; the compiler injects checks around every memory access and replaces the allocator, and a runtime library maintains a "shadow" map of which bytes are legal to touch. When the program touches memory it shouldn't, ASan halts it *at the moment of the bad access* and prints a precise report. It's a **dynamic** tool — it only sees bugs on code paths you actually execute — and it's fast enough (~2× slowdown) to run real workloads and fuzzers, which is what distinguishes it from older tools like Valgrind.

### Q: What classes of bug does ASan catch?

> **Testing:** Breadth and the spatial/temporal split.

**A.** Two families. **Spatial** errors (touching the wrong *place*):
- Heap buffer overflow / underflow
- Stack buffer overflow / underflow
- Global buffer overflow

And **temporal** errors (touching the right place at the wrong *time*):
- Heap use-after-free (dangling pointer to freed memory)
- Stack-use-after-return (pointer to a local outliving its function — needs `detect_stack_use_after_return`)
- Stack-use-after-scope (pointer to a variable past its `{}` block)
- Double-free and invalid free (freeing a non-heap or already-freed pointer)
- Memory leaks (via the bundled LeakSanitizer, on by default on Linux)
- `alloc-dealloc-mismatch` (e.g. `new[]` freed with `delete`, or `malloc` freed with `delete`)

The mental split — *spatial = wrong place, temporal = wrong time* — is worth stating explicitly; it maps directly onto the two mechanisms (redzones catch spatial, quarantine+poisoning catches temporal).

### Q: How do you enable ASan?

> **Testing:** Do you know it's a *recompile*, not a runtime wrapper, and the common flags?

**A.** Add the flag to **both compile and link**:

```bash
clang -fsanitize=address -g -O1 -fno-omit-frame-pointer main.c -o app
./app
```

The pieces matter:
- `-fsanitize=address` — turns on the instrumentation pass *and* links the ASan runtime; needed at link time too or you get undefined-symbol errors.
- `-g` — debug info, so the report shows file:line, not just addresses.
- `-O1` (or higher) — keeps it realistic and fast; ASan works at any `-O`.
- `-fno-omit-frame-pointer` — gives clean, complete stack traces in the report.

Then tune behavior at runtime via the `ASAN_OPTIONS` environment variable, e.g. `ASAN_OPTIONS=detect_leaks=1:abort_on_error=1:halt_on_error=0`. The key point versus Valgrind: ASan must be *baked into the build*; you can't sanitize a binary you didn't compile with it.

### Q: Walk me through what an ASan report tells you.

> **Testing:** The single most important practical skill — reading the three stacks.

**A.** A heap-use-after-free report has a one-line verdict and **three** stack traces, and you read them in order:

```
==1234==ERROR: AddressSanitizer: heap-use-after-free on address 0x60200000eff4
  READ of size 4 at 0x60200000eff4 thread T0
    #0 0x4f5a2b in process(int*) main.cpp:18      <-- access stack: where the bad read happened
    #1 0x4f5b10 in main main.cpp:30

0x60200000eff4 is located 0 bytes inside of 8-byte region [0x60200000eff0,0x60200000eff8)
freed by thread T0 here:
    #0 0x4a1c3d in operator delete(void*)
    #1 0x4f5af2 in main main.cpp:28               <-- free stack: where it was freed

previously allocated by thread T0 here:
    #0 0x4a1b2a in operator new(unsigned long)
    #1 0x4f5ad1 in main main.cpp:26               <-- alloc stack: where it was born
```

The verdict line names the **bug class** (`heap-use-after-free`) and whether it was a **READ or WRITE** and the **access size** (4 bytes). Then:
1. **Access stack** — exactly where the illegal access occurred (`main.cpp:18`). This is where the program *crashed*.
2. **Free stack** — where this region was freed (`main.cpp:28`). This is usually where the *fix* lives.
3. **Alloc stack** — where the region was originally allocated (`main.cpp:26`), for context on its lifetime.

The triage move: the access stack tells you the *symptom*, the free and alloc stacks tell you the *lifetime mismatch* that is the actual bug. For an overflow you'd see "N bytes to the right of an M-byte region" plus a shadow-byte legend instead of a free stack.

### Q: What does READ vs WRITE and the access size buy you in a report?

> **Testing:** Whether you actually use the report's details.

**A.** **WRITE** errors are higher priority and easier — a bad write is corrupting something, and the access stack is the corrupting line; you usually fix it right there. **READ** errors mean you consumed bad/freed data, and the bug may be that the data was freed too early (look at the free stack) rather than at the read site. The **size** (`READ of size 4`) confirms the *type* of the access — a `size 8` on a "1-byte overflow" tells you it's a pointer or `double` read straddling the redzone, which narrows down which field. Reading these instead of just eyeballing the first stack frame is what separates someone who's used ASan from someone who's only read about it.

---

## Mechanism

### Q: How does ASan work under the hood?

> **Testing:** The core mechanism — and whether you can connect each piece to a bug class.

**A.** Four cooperating pieces:

1. **Shadow memory (1:8).** ASan reserves a region of virtual address space where *every 8 bytes of application memory maps to 1 shadow byte* recording how many of those 8 bytes are addressable (0 = all good, 1–7 = partially poisoned, negative = fully poisoned/off-limits). Before each memory access, the compiler-injected check computes the shadow address (`shadow = (addr >> 3) + offset`), reads that one byte, and verifies the access is legal. One shadow read per memory access — that's the whole hot path.
2. **Redzones.** The instrumented allocator pads every heap and stack object with poisoned guard regions on both sides. An overflow steps into a redzone, whose shadow byte is poisoned, so the check fires. This is how *spatial* errors are caught.
3. **Quarantine.** When you `free`, ASan doesn't return the memory to the allocator immediately — it poisons the whole region and parks it in a FIFO **quarantine** so the address isn't reused. A later access to that dangling pointer hits poisoned shadow → use-after-free. This is how *temporal* errors are caught.
4. **Malloc replacement.** ASan interposes `malloc`/`free`/`new`/`delete` to insert the redzones, manage the quarantine, and record the alloc/free stack traces it prints in reports.

So: shadow memory is the lookup table, redzones catch overflows, quarantine catches use-after-free, and the replaced allocator is what wires it all together and remembers the stacks.

### Q: What is the shadow scale and offset, and why 1:8?

> **Testing:** Depth — do you know the actual numbers and the alignment reason?

**A.** The **scale is 8** (1 shadow byte per 8 application bytes), encoded as a 3-bit right-shift. The **offset** is a fixed base added after shifting (on x86-64 Linux, `0x7fff8000`), so `shadow_addr = (app_addr >> 3) + 0x7fff8000`. 1:8 is chosen because **malloc returns 8-byte-aligned memory**, so an 8-byte granule lines up with allocation boundaries, and a single shadow byte can encode "0–8 of these bytes are valid" — exactly enough to represent a partially-valid trailing granule (e.g. a 13-byte allocation = one full granule + a granule with shadow value 5). The cost is the 1/8 memory overhead for the shadow itself, which is a big chunk of the ~3× RAM. Smaller scale = finer granularity but more memory; 8 is the sweet spot given malloc alignment.

### Q: Mechanically, how does ASan catch a use-after-free?

> **Testing:** Connecting quarantine + poison to the temporal bug.

**A.** On `free(p)`, ASan (1) **poisons** the shadow for the whole region — sets those shadow bytes to a "heap-freed" magic value — and (2) puts the region into **quarantine** instead of releasing it, so the allocator won't hand that address back out for a while. The pointer `p` is now dangling but still points at the parked, poisoned region. When the buggy code later does `*p`, the injected check reads the shadow byte for that address, sees the freed-poison value, and reports `heap-use-after-free` *at the access site*, while the recorded free stack tells you where it died. Quarantine is what makes this reliable: without it, the allocator might immediately reuse the address for a new object, the shadow would read "valid," and the bug would silently corrupt the new object instead of being caught. Quarantine has finite size, so a use-after-free can be missed if enough allocations cycle the region out — a known coverage limit, tunable via `quarantine_size_mb`.

### Q: Mechanically, how does ASan catch an off-by-one (overflow)?

> **Testing:** Connecting redzones to the spatial bug.

**A.** When the allocator hands you an N-byte buffer, it actually allocates N + redzones and **poisons the shadow for the redzone bytes** flanking your buffer. Your valid region's shadow reads "addressable"; the bytes just past the end read "poisoned." So `buf[N]` (one past the end) computes a shadow address that lands in the right redzone, the check reads a poisoned byte, and ASan reports `heap-buffer-overflow ... 0 bytes to the right of N-byte region`. The redzone is why a single-byte overrun — which on a normal allocator just scribbles on adjacent heap metadata and corrupts "later, somewhere else" — is caught *exactly at the offending access*. Same idea on the stack: the compiler lays out locals with poisoned redzones between them in the stack frame.

### Q: What does ASan cost, and why exactly?

> **Testing:** Whether you can attribute the overhead to the mechanism, not just recite "2×."

**A.** Roughly **2× CPU** and **3× RAM**, sometimes worse on allocation-heavy or pointer-chasing code.
- **CPU (~2×):** every load and store gets an extra shadow-memory lookup and compare before it. That's one extra memory read (often a cache hit on hot shadow) plus a branch per access. Tight pointer-chasing loops feel it most.
- **RAM (~3×):** three contributors stack up — the **shadow region** is 1/8 of the address space ASan reserves, **redzones** inflate every allocation, and the **quarantine** holds freed memory hostage instead of returning it. Plus ASan stores a stack trace per live allocation for reporting.

The number to *say in an interview*: "about 2× slower, about 3× the memory — fine for CI and fuzzing, usually too heavy for unsampled production." Knowing *why* (shadow lookup per access; shadow + redzones + quarantine for RAM) is what makes the answer senior.

---

## Limits & Comparisons

### Q: What does ASan NOT catch?

> **Testing:** The most important limits question — do you know where the boundaries are?

**A.** ASan is an *addressability* checker, so it misses everything that isn't "you touched memory you shouldn't":
- **Data races** → that's [ThreadSanitizer (TSan)](../02-thread-sanitizer-tsan/interview.md). ASan has no concept of the happens-before relation.
- **Uninitialized reads** → that's MemorySanitizer (MSan). The memory is *addressable*, it just holds garbage; ASan only checks addressability, not initialization.
- **Undefined behavior** like signed-integer overflow, misaligned access, invalid enum/bool, null-pointer arithmetic → that's [UBSan](../03-undefined-behavior-sanitizer-ubsan/interview.md).
- **Intra-object overflow** — overrunning one member of a struct into the *next member of the same object*. Both bytes are inside the allocation, so there's no redzone between them; ASan can't see it (the experimental `-fsanitize=address -fsanitize-address-field-padding` helps partially).
- **Bugs on paths you don't execute** — it's dynamic; unexercised code is invisible. This is *the* limitation that drives "pair it with fuzzing."

The clean framing: ASan owns *addressability and lifetime of memory*; races belong to TSan, initialization to MSan, language-level UB to UBSan.

### Q: ASan vs Valgrind (Memcheck) — when each?

> **Testing:** The classic comparison; do you know the real tradeoffs, not just "ASan is faster"?

**A.**

| | **ASan** | **Valgrind/Memcheck** |
|---|---|---|
| How | Compile-time instrumentation | Runtime binary translation (DBI) |
| Recompile needed? | Yes | No — runs any binary |
| Slowdown | ~2× | ~20–50× |
| Uninitialized reads | No (use MSan) | **Yes** |
| Catches in 3rd-party `.so` without source | Limited | Yes |
| Fuzzing-friendly | Yes | Too slow |

**Choose ASan** as the default: it's 10–25× faster, fast enough for CI and fuzzing, and its reports are sharper (exact bug class + three stacks). **Choose Valgrind** when you *can't recompile* (a shipped binary, a closed-source library), or when you specifically need **uninitialized-memory detection** and can't build with MSan (MSan needs *all* code, including libc, instrumented, which is often impractical). The honest one-liner: "ASan for the 95% where I control the build; Valgrind for the binary I can't rebuild or when I need Memcheck's uninitialized-read coverage." A weak answer says "ASan is just better" — Valgrind still wins on no-recompile and uninitialized reads.

### Q: ASan vs HWASan vs GWP-ASan — what's the difference?

> **Testing:** Awareness of the production-oriented variants.

**A.** Three points on a spectrum of overhead-vs-coverage:
- **ASan** — shadow + redzones + quarantine; ~2×/3× overhead; the workhorse for CI and fuzzing. Too heavy for broad production.
- **HWASan (Hardware-assisted ASan)** — uses the CPU's **top-byte-ignore / memory tagging** (ARM64 TBI, MTE) to store a tag in the pointer's unused top bits and a matching tag per memory granule, checked in hardware. Far lower memory overhead (no 1:8 shadow) and small CPU cost, so it can run in **production on supported ARM hardware**. It's probabilistic for some cases (tag collisions) but catches both spatial and temporal bugs.
- **GWP-ASan** — a **sampling** guard-page allocator: it protects a tiny random fraction of allocations with real guard pages, so overhead is *negligible* and it can ship to **end-user devices at fleet scale**. Any single process catches almost nothing, but across millions of devices it surfaces real overflows/use-after-frees in the wild. It's "ASan's coverage philosophy at homeopathic dose."

Mental model: **ASan = find everything on this run, expensively; GWP-ASan = find a little on every run, for free, across the fleet; HWASan = the middle, if you have the hardware.**

### Q: Why can't you build with ASan and TSan at the same time?

> **Testing:** Understanding that both *own* the memory layout and the allocator.

**A.** Both sanitizers fundamentally rewrite how the program sees memory — each maintains its **own shadow memory** at fixed virtual-address regions, **interposes the allocator**, and instruments every memory access for *its* purpose. Their shadow mappings and runtime assumptions conflict; you can't have two tools both claiming "I own the shadow region and the malloc hooks." `-fsanitize=address,thread` is rejected by the compiler. The practical consequence: you run **separate builds** — an ASan build *and* a TSan build — typically as separate CI jobs, because no single binary can answer both "did I touch bad memory?" and "did two threads race?" (ASan *does* combine with UBSan — `-fsanitize=address,undefined` — because UBSan's checks are lightweight and don't fight over shadow memory or the allocator.)

### Q: "ASan only finds bugs on executed paths." What follows from that?

> **Testing:** Whether you understand dynamic analysis's defining limitation and the response to it.

**A.** It means ASan gives you **no coverage guarantee** — a clean ASan run proves only that *the paths you exercised* were memory-clean, not that the program is. A use-after-free behind a rare error branch is invisible until something takes that branch. Three consequences:
1. **Pair it with input generation.** The standard pattern is **ASan + a coverage-guided fuzzer** (libFuzzer, AFL++): the fuzzer mutates inputs to maximize code coverage, ASan turns each new path's latent memory bug into a crash. Fuzzing *finds* paths; ASan *judges* them.
2. **Run it on your real test suite and real workloads**, not a toy harness — coverage of the sanitizer is exactly the coverage of whatever you run under it.
3. **Contrast with static analysis**, which reasons about *all* paths but with false positives and shallower bug-class reach. The two are complementary, not redundant — see [Static Analysis & Linting](../../static-analysis/).

The crisp statement: "ASan's coverage *is* your execution coverage, so its value is bounded by what you run — which is why we run it under a fuzzer."

---

## Practice at Scale

### Q: How do you integrate ASan into CI?

> **Testing:** Practical CI engineering, not just "add the flag."

**A.** A dedicated **sanitizer build + test job**, separate from the normal build:
- A CI matrix entry that configures the build with `-fsanitize=address -g -O1 -fno-omit-frame-pointer` and runs the full test suite against it.
- `ASAN_OPTIONS=halt_on_error=1:abort_on_error=1:detect_leaks=1` plus `ASAN_SYMBOLIZER_PATH` so reports symbolize to file:line.
- **Fail the build on any report** — ASan exits non-zero on error by default; don't swallow it.
- A **suppressions file** in source control for known-unfixable issues (third-party leaks), reviewed like code so it doesn't become a dumping ground.
- Keep it off the default fast PR build if it doubles wall-clock time; run it on every PR if you can afford it, otherwise nightly + pre-merge. The failure cost of *not* catching a use-after-free dwarfs the CI minutes.

The maturity signal: it's a *separate job* with symbolization, leak detection, and a reviewed suppressions file — not a flag bolted onto the existing build that someone silently disabled when it got noisy.

### Q: Gate on *new* bugs or *all* bugs? How do you introduce ASan to a legacy codebase that lights up red?

> **Testing:** Judgment about rolling out a tool without blocking everyone.

**A.** **Gate-on-all** is the goal but unrealistic for a legacy codebase that reports dozens of errors on day one — make it blocking and you've either blocked all merges or trained everyone to ignore it. So:
1. **Baseline** the existing findings into a suppressions file (or a known-issues list) — the current debt, captured.
2. **Gate-on-new**: the CI job fails only on errors *not* in the baseline. New code can't add memory bugs; existing ones are tracked.
3. **Burn down** the baseline deliberately — assign suppressions as tickets, shrink the file over time.
4. Once the baseline is empty, flip to **gate-on-all** and keep it there.

This is the same ratchet pattern used for any quality gate (lint, coverage, type errors): *stop the bleeding first, then heal*. A candidate who says "just turn it on and fix everything" hasn't shipped this to a real team.

### Q: How does ASan pair with fuzzing, concretely?

> **Testing:** The highest-leverage real-world use of ASan.

**A.** They're complementary halves of one technique. A **coverage-guided fuzzer** (libFuzzer, AFL++) generates and mutates inputs to drive the program down new code paths; **ASan is the oracle** that decides whether a path hit a memory bug. You compile the target *once* with both — `-fsanitize=address,fuzzer` for libFuzzer — so each fuzzer-discovered input runs under ASan instrumentation. The fuzzer explores; the moment an input causes an out-of-bounds or use-after-free, ASan crashes with a full report and the fuzzer saves the reproducing input. This is exactly how OSS-Fuzz finds thousands of bugs in open-source C/C++. Without ASan, a fuzzer only catches inputs that cause an *outright* segfault; with ASan, it catches the silent corruptions that would otherwise "work" by luck. See [Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/interview.md).

### Q: Can you run ASan in production? Should you?

> **Testing:** Realism about overhead vs the value of field bugs.

**A.** **Plain ASan, generally no** — 2× CPU and 3× RAM is too much for an always-on production fleet, and its shadow-memory footprint can collide with services that reserve large address ranges. But "find memory bugs in the wild" is valuable, so the production-oriented answers are:
- **GWP-ASan** — sampling guard-page allocator with negligible overhead, shipped to the whole fleet; each process catches little, the fleet catches real bugs. This is how Chrome/Android find field memory bugs.
- **HWASan** — on ARM with memory tagging, cheap enough to run on a fraction of production traffic or on dogfood/beta populations.
- **Canary/sampled ASan** — run a *small percentage* of instances under full ASan (a canary pool), accepting their overhead for high-fidelity reports.

The framing: "Full ASan is a *pre-production* tool; for production you sample — GWP-ASan fleet-wide, HWASan or a canary pool for higher fidelity." Saying "sure, just deploy it everywhere" is a red flag.

### Q: How do suppressions and annotations work, and what's the risk?

> **Testing:** Knowing the escape hatches and that they're load-bearing footguns.

**A.** Two mechanisms:
- **Runtime suppressions** (`ASAN_OPTIONS=suppressions=asan.supp`) — suppress reports matching a function/library, mainly for leaks in code you can't fix (third-party libs). Coarse: it silences a *class* of report.
- **Source annotations** — `__attribute__((no_sanitize("address")))` to exempt a specific function from instrumentation, and the **manual poisoning API** (`ASAN_POISON_MEMORY_REGION` / `ASAN_UNPOISON_MEMORY_REGION`) so a custom allocator can *teach* ASan its own redzones and freed regions.

The risk: every suppression is a permanent blind spot. A function marked `no_sanitize` can harbor any memory bug forever, invisibly. So suppressions belong in version control, get code-reviewed, carry a comment with a ticket, and shrink over time — exactly like any other "ignore this warning" mechanism. The mature instinct is to treat the suppressions file as **tracked debt**, not a quiet place to make red turn green.

### Q: ASan tests are flaky or OOM-killed in CI. How do you handle it?

> **Testing:** Operational debugging of the tool itself.

**A.** Two different problems:
- **OOM**: the 3× RAM blows the container limit. Fixes: raise the job's memory limit (it's a known, expected multiplier); shrink the quarantine (`ASAN_OPTIONS=quarantine_size_mb=64`) and redzones (`redzone=16`) to trade some detection for memory; run fewer tests in parallel so peak RSS is lower; or split the ASan suite into shards.
- **Flakiness**: usually *real* nondeterministic bugs (use-after-free whose detection depends on whether the region cleared quarantine, or a bug on a timing-dependent path) — ASan is exposing a true heisenbug, not being flaky itself. Make detection more deterministic with a bigger quarantine and `detect_stack_use_after_return=1`, capture the reproducing input/seed, and treat the report as a real defect. Genuinely spurious flakiness from ASan itself is rare; assume the bug is real until proven otherwise.

The instinct to convey: ASan "flakiness" is almost always the tool correctly catching a nondeterministic memory bug — investigate before you quarantine the *test*.

---

## Scenario & Debugging

### Q: Here's a `heap-use-after-free` report. Walk me through reading it and finding the fix.

> **Testing:** End-to-end report-driven debugging — the marquee scenario.

**A.** I read the three stacks in order and reconstruct the lifetime:
1. **Verdict line** — `heap-use-after-free`, and it says **READ of size 4** at some address. So I'm *reading* 4 bytes of freed memory; the bug is that the data died before this read.
2. **Access stack** — top frame is the exact `file:line` of the bad read (say `process() at cache.cpp:42`). That's the symptom site.
3. **Free stack** — where the region was freed (`evict() at cache.cpp:88`). This is usually where the real bug is: something freed the object while `process()` still held a pointer.
4. **Alloc stack** — where it was born, for lifetime context.

Now I reason about *ownership*: the access stack and free stack share the object; the bug is a **lifetime mismatch** — `evict()` freed it too early, or `process()` cached a raw pointer it shouldn't have. The fix is one of: extend the owner's lifetime (e.g. hold a `shared_ptr` instead of a raw pointer), null-out and re-check the pointer after free, or reorder so the read happens before the free. I'd confirm by re-running under ASan with `detect_stack_use_after_return=1` and, if it's threaded, suspect a race and switch to a TSan build — because a *racy* free can present as a use-after-free. The discipline: don't patch the access site blindly; the free site is where the lifetime decision went wrong.

### Q: You get a `container-overflow` on a `std::vector`. What is that?

> **Testing:** A subtle, real ASan feature that confuses people.

**A.** It's ASan catching an access that's **within the vector's allocated *capacity* but beyond its current *size*** — i.e. into the slack between `size()` and `capacity()`. libc++ and libstdc++ cooperate with ASan via **container annotations**: they poison the shadow for the `[size, capacity)` region so reading or writing there is flagged, even though that memory is technically inside the heap allocation `malloc` returned. Classic trigger: `vec.reserve(100); memcpy(vec.data(), src, 100);` — you reserved capacity but `size()` is still small, so the bytes past `size()` are poisoned and ASan reports `container-overflow`. It's a *real* bug (you wrote into elements that don't logically exist). The gotcha: container annotations require that **all** code touching that container be built with a consistent ASan/STL configuration; mixing an instrumented TU with a non-instrumented one over the same vector can yield a *spurious* container-overflow — which is why the option exists to disable it. So: real bug if your build is consistent; build-consistency problem if it's mixed.

### Q: A teammate says ASan is reporting a "false positive" in their custom allocator. What's really happening?

> **Testing:** The instinct that ASan false positives are almost always real bugs or under-instrumentation.

**A.** Two real causes, neither a true false positive:
1. **ASan doesn't know the custom allocator's layout.** If they carved objects out of a big slab via `mmap`/`malloc` once and hand out chunks themselves, ASan only knows the *outer* allocation is valid — it has no redzones between their sub-objects and doesn't know when *they* consider a chunk "freed." So a real overflow between two of their objects looks invisible, *or* a legitimately-poisoned access looks confusing. The fix is to **teach ASan** via the manual poisoning API: `ASAN_UNPOISON_MEMORY_REGION` when they hand out a chunk, `ASAN_POISON_MEMORY_REGION` when they reclaim it. Then ASan models their allocator correctly.
2. **Genuinely a bug they don't believe yet** — an overflow or use-after-free in their pool logic that they're attributing to the tool. ASan's spatial/temporal checks don't fire on legal accesses; the prior should be "the tool is right."

The principle to state: **ASan has an extremely low false-positive rate by design** — redzone and quarantine hits correspond to real illegal accesses. A "false positive" is almost always (a) under-instrumentation (custom allocator ASan doesn't know about → poison/unpoison it), (b) a build inconsistency (mixed instrumented/uninstrumented code over the same data, e.g. ODR violations or one-TU-only STL), or (c) a real bug. Reaching for "must be a tool bug" first is the red flag.

### Q: ASan reports a stack-use-after-return, but you swear the variable is in scope. How?

> **Testing:** Understanding a non-default check and pointer escape.

**A.** Stack-use-after-return means a pointer to a **local variable escaped its function** and was dereferenced after that function returned — the local's stack slot was reused, so you're reading another frame's data. Common cause: returning the address of a local, or stashing `&local` into a longer-lived struct/global/callback. It's **not on by default** (it has extra overhead via fake stack frames), so seeing it means someone enabled `detect_stack_use_after_return=1` — and the report is real. The "but it's in scope" intuition is the bug: it's in scope *at the line you wrote*, but the pointer is *used* after the scope ended elsewhere. The access stack shows the late use; trace back to find who captured the local's address. Fix: don't let the local's address escape — return by value, allocate on the heap, or copy into the longer-lived owner.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: One flag to enable ASan?** A: `-fsanitize=address` (at both compile and link).
- **Q: Shadow memory ratio?** A: 1:8 — one shadow byte per eight application bytes.
- **Q: Shadow address formula (x86-64)?** A: `(addr >> 3) + 0x7fff8000`.
- **Q: What catches overflows?** A: Redzones (poisoned guard bytes around each object).
- **Q: What catches use-after-free?** A: Quarantine (delayed reuse) plus poisoning the freed region.
- **Q: Typical overhead?** A: ~2× CPU, ~3× RAM.
- **Q: Does ASan find data races?** A: No — that's TSan.
- **Q: Does ASan find uninitialized reads?** A: No — that's MSan.
- **Q: Can ASan + TSan share one build?** A: No; conflicting shadow + allocator. Separate builds.
- **Q: Can ASan + UBSan share one build?** A: Yes — `-fsanitize=address,undefined`.
- **Q: Does ASan need a recompile?** A: Yes; unlike Valgrind, it's compile-time instrumentation.
- **Q: Where does the *fix* usually live in a UAF report?** A: The free stack (something freed it too early).
- **Q: What is `container-overflow`?** A: An access between a container's `size()` and `capacity()`, via STL annotations.
- **Q: Production-friendly ASan variant?** A: GWP-ASan (sampling) or HWASan (hardware tagging on ARM).
- **Q: Is a stack-use-after-return check on by default?** A: No — needs `detect_stack_use_after_return=1`.
- **Q: Why pair ASan with a fuzzer?** A: The fuzzer finds paths; ASan judges them — it only sees executed code.
- **Q: One env var to know?** A: `ASAN_OPTIONS` (e.g. `detect_leaks=1:halt_on_error=1`).
- **Q: Why `-fno-omit-frame-pointer`?** A: Cleaner, complete stack traces in reports.
- **Q: What's `alloc-dealloc-mismatch`?** A: Freeing with the wrong deallocator, e.g. `new[]` freed by `delete`.
- **Q: Does ASan catch leaks?** A: Yes, via the bundled LeakSanitizer (on by default on Linux).

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- "ASan finds all memory bugs" — no awareness of races (TSan), uninitialized reads (MSan), UB (UBSan), or intra-object overflow.
- Assuming an ASan report is a **false positive** as the first hypothesis.
- Not knowing it requires a **recompile** (confusing it with Valgrind).
- Reading only the *first* stack trace and ignoring the free/alloc stacks.
- "Just run it in production everywhere" — no mention of overhead, sampling, GWP-ASan, or HWASan.
- "Just turn it on and fix everything" for a legacy codebase — no baseline / gate-on-new ratchet.
- Can't explain *why* it costs 2×/3× — recites the number with no mechanism behind it.
- Putting unbounded entries in a suppressions file to make CI green.

**Green flags:**
- Naming the **spatial vs temporal** split and mapping it to **redzones vs quarantine**.
- Stating crisply what ASan **doesn't** own (races → TSan, init → MSan, UB → UBSan).
- Reading a report as **three stacks** and going to the **free stack** for the fix.
- "Pair it with a fuzzer because it only sees executed paths" — unprompted.
- Attributing the 3× RAM to **shadow + redzones + quarantine** specifically.
- Treating a "false positive" as **under-instrumentation or build inconsistency** until proven otherwise.
- Knowing the **production story** is sampling: GWP-ASan fleet-wide, HWASan/canary for fidelity.
- Rolling out via **baseline → gate-on-new → burn down → gate-on-all**.

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| **What it is** | Compile-time instrumentation + runtime that detects memory errors at the access site |
| **Enable** | `-fsanitize=address -g -O1 -fno-omit-frame-pointer` (compile + link) |
| **Spatial bugs** | Heap/stack/global overflow — caught by **redzones** |
| **Temporal bugs** | Use-after-free/return/scope, double-free — caught by **quarantine + poison** |
| **Shadow memory** | 1:8; `shadow = (addr >> 3) + offset` |
| **Cost** | ~2× CPU (shadow check per access), ~3× RAM (shadow + redzones + quarantine) |
| **Report = 3 stacks** | Access (symptom) → Free (usual fix) → Alloc (context) |
| **Doesn't catch** | Races (TSan), uninitialized (MSan), UB (UBSan), intra-object overflow |
| **vs Valgrind** | 10–25× faster, needs recompile; Valgrind catches uninitialized + no recompile |
| **Production** | Sample: GWP-ASan (fleet), HWASan (ARM tagging), canary pool |
| **With fuzzing** | `-fsanitize=address,fuzzer` — fuzzer finds paths, ASan judges them |
| **Combine** | With UBSan yes; with TSan no |
| **Key env var** | `ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:quarantine_size_mb=N` |

---

## Summary

- **ASan is a recompile-based memory-error detector**: compiler instrumentation around every access plus a runtime that maintains shadow memory and replaces the allocator. It catches **spatial** errors (overflows, via redzones) and **temporal** errors (use-after-free/return/scope, double-free, via quarantine + poisoning) — and leaks via bundled LSan.
- **The mechanism explains the cost.** Shadow memory is 1:8 (`(addr>>3)+offset`); one shadow lookup per access gives ~2× CPU; shadow + redzones + quarantine give ~3× RAM. Quarantine is what makes use-after-free reliable; redzones are what make off-by-one exact.
- **Read the report as three stacks** — access (the symptom), free (where the fix usually lives), alloc (context) — plus READ/WRITE and access size. Don't patch the access site blindly.
- **Know the boundaries.** ASan owns addressability and lifetime; **races → TSan, uninitialized → MSan, UB → UBSan, intra-object overflow → nobody (mostly)**. ASan and TSan can't share a build; ASan and UBSan can.
- **It only sees executed paths**, so pair it with a **coverage-guided fuzzer** — the fuzzer finds paths, ASan is the oracle. Versus Valgrind: far faster and sharper, but needs a recompile and doesn't do uninitialized reads.
- **At scale**: a separate CI job with symbolization and a reviewed suppressions file; roll out via baseline → gate-on-new → gate-on-all; production via sampling (GWP-ASan fleet-wide, HWASan/canary for fidelity). A "false positive" is almost always under-instrumentation, a build inconsistency, or a real bug — not a tool error.

---

## Further Reading

- [Clang AddressSanitizer documentation](https://clang.llvm.org/docs/AddressSanitizer.html) — the authoritative reference for flags, `ASAN_OPTIONS`, and report formats.
- [AddressSanitizer: A Fast Address Sanity Checker](https://www.usenix.org/conference/atc12/technical-sessions/presentation/serebryany) (Serebryany et al., USENIX ATC 2012) — the original paper; shadow memory, redzones, and the design rationale.
- [The AddressSanitizer algorithm (wiki)](https://github.com/google/sanitizers/wiki/AddressSanitizerAlgorithm) — concise mechanism writeup with the shadow-byte encoding.
- [GWP-ASan](https://llvm.org/docs/GwpAsan.html) and [HWASan](https://clang.llvm.org/docs/HardwareAssistedAddressSanitizerDesign.html) — the production-oriented variants.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/interview.md) — the sanitizer that owns data races, which ASan can't see.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/interview.md) — language-level UB; combinable with ASan in one build.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/interview.md) — the no-recompile alternative and the leak-detection comparison.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/interview.md) — fuzzing, the technique ASan pairs with to escape the "executed paths only" limit.
- [Static Analysis & Linting](../../static-analysis/) — the all-paths, compile-time complement to dynamic sanitizers.
