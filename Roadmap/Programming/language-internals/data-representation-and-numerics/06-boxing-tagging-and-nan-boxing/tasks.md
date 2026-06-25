# Boxing, Tagging & NaN-Boxing — Tasks & Exercises

> **Topic:** [Boxing, Tagging & NaN-Boxing](README.md)
> **Focus:** Hands-on exercises that make boxing's cost, tagging's bit-tricks, and NaN-boxing's encoding concrete. Each has a self-check, a hint, and (sparingly) a solution sketch.

---

## How to Use This Page

Work top to bottom; difficulty rises within each section. For each task:

1. **Predict first.** Write down your expected answer before running anything. The gap between prediction and reality is where the learning is.
2. **Then verify** with the self-check.
3. **Peek at the hint only when stuck**, and the solution only after a real attempt.

Languages: Java and C# for boxing traps, Python for the object model, C for the bit-level encodings, JavaScript for SMIs. Use whatever you have; the *concepts* transfer.

---

## Table of Contents

- [Section 1 — Boxing Cost & Traps (Junior)](#section-1--boxing-cost--traps-junior)
- [Section 2 — Language Caches & Identity (Junior–Middle)](#section-2--language-caches--identity-juniormiddle)
- [Section 3 — Pointer Tagging by Hand (Middle)](#section-3--pointer-tagging-by-hand-middle)
- [Section 4 — IEEE-754 & NaN-Boxing Bits (Middle–Senior)](#section-4--ieee-754--nan-boxing-bits-middlesenior)
- [Section 5 — Build a Value Type (Senior)](#section-5--build-a-value-type-senior)
- [Section 6 — Platform & Production (Professional)](#section-6--platform--production-professional)
- [Section 7 — Design & Reasoning (Senior–Professional)](#section-7--design--reasoning-seniorprofessional)
- [Self-Check Answer Key](#self-check-answer-key)

---

## Section 1 — Boxing Cost & Traps (Junior)

### Task 1.1 — Measure `int[]` vs `ArrayList<Integer>`

Sum 10,000,000 integers stored two ways: in an `int[]` and in an `ArrayList<Integer>`. Time both. Report the ratio.

**Self-check:** The `int[]` version should be meaningfully faster (often 2–5×) and allocate essentially nothing extra, while the `ArrayList<Integer>` version allocates millions of boxes.

<details>
<summary>Hint</summary>

Warm up the JIT (run the timed loop several times, discard the first runs). Use `System.nanoTime()`. To see allocations, run with `-verbose:gc` or a profiler.
</details>

<details>
<summary>Solution sketch</summary>

```java
int n = 10_000_000;
int[] arr = new int[n];
List<Integer> list = new ArrayList<>(n);
for (int i = 0; i < n; i++) { arr[i] = i; list.add(i); }

long t0 = System.nanoTime();
long s1 = 0; for (int x : arr) s1 += x;
long t1 = System.nanoTime();
long s2 = 0; for (Integer x : list) s2 += x;   // auto-unbox each element
long t2 = System.nanoTime();

System.out.printf("int[]=%dns  ArrayList=%dns  ratio=%.1f%n",
    t1 - t0, t2 - t1, (double)(t2 - t1) / (t1 - t0));
```
The gap is allocation + GC + pointer-chasing cache misses on the boxed list.
</details>

---

### Task 1.2 — Trigger the null-unbox NPE

Write the shortest Java program where a line that *looks like* a plain `int` assignment throws a `NullPointerException`.

**Self-check:** The stack trace points at the assignment line, and the cause is an implicit `.intValue()` on `null`.

<details>
<summary>Hint</summary>

A `Map<String,Integer>.get` of a missing key returns `null`. Assign it to an `int`.
</details>

<details>
<summary>Solution sketch</summary>

```java
Map<String, Integer> m = new HashMap<>();
int x = m.get("nope");   // NPE: auto-unbox of null
```
</details>

---

### Task 1.3 — Find hidden boxing

Take this snippet and identify every place boxing or unboxing occurs:

```java
Map<Integer, Integer> counts = new HashMap<>();
for (int i = 0; i < 100; i++) {
    counts.merge(i % 10, 1, Integer::sum);
}
int total = counts.values().stream().reduce(0, Integer::sum);
```

**Self-check:** You should find boxing at the map key, the map value, the literal `1`, the `Integer::sum` reduction, and unboxing into `int total`.

---

## Section 2 — Language Caches & Identity (Junior–Middle)

### Task 2.1 — Map the Java Integer cache boundary

Loop `i` from −200 to 200. For each, print whether `Integer.valueOf(i) == Integer.valueOf(i)`. Find where identity flips.

**Self-check:** Identity holds for −128..127 inclusive and fails outside. The boundaries are exactly −129/−128 and 127/128.

<details>
<summary>Hint</summary>

`Integer.valueOf` (which autoboxing calls) returns cached objects for −128..127. Use `==`, not `.equals`.
</details>

---

### Task 2.2 — The `Long` cache

Repeat Task 2.1 with `Long.valueOf`. Does the boundary match `Integer`'s?

**Self-check:** Yes — `Long` caches −128..127 identically.

---

### Task 2.3 — Map the Python small-int cache

In Python, find experimentally the lowest and highest integers `n` for which constructing `n` two ways yields `n is n`. Use a function so literals aren't constant-folded into one object:

```python
def two(n):
    a = int(str(n))   # force separate construction
    b = int(str(n))
    return a is b
```

**Self-check:** `two(n)` is `True` for n in −5..256 and `False` outside. The cache range is −5..256.

<details>
<summary>Hint</summary>

CPython pre-creates `PyLongObject`s for −5..256. Constant-folding can mask the boundary, which is why we round-trip through `str`/`int`.
</details>

---

### Task 2.4 — C# boxing is a copy

In C#, box an `int`, then mutate the original. Show the box doesn't change.

**Self-check:**
```csharp
int x = 5;
object b = x;   // boxes a COPY
x = 99;
Console.WriteLine((int)b);   // 5, not 99
```
The box holds an independent copy.

---

## Section 3 — Pointer Tagging by Hand (Middle)

### Task 3.1 — Prove alignment frees the low bits

In C, `malloc` several blocks and print `(uintptr_t)p & 0x7` for each.

**Self-check:** Every result is `0` — allocations are at least 8-byte aligned, so the low 3 bits are free.

---

### Task 3.2 — Implement OCaml-style tagged integers

Implement `tag_int`, `untag_int` (sign-correct!), `is_int`, and tagged `add`/`sub`. Verify with positive and **negative** values.

**Self-check:** `untag_int(tag_int(-7))` returns `-7` (not a huge positive number), and `add(tag_int(20), tag_int(22))` decodes to `42`.

<details>
<summary>Hint</summary>

Encode `(n << 1) | 1`. Untag with an **arithmetic** (signed) right shift: cast to `intptr_t` before `>> 1`. Tagged add is `a + b - 1`.
</details>

<details>
<summary>Solution sketch</summary>

```c
typedef uintptr_t V;
V    tag_int(intptr_t n) { return (V)((n << 1) | 1); }
int  is_int(V v)         { return v & 1; }
intptr_t untag(V v)      { return (intptr_t)v >> 1; }   // signed shift
V    add(V a, V b)       { return a + b - 1; }
V    sub(V a, V b)       { return a - b + 1; }
```
A logical shift would break `untag(tag_int(-7))`.
</details>

---

### Task 3.3 — Tagged multiplication

Extend Task 3.2 with tagged multiply. Explain why it can't be `a * b` with a simple fix-up like add/sub.

**Self-check:** Multiply must untag at least one operand: `mul(a,b) = tag_int(untag(a) * untag(b))` (or `((a>>1) * (b-1)) ... ` schemes). `a * b` on `(2x+1)(2y+1)` expands to `4xy + 2x + 2y + 1`, which is not a simple offset from `2xy+1`.

---

### Task 3.4 — Distinguish int from pointer in a slot

Store both a tagged int and a real (aligned) pointer in the same `V`-typed array, then write a loop that dispatches on the tag and either prints the int or dereferences the pointer.

**Self-check:** No misclassification — ints (low bit 1) never collide with aligned pointers (low bit 0).

---

## Section 4 — IEEE-754 & NaN-Boxing Bits (Middle–Senior)

### Task 4.1 — Dump the bits of a double

In C, `memcpy` a `double` into a `uint64_t` and print it in hex for: `1.0`, `-0.0`, `+Inf`, `0.0/0.0` (NaN), and `3.14`.

**Self-check:** `+Inf` has exponent all ones and fraction zero; the NaN has exponent all ones and a non-zero fraction. `-0.0` has only the sign bit set.

<details>
<summary>Hint</summary>

`uint64_t bits; memcpy(&bits, &d, 8);` then print `%016llx`. The exponent is bits 52–62, the fraction is bits 0–51.
</details>

---

### Task 4.2 — Write a correct `is_double`

Write `is_double(uint64_t bits)` that returns true for *all* real doubles — including ±Inf and `-0.0` — and false for your boxing tag pattern. Test it against every value from Task 4.1.

**Self-check:** ±Inf and `-0.0` return `true`. The bug to avoid: testing only "exponent all ones," which would wrongly flag ±Inf as non-double.

<details>
<summary>Hint</summary>

NaN ⇔ exponent all ones AND fraction ≠ 0. A value is "boxed" only if its bits match your reserved quiet-NaN tag mask: `(bits & QNAN) == QNAN`. Everything else (including ±Inf, whose fraction is 0 and so doesn't match a quiet-NaN-with-payload) is a double.
</details>

---

### Task 4.3 — Count the spare NaN patterns

Compute, with reasoning, how many distinct NaN bit patterns a 64-bit double has. Why does this number justify NaN-boxing?

**Self-check:** Exponent fixed all-ones (1 way), sign free (×2), fraction any non-zero value (2⁵² − 1). Total `2 × (2⁵² − 1) ≈ 2⁵³`. A program needs exactly one NaN, leaving ~2⁵³ patterns as free storage.

---

### Task 4.4 — Round-trip a pointer through a NaN payload

In C, box a pointer into a quiet NaN's low 48 bits and unbox it. Verify `*unboxed == *original`.

**Self-check:** Dereferencing the unboxed pointer yields the original value. `is_double` returns `false` for the boxed pointer.

<details>
<summary>Hint</summary>

`box = TAG_PTR | ((uint64_t)p & 0x0000FFFFFFFFFFFF);` and `unbox = (void*)(box & 0x0000FFFFFFFFFFFF);`. Use a stack variable's address (it'll be within 48 bits on a normal host).
</details>

---

## Section 5 — Build a Value Type (Senior)

### Task 5.1 — A full NaN-boxed `Value`

Implement a `Value` type supporting: double, 32-bit int (inline), pointer (48-bit), and immediates `true`/`false`/`null`. Provide `from_*`/`as_*`/`is_*` for each. Write a `describe(Value)` that prints the kind.

**Self-check:** `describe` correctly classifies a double, an inline int, a pointer, and each immediate. `from_double(v2d(from_double(3.14)))` round-trips to `3.14`.

<details>
<summary>Hint</summary>

Reserve the quiet-NaN region. Doubles are anything where `(bits & QNAN) != QNAN`. Use the sign bit for pointers, a free high bit for the int marker, and small low codes for immediates. Keep all bit constants in one header.
</details>

---

### Task 5.2 — Integer fast path with overflow promotion

Add `value_add(Value a, Value b)`: if both are inline ints, add them; if the result overflows 32 bits, promote to a double. If both are doubles, add natively. Otherwise, return a sentinel "slow path" marker.

**Self-check:** `value_add(from_int(INT32_MAX), from_int(1))` returns a *double* equal to `2147483648.0`, not a wrapped int.

<details>
<summary>Hint</summary>

Compute in `int64_t`; check `r == (int32_t)r` to decide whether it fits inline.
</details>

---

### Task 5.3 — GC trace that decodes values

Write `trace(Value *slots, size_t n, void (*mark)(void*))` that calls `mark` only on the pointer-typed slots and skips doubles, ints, and immediates.

**Self-check:** Given a mixed array, `mark` is invoked exactly once per pointer value and never on a scalar. This is the representation/GC coupling: the GC uses the *same* `is_ptr`/`as_ptr` as the interpreter.

---

### Task 5.4 — Canonicalize a real NaN

Demonstrate the genuine-NaN-collision bug: produce `0.0/0.0`, store its raw bits as a `Value`, and show (a) it may be misclassified by `is_double` if it lands in tag space, and (b) canonicalizing it to a reserved NaN fixes the classification.

**Self-check:** After canonicalization, the NaN classifies as a double and never aliases a pointer/immediate tag.

---

## Section 6 — Platform & Production (Professional)

### Task 6.1 — Assert the 48-bit budget

Add a debug-build assertion to your `box_ptr` that the pointer fits in 48 bits. Then deliberately feed it a fabricated 49-bit address and show the assert fires.

**Self-check:** With a normal pointer the assert passes; with `(void*)0x0001_7FFE_C0DE_1000` it fires. (Don't dereference the fabricated address — just box it.)

<details>
<summary>Hint</summary>

`assert((a & ~0x0000FFFFFFFFFFFFULL) == 0)`. This single guard is what catches 5-level-paging and high-mmap surprises in CI.
</details>

---

### Task 6.2 — Simulate silent truncation

Without the assertion, box a fabricated 49-bit address and unbox it. Show the unboxed address differs from the input (bit 48 dropped) — the silent-corruption failure mode.

**Self-check:** `unbox(box(0x0001_7FFE_C0DE_1000))` yields `0x0000_7FFE_C0DE_1000` — a *different* address, no crash. Explain why this is worse than a crash.

---

### Task 6.3 — Choose a representation from platform caps

Write `choose_repr(caps)` that returns `NANBOX` only when LA57, PAC, TBI-conflict, and MTE are all absent, and `TAGGED` (or `BOXED`) otherwise. Explain why tagging is the safer fallback.

**Self-check:** With all caps false → `NANBOX`; with any high-bit-claiming feature true → fallback. Tagging depends only on alignment, which no current feature breaks.

---

### Task 6.4 — Version the layout as an ABI

Add a `VALUE_LAYOUT_VERSION` constant and a `_Static_assert` that fails loudly if it changes, with a comment listing what must be migrated (embedders, snapshots, JIT code caches). Explain, in two sentences, why the layout is an ABI.

**Self-check:** Bumping the version (deliberately) fires the static assert; the comment enumerates the migration steps.

---

## Section 7 — Design & Reasoning (Senior–Professional)

### Task 7.1 — Pick the representation

For each language sketch, name the best representation and justify in one line:
(a) a graphics-scripting language, mostly float math;
(b) a Lisp-like symbolic language, mostly cons cells and small ints;
(c) a language with a stable C embedding API shipping on x86-64 and arm64e.

<details>
<summary>Solution sketch</summary>

(a) NaN-boxing — floats are native, everything else hides in the payload.
(b) Pointer tagging — inline small ints + immediates; alignment-only, portable; pointers (cons cells) dominate and stay untagged.
(c) Tagging (or SMI + pointer compression like V8) — alignment-only assumptions port cleanly to arm64e/PAC; treat the layout as a versioned ABI for the embedders.
</details>

---

### Task 7.2 — NaN-boxing vs nun-boxing

Explain, with the bit-level reason, which operation is zero-cost and which pays in (a) NaN-boxing and (b) nun-boxing (offset doubles). When would you choose each?

**Self-check:** NaN-boxing: doubles free, pointers/ints masked. Nun-boxing: pointers/ints free, doubles pay an offset add. Choose by whichever operation your language does most; JavaScriptCore-style code privileges pointers/ints.

---

### Task 7.3 — Explain the JS "all numbers are doubles" tension

In 3–5 sentences, explain why V8 has SMIs despite the spec saying every number is a double, and what observable behaviors reveal the two internal number kinds.

**Self-check:** Your answer mentions: small integers dominate real code; boxing them as doubles would be slow; SMIs are a fast inline lane, HeapNumbers the slow boxed lane; values silently move between lanes on overflow/non-integer; and `0.1 + 0.2 !== 0.3` plus large-integer slowdowns are the observable shadows.

---

### Task 7.4 — Write the boxing/tagging/NaN-boxing comparison table from memory

Without looking, fill a table with rows {inline fast type, integer range, float speed, per-op cost, GC implication, best-when} for boxing, tagging, and NaN-boxing.

**Self-check:** Compare against the Core Concepts table in `senior.md`. Key facts: boxing privileges pointers (GC trivial, ops simple, primitives slow); tagging privileges small ints (reduced range, untag per use, alignment-only); NaN-boxing privileges doubles (native floats, masks pointers, assumes 48-bit addresses).

---

### Task 7.5 — Debug the PAC failure

A teammate ports the NaN-boxing VM to arm64e. It crashes on the first indirect call through a boxed pointer. Diagnose the root cause and give the fix protocol.

<details>
<summary>Solution sketch</summary>

PAC stored a signature in the pointer's high bits; boxing masked those bits to fit the 48-bit payload, destroying both the address and the signature. On unbox, the value is neither a valid address nor a valid signed pointer, so the indirect call faults. Fix: **strip** the auth (`xpaci`) to get the bare address before boxing, store the bare address, and **re-sign** (`pacia`/`autia`) before dereferencing. The boxing boundary must explicitly mediate PAC.
</details>

---

## Self-Check Answer Key

| Task | Key fact to confirm |
|------|---------------------|
| 1.1 | `int[]` 2–5× faster; boxed list allocates millions of objects. |
| 1.2 | `int x = map.get(absent)` → NPE via implicit `.intValue()` on null. |
| 1.3 | Boxing at key, value, literal `1`, `Integer::sum`, and unbox into `int`. |
| 2.1 | Identity holds exactly −128..127; flips at ±128/129 boundary. |
| 2.2 | `Long` cache matches `Integer`: −128..127. |
| 2.3 | Python small-int cache is −5..256. |
| 2.4 | Box is an independent copy; mutating the original doesn't change it. |
| 3.1 | `addr & 0x7 == 0` for all allocations (8-byte alignment). |
| 3.2 | Untag negative ints with arithmetic shift; tagged add is `a+b-1`. |
| 3.3 | Multiply must untag an operand; no simple constant fix-up exists. |
| 3.4 | Ints (low bit 1) never collide with aligned pointers (low bit 0). |
| 4.1 | +Inf: all-ones exp, zero fraction. NaN: all-ones exp, non-zero fraction. |
| 4.2 | `is_double` must check the fraction; ±Inf and −0.0 are doubles. |
| 4.3 | ~2⁵³ NaN patterns; one needed; the rest are free storage. |
| 4.4 | Pointer survives a 48-bit payload round-trip; boxed ptr is not a double. |
| 5.1 | `describe` classifies all kinds; double round-trips. |
| 5.2 | INT32_MAX + 1 promotes to the double 2147483648.0. |
| 5.3 | GC marks only pointer slots, using the same decode as the interpreter. |
| 5.4 | Canonicalizing a real NaN stops it aliasing tag space. |
| 6.1 | Assert passes for normal ptrs, fires for a 49-bit address. |
| 6.2 | Unbox of a 49-bit address drops bit 48 → different valid address, no crash. |
| 6.3 | NaN-box only when no high-bit feature is present; tagging is the safe fallback. |
| 6.4 | Layout is an ABI: embedders, snapshots, JIT caches all consume it. |
| 7.1 | (a) NaN-box, (b) tagging, (c) tagging/SMI+compression for portability. |
| 7.2 | NaN-box: doubles free; nun-box: pointers/ints free. Pick by hottest op. |
| 7.3 | SMIs are the fast integer lane; HeapNumber the slow boxed lane. |
| 7.4 | Privileged type per strategy: pointers / small ints / doubles. |
| 7.5 | PAC signature masked off by boxing; strip before box, re-sign on use. |

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md).
- Sibling topics: IEEE-754 floating-point representation and integer representation under `data-representation-and-numerics/`.
- Cross-cutting: garbage collection, VM/JIT design, and virtual memory/paging under `language-internals/`.
