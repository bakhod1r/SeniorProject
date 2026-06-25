# Boxing, Tagging & NaN-Boxing — Senior Level

> **Topic:** [Boxing, Tagging & NaN-Boxing](README.md)
> **Focus:** Designing a complete value representation for a dynamic-language runtime — building a full NaN-boxed `Value`, comparing boxing vs tagging vs NaN-boxing as engineering design points, the "nun-boxing" inverse, and how the choice ripples into inline caches, GC, and the JIT.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)
20. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **You are designing the value representation for a dynamic language. Boxing, tagging, NaN-boxing — which, and why, and what does the rest of the VM inherit from that choice?**

The value representation is the single most consequential decision in a dynamic-language runtime. Every load, every store, every arithmetic operation, every property access, every GC scan touches a `Value`. Get the representation wrong and the entire VM pays a tax on every instruction; get it right and the common cases — array indexing, small-int arithmetic, float math — run near the speed of statically typed code. This page treats the three strategies not as curiosities but as *design points*, each with a coherent set of consequences for memory, speed, GC, and JIT complexity.

The three are not equals competing on one axis. **Boxing** is the baseline: maximally uniform, maximally simple, maximally slow for primitives. **Pointer tagging** keeps small integers and immediates inline, paying with reduced integer range and per-use untagging; it's the workhorse of OCaml, Ruby, Lisp, and (for integers) V8. **NaN-boxing** makes *floats* the privileged inline case and squeezes everything else into NaN payloads; it's the choice of float-heavy runtimes — SpiderMonkey, LuaJIT, JavaScriptCore. The right answer depends on a single empirical question about your language: **are the hot values integers or floats?**

This is also where representation stops being a local concern and becomes architectural. The tag you check on every operation is exactly the type the **inline cache** specializes on. The pointer you mask out of a NaN must still be *findable by the garbage collector* — so your GC must understand the encoding. The JIT's deoptimization guards are tag checks. The representation is the substrate that hidden classes, inline caches, and the optimizing compiler all stand on. We'll build a complete NaN-boxed `Value`, derive the encodings from first principles, and trace each consequence outward.

In one sentence: **the value representation is a budget of bits and branches spent once and charged on every instruction — and boxing, tagging, and NaN-boxing are three coherent ways to spend it, each dictating the shape of the GC, the inline caches, and the JIT above it.**

---

## Prerequisites

- **Required:** `middle.md` — alignment tag bits, the OCaml/Ruby/V8 encodings, IEEE-754 NaN structure, the 48-bit pointer fact.
- **Required:** Working understanding of garbage collection (at least: the GC must find all live pointers; precise vs conservative scanning).
- **Required:** Comfort with how an interpreter dispatches and how a JIT specializes hot code (inline caches, deoptimization — at a conceptual level).
- **Helpful:** Familiarity with at least one real VM's source (V8, SpiderMonkey, LuaJIT, JavaScriptCore, or CRuby).
- **Helpful:** Two's complement, sign-extension, and the cost model of branch misprediction and cache misses.

You do **not** yet need:

- 5-level paging, ARM pointer authentication (PAC), or top-byte-ignore in depth (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Value** | The uniform one-word representation of any runtime value: number, pointer, or immediate. |
| **Boxed double / HeapNumber** | A `double` stored on the heap because the inline representation can't hold it (V8's name: HeapNumber). |
| **Immediate** | A value encoded entirely inline: small int, `true`, `false`, `null`/`undefined`, sometimes chars/short symbols. |
| **NaN-boxing** | Encoding non-double values in the NaN payload, so a `Value` is always a `double` bit pattern. |
| **Nun-boxing (inverse)** | The inverse encoding: pointers/integers are canonical and doubles are *offset* by a constant so no real double collides with the NaN tag space. |
| **EncodedJSValue** | JavaScriptCore's 64-bit value encoding (a tagged/offset-double hybrid). |
| **Tag check** | The runtime test that classifies a `Value` before operating on it; on the JIT fast path it becomes a deopt guard. |
| **Inline cache (IC)** | A per-call-site cache that records the observed type(s) and specializes; the tag is what it keys on. |
| **Hidden class / Shape / Map** | A runtime descriptor of an object's field layout, enabling fast property access; orthogonal to but co-designed with value representation. |
| **Precise GC** | A collector that knows exactly which words are pointers (vs scalars) — requires the GC to decode the value representation. |
| **Conservative GC** | A collector that treats any word that *looks like* a pointer as one; tolerates not understanding the representation but over-retains. |
| **Deoptimization** | Falling back from optimized code to the interpreter when a guard (often a tag check) fails. |
| **Pointer compression** | Storing 32-bit offsets into a base instead of full 64-bit pointers, halving pointer memory (V8). |

---

## Core Concepts

### 1. The Representation Is a Cost Charged on Every Instruction

Every bytecode that touches a value does three things: classify it (tag check), extract the payload (untag), operate. A representation is "good" when, for the *common* values of *your* language, those three steps are cheap and allocation-free. The asymmetry matters: you optimize the hot case and accept overhead on the cold case. Boxing has no hot case for primitives (everything allocates). Tagging makes small ints hot. NaN-boxing makes floats hot. There is no universally best choice — there is a best choice *given your workload's value distribution.*

### 2. A Complete NaN-Boxed Value Design

Let's design a real one. We have 64 bits. A genuine double uses any pattern that is *not* a "boxing" NaN. We carve the boxing space out of the quiet-NaN region and tag sub-kinds:

```text
QNAN     = 0x7FF8_0000_0000_0000   (quiet NaN: exp all ones + quiet bit)
SIGN     = 0x8000_0000_0000_0000

Encoding:
  DOUBLE      : any bits where (bits & QNAN) != QNAN  → it's a real double
  POINTER     : SIGN | QNAN | (ptr & 0x0000_FFFF_FFFF_FFFF)   (48-bit payload)
  immediates  : QNAN | TAG_xxx
                TAG_FALSE = 1, TAG_TRUE = 2, TAG_NULL = 3, ...
  small int   : QNAN | INT_TAG | (uint32 payload)   (32-bit int inline)
```

Key decisions:
- **Doubles are the default.** No encoding cost; arithmetic is native. This is the whole point.
- **Pointers set the sign bit** so they occupy a region that no normal double or immediate uses, and carry a 48-bit address.
- **Immediates** (`true`/`false`/`null`/`undefined`) are tiny tagged constants in the qNaN space — comparisons are single-word equality.
- **Small integers** can live inline in the qNaN payload (32-bit), giving fast integer arithmetic *and* fast floats — the best of tagging and NaN-boxing in one scheme (this is close to what modern engines do).

### 3. Boxing vs Tagging vs NaN-Boxing as Design Points

| Dimension | Boxing | Pointer tagging | NaN-boxing |
|-----------|--------|-----------------|------------|
| **Inline fast case** | none (primitives heap-allocated) | small ints + immediates | doubles (and optionally ints) |
| **Integer range** | full (boxed) | reduced (63-/31-bit) | full if boxed, 32-/48-bit if inline |
| **Float speed** | boxed → slow | boxed → slow | **native** |
| **Per-op cost** | dereference type field | untag (shift/mask) | mask + NaN test |
| **GC** | trivial: every value is a pointer | must skip tagged non-pointers | must decode to find pointers |
| **Best when** | simplicity > speed | integers dominate | floats dominate |

The cross-cutting insight: boxing pushes complexity into the *allocator and GC* (lots of objects); tagging and NaN-boxing push complexity into *every operation* (decode logic) but relieve the allocator. You're choosing *where* to pay.

### 4. The "Nun-Boxing" Inverse

NaN-boxing privileges doubles and special-cases pointers in the NaN space. The **inverse** ("nun-boxing," a play on the name) privileges *pointers/integers* as canonical and *offsets all doubles* by a constant so that no real double's bit pattern ever lands in the tag region:

```text
NaN-boxing:   value is a double unless it's a tagged NaN → pointers cost a mask
Nun-boxing:   value is a pointer/int unless it decodes as an offset double
              stored_double_bits = real_double_bits + DOUBLE_OFFSET
```

JavaScriptCore's `EncodedJSValue` is in this spirit: integers are stored with a tag in the high bits, pointers are "low" values, and doubles are stored *offset* (a constant added) so they never collide with the pointer/int/immediate ranges. The motivation: make pointer and integer access the zero-cost path (no mask), accepting an add/subtract on doubles. Again — you privilege whichever operation your language does most.

### 5. The Representation Drives the GC

A precise garbage collector must walk the heap and identify *exactly* which words are live pointers. With boxing, trivial: every value slot is a pointer. With tagging or NaN-boxing, the GC must *decode every value* to decide "is this a pointer I must trace, or an inline int/double I must ignore?" This couples the GC tightly to the representation:

```text
for each value slot v in the object:
    if is_pointer(v):           // decode the tag / NaN
        trace(unbox_ptr(v))     // follow and mark
    // else: inline scalar, skip
```

Get the decode wrong and the GC either traces an integer as a pointer (crash) or skips a real pointer (use-after-free). This is why representation and GC are co-designed, never independent. A *conservative* GC sidesteps the coupling (treat anything pointer-shaped as a root) but over-retains and can't move objects — usually unacceptable for a high-performance VM.

### 6. The Representation Drives Inline Caches and the JIT

An **inline cache** specializes a call site to the type it has seen. The "type" it keys on *is the tag*. When the JIT compiles `a + b`, it emits a fast path guarded by a **tag check**: "if `a` and `b` are both small ints, do an integer add; otherwise deoptimize." That guard is exactly the `is_int` test from the representation. So:

- The set of tags you can check cheaply determines which type guards are cheap.
- A representation where "is small int" and "is double" are each one instruction makes numeric IC guards nearly free.
- Polymorphic sites (mixed tags) cause guard mispredictions and IC misses — the representation's branch behavior directly shapes JIT performance.

This is the deep reason the topic connects to hidden classes and inline caches: *the value tag is the currency the speculative optimizer trades in.* (We describe the connection conceptually; the IC/hidden-class machinery is a runtime-systems topic of its own.)

### 7. Pointer Compression: An Orthogonal Lever

V8's **pointer compression** is a different bit-budget trick that interacts with tagging: store 32-bit offsets from a heap base instead of full 64-bit pointers, halving the memory of every pointer-bearing value and improving cache density. It composes with SMI tagging (the low bit still distinguishes int from pointer; the pointer is now a 31-bit compressed reference). It's a reminder that representation design is multi-dimensional: tag *and* width *and* base-relative addressing are all in play.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Representation charged per instruction** | The exchange rate at a border crossing — paid on *every* transaction, so a tiny per-trade cost dominates total throughput. |
| **Boxing pushes cost to GC** | A warehouse that stores every item in its own crate: easy to label, but the cleanup crew drowns in crates. |
| **Tagging/NaN-boxing pushes cost to ops** | Stamping a code on each item: storage is dense, but every handler must read the code before acting. |
| **Nun-boxing inverse** | Deciding the *default* currency at the border so the most common trade needs no conversion, and the rare one pays. |
| **GC must decode values** | The recycling sorter must read each item's material code to route it — mislabel one and it goes to the wrong stream (crash). |
| **Tag is IC currency** | A frequent-flyer status that the gate agent checks to decide your boarding lane; the check must be instant. |
| **Pointer compression** | Using apartment numbers (relative to a building) instead of full street addresses — shorter, denser, but only valid within the building. |

---

## Mental Models

### The "Where Do You Pay?" Model

Every representation pays the same total complexity bill; they differ in *where*. Boxing pays at allocation and GC time (many small objects). Tagging and NaN-boxing pay at operation time (decode on every use). For a workload that allocates rarely but operates constantly, the operation cost dominates — favoring boxing's simplicity is wrong, and inline encodings win. For a workload that's allocation-bound, the calculus shifts. Always ask: *for this language's actual programs, where is the cost concentrated?*

### The "Privileged Type" Model

Each encoding crowns one type as royalty — stored canonically with zero decode cost — and exiles the rest to tagged/masked representations. Boxing crowns *pointers* (everything is a pointer). Tagging crowns *small integers and immediates*. NaN-boxing crowns *doubles*. Nun-boxing crowns *pointers/integers* and offsets doubles. Pick the royalty to match your hot path: a numeric scripting language crowns doubles, a symbolic/AST-heavy language crowns pointers, an integer-index-heavy language crowns small ints.

### The "Representation as Foundation" Model

Picture the VM as a building. The value representation is the foundation; the GC, inline caches, hidden classes, and JIT are the floors above. You can't change the foundation without disturbing every floor: a new tag scheme means new GC decode logic, new IC guards, new JIT fast paths. This is why mature VMs almost never change their core representation — the blast radius is the entire engine. Design it once, deliberately.

---

## Code Examples

### C — A complete NaN-boxed Value (doubles, ints, pointers, immediates)

```c
#include <stdint.h>
#include <string.h>
#include <stdbool.h>

typedef uint64_t Value;

#define QNAN     0x7FF8000000000000ULL   // quiet NaN marker
#define SIGN     0x8000000000000000ULL
#define TAG_PTR  (SIGN | QNAN)           // pointers: sign + qNaN
#define PAYLOAD  0x0000FFFFFFFFFFFFULL   // 48-bit pointer payload

// Immediates live in the qNaN space (no sign bit), low 3 bits as a code.
#define IMM      QNAN
#define TAG_FALSE (IMM | 1)
#define TAG_TRUE  (IMM | 2)
#define TAG_NULL  (IMM | 3)

// Inline 32-bit int: qNaN | INT_BIT | (uint32 payload)
#define INT_TAG  (QNAN | 0x4000000000000000ULL)  // a free high bit as "int" marker

static inline Value d2v(double d) { Value v; memcpy(&v, &d, 8); return v; }
static inline double v2d(Value v) { double d; memcpy(&d, &v, 8); return d; }

static inline bool  is_double(Value v) { return (v & QNAN) != QNAN; }
static inline bool  is_ptr(Value v)    { return (v & TAG_PTR) == TAG_PTR; }
static inline bool  is_int(Value v)    { return (v & (QNAN|INT_TAG)) == INT_TAG; }
static inline bool  is_imm(Value v)    { return (v & SIGN) == 0 && (v & QNAN) == QNAN && !is_int(v); }

static inline Value from_double(double d) { return d2v(d); }
static inline Value from_ptr(void *p)     { return TAG_PTR | ((uint64_t)(uintptr_t)p & PAYLOAD); }
static inline Value from_int(int32_t n)   { return INT_TAG | (uint32_t)n; }
static inline Value from_bool(bool b)     { return b ? TAG_TRUE : TAG_FALSE; }

static inline void   *as_ptr(Value v) { return (void *)(uintptr_t)(v & PAYLOAD); }
static inline int32_t as_int(Value v) { return (int32_t)(uint32_t)v; }
static inline bool    as_bool(Value v){ return v == TAG_TRUE; }
```

This single header *is* the value system. Note: the exact bit assignments (which high bit is the int marker, how immediates are numbered) are a design choice; real engines tune them so the *most frequent* tag check is the cheapest instruction. The discipline is that every other part of the VM goes through these functions.

### C — The GC must decode to trace pointers

```c
// Precise GC scan of one object's value slots.
void trace_object(Value *slots, size_t n, void (*mark)(void *)) {
    for (size_t i = 0; i < n; i++) {
        Value v = slots[i];
        if (is_ptr(v)) {
            mark(as_ptr(v));     // a real heap reference: follow it
        }
        // doubles, ints, immediates: inline scalars — skip them
    }
}
```

The GC is *not* representation-agnostic. It calls `is_ptr` / `as_ptr` — the same encoding the interpreter uses. A bug here is a memory-safety bug, not a performance bug.

### C — A JIT-style fast path guarded by a tag check

```c
// Pseudo-JIT: integer-add fast path with a deopt guard.
Value jit_add(Value a, Value b) {
    if (is_int(a) && is_int(b)) {                 // the tag check == the IC guard
        int64_t r = (int64_t)as_int(a) + as_int(b);
        if (r == (int32_t)r) return from_int((int32_t)r);   // fits inline
        return from_double((double)r);            // overflow → promote to double
    }
    if (is_double(a) && is_double(b))
        return from_double(v2d(a) + v2d(b));
    return deoptimize_and_add(a, b);              // cold path: full semantics
}
```

The `is_int`/`is_double` checks are exactly what the optimizing compiler emits as guards. Overflow promotes to a double — the integer "fast lane" silently merges into the float lane, which is invisible to the script but visible in a profile.

### C — Nun-boxing (offset doubles) sketch

```c
// Inverse: pointers/ints are canonical; doubles are stored offset so they
// never collide with the small tag region near zero.
#define DOUBLE_OFFSET 0x0001000000000000ULL   // illustrative

static inline Value box_double_nun(double d) { return d2v(d) + DOUBLE_OFFSET; }
static inline double unbox_double_nun(Value v) { return v2d(v - DOUBLE_OFFSET); }
// pointers and small ints live in the low range with NO mask on access.
```

Here the *pointer* path is free and the *double* path pays an add/subtract — the opposite of NaN-boxing. JavaScriptCore's encoding follows this philosophy.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **NaN-boxing — float workloads** | Native FP arithmetic; uniform 8-byte value; dense arrays. | Pointer/int access masks; intricate, fragile bit logic. |
| **NaN-boxing — uniformity** | One value type simplifies the interpreter's value plumbing. | Hard 48-bit pointer dependency; breaks under exotic address layouts. |
| **Tagging — integer workloads** | Allocation-free small ints; portable (only needs alignment). | Reduced range; float operations box and slow down. |
| **Boxing — simplicity** | Trivial GC; trivial reasoning; no decode on access. | Allocation/GC/cache-miss tax on every primitive. |
| **Nun-boxing — pointer/int workloads** | Zero-cost pointer & int access. | Doubles pay an offset add; encoding still intricate. |
| **All inline schemes — GC coupling** | Dense heap, fewer objects. | GC must decode every value; bugs are memory-safety bugs. |
| **All inline schemes — JIT** | Tag checks double as IC guards / deopt guards. | Polymorphic sites mispredict; representation shapes JIT perf directly. |

---

## Use Cases

- **Designing a new dynamic-language VM:** pick the representation from the workload. Numeric/graphics scripting → NaN-boxing (Lua, JS). Symbolic/functional with integer-heavy logic → tagging (OCaml, Lisp, Ruby).
- **Porting a runtime to a new architecture:** revisit the 48-bit pointer assumption; tagging ports more easily than NaN-boxing.
- **Optimizing an existing interpreter:** moving from boxed-everything to tagged small ints often yields large wins on integer-heavy benchmarks with modest engineering.
- **Co-designing GC and values:** when you can decode the representation, you can build a precise, moving GC; if you can't (FFI opacity), you may be forced conservative.

Avoid inline encodings when:

- **You're embedding in a host with opaque pointers** that violate alignment or address-width assumptions.
- **Full 64-bit integer arithmetic with no boxing fallback is a hard requirement** — tagging and inline-int NaN-boxing both cap inline range.

---

## Coding Patterns

### Pattern 1: Single source of truth for the encoding

```c
// values.h — the ONLY place bit layouts appear. Everything else calls these.
static inline bool  is_int(Value);
static inline Value from_int(int32_t);
static inline int32_t as_int(Value);
```

### Pattern 2: Order tag checks by frequency

```c
if (is_double(v))      ...   // hottest first → predicted branch
else if (is_int(v))    ...
else if (is_ptr(v))    ...
else /* immediate */   ...
```

### Pattern 3: Overflow-aware integer fast paths

```c
int64_t r = (int64_t)as_int(a) + as_int(b);
return (r == (int32_t)r) ? from_int((int32_t)r) : from_double((double)r);
```

### Pattern 4: GC trace mirrors the representation exactly

```c
if (is_ptr(v)) mark(as_ptr(v));   // same predicate the interpreter uses
```

### Pattern 5: Canonicalize the one real NaN

```c
// Ensure FP NaN results use a pattern outside the boxing tag space.
double r = a_op_b;
if (isnan(r)) return CANONICAL_QNAN;
return from_double(r);
```

---

## Best Practices

- **Choose the privileged type from data, not taste.** Profile representative programs: count int vs float vs pointer operations. Crown the winner.
- **Co-design GC and representation from day one.** The GC's pointer-finding logic and the value encoding are one design, not two.
- **Make the hottest tag check the cheapest, branch-predictable instruction.** This single decision dominates interpreter throughput.
- **Keep encode/decode in one audited header.** Memory-safety depends on every site agreeing on the layout.
- **Reserve a canonical NaN and document the immediate codes.** Prevent collisions between genuine NaN and boxed-value tags.
- **Plan the overflow/promotion path.** Inline ints must promote cleanly to boxed doubles/bignums; design and test that boundary.
- **Treat the 48-bit assumption as a portability risk.** Gate it behind a compile-time check; have a tagging fallback for hostile architectures.
- **Fuzz the representation.** Round-trip random doubles, ints, pointers, and immediates through encode/decode; assert identity and that no real double is misclassified as boxed.

---

## Edge Cases & Pitfalls

- **Genuine NaN collides with boxed tags.** `0.0/0.0` produces a NaN; if its bits land in your boxing space, `is_double` says "not a double." Canonicalize FP NaN results.
- **Infinities and `-0.0` are real doubles** (all-ones exponent but *zero* fraction for Inf). A naïve "exponent all ones ⇒ boxed" test misclassifies them.
- **48-bit pointer overflow.** A pointer with high bits set (huge mmap, sandbox, or future 5-level paging) won't fit the 48-bit payload — silent corruption. `professional.md` covers the mitigations.
- **GC moving a NaN-boxed pointer.** A moving collector rewrites pointers; it must re-box the new address with the correct tag, not write a raw pointer into a value slot.
- **FFI / embedder pointers.** Pointers from outside the VM may be under-aligned or use high bits; they break tagging/NaN-boxing if stored as Values without checking.
- **Signaling NaN leakage.** A boxed value that accidentally forms a signaling NaN can raise FP exceptions when an unrelated code path treats the slot as a double.
- **Integer/double identity in the language.** If the language exposes `===`/`is`, you must decide whether inline-int `5` and boxed-double `5.0` are identical — a representation choice with user-visible semantics.
- **Polymorphic megamorphic sites.** A site that sees ints, doubles, and pointers in turn defeats the IC and pays repeated guard mispredictions; the representation can't fix this, only the call site's monomorphism can.

---

## Common Mistakes

1. **Letting a real NaN alias a boxed value** by failing to canonicalize FP NaN results.
2. **Misclassifying Infinity/`-0.0`** by testing only the exponent, not the fraction.
3. **GC decoding disagreeing with interpreter decoding** — divergent copies of the bit layout → memory unsafety.
4. **Hard-assuming 48-bit pointers** without a compile-time guard or fallback.
5. **Choosing NaN-boxing for an integer-heavy language** (or tagging for a float-heavy one) — privileging the wrong type.
6. **Writing raw pointers into value slots after GC compaction** instead of re-boxing them.
7. **Forgetting the inline-int overflow path,** producing wrong results when arithmetic exceeds the inline range.
8. **Treating representation as independent of the JIT** — then discovering tag checks dominate the guard cost.

---

## Tricky Points

- **The "best" representation is workload-relative and time-relative.** A choice optimal for 2010 JavaScript (lots of small-int array work) may be suboptimal for WebGL-heavy float code. Representations are designed against a *predicted* value distribution that can drift.
- **NaN-boxing and tagging can be combined.** Modern engines often NaN-box doubles *and* tag small ints inline in the NaN payload — you don't have to pick one privileged type if you can afford two cheap checks.
- **The tag check is a speculation.** The JIT bets a value is a small int and guards it; the representation determines how cheap that bet is. A representation with expensive guards undercuts the entire speculative-optimization strategy.
- **Conservative GC buys representation freedom at a cost.** If the GC doesn't decode values, you can change the representation more freely — but you give up precise reclamation and moving collection. High-performance VMs almost universally choose precise GC and pay the coupling.
- **Pointer compression changes the arithmetic of tagging.** With 32-bit compressed pointers, the tag and the pointer share a 32-bit word, tightening the bit budget and changing untag code.
- **The representation leaks into the language spec.** Whether `2**53 + 1` is representable, whether integer and float `5` are `===`, whether bitwise ops coerce to 32-bit — these user-visible facts are downstream of the inline-int width you chose.

---

## Test Yourself

1. You're designing a VM for a graphics-scripting language where 80% of operations are on floats. Which representation, and what's the one-line justification?
2. Write the `is_double` predicate and explain why it must check the fraction, not just the exponent, to avoid misclassifying ±Infinity.
3. Your precise GC traces a NaN-boxed value as a pointer and the program crashes. List two distinct ways the bug could have arisen.
4. Explain how a JIT's deoptimization guard for `a + b` reduces to a tag check from the value representation.
5. Contrast NaN-boxing and nun-boxing (offset doubles): which operation is zero-cost in each, and which pays? Which would JavaScriptCore-style code choose and why?
6. A moving GC compacts the heap and relocates an object. What must happen to every NaN-boxed Value that pointed at it, and what goes wrong if you write the raw new address?
7. Why can a representation that NaN-boxes doubles *also* tag small integers inline? What's the cost of supporting both?
8. Your inline-int fast path adds two near-maximal 32-bit ints. Trace what the representation does, and explain the silent transition the script can't observe.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        VALUE REPRESENTATION AS A DESIGN POINT (SENIOR)           │
├──────────────────────────────────────────────────────────────────┤
│ PRIVILEGED TYPE (zero-decode, inline):                           │
│   boxing       → pointers (everything is a pointer)               │
│   tagging      → small ints + immediates                         │
│   NaN-boxing   → doubles (optionally + inline ints)              │
│   nun-boxing   → pointers/ints; doubles stored OFFSET            │
├──────────────────────────────────────────────────────────────────┤
│ WHERE YOU PAY:                                                   │
│   boxing       → allocator + GC (many small objects)             │
│   inline       → every operation (decode/untag/mask)             │
├──────────────────────────────────────────────────────────────────┤
│ CHOOSE BY WORKLOAD:                                              │
│   floats dominate   → NaN-boxing   (Lua, JS, SpiderMonkey)        │
│   integers dominate → tagging      (OCaml, Ruby, Lisp)           │
│   pointers dominate → nun-boxing   (JavaScriptCore-style)        │
├──────────────────────────────────────────────────────────────────┤
│ RIPPLES UPWARD:                                                  │
│   GC must DECODE every value to find pointers (precise GC)        │
│   tag check == inline-cache guard == JIT deopt guard             │
│   pointer compression tightens the tag bit-budget                │
├──────────────────────────────────────────────────────────────────┤
│ MUST-HANDLE EDGES:                                               │
│   canonicalize real NaN (don't alias boxed tags)                 │
│   ±Inf / -0.0 are real doubles (check the fraction!)             │
│   48-bit pointer overflow; moving-GC re-box; FFI pointers        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The **value representation** is the most consequential decision in a dynamic-language VM because it is charged on *every* instruction: classify (tag check), extract (untag), operate.
- The three strategies are **design points**, each crowning one **privileged type** stored inline with zero decode cost: boxing crowns pointers, tagging crowns small ints/immediates, NaN-boxing crowns doubles. The **nun-boxing** inverse crowns pointers/ints and stores doubles *offset* (JavaScriptCore's spirit).
- The choice is **workload-relative**: privilege whatever your language operates on most. Float-heavy → NaN-boxing; integer-heavy → tagging; pointer/symbol-heavy → nun-boxing.
- They differ in *where* complexity lands: boxing pushes it to the **allocator and GC** (many objects); inline encodings push it to **every operation** (decode logic).
- A complete NaN-boxed `Value` makes doubles the default (no encoding), sets the **sign + qNaN** for 48-bit pointers, and uses small qNaN-space tags for **immediates** (`true`/`false`/`null`) and optionally **inline 32-bit ints** — combining tagging and NaN-boxing.
- The representation **ripples upward**: the precise GC must *decode* every value to find pointers (a decode bug is a memory-safety bug); the **tag check is the inline-cache and JIT deopt guard**; pointer compression tightens the bit budget.
- The **hard edges** are non-negotiable: canonicalize genuine NaN so it doesn't alias boxed tags, treat ±Inf and `-0.0` as real doubles (check the fraction), handle 48-bit pointer overflow, re-box pointers after moving-GC compaction, and guard the inline-int overflow/promotion path.
- A senior's instinct: representation is a **foundation** — design it once, deliberately, from the measured value distribution, knowing the GC, ICs, and JIT all stand on it.

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom: the canonical, complete NaN-boxing walkthrough with all edge cases.
- *JavaScriptCore source & blog* — the `EncodedJSValue` encoding (offset-double / nun-boxing-style) and "Speculation in JavaScriptCore."
- *SpiderMonkey* — the `JS::Value` boxing/NaN-boxing history (punbox vs nunbox).
- *LuaJIT* — Mike Pall's writings on the NaN-boxed `TValue` and why it enables the trace JIT's speed.
- *V8 design docs* — SMI representation, HeapNumber, and "Pointer Compression in V8."
- *Real World OCaml* — tagged 63-bit ints and the GC's interaction with the representation.
- *The Garbage Collection Handbook* — Jones, Hosking, Moss: precise vs conservative scanning and tagged values.
- *Inline Caches* — the original Deutsch & Schiffman Smalltalk work and modern hidden-class IC papers.

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling topics: IEEE-754 floating-point representation and integer representation under `data-representation-and-numerics/`.
- Cross-cutting: garbage collection, interpreter/VM and JIT design, inline caches and hidden classes under `language-internals/` (conceptual link — the value tag is what those mechanisms specialize on).

---

## Diagrams & Visual Aids

### Where Each Strategy Pays Its Cost

```text
                allocator/GC cost        per-operation cost
BOXING          ███████████████          ░
TAGGING         ░░                       ████████
NaN-BOXING      ░░                       ████████ (floats: ░)
NUN-BOXING      ░░                       ████████ (ptrs/ints: ░)
```

### Complete NaN-Boxed Value Map

```text
bits & QNAN != QNAN ─────────────────────────────▶ DOUBLE (native, no decode)

bits & QNAN == QNAN:
   sign set (TAG_PTR) ──────────────▶ POINTER  (mask low 48 bits)
   INT_TAG high bit ────────────────▶ SMALL INT (read low 32 bits)
   low code 1/2/3 ──────────────────▶ false / true / null
```

### Representation as the VM Foundation

```text
        ┌───────────────────────────────────────┐
        │   JIT  (deopt guards = tag checks)     │
        ├───────────────────────────────────────┤
        │   Inline Caches (keyed on the tag)     │
        ├───────────────────────────────────────┤
        │   Garbage Collector (decodes values)   │
        ├───────────────────────────────────────┤
        │   VALUE REPRESENTATION  ◄── foundation │
        └───────────────────────────────────────┘
   change the foundation → disturb every floor above
```

### NaN-Boxing vs Nun-Boxing (who pays?)

```text
NaN-boxing:   DOUBLE  free  ──  POINTER masks  ──  INT in payload
nun-boxing:   POINTER free  ──  INT free       ──  DOUBLE + OFFSET (add/sub)
              └ pick the free path = your hottest operation ┘
```
