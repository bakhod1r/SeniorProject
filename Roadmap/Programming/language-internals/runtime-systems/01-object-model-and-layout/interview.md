# Object Model & Layout — Interview Questions

> **Topic:** [Object Model & Layout](README.md)

---

## Introduction

These questions probe whether a candidate understands how an object is *physically arranged* in memory — the layer beneath every language's type system, where a field is a byte offset, alignment dictates padding, and a managed runtime taxes every object with a header. The goal is not trivia but to find out whether the candidate can reason from "the struct I declared" down to "the bytes the CPU and the allocator actually touch," and back up to "why this loop is cache-bound" or "why this JS function deoptimized."

A strong candidate speaks in offsets, alignment, cache lines, and headers; explains *why* reordering fields shrinks a struct without hand-waving; knows what's in a JVM mark word, a CPython `PyObject`, and a V8 hidden class; and connects layout to observable production metrics (footprint, GC pauses, cache misses, deopts). A weaker candidate knows that "objects have headers" and "structs have padding" as facts but can't derive a size, can't explain a hidden-class deopt, and treats layout as folklore. The questions run from foundational vocabulary through language-specific internals, then traps where the obvious answer is wrong, then design scenarios that reveal whether the candidate has actually engineered object models at scale.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [C / C++](#c--c)
  - [Java](#java)
  - [Python](#python)
  - [JavaScript / V8](#javascript--v8)
  - [Rust](#rust)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [System / Design Scenarios](#system--design-scenarios)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Conceptual / Foundational

## Question 1

**What does it mean, physically, to access `obj.field`?**

It means computing `base_address_of_obj + offset_of_field` and loading from there. The field name exists only in source; the compiler resolves it to a constant numeric offset known at compile time (for static languages) or recovered via a hidden class / shape (for dynamic languages). This is why field access is essentially free — a single addition folded into the addressing mode of a load instruction. The entire machinery of hidden classes exists to *preserve* this property in languages where it isn't naturally available: turning what would be a hash-map lookup back into a `base + constant_offset` load.

## Question 2

**Why is a struct often larger than the sum of its fields?**

Because of **alignment** and the **padding** it forces. A value of size/alignment N must be placed at an offset that is a multiple of N, so the compiler inserts filler bytes between fields to satisfy this, and trailing padding so the whole struct's size is a multiple of its own alignment (which equals the largest field alignment). `{char a; int b; char c;}` is 12 bytes, not 6: 3 padding bytes after `a` to align `b`, and 3 trailing bytes to round the struct to a multiple of 4. Alignment exists because CPUs load memory most efficiently (and on some architectures only correctly) when values sit at addresses that are multiples of their size.

## Question 3

**Why does reordering struct fields sometimes shrink the struct?**

Because padding is a function of field *order*. Declaring fields from largest alignment to smallest lets each field land on a naturally aligned offset without gaps. `{char, int, char}` (12 bytes) becomes `{int, char, char}` (8 bytes) — same data, the inter-field padding collapses because the `int` is already aligned at offset 0 and the two `char`s pack together after it. The rule of thumb is "biggest alignment first": pointers and 8-byte values, then 4-byte, then 2-byte, then bytes.

## Question 4

**What is an object header and what does it cost?**

A header is runtime-owned bytes prepended to an object before its declared fields, holding metadata the runtime needs: a type/class pointer, possibly a reference count, lock state, GC bits, or a vtable pointer. C, Go, and Rust *values* have no per-object header. The JVM has ~12–16 bytes (mark word + class pointer). CPython has 16 bytes (refcount + type pointer) before any payload. C++ adds an 8-byte vtable pointer the moment a class has a virtual method. The cost is per object: trivial for a few objects, dominant when you have millions of small ones — 16 bytes times a billion objects is 16 GB of pure overhead.

## Question 5

**What is the difference between an inline (unboxed) and a boxed field?**

An inline field stores its value directly in the container's bytes — `struct Point { int x; }` holds `x` in the Point. A boxed field stores a *pointer* to a separate heap object that holds the value, and that object carries its own header. `int[]` in Java is a tight block of inline integers; `Integer[]` is an array of pointers to separate heap objects, each a ~16-byte box around a 4-byte int. Boxing costs an extra pointer, an extra header per value, and an extra dependent load (pointer chase) on access — and it destroys cache locality in bulk.

## Question 6

**Explain AoS vs SoA and when each wins.**

Array of Structs stores each record's fields together: `[{x,y,z}, {x,y,z}, ...]`. Struct of Arrays stores each field in its own array: `{x:[...], y:[...], z:[...]}`. AoS wins when you touch whole records (all fields of one object together) — everything for that object is on the same cache line. SoA wins when a loop touches one field across many records: the field's array is contiguous, so each fetched cache line is ~100% useful data, the access is a clean linear stream the prefetcher and vectorizer love, and you avoid dragging in fields you don't need. The choice is driven by the dominant access pattern, not by aesthetics.

## Question 7

**What is a cache line and why does it matter for layout?**

A cache line is the unit of memory the CPU moves between RAM and cache, typically 64 bytes — you never fetch one byte, you fetch the whole line. Layout determines how much of each fetched line is data you actually use. A tight, well-ordered struct packs more useful objects per line; a padded, header-heavy, or AoS-when-you-want-SoA layout wastes most of every line on bytes you didn't want. The metric to optimize is "useful bytes per cache line," and it directly sets the memory-bandwidth cost of any hot loop.

## Question 8

**What is a vtable and where does the pointer live?**

A vtable is a per-class array of function pointers, one slot per virtual method in a fixed order, with derived-class overrides replacing base entries. An object of a class with virtual methods carries a hidden **vtable pointer (vptr)**, conventionally at offset 0. A virtual call loads the vptr, indexes the vtable at the method's fixed slot, and calls through that pointer — two dependent loads plus an indirect call. The vptr is a per-object header cost; the vtable itself is shared per class.

## Question 9

**What is a hidden class (shape/map), and what problem does it solve?**

In a dynamic language, `obj.x` can't be a fixed compile-time offset — objects have no static type and properties can be added at runtime. The naive implementation is a per-object hash map, an order of magnitude slower than a `+offset` load. A hidden class (V8 "Map", SpiderMonkey "Shape", JSC "Structure") is a runtime descriptor shared by all objects of the same shape that records each property's fixed offset. Objects with the same properties added in the same order share one hidden class, so access becomes "check the shape, then load the fixed slot" — nearly as fast as a static struct. An inline cache at each access site remembers the (shape → offset) mapping.

## Question 10

**Why does field-access become a "dictionary lookup" sometimes, and why is that bad?**

If an object doesn't have a stable hidden class — because properties were added inconsistently, deleted, or the object was forced into "dictionary mode" — the engine stores properties in an actual hash map keyed by name. Every access is then a string hash and a bucket probe instead of a fixed-offset load: roughly an order of magnitude slower, and it disables the inline-cache and JIT optimizations that depend on a known offset. The whole point of hidden classes is to avoid this; layout discipline (stable shapes) is how you stay on the fast path.

## Question 11

**What is the difference between tagged and boxed representation?**

A boxed value lives as a separate heap object reached through a pointer, with a header. A tagged value encodes the value *and* a small type tag inside a single machine word — for example, stealing the low bits of a pointer (pointer tagging) or hiding a payload in the unused bits of a NaN double (NaN-boxing), or V8's "Smi," a small integer stored inline in the pointer slot with no heap object at all. Tagging removes the header and the pointer chase for small values, at the cost of a limited value range and encode/decode logic. Whether a field is tagged-inline or boxed changes the object's footprint and the cache behavior of every loop over it.

## Question 12

**Why does declaring fields cost memory even before you store data, in some runtimes?**

Because the runtime allocates header bytes and applies alignment rounding regardless of field contents. A Java object with a single `int` is 16 bytes, not 4: 8-byte mark word + 4-byte compressed class pointer + 4-byte int, with the whole thing rounded to an 8-byte boundary. A CPython object is 16 bytes of header before any payload. The "tax" is structural — it's the price of garbage collection, identity, locking, reflection, and dynamic typing — and it's paid per object whether or not the fields hold anything interesting.

---

## Language-Specific

### C / C++

## Question 13

**Compute `sizeof(struct { char a; double b; int c; })` on a 64-bit system and show the padding.**

`a` at offset 0 (1 byte). `b` needs 8-byte alignment, so 7 padding bytes, `b` at offset 8 (8 bytes). `c` at offset 16 (4 bytes). The struct's alignment is 8 (largest field), so the size rounds up from 20 to 24: 4 trailing padding bytes. Total **24 bytes**, of which only 13 are data. Reordered as `{double b; int c; char a;}` it's 8 + 4 + 1 = 13, rounded to 16 — an 8-byte saving from ordering alone.

## Question 14

**What does `#pragma pack(1)` do, and what's the risk?**

It forces zero padding — fields are packed at consecutive byte offsets regardless of alignment. The struct shrinks to the exact sum of its fields, which is essential for matching a wire/file format byte-for-byte. The risk is **misalignment**: a multi-byte field can now start at an unaligned address. On x86 that's a (sometimes significant) slowdown; on some ARM/embedded and SIMD paths it's a fault or undefined behavior. Use packing only for boundary/wire structs, never for in-memory hot data.

## Question 15

**Where is the vptr placed, and how much does a virtual method add to `sizeof`?**

In the common single-inheritance case the vptr is at offset 0, ahead of the class's own members. Adding the *first* virtual method to a class adds one pointer (8 bytes on a 64-bit system) plus any padding to realign the following members. A class with two `double`s (16 bytes) jumps to 24 once it gains a virtual method: 8-byte vptr + 16 bytes of doubles. Subsequent virtual methods add nothing to object size — they only add slots to the shared per-class vtable.

## Question 16

**How does multiple inheritance change object layout?**

An object that derives from two polymorphic bases contains *two* base subobjects, each with its own vptr — so the object has multiple vptrs, not one. The subobjects are laid out in sequence, and a pointer to the second base points into the *middle* of the object, not its start. Calling a method inherited from the second base requires a **`this`-pointer adjustment** (a fixed offset or a thunk in the vtable) so `this` points at the correct subobject. A consequence: `static_cast` between base subobjects can change the pointer value — object identity is not preserved across the cast.

### Java

## Question 17

**Describe the layout of a Java object on a 64-bit HotSpot JVM.**

It begins with a **mark word** (8 bytes) holding the identity hash, lock state, and GC age bits — overloaded to mean different things depending on lock/GC state — followed by a **class pointer** (4 bytes when compressed class pointers are on, the default), then the instance fields (which the JVM may reorder for packing), with the whole object padded to an 8-byte boundary. The minimum object size is therefore 16 bytes. Arrays add a 4-byte length field after the class pointer.

## Question 18

**What is in the mark word, and why can `identityHashCode()` interact with locking?**

The mark word packs the identity hash code (once computed), GC age bits, and lock-state bits into one 64-bit slot, with the low bits tagging the current state. Because hash and lock metadata share these bits, they compete: when an object is thin-locked, the original mark word (possibly holding the hash) is *displaced* into a lock record on the thread's stack. On JDKs with biased locking, requesting the identity hash of a biased object forced **bias revocation**, because there was nowhere to store the hash while biased. So a seemingly innocent `hashCode()` could trigger a locking-related operation.

## Question 19

**Explain compressed oops and the ~32 GB cliff.**

Compressed oops store 64-bit references as 32-bit values by treating them as object indices: `real = heap_base + (narrow << 3)`. The 3-bit shift exploits 8-byte object alignment, letting a 32-bit index address `2^32 × 8 = 32 GB` of heap. Below that, every reference field and the class pointer are 4 bytes. Cross ~32 GB and the JVM disables compressed oops, so **every reference becomes 8 bytes** — which means a 33 GB heap can hold *less* live data than a 31 GB one. The fix is to size deliberately around the cliff, or raise `ObjectAlignmentInBytes` to push it to 64 GB at the cost of more padding.

## Question 20

**Why is a `HashMap<Long, Long>` so memory-heavy per entry?**

Each entry is a `Node` object (~32 bytes: header + cached hash + key reference + value reference + next reference), plus a boxed `Long` key (~16 bytes) and a boxed `Long` value (~16 bytes). That's roughly 64 bytes of object overhead to store 16 bytes of actual `long` data — about a 4x tax — before counting the backing array and load-factor slack. For dense integer-keyed data, a primitive-specialized open-addressing map (`long[]`-backed, e.g. fastutil/Eclipse Collections) cuts this severalfold by eliminating both the boxing and the per-node objects.

### Python

## Question 21

**Describe the layout of a CPython object and why a small `int` is ~28 bytes.**

Every CPython object begins with `PyObject`: an 8-byte reference count (`ob_refcnt`) and an 8-byte type pointer (`ob_type`) — 16 bytes of header before any payload. A Python `int` is a `PyLongObject`, which adds a size/sign field and the magnitude digits, landing a small int around 28 bytes. There is no unboxed int in pure Python, so a list of a million ints is a million pointers to a million ~28-byte objects. NumPy escapes this by storing a raw C array with a single header for the whole array.

## Question 22

**What does `__slots__` do to an object's layout?**

By default a CPython instance stores its attributes in a per-instance `__dict__` (a hash map), so every attribute access is a dictionary lookup and every instance carries the dict's overhead. Declaring `__slots__` tells CPython to lay the named attributes out as **fixed offsets** in the object, removing the per-instance `__dict__` entirely. It's CPython's manual version of the hidden-class idea: you trade the ability to add arbitrary attributes for compact, fixed-offset layout. For classes instantiated in large numbers, `__slots__` typically cuts per-instance memory 30–50% and speeds attribute access.

## Question 23

**Why does reference counting in the header have a performance cost beyond memory?**

Because `ob_refcnt` is *written* on every reference creation and destruction — assignments, function calls passing objects, list insertions, scope exits. These are memory writes on operations that look free, they dirty cache lines (hurting locality and sharing), and in a multithreaded interpreter they must be serialized, which is a core reason the GIL exists and why free-threaded CPython is hard. The header isn't just storage; it's a hot, frequently-mutated field.

### JavaScript / V8

## Question 24

**Why does adding properties to objects in inconsistent orders hurt performance?**

Because an object's hidden class is defined by *which properties were added in which order*. Adding `x` then `y` yields shape `{x@0, y@1}`; adding `y` then `x` yields a *different* shape `{y@0, x@1}` with different offsets. A property-access site that sees both shapes becomes **polymorphic**, and if it sees many shapes it goes **megamorphic** — falling back to a generic hashed lookup and possibly causing the optimizing JIT to bail out of the whole function. The fix is free: initialize all properties in the same order, ideally in a constructor, so every instance shares one shape and hot sites stay monomorphic.

## Question 25

**What's the difference between monomorphic, polymorphic, and megamorphic access sites?**

It's a classification of how many hidden classes a given property-access site has observed. **Monomorphic** (one shape) is the fast path: a single shape check plus a fixed-offset load, cacheable in an inline cache. **Polymorphic** (a handful of shapes) keeps a short list of (shape → offset) mappings — still fast, slightly slower. **Megamorphic** (many shapes) abandons specialization for a generic lookup and disables key JIT optimizations. Keeping hot sites monomorphic, which is almost entirely a question of object-shape discipline, is one of the highest-leverage JS performance practices.

## Question 26

**What is a Smi, and how does it avoid a heap object?**

A Smi ("small integer") is V8's tagged representation of a 31-bit integer stored *inline* in the slot that would otherwise hold a pointer, distinguished from a real pointer by a tag bit. Because the value lives in the pointer-sized slot itself, a Smi needs no heap allocation, no header, and no pointer chase — it's the dynamic-language equivalent of an unboxed int. Numbers outside the Smi range (or non-integers) are stored as boxed `HeapNumber` doubles. This is why integer-heavy JS that stays within Smi range is dramatically leaner and faster than code that forces boxing.

### Rust

## Question 27

**How does Rust's default struct layout differ from C's, and what does `repr(C)` do?**

By default (`repr(Rust)`), the compiler is *free to reorder a struct's fields* to minimize padding, so you often get optimal packing automatically. `#[repr(C)]` disables reordering and forces C-compatible field order and padding — required when the struct crosses an FFI/ABI boundary or must match a fixed layout. `#[repr(packed)]` additionally removes padding (with the usual misalignment caveats), and `#[repr(transparent)]` guarantees a single-field wrapper has the same layout as its field. Plain Rust structs, like C structs, carry no per-object header.

## Question 28

**What is niche optimization and how does it make `Option<&T>` free?**

A niche is an invalid bit pattern a type can't otherwise hold. A reference `&T` can never be null, so the all-zero pattern is a niche. The compiler uses that niche to represent `Option`'s `None`, so `Option<&T>` is the *same size* as `&T` — no extra discriminant byte, no padding. This is layout-level tagged representation done for free by the compiler, and it generalizes to other types with spare bit patterns (`NonZero*`, enums with unused variants). It's why idiomatic Rust nullable references cost nothing over raw pointers.

---

## Tricky / Trap Questions

## Question 29

**"My struct has fields summing to 13 bytes, so `sizeof` is 13." True?**

Almost never. Alignment forces inter-field padding and trailing padding to round the struct to its own alignment, so the true size is usually larger and depends on field *order*. The only way to know is to compute the alignment-driven layout or ask the tool (`sizeof`, `unsafe.Sizeof`, `size_of`). Treating size as the sum of field sizes is the single most common layout mistake.

## Question 30

**"`Integer[]` and `int[]` use about the same memory in Java." True?**

No — they can differ by ~5x. `int[]` is a single contiguous block of 4-byte values with one header for the whole array. `Integer[]` is an array of 8-byte references *plus* a separate boxed `Integer` object per element, each with a ~16-byte header around a 4-byte value, scattered across the heap. The boxed version costs far more memory and is much worse for cache locality (every element is a pointer chase). For bulk numeric data, primitive arrays are the correct choice.

## Question 31

**"Increasing the JVM heap from 31 GB to 34 GB always lets me hold more data." True?**

No, and this trips up experienced engineers. Crossing ~32 GB disables compressed oops, doubling every reference field and the class pointer from 4 to 8 bytes. The per-object overhead increase can outweigh the extra raw heap, so a 34 GB heap may hold *less* live data than a 31 GB one. Either stay comfortably under the cliff or go large enough that the added size dominates the lost compression; check `UseCompressedOops` rather than assuming.

## Question 32

**"Setting `obj.x = undefined` and `delete obj.x` are equivalent in JS." True?**

No. Assigning `undefined` keeps the property (and the object's hidden class) intact — fast path preserved. `delete obj.x` removes the property, which in most engines transitions the object into dictionary (slow) mode, abandoning the hidden class and turning subsequent property access into hash lookups. If you need the fast path, set the field to `null`/`undefined` rather than deleting it.

## Question 33

**"My per-core counter array should scale linearly with cores, but it gets slower. Why?**

False sharing. If the counters are packed in an array, several of them share a 64-byte cache line. Each core writing *its own* counter still needs exclusive ownership of the whole line, so the line ping-pongs between cores on every increment, serializing writes that should be independent. The fix is to pad each counter to its own cache line (and often to 128 bytes, to defeat the adjacent-line prefetcher) or to use per-thread/per-CPU isolation. Confirm with `perf c2c`.

## Question 34

**"Adding `volatile` to a Java field that I just want padded will create the padding." Reliable?**

The padding trap is subtler: a plain "padding" field with no reads or writes can be optimized away by the JIT, so naive manual padding may not survive. The reliable mechanism is `@Contended` (with `-XX:-RestrictContended` for user classes), which the JVM honors specifically to isolate a field onto its own cache line. Hand-rolled padding fields must be genuinely used (or use the annotation) or they won't protect against false sharing.

## Question 35

**"A C struct is a safe wire format — I'll just send the bytes." Safe?**

Risky on two counts. First, **endianness**: a multi-byte field's byte order differs between architectures, so an x86 writer and an ARM reader will scramble values unless you fix endianness explicitly. Second, **padding and layout are not guaranteed across compilers/versions** unless you pin them (`#pragma pack`, `repr(C)`, explicit fields), and raw structs have *no* schema-evolution story — adding a field breaks every existing reader. Wire formats need defined endianness, pinned layout, and a versioning strategy.

## Question 36

**"`sizeof(myList)` tells me how much memory the list uses." True?**

No. `sizeof` / `getsizeof` reports the object's *own* bytes — for a list, the header and the backing pointer array — but **not** the objects it references. The elements are separate heap objects with their own sizes (and headers), not included in the container's reported size. Computing true footprint requires walking the object graph (deep sizing), not reading one `sizeof`.

## Question 37

**"Two threads can never read different values from the same field at the same instant." True?**

Not in general. On weakly ordered hardware or with relaxed atomics, one core can have a newer value that hasn't yet propagated to another core's cache, so two threads can observe different values for the same address momentarily. This is a memory-model/coherence matter rather than pure layout, but it's relevant because the *placement* of a field (which cache line, false sharing) interacts with how and when writes become visible. The layout point: hot, concurrently-accessed fields deserve deliberate cache-line placement.

---

## System / Design Scenarios

## Question 38

**Design the in-memory layout for 10 billion graph edges, each (srcId: u64, dstId: u64, weight: f32).**

Naively, 10 billion edge *objects* in a managed runtime would add ~16 bytes of header each — 160 GB of pure overhead — plus padding (the f32 after two u64s pads to 24 bytes, wasting 4). The right answer abandons per-edge objects: store edges columnar (SoA) as three parallel arrays — `u64 src[]`, `u64 dst[]`, `f32 weight[]` — or off-heap as a packed flat array, removing all per-object headers and giving one header for the whole structure. Columnar additionally lets a weight-only or src-only scan stream contiguous memory and vectorize. For 24→20 byte savings, note the f32 packs better in its own column than interleaved. Footprint drops from ~240+ GB to ~200 GB and cache behavior improves dramatically; partition by NUMA node if multi-socket.

## Question 39

**A JS hot path keeps deoptimizing. How do you diagnose and fix it?**

Run under `--trace-deopt` and `--trace-ic` to find which site deopts and what shapes it sees. The usual root cause is shape pollution: objects of one logical type constructed via different property-add orders, properties added conditionally or after construction, `delete` forcing dictionary mode, or a field whose type changes (sometimes int, sometimes string). The fix is shape discipline — use a `class` or always-same object literal, set every field up front in a fixed order with stable types, never `delete`, use `null` as a placeholder. Then confirm the site returns to monomorphic and the function stays optimized; encode a deopt-free check in the perf suite so it doesn't regress.

## Question 40

**You need to cut GC pause time in a service holding a large, long-lived cache. What layout moves do you consider?**

GC cost scales with object count and reference graph size, so reduce both. Options, in rough order: replace boxed entries with primitive-specialized structures to cut allocation and object count; flatten nested objects to remove indirection and headers; and, if the cache is large and simply-typed, move it **off-heap** (Foreign Memory / `mmap` / native) so its contents aren't GC-traced at all — one flat region, no per-entry header, manual lifetime via an arena. Validate each change with GC logs and allocation profiles, and accept the off-heap trade: no type safety and manual lifetime management in exchange for pauses that no longer scale with cache size.

## Question 41

**Design a record format that is both fast in memory and stable on the wire.**

Use *two* layouts joined by a conversion. The **interior** layout is tuned for the CPU and GC: fields reordered largest-alignment-first, sub-objects flattened, possibly SoA for scan-heavy fields. The **boundary** layout is tuned for stability: packed, endianness fixed (e.g. little-endian) and converted on read/write, with a versioned schema so fields can evolve (Protobuf field numbers, FlatBuffers vtables, or explicit version + reserved space). Pin the wire layout with size/offset assertions in CI, define the endianness contract explicitly, and never let the wire format dictate the hot-path struct or vice versa. The conversion at the edge is the only place the two layouts meet.

## Question 42

**A 96-byte object is iterated in a hot loop that only reads two 4-byte fields. Improve the layout.**

This is a hot/cold split. Currently each fetched 64-byte line carries mostly cold bytes, so the loop is memory-bound on data it ignores. Cluster the two hot fields together (ideally at the front, on one line) and exile the cold fields behind a pointer or into a parallel sidecar indexed the same way — or go fully SoA, keeping a dense array of just the two hot fields. After the change, a cache line holds many hot-field pairs instead of one mostly-cold object, raising useful-bytes-per-line and letting the prefetcher and vectorizer engage. Measure cache-miss rate before and after to confirm.

## Question 43

**When would you keep a vtable-based polymorphic design despite its dispatch cost, and when would you convert it to a closed set?**

Keep the vtable when the hierarchy is genuinely **open and extensible** — plugins, user-provided types, an API where new subtypes arrive without recompiling — and when dispatch isn't on a measured hot path. Convert to a **closed set** (`std::variant` + visit, sealed types, an enum + switch) when the set of types is fixed and known, *and* dispatch is hot: a closed set lets the compiler devirtualize and inline each arm, removing the indirect call and its branch mispredicts. The decision is driven by extensibility requirements and a measured hot path, not by a blanket preference.

## Question 44

**Design a per-CPU metrics counter that scales on a 64-core box.**

A single shared atomic counter caps throughput because every increment requires exclusive ownership of one cache line — coherence traffic dominates. Allocate one counter per CPU (or per NUMA node), each **padded to its own cache line** (128 bytes to beat adjacent-line prefetch) so writers never false-share. Each writer increments its local counter; a reader periodically sums all per-CPU counters into a global value (reads become O(cores), which is fine when writes vastly dominate). Allocate each per-CPU counter on its own NUMA node (first-touch from the owning thread). This is the design Linux per-CPU counters and DPDK per-LCORE counters use, and it converts a coherence bottleneck into embarrassingly parallel local writes.

---

## Cheat Sheet

```text
+--------------------------------------------------------------+
| OBJECT MODEL & LAYOUT — MUST-KNOW                            |
+--------------------------------------------------------------+
| 1. field access = base + constant offset (free at runtime)   |
|    hidden classes exist to keep it that way in dynamic langs |
|                                                              |
| 2. struct size != sum of fields; alignment -> padding        |
|    reorder largest-alignment-first to shrink                 |
|                                                              |
| 3. headers: C/Go/Rust value = none; C++ virtual = +vptr(8);  |
|    JVM = mark word(8)+klass(4) -> min 16; CPython = 16+      |
|                                                              |
| 4. inline (int[]) vs boxed (Integer[]) ~ 5x memory + cache   |
|                                                              |
| 5. AoS = whole-record access; SoA = one-field-over-many scan |
|    optimize useful bytes per 64B cache line                  |
|                                                              |
| 6. JVM mark word: hash | lock | GC age (overloaded bits)     |
|    compressed oops: real = base + (narrow<<3); 32 GB cliff   |
|                                                              |
| 7. hidden class = props + ADD ORDER; differ -> polymorphic   |
|    mono(1) > poly(2-4) > megamorphic (hash lookup, deopt)    |
|    delete prop / inconsistent ctor -> dictionary/slow mode   |
|                                                              |
| 8. tagged (Smi/NaN-box) vs boxed: tag = no header, no hop    |
|                                                              |
| 9. false sharing: hot fields on one line -> pad to 128B      |
|    hot/cold split: cluster hot fields, exile cold            |
|                                                              |
| 10. wire layout: pin (repr(C)/pack), fix endianness, version |
|     keep interior (CPU) and boundary (wire) layouts separate |
+--------------------------------------------------------------+
```

---

## Further Reading

- "Computer Systems: A Programmer's Perspective" — Bryant & O'Hallaron; data representation and memory layout.
- "The Lost Art of Structure Packing" — Eric S. Raymond; field ordering and padding in C.
- OpenJDK JOL (Java Object Layout) samples — the authoritative way to see JVM object layout, mark words, and compressed oops.
- "CPython Internals" — Anthony Shaw; and `Include/object.h` for `PyObject`.
- V8 blog: "Fast properties in V8" and the hidden-class/inline-cache articles.
- "The Itanium C++ ABI" — vtable layout, vptr placement, and `this`-adjustment thunks.
- "What Every Programmer Should Know About Memory" — Ulrich Drepper; caches, alignment, false sharing.
- "Data-Oriented Design" — Richard Fabian; the case for SoA and layout-led design.
- JEP 374 (biased locking removal) and Project Valhalla / Project Lilliput design notes.
- The Rust Reference, "Type layout" chapter; `repr(C)`, `repr(packed)`, niche optimization.

---

## Related Topics

- The next runtime topic, **method dispatch**, builds on the vtable and inline-cache material here — how a virtual or dynamic call actually resolves and how JITs devirtualize it.
- **Data representation** owns tagged-vs-boxed, NaN-boxing, and pointer tagging — the field-level decisions that drive footprint.
- **Garbage collection** is coupled to the object header (mark word, GC bits) and to allocation rate and object count, which layout controls.
- **Cache architecture, coherence, and NUMA** explain why alignment, padding, AoS/SoA, false sharing, and hot/cold splitting produce measurable effects.
- **Serialization and wire formats** are the boundary-layout discipline — pinned layout, endianness, and schema evolution.
