# Leak Detection & Valgrind — Professional Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Leak Detection & Valgrind
> *The senior page taught you what Valgrind, LSan, and Massif each measure. This page is about which one you reach for when a 4 a.m. page says "RSS is climbing and the pod will OOM in two hours," when a closed-source SDK you can't recompile is the suspect, and when someone has just made the whole test suite 40× slower by running it all under Valgrind. The mechanics are settled; the judgment is what separates a leak strategy that scales from one that pages you weekly.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The 2020s Default: LSan-in-ASan, Valgrind as Specialist](#core-concept-1--the-2020s-default-lsan-in-asan-valgrind-as-specialist)
5. [Core Concept 2 — The "Still Reachable vs Definitely Lost" Policy Problem](#core-concept-2--the-still-reachable-vs-definitely-lost-policy-problem)
6. [Core Concept 3 — Long-Running Services: Exit-Time Checks Lie, Trends Don't](#core-concept-3--long-running-services-exit-time-checks-lie-trends-dont)
7. [Core Concept 4 — Suppression Hygiene and the Ratchet](#core-concept-4--suppression-hygiene-and-the-ratchet)
8. [Core Concept 5 — CI Cost Reality: Why You Can't Run the Suite Under Valgrind](#core-concept-5--ci-cost-reality-why-you-cant-run-the-suite-under-valgrind)
9. [Core Concept 6 — Custom Allocators, Arenas, and Client Requests](#core-concept-6--custom-allocators-arenas-and-client-requests)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Building a leak- and memory-tooling strategy across a real org — choosing the right tool per constraint, gating the right leak kinds in CI, and hunting leaks in services that never exit cleanly.**

The earlier tiers explained how a tool finds a leak. At the professional level the questions change shape. Nobody asks "what is a leak?"; they ask "do we gate the PR on this still-reachable block, or is it a false alarm?", "the service's RSS grew 400 MB overnight — is that a leak or the LRU cache doing its job?", "the SDK leaks and we can't recompile it — now what?", and "why did the nightly job take six hours?"

The single most important shift since roughly 2018 is this: **AddressSanitizer with LeakSanitizer (LSan) is the default, and Valgrind has become the specialist tool.** ASan/LSan runs at 2× overhead with a CI-friendly story; Valgrind's Memcheck runs at 20–50×. So the modern posture is *LSan-in-ASan as the always-on leak gate*, and Valgrind kept for the three jobs it still wins: opaque binaries you can't recompile, uninitialized-read detection without paying MSan's instrument-the-world tax, and the Massif/Callgrind profilers. This page is about wielding that split with judgment, and about the harder problem underneath leak detection — telling a true leak apart from legitimate growth in a process that never exits.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — how Memcheck's shadow memory works, LSan's root-set scan, the leak categories, Massif/Callgrind basics, suppression-file syntax.
- **Required:** [01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md) — because LSan ships inside ASan and your leak gate rides on it.
- **Helpful:** You've operated a long-running C/C++ (or CGO/JNI) service and watched its RSS over days.
- **Helpful:** You've owned a CI budget and felt the pain of a slow test stage.

---

## Glossary

- **LSan (LeakSanitizer):** the leak detector built into ASan (and available standalone). Scans the root set (registers, stacks, globals) at exit; anything heap-allocated and unreachable is "leaked." Near-zero overhead on top of ASan.
- **Memcheck:** Valgrind's default tool — a binary-instrumentation interpreter that tracks every byte's addressability and definedness. Catches leaks *and* uninitialized reads on unmodified binaries. 20–50× slowdown.
- **MSan (MemorySanitizer):** Clang's uninitialized-read detector. Fast, but requires **every dependency, including libc++, to be instrumented** or it reports false positives — the "instrument the world" tax.
- **Massif:** Valgrind's heap profiler. Snapshots the heap over time and attributes bytes to allocation call stacks — the right tool for "where is the memory *growing*?"
- **Definitely lost / Indirectly lost / Possibly lost / Still reachable:** Memcheck's four leak categories, distinguished by whether a pointer to the block (or its parent) still exists at exit.
- **Soak test:** a long-duration run under representative load used to surface slow leaks and unbounded growth that a short test would miss.
- **Client request:** a Valgrind macro (`VALGRIND_*`) compiled into your code to teach the tool about custom allocators, arenas, or pool boundaries.
- **RSS (Resident Set Size):** the physical memory a process occupies — the number that triggers the OOM killer, and the ground truth for daemon leak hunting.

---

## Core Concept 1 — The 2020s Default: LSan-in-ASan, Valgrind as Specialist

For two decades Valgrind *was* memory debugging on Linux. That era is over for the common case, and pretending otherwise costs you a CI budget. The reason is raw overhead.

| Tool | Typical slowdown | Recompile needed? | CI-as-default? |
|---|---|---|---|
| **ASan + LSan** | ~2× | Yes (`-fsanitize=address`) | **Yes** — fast enough to run per-PR |
| **MSan** | ~3× | Yes, **plus all deps** | Only if you control the full build |
| **Valgrind Memcheck** | **20–50×** | **No** | No — nightly/sharded at best |

The strategic shape that has emerged in mature C/C++ shops:

```
ALWAYS ON  (per-PR CI)        ASan+LSan  →  leak gate + heap-overflow + UAF
SOMETIMES  (per-PR or nightly) MSan/UBSan →  uninit reads / UB, if buildable
NIGHTLY    (representative)    Valgrind   →  uninit-read coverage on the bits
                                            MSan can't see; opaque-binary checks
ON DEMAND  (investigation)    Massif      →  "where is the heap growing?"
                              Callgrind   →  "where is the time going?"
```

**LSan-in-ASan is the always-on leak gate.** Because LSan is essentially free once you're paying for ASan, every test binary you already build with ASan gets leak detection for nothing. That makes "no new definitely-lost leaks" a per-PR invariant you can actually afford.

**Valgrind survives for exactly three jobs**, and naming them sharpens every later decision:

1. **Opaque / third-party binaries you cannot recompile.** A vendor SDK, a closed-source `.so`, a binary you only have in release form — ASan/MSan require source and a rebuild; Memcheck instruments machine code at load time and needs neither.
2. **Uninitialized-read detection without the MSan tax.** MSan is faster than Memcheck but demands that *every* dependency, libc++ included, be MSan-instrumented or it drowns you in false positives. When you can't rebuild the world, Memcheck's `--track-origins=yes` finds uninitialized reads on a stock binary with no instrumented dependencies.
3. **Massif and Callgrind.** ASan has no heap-growth profiler and no call-graph profiler; these Valgrind tools have no real sanitizer equivalent for that specific question.

> **The professional framing:** the question is never "Valgrind or sanitizers?" in the abstract. It's "given *this* constraint — can I recompile? do I need uninit reads? do I need a heap-growth timeline? — which tool is the only one that answers it?" Most days the answer is LSan, already running. The interesting days are when a constraint forces you off the default, and a senior engineer can name *which* constraint and *why*.

---

## Core Concept 2 — The "Still Reachable vs Definitely Lost" Policy Problem

The hardest *policy* question in leak gating isn't how to find leaks — it's deciding which categories should fail a build. Memcheck's four-way taxonomy maps directly onto that decision.

| Category | Meaning at exit | Gate the build? |
|---|---|---|
| **Definitely lost** | No pointer to the block anywhere | **Yes** — unambiguous leak |
| **Indirectly lost** | Only reachable *via* a definitely-lost block | **Yes** — falls out when you fix the parent |
| **Possibly lost** | Only an interior pointer remains | Usually yes; investigate (custom containers create these) |
| **Still reachable** | A live pointer exists at exit; just never freed | **Usually no** — see below |

**Still reachable** is the trap. A block is "still reachable" when a pointer to it survives to program exit — a global cache, a singleton, a one-time init buffer the OS reclaims the instant the process dies. Gating on still-reachable produces a flood of noise: every singleton, every `std::locale` facet, every lazily-initialized global trips it, and none of them is a bug in a process that exits.

So the default policy is **gate on definitely + indirectly lost (and usually possibly lost), but not on still-reachable.** LSan agrees by construction: LSan only reports unreachable blocks, so the still-reachable category effectively doesn't exist in your always-on gate — which is part of why LSan is so much less noisy to run by default.

But here is the senior subtlety that the naive "ignore still-reachable" rule misses:

> **Unbounded growth in "still reachable" across runs is a real leak signal.** A block that's reachable but never freed is fine *once*. A data structure that's reachable but grows without bound — a cache with no eviction, a list you append to forever, a map keyed by request ID that never deletes — is a genuine leak that exit-time leak-check will *never* flag, because at exit every entry is still reachable from the live container.

The tool that catches this is not Memcheck's leak summary. It is **RSS measured over a soak test**, or **Massif showing a monotonically rising heap with no plateau.** "Still reachable but unbounded" is the signature of the most expensive leaks in long-running services, and it is invisible to the very leak check most people rely on.

```bash
# Exit-time leak check sees a clean bill of health here...
# ...but RSS over a soak test tells the truth about unbounded "still reachable" growth:
while true; do
  ps -o rss= -p "$PID"; sleep 60
done | tee rss-soak.log
# A line with positive slope that never plateaus under steady load = a leak,
# regardless of what "definitely lost: 0 bytes" claimed.
```

---

## Core Concept 3 — Long-Running Services: Exit-Time Checks Lie, Trends Don't

Leak detection as taught — LSan and Memcheck both — fires **at process exit.** That model is built for tools and tests that run and terminate. It is the wrong model for a daemon that is *designed never to exit cleanly*, and applying it there produces two failure modes: you get no report at all (the process is killed by the OOM killer or `SIGKILL`, never reaching the exit-time scan), or you get a report dominated by still-reachable globals that tell you nothing.

For services, you replace the exit-time question ("what leaked when we shut down?") with a **trend question** ("is memory growing without bound under steady load?"). Three instruments answer it, in increasing precision:

1. **RSS over time.** The cheapest signal and the one that matches reality, because RSS is what the OOM killer watches. Plot RSS across a soak test at steady QPS. A healthy service climbs, then *plateaus* as caches fill and arenas reach steady state. A leak climbs and never plateaus.
2. **Allocator heap profilers — `jemalloc`/`tcmalloc`.** Both ship sampling heap profilers that attribute live bytes to allocation stacks *in a running process*, with overhead low enough to leave on in production. `jemalloc`'s `prof` (dump via `mallctl`, view with `jeprof`) and tcmalloc's `HEAPPROFILE` answer "which call stack owns the bytes that are growing?" without stopping the service.
3. **`pprof` (Go, and the gperftools format).** For Go services, `runtime/pprof` and `net/http/pprof` give you `inuse_space` heap profiles; the diff between two snapshots taken an hour apart points straight at the growing allocation site. (Go's GC means "leak" usually means "unintended liveness" — a reference you forgot to drop — but the diagnostic is the same heap-diff.)

```bash
# jemalloc in a running C/C++ service: dump and attribute live heap
MALLOC_CONF=prof:true,prof_prefix:/tmp/jeprof ./service &
# ... let it run under load, then dump:
jeprof --show_bytes --pdf ./service /tmp/jeprof.*.heap > heap.pdf

# Go service: diff two heap snapshots an hour apart
go tool pprof -base heap_t0.pb.gz heap_t1.pb.gz   # what GREW, not what's live
```

> **The discipline:** for anything that runs longer than a test, **do not rely on exit-time leak checks.** They either never fire or report noise. Measure RSS over a soak test for the yes/no, then use a live heap profiler (jemalloc/tcmalloc/pprof) for the where. Valgrind/LSan stay in the *test* lane — short-lived binaries and integration tests that exit — not the *production daemon* lane.

The corollary is the single most common false alarm in this whole topic: **distinguishing a true leak from legitimate caching or arena growth.** A growing RSS is *not* proof of a leak. An LRU cache filling to its configured ceiling grows then plateaus. A slab/arena allocator (jemalloc, tcmalloc) holds freed memory in thread caches and only returns it to the OS lazily, so RSS can stay high after memory is logically freed. The test that separates leak from caching is **does it plateau under bounded, steady load?** If RSS rises and flattens, that's a cache or an arena. If it rises forever, that's a leak.

---

## Core Concept 4 — Suppression Hygiene and the Ratchet

No real codebase runs leak tooling with zero suppressions. libc has benign one-time allocations; GPU and graphics drivers leak by design at first use; frameworks (GLib, Qt, Python's interpreter, OpenSSL's one-time init) allocate globals they never free. Without suppressions your report is unreadable and your gate is permanently red. With *careless* suppressions your gate is permanently green and useless. Managing the suppression file is therefore a core part of the strategy, not an afterthought.

Both ecosystems support suppression files. Memcheck uses `--suppressions=foo.supp` (and `--gen-suppressions=all` to print stanzas you can paste); LSan/ASan use `LSAN_OPTIONS=suppressions=lsan.supp` with a simpler `leak:<substring>` syntax.

```
# lsan.supp — narrow, attributed, and dated
# False positive: NVIDIA driver one-time init, confirmed benign 2026-02, ticket QE-1841
leak:libcuda.so
leak:_dl_init                      # glibc dynamic-loader one-time alloc
```

The three rules that keep a suppression file honest:

1. **Narrow, never broad.** `leak:libcuda.so` suppresses the driver. `leak:malloc` suppresses *every leak in the program* — it is a loaded gun pointed at your own gate. The danger of an over-broad suppression is that it silently hides a *real* leak that happens to pass through the suppressed frame. Match the most specific frame that identifies the false positive, not a generic allocator at the bottom of every stack.
2. **Attribute and date every entry.** A suppression with no comment is a mystery in eighteen months. Record *why* it's benign, *who* confirmed it, *when*, and the ticket. Suppressions are technical debt with a half-life; an un-attributed one never gets removed because nobody dares.
3. **Ratchet, don't accumulate.** The "suppression ratchet" is the discipline of treating the file as a count that must only go *down*. Adding a suppression to unblock a release is sometimes legitimate, but it creates a ticket to investigate and remove it. Without the ratchet, suppression files grow monotonically until they suppress the very class of bug you bought the tool to find.

> **The failure mode to fear most:** an over-broad suppression added under deadline pressure ("just make CI green for the release") that masks a real, growing leak for months. The leak is invisible in CI — suppressed — and only surfaces as production OOMs. Every suppression you add widens the blind spot; keep them narrow, attributed, and on a ratchet, and audit the file periodically by *removing* a suppression and seeing whether anything actually fires.

---

## Core Concept 5 — CI Cost Reality: Why You Can't Run the Suite Under Valgrind

The most common self-inflicted CI wound in C/C++ shops is someone wiring the *entire* test suite to run under Valgrind. The arithmetic is unforgiving: a suite that takes 10 minutes natively takes **3.5 to 8 hours** under Memcheck's 20–50×. That doesn't just slow the pipeline; it blows past runner timeouts, balloons cost, and trains everyone to ignore the stage.

The resolution is to stop treating Valgrind like a gate and start treating it like a *sampling instrument*:

| Strategy | What it means | When |
|---|---|---|
| **LSan-in-ASan per PR** | The always-on leak gate; ~2× is affordable | Every PR — this is your fast feedback |
| **Sample / shard Valgrind** | Run Memcheck on a *representative subset* of tests, or shard across runners | Nightly, not per-PR |
| **Representative workload** | One realistic end-to-end run under Valgrind, not the unit suite | Nightly — covers integration paths LSan's unit tests miss |
| **Targeted Valgrind** | Run Memcheck only on the test(s) touching code under investigation | On demand, during a bug hunt |

The principle is **per-PR you pay for ASan/LSan's 2×; the 20–50× Valgrind run is nightly, sharded, and aimed at a representative subset** — never the whole suite, never per-PR. You're not trying to run every test under Valgrind; you're trying to run *enough* representative code under it, often enough, to catch the uninitialized-read class that your faster per-PR sanitizers don't cover, without holding every PR hostage to a multi-hour stage.

```yaml
# CI shape that scales
on_pull_request:
  - build --sanitizer=address       # ASan+LSan, ~2x, the leak gate — every PR
on_nightly:
  - valgrind --tool=memcheck --error-exitcode=1 \
      --leak-check=full ./representative_e2e_test   # ONE realistic run, not the suite
  - valgrind --tool=massif ./service --soak=30m     # heap-growth trend, nightly
```

> **The reality check:** if your Valgrind stage takes hours, you've made a scoping mistake, not a tooling mistake. The fix is never "make Valgrind faster" (you can't, much); it's "run less *under* Valgrind — a representative subset, nightly — and let LSan carry the per-PR gate."

---

## Core Concept 6 — Custom Allocators, Arenas, and Client Requests

Both Memcheck and LSan understand the standard allocator: `malloc`/`free`, `new`/`delete`. They do **not** automatically understand a custom allocator — an arena, a memory pool, a slab, a bump allocator — that grabs one big slab from the OS and hands out sub-chunks itself. To the tool, the program made one giant `malloc` and never freed any of the objects carved out of it: every pool object looks like a leak, or no object's misuse is ever caught, depending on the failure.

This is where **Valgrind client requests** earn their keep. You compile annotation macros into your allocator so Valgrind sees the *logical* allocations, not just the one slab:

```c
#include <valgrind/memcheck.h>

void *arena_alloc(Arena *a, size_t n) {
    void *p = bump(a, n);
    VALGRIND_MALLOCLIKE_BLOCK(p, n, /*redzone*/0, /*is_zeroed*/0);
    return p;                       // now Memcheck tracks p as its own block
}
void arena_free_obj(void *p, size_t n) {
    VALGRIND_FREELIKE_BLOCK(p, 0);  // now use-after-free in the arena is caught
}
// Mark a whole arena's backing store as inaccessible between epochs:
VALGRIND_MAKE_MEM_NOACCESS(arena->base, arena->size);
```

The sanitizer world has the parallel mechanism: ASan's `__asan_poison_memory_region` / `__asan_unpoison_memory_region` (and the container-overflow annotations) teach ASan about pool boundaries so it can catch overflows *within* a slab it would otherwise treat as one valid block.

> **The arena pitfall in practice:** a team adopts a custom arena allocator for performance, and *all* their leak tooling goes quiet — not because they fixed their leaks, but because every object now lives inside an opaque slab the tool can't see into. They've traded a noisy-but-honest report for a silent-and-blind one. The fix is annotation: `VALGRIND_MALLOCLIKE_BLOCK` / `MAKE_MEM_NOACCESS` for Memcheck, `__asan_(un)poison_memory_region` for ASan, so the tool tracks logical allocations and arena boundaries. If you write a custom allocator, you *own* the annotations — otherwise you've disabled your memory tooling without telling anyone.

---

## War Stories

**The "leak" that was an unbounded cache.** A pricing service grew RSS ~300 MB/day and OOM-killed every few days. The team ran the integration tests under Valgrind for a weekend; Memcheck reported "definitely lost: 0 bytes" and a wall of still-reachable globals — a clean bill of health that contradicted the OOMs. The exit-time leak check was structurally blind here: every leaked entry was still reachable from a live `std::unordered_map`. **Massif** told the truth in twenty minutes — a single allocation stack growing linearly with no plateau, attributed to a per-symbol cache keyed by request ID that *never evicted*. It wasn't "lost" memory; it was unbounded *reachable* memory. The fix was an LRU bound. The lesson: for growth in a long-running service, reach for the heap-growth profiler (Massif/jemalloc), not the leak check — "definitely lost: 0" can sit right next to a fatal leak.

**The closed-source SDK only Valgrind could pin.** A media pipeline leaked, and the suspect was a vendor's proprietary codec `.so` shipped binary-only. ASan and MSan were off the table — both need source and a rebuild, and the team had neither for the SDK. **Memcheck**, which instruments machine code at load time, ran the unmodified binary and pinned the leak to an allocation stack *inside the vendor library* across the FFI boundary. That stack trace was the entire bug report that got the vendor to ship a fix. No source-based tool could have produced it. This is Valgrind's irreplaceable niche: the binary you can't recompile.

**The uninitialized-read heisenbug ASan missed.** An intermittent wrong-answer bug — correct outputs most of the time, garbage ~1 in 50 runs — survived a full ASan pass clean, because ASan does not detect *uninitialized reads* (that's MSan's job). MSan was impractical: the code linked several third-party libraries that weren't MSan-instrumented, so MSan reported a swamp of false positives from libc++ and the deps. **Valgrind Memcheck with `--track-origins=yes`** found it on the stock binary with no instrumented dependencies: a struct field read before assignment on one branch, and `--track-origins` printed the exact allocation site of the uninitialized bytes. That origin line turned a week of bisection into a one-line fix. The lesson: ASan and uninitialized-reads are different tools; when you can't rebuild the world for MSan, Memcheck is the fallback that needs nothing instrumented.

**The CI that timed out under Valgrind.** A well-meaning engineer added `valgrind --leak-check=full` to wrap the *entire* unit suite "to be thorough." The 9-minute suite became a ~6-hour job that blew the runner's timeout; the stage went permanently red, everyone learned to ignore it, and it was disabled within a week — leaving *less* coverage than before. The rescue was rescoping: LSan-in-ASan as the per-PR leak gate (fast), plus a *nightly* Valgrind run over a single representative end-to-end test (not the unit suite) for uninitialized-read coverage. Same protection, a stage that finishes in minutes per PR and under an hour nightly. The lesson: Valgrind's overhead makes "run everything under it" an anti-pattern — sample and shard, never blanket.

---

## Decision Frameworks

**ASan/LSan vs Valgrind vs MSan — pick by constraint:**

| Your constraint | Use | Why |
|---|---|---|
| Per-PR leak/UAF/overflow gate, can recompile | **ASan + LSan** | ~2×, CI-friendly, free leak check on top of ASan |
| Can't recompile the binary (vendor `.so`, release-only) | **Valgrind Memcheck** | Instruments machine code; needs no source |
| Need uninitialized-read detection, *can* rebuild everything | **MSan** | ~3×, faster than Memcheck — but requires all deps instrumented |
| Need uninitialized-read detection, *can't* rebuild deps | **Valgrind `--track-origins`** | Works on stock binaries, no instrumented deps needed |
| Heap *growth* over time ("where is it growing?") | **Massif** / jemalloc / tcmalloc | Sanitizers have no heap-growth timeline |
| CPU hot-path / call-graph | **Callgrind** (or perf) | Not a leak tool, but the other reason Valgrind stays installed |

**Which Valgrind tool for which question:**

| Question | Tool |
|---|---|
| "What leaked / is anything uninitialized?" | Memcheck (`--leak-check=full`, `--track-origins=yes`) |
| "Where is the heap *growing* over time?" | Massif (`--tool=massif`, view with `ms_print`/massif-visualizer) |
| "Where is the CPU time / which calls dominate?" | Callgrind (`--tool=callgrind`, view with KCachegrind) |
| "Is there a data race?" | Helgrind/DRD — but prefer **TSan** (far faster); see [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/professional.md) |

**Leak in a long-running service — leak-check vs RSS-trend vs heap-profiler:**

| Situation | Instrument | Why not the others |
|---|---|---|
| Service never exits cleanly (OOM-killed) | **RSS over soak test** | Exit-time leak check never fires |
| RSS rises — leak or cache? | **RSS plateau test** | Plateau ⇒ cache/arena; no-plateau ⇒ leak |
| Confirmed growth, need the call stack | **jemalloc/tcmalloc prof, or `pprof` diff** | Live, low-overhead, attributes growing bytes |
| Short-lived test or tool that exits | **LSan (in ASan)** | Cheapest, already running; here exit-time *is* the right model |

**Gate on which leak kinds:**

| Leak kind | Per-PR gate? | Notes |
|---|---|---|
| Definitely lost | **Yes** | Unambiguous |
| Indirectly lost | **Yes** | Disappears when you fix the parent |
| Possibly lost | Usually yes | Investigate; custom containers create these |
| Still reachable (single) | **No** | OS reclaims at exit; LSan ignores by design |
| Still reachable, **unbounded across runs** | **Yes — via RSS/Massif** | The expensive class; invisible to leak-check, caught by trend |

---

## Mental Models

- **LSan is the default; Valgrind is the specialist's scalpel.** Reach for LSan-in-ASan by reflex (it's already running at 2×). Reach for Valgrind only when a named constraint forces you off the default: can't recompile, need uninit reads without the MSan tax, or need Massif/Callgrind.

- **Exit-time leak checks answer a question daemons don't ask.** "What leaked when we exited?" is meaningless for a process designed never to exit. Swap it for "is memory growing without bound under steady load?" — and answer that with RSS trends and live heap profilers, not LSan.

- **A growing RSS is a question, not an answer.** Caches fill and plateau; arenas hold freed memory lazily; leaks rise forever. The discriminator is *plateau under bounded load*, not the slope at any single moment.

- **"Still reachable" is usually noise, but *unbounded* still-reachable is the most expensive leak there is.** It's reachable, so leak-check stays silent; it grows forever, so it OOMs production. Only a trend (RSS/Massif) sees it.

- **Every suppression widens a blind spot.** A narrow, dated, attributed suppression of a driver false positive is hygiene. A broad `leak:malloc` is a disabled detector. Ratchet the count down; never let it climb unexamined.

- **A custom allocator silences your tooling unless you annotate it.** The quiet after adopting an arena isn't "no leaks" — it's "the tool can't see inside the slab." Owning the allocator means owning the `MALLOCLIKE_BLOCK` / `poison` annotations.

---

## Common Mistakes

1. **Running the whole test suite under Valgrind.** 20–50× turns a 10-minute suite into hours, blows runner timeouts, and gets the stage ignored or disabled. LSan-in-ASan is the per-PR gate; Valgrind is nightly, sampled, on a representative subset.

2. **Trusting exit-time leak checks for a long-running service.** A daemon that's OOM-killed never reaches the exit-time scan, and when it does, still-reachable globals bury the signal. Measure RSS over a soak test and profile the live heap (jemalloc/tcmalloc/pprof) instead.

3. **Treating any RSS growth as a leak.** Caches and arenas grow then *plateau*; jemalloc/tcmalloc hold freed memory before returning it to the OS. Test for the plateau under bounded load before declaring a leak — or you'll "fix" a cache.

4. **Gating on still-reachable.** It floods you with singletons and one-time globals the OS reclaims anyway. Gate on definitely/indirectly lost. But watch for *unbounded* still-reachable across runs — that real leak hides from leak-check and needs a trend to catch.

5. **Broad suppressions added under deadline pressure.** `leak:malloc` or an un-attributed stanza silently masks real, growing leaks for months until production OOMs. Keep suppressions narrow, dated, attributed, on a ratchet — and audit by removing them.

6. **Forgetting MSan's instrument-the-world tax.** Reaching for MSan when your dependencies (libc++, third-party `.so`s) aren't MSan-built yields a swamp of false positives. If you can't rebuild the world, Memcheck `--track-origins` is the uninitialized-read tool that needs nothing instrumented.

7. **Adopting a custom allocator and assuming the tools still work.** Arenas and pools make every object live inside one opaque slab; the tool sees one `malloc` and no frees. Annotate with `VALGRIND_MALLOCLIKE_BLOCK` / `__asan_poison_memory_region`, or you've blinded your memory tooling.

---

## Test Yourself

1. It's 2026 and a teammate proposes wiring the full C++ unit suite to run under Valgrind Memcheck "for thoroughness." Why is this the wrong default, and what's the right per-PR vs nightly split?
2. Name the three jobs for which Valgrind is still the right tool over ASan/LSan/MSan, and the constraint behind each.
3. A service's exit-time leak check reports "definitely lost: 0 bytes," yet it OOM-kills every two days. Explain how both can be true, and which tool actually finds the problem.
4. Your service's RSS climbs 200 MB over an hour under load. What single test tells you whether it's a leak or a legitimate cache/arena, and why?
5. Why does the standard policy gate on definitely/indirectly lost but *not* still-reachable — and what is the one still-reachable situation that *is* a real leak?
6. You have an uninitialized-read heisenbug. ASan ran clean. MSan reports hundreds of errors from libc++. What do you reach for and which flag, and why does it succeed where MSan stumbled?
7. A team adopts a bump/arena allocator and all leak reports go silent. Why, and what must they add to restore visibility — for both Valgrind and ASan?

<details>
<summary>Answers</summary>

1. Memcheck's 20–50× slowdown turns a ~10-minute suite into 3.5–8 hours, blowing runner timeouts and training everyone to ignore the stage. **Right split:** ASan+LSan (~2×) as the **per-PR** leak gate; a **nightly**, sharded Valgrind run over a *representative subset* (often one end-to-end test, not the unit suite) for the uninitialized-read coverage the faster sanitizers don't provide.
2. (a) **Opaque/third-party binaries you can't recompile** — Memcheck instruments machine code and needs no source. (b) **Uninitialized-read detection without MSan's tax** — `--track-origins` works on stock binaries with no instrumented dependencies, whereas MSan needs every dep (libc++ included) instrumented. (c) **Massif/Callgrind profiling** — heap-growth and call-graph timelines that sanitizers don't provide.
3. "Definitely lost: 0" only means nothing is *unreachable*. An unbounded but still-*reachable* structure (a cache with no eviction, a never-cleared map) keeps every entry reachable from a live container at exit, so leak-check stays silent while RSS grows without bound. **Massif** (or jemalloc/tcmalloc heap profiling) finds it — a monotonically rising allocation stack with no plateau.
4. A **plateau test under bounded, steady load.** If RSS rises and then flattens, it's a cache filling to its ceiling or an arena reaching steady state (allocators also hold freed memory lazily before returning it to the OS). If it rises and never plateaus, it's a leak. The slope at a single moment can't distinguish them; the plateau behavior over time can.
5. Still-reachable blocks have a live pointer at exit and are reclaimed by the OS instantly when the process dies — gating on them floods you with benign singletons and one-time globals. **The exception:** still-reachable memory that grows *without bound across runs/over time* (unbounded cache, ever-growing list) is a genuine leak — invisible to exit-time leak-check, caught only by an RSS/Massif trend.
6. **Valgrind Memcheck with `--track-origins=yes`.** ASan doesn't detect uninitialized reads at all; MSan does but requires *every* dependency instrumented or it reports false positives (the libc++ swamp). Memcheck runs on the unmodified binary with no instrumented deps and `--track-origins` prints the allocation site of the uninitialized bytes — turning bisection into a one-line fix.
7. A bump/arena allocator grabs one big slab and sub-allocates internally, so the tool sees a single `malloc` and no per-object frees — every object is invisible inside an opaque block. **Restore visibility:** for Valgrind, `VALGRIND_MALLOCLIKE_BLOCK`/`VALGRIND_FREELIKE_BLOCK` and `VALGRIND_MAKE_MEM_NOACCESS` on arena boundaries; for ASan, `__asan_poison_memory_region`/`__asan_unpoison_memory_region` (and container-overflow annotations). If you own the allocator, you own these annotations.

</details>

---

## Cheat Sheet

```
THE 2020s DEFAULT
  ASan + LSan   ~2x    per-PR leak gate (LSan ships in ASan, ~free)
  MSan          ~3x    uninit reads — BUT needs all deps instrumented
  Valgrind      20-50x specialist: can't-recompile / uninit-no-MSan / Massif

WHEN VALGRIND (and only then)
  1. opaque/3rd-party binary you can't rebuild   → Memcheck (instruments machine code)
  2. uninit reads without MSan's instrument-the-world tax → --track-origins=yes
  3. heap-growth (Massif) or call-graph (Callgrind) profiling

LEAK CATEGORIES — GATE ON?
  definitely lost     YES
  indirectly lost     YES
  possibly lost       usually YES (investigate)
  still reachable     NO  (OS reclaims at exit; LSan ignores it)
  still reachable + UNBOUNDED across runs → YES, but only RSS/Massif sees it

LONG-RUNNING SERVICE (exit-time checks LIE)
  ps -o rss= -p $PID; sleep 60   → RSS trend; plateau=cache, no-plateau=leak
  MALLOC_CONF=prof:true ./svc; jeprof ...    → jemalloc live heap by stack
  go tool pprof -base t0 t1                   → what GREW between snapshots

SUPPRESSIONS (ratchet down, never up)
  valgrind --suppressions=x.supp --gen-suppressions=all
  LSAN_OPTIONS=suppressions=lsan.supp   # syntax: leak:<substring>
  RULE: narrow frame, dated, attributed, ticketed.  NEVER leak:malloc.

CUSTOM ALLOCATOR (or tooling goes blind)
  VALGRIND_MALLOCLIKE_BLOCK / FREELIKE_BLOCK / MAKE_MEM_NOACCESS
  __asan_poison_memory_region / __asan_unpoison_memory_region

CI SHAPE
  per-PR : ASan+LSan (fast gate)
  nightly: valgrind memcheck on ONE representative e2e test (not the suite)
           valgrind massif on a soak run (heap-growth trend)
```

---

## Summary

- **The default is LSan-in-ASan; Valgrind is the specialist.** ASan+LSan runs at ~2× and is your always-on per-PR leak gate. Valgrind's 20–50× confines it to three jobs: binaries you can't recompile, uninitialized-read detection without MSan's instrument-the-world tax, and Massif/Callgrind profiling.
- **Gate on definitely/indirectly lost, not still-reachable** — LSan agrees by construction. But **unbounded still-reachable growth across runs is a real, expensive leak** that exit-time leak-check never flags; catch it with an RSS or Massif trend.
- **For long-running services, exit-time checks lie.** A daemon that's OOM-killed never reaches the scan, and still-reachable globals bury the signal. Replace "what leaked at exit?" with "is memory growing without bound under steady load?" — RSS over a soak test for yes/no, jemalloc/tcmalloc/`pprof` for the where.
- **A growing RSS is a question, not an answer.** Caches and arenas grow then *plateau*; allocators hold freed memory lazily. The discriminator is plateau under bounded load — otherwise you'll "fix" a cache.
- **Suppressions are technical debt with a half-life.** Keep them narrow, dated, attributed, and on a ratchet that only goes down; a broad suppression added under deadline pressure masks real leaks until production OOMs.
- **Never run the whole suite under Valgrind.** Sample and shard a representative subset nightly; let LSan carry the per-PR gate. If your Valgrind stage takes hours, that's a scoping mistake, not a tooling one.
- **A custom allocator silences your tooling until you annotate it** with `VALGRIND_MALLOCLIKE_BLOCK`/`MAKE_MEM_NOACCESS` (Valgrind) or `__asan_(un)poison_memory_region` (ASan).

You can now build and defend a leak-tooling strategy across an org — the right tool per constraint, the right leak kinds gated, and trend-based hunting for the services that never exit. The next tier, [interview.md](interview.md), distills the topic into the questions that reveal whether someone actually grasps the LSan-default-Valgrind-specialist split and the long-running-service trap.

---

## Further Reading

- [Valgrind User Manual — Memcheck](https://valgrind.org/docs/manual/mc-manual.html) — leak categories, `--track-origins`, suppression syntax, and client requests, from the source.
- [Massif: the heap profiler](https://valgrind.org/docs/manual/ms-manual.html) — heap-growth-over-time, `ms_print`, and reading snapshots; the right tool for "where is it growing?"
- [jemalloc heap profiling (`prof`/`jeprof`)](https://github.com/jemalloc/jemalloc/wiki/Use-Case:-Heap-Profiling) — live, low-overhead attribution of growing bytes in a running service.
- [gperftools / tcmalloc heap profiler](https://gperftools.github.io/gperftools/heapprofile.html) — the `HEAPPROFILE` workflow and `pprof` output format.
- [LeakSanitizer documentation](https://github.com/google/sanitizers/wiki/AddressSanitizerLeakSanitizer) — the standalone/in-ASan leak detector, suppression format, and why it ignores still-reachable.
- [MemorySanitizer documentation](https://github.com/google/sanitizers/wiki/MemorySanitizer) — the uninitialized-read detector and the "instrument all dependencies" requirement that defines its tax.
- [interview.md](interview.md) — the same material as the questions that probe whether someone truly understands the strategy.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md) — LSan ships inside ASan; your always-on leak gate is the same build flag.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/professional.md) — the faster successor to Valgrind's Helgrind/DRD for the data-race question.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md) — fuzzing under sanitizers, where leak gates and uninit-read detection compound.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/professional.md) — the cheaper in-process checks that catch some bugs before a sanitizer or Valgrind run does.
- [Performance](../../performance/) — Massif, allocation profiling, and the heap-growth trends that distinguish a leak from a cache live here too.
