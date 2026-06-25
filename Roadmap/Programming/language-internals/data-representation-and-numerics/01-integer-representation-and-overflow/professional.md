# Integer Representation & Overflow — Professional Level

> **Topic:** [Integer Representation & Overflow](README.md)
> **Focus:** Production war stories, security exploitation, performance, and debugging — the real incidents (Boeing 787, Ariane 5, YouTube's counter, the integer-overflow-to-heap-overflow CVE pattern), the tooling that finds these bugs at scale, and how to harden a codebase against them.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [War Stories: Real Incidents](#war-stories-real-incidents)
6. [Security: Overflow as an Exploit Primitive](#security-overflow-as-an-exploit-primitive)
7. [Mental Models](#mental-models)
8. [Code Examples](#code-examples)
9. [Performance](#performance)
10. [Detection & Tooling](#detection--tooling)
11. [Pros & Cons](#pros--cons)
12. [Use Cases](#use-cases)
13. [Coding Patterns](#coding-patterns)
14. [Best Practices](#best-practices)
15. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Debugging Playbook](#debugging-playbook)
18. [Test Yourself](#test-yourself)
19. [Tricky Questions](#tricky-questions)
20. [Cheat Sheet](#cheat-sheet)
21. [Summary](#summary)
22. [Further Reading](#further-reading)
23. [Related Topics](#related-topics)
24. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Integer overflow is not an academic curiosity — it has grounded aircraft, destroyed a rocket, broken planet-scale services, and is the root cause behind an entire taxonomy of memory-corruption vulnerabilities (CWE-190).** At the professional level, you must recognize the *shapes* of these failures in code review, exploit-mitigate them in security-sensitive code, and have a debugging playbook for when one slips into production.

A 32-bit counter that overflows is, in the abstract, a five-line example. In production it is: a Boeing 787 whose generator control units must be power-cycled before a counter overflows at 248 days, lest all four units fail simultaneously mid-flight. It is the Ariane 5 maiden flight, lost 37 seconds after launch because a 64-bit float was converted to a 16-bit signed integer that overflowed. It is PSY's "Gangnam Style" forcing YouTube to migrate its view counter from 32-bit to 64-bit when it passed 2,147,483,647 views. It is `malloc(count * size)` where `count * size` wraps to a small allocation, followed by a write of `count` elements — a heap buffer overflow that an attacker turns into remote code execution.

The professional's job has three parts:

1. **Pattern recognition.** Size calculations, length fields from untrusted sources, counters with no upper bound, conversions across widths at trust boundaries, time/tick counters. These are where overflow becomes an incident. You learn to flag them on sight.

2. **Mitigation in depth.** Checked arithmetic on size math, width choices that make overflow impossible within the system's lifetime, validation at every boundary, compiler hardening (`-ftrapv`/UBSan in CI, `-fsanitize=integer` fuzzing), and language choices that remove the footgun.

3. **Forensics.** When the wrong number appears in production — a negative balance, a tiny allocation, a hung device — you need a process: capture the value, find the operation, identify the width, reproduce at the boundary, and fix the *root* (the unchecked operation), not the symptom.

This page is the field manual.

---

## Prerequisites

- **Required:** Junior/middle/senior pages — representation, conversions, detection, UB semantics, the `INT_MIN` family.
- **Required:** Experience reading core dumps / crash reports and a debugger (gdb/lldb) or a managed-runtime equivalent.
- **Helpful:** Exposure to a security or SRE incident involving a numeric bug.
- **Helpful:** Familiarity with fuzzing and sanitizers in a CI pipeline.

---

## Glossary

| Term | Definition |
|------|-----------|
| **CWE-190** | The MITRE weakness class "Integer Overflow or Wraparound." The umbrella for these vulnerabilities. |
| **CWE-191** | "Integer Underflow" — the unsigned `0 − 1` → huge family. |
| **CWE-680** | "Integer Overflow to Buffer Overflow" — the size-math-wraps-then-write pattern. |
| **Allocation-size overflow** | `count * size` (or `n + header`) overflowing to a small value, leading to undersized buffers. |
| **Heap grooming** | Shaping the heap so an overflow corrupts an attacker-chosen adjacent object. |
| **UBSan** | UndefinedBehaviorSanitizer; `-fsanitize=integer` catches signed/unsigned overflow at runtime. |
| **Fuzzing** | Feeding randomized/structured inputs to find crashes; pairs with sanitizers to surface overflow. |
| **`calloc` overflow check** | `calloc(n, size)` is required to detect `n*size` overflow and fail — unlike `malloc(n*size)`. |
| **Time-of-check counter** | A monotonically increasing tick/sequence/epoch counter; overflow is a latent time bomb. |
| **Saturating cast** | A narrowing conversion that clamps out-of-range values instead of truncating. |
| **Defense in depth** | Layering width choice + validation + checked ops + sanitizers so no single miss is fatal. |

---

## Core Concepts

### 1. The Five Shapes That Become Incidents

Almost every production integer-overflow incident is one of these:

| Shape | Example | Failure |
|-------|---------|---------|
| **Unbounded counter** | uptime ticks, view count, sequence number | wraps after a fixed time/volume → hang, reset, wrong value |
| **Size/allocation math** | `malloc(count * elem_size)` | wraps to small alloc → buffer overflow (CWE-680) |
| **Untrusted length field** | packet/file declares `len`, code trusts it | overflow in `len + offset` → OOB read/write |
| **Cross-width conversion** | 64-bit value stored in 16/32-bit field | truncation → wrong value, possibly negative |
| **Signed/unsigned boundary** | signed length compared to unsigned size | comparison inverts → bounds check bypassed |

When you review code, you are hunting for these five. Everything below is detail on each.

### 2. Why "Just Use 64-bit" Is Often (But Not Always) the Right Fix

A 64-bit counter incremented a billion times per second lasts ~585 years; for uptime, view counts, sequence numbers, it makes overflow physically impossible within any system's lifetime. This is why the durable fix for YouTube's view counter, for most database row IDs, and for monotonic clocks is "widen to 64-bit." But it is *not* universal:

- **Multiplication still overflows 64-bit** trivially (`2³² × 2³³`), so size math needs checks regardless of width.
- **Wire/format compatibility** may fix the width (a protocol field is 32-bit); you can't just widen it.
- **Memory/cache pressure** in huge arrays of small integers can make 64-bit costly.
- **The bug may be a *logic* error** (treating a length as signed) that widening doesn't fix.

So: widen counters by default, but *check* arithmetic that multiplies or that crosses trust boundaries.

### 3. The Allocation-Size Pattern in Full

The canonical exploit chain (CWE-680):

```c
// VULNERABLE
void *buf = malloc(count * size);   // count attacker-controlled
for (size_t i = 0; i < count; i++)
    buf[i] = read_element();        // writes `count` elements
```

If `count * size` overflows `size_t`, `malloc` returns a *small* buffer, but the loop writes `count` (large) elements — a heap overflow. The standard library gives you the fix: `calloc(count, size)` is *required* to detect the multiplication overflow and return `NULL`. Modern code uses `calloc`, `reallocarray` (BSD/glibc), `__builtin_mul_overflow`, or C23 `ckd_mul`. This single pattern accounts for a large fraction of historical CVEs in image parsers, font renderers, and codecs.

### 4. Trust Boundaries Are Where Validation Lives

A length, count, or offset from a file, network packet, IPC message, or user form is **attacker-controlled**. The rule: **validate ranges immediately at the boundary, before any arithmetic.** A `width * height * bytes_per_pixel` in an image decoder, a `num_entries` in a font table, a `Content-Length` — each must be bounds-checked against a sane maximum *and* checked for overflow in the derived computation. "We'll catch it later" fails because the overflow happens in the very next line.

### 5. Time and Tick Counters: The Silent Bombs

Counters that increment with time are the most insidious because they pass every test (no test runs for 248 days) and detonate on a schedule:

- **Boeing 787 (2015):** a 32-bit counter in the Generator Control Units incremented every 10 ms. After 2³¹ centiseconds ≈ 248.55 days of continuous power, it overflowed, putting the GCUs into a fail-safe that shut down all four — total loss of AC electrical power, potentially in flight. FAA mandated periodic power cycling until a software fix.
- **Year 2038 (Y2038):** `time_t` as a signed 32-bit counts seconds since 1970; it overflows on 2038-01-19, wrapping to 1901. Still being remediated across embedded systems.
- **GPS week rollover:** a 10-bit week counter wrapped in 1999 and 2019.

The lesson: any counter tied to wall-clock or tick time needs a width chosen so overflow is centuries away, *and* an explicit comment stating the rollover horizon.

---

## War Stories: Real Incidents

### Ariane 5 Flight 501 (1996) — conversion overflow, $370M lost

37 seconds after liftoff, the rocket's inertial reference system tried to convert a 64-bit floating-point horizontal-velocity value into a **16-bit signed integer**. The Ariane 5 flew faster than the Ariane 4 the software was reused from; the value exceeded 32,767, the conversion overflowed, the resulting operand error wasn't handled, the primary and backup IRS both shut down, the guidance went haywire, and the self-destruct fired. Root cause: an unprotected narrowing conversion plus reuse of code outside its validated input range. The professional lesson: **conversions are arithmetic; validate the source range before narrowing, and never assume reused code's input envelope still holds.**

### Boeing 787 GCU (2015) — 248-day counter overflow

As above: a 32-bit centisecond counter overflowing at ~248.55 days made all four generator control units fail simultaneously. The fix was deployed as a software update; the interim mitigation was mandatory periodic power-down. Lesson: **tick counters need 64-bit width and a documented rollover horizon; "it never ran that long in testing" is exactly why these ship.**

### YouTube / "Gangnam Style" (2014) — 32-bit view counter

The view count was stored in a signed 32-bit integer, capping at 2,147,483,647. "Gangnam Style" blew past it. Google migrated the counter to 64-bit (and joked about it publicly). No safety impact, but a clean illustration that **real-world counts outgrow 32 bits** — anything user-facing and viral needs 64-bit from day one.

### Pac-Man "kill screen" (1980) — level counter overflow

Level 256 corrupts because the level counter is a single byte; the fruit-drawing routine multiplies the level and overflows, garbling the right half of the maze into an unplayable mess. A benign-but-iconic example of **an 8-bit counter meeting a value its designers never imagined.**

### Donkey Kong / many arcade games

Similar single-byte overflows produce kill screens. The pattern recurs because early hardware used the narrowest type that "obviously" sufficed.

### The "binary search is broken" disclosure (Bloch, 2006)

`int mid = (low + high) / 2;` in `java.util.Arrays.binarySearch` (and most textbooks) overflows when `low + high > INT_MAX`, i.e., on arrays larger than ~1 billion elements. It lay dormant for years because arrays that big were rare. Fix: `low + (high - low) / 2`. Lesson: **even canonical, reviewed, library-grade code harbors overflow at the extremes.**

---

## Security: Overflow as an Exploit Primitive

Integer overflow is rarely the *final* bug — it's the *enabler* of a memory-corruption bug. The chains:

### Chain 1: Integer overflow → heap buffer overflow (CWE-190 → CWE-680 → RCE)

```text
attacker controls `count`
   → count * size overflows to small value
   → malloc(small) returns undersized buffer
   → loop writes `count` (large) elements
   → heap overflow corrupts adjacent metadata/object
   → attacker grooms heap → controls a function pointer / vtable
   → remote code execution
```

This is the shape behind countless CVEs in libpng, libjpeg, FreeType, ffmpeg, OpenSSL, and the kernel. The mitigation is *upstream*: detect the multiplication overflow before allocating.

### Chain 2: Integer underflow → out-of-bounds (CWE-191)

```text
attacker sends len = 0 (or len < header_size)
   → remaining = len - header_size  underflows to huge unsigned
   → memcpy(dst, src, remaining)  copies enormous amount
   → out-of-bounds read (info leak) or write (corruption)
```

Heartbleed (CVE-2014-0160) is morally this family: a length field was trusted without validating it against the actual payload, leaking up to 64 KB of adjacent memory per request.

### Chain 3: Signed/unsigned confusion → bounds-check bypass

```text
bounds check: if (offset < buffer_size) { ... }   // offset signed, size unsigned
   → attacker supplies negative offset
   → offset converts to huge unsigned, OR the check uses signed compare
   → check passes when it shouldn't → OOB access
```

### Defensive posture for security-critical code

- **Treat every externally-supplied integer as hostile.** Validate against an explicit maximum at the boundary.
- **Use overflow-checked allocation** (`calloc`, `reallocarray`, `ckd_mul`).
- **Compile with `-fsanitize=integer` in fuzzing**, and harden production with `-ftrapv` or `-fsanitize=signed-integer-overflow -fsanitize-trap` where the abort is acceptable.
- **Prefer memory-safe languages** (Rust, Go) for new parsers; they at minimum turn the overflow into a panic/defined-wrap rather than silent corruption, and bounds checks remain.

---

## Mental Models

### The "Untrusted Until Proven" Model

Every integer that crosses into your code from outside is a **negative number, a huge number, and zero, all at once** until you've validated it. Design the boundary so the first thing that happens to a length/count/offset is a range check, not arithmetic. If arithmetic happens first, you've already lost.

### The "Width Is a Lifetime Budget" Model

A counter's width is a *time/volume budget*. 32 bits at 100 Hz = 248 days (the 787). 32 bits of views = ~2.1 billion (Gangnam Style). 64 bits ≈ effectively infinite for counts and ticks. When you pick a width, *compute the rollover horizon* and write it down. If the horizon is shorter than the system's lifetime, you've planted a bomb.

### The "Overflow Enables, It Doesn't Crash" Model

In security, the dangerous overflow doesn't crash — it *succeeds quietly* and hands the attacker a primitive. A small allocation that "works," a bounds check that "passes," a memcpy length that's "valid." Train yourself to see overflow not as a crash but as a *silent state corruption that the next operation weaponizes.*

---

## Code Examples

### C — The vulnerable allocation and three fixes

```c
#include <stdlib.h>
#include <stdckdint.h>   // C23

// VULNERABLE
void *alloc_bad(size_t count, size_t size) {
    return malloc(count * size);          // count*size can wrap → tiny buffer
}

// FIX 1: calloc detects the multiply overflow and returns NULL
void *alloc_calloc(size_t count, size_t size) {
    return calloc(count, size);
}

// FIX 2: builtin overflow check (GCC/Clang)
void *alloc_builtin(size_t count, size_t size) {
    size_t bytes;
    if (__builtin_mul_overflow(count, size, &bytes)) return NULL;
    return malloc(bytes);
}

// FIX 3: C23 checked integer
void *alloc_ckd(size_t count, size_t size) {
    size_t bytes;
    if (ckd_mul(&bytes, count, size)) return NULL;
    return malloc(bytes);
}
```

### C — Validating an untrusted length at the boundary

```c
#include <stdint.h>
#include <string.h>

#define MAX_PAYLOAD (1u << 20)   // 1 MiB sane cap

int handle_packet(const uint8_t *pkt, size_t pkt_len) {
    if (pkt_len < 4) return -1;                 // need at least a header
    uint32_t declared = read_u32(pkt);          // attacker-controlled length field
    if (declared > MAX_PAYLOAD) return -1;       // cap it
    if ((size_t)declared > pkt_len - 4) return -1; // must fit in what we actually got
    // ONLY NOW is arithmetic on `declared` safe:
    uint8_t *body = malloc(declared);
    if (!body) return -1;
    memcpy(body, pkt + 4, declared);
    /* ... */
    free(body);
    return 0;
}
```

The `pkt_len - 4` is itself guarded by the earlier `pkt_len < 4` check, preventing the underflow that would make the comparison trivially pass.

### Rust — A parser that can't silently overflow

```rust
const MAX_PAYLOAD: usize = 1 << 20;

fn handle_packet(pkt: &[u8]) -> Result<Vec<u8>, &'static str> {
    if pkt.len() < 4 { return Err("short"); }
    let declared = u32::from_be_bytes(pkt[0..4].try_into().unwrap()) as usize;
    if declared > MAX_PAYLOAD { return Err("too large"); }
    // checked_add / slicing both bounds-check; no silent overflow possible:
    let end = 4usize.checked_add(declared).ok_or("overflow")?;
    let body = pkt.get(4..end).ok_or("truncated")?;
    Ok(body.to_vec())
}
```

Rust gives bounds-checked slicing and `checked_add`; even in release mode the slice access can't go OOB silently — the worst case is a clean `Err`/panic, not memory corruption.

### Go — Defined wrap, but you still validate

```go
func handlePacket(pkt []byte) ([]byte, error) {
	if len(pkt) < 4 {
		return nil, errors.New("short")
	}
	declared := int(binary.BigEndian.Uint32(pkt[0:4]))
	const maxPayload = 1 << 20
	if declared < 0 || declared > maxPayload { // declared<0 guards int conversion on 32-bit
		return nil, errors.New("bad length")
	}
	if declared > len(pkt)-4 {
		return nil, errors.New("truncated")
	}
	body := make([]byte, declared)
	copy(body, pkt[4:4+declared])
	return body, nil
}
```

Go's slice bounds checks catch OOB at runtime (panic, not corruption), but the explicit validation prevents the panic and the logic bug.

### Java — width choice + checked math for the safety path

```java
long widenCounter = 0L;                 // 64-bit: ~585 years at 1e9/s

// For derived size math that must not silently wrap:
int bytes;
try {
    bytes = Math.multiplyExact(count, elementSize);   // throws on overflow
} catch (ArithmeticException e) {
    throw new IllegalArgumentException("allocation size overflow", e);
}
```

---

## Performance

- **Checked arithmetic is nearly free.** `__builtin_add_overflow` compiles to `add; jo` — one instruction plus a predictable-not-taken branch. The branch predictor learns "no overflow" and the cost vanishes on the hot path. Measure before assuming checks are expensive; they almost never are.
- **UBSan/`-ftrapv` in production has real cost** (extra checks on every operation), which is why you run them in *CI and fuzzing*, and ship either nothing, targeted `ckd_*`/builtins, or `-fsanitize=...-trap` only on the modules that need it.
- **`-fwrapv` can *cost* performance** by disabling overflow-assuming optimizations (loop vectorization, induction-variable widening). It's a correctness/speed trade; the kernel accepts it, hot numeric loops may not.
- **Bignums are O(n) in digit count and allocate.** A "just use BigInteger" fix can turn a constant-time inner loop into an allocator-bound one. Profile.
- **Saturating arithmetic** is one instruction on SIMD (`paddsb`, NEON `sqadd`) but compare+cmov in scalar code — fine, but not literally free.
- **64-bit vs 32-bit counters** are the same speed on 64-bit CPUs for scalars; the only cost is cache footprint in large arrays.

---

## Detection & Tooling

| Tool | What it catches | When to run |
|------|-----------------|-------------|
| **UBSan `-fsanitize=signed-integer-overflow`** | signed overflow at the exact line/values | CI tests, fuzzing |
| **UBSan `-fsanitize=unsigned-integer-overflow`** | unsigned wrap (opt-in; wrap is legal, so noisy) | targeted audits |
| **`-ftrapv`** | traps on signed overflow (older, coarser than UBSan) | hardened builds |
| **`-Wsign-compare` / `-Wconversion`** | signed/unsigned comparisons, lossy conversions | every build |
| **Coverity / CodeQL / Semgrep** | overflow-prone size math, untrusted length flows | CI static analysis |
| **libFuzzer / AFL++ + sanitizers** | overflow reachable from inputs | fuzzing harnesses |
| **Rust debug builds / `cargo test`** | overflow panics by default | dev + CI |
| **`go test -race` (not overflow) / `go vet`** | some conversion mistakes | CI |
| **Valgrind/ASan** | the *consequence* (heap overflow) when overflow leads to OOB | CI, repro |

Professional posture: **`-Wsign-compare -Wconversion` on every build**, **UBSan + fuzzing in CI**, **static analysis (CodeQL/Semgrep) flagging `malloc(a*b)` and untrusted-length flows**, and **Rust/Go for new parsers** where feasible.

---

## Pros & Cons

| Decision | Pros | Cons |
|----------|------|------|
| **Widen counters to 64-bit** | Removes the time-bomb class; cheap on 64-bit CPUs. | Doesn't fix multiplication or logic errors; cache cost in big arrays; can't change fixed wire widths. |
| **Checked size math everywhere** | Eliminates the CWE-680 chain; near-zero runtime cost. | Verbose; relies on developers remembering (use lints to enforce). |
| **`calloc`/`reallocarray` for arrays** | Standard, overflow-safe allocation. | Must consistently replace `malloc(a*b)`; legacy code is everywhere. |
| **UBSan/fuzzing in CI** | Finds latent overflow before ship. | Runtime cost (CI only); unsigned overflow is noisy (legal wrap). |
| **`-ftrapv` in production** | Turns silent corruption into a clean crash. | Performance cost; a crash is a DoS — weigh availability vs integrity. |
| **Rust/Go for parsers** | Panic/defined-wrap + bounds checks instead of RCE. | Rewrite cost; FFI boundaries reintroduce risk. |

---

## Use Cases

- **Media/format parsers (image, font, video, archive):** the #1 home of overflow CVEs. Checked size math, validated dimensions, fuzzing — non-negotiable.
- **Network protocol handlers:** untrusted length/offset fields; validate at the boundary, guard the derived arithmetic.
- **Allocators and serialization libraries:** `count * size` everywhere; overflow-safe by construction.
- **Embedded / avionics / industrial control:** tick counters with multi-year uptime; width chosen for the mission lifetime, rollover documented, watchdog as backstop.
- **Financial ledgers:** integer cents with checked arithmetic; an overflow is a reconciliation incident, never a silent wrap.
- **Databases:** 64-bit (or bigint) row IDs and sequences; the 32-bit `int` PK that "won't run out" is a recurring outage.

---

## Coding Patterns

### Pattern 1: Overflow-safe array allocation (every language)

```c
if (__builtin_mul_overflow(n, sz, &bytes)) return ERR;  // C
p = malloc(bytes);
```
```rust
let bytes = n.checked_mul(sz).ok_or(Err)?;              // Rust
```
```java
int bytes = Math.multiplyExact(n, sz);                  // Java (throws)
```

### Pattern 2: Boundary validation template

```text
1. enough_bytes?      (len >= header)           // guard before any subtraction
2. declared <= MAX?   (sane cap)                // bound the value
3. declared <= remaining? (fits in actual data) // consistency
4. THEN compute / allocate / copy
```

### Pattern 3: Document the rollover horizon

```go
// monotonicTicks increments at 100 Hz. uint64 rolls over in ~5.8e9 years.
// (A uint32 here would roll over in 497 days — see Boeing 787 GCU, 2015.)
var monotonicTicks uint64
```

### Pattern 4: Saturating cast for narrowing telemetry

```rust
// Clamp instead of truncate when a metric exceeds the wire field:
let wire: u16 = value.try_into().unwrap_or(u16::MAX);   // saturate to max
```

### Pattern 5: Fail closed on conversion error at trust boundaries

```rust
let len = u32::try_from(declared).map_err(|_| Error::BadLength)?;  // reject, don't truncate
```

---

## Best Practices

- **Validate-then-compute at every trust boundary.** The first operation on an untrusted integer is a range check, never arithmetic.
- **Replace `malloc(a*b)` with `calloc`/`reallocarray`/`ckd_mul`** across the codebase; lint to keep it replaced.
- **Default counters/IDs/ticks to 64-bit** and *write down the rollover horizon* next to the declaration.
- **Compile with `-Wsign-compare -Wconversion` and treat warnings as errors;** add UBSan + fuzzing to CI.
- **Use checked arithmetic for size and money math;** the runtime cost is negligible versus the incident cost.
- **Prefer memory-safe languages for new attack-surface code;** at FFI boundaries, re-validate.
- **In avionics/embedded, pair the width choice with a watchdog** so a missed horizon degrades safely.
- **Write boundary tests at MAX/MIN/0/−1**, not just typical values — overflow only lives at the extremes.

---

## Edge Cases & Pitfalls

- **`len - header` underflow** when `len < header`: guard the subtraction's precondition first.
- **`calloc(0, x)` / `malloc(0)`** may return `NULL` or a unique pointer; handle both, and don't treat zero-size as an error blindly.
- **32-bit `time_t` (Y2038)** in embedded/legacy: still a live bomb; audit for `time_t`, `tv_sec`, NTP, filesystem timestamps.
- **Truncating a 64-bit DB id into a 32-bit API field** silently corrupts at 2.1 billion rows.
- **Signed length from an API that returns −1 on error** compared to an unsigned size: the −1 becomes huge and passes the bound.
- **`-ftrapv` turns integrity bugs into availability bugs** — a trap is a crash; for a DoS-sensitive service that may be worse, so decide per threat model.
- **Bignum "fixes" in crypto** reintroduce timing side channels; never on secret-dependent paths.
- **Wrapping in a hash/CRC that you then *checked*** — you broke the algorithm by rejecting legitimate wrap.

---

## Common Mistakes

1. **`malloc(count * size)` with untrusted `count`.** The single most exploited overflow shape; use `calloc`/`ckd_mul`.
2. **Trusting a length field before validating it.** Heartbleed-shaped bugs.
3. **32-bit counter on a long-running or viral quantity.** Boeing/YouTube. Default to 64-bit.
4. **Truncating across a width boundary without a fits-check.** Ariane 5.
5. **Comparing signed-from-API against unsigned size.** Bounds-check bypass.
6. **Fixing the symptom (clamp the output) not the root (unchecked op).** The overflow is still there for the next call site.
7. **Assuming Go/Java's defined wrap is "safe."** It's defined, not correct; you still get wrong numbers and exploitable logic.
8. **Running UBSan only locally, never in CI/fuzzing.** Latent overflow ships because the path wasn't exercised.

---

## Debugging Playbook

When a wrong/negative/tiny number appears in production:

1. **Capture the offending value and its type/width.** The actual bits matter — `−2147483648` screams "32-bit signed wrap from INT_MAX"; a huge near-`2³²` value screams "unsigned underflow."
2. **Identify the operation.** Walk back from the symptom to the arithmetic that produced it: an addition, a multiplication (size math), a subtraction (underflow), or a conversion (truncation).
3. **Check the width and signedness at that point.** Was a 64-bit value forced into 32 bits? A signed compared to unsigned? A `size_t` subtracted below zero?
4. **Reproduce at the boundary.** Construct the input that drives the operand to MAX/MIN/0. If you can't reproduce, you haven't found it.
5. **Confirm with a sanitizer.** Re-run under UBSan/ASan; it pinpoints the exact line and operands. For managed runtimes, add a checked-arithmetic assertion at the suspect op.
6. **Fix the root, add a regression test at the boundary, and sweep for siblings.** The same pattern (`a*b` allocations, untrusted lengths) usually recurs elsewhere in the codebase; grep for it.

Signature values worth memorizing:
- `−2147483648` (`0x80000000`) → 32-bit signed overflow from the top.
- `4294967295` / `4294967xxx` → unsigned 32-bit underflow (`0 − small`).
- `18446744073709551xxx` → unsigned 64-bit underflow.
- A small allocation followed by a large write → size-math overflow.

---

## Test Yourself

1. Given `malloc(count * size)` with attacker-controlled `count`, write the exact input that produces a 16-byte allocation followed by a 4 GB write, and rewrite the allocation three safe ways.
2. The Boeing 787 counter overflowed at 248.55 days at 100 Hz. Show the arithmetic (`2³¹ / 100 / 86400`). What width makes the horizon > 100 years?
3. A service returns a negative balance after a large deposit. Walk the debugging playbook: what value, what op, what width, what input reproduces it?
4. Explain how Heartbleed's missing length validation maps onto the CWE-191 underflow / trusted-length family.
5. Why does `calloc(n, size)` protect against the overflow that `malloc(n * size)` doesn't? What does the standard require of `calloc`?
6. You see `4294967290` in a log. What operation most likely produced it, and on what type? What input would you craft to reproduce?
7. Trade-off: a payments service can ship with `-ftrapv` (crash on overflow) or defined wrap. Argue both sides in terms of integrity vs availability.
8. Audit this line for the five incident shapes: `int total = header_size + width * height * bpp;` from an image decoder. List every overflow it can suffer.

---

## Tricky Questions

**Q1: Is widening every counter to 64-bit a complete fix for integer overflow?**

No. It eliminates the *unbounded-counter* and most *time-bomb* shapes (counts/ticks won't overflow in any realistic lifetime), but multiplication still overflows 64-bit easily (size math), fixed wire/format widths can't be widened, and logic errors (signed/unsigned confusion, untrusted lengths) are untouched. Widen counters by default *and* check multiplicative/boundary arithmetic.

**Q2: Why is `calloc` safer than `malloc(a*b)`?**

The C standard requires `calloc(nmemb, size)` to detect overflow of `nmemb * size` and return `NULL` rather than allocating an undersized buffer. `malloc` takes a single already-computed size, so the overflow happened in the caller before `malloc` ever saw it. `reallocarray` (BSD/glibc) and C23 `ckd_mul` give the same protection for the non-zeroing case.

**Q3: We use Go/Java, where overflow is defined to wrap. Are we safe from these CVEs?**

Safer from *memory corruption* — Go and Java have bounds-checked arrays, so an overflow leads to a panic/exception, not silent OOB write and RCE. But you are *not* safe from *logic* exploits: a wrapped size or count can still bypass an application-level check, cause a wrong allocation size, or corrupt business state (a negative balance). Defined wrap removes the worst (memory-unsafe) outcome, not the bug.

**Q4: Should a payments service compile with `-ftrapv`?**

It's a threat-model decision. `-ftrapv` converts a silent integer-overflow (potential wrong-money integrity violation) into a clean crash (availability hit). For money, integrity usually beats availability — a crash with an alert is preferable to silently crediting a wrapped balance. But measure the perf cost and ensure the crash path is graceful (transaction rolled back, alert fired). Many teams prefer targeted `Math.*Exact`/`ckd_*` over a blanket flag, getting the integrity guarantee without the global cost.

**Q5: How did the Ariane 5 overflow actually cause loss of the vehicle?**

A 64-bit float horizontal-velocity value (larger on Ariane 5 than the Ariane-4-validated range) was converted to a 16-bit signed integer; the conversion overflowed, raising an unhandled operand-error exception that shut down the active inertial reference system *and* its identically-programmed backup. With no valid guidance, the rocket veered, aerodynamic loads triggered breakup, and the self-destruct fired. The integer overflow was the trigger; the lack of input-range validation and the identical-backup design were the systemic failures.

**Q6: Where in a parser do you put the overflow check?**

At the trust boundary, *before* any arithmetic on the untrusted value: validate the declared length/count/dimensions against a sane maximum and against the data actually available, then guard each derived computation (`a*b`, `len-header`, `offset+size`) with checked arithmetic. Checking after computing is too late — the overflow already happened, and in C it's already UB.

**Q7: A flame graph shows `__builtin_mul_overflow` checks aren't even visible. Why are people afraid of checked arithmetic's cost?**

Folklore and a misread of the worst case. The check is `mul; jo` — one instruction plus a branch the predictor pins as not-taken, so it's effectively free on the hot path. The fear comes from conflating it with `-ftrapv`/UBSan *global* instrumentation (which checks *every* op and does cost), or with bignum fallbacks. Targeted checked ops on size/money math are not a measurable cost in almost any real workload.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            OVERFLOW IN PRODUCTION — FIELD MANUAL                 │
├──────────────────────────────────────────────────────────────────┤
│ FIVE INCIDENT SHAPES (hunt these in review):                    │
│  1. unbounded counter   → widen to 64-bit, document horizon     │
│  2. size math a*b       → calloc / ckd_mul / checked_mul        │
│  3. untrusted length    → validate at boundary BEFORE math      │
│  4. cross-width convert → fits-check then narrow (Ariane 5)     │
│  5. signed/unsigned cmp → -Wsign-compare, guard the sign        │
├──────────────────────────────────────────────────────────────────┤
│ EXPLOIT CHAINS:                                                 │
│  overflow → tiny alloc → big write → heap overflow → RCE (190/680)│
│  underflow → huge memcpy len → OOB read/write (191, Heartbleed)  │
│  signed/unsigned → bounds-check bypass                          │
├──────────────────────────────────────────────────────────────────┤
│ INCIDENTS:                                                      │
│  Ariane 5   : f64 → i16 narrowing overflow → $370M             │
│  Boeing 787 : 32-bit centisecond ctr → 248-day GCU failure     │
│  YouTube    : 32-bit view count capped at 2.1B                 │
│  Y2038      : signed 32-bit time_t wraps 2038-01-19            │
│  binary srch: (lo+hi)/2 overflows → lo+(hi-lo)/2              │
├──────────────────────────────────────────────────────────────────┤
│ TOOLING:  -Wsign-compare -Wconversion (always)                  │
│           UBSan + fuzzing (CI)  ·  CodeQL/Semgrep (static)      │
│           calloc/reallocarray/ckd_*  ·  Rust/Go for parsers     │
├──────────────────────────────────────────────────────────────────┤
│ SIGNATURE VALUES IN LOGS:                                       │
│  -2147483648 → i32 overflow from top                           │
│  ~4294967295 → u32 underflow (0 - small)                       │
│  tiny alloc + big write → size-math overflow                   │
├──────────────────────────────────────────────────────────────────┤
│ Checked arithmetic ≈ FREE (add; jo). Fear is folklore.         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Integer overflow in production takes **five recognizable shapes**: unbounded counters, size math, untrusted lengths, cross-width conversions, and signed/unsigned comparisons. Code review is pattern-hunting for these.
- The incidents are **real and severe**: Ariane 5 (narrowing overflow, $370M), Boeing 787 (248-day tick counter), YouTube (32-bit views), Y2038 (signed `time_t`), and the binary-search midpoint bug — even library-grade code fails at the extremes.
- In **security**, overflow is an *enabler*: it produces a tiny allocation, a passed bounds check, or a huge memcpy length that the next operation weaponizes into heap overflow (CWE-190→680→RCE) or OOB read (CWE-191, Heartbleed-shaped).
- **Defense in depth:** validate ranges at trust boundaries *before* arithmetic, use overflow-safe allocation (`calloc`/`reallocarray`/`ckd_mul`), default counters to 64-bit with a documented rollover horizon, and check size/money math.
- **Tooling at scale:** `-Wsign-compare -Wconversion` always; UBSan + fuzzing in CI; static analysis (CodeQL/Semgrep) for the size-math and untrusted-length patterns; memory-safe languages for new parsers.
- **Performance fear is mostly folklore:** targeted checked arithmetic compiles to `add; jo` and is effectively free; the costly tools (`-ftrapv`, UBSan) belong in CI/fuzzing, not necessarily production.
- **Debugging is a playbook:** capture the value (its bits reveal the width/sign), find the operation, check width/signedness, reproduce at the boundary, confirm with a sanitizer, fix the root, and sweep for siblings.
- The professional reflex: **defined-wrap is not safe, widening is not a complete fix, and every untrusted integer is hostile until range-checked.**

---

## Further Reading

- MITRE CWE-190 (Integer Overflow), CWE-191 (Underflow), CWE-680 (Integer Overflow to Buffer Overflow) — the canonical taxonomy with real CVE examples.
- *Secure Coding in C and C++* — Robert Seacord. The professional reference for these vulnerability classes.
- "ARIANE 5 Flight 501 Failure" — Report by the Inquiry Board (Lions report), 1996. Required reading.
- FAA Airworthiness Directive 2015-09-07 (Boeing 787 GCU 248-day counter).
- "Extra, Extra - Read All About It: Nearly All Binary Searches and Mergesorts are Broken" — Joshua Bloch, 2006.
- The Heartbleed bug (CVE-2014-0160) writeups — the length-validation failure family.
- *The CERT C Coding Standard* — INT30-C through INT35-C.
- OpenBSD `reallocarray(3)` and glibc `calloc` overflow-check documentation.
- "Understanding Integer Overflow in C/C++" — Wang, Chen, Wei, Zhang (a study of overflow in real software).

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Security: `../../../quality-engineering/static-analysis/sast/professional.md` — finding overflow flows at scale; `../../../quality-engineering/dynamic-analysis-and-sanitizers/professional.md` — UBSan and fuzzing in CI.
- Sibling numerics: [Floating-Point Representation](../02-floating-point-ieee-754/professional.md) (the Ariane-5 *source* type).
- Reliability: `../../../quality-engineering/engineering-metrics-and-dora/professional.md` — incident postmortems and error budgets.

---

## Diagrams & Visual Aids

### The Integer-Overflow-to-RCE Chain (CWE-190 → 680)

```text
   attacker input: count = 0x1_0000_0001, size = 0x10
        │
        ▼
   count * size  ──(wraps size_t)──►  0x10   (16 bytes)
        │
        ▼
   malloc(16)  ──►  tiny heap buffer
        │
        ▼
   loop writes `count` (4 billion+) elements
        │
        ▼
   HEAP OVERFLOW → corrupt adjacent chunk metadata / vtable
        │
        ▼
   heap grooming → control flow hijack → REMOTE CODE EXECUTION
```

### The Counter Time-Bomb (Boeing 787)

```text
   32-bit counter, +1 every 10 ms (100 Hz)
   horizon = 2^31 ticks / 100 Hz / 86400 s ≈ 248.55 days
        │
        ▼
   day 248: counter hits 2^31 → wraps
        │
        ▼
   all four GCUs enter fail-safe SIMULTANEOUSLY
        │
        ▼
   total loss of AC electrical power

   fix: 64-bit horizon = 2^63 / 100 / 86400 / 365 ≈ 2.9 BILLION years
```

### Validate-Then-Compute at the Trust Boundary

```text
  untrusted len/count/offset
        │
        ▼
   [1] enough bytes?  (len >= header)      ── guard subtraction
        │ yes
        ▼
   [2] len <= MAX?    (sane cap)           ── bound the value
        │ yes
        ▼
   [3] len <= remaining? (fits real data)  ── consistency
        │ yes
        ▼
   [4] checked arithmetic / allocate / copy   ← ONLY arithmetic happens here
```

### Signature Values: Reading Overflow From a Log

```text
   -2147483648  (0x80000000)  → i32 overflowed from the top (INT_MAX + 1)
   4294967295   (0xFFFFFFFF)  → u32 underflow: 0 - 1
   4294967290   (0xFFFFFFFA)  → u32 underflow: 0 - 6
   tiny alloc + huge write    → size-math (a*b) overflow
   18446744073709551610       → u64 underflow: 0 - 6
```
