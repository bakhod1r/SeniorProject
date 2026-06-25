# Boxing, Tagging & NaN-Boxing — Interview Questions

> **Topic:** [Boxing, Tagging & NaN-Boxing](README.md)

---

## Introduction

These questions probe whether a candidate understands the central problem of dynamic value representation: a single machine word must hold either a primitive or a reference, and the runtime must know which without a separate type field. A strong candidate moves fluently between the three answers — boxing (heap-wrap the primitive), pointer tagging (steal an aligned pointer's spare bits), and NaN-boxing (hide values in a double's unused NaN payload) — and can reason about the cost of each in allocation, GC, cache behavior, and integer range. They know the language-specific surfaces cold: Java's autoboxing traps and the −128..127 `Integer` cache, C#'s struct/object boxing and how generics avoid it, Python's everything-is-an-object model and small-int cache, V8's SMI tagging, LuaJIT's NaN-boxing, and Ruby's tagged Fixnum/immediates. A weaker candidate treats "boxing" as a vague performance word and cannot derive *why* `int[]` beats `ArrayList<Integer>` or *how* a pointer fits inside a NaN.

The sections below run from conceptual foundations through language-specific surfaces, into traps where the obvious answer is wrong, and finally to design scenarios that test whether the candidate has actually thought about building or tuning a runtime.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [C#](#c)
  - [Python](#python)
  - [JavaScript / V8](#javascript--v8)
  - [Lua / LuaJIT](#lua--luajit)
  - [Ruby](#ruby)
  - [OCaml](#ocaml)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Conceptual / Foundational

## Question 1

**What problem do boxing, tagging, and NaN-boxing all solve?**

A single fixed-size slot (one machine word) in a dynamically typed context must hold *either* a primitive value (an integer, a float, `true`) *or* a reference to a heap object — and the runtime must be able to tell which, without storing a separate type field per slot. The three techniques are escalating answers. **Boxing** makes everything a pointer: wrap the primitive in a heap object so the slot is uniformly a pointer. **Pointer tagging** keeps small values inline and uses the spare bits of an aligned pointer to mark "this is a small int, not a pointer." **NaN-boxing** hides ints, pointers, and immediates inside the unused payload bits of an IEEE-754 NaN, so every value is physically a double. All three answer "how do I pack a value *and* its kind into one word?"

## Question 2

**What exactly is boxing, and why is it slow?**

Boxing wraps a primitive in a heap-allocated object so it can be referenced and treated polymorphically — `int 5` becomes an `Integer` object holding 5, and the slot holds a pointer to it. It's slow for three compounding reasons: (1) **allocation** — each box is a heap allocation; (2) **GC pressure** — each box is short-lived garbage the collector must trace and reclaim; (3) **cache misses from pointer chasing** — a boxed collection stores *pointers* contiguously, but the values they point to are scattered across the heap, so iterating means jumping around memory, missing the cache at each element. The third cost is usually the largest in tight loops.

## Question 3

**Why is `int[]` faster than `ArrayList<Integer>`?**

An `int[]` stores the integers *inline and contiguously* — the CPU streams them with excellent cache behavior and no allocation per element. An `ArrayList<Integer>` stores an array of *pointers* to boxed `Integer` objects scattered on the heap. So `ArrayList<Integer>` costs: extra memory (object header + value + pointer per element, often ~24 bytes vs 4), a heap allocation per boxed element, GC work to reclaim them, and a likely cache miss per element when iterating (pointer chasing). In numeric loops the difference is frequently several-fold.

## Question 4

**How does pointer tagging exploit alignment, and what does it cost?**

Heap objects are aligned (commonly 8 bytes), so every pointer to one is a multiple of 8 and its **low 3 bits are always zero** — free storage. A runtime uses those bits as a tag: e.g., low bit 1 means "this word is a small integer (in the upper bits)," low bit 0 means "this is a real pointer." The check is one instruction (`x & 1`), and the untag is one shift or mask. The cost is **reduced integer range** — spending a bit on the tag means a 63-bit (or 31-bit) integer instead of 64 — plus an untag on every use, and tag-adjusting arithmetic.

## Question 5

**How does NaN-boxing work, and why is there room for a pointer inside a NaN?**

A 64-bit IEEE-754 double is `NaN` whenever its exponent is all ones and its fraction is non-zero. That's roughly **2⁵³ distinct NaN bit patterns**, but a program needs only one. NaN-boxing hijacks the other ~2⁵³ patterns: it stores non-double values (ints, pointers, `true`/`false`/`null`) inside the ~51 spare payload bits of a quiet NaN, so *every* value is physically a double and float arithmetic is native. A pointer fits because real userspace pointers are effectively **48 bits** (x86-64/ARM64 canonical addresses sign-extend bit 47), which slots into the NaN payload with room left for a small tag.

## Question 6

**Why does NaN-boxing usually use quiet NaNs rather than signaling NaNs?**

A signaling NaN (top fraction bit clear) can raise a floating-point exception when used in arithmetic; a quiet NaN (top fraction bit set) propagates silently. Since a NaN-boxed value's bits may pass through a code path that treats the slot as a double, boxing into a *quiet* NaN avoids spuriously raising FP exceptions. NaN-boxing therefore reserves the quiet-NaN region for its tags and payload.

## Question 7

**A common test for NaN says "exponent is all ones." Why is that test incomplete for NaN-boxing?**

Because **±Infinity** also has an all-ones exponent — its fraction is *zero*. NaN requires all-ones exponent *and* a non-zero fraction. A representation that classifies "all-ones exponent ⇒ boxed value" would misclassify ±Inf (and any boxed pattern would collide with infinities). The `is_double` / `is_boxed` test must inspect the fraction (or use a full mask), not just the exponent. The same care applies to `-0.0`, which is an ordinary double.

## Question 8

**Compare the three strategies on where the cost lands.**

Boxing pushes cost into the **allocator and GC** — many small short-lived objects — but keeps access simple (the slot is just a pointer). Tagging and NaN-boxing push cost into **every operation** — each access must decode/untag/mask — but relieve the allocator (common values are inline, no allocation). So the right choice depends on the workload: allocation-bound code may tolerate inline-decode overhead poorly, while operation-bound numeric code benefits hugely from inline values. You're choosing *where* to pay, not whether.

## Question 9

**Why do small-integer caches (Java −128..127, Python −5..256) exist?**

Boxing every integer would allocate a fresh object for even the most common small values, which dominate real programs (loop counters, indices, small counts). Caching pre-allocates the boxes for a small range and reuses the *same* object each time, eliminating those allocations and deduplicating memory. The side effect is that identity comparison (`==` in Java, `is` in Python) *accidentally* succeeds for cached values and fails outside the range — a correctness trap, not a guarantee.

## Question 10

**What is the trade-off in integer range for tagged and NaN-boxed integers?**

A tagged integer spends bits on the tag: 1 bit ⇒ 63-bit ints (OCaml), and V8 SMIs are 31- or 32-bit. A NaN-boxed inline integer fits in the payload, typically 32 bits (sometimes up to ~48). When a value exceeds the inline range, the runtime promotes it to a **boxed** representation (V8 HeapNumber, a bignum, or a heap double), moving it from the fast lane to the slow lane. This is the mechanism behind "small integers are fast, large integers are slow" in these languages.

---

## Language-Specific

### Java

## Question 11

**Explain `Integer a = 127, b = 127; a == b` being `true` but `128` being `false`.**

`Integer.valueOf` caches boxed `Integer` objects for −128..127 and returns the *same* cached object for values in that range. So `Integer.valueOf(127)` twice yields one shared object, and `==` (reference identity) is `true`. For 128, each autobox allocates a *new* object, so `==` compares two distinct references and is `false`. The values are equal in both cases — `a.equals(b)` is always `true`. The rule: **never use `==` to compare boxed numbers; use `.equals`.** The cache makes `==` work *sometimes*, which is worse than never.

## Question 12

**Does `Long` have a cache like `Integer`?**

Yes. `Long.valueOf` caches −128..127 exactly like `Integer`. The same `==` trap applies: `Long x = 127L, y = 127L; x == y` is `true`, but at `128L` it's `false`. `Byte`, `Short`, and `Character` (0..127) also cache; `Float` and `Double` do not (caching floats by identity makes little sense).

## Question 13

**Why does `int n = map.get(key);` sometimes throw a NullPointerException?**

If `key` is absent, `map.get(key)` returns `null`. Assigning that to an `int` triggers **auto-unboxing**, which the compiler implements as `someInteger.intValue()` — a method call on `null`, hence an NPE. The crash appears on a line that looks like a harmless assignment, which is what makes it surprising. Use `map.getOrDefault(key, 0)` or check for null before unboxing.

## Question 14

**Where does hidden boxing sneak into otherwise primitive Java code?**

Generic collections (`List<Integer>`, `Map<K, Long>`) always box. `Stream<Integer>` boxes — use `IntStream`/`LongStream`/`DoubleStream` instead. Ternaries and conditionals that mix `Integer` and `int` can box/unbox. Method references like `Integer::sum` in a `Stream<Integer>` reduce box. Autoboxing in a hot loop (`Integer i = 0; i++` repeatedly) allocates a box per iteration. Each is invisible in the source but visible in an allocation profile.

### C#

## Question 15

**When does a value type get boxed in C#, and how do generics avoid it?**

A `struct` (value type, including `int`) is boxed when it's stored where a reference is expected: assigned to `object`, placed in a non-generic collection (`ArrayList`), or used through a non-generic interface. Boxing copies the value onto the heap and yields a reference. **Generics avoid this**: `List<int>` stores `int`s inline with no boxing because the CLR specializes generic code over value types (unlike Java's type erasure, which forces `List<Integer>`). This is a key Java-vs-C# difference: `List<int>` in C# is unboxed; `List<Integer>` in Java is always boxed.

## Question 16

**Is a boxed value in C# a reference to the original, or a copy?**

A copy. `object boxed = x;` copies `x`'s bits onto the heap; later mutations of `x` don't affect `boxed`, and unboxing copies back out. This surprises people who expect reference semantics — boxing a mutable struct and mutating "through" the box (where allowed) operates on the copy, a classic source of bugs.

## Question 17

**How do `Span<T>` and `stackalloc` help avoid boxing/allocation in C#?**

`Span<T>` is a stack-only view over contiguous memory (array, `stackalloc` buffer, or unmanaged memory) that lets you work with value types in place without boxing or heap allocation. Combined with generics and `stackalloc`, it enables high-performance numeric and parsing code that touches no heap and boxes nothing — the modern .NET answer to boxing-induced GC pressure in hot paths.

### Python

## Question 18

**In Python, is the integer `5` a primitive?**

No — in CPython, `5` is a full heap object (`PyLongObject`) with a reference count and type pointer. *Everything* is an object. The only reason integer identity ever appears to "work" is the **small-int cache**: CPython pre-creates the integers −5 to 256 as singletons and reuses them, so `256 is 256` is `True` while `1000 is 1000` is often `False`. Always compare values with `==`, never identity with `is`, for numbers.

## Question 19

**Why does `a is b` sometimes hold for equal Python integers and sometimes not?**

For values in the cached range (−5..256), both names bind to the same singleton object, so `is` (identity) is `True`. Outside that range, the interpreter may allocate separate objects, so `is` is `False` — though constant-folding within a single code block can sometimes make literals share an object, adding more nondeterminism. None of this is a language guarantee; it's an implementation detail of the cache and the compiler.

## Question 20

**How does the everything-is-an-object model affect Python's numeric performance, and what's the workaround?**

Because each `int`/`float` is a heap object, arithmetic involves object allocation and pointer indirection, and a list of numbers is a list of pointers to scattered objects — poor cache behavior, exactly the `ArrayList<Integer>` problem. The workaround is to push numeric work into C-backed contiguous representations: `array.array`, NumPy `ndarray` (unboxed C arrays), or vectorized operations, which store raw machine values contiguously and operate on them without per-element Python object overhead.

### JavaScript / V8

## Question 21

**What is an SMI in V8, and how is it distinguished from a pointer?**

An **SMI** ("Small Integer") is a tagged integer stored inline in a value word, no heap object. V8 distinguishes it from a HeapObject pointer by the **low bit**: an SMI has the low bit 0 (the integer lives in the upper bits), while a HeapObject pointer has the low bit 1. The check is a single `test` instruction. On 64-bit builds an SMI is a 32-bit int (historically shifted into the upper 32 bits); on 32-bit builds it was 31-bit. Integers outside the SMI range become **HeapNumber** objects (boxed doubles).

## Question 22

**JavaScript says "all numbers are doubles," yet V8 has SMIs. Resolve the tension.**

The language spec models every number as an IEEE-754 double, but real programs are full of *small integers* — array indices, loop counters, lengths, sizes. Representing those as boxed doubles would be ruinously slow, so V8 keeps a fast lane (SMIs: inline tagged integers, no allocation, integer arithmetic) and a slow lane (HeapNumber: boxed doubles). Values silently move between lanes — exceed the SMI range or become fractional and you fall to a HeapNumber. The spec semantics are preserved (everything *behaves* like a double); the representation is optimized for the common integer case. This dual representation is why integer-heavy JS is fast and why `0.1 + 0.2 !== 0.3` still holds (the slow lane is genuine FP).

## Question 23

**What is V8 pointer compression and how does it relate to tagging?**

Pointer compression stores **32-bit base-relative offsets** instead of full 64-bit pointers, halving the memory of every pointer-bearing value and improving cache density. It composes with SMI tagging: the low bit still separates SMI from pointer, but the pointer is now a compressed 31-bit reference into a 4 GB heap cage relative to a base register. V8 chose this over NaN-boxing in part because it depends only on alignment (portable) and avoids the address-width fragility of stuffing pointers into NaN payloads; the trade is a capped per-isolate heap size.

### Lua / LuaJIT

## Question 24

**How does LuaJIT represent values, and why does the choice matter for its speed?**

LuaJIT uses a NaN-boxed 64-bit `TValue`: a real double is stored as itself, and every other type (nil, boolean, light/full userdata, string/table pointers, integers) is encoded inside a NaN with a small itype tag in the high bits and the payload (a ~47-bit pointer) below. Because numbers — Lua's dominant type — are stored as native doubles needing no decode, arithmetic runs at full FP speed, which is essential to LuaJIT's trace-compiling JIT. The uniform 8-byte value also keeps tables and stacks dense and cache-friendly.

## Question 25

**What assumption does LuaJIT's NaN-boxing make about pointers, and when is it fragile?**

It assumes pointers fit in the NaN payload — i.e., userspace addresses are effectively ~47–48 bits, with the high bits available for the type tag. This holds on classic x86-64/ARM64 with 48-bit canonical addresses, but is fragile under 5-level paging (57-bit addresses), ARM pointer authentication (signature in the high bits), or environments that place the heap at high virtual addresses. A NaN-boxing runtime must constrain its allocations to fit the budget or it risks silently truncating pointers.

### Ruby

## Question 26

**How does MRI Ruby tag `Fixnum`, `nil`, `true`, `false`, and symbols?**

A Ruby `VALUE` is one word. Small integers (`Fixnum`, now folded into `Integer`) are tagged `(n << 1) | 1` — low bit 1 marks an immediate integer, giving ~63-bit range. `false` is `0`, `nil` is a small constant (e.g., `0x08`), `true` another (e.g., `0x14`), and `Symbol` has its own low-bit pattern. Anything that matches none of the immediate patterns (low bits `000`) is a pointer to a heap object (`RObject`, `RString`, etc.). So despite "everything is an object," `nil`, `true`, `false`, small integers, and symbols are never heap-allocated — they're immediate values.

## Question 27

**Why are immediate values important to Ruby's performance and semantics?**

Immediates need no allocation, no GC, and no pointer dereference — checking `nil?` or doing small-integer arithmetic is pure bit work. This matters because these values are extremely common. Semantically, immediates are also why `nil`, `true`, `false`, and small integers are effectively singletons: `nil.equal?(nil)` and `1.equal?(1)` hold by construction, whereas large integers and most objects are distinct heap allocations.

### OCaml

## Question 28

**Why is an OCaml `int` 63 bits, and how does tagged arithmetic work?**

OCaml tags integers with the low bit set: `encode(n) = (n << 1) | 1`. The low bit distinguishes immediate ints (low bit 1) from pointers (low bit 0, because heap blocks are aligned), letting the GC scan values without a separate type field. Spending that bit leaves **63 bits** of integer range. Arithmetic adjusts for the tag: addition is `a + b - 1` (since `(2x+1)+(2y+1) = 2(x+y)+2`, subtract one tag), subtraction is `a - b + 1`, and multiplication untags one operand first. This is a clean, portable tagging scheme that depends only on alignment, not on address width.

---

## Tricky / Trap Questions

## Question 29

**`Integer a = 1000; Integer b = 1000; if (a == b) ...` — is the branch taken?**

No (almost always). 1000 is outside the −128..127 `Integer` cache, so each autobox allocates a distinct object and `==` compares references, which differ. The trap: the same code with `100` *would* take the branch (cached, same object). Candidates who answer "true" are anchoring on the cached case. The correct, robust code uses `a.equals(b)`.

## Question 30

**Will `is_double(x)` return true for `+Infinity` if `x` holds positive infinity?**

It must — `+Infinity` is a genuine double. The trap is that a sloppy `is_double` implemented as "exponent is *not* all ones ⇒ double" would say `+Inf` is *not* a double (its exponent is all ones), misclassifying it as a boxed value. A correct test recognizes that NaN requires all-ones exponent *and* non-zero fraction, so ±Inf (all-ones exponent, zero fraction) is a normal double. This bug surfaces the moment a program computes an infinity.

## Question 31

**You untag a tagged negative integer and get a huge positive number. What's wrong?**

You used a **logical** right shift instead of an **arithmetic** (sign-preserving) one. Tagged ints store `(n << 1) | tag`; recovering `n` requires `>> 1` *with sign extension*, or a negative value's sign bit is lost and the result is a large positive number. Untagging signed integers must use a signed/arithmetic shift.

## Question 32

**Two tagged OCaml-style ints are added with plain `a + b` and the result is wrong. Why?**

Each tagged int is `2n+1`. Adding two gives `(2x+1)+(2y+1) = 2(x+y)+2` — that's `encode(x+y) + 1`, off by one tag. Correct tagged addition is `a + b - 1`. Plain `+` leaves a stray tag bit, so the decoded result is wrong (and the value may not even be a valid tagged int). The fix is tag-correcting arithmetic; multiplication is worse — you must untag an operand first.

## Question 33

**"NaN-boxing means we can store any 64-bit pointer in any value." True?**

False. NaN-boxing relies on pointers being effectively ~48 bits so they fit the NaN payload alongside the tag. A full 64-bit pointer with high bits set (5-level paging, PAC-signed, high-mmap, or sandboxed heap) will not fit; masking it to the payload **silently truncates** it to a different valid-looking address — memory corruption with no crash at the scene. The assumption is an OS/ABI configuration, not a guarantee, and production runtimes must enforce it.

## Question 34

**In C#, `List<int>` vs Java `List<Integer>` — both box, right?**

No — this is the trap. `List<int>` in C# stores ints inline with **no boxing** because the CLR specializes generics over value types. Java's `List<Integer>` *always* boxes because generics are erased and the element type must be a reference. Carrying Java intuition ("generic collections box primitives") to C# is wrong.

## Question 35

**A genuine `NaN` from `0.0/0.0` makes your NaN-boxed VM misbehave. What happened?**

The NaN produced by FP arithmetic may have a bit pattern that lands in your *boxing* tag space, so `is_double` reports "not a double" (it looks like a boxed pointer/immediate), and the VM dereferences garbage. The fix is to **canonicalize** every FP-produced NaN to a single reserved NaN pattern that doesn't collide with any boxing tag before storing it as a value.

## Question 36

**Python: `x = 257; y = 257; x is y` — guaranteed `False`?**

Not guaranteed *anything*. Outside the −5..256 cache, identity is implementation- and context-dependent: at the REPL each line is its own code object so `is` is often `False`, but inside a single function body the compiler may fold both `257` literals to one constant object, making `is` `True`. The lesson is that `is` for numbers is never a value comparison — use `==`. The "guaranteed False" answer is itself a trap.

## Question 37

**You replaced `Stream<Integer>` with `IntStream` and the program sped up and allocated less. Why?**

`Stream<Integer>` boxes every element into an `Integer` object — allocation, GC, and pointer chasing per element. `IntStream` operates on primitive `int`s with no boxing, so it allocates nothing per element and keeps data in registers/contiguous storage. For numeric pipelines the difference is large; the boxing in `Stream<Integer>` was invisible in the source but dominant in the profile.

---

## Design Scenarios

## Question 38

**You're designing the value representation for a new dynamic language. Walk me through the decision.**

Start from the **value distribution** of expected programs. If floats dominate (graphics, numeric scripting), NaN-box: doubles are native and everything else hides in the NaN payload. If small integers dominate (array-index-heavy, symbolic), use pointer tagging: inline small ints with a tag bit, accept reduced range. If pointers/symbols dominate, consider the offset-double ("nun-boxing") scheme so pointer/int access is mask-free. Then check **portability**: tagging needs only alignment (portable); NaN-boxing depends on ~48-bit pointers (fragile under LA57/PAC). Then co-design the **GC** (it must decode values to find pointers) and the **JIT** (tag checks become inline-cache and deopt guards). Finally, treat the layout as an **ABI** if you'll have embedders or snapshots.

## Question 39

**Your integer-heavy benchmark allocates millions of boxed integers. How do you fix it without changing the language?**

Move the hot data into unboxed contiguous storage: primitive arrays (`int[]`, C#'s `List<int>`/`Span<int>`, NumPy/`array.array` in Python), primitive-specialized collections (fastutil, Eclipse Collections on the JVM), and primitive streams (`IntStream`). Eliminate incidental boxing: avoid `Stream<Integer>`, `Map<Integer, …>` autoboxing in hot loops, and ternaries mixing `int`/`Integer`. Confirm with an allocation profiler that the boxes are gone and measure the cache-miss reduction.

## Question 40

**Your float-heavy NaN-boxing VM must run on a host with 5-level paging. What do you do?**

The risk is pointers above the 48-bit line that won't fit the NaN payload. Defenses: (1) constrain the allocator to low virtual addresses — `mmap` without high-address hints, optionally reserve the high region so it can't be handed out; (2) assert on every box that the pointer fits the payload, catching violations in CI; (3) detect LA57 at startup and, if the assumptions can't be guaranteed, fall back to a tagging or boxing representation kept building and tested; (4) if you must support high addresses, redesign to store pointers outside the NaN payload (split tag) or use pointer compression. Never ship a silent 48-bit mask on a host that can produce 49-bit pointers.

## Question 41

**You need to add ARM (Apple Silicon, arm64e with PAC) support to a NaN-boxing runtime. What changes?**

PAC writes a cryptographic signature into a pointer's high bits — exactly where NaN-boxing wants its tag and where it assumes filler. You cannot store a signed pointer in a NaN payload and later mask it as if the high bits were zero (you'd destroy both the address and the signature). The protocol: **strip** the authentication (`xpaci`) to get the bare address, box that, and **re-sign** (`pacia`/`autia`) before dereferencing. Alternatively, carve the tag from bits PAC doesn't use, coordinating with the signature width. Either way, the boxing boundary must explicitly mediate PAC; you must also test on real arm64e hardware, since your x86 dev box won't exercise it.

## Question 42

**Your team wants to "optimize" the immediate tag encoding in a shipping engine. What's your concern?**

The value layout is an **ABI**: embedders read raw values through the C API, the JIT emits machine code that hard-codes the tag masks, and heap snapshots serialize values with the encoding. Changing the tag numbering silently breaks all three — embedders misread `true`/`null`, cached JIT code uses stale masks, old snapshots decode as garbage. Any change must be **versioned and migrated**: bump a layout version, provide snapshot migration, recompile embedders and invalidate JIT code caches. The representation is a contract, not a free variable; "just retuning the bits" in a point release is how you corrupt every embedder in the field.

## Question 43

**When would you deliberately choose plain boxing over tagging or NaN-boxing?**

When **simplicity and portability** outweigh primitive performance: a reference interpreter, an early prototype, a teaching implementation, or a host environment where you can't guarantee alignment/address-width assumptions (opaque FFI pointers, exotic architectures). Boxing gives a trivial GC (every value is a pointer), trivial reasoning, and no decode logic on access. You accept the allocation/GC/cache tax because the engineering risk and complexity of inline encodings — and their platform fragility — aren't justified yet. You can tag small ints later as a targeted optimization once you know the value distribution.

## Question 44

**Design a value type that gets both fast integers and fast floats.**

Combine NaN-boxing with inline integer tagging: store real doubles natively (the `is_double` fast path), and for non-doubles use the quiet-NaN space with sub-tags — one for **inline 32-bit integers** (fast integer arithmetic, no allocation), others for `true`/`false`/`null` immediates, and one (sign + qNaN) for **48-bit pointers**. Now both integer-heavy and float-heavy code stay on inline fast paths; only large integers, non-inline numbers, and heap objects pay. The cost is two cheap tag checks instead of one, and careful canonicalization of genuine NaN so it doesn't alias the integer/pointer/immediate tags. This hybrid is close to what modern production engines actually do.

---

## Cheat Sheet

```text
+------------------------------------------------------------------+
| BOXING / TAGGING / NaN-BOXING — INTERVIEW MUST-KNOW              |
+------------------------------------------------------------------+
| THE PROBLEM: one word holds value OR pointer; know which w/o a   |
| separate type field.                                            |
|                                                                 |
| BOXING     wrap primitive on heap; slot = pointer               |
|            cost: alloc + GC + cache-miss (pointer chasing)      |
|            int[] >> ArrayList<Integer>                          |
| TAGGING    aligned ptr low bits free → tag small int inline     |
|            cost: lose 1+ bit of int range; untag per use        |
|            V8 SMI (low bit), OCaml 63-bit, Ruby Fixnum/immed.    |
| NaN-BOX    hide int/ptr/true/false/null in double's NaN payload |
|            every value is a double → native float math          |
|            48-bit ptr fits NaN payload (LuaJIT, SpiderMonkey)   |
+------------------------------------------------------------------+
| JAVA   Integer/Long cache −128..127 → == trap; null unbox → NPE |
| C#     struct→object boxes; List<int> does NOT (generics)       |
| PYTHON everything is an object; small-int cache −5..256 → `is`   |
| V8     SMI = low-bit tagged int; HeapNumber for the rest        |
| LUAJIT NaN-boxed TValue; doubles native                         |
| RUBY   Fixnum (n<<1)|1; nil/true/false/Symbol = immediates      |
| OCAML  (n<<1)|1 → 63-bit int; add = a+b-1                        |
+------------------------------------------------------------------+
| TRAPS                                                            |
|  * == on boxed numbers (use .equals / == value)                 |
|  * auto-unbox null → NPE                                         |
|  * ±Inf is a double (check the FRACTION, not just exponent)     |
|  * untag signed int with ARITHMETIC shift                       |
|  * tagged add needs -1; mul must untag first                    |
|  * NaN-box assumes 48-bit ptr → LA57/PAC break it (truncation)  |
+------------------------------------------------------------------+
```

---

## Further Reading

- *Effective Java* — Joshua Bloch, Item 61 (prefer primitives to boxed primitives).
- *Crafting Interpreters* — Robert Nystrom, the NaN-boxing chapter.
- *CLR via C#* — Jeffrey Richter, boxing/unboxing in .NET.
- *V8 blog* — SMI representation and "Pointer Compression in V8."
- *LuaJIT* — Mike Pall's `TValue` NaN-boxing notes.
- *Ruby Under a Microscope* — Pat Shaughnessy, the `VALUE` immediate encoding.
- *Real World OCaml* — tagged 63-bit ints and memory representation.
- *JavaScriptCore* — `EncodedJSValue` (offset-double / "nun-boxing") and "Speculation in JavaScriptCore."
- *IEEE 754* — the floating-point standard and the definition of NaN.

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`tasks.md`](tasks.md).
- Sibling topics: IEEE-754 floating-point representation and integer representation under `data-representation-and-numerics/`.
- Cross-cutting: garbage collection, interpreter/VM and JIT design, inline caches and hidden classes, and virtual memory/paging under `language-internals/`.
