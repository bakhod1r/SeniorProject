# Boxing, Tagging & NaN-Boxing — Middle Level

> **Topic:** [Boxing, Tagging & NaN-Boxing](README.md)
> **Focus:** How runtimes encode "value or pointer" in one machine word — pointer tagging via alignment bits, the IEEE-754 NaN payload that NaN-boxing exploits, and the concrete bit layouts of V8 SMIs, OCaml ints, and Ruby Fixnums.

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

> Focus: **The bits.** How exactly do you cram "this is a small integer" or "this is a pointer" into a single 64-bit word, and what does each encoding cost?

At the junior level, boxing was the obvious-but-slow answer: wrap every primitive in a heap object. This page is about the encodings that *avoid* that — the bit-level tricks that let a dynamic-language runtime keep a small integer, a pointer, and a handful of immediates (`true`, `false`, `null`) all in one uniform 64-bit slot, while still being able to tell them apart in a couple of instructions.

Two facts of the machine make this possible. First, **alignment**: a heap pointer to an 8-byte-aligned object always has its three low bits zero, because the address is a multiple of 8. Those bits are dead weight in a pointer — so steal them for a **tag**. Second, **IEEE-754 redundancy**: a 64-bit `double` reserves a colossal range of bit patterns to mean "Not a Number," far more than any program ever needs. Those spare NaN patterns are unused payload — so hide non-float values in them. That's **NaN-boxing**.

The payoff is real and measurable. A runtime that tags small integers turns `a + b` on two small ints into a few bit operations and an `add`, with zero allocation and zero pointer chasing. A NaN-boxing runtime makes *all* floating-point arithmetic native because every value already *is* a double. The cost is precision in the encoding: you lose a bit (or several) of integer range, and you sign a contract with the hardware about how many address bits a pointer really uses.

In one sentence: **tagging and NaN-boxing trade a small, fixed amount of representable range for the elimination of boxing — and the whole game is how cleverly you spend the spare bits.**

This page makes the encodings concrete. We'll derive why alignment gives free bits, lay out V8's SMI, OCaml's 63-bit int, and Ruby's Fixnum/immediate scheme, walk through the IEEE-754 NaN structure that NaN-boxing exploits, and show the tag-check and untag operations a runtime actually emits. `senior.md` then builds a full NaN-box value type and compares the three strategies as runtime design points.

---

## Prerequisites

- **Required:** The junior page — boxing, unboxing, the cost of boxing, the Java/Python caches.
- **Required:** Comfort reading binary and hexadecimal, and bitwise operations (`&`, `|`, `^`, `<<`, `>>`).
- **Required:** What a pointer is at the byte level and what "alignment" means (an address that is a multiple of N).
- **Helpful:** A rough mental model of IEEE-754 doubles: 1 sign bit, 11 exponent bits, 52 fraction bits.
- **Helpful:** Two's-complement integers, and the idea of arithmetic vs logical right shift.

You do **not** yet need:

- The full NaN-box value-type implementation with all immediate encodings (that's `senior.md`).
- 5-level paging, pointer authentication (PAC), or top-byte-ignore (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Alignment** | An object placed at an address that is a multiple of N (its alignment). 8-byte alignment ⇒ address ≡ 0 mod 8 ⇒ low 3 bits are 0. |
| **Tag bits** | The low (or high) bits of a word repurposed to encode the value's kind. |
| **Pointer tagging** | Encoding the type in a pointer's spare bits; a tag of (say) 1 means "small int in the upper bits," 0 means "real pointer." |
| **SMI (Small Integer)** | V8's tagged 31-bit (32-bit builds) or 32-bit (64-bit builds) integer stored inline with a 1-bit tag. |
| **HeapObject pointer** | In V8, a tagged pointer whose low bit is set, distinguishing it from an SMI. |
| **Immediate** | A value encoded entirely in the word, with no heap object: small int, `true`, `false`, `null`, sometimes short symbols/chars. |
| **IEEE-754 double** | 64-bit float: 1 sign bit, 11 exponent bits, 52 fraction bits. |
| **NaN** | "Not a Number": exponent all ones (`0x7FF`) and a non-zero fraction. There are 2⁵² − 1 such bit patterns per sign. |
| **Quiet NaN (qNaN)** | A NaN with the top fraction bit set; propagates through arithmetic without raising. The standard "canonical" NaN. |
| **Signaling NaN (sNaN)** | A NaN with the top fraction bit clear; can raise an FP exception. NaN-boxing usually avoids these. |
| **NaN-boxing** | Encoding non-double values inside the unused payload of NaN bit patterns, so every value is physically a double. |
| **Payload** | The ~51 fraction bits of a NaN available to carry a pointer or integer. |
| **Untag / unmask** | Recovering the real value (clearing tag bits, sign-extending an int, masking off NaN bits) before use. |
| **Canonical address space** | On x86-64, only 48 bits of a virtual address are meaningful today; the top 16 bits are a sign-extension of bit 47. This is why a pointer fits in a NaN payload. |

---

## Core Concepts

### 1. Why Alignment Gives You Free Bits

Allocators align objects so the CPU can load them efficiently. If every heap object is 8-byte aligned, its address is a multiple of 8: `...000` in binary. Three low bits, guaranteed zero, carrying no information. That's a gift.

```text
8-byte-aligned address:  0x7FFE_C0DE_0000_1000
                                              ^^^
                            low 3 bits always 000
```

A runtime declares a convention: the low bits *are* the tag. For example:
- `xxx...xx0` → not a pointer; the upper bits are a small integer (Ruby, OCaml shift-style).
- `xxx...xx1` → a real heap pointer; clear the tag bit before dereferencing.

Because the tag rides in bits the pointer never used, you pay *nothing* in pointer space. You pay only when you want to use a tagged value: you must **untag** (mask or shift) first.

### 2. Pointer Tagging Scheme A: Low-Bit "Is-Pointer" Flag (V8 SMI)

V8 distinguishes a **Small Integer (SMI)** from a **HeapObject pointer** by the *low* bit:

```text
SMI            value << 1 | 0      (low bit 0)
HeapObject     pointer    | 1      (low bit 1)
```

On a 64-bit build, an SMI is a 32-bit signed integer stored in the *upper* 32 bits, with the low 32 bits as the tag region (historically `value << 32`). On 32-bit builds it was `value << 1`, giving a 31-bit SMI. The check is one instruction:

```text
is_smi(x)    ==  (x & 1) == 0
smi_value(x) ==  x >> 1            (arithmetic shift, sign-preserving)  // 32-bit build
```

The tradeoff: an SMI cannot represent all 64-bit integers — only the 31-/32-bit range. A number outside that range becomes a **HeapNumber** (a boxed double on the heap). This is the engine of the "small integers are fast, big integers are slow" reality of JavaScript.

### 3. Pointer Tagging Scheme B: Shift-and-Tag Integers (OCaml, Ruby)

OCaml and Ruby use the *low* bit to mark **integers** instead of pointers:

```text
OCaml:   tagged_int(n) = (n << 1) | 1     low bit 1 → "this is an int"
                                          low bit 0 → "this is a pointer"
```

So an OCaml `int` is **63 bits** on a 64-bit platform (one bit spent on the tag). The brilliance: a tagged int with low bit 1 can never be confused with an aligned pointer (low bit 0). Arithmetic is adjusted to keep the tag:

```text
add:  (a + b) - 1        because (2a+1) + (2b+1) = 2(a+b)+2, need 2(a+b)+1
sub:  (a - b) + 1
mul:  (a>>1) * (b>>1) ... then re-tag   // multiplication must untag first
```

Ruby (MRI) generalizes this: the low bits encode several immediate kinds. Historically `Fixnum` (now folded into `Integer`) used the lowest bit; `nil`, `true`, `false`, and `Symbol` get their own immediate bit patterns. A value is a heap object only if none of the immediate tags match.

### 4. Ruby's Immediate Encoding (Concrete)

In MRI Ruby on a 64-bit platform, a `VALUE` (one word) encodes:

```text
...xxxx1     Fixnum:  (n << 1) | 1          (integer, 63-bit-ish)
0x00         Qfalse   (false is literally 0 — also "falsy" test is cheap)
0x08         Qnil     (nil)
0x14         Qtrue
...xx1100    Symbol   (specific low-bit pattern)
low bits 000 heap object pointer (RObject, RString, ...)
```

The exact constants vary by version, but the shape is permanent: **a handful of immediate bit patterns, then "everything else is a pointer."** This is why `nil`, `true`, `false`, small integers, and symbols are never allocated in Ruby — they're values, not objects, even though Ruby pretends "everything is an object."

### 5. The IEEE-754 Double, and Where NaN Hides

A 64-bit double:

```text
 bit 63    bits 62..52        bits 51..0
┌──────┬──────────────────┬────────────────────────────┐
│ sign │ exponent (11 b)  │ fraction / mantissa (52 b)  │
└──────┴──────────────────┴────────────────────────────┘
```

The value is **NaN** when the exponent is all ones (`0x7FF`) *and* the fraction is non-zero. Count the patterns: 11 exponent bits forced to 1, the sign free, and any of the 2⁵² − 1 non-zero fractions. That is **2 × (2⁵² − 1) ≈ 2⁵³ distinct NaN bit patterns** — and a program only ever needs *one* NaN. The rest are free storage.

The top fraction bit (bit 51) distinguishes **quiet** (1) from **signaling** (0) NaNs. NaN-boxing uses quiet NaNs to avoid raising FP exceptions, leaving roughly **51 payload bits** to carry data:

```text
NaN-box skeleton:
┌──────┬──────────────────┬─┬───────────────────────────┐
│ sign │ 1111111 1111 (=NaN)│q│  ~48-bit payload (ptr/int) │
└──────┴──────────────────┴─┴───────────────────────────┘
                            ^ quiet bit
```

### 6. Why a Pointer Fits in the Payload

A 51-bit payload sounds tight for a 64-bit pointer — but real pointers don't use 64 bits. On x86-64 today, only **48 bits** of virtual address are meaningful (the "canonical" form sign-extends bit 47 into the top 16). ARM64 is similar (48 bits, optionally 52 with extensions). So a userspace pointer is *effectively 48 bits*, which slots neatly into the NaN payload with bits left over for a small tag distinguishing pointer-payloads from integer-payloads from immediate-payloads.

This is the keystone of NaN-boxing: **48-bit pointers + 51-bit NaN payload ⇒ a pointer fits, with room for a tag.** `professional.md` covers what happens when that 48-bit assumption is challenged (5-level paging, ARM PAC).

### 7. Tag Check and Untag: What the CPU Actually Does

Every operation on a tagged or NaN-boxed value begins by asking "what kind is this?" The check must be cheap — ideally one or two instructions, predictable for the branch predictor.

```text
Pointer tagging (V8-style):
  is_smi:     test low bit          (1 instr)
  untag smi:  arithmetic shift      (1 instr)
  untag ptr:  clear/subtract tag    (1 instr)

NaN-boxing:
  is_double:  is the exponent NOT all-ones, OR is it the one real NaN?  (compare)
  is_boxed:   (bits & QNAN_MASK) == QNAN_MASK                            (and + compare)
  untag ptr:  bits & PAYLOAD_MASK                                        (and)
```

The whole reason these schemes exist is that the check and untag are a handful of cheap, branch-predictable instructions — orders of magnitude cheaper than a heap allocation plus a cache-missing pointer dereference.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Alignment gives free bits** | Parking spaces numbered in multiples of 10 (10, 20, 30…). The ones digit is always 0, so you can scribble a one-digit note there without ambiguity. |
| **Low-bit pointer tag** | A filing system where even-numbered cards are addresses and odd-numbered cards are literal values. One glance at the parity tells you which. |
| **OCaml shift-and-tag** | Writing every number doubled-plus-one so it's always odd, reserving "even" for addresses. You halve to read it back. |
| **NaN payload** | A huge stack of pre-voided checks. The bank ignores them as money, so you use their blank memo fields as scratch storage for secret notes. |
| **Quiet vs signaling NaN** | Two kinds of "void" stamps — one silent, one that triggers an alarm at the teller. You only ever use the silent kind for notes. |
| **48-bit pointer fits in payload** | A "64-character" address field where everyone knows the last 16 characters are always the same filler, so you really only write 48. |
| **Tag check cost** | A bouncer who can tell members from guests by the color of a wristband — one glance, no paperwork. |

---

## Mental Models

### The "Spend the Spare Bits" Model

Every encoding in this topic is an exercise in *budgeting bits you didn't think you had*. Alignment hands you 3 free low bits per pointer. IEEE-754 hands you ~51 free payload bits per NaN. The runtime designer's job is to spend that budget wisely: one bit to say "int vs pointer," a few more to enumerate immediates, the rest for the actual value. When you read about SMIs, OCaml ints, or NaN-boxing, ask: *what is the bit budget, and how is each bit spent?*

### The "Tag Is a Cheap Question" Model

Before a runtime can do *anything* with a value, it must ask "what are you?" Boxing answers by dereferencing a pointer to read a type field — a memory access. Tagging and NaN-boxing answer with arithmetic on bits *already in the register* — no memory access. The entire performance win is converting a memory-bound question into a register-bound one. Picture the tag check as a question you can answer without leaving your desk.

### The "Two Number Worlds" Model (for SMIs)

A JavaScript engine lives a double life. Spec says "all numbers are doubles." Reality says "most numbers in real programs are small integers — array indices, loop counters, lengths." So the engine keeps a fast lane (SMIs, inline, no allocation) and a slow lane (HeapNumber doubles, boxed). Values silently move between lanes when they overflow the SMI range or become non-integer. Holding this dual model explains nearly every JS numeric performance cliff.

---

## Code Examples

### C — Alignment really does zero the low bits

```c
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>

int main(void) {
    for (int i = 0; i < 4; i++) {
        void *p = malloc(64);            // typically 16-byte aligned
        uintptr_t a = (uintptr_t)p;
        printf("addr=%p  low3=%lu\n", p, (unsigned long)(a & 0x7));
        free(p);
    }
    return 0;
}
```

The `low3` column prints `0` every time: heap allocations are aligned, so the bottom three bits are free for tagging.

### C — A minimal tagged-pointer scheme (Ruby/OCaml style)

```c
#include <stdio.h>
#include <stdint.h>

typedef uintptr_t Value;

// low bit 1 => small int (63-bit); low bit 0 => pointer
static inline Value tag_int(intptr_t n)   { return (Value)((n << 1) | 1); }
static inline int   is_int(Value v)       { return v & 1; }
static inline intptr_t untag_int(Value v) { return (intptr_t)v >> 1; }   // arithmetic shift

static inline Value tag_ptr(void *p)      { return (Value)p; }            // low bit already 0
static inline int   is_ptr(Value v)       { return (v & 1) == 0; }
static inline void *untag_ptr(Value v)    { return (void *)v; }

// Tagged addition keeps the tag: (2a+1)+(2b+1) = 2(a+b)+2  =>  result - 1
static inline Value add_tagged(Value a, Value b) { return a + b - 1; }

int main(void) {
    Value a = tag_int(20), b = tag_int(22);
    Value c = add_tagged(a, b);
    printf("is_int(c)=%d  value=%ld\n", is_int(c), (long)untag_int(c)); // 1, 42
    return 0;
}
```

This is the *actual* arithmetic OCaml emits for tagged ints: addition is `a + b - 1`, no untag needed; multiplication must untag first.

### C — Sketching NaN-box encode/decode

```c
#include <stdio.h>
#include <stdint.h>
#include <string.h>

// Quiet-NaN mask: exponent all ones + quiet bit. Pointer payload in low 48 bits.
#define QNAN      0x7FFC000000000000ULL
#define SIGN_BIT  0x8000000000000000ULL
#define TAG_PTR   (QNAN | SIGN_BIT)            // pointers: set sign + qNaN
#define PAYLOAD   0x0000FFFFFFFFFFFFULL        // low 48 bits

typedef uint64_t Value;

static Value from_double(double d) { Value v; memcpy(&v, &d, 8); return v; }
static double to_double(Value v)   { double d; memcpy(&d, &v, 8); return d; }

static int    is_double(Value v) { return (v & QNAN) != QNAN; }
static Value  box_ptr(void *p)   { return TAG_PTR | ((uint64_t)p & PAYLOAD); }
static void  *unbox_ptr(Value v) { return (void *)(uintptr_t)(v & PAYLOAD); }

int main(void) {
    Value d = from_double(3.14);
    printf("is_double(3.14) = %d  -> %g\n", is_double(d), to_double(d)); // 1 -> 3.14

    int local = 7;
    Value p = box_ptr(&local);
    printf("is_double(ptr) = %d  -> *p = %d\n", is_double(p), *(int*)unbox_ptr(p)); // 0 -> 7
    return 0;
}
```

A real double passes the `is_double` test; a boxed pointer fails it (its bits collide with the qNaN pattern). The pointer survives a round-trip through the 48-bit payload. `senior.md` extends this to ints and immediates.

### JavaScript — Watching SMI vs HeapNumber boundaries

```javascript
// Conceptually: small integers are SMIs (fast, inline); others are HeapNumbers (boxed).
const SMI_MAX = 2 ** 31 - 1;   // V8 32-bit-build SMI range (illustrative)

console.log(Number.isInteger(SMI_MAX));        // true
console.log(Number.isInteger(SMI_MAX + 1));    // true, but now likely a HeapNumber/double
console.log(0.1 + 0.2 === 0.3);                // false — always a double, FP rounding

// Integer-keyed arrays stay on the fast (SMI) path:
const fast = [1, 2, 3];        // packed SMI elements
const slow = [1.5, 2.5];       // packed double elements (different internal kind)
```

You can't see SMIs directly, but the performance cliff at large integers and the "packed elements kind" transitions are their observable shadow.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Pointer tagging — speed** | Tag check + untag is 1–2 register instructions; small ints need no allocation. | Every pointer use needs an untag; every arithmetic op needs tag-adjusting code. |
| **Pointer tagging — range** | Keeps the common case (small ints, array indices) fast. | Integer range shrinks by 1+ bits (OCaml 63-bit, V8 31-/32-bit SMI). |
| **NaN-boxing — speed** | All FP arithmetic is native; one uniform 64-bit value type; no separate type word. | Pointer/int access needs masking; encode/decode logic is intricate. |
| **NaN-boxing — uniformity** | A value is *always* 8 bytes; arrays of values are dense and cache-friendly. | Hard dependency on a 48-bit pointer assumption. |
| **Both vs boxing** | Eliminate the allocation + GC + cache-miss tax for common values. | More complex VM; harder to debug raw values; platform-specific. |
| **Portability** | Tagging is portable (depends only on alignment). | NaN-boxing leans on architecture address-width facts that can change. |

---

## Use Cases

- **Dynamic-language VMs.** Any runtime whose values are "int or pointer or immediate" benefits: JS engines, Lua, Ruby, OCaml, Lisp implementations.
- **Integer-heavy dynamic code** (array indexing, counters): pointer tagging keeps these allocation-free.
- **Float-heavy dynamic code** (graphics, numeric scripting): NaN-boxing makes the common operation native.
- **Memory-constrained interpreters:** a uniform single-word value avoids per-value boxing overhead across millions of values.

Don't reach for these when:

- **You control the static types** (Java primitives, C# generics, Rust enums) — the compiler already specializes and there's nothing to encode dynamically.
- **You need full 64-bit integer range with no boxing fallback** — tagging sacrifices range; you'd need a different scheme.

---

## Coding Patterns

### Pattern 1: Tag check before every use

```c
if (is_int(v))      handle_int(untag_int(v));
else                handle_ptr(untag_ptr(v));
```

Never dereference or arithmetic-on a tagged value without first asking its kind.

### Pattern 2: Keep the tag through arithmetic

```c
// OCaml-style add avoids untag/retag:
Value sum = a + b - 1;     // not untag, add, retag
```

Fold the tag fix-up into the operation rather than round-tripping through the untagged form.

### Pattern 3: Reserve one canonical NaN

```c
// Use a single, well-known qNaN for genuine NaN results so it never
// collides with the boxed-value tag space.
#define CANONICAL_NAN 0x7FF8000000000000ULL
```

### Pattern 4: Branch on "is it a double?" first

```c
if (is_double(v)) return fast_float_op(to_double(v));
return slow_path(v);   // int / ptr / immediate
```

Because floats are the no-op fast path in NaN-boxing, test for them first.

---

## Best Practices

- **Make the fast path branch-predictable.** Order tag checks so the common case (small int or double) is the first, predicted branch. A mispredict can cost more than the work.
- **Sign-extend tagged integers correctly.** Untagging must use an *arithmetic* shift, or negative numbers come back wrong.
- **Pick quiet NaNs, never signaling.** Signaling NaNs can raise FP exceptions; box only into quiet-NaN space.
- **Document the bit layout as law.** Write the exact masks and tag constants in one header with a diagram. Everyone touching the VM must agree on it.
- **Centralize encode/decode.** All boxing/tagging goes through a handful of `inline` functions, never ad-hoc bit-twiddling at call sites.
- **Test the boundaries.** Tagged-int overflow, the SMI range edge, the largest pointer, the canonical NaN — these are exactly where bugs hide.
- **Keep a debug "describe value" function.** Given a raw word, print whether it's a double, int, pointer, or immediate. Invaluable when debugging.

---

## Edge Cases & Pitfalls

- **Logical vs arithmetic shift on untag.** Untag a negative tagged int with a logical shift and you get a huge positive number. Use signed (arithmetic) shift.
- **Tagged-int overflow.** `(a << 1)` can overflow the word for near-maximal ints; runtimes detect overflow and promote to a boxed bignum/HeapNumber.
- **The real NaN vs boxed values.** A genuine `NaN` result from `0.0/0.0` must use a bit pattern that doesn't collide with any boxed tag — hence the *canonical* NaN convention.
- **Negative-zero and infinities.** `-0.0` and `±Inf` are normal doubles (exponent all ones but fraction *zero* for Inf), so they pass `is_double` — make sure your NaN test checks the fraction, not just the exponent.
- **Pointer alignment assumptions.** If any object is *under*-aligned (e.g., a `char`-aligned interior pointer), its low bits aren't zero and tagging breaks. Only tag pointers you control the allocation of.
- **Multiplication of tagged ints.** Unlike add/sub, multiply needs an explicit untag of one operand, or the tag bits multiply into garbage.
- **48-bit pointer assumption.** NaN-boxing silently assumes the top 16 bits of a pointer are sign-extension filler. On systems that use those bits, this breaks (see `professional.md`).

---

## Common Mistakes

1. **Untagging with `>>` (logical) instead of arithmetic shift.** Corrupts negative integers.
2. **Forgetting to fix the tag after arithmetic.** `a + b` on two tagged ints yields `2(a+b)+2`, off by the tag.
3. **Testing only the exponent for NaN.** Infinity has the same all-ones exponent but zero fraction; you'll misclassify it as boxed.
4. **Boxing into a signaling NaN.** Raises FP exceptions on some platforms; use quiet NaNs.
5. **Tagging a pointer that isn't aligned.** Its low bits aren't zero; the tag corrupts the address.
6. **Assuming SMIs cover all integers.** They don't; large ints fall off the fast path to HeapNumber/bignum.
7. **Hard-coding the 48-bit pointer width.** Works today on x86-64/ARM64 userspace, but it's an architectural assumption, not a law.
8. **Scattering bit masks across the codebase.** Guarantees that one place gets the layout subtly wrong.

---

## Tricky Points

- **The tag lives in *unused* bits, so it's "free" — until you use the value.** The cost is deferred to every untag, not paid at storage time. Whether tagging wins depends on the read/write ratio of the workload.
- **NaN-boxing inverts the common/rare distinction.** Boxing makes ints fast and doubles slow (doubles get boxed); NaN-boxing makes doubles fast and ints "fast enough" (ints live in the payload). Choose based on whether your language's hot values are integers or floats.
- **There's a "nun-boxing" inverse.** Instead of pointers being the special-cased payload and doubles canonical, you can make *pointers* canonical and offset all doubles by a constant so no real value collides with NaN. JavaScriptCore's encoding is closer to this spirit. The choice tunes which operation is cheapest.
- **Tag checks interact with the branch predictor.** A polymorphic site (sometimes int, sometimes pointer) mispredicts and stalls; a monomorphic site is nearly free. This is why these encodings pair with inline caches and hidden classes.
- **Alignment guarantees are an ABI contract, not a hardware law.** They hold because the allocator promises them. Tag only memory you allocated under that promise.

---

## Test Yourself

1. Why does an 8-byte-aligned pointer always have its low 3 bits zero? How many distinct tags can you encode in those bits?
2. Write the OCaml-style tagged-int encoding for −7 and verify your untag (arithmetic shift) recovers −7, not a large positive number.
3. Given two OCaml tagged ints `a` and `b`, derive why addition is `a + b - 1` and subtraction is `a - b + 1`.
4. How many distinct NaN bit patterns does a 64-bit double have? Why is that "wasted" space the basis of NaN-boxing?
5. Why does NaN-boxing need to distinguish quiet from signaling NaNs? Which does it use and why?
6. Explain why a 64-bit pointer "fits" in a ~48-bit NaN payload. What architectural fact makes this true?
7. In V8, how does a single instruction distinguish an SMI from a HeapObject pointer? What happens to an integer too large to be an SMI?
8. Write the bit pattern for `+Infinity` and confirm your `is_double` test (exponent + fraction) classifies it as a double, not a boxed value.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│           ENCODINGS: POINTER TAGGING & NaN-BOXING (MIDDLE)        │
├──────────────────────────────────────────────────────────────────┤
│ FREE BITS                                                         │
│   8-byte alignment ⇒ low 3 bits of a pointer are 000 (free tag)   │
│   IEEE-754 double  ⇒ ~2^53 NaN bit patterns, only 1 ever needed   │
├──────────────────────────────────────────────────────────────────┤
│ POINTER TAGGING                                                   │
│   V8 SMI:    low bit 0 = int (upper bits), low bit 1 = HeapObject  │
│   OCaml:     (n<<1)|1 = int (63-bit); low bit 0 = pointer          │
│   Ruby:      Fixnum (n<<1)|1; nil/true/false/Symbol = immediates   │
│   untag int: arithmetic (signed) shift  — NEVER logical            │
│   add:       a + b - 1     sub: a - b + 1     mul: untag first      │
├──────────────────────────────────────────────────────────────────┤
│ IEEE-754 DOUBLE                                                   │
│   [ sign 1 | exponent 11 | fraction 52 ]                          │
│   NaN ⇔ exponent = 0x7FF AND fraction ≠ 0                         │
│   Inf ⇔ exponent = 0x7FF AND fraction = 0  (check fraction!)      │
│   quiet NaN: top fraction bit = 1 (use this); signaling: 0        │
├──────────────────────────────────────────────────────────────────┤
│ NaN-BOXING                                                        │
│   is_double:  (bits & QNAN_MASK) != QNAN_MASK                     │
│   box_ptr:    TAG | (ptr & 0x0000FFFFFFFFFFFF)   // 48-bit payload │
│   unbox_ptr:  bits & 0x0000FFFFFFFFFFFF                           │
│   works because userspace pointers are effectively 48 bits         │
├──────────────────────────────────────────────────────────────────┤
│ TRADE-OFFS                                                        │
│   tagging   → lose integer range, gain allocation-free small ints │
│   NaN-box   → native floats, but assumes 48-bit pointers          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Alignment** makes the low bits of an aligned pointer always zero, giving a free place to store a **tag**. **IEEE-754** reserves ~2⁵³ NaN bit patterns while a program needs only one, giving free **payload** to hide values in.
- **Pointer tagging** encodes the value's kind in spare bits. V8's **SMI** uses the low bit to separate small integers from HeapObject pointers; **OCaml** and **Ruby** mark integers with `(n<<1)|1`, yielding 63-bit ints, and Ruby adds immediate patterns for `nil`, `true`, `false`, and symbols.
- Tagged arithmetic adjusts for the tag: add is `a + b - 1`, subtract is `a - b + 1`, multiply must untag first. Untagging an integer **must** use an arithmetic (sign-preserving) shift.
- A **double** is `sign | 11-bit exponent | 52-bit fraction`. It is **NaN** iff exponent is all ones *and* fraction is non-zero — Infinity has all-ones exponent but a zero fraction, so a correct `is_double` test must check the fraction.
- **NaN-boxing** stuffs integers, pointers, and immediates into the ~51 spare payload bits of a quiet NaN, so every value is physically a double and float math is native. A pointer fits because userspace addresses are effectively **48 bits**.
- The tradeoffs are precise: tagging costs integer range and an untag per use; NaN-boxing costs intricate bit logic and a hard 48-bit-pointer assumption. Both eliminate boxing's allocation/GC/cache-miss tax for common values.
- The whole game is **spending spare bits wisely** and making the **tag check cheap and branch-predictable** — converting a memory-bound "what are you?" into a register-bound one.

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom, "Optimization" chapter: a complete, readable NaN-boxing implementation.
- *Real World OCaml* — the chapter on memory representation and the 63-bit tagged int.
- *Ruby Under a Microscope* — Pat Shaughnessy: the `VALUE` immediate encoding.
- *V8 blog* — "Pointer Compression in V8" and the Small Integer (SMI) representation.
- *What Every Computer Scientist Should Know About Floating-Point Arithmetic* — David Goldberg (for the IEEE-754 background).
- *IEEE 754-2008 / 2019* standard — the authoritative NaN definition.
- *NaN-boxing series* — Piotr Duperas / various blog write-ups on SpiderMonkey and LuaJIT encodings.

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling topics: IEEE-754 floating-point representation, integer representation and two's complement, and memory alignment live under `data-representation-and-numerics/`.
- Cross-cutting: garbage collection, interpreter/VM design, and CPU cache behavior under `language-internals/`.

---

## Diagrams & Visual Aids

### Alignment Frees the Low Bits

```text
8-byte aligned address (binary, low bits shown):
   ... 1 0 1 1 0 0 0 0   ← bottom 3 bits forced to 000
                   ^^^
                   tag space (free)

tag = address & 0b111      → 0..7 distinct kinds
ptr = address & ~0b111     → recover the real address
```

### IEEE-754 Double and the NaN Region

```text
┌──────┬──────────────┬──────────────────────────────────┐
│ sign │ exponent(11) │ fraction(52)                     │
└──────┴──────────────┴──────────────────────────────────┘
  exp = 0x7FF & fraction = 0      →  ±Infinity
  exp = 0x7FF & fraction ≠ 0      →  NaN   ← ~2^53 patterns, all spare
  top fraction bit = 1            →  quiet NaN (used by NaN-boxing)
```

### NaN-Box Layout

```text
                quiet NaN marker            48-bit payload
        ┌──────┬───────────────────────┬─┬──────────────────────────┐
DOUBLE  │  any double bit pattern that is NOT an all-ones-exp NaN     │
        ├──────┼───────────────────────┼─┼──────────────────────────┤
POINTER │ 1    │ 1111111 1111          │1│ 0xC0DE.... (48-bit addr)  │
INTEGER │ 0    │ 1111111 1111          │1│ tag + 32/48-bit int       │
IMMED.  │ 0    │ 1111111 1111          │1│ small code: true/false/nil│
        └──────┴───────────────────────┴─┴──────────────────────────┘
```

### V8 SMI vs HeapObject

```text
word & 1 == 0   →  SMI        : integer in upper bits, shift to read
word & 1 == 1   →  HeapObject : clear low bit, follow pointer

   SMI(5)        = 5 << 1     = ...000001010   (low bit 0)
   HeapObject(p) = p | 1      = ...xxxxxxxx1   (low bit 1)
```

### OCaml Tagged-Int Arithmetic

```text
encode(n) = 2n + 1            (always odd ⇒ never an aligned pointer)

  a = 2x+1,  b = 2y+1
  a + b      = 2x + 2y + 2 = 2(x+y) + 2     ← too big by 1 tag
  a + b - 1  = 2(x+y) + 1  = encode(x+y)    ✓
```
