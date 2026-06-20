# AddressSanitizer (ASan) — Middle Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → AddressSanitizer (ASan)
> *The junior page told you what ASan catches. This page opens the hood: shadow memory, redzones, quarantine, the report fields line-by-line, the flags that actually matter, and how to wire it into CI so a heap overflow fails the build instead of leaking into production.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Shadow Memory, the 1-Byte-Per-8 Map](#core-concept-1--shadow-memory-the-1-byte-per-8-map)
5. [Core Concept 2 — Redzones and Quarantine](#core-concept-2--redzones-and-quarantine)
6. [Core Concept 3 — Reading the Report, Field by Field](#core-concept-3--reading-the-report-field-by-field)
7. [Core Concept 4 — Flags, Options, and Escape Hatches](#core-concept-4--flags-options-and-escape-hatches)
8. [Core Concept 5 — Cost, Combining, and the Sanitizer Family](#core-concept-5--cost-combining-and-the-sanitizer-family)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does ASan actually detect a bad memory access, and how do I run it for real?**

A quick recap, because everything below builds on it. AddressSanitizer is a compile-time instrumentation plus a runtime library that catches memory-safety bugs *at the moment they happen*, with a precise stack trace: heap buffer overflow/underflow, stack buffer overflow, global buffer overflow, use-after-free, use-after-return, use-after-scope, double-free, invalid free, and (via its bundled LeakSanitizer) leaks. It replaces the classic "corrupt now, crash mysteriously 200ms later" failure with "stop exactly here, on this line, with the allocation and free stacks attached."

The junior model — "ASan watches your memory and yells" — is correct but opaque. It can't explain *why* an off-by-one is caught while an off-by-fifty into someone else's live buffer might not be, *why* freed memory still gets diagnosed instead of silently recycled, or *why* the process uses 3× the RAM. The answers are three mechanisms: **shadow memory** (the map ASan checks on every access), **redzones** (poisoned guard bands around allocations), and **quarantine** (delayed reuse of freed memory). Understand those and ASan stops being magic — it becomes a tool whose strengths and blind spots you can reason about.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the bug classes ASan catches.
- **Required:** You can compile a C/C++ program with `clang`/`gcc` and read a stack trace.
- **Required:** A rough sense of the heap/stack split and what "an address" is — see [Build Fundamentals](../../build-systems/01-build-fundamentals/middle.md).
- **Helpful:** You've debugged at least one segfault or memory-corruption bug the hard way.
- **Helpful:** Familiarity with running a test suite in CI.

---

## Glossary

| Term | Meaning |
|---|---|
| **Instrumentation** | Extra checking code the compiler injects around each memory access. |
| **Shadow memory** | A compact side table: 1 byte describes the addressability of 8 application bytes. |
| **Poison** | Marking bytes as off-limits in shadow memory; an access to poisoned bytes is an error. |
| **Redzone** | Poisoned padding inserted around each allocation to catch off-by-N overflows. |
| **Quarantine** | A FIFO of recently-freed regions kept un-reused so use-after-free is detectable. |
| **Interceptor** | ASan's replacement for a libc function (`malloc`, `memcpy`, `strlen`, …) that adds checks. |
| **Oracle** | A tool that *judges* correctness on the paths you run — not a runtime shield. |
| **LSan / TSan / MSan / UBSan** | Leak / Thread / Memory(uninit) / Undefined-Behavior sanitizers. |

---

## Core Concept 1 — Shadow Memory, the 1-Byte-Per-8 Map

ASan's central data structure is **shadow memory**. For every 8 bytes of your program's address space, ASan keeps **1 shadow byte** that records *how many of those 8 bytes are currently addressable*. That 8:1 ratio is the whole design — it's why the overhead is a manageable fraction rather than, say, 8× like a naive byte-per-byte scheme.

The mapping from an application address to its shadow byte is a single shift-and-add:

```c
shadow_addr = (app_addr >> 3) + kOffset;   // kOffset = 0x7fff8000 on x86-64 Linux
```

The shadow byte encodes addressability compactly because allocations are 8-byte aligned:

- `0` → all 8 bytes are addressable (fully valid memory).
- `1..7` → only the *first k* bytes are addressable; the rest are off-limits (this is how a partial trailing region — e.g. a 13-byte allocation rounded into two shadow-covered words — is described exactly).
- A *negative* value (high bit set, e.g. `0xfa`, `0xfd`, `0xf1`) → the whole 8 bytes are poisoned, and the specific code says *why*: heap redzone, freed heap, stack redzone, global redzone, and so on.

Now the instrumentation. The compiler rewrites every load and store so that, before touching memory, it consults the shadow:

```c
// What you wrote:
*addr = value;

// What ASan compiles it into (conceptually):
byte shadow = *(char *)(((uptr)addr >> 3) + kOffset);
if (shadow != 0 && ((uptr)addr & 7) >= shadow)   // is this byte beyond the addressable count?
    __asan_report_store(addr);                    // poisoned → report and abort
*addr = value;
```

That check is a few instructions on the hot path of *every* memory access — which is the bulk of ASan's CPU cost. Reads and writes are both checked, and ASan records whether it was a READ or a WRITE so the report can tell you.

> **Key insight:** ASan does not "scan" your memory periodically. It checks the shadow on *every individual access*, synchronously, inline. That's why the report points at the *exact* offending instruction and why the bug is caught the instant it occurs — not whenever a later sweep happens to notice corruption.

---

## Core Concept 2 — Redzones and Quarantine

Shadow memory tells ASan whether an address is poisoned. **Redzones** and **quarantine** are how ASan arranges for buggy accesses to *land on poisoned bytes in the first place*. ASan replaces the system `malloc`/`free` with its own allocator precisely so it can control this layout.

**Redzones — catching overflows.** Around every heap, stack, and global allocation, ASan inserts extra poisoned bytes:

```
        redzone            your 64-byte buffer            redzone
   [ FA FA FA FA ... ] [ 00 00 00 00 ... 00 ] [ FA FA FA FA ... ]
     poisoned guard         addressable           poisoned guard
```

Write one byte past the end of your buffer and you land in the right redzone → poisoned → instant `heap-buffer-overflow`. Read one byte before the start → left redzone → `heap-buffer-overflow` (underflow). Globals get redzones at link time; stack frames get them injected by the compiler on function entry. This is why ASan reliably catches **off-by-one** errors: the redzone is sitting right where the off-by-one lands.

The limit follows directly: an overflow that *skips over* the redzone and lands in another live allocation may go undetected, because that target is legitimately addressable (shadow `0`). Redzones have a finite width (default 16 bytes, tunable via `redzone=`). ASan catches the overwhelmingly common small overshoots, not arbitrary wild writes.

**Quarantine — catching use-after-free.** When you `free()` a block, a normal allocator may hand those exact bytes back to the very next `malloc()`. If it does, a dangling pointer that reads the freed block would silently read a *valid, recycled* allocation — no bug visible. ASan prevents this: on `free`, it **poisons** the whole region (shadow → "freed") and pushes it into a **quarantine** — a bounded FIFO of recently-freed blocks that are *not* eligible for reuse. While a block sits in quarantine, any access through a stale pointer hits poisoned memory → `heap-use-after-free`, complete with the original allocation *and* free stacks.

```c
char *p = malloc(16);
free(p);          // region poisoned + parked in quarantine, NOT reused
p[0] = 'x';       // ASan: heap-use-after-free WRITE of size 1
```

Quarantine is finite (default ~256 MB, set via `quarantine_size_mb=`). Eventually the oldest block is evicted and recycled. So a use-after-free that occurs *long* after the free, past many other allocations, can be missed once the block leaves quarantine. The window is large but not infinite — a deliberate memory-vs-coverage trade.

> **Key insight:** Redzones and quarantine are ASan *manufacturing* the conditions for a bug to be detectable. A bad access only gets caught if it lands on poisoned shadow — so ASan engineers the layout (guard bands around allocations, delayed reuse of freed memory) to make the common bugs land there. The 3× memory cost is mostly the price of these two arrangements plus the shadow itself.

---

## Core Concept 3 — Reading the Report, Field by Field

The whole point of ASan is the report. Learn to read it and a memory bug goes from a multi-hour mystery to a two-minute fix. Here is a real heap-use-after-free, annotated:

```
==12345==ERROR: AddressSanitizer: heap-use-after-free on address 0x602000000050
    at pc 0x0000004f8a3b bp 0x7ffd... sp 0x7ffd...
READ of size 4 at 0x602000000050 thread T0          ← (1) operation, size, thread
    #0 0x4f8a3a in process_node parser.c:88          ← (2) ACCESS stack: where it blew up
    #1 0x4f8c10 in run_pass     parser.c:142
    #2 0x4f9d22 in main         main.c:30

0x602000000050 is located 0 bytes inside of 16-byte region [0x602000000050,0x602000000060)
freed by thread T0 here:                             ← (3) FREE stack: who freed it
    #0 0x4a1b20 in free  (asan interceptor)
    #1 0x4f8b05 in free_node  parser.c:71
    #2 0x4f8c08 in run_pass   parser.c:139

previously allocated by thread T0 here:              ← (4) ALLOC stack: who created it
    #0 0x4a1c40 in malloc (asan interceptor)
    #1 0x4f87aa in make_node  parser.c:54
    #2 0x4f8bf0 in run_pass   parser.c:131

SUMMARY: AddressSanitizer: heap-use-after-free parser.c:88 in process_node
Shadow bytes around the buggy address:              ← (5) shadow legend
  0x0c047fff8000: fa fa fa fa fa fa fa fa fa fa fd fd fa fa fa fa
                                          ^^         ← fd = freed; fa = redzone
Shadow byte legend (one shadow byte = 8 app bytes):
  Addressable:           00
  Heap left redzone:     fa
  Freed heap region:     fd
==12345==ABORTING
```

Read it in this order:

1. **Error type, operation, size, address.** `heap-use-after-free`, a `READ of size 4`. The bug class plus whether you were reading or writing and how wide.
2. **The access stack.** Top frame `process_node parser.c:88` — the exact line that touched the freed memory. This is where you start.
3. **The free stack.** `free_node parser.c:71` — the code that released the block. The "who pulled the rug out" half of a use-after-free.
4. **The allocation stack.** `make_node parser.c:54` — where the block was born. Together with (3), you have the object's full lifecycle.
5. **The shadow dump + legend.** A hex window of shadow bytes around the address, with the offending byte marked by `^`. `fd` = freed heap, `fa` = redzone, `00` = addressable. The "X bytes inside of N-byte region" line and the `[start,end)` boundaries tell you *exactly where in the object* the access landed — front, middle, or one past the end.

For a **heap-buffer-overflow** the shape is the same, minus the free stack: error type `heap-buffer-overflow`, a `WRITE of size 1`, "located 0 bytes *to the right* of a 64-byte region," and the shadow shows your `00`s ending and `fa` redzone beginning right where you overran. Same fields, different story.

> **Key insight:** Three stacks — *access, free, allocate* — turn a dangling-pointer bug from guesswork into a closed case. You don't reason about what *might* have freed the memory; ASan recorded the actual `free` call site and the actual `malloc` call site. The fix usually becomes obvious the moment you read frames (2), (3), and (4) together.

---

## Core Concept 4 — Flags, Options, and Escape Hatches

ASan splits into two layers: **compile-time flags** (passed to the compiler) and **runtime options** (read from the `ASAN_OPTIONS` environment variable at process start). Knowing both is the difference between "I built with ASan" and "I'm getting the diagnostics I actually need."

**Compile/link flags.** The canonical set:

```bash
clang -fsanitize=address \
      -fno-omit-frame-pointer \   # keep frame pointers → readable, complete stacks
      -g \                        # debug info → file:line in reports
      -O1 \                       # some optimization; ASan tolerates it, keeps speed sane
      app.c -o app
```

`-fsanitize=address` instruments the code *and* links the ASan runtime — use it on both compile and link steps. `-fno-omit-frame-pointer` is not optional in practice: without it, stack traces can be truncated or wrong. `-O1` is the sweet spot — higher levels can inline away frames; `-O0` is slower and can over-report stack-use-after-scope on some compilers. Build the *whole* program (and ideally its libraries) with ASan; instrumenting only some objects leaves blind spots.

**Runtime options** via `ASAN_OPTIONS`, colon-separated. The high-value ones:

```bash
export ASAN_OPTIONS="\
detect_leaks=1:\                       # turn on LeakSanitizer at exit (default on Linux)
halt_on_error=1:\                      # stop at the FIRST error (don't continue past it)
abort_on_error=1:\                     # abort() so CI/cores capture the failure cleanly
detect_stack_use_after_return=1:\      # catch returning a pointer to a local's frame
strict_string_checks=1:\               # stricter str*() bounds checking via interceptors
symbolize=1"                           # resolve addresses to file:line in-process

export ASAN_SYMBOLIZER_PATH=/usr/bin/llvm-symbolizer   # how reports become file:line
```

`halt_on_error=1` makes ASan an oracle that *fails*: the first bug stops the run. (Its opposite, `halt_on_error=0`, keeps going and reports more bugs in one pass — useful for triage, wrong for CI gating.) `abort_on_error=1` produces a real `abort()` so the CI job exits non-zero and a core dump is usable. If reports show raw hex instead of `file:line`, your symbolizer isn't being found — point `ASAN_SYMBOLIZER_PATH` at `llvm-symbolizer` (or `addr2line`).

**Escape hatches** — for code ASan must *not* instrument:

- **Function attribute.** Skip a specific function (a hand-rolled allocator, an intentional out-of-bounds trick):
  ```c
  __attribute__((no_sanitize("address")))
  void *my_custom_alloc(size_t n) { /* deliberately unusual memory tricks */ }
  ```
- **Suppression file.** Silence a *known* issue (e.g. a leak in a third-party library you can't fix) without touching its source:
  ```
  # lsan.supp
  leak:libthirdparty.so
  leak:known_cache_init
  ```
  ```bash
  ASAN_OPTIONS="suppressions=lsan.supp" ./app
  ```
- **Ignore list (blocklist).** Exclude files/functions at *compile* time via `-fsanitize-ignorelist=ignore.txt`.

Use these surgically. Every suppression is a hole in the net; annotate *why* it exists, or it becomes a place real bugs hide.

---

## Core Concept 5 — Cost, Combining, and the Sanitizer Family

**The cost, and why.** ASan typically runs at **~2× CPU** and **~3× RSS** (resident memory). Both follow directly from the mechanisms:

- **CPU (~2×):** the inline shadow check on every load/store, plus the interceptor wrappers around `memcpy`/`strlen`/etc.
- **Memory (~3×):** the shadow itself (1/8 of address space reserved), the **redzones** padding every allocation, and the **quarantine** holding freed memory hostage instead of returning it.

This is why ASan is a *test/CI/dev* tool, not a default for production builds — the memory cost alone makes it unsuitable as an always-on shield. (For production, see the sampling variants below.)

**Combining sanitizers.** Two rules to memorize:

| Combination | Allowed? | Why |
|---|---|---|
| **ASan + UBSan** | ✅ Yes | Different mechanisms; commonly built together (`-fsanitize=address,undefined`). |
| **ASan + LSan** | ✅ Bundled | LeakSanitizer ships *inside* ASan; on by default at exit on Linux. |
| **ASan + TSan** | ❌ No | Both rewrite memory access / use incompatible shadow schemes. |
| **ASan + MSan** | ❌ No | Mutually exclusive shadow-memory designs. |

So the pragmatic CI matrix is usually **two builds**: one `address,undefined` build and one `thread` build. You can't get one binary that does everything.

**The family** — pick the right tool:

- **LeakSanitizer (LSan)** — leak detection at exit; bundled with ASan (`detect_leaks=1`), or standalone (`-fsanitize=leak`). See [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/middle.md).
- **HWASan (Hardware-assisted ASan)** — ARM/AArch64 only; uses pointer **tag bits** (top-byte-ignore) instead of large redzones, giving **much lower memory overhead** and the ability to **sample**. The basis for catching memory bugs at scale on Android.
- **GWP-ASan** — a *sampling* guard-page allocator cheap enough to run in **production**; it instruments a tiny random fraction of allocations, so over a fleet you catch real bugs at near-zero per-process cost.
- **KASAN** — the in-kernel port; the same shadow-memory idea applied to the Linux kernel.

> **Key insight:** ASan is an **oracle, not armor**. It *judges* the executions you actually run — it does not protect a deployed binary from attackers, and it only sees code paths your tests/inputs exercise. That single framing explains both halves of using it well: feed it broad, representative inputs (which is why fuzzing pairs with it — see [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/middle.md)), and reach for HWASan/GWP-ASan when you need something cheap enough to leave running in production.

---

## Real-World Examples

**Example 1 — Wiring ASan into a CMake project.** Make the sanitizer a build option so it's one flag to flip, and reuse the cache between runs:

```cmake
# CMakeLists.txt
option(ENABLE_ASAN "Build with AddressSanitizer" OFF)
if(ENABLE_ASAN)
  add_compile_options(-fsanitize=address -fno-omit-frame-pointer -g -O1)
  add_link_options(-fsanitize=address)
endif()
```

```bash
cmake -B build-asan -DENABLE_ASAN=ON
cmake --build build-asan      # this directory IS the cached sanitizer build
```

The plain Makefile equivalent is just a variable:

```make
SAN := -fsanitize=address -fno-omit-frame-pointer -g -O1
app-asan: app.c ; $(CC) $(SAN) $< -o $@
```

**Example 2 — A CI job that fails on any ASan error.** Build the sanitizer variant, cache it, run the full suite under strict options, and let a non-zero exit fail the job:

```yaml
# .github/workflows/asan.yml
jobs:
  asan:
    runs-on: ubuntu-latest
    env:
      # halt + abort → first error stops the run and exits non-zero → red build
      ASAN_OPTIONS: detect_leaks=1:halt_on_error=1:abort_on_error=1:detect_stack_use_after_return=1:symbolize=1
      ASAN_SYMBOLIZER_PATH: /usr/bin/llvm-symbolizer
    steps:
      - uses: actions/checkout@v4
      - name: Cache the sanitizer build       # rebuilding instrumented code is slow; cache it
        uses: actions/cache@v4
        with:
          path: build-asan
          key: asan-${{ runner.os }}-${{ hashFiles('**/CMakeLists.txt', 'src/**') }}
      - run: cmake -B build-asan -DENABLE_ASAN=ON && cmake --build build-asan
      - run: ctest --test-dir build-asan --output-on-failure   # any ASan abort → job fails
```

The contract: the test runner exits non-zero the moment ASan aborts, the job goes red, and the report (with all three stacks) is right there in the log. The cache means you pay the instrumented-build cost only when source or build files change.

**Example 3 — Annotating a custom allocator.** A pool/arena allocator carves objects out of one big block, so ASan can't see individual object boundaries and won't catch overruns *within* the pool. The manual-poisoning API restores detection — you tell ASan to poison the slack and unpoison each handed-out chunk:

```c
#include <sanitizer/asan_interface.h>

void *pool_alloc(Pool *p, size_t n) {
    void *chunk = bump(p, n);
    __asan_unpoison_memory_region(chunk, n);          // mark this chunk usable
    __asan_poison_memory_region((char*)chunk + n, RZ);// poison a redzone after it
    return chunk;
}
void pool_free(Pool *p, void *chunk, size_t n) {
    __asan_poison_memory_region(chunk, n);            // dangling reads now caught
}
```

Without this, the pool is one giant valid region and use-after-free inside it is invisible. This is the canonical "intentional pattern needs annotation" case.

---

## Mental Models

- **Shadow memory is a margin note next to every page.** For each 8 bytes of your program, one shadow byte records "all readable / first k readable / poisoned-because." ASan glances at the margin before every access — that glance is the whole detector.

- **Redzones are tripwires; quarantine is a holding cell.** Tripwires (poisoned guard bands) ring every allocation so a step past the edge sets one off. The holding cell keeps freed memory off the market long enough that touching a dangling pointer hits poison instead of someone else's fresh object.

- **The report is a crime scene with three witnesses.** *Access* (where the body was found), *free* (who removed the victim), *allocate* (where the victim came from). You rarely need to deduce — the witnesses already gave statements with line numbers.

- **ASan is an oracle, not a shield.** It tells the truth about the executions you run; it does not guard a production binary, and it is blind to paths you never exercise. Coverage is your responsibility, not ASan's.

---

## Common Mistakes

1. **Instrumenting only part of the program.** ASan must wrap the allocator and the accesses. Build *all* of your code (and ideally dependencies) with `-fsanitize=address`; mixing instrumented and uninstrumented objects yields false negatives and confusing reports.

2. **Forgetting `-fno-omit-frame-pointer`.** Stacks come back truncated or wrong, and you waste time reading garbage frames. It's part of the canonical flag set for a reason.

3. **Expecting ASan to catch *every* overflow.** Redzones have a finite width and live allocations are valid memory. A wild write that jumps the redzone into another object can slip through. ASan nails the common small overshoots, not arbitrary corruption.

4. **Treating "ASan passed" as "memory-safe."** ASan only judges the paths you ran. A clean ASan run on a thin test suite proves little. Pair it with broad inputs and fuzzing.

5. **Trying to combine ASan with TSan or MSan in one build.** They're mutually exclusive. Use separate CI builds: one `address,undefined`, one `thread`.

6. **Leaving `halt_on_error=0` (or unset behaviors) in CI.** If the run continues past the first error, or doesn't `abort()`, the job may stay green despite real bugs. Gate CI with `halt_on_error=1:abort_on_error=1`.

7. **Hex addresses instead of `file:line` in reports.** The symbolizer isn't being found. Set `ASAN_SYMBOLIZER_PATH` to `llvm-symbolizer`; without symbols the report loses most of its value.

8. **Suppressing broadly to get a green run.** A wildcard suppression hides future real bugs. Scope suppressions tightly and comment *why* each exists.

---

## Test Yourself

1. ASan keeps 1 shadow byte per 8 application bytes. What do the values `0`, `5`, and `0xfd` mean, and how is the shadow address computed from an application address?
2. Why does ASan reliably catch an off-by-one write but might miss an off-by-fifty into another live buffer?
3. What is quarantine, and what happens to detection of a use-after-free that occurs *very* long after the `free`?
4. In an ASan report, name the three stack traces and what each one tells you.
5. Which two compile flags besides `-fsanitize=address` belong in the canonical build, and why each?
6. Your CI runs the suite under ASan but stays green despite a known overflow. Which two `ASAN_OPTIONS` would you check first?
7. You have a bump/arena allocator and ASan misses overruns inside it. What's the fix?
8. Can you build one binary with ASan + UBSan? With ASan + TSan? Why or why not?

<details>
<summary>Answers</summary>

1. `0` = all 8 bytes addressable; `5` = only the first 5 of the 8 are addressable; `0xfd` = the 8 bytes are poisoned because they're a *freed heap region*. The shadow address is `(app_addr >> 3) + kOffset`.
2. The off-by-one lands in the poisoned **redzone** right past the buffer → caught. The off-by-fifty can overshoot the finite-width redzone and land inside another *live* allocation, which is legitimately addressable (shadow `0`) → not flagged.
3. Quarantine is a bounded FIFO of recently-freed regions that ASan keeps *poisoned and un-reused*, so a dangling access hits poison. Once a block is evicted (quarantine is finite, default ~256 MB), it can be recycled — a use-after-free long after the free, past many allocations, may then be missed.
4. **Access** stack (where the bad access happened), **free** stack (where the block was freed), **allocate** stack (where it was malloc'd). Together they give the object's full lifecycle.
5. `-fno-omit-frame-pointer` (complete, correct stack traces) and `-g` (debug info so reports show `file:line`). `-O1` is also recommended for sane speed without inlining away frames.
6. `halt_on_error=1` (stop at the first error) and `abort_on_error=1` (so the process exits non-zero / aborts and the job goes red). Without them the run can continue and the job stays green.
7. Use the manual poisoning API: `__asan_unpoison_memory_region` on each chunk you hand out and `__asan_poison_memory_region` on freed chunks / inter-chunk redzones, so ASan can see per-object boundaries inside the pool.
8. ASan + UBSan: **yes** — different mechanisms, commonly built together (`-fsanitize=address,undefined`). ASan + TSan: **no** — they use incompatible shadow/instrumentation schemes and are mutually exclusive; run them as separate builds.

</details>

---

## Cheat Sheet

```
BUILD FLAGS
  -fsanitize=address          instrument + link the ASan runtime (compile AND link)
  -fno-omit-frame-pointer     readable, complete stack traces  (non-negotiable)
  -g                          debug info → file:line in reports
  -O1                         sane speed, keeps frames
  -fsanitize=address,undefined   ASan + UBSan in one build (allowed)

RUNTIME (ASAN_OPTIONS, colon-separated)
  detect_leaks=1                  turn on LeakSanitizer at exit
  halt_on_error=1                 stop at first error  (CI gate)
  abort_on_error=1                abort() → non-zero exit / core  (CI gate)
  detect_stack_use_after_return=1 catch pointer-to-returned-local
  strict_string_checks=1          stricter str*() bounds checks
  symbolize=1                     resolve to file:line
  suppressions=lsan.supp          silence known issues (scope tightly!)
  ASAN_SYMBOLIZER_PATH=...        path to llvm-symbolizer (fixes hex-only reports)

REPORT (read top to bottom)
  error type + READ/WRITE + size   what & how wide
  access stack                     where it blew up   ← start here
  freed by ... here                who freed it       (use-after-free)
  allocated by ... here            who created it
  shadow legend: 00 ok  fa redzone  fd freed  fe stack  f9 global

SHADOW: 1 byte / 8 app bytes;  shadow = (addr>>3)+offset
  00 ok   1..7 first-k ok   negative = poisoned (reason-coded)

MECHANISMS         redzones → overflows   quarantine → use-after-free   shadow → checks
COST               ~2x CPU,  ~3x RSS
COMBINE            +UBSan ✅  +LSan ✅(bundled)  +TSan ❌  +MSan ❌
FAMILY             LSan(leaks)  HWASan(ARM,tagged,sample)  GWP-ASan(prod,sample)  KASAN(kernel)
ESCAPE HATCH       __attribute__((no_sanitize("address")))   /   suppressions file
NATURE             oracle, not a shield — only sees paths you run
```

---

## Summary

- ASan's detector is **shadow memory**: 1 byte per 8 application bytes, addressed by `(addr>>3)+offset`, recording how many of those 8 bytes are addressable. The compiler injects an inline shadow check before every load/store — that's why bugs are caught at the *exact* offending access.
- **Redzones** (poisoned guard bands around every allocation) make overflows land on poison, catching off-by-one reliably. **Quarantine** (delaying reuse of freed memory) makes use-after-free land on poison instead of a recycled object. Both have finite size, which bounds what ASan can see.
- The **report** carries up to three stacks — *access*, *free*, *allocate* — plus a shadow dump and region boundaries. Reading them in order usually pinpoints the fix without guesswork.
- The canonical build is `-fsanitize=address -fno-omit-frame-pointer -g -O1`; runtime behavior is tuned via `ASAN_OPTIONS` (gate CI with `halt_on_error=1:abort_on_error=1`). Escape hatches: `no_sanitize` attributes, suppression/ignore lists, and the manual poison API for custom allocators.
- Cost is **~2× CPU / ~3× RSS** (shadow + redzones + quarantine). ASan **combines with UBSan and bundles LSan**, but is **mutually exclusive with TSan and MSan** — so CI runs separate sanitizer builds.
- ASan is an **oracle, not a production shield**: it only judges executed paths and catches neither data races (TSan) nor all undefined behavior (UBSan). For production-scale coverage, reach for HWASan/GWP-ASan; for path coverage, pair ASan with fuzzing.

---

## Further Reading

- *AddressSanitizer: A Fast Address Sanity Checker* — Serebryany, Bruening, Potapenko, Vyukov (USENIX ATC 2012). The original paper; the source of truth for shadow memory, redzones, and the 2×/3× numbers.
- [Clang AddressSanitizer documentation](https://clang.llvm.org/docs/AddressSanitizer.html) — flags, runtime options, the manual poisoning interface, and platform support.
- [AddressSanitizerAlgorithm (LLVM wiki)](https://github.com/google/sanitizers/wiki/AddressSanitizerAlgorithm) — the instrumentation and shadow-mapping algorithm spelled out.
- `sanitizer/asan_interface.h` — the runtime API: `__asan_poison_memory_region`, `__asan_unpoison_memory_region`, `__asan_address_is_poisoned`.
- [senior.md](senior.md) — the shadow-memory layout in depth, ASan's allocator internals, performance tuning, HWASan/GWP-ASan at fleet scale, and toolchain integration decisions.

---

## Related Topics

- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/middle.md) — the race detector; mutually exclusive with ASan, so it gets its own CI build.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/middle.md) — catches UB ASan can't; happily combines into one `address,undefined` build.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/middle.md) — LSan (bundled with ASan) and the Valgrind alternative.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/middle.md) — fuzzing that feeds ASan the broad inputs it needs to be an effective oracle.
- [Static Analysis & Linting](../../static-analysis/) — the compile-time complement that catches bugs on paths ASan never runs.
