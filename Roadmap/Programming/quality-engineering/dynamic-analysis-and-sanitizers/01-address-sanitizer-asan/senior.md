# AddressSanitizer (ASan) — Senior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → AddressSanitizer (ASan)
> *The middle page showed you how to turn it on and read a stack trace. This page is about the machinery: the 1:8 shadow map and the exact comparison every load and store now executes, why a struct-internal overflow slips past it, when to spend memory on HWASan or MTE instead, and how to run a sanitizer as a production oracle rather than a debug toy.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Shadow Memory and the 1:8 Mapping](#core-concept-1--shadow-memory-and-the-18-mapping)
5. [Core Concept 2 — The Instrumented Check, Fast Path and Slow Path](#core-concept-2--the-instrumented-check-fast-path-and-slow-path)
6. [Core Concept 3 — Redzones, the Allocator, and Quarantine](#core-concept-3--redzones-the-allocator-and-quarantine)
7. [Core Concept 4 — Stack, Globals, Use-After-Return, Use-After-Scope](#core-concept-4--stack-globals-use-after-return-use-after-scope)
8. [Core Concept 5 — Interceptors and the Intra-Object Blind Spot](#core-concept-5--interceptors-and-the-intra-object-blind-spot)
9. [Core Concept 6 — What ASan Does NOT Catch](#core-concept-6--what-asan-does-not-catch)
10. [Core Concept 7 — ASan vs Valgrind vs HWASan vs GWP-ASan vs KASAN](#core-concept-7--asan-vs-valgrind-vs-hwasan-vs-gwp-asan-vs-kasan)
11. [Core Concept 8 — Performance Engineering and Production Strategy](#core-concept-8--performance-engineering-and-production-strategy)
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

> Focus: **The mechanism behind ASan and the trade-offs a senior engineer reasons about when deciding where, when, and which sanitizer to run.**

By the middle level you can compile with `-fsanitize=address`, read a heap-buffer-overflow report, and find the bug. That makes you effective in a debugging session. The senior jump is different: you now reason about the *mechanism* and make *policy*. You know that every load and store in an ASan build became a shadow-memory lookup plus a compare-and-branch, and you can predict the ~2× slowdown and ~3× memory blow-up that follows. You know *why* a buffer overflow that stays inside a `struct`'s own fields is invisible to ASan, and you can decide whether `-fsanitize-address-field-padding` is worth the ABI cost. You know that ASan, TSan, and MSan can't share a process, that libFuzzer links the ASan runtime and uses it as its *oracle*, and that for production you reach for HWASan, ARM MTE, or GWP-ASan instead.

Each of those is a decision with second-order effects on test wall-time, memory ceilings, false-negative windows, and what classes of bug you'll actually catch before a customer does. To choose well you have to understand the artifact at the byte level — the shadow map, the redzone encoding, the quarantine — because that is where both the detection power and the cost physically live. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — how to enable ASan, the common bug classes (heap/stack/global overflow, use-after-free, leaks), and how to read a basic report.
- **Required:** A working memory of virtual memory — pages, `mmap`, address-space layout, and why a process has a huge sparse address range it never touches.
- **Helpful:** You've read a disassembly and can picture what "the compiler inserts a check before this load" means at the instruction level.
- **Helpful:** You've shipped a C/C++ service and felt the gap between "passes tests" and "is memory-safe under real input."

---

## Glossary

| Term | Meaning |
|---|---|
| **Shadow memory** | A compact side table where each byte encodes the addressability of 8 bytes of application memory (1:8). |
| **Shadow scale / offset** | The shift (3 → ÷8) and base (`0x7fff8000` on x86-64 Linux) that map an app address to its shadow byte. |
| **Redzone** | Poisoned padding inserted around every allocation so an off-by-one read/write lands in poisoned memory and is caught. |
| **Poison** | Marking shadow bytes non-zero so any access to the corresponding app bytes triggers a report. |
| **Quarantine** | A FIFO of recently freed chunks held back from reuse so use-after-free has a window to be detected. |
| **Fake stack** | A heap-allocated stand-in for a function's stack frame, enabling use-after-return detection. |
| **Interceptor** | An ASan replacement for a libc function (`memcpy`, `strlen`, …) that bounds-checks its arguments. |
| **HWASan** | Hardware-assisted ASan: tags pointers and memory with a top-byte tag; uses Top-Byte-Ignore / MTE. |
| **MTE** | ARMv8.5 Memory Tagging Extension — hardware that tags memory granules and checks pointer tags on access. |
| **GWP-ASan** | A sampling, production-grade allocator-level detector that catches a small fraction of bugs very cheaply. |
| **KASAN** | The Linux kernel port of ASan, used to find memory bugs in kernel code. |
| **`ASAN_OPTIONS`** | The runtime environment variable that tunes the ASan runtime (quarantine, redzone, logging, limits). |

---

## Core Concept 1 — Shadow Memory and the 1:8 Mapping

ASan's central idea is **shadow memory**: a parallel region where every *byte* of shadow describes the addressability of *8 bytes* of application memory. That 1:8 ratio is the whole design in one number — it costs 1/8 of the address space to track, which is why an ASan build's memory grows by roughly that plus redzones (in practice ~2–3×).

The mapping from an application address to its shadow byte is pure arithmetic, no lookup table:

```
shadow_addr = (app_addr >> 3) + offset
```

The `>> 3` is the **shadow scale** (8 = 2³). The `offset` is the **shadow offset**, a fixed constant per platform — `0x7fff8000` on Linux x86-64, `0x100000000000 >> 3` style constants elsewhere. The runtime `mmap`s the shadow region at that offset at startup and maps a "shadow gap" as `PROT_NONE` so the shadow of the shadow can never be touched.

The encoding of each shadow byte is the clever part. For an 8-byte aligned granule:

- **`0x00`** — all 8 bytes are addressable (fully accessible).
- **`0x01`–`0x07`** — exactly *n* leading bytes are addressable; the rest are poisoned. This is the **partial / n-addressable** encoding, and it exists because allocations aren't always multiples of 8. A 13-byte buffer is one full granule (`0x00`) followed by a partial granule holding `0x05` (five bytes good, three poisoned).
- **Negative values (`0x80`–`0xff`)** — fully poisoned, with the specific value naming *why*: `0xfa` left redzone, `0xfb` right redzone, `0xfd` freed heap (`heap-use-after-free`), `0xf1` stack left redzone, `0xf2` stack mid, `0xf3` stack right, `0xf5` stack-use-after-return, `0xf8` stack-use-after-scope, `0xfc` (`heap-after-free`), `0xf9` global redzone.

```bash
# x86-64 Linux defaults
echo 'Scale=3 (>>3, 1 shadow byte per 8 app bytes)'
echo 'Offset=0x7fff8000'
# So: shadow of 0x602000000010  →  (0x602000000010 >> 3) + 0x7fff8000
```

> **Key insight:** The 1:8 ratio and the n-addressable encoding are the entire compromise. One shadow byte per eight app bytes is cheap enough to map for the whole address space, and the `0x01`–`0x07` values let a single byte describe a *sub-granule* boundary — which is exactly what makes a one-byte overflow past a 13-byte buffer detectable instead of rounding up to the next 8.

---

## Core Concept 2 — The Instrumented Check, Fast Path and Slow Path

For every memory access the compiler can't prove safe, ASan's instrumentation pass inserts a check *before* the load or store. Conceptually, for an N-byte access at `addr`:

```c
char *shadow = (char *)((addr >> 3) + 0x7fff8000);
char  s      = *shadow;                       // the shadow byte
if (s != 0) {                                 // not fully addressable → investigate
    if (((addr & 7) + N - 1) >= s)            // does this access reach into poison?
        __asan_report_error(addr, N, is_write);
}
// ... otherwise proceed with the real access
```

Read the slow-path condition carefully, because it *is* the n-addressable encoding in action. `addr & 7` is the offset of the access within its granule. If the shadow byte `s` is a positive partial value (say `0x05`, five bytes addressable), then the access is legal only if its last touched byte index `(addr & 7) + N - 1` is **less than** `s`. If it reaches `s` or beyond, it touches poisoned bytes → report.

There are two performance tiers:

- **Fast path:** `s == 0` (the overwhelmingly common case — most accesses are well inside live, aligned memory). The check is one load, one compare against zero, one not-taken branch. This is the ~2× cost.
- **Slow path:** `s != 0`. Either it's a genuine bug, or it's a *partial* granule access that's actually fine (the access ends within the addressable prefix). The slow path does the extra arithmetic to disambiguate. It's rare in normal code, so its cost is amortized to near zero.

For an 8-byte access the check simplifies to `if (*shadow != 0) report()` — because an aligned 8-byte access either fits a fully-addressable granule (`0x00`) or doesn't, with no partial case to consider. Smaller and unaligned accesses are what require the full comparison.

```bash
# See the instrumentation the compiler actually emits:
clang -fsanitize=address -O1 -S -emit-llvm foo.c -o foo.ll
grep -n '__asan_report\|asan.module_ctor\|__asan_check' foo.ll
```

> **Key insight:** Every access in an ASan build became *a shadow load plus a branch-on-zero*. That single fact explains the whole performance profile: the slowdown is dominated by branch and cache pressure on the fast path, not by the rare slow path. It also explains why ASan needs a **recompile** (the checks are baked into your code) and why it's an order of magnitude faster than Valgrind, which interprets every instruction at runtime instead.

---

## Core Concept 3 — Redzones, the Allocator, and Quarantine

ASan detection rests on two allocator tricks: surrounding every allocation with poisoned **redzones**, and holding freed memory in **quarantine** before reuse.

**Redzones.** ASan replaces `malloc`/`new` with its own allocator that pads each chunk with poisoned bytes on the left and right. A 100-byte `malloc` becomes (left redzone) + 100 usable bytes + (right redzone), with the redzone shadow set to `0xfa`/`0xfb`. An off-by-one write past the buffer lands in the right redzone → instant report with the exact overflow offset. Redzone size is tunable; larger redzones catch overflows that skip further past the buffer, at the cost of memory:

```bash
ASAN_OPTIONS=redzone=64:max_redzone=2048 ./app
#   redzone     = minimum redzone size in bytes (default 16)
#   max_redzone = upper bound for large allocations (default 2048)
```

**Quarantine.** When you `free` a chunk, ASan does *not* return it to the allocator immediately. It poisons the whole region with `0xfd` (freed) and pushes it onto a FIFO quarantine. Only when the quarantine exceeds its size budget does the oldest chunk get genuinely recycled. This window is what makes **use-after-free** detectable: as long as the freed chunk is still in quarantine, any access to it hits `0xfd` shadow and reports. Make the window bigger to catch slower use-after-free, at a steep memory cost:

```bash
ASAN_OPTIONS=quarantine_size_mb=256 ./app          # default ~256MB total
ASAN_OPTIONS=thread_local_quarantine_size_kb=1024 ./app
```

**Allocation context.** Every report includes where the memory was allocated and freed. ASan captures a stack trace at `malloc` and `free` time, up to `malloc_context_size` frames. Deeper context helps you trace ownership but costs time and memory per allocation:

```bash
ASAN_OPTIONS=malloc_context_size=30 ./app          # default 30 frames
```

> **Key insight:** Redzone size sets your *spatial* detection radius (how far past a buffer you can reach and still be caught) and quarantine size sets your *temporal* detection window (how long after a `free` a use is still caught). Both are pure memory-for-coverage trades. An overflow that jumps *past* the redzone, or a use-after-free that happens after the chunk is evicted from quarantine, is a **false negative** — not a bug in ASan, but the edge of its configured window.

---

## Core Concept 4 — Stack, Globals, Use-After-Return, Use-After-Scope

Heap is the easy case because ASan owns the allocator. Stack and globals require the *compiler* to cooperate, and the instrumentation differs per storage class.

**Globals.** The compiler rewrites each global into a struct with trailing redzone padding and registers it with the runtime at startup (`__asan_register_globals`). An out-of-bounds access to a global array hits its `0xf9` redzone. This is essentially free at runtime.

**Stack.** For each function with address-taken locals, the compiler allocates a larger frame, lays the locals out with redzones between and around them, and pokes the shadow at function entry (poison the redzones) and exit (unpoison). A read past a stack array lands in a `0xf1`/`0xf2`/`0xf3` redzone. This costs a bit of frame setup per call.

**Use-after-return (the fake stack).** A classic bug returns a pointer to a local, then dereferences it. By the time you do, the frame is gone — but the *stack memory* is still valid (it's the same stack), so a naive check sees nothing wrong. ASan solves this with a **fake stack**: locals whose address escapes are allocated in heap-backed fake frames; on return, the fake frame's shadow is poisoned `0xf5` instead of being reclaimed, so a later access reports `stack-use-after-return`. It's off by default because it's expensive (heap-allocating frames):

```bash
ASAN_OPTIONS=detect_stack_use_after_return=1 ./app
# or bake it in: clang -fsanitize=address -fsanitize-address-use-after-return=always
```

**Use-after-scope.** A pointer to a local that has left its `{ }` block but whose enclosing function is still running. The compiler poisons (`0xf8`) the local's shadow at scope exit and unpoisons at scope entry. Enabled by default in modern Clang (`-fsanitize-address-use-after-scope`); catches bugs like keeping a pointer to a loop-body temporary across iterations.

```c
int *p;
{ int x = 42; p = &x; }   // x leaves scope here → its shadow is poisoned 0xf8
*p = 7;                    // stack-use-after-scope
```

> **Key insight:** "Stack memory is still valid after the frame returns" is exactly why use-after-return is invisible to a naive checker and why ASan needs a *fake* stack to manufacture a poisonable region. The cost asymmetry is deliberate: globals ≈ free, stack ≈ cheap, use-after-scope ≈ cheap and default-on, use-after-return ≈ expensive and default-off. Turn on `detect_stack_use_after_return` for a dedicated CI lane, not your fastest inner loop.

---

## Core Concept 5 — Interceptors and the Intra-Object Blind Spot

Compiler instrumentation only covers code ASan compiled. But your program spends a lot of time inside libc — `memcpy`, `strcpy`, `strlen`, `memset` — which is *not* instrumented. ASan handles this with **interceptors**: it replaces these functions with bounds-checking wrappers that consult the shadow for the whole source and destination range before doing the real work.

```c
// Conceptually, ASan's memcpy interceptor:
void *memcpy(void *dst, const void *src, size_t n) {
    __asan_region_is_poisoned(dst, n);   // check destination range
    __asan_region_is_poisoned(src, n);   // check source range
    return REAL(memcpy)(dst, src, n);    // then the real libc memcpy
}
```

This is why `strcpy` into a too-small buffer is caught even though you never wrote a byte yourself — the interceptor checks the destination span. There's also an overlap check (`memcpy` with overlapping src/dst is UB) that ASan reports.

**The intra-object blind spot.** Here is the most important *limitation* a senior must internalize. Consider:

```c
struct S { char name[8]; int id; };
struct S s;
strcpy(s.name, "this is longer than eight");   // overflows name INTO id
```

This overflow stays *inside the object* `s` — it runs from `name` into `id`. To ASan, the whole `struct S` is one allocation with redzones only at its outer edges. The bytes between `name` and `id` are legitimately addressable (they're part of `s`), so their shadow is `0x00`. ASan sees nothing wrong until the overflow runs past the *end of the entire struct*. Overflows fully contained within an object's own fields are a structural blind spot.

The partial mitigation is **field padding**, which inserts redzones *between* members:

```bash
clang -fsanitize=address -fsanitize-address-field-padding=1 *.c -o app
#   1 = pad fields that the compiler deems safe to pad
#   3 = pad more aggressively (but breaks more ABI assumptions)
```

This changes the *layout* of your structs (it inserts poisoned padding between fields), so it breaks `sizeof`, serialization, `memcpy` of whole structs, anything assuming a stable ABI, and unions. It requires recompiling everything that touches those types and is opt-in per-class via an annotation in practice. It's powerful but invasive — reserve it for a focused hunt, not your default build.

> **Key insight:** Interceptors extend ASan's reach into uninstrumented libc, but the redzone model fundamentally can't see *within* a single allocation. A buffer overflow between two fields of the same struct is addressable memory writing to other addressable memory — there's no poison between them unless you pay the ABI-breaking cost of field padding. This is the canonical "ASan passed but the bug was real" scenario.

---

## Core Concept 6 — What ASan Does NOT Catch

A senior's most valuable ASan knowledge is its boundaries. ASan is a *memory addressability* checker, full stop. It does not catch:

| Bug class | Why ASan misses it | The right tool |
|---|---|---|
| **Data races** | ASan tracks addressability, not happens-before ordering. | **TSan** (`-fsanitize=thread`) |
| **Uninitialized reads** | The memory is addressable; reading garbage is "valid" to ASan. | **MSan** (`-fsanitize=memory`) |
| **Signed overflow, bad shifts, misaligned pointers, most UB** | These are language-level UB, not addressability. | **UBSan** (`-fsanitize=undefined`) |
| **Intra-object overflow** | Inter-field bytes are addressable (see Concept 5). | `-fsanitize-address-field-padding` (partial) |
| **Overflow past the redzone** | Lands in another live allocation, not poison. | Bigger `redzone`; fuzzing for coverage |
| **Use-after-free after quarantine eviction** | Chunk was recycled; shadow is `0x00` again. | Bigger `quarantine_size_mb` |
| **Custom-allocator / arena memory** | ASan never saw the `malloc`; no redzones. | Manual `__asan_poison_memory_region` |

The custom-allocator case deserves a senior's attention because it silently disables ASan for whole subsystems. If you carve objects out of a single big arena with your own bump allocator, ASan only knows about the *one* underlying allocation — overflows between your sub-objects are invisible. The fix is to manually poison the redzones you leave between sub-allocations:

```c
#include <sanitizer/asan_interface.h>

void *arena_alloc(Arena *a, size_t n) {
    void *p = a->cur;
    a->cur += n + REDZONE;
    __asan_unpoison_memory_region(p, n);              // user bytes are usable
    __asan_poison_memory_region((char*)p + n, REDZONE); // redzone is poison
    return p;
}
void arena_free(void *p, size_t n) {
    __asan_poison_memory_region(p, n);               // now use-after-free is caught
}
```

> **Key insight:** "ASan passed" means "no detected *out-of-bounds or use-after-free on memory ASan manages*." It does not mean memory-safe, race-free, or UB-free. The mature posture is to run ASan **and** UBSan together (they're compatible), TSan on a separate lane, MSan on its own lane (and only if your whole dependency tree is MSan-instrumented, including libc++), and to manually poison any custom allocator. ASan is an *oracle*, not a shield — it tells you a bug exists when it's exercised; it doesn't prevent the bug.

---

## Core Concept 7 — ASan vs Valgrind vs HWASan vs GWP-ASan vs KASAN

The same "detect bad memory access" goal has several implementations with very different cost/coverage/deployment profiles. Choosing among them is a senior call.

| Tool | Mechanism | Slowdown | Memory | Recompile? | Catches uninit reads? | Production-viable? |
|---|---|---|---|---|---|---|
| **ASan** | Shadow memory + redzones, compile-time | ~2× | ~3× | Yes | No | No (too heavy) |
| **Valgrind/Memcheck** | Dynamic binary instrumentation (runtime) | 10–50× | ~2× | No | **Yes** | No |
| **HWASan** | Pointer tagging (top byte), shadow of tags | ~2× CPU, ~1.1–1.5× mem | Yes | No | Sampled in prod | Yes (Android) |
| **MTE** | Hardware memory tagging (ARMv8.5) | ~5–10% | low | Yes (tagged alloc) | No | **Yes** (hardware) |
| **GWP-ASan** | Sampling guard-page allocator | ~0% (sampled) | tiny | Link runtime | No | **Yes** |
| **KASAN** | ASan ported into the Linux kernel | ~2–3× | high | Kernel rebuild | N/A | No (dev kernels) |

**ASan vs Valgrind.** Valgrind needs *no recompile* and uniquely catches *uninitialized reads*, but it's an order of magnitude slower because it dynamically instruments every instruction at runtime. ASan is ~10× faster but requires building with the flag and *cannot* detect uninitialized reads (that's MSan's job). The senior heuristic: ASan for your own code in CI; Valgrind when you can't rebuild (a third-party binary) or specifically need its uninitialized-read coverage without an MSan-clean tree.

**ASan vs HWASan.** HWASan replaces shadow-per-byte with **pointer tagging**: it stores a small random tag in the unused top byte of each pointer (ARM's Top-Byte-Ignore makes the CPU mask it on dereference) and a matching tag in a much smaller shadow. On access it checks pointer tag == memory tag. The wins: ~2× *memory savings* over ASan (no 1:8 shadow of the whole address space), no quarantine needed for solid use-after-free coverage, and a near-zero false-negative window — making it viable to run **sampled in production**. The cost: it needs a 64-bit, tagged-pointer-capable target (AArch64).

**MTE** is HWASan's idea done in *hardware* (ARMv8.5 Memory Tagging Extension): the CPU itself tags 16-byte granules and faults on a tag mismatch, with single-digit-percent overhead — cheap enough to run continuously on supporting silicon.

**GWP-ASan** takes the opposite bet: instead of checking *every* allocation, it guards a *tiny random sample* with guard pages, so each guarded allocation gets precise overflow/UAF detection at essentially zero average cost. It catches only a fraction of bugs per run, but deployed across millions of devices it surfaces real bugs from production with negligible overhead. It's a *fleet* tool, not a *per-run* tool.

**KASAN** is simply ASan ported into the Linux kernel — same shadow + redzone idea, used in development kernels to find kernel memory bugs.

**Why sanitizers can't coexist.** You cannot combine `-fsanitize=address` with `-fsanitize=thread` or `-fsanitize=memory` in one binary. Each maintains its *own* shadow-memory layout and its *own* allocator interception, and these designs conflict directly — two runtimes both wanting to own `malloc` and both wanting their shadow at a fixed offset. ASan + UBSan *do* combine (UBSan adds independent checks, no shadow conflict). The practical consequence: you run **separate build configurations / CI lanes** for ASan+UBSan, TSan, and MSan.

> **Key insight:** The progression ASan → HWASan → MTE → GWP-ASan is a progression from *exhaustive-but-heavy* to *cheap-but-sampled*, and from *software shadow* to *hardware tags*. ASan is your CI exhaustive oracle; HWASan/MTE/GWP-ASan are how the same detection escapes the lab and runs in production where the *real* inputs are.

---

## Core Concept 8 — Performance Engineering and Production Strategy

Running ASan well at scale is its own engineering problem.

**Optimization level.** Build ASan with **`-O1`**, not `-O0` or `-O2`. `-O0` is far too slow and gives huge frames; `-O2` can over-optimize away the very accesses you want checked and lengthens build time. `-O1 -g -fno-omit-frame-pointer` is the canonical ASan recipe: enough optimization for speed, frame pointers for fast accurate backtraces, debug info for symbolized reports.

```bash
clang -fsanitize=address -O1 -g -fno-omit-frame-pointer app.c -o app
```

**Build caching and sharding.** An ASan build is a *separate* build (different flags → different cache keys), so it can't reuse your release artifacts. Cache it independently (ccache/sccache with ASan flags in the key). The runtime cost means an ASan test suite runs ~2× slower; **shard** it across machines and run it as its own CI lane rather than serializing it with the normal suite.

**Symbolization.** Reports are useless without symbols. Point ASan at the symbolizer and keep frame pointers:

```bash
export ASAN_SYMBOLIZER_PATH=$(command -v llvm-symbolizer)
ASAN_OPTIONS=symbolize=1 ./app
# offline: pipe a raw report through the symbolizer
./app 2>&1 | asan_symbolize.py
```

**Container / ulimit / ASLR gotchas.** ASan reserves a huge virtual address range for shadow. In containers with a virtual-memory `ulimit` (`ulimit -v`), or under restrictive cgroups, the shadow `mmap` fails and ASan dies at startup. Remove the `-v` limit. Two more knobs matter in production-ish environments:

```bash
ASAN_OPTIONS=allocator_may_return_null=1 ./app   # OOM/huge alloc → return NULL, don't abort
ASAN_OPTIONS=hard_rss_limit_mb=4096 ./app         # cap RSS; abort if exceeded (prevents OOM-killer)
ASAN_OPTIONS=abort_on_error=1 ./app               # SIGABRT (core dump) instead of exit
ASAN_OPTIONS=halt_on_error=0 ./app                # keep going after a non-fatal error (for fuzzing/coverage)
ASAN_OPTIONS=detect_leaks=1 ./app                 # LSan on (default on Linux; off on macOS)
```

If your build runs under a strict ASLR-disabled or PIE-disabled environment, ASan can collide with the address it wants for shadow — disabling ASLR (`setarch -R`) is sometimes needed to make `mmap` deterministic for debugging, but in general leave ASLR on.

**Determinism and flakiness.** ASan adds little nondeterminism itself, but it *exposes* latent nondeterminism: a use-after-free is only caught while the chunk is in quarantine, so a flaky-looking failure often means the quarantine window is too small for that timing. Enlarge `quarantine_size_mb` and `detect_stack_use_after_return=1` to make detection more reliable, accepting more memory and time.

**Fuzzing — ASan as the oracle.** libFuzzer (and AFL++ targets built with `-fsanitize=fuzzer`) link the ASan runtime so that *ASan is the bug oracle*: the fuzzer generates inputs, and ASan turns any memory violation into a crash the fuzzer records and minimizes. This is the single highest-leverage way to run ASan — combinatorial input generation feeding an exhaustive memory checker — and is covered in [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/senior.md).

```bash
clang -fsanitize=address,fuzzer -O1 -g fuzz_target.c -o fuzzer
./fuzzer -max_len=4096 corpus/        # ASan reports become reproducible crash files
```

> **Key insight:** Treat ASan as a *configuration*, not a flag. It's a separate build, a separate cache, a separate (sharded) CI lane, and a separate set of `ASAN_OPTIONS` tuned per environment. In production you don't run ASan at all — you run HWASan/MTE/GWP-ASan **sampled**, ship the symbolized reports to telemetry, and treat them as crash signals. ASan is the oracle in the lab and in the fuzzer; the sampling tools are the oracle in the field.

---

## Real-World Examples

**Example 1 — Decoding a heap-buffer-overflow report.** A one-byte write past a 10-byte buffer:

```
==12345==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x60200000001a
WRITE of size 1 at 0x60200000001a thread T0
    #0 0x4f7b in store_byte /src/buf.c:14:9
    #1 0x4f3a in main /src/buf.c:22:3

0x60200000001a is located 0 bytes to the right of 10-byte region [0x602000000010,0x60200000001a)
allocated by thread T0 here:
    #0 0x4a1d in malloc
    #1 0x4ee2 in main /src/buf.c:20:14

SUMMARY: AddressSanitizer: heap-buffer-overflow /src/buf.c:14:9 in store_byte
Shadow bytes around the buggy address:
  0x0c047fff8000: fa fa fa fa fa fa fa fa fa fa fa fa fa fa fa fa
=>0x0c047fff8003: fa fa[02]fa fa fa fa fa fa fa fa fa fa fa fa fa
  0x0c047fff8006: fa fa fa fa fa fa fa fa fa fa fa fa fa fa fa fa
Shadow byte legend (one shadow byte represents 8 application bytes):
  Addressable:           00
  Partially addressable: 01 02 03 04 05 06 07
  Heap left redzone:       fa
  Heap right redzone:      fb
  Freed heap region:       fd
```

Decode it: "0 bytes to the right of [a 10-byte region]" means the access is exactly at the first byte past the buffer. The bracketed `[02]` is the killer detail — the buffer is 10 bytes = one full granule (`00`, not shown here) plus a **partial** granule with `02` (two bytes addressable). The write at offset 10 reaches the third byte of that partial granule, which is poison. The `fa` bytes flanking it are the left/right redzones. The two stack traces — *where the bad write happened* and *where the memory was allocated* — are the entire diagnostic.

**Example 2 — container-overflow on `std::vector`.** ASan understands `std::vector`'s gap between `size()` and `capacity()` via *container annotations*. Reading element `v[i]` where `size() <= i < capacity()` is logically out of bounds even though the heap chunk is big enough:

```
==9001==ERROR: AddressSanitizer: container-overflow on address 0x602000000034
READ of size 4 at 0x602000000034 thread T0
    #0 0x... in std::vector<int>::operator[]
HINT: if you don't care about these errors you may set ASAN_OPTIONS=detect_container_overflow=0
Shadow byte legend ...
  Container overflow:      fc
```

The `fc` shadow marks the capacity-but-not-size region. This catches a real class of bug — reading past `size()` into reserved-but-uninitialized capacity — that a plain bounds model would miss. The `HINT` exists because *mixing* an ASan-built TU with a non-ASan-built libstdc++ can produce *false positives* here; the annotations must be consistent across the whole link, which is itself a senior gotcha.

**Example 3 — `ASAN_OPTIONS` for a CI lane.** A pragmatic, reproducible CI configuration:

```bash
export ASAN_OPTIONS="\
detect_stack_use_after_return=1:\
detect_leaks=1:\
strict_string_checks=1:\
check_initialization_order=1:\
strict_init_order=1:\
abort_on_error=1:\
symbolize=1"
export ASAN_SYMBOLIZER_PATH=$(command -v llvm-symbolizer)
```

`check_initialization_order` + `strict_init_order` catch the C++ **static initialization order fiasco** (one global's constructor reading another global that isn't constructed yet) — a bug class most people don't know ASan can find.

---

## Mental Models

- **One shadow byte rules eight app bytes.** The 1:8 map (`(addr >> 3) + offset`) and the `0x01`–`0x07` partial encoding are ASan in a nutshell. Every "where does this report come from" question resolves by computing the shadow address and reading its byte against the legend.

- **Every access became a load-and-branch.** The compiler inserted `if (shadow != 0) maybe_report()` before your loads and stores. That's the ~2× cost on the fast path and the reason ASan needs a recompile but runs 10× faster than Valgrind.

- **Redzones are spatial; quarantine is temporal.** Redzone size is how far past a buffer you can be caught; quarantine size is how long after a `free` you can be caught. Both are memory-for-coverage dials, and both have a far edge past which bugs become false negatives.

- **ASan can't see inside one allocation.** A struct's inter-field bytes are addressable, so an overflow from one field into the next is invisible without ABI-breaking field padding. "Inside the object" is ASan's structural blind spot.

- **ASan is an oracle, not a shield.** It reports a bug *when that code path is exercised* — it doesn't prevent the bug and doesn't find paths you don't run. Pair it with a fuzzer (which generates the paths) and remember it only sees memory it manages.

- **Sanitizers are siblings that can't share a room.** ASan, TSan, MSan each own the allocator and a fixed-offset shadow, so they conflict; run them as separate build lanes. Only UBSan plays nicely alongside ASan.

---

## Common Mistakes

1. **Trusting "ASan passed" as proof of memory safety.** ASan only checks the paths you ran, only the memory it manages, and only addressability — not races, uninitialized reads, UB, or intra-object overflow. Pair it with fuzzing and the other sanitizers.

2. **Building ASan at `-O0` or `-O2`.** `-O0` is needlessly slow with bloated frames; `-O2` can optimize away the accesses you wanted to check. Use `-O1 -g -fno-omit-frame-pointer`.

3. **Expecting ASan to catch struct-internal overflows.** Bytes between two fields are addressable; only the struct's outer edges have redzones. Use `-fsanitize-address-field-padding` for a focused hunt, accepting the ABI break.

4. **Forgetting that custom allocators are invisible to ASan.** Arena/pool/bump allocators give ASan one big allocation it can't see inside. Manually `__asan_poison_memory_region` your inter-object redzones and on free.

5. **Running ASan under a virtual-memory `ulimit` or tight container.** ASan reserves a huge shadow range; `ulimit -v` and restrictive cgroups make the shadow `mmap` fail at startup. Remove the `-v` limit; consider `hard_rss_limit_mb`.

6. **Trying to combine `-fsanitize=address` with `thread` or `memory`.** They conflict on shadow layout and allocator ownership. Run them as separate builds/CI lanes; only UBSan combines with ASan.

7. **Quarantine too small for slow use-after-free, then calling the test "flaky."** If the freed chunk is recycled before the use, the shadow is clean again and the bug vanishes intermittently. Enlarge `quarantine_size_mb` to widen the temporal window.

8. **Mixing ASan and non-ASan TUs and getting `container-overflow` false positives.** `std::vector` container annotations must be consistent across the whole link. Build the whole target (and ideally the C++ standard library) with the same setting, or set `detect_container_overflow=0`.

---

## Test Yourself

1. Write the formula that maps an application address to its shadow byte, and state what `0x00`, `0x05`, and `0xfd` mean in a shadow byte.
2. For a 4-byte read at an address with `addr & 7 == 6` and shadow byte `0x05`, does ASan report? Show the slow-path comparison.
3. A `strcpy` overflows `char name[8]` into the adjacent `int id` field of the same struct. Why doesn't ASan catch it, and what flag partially fixes it (and at what cost)?
4. Name two `ASAN_OPTIONS` knobs and explain which detection *window* each one widens.
5. ASan, Valgrind, HWASan, GWP-ASan: which needs no recompile, which catches uninitialized reads, which is production-sampled, and which gives ~2× memory savings over ASan?
6. Why can't ASan and TSan run in the same binary? What can run alongside ASan?
7. How does libFuzzer use ASan, and why is "ASan is an oracle, not a shield" the right framing for production?

<details>
<summary>Answers</summary>

1. `shadow_addr = (app_addr >> 3) + offset` (offset `0x7fff8000` on x86-64 Linux). `0x00` = all 8 bytes addressable; `0x05` = the first 5 bytes addressable, last 3 poisoned (partial/n-addressable granule); `0xfd` = freed heap region (a use-after-free target).
2. Yes, it reports. The access touches byte indices `6, 7, 8, 9` within/after the granule; the last touched index is `(addr & 7) + N - 1 = 6 + 4 - 1 = 9`. The condition `9 >= s` where `s = 0x05` is true → it reaches into poison → report. (Only indices `< 5` would be legal.)
3. The bytes between `name` and `id` are part of the same allocation and are legitimately addressable, so their shadow is `0x00`; ASan only poisons the redzones at the *outer* edges of the whole struct, not between fields. `-fsanitize-address-field-padding=1` inserts redzones between members — at the cost of changing struct layout (breaks `sizeof`, serialization, whole-struct `memcpy`, unions, ABI) and requiring a full recompile of everything touching those types.
4. **Redzone** (`redzone`/`max_redzone`) widens the *spatial* window — how many bytes past a buffer you can reach and still be caught. **Quarantine** (`quarantine_size_mb`) widens the *temporal* window — how long after a `free` a use is still caught before the chunk is recycled. (Also `malloc_context_size` deepens allocation backtraces; `detect_stack_use_after_return` enables the fake stack.)
5. **Valgrind** needs no recompile *and* catches uninitialized reads. **GWP-ASan** (and HWASan/MTE) is production-sampled; GWP-ASan at near-zero average cost. **HWASan** gives ~2× memory savings over ASan via pointer tagging instead of a 1:8 shadow of the whole address space.
6. Each maintains its own shadow-memory layout at a fixed offset and intercepts the allocator; ASan and TSan both want to own `malloc` and both want their shadow region — directly conflicting designs. **UBSan** can run alongside ASan (it adds independent checks with no shadow/allocator conflict).
7. libFuzzer links the ASan runtime and uses ASan as the **oracle**: the fuzzer generates inputs and ASan turns any memory violation into a recorded, minimizable crash. "Oracle, not shield": ASan only reports bugs on paths actually exercised and only on memory it manages — it detects, it doesn't prevent — so in production you don't run full ASan; you run sampled HWASan/MTE/GWP-ASan and treat their reports as telemetry signals.

</details>

---

## Cheat Sheet

```
SHADOW MEMORY
  shadow = (addr >> 3) + 0x7fff8000     1 shadow byte per 8 app bytes (scale=3)
  00            8 bytes addressable
  01..07        n leading bytes addressable (partial granule)
  fa / fb       heap left / right redzone
  fd            freed (heap-use-after-free)        fc  container-overflow (vector)
  f1 f2 f3      stack left / mid / right redzone
  f5            stack-use-after-return             f8  stack-use-after-scope
  f9            global redzone

THE CHECK (per access of size N at addr)
  s = *shadow; if (s && (addr&7)+N-1 >= s) report();     fast path: s==0

BUILD
  clang -fsanitize=address -O1 -g -fno-omit-frame-pointer        (canonical)
  -fsanitize=address,undefined                                   (combine: OK)
  -fsanitize=address,fuzzer                                      (ASan as fuzz oracle)
  -fsanitize-address-field-padding=1   redzones BETWEEN struct fields (breaks ABI)
  -fsanitize-address-use-after-return=always   bake in fake stack
  CANNOT combine: address + thread, address + memory (separate lanes)

ASAN_OPTIONS (runtime)
  detect_leaks=1                       LSan (default on Linux)
  detect_stack_use_after_return=1      fake stack (off by default; expensive)
  quarantine_size_mb=256               temporal UAF window
  redzone=64:max_redzone=2048          spatial overflow window
  malloc_context_size=30               alloc/free backtrace depth
  allocator_may_return_null=1          huge/OOM alloc → NULL, not abort
  hard_rss_limit_mb=N                  cap RSS, abort if exceeded
  halt_on_error=0                      keep going after non-fatal error
  detect_container_overflow=0          silence vector annotations (mixed TUs)
  abort_on_error=1 : symbolize=1       core dump + symbolized frames
  export ASAN_SYMBOLIZER_PATH=$(command -v llvm-symbolizer)

CUSTOM ALLOCATOR
  __asan_poison_memory_region(p, n)    /  __asan_unpoison_memory_region(p, n)

ALTERNATIVES
  Valgrind  no recompile, +uninit reads, 10-50x slow
  HWASan    pointer tagging, ~2x less mem, prod-sampled (AArch64)
  MTE       hardware tags, single-digit % overhead (ARMv8.5)
  GWP-ASan  sampled guard pages, ~0% avg cost, fleet-wide
```

---

## Summary

- ASan is built on **shadow memory** — one byte per 8 app bytes, found by `(addr >> 3) + offset` — where `0x00` means fully addressable, `0x01`–`0x07` encode a partial granule, and negative values name *why* memory is poisoned (redzone, freed, etc.).
- The compiler inserts a **shadow load plus a branch-on-zero** before every access; the fast path (`s == 0`) is the ~2× cost, and the slow path runs the `(addr & 7) + N - 1 >= s` comparison that the partial encoding makes necessary.
- Detection power comes from **redzones** (poisoned padding → spatial overflow detection) and **quarantine** (delayed reuse → temporal use-after-free detection), both tunable memory-for-coverage trades via `ASAN_OPTIONS`.
- Stack, globals, **use-after-return** (the fake stack), and **use-after-scope** each need compiler cooperation, with deliberate cost asymmetry — globals ≈ free, use-after-return ≈ expensive and off by default.
- ASan's structural limits: it can't see *inside* one allocation (intra-object overflow), needs **interceptors** to cover libc, and **does not** catch races (TSan), uninitialized reads (MSan), or general UB (UBSan); custom allocators are invisible unless you manually poison them.
- The alternatives form a spectrum — Valgrind (no recompile, catches uninit, slow), **HWASan** (pointer tagging, ~2× less memory, prod-sampled), **MTE** (hardware tags), **GWP-ASan** (sampled, fleet-wide) — and ASan/TSan/MSan can't share a process because they each own the allocator and a fixed-offset shadow.
- Operationally, ASan is a **separate build, cache, and CI lane** at `-O1`; in production you run sampled HWASan/MTE/GWP-ASan and treat ASan as the **oracle** in CI and in the fuzzer (libFuzzer links its runtime) — *an oracle, not a shield*.

The next layer — [professional.md](professional.md) — is about operating these sanitizers across an organization: CI lane design, fleet-wide telemetry, triage, and the economics of where each tool earns its keep.

---

## Further Reading

- *AddressSanitizer: A Fast Address Sanity Checker* — Serebryany, Bruening, Potapenko, Vyukov (USENIX ATC 2012). The original paper; the shadow-memory and redzone design straight from the source.
- [Clang AddressSanitizer documentation](https://clang.llvm.org/docs/AddressSanitizer.html) and the [ASan algorithm wiki](https://github.com/google/sanitizers/wiki/AddressSanitizerAlgorithm) — the shadow encoding, flags, and `ASAN_OPTIONS` reference.
- [Hardware-assisted AddressSanitizer (HWASan) design](https://clang.llvm.org/docs/HardwareAssistedAddressSanitizerDesign.html) — pointer tagging, Top-Byte-Ignore, and the production story.
- *Memory Tagging and how it improves C/C++ memory safety* (Serebryany et al.) and the **ARM MTE** specification — the hardware-tagging direction ASan is evolving toward.
- [GWP-ASan documentation](https://llvm.org/docs/GwpAsan.html) — the sampling, production-grade allocator detector.
- The Linux kernel **KASAN** docs, and (for the cross-language picture) the Go race detector / Rust `-Z sanitizer` notes — the same shadow/tagging machinery underlies tooling well beyond C/C++.
- Then: [professional.md](professional.md) for the organizational and production-operations view.

---

## Related Topics

- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/senior.md) — the sibling sanitizer for *data races*, which ASan structurally cannot detect; why they can't share a process.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/senior.md) — the one sanitizer that *combines* with ASan, covering the UB classes ASan ignores.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/senior.md) — LSan and Valgrind/Memcheck; the no-recompile, uninitialized-read-catching alternative and its cost.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/senior.md) — libFuzzer/AFL++ using ASan as the bug oracle; the highest-leverage way to run it.
- [Static Analysis & Linting](../../static-analysis/) — the compile-time complement that catches bugs ASan can only find when a path is actually executed.
- [Security](../../../../Security/) — memory-safety vulnerabilities (overflows, UAF) as exploit primitives, and why these tools are security tooling.
