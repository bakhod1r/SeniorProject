# Object Model & Layout — Tasks & Exercises

> **Topic:** [Object Model & Layout](README.md)
> **Focus:** Hands-on exercises that make layout *observable* — measure sizes and offsets, reorder fields, watch headers and hidden classes, and reproduce false sharing and deopts on your own machine.

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Warm-Up (Junior)](#warm-up-junior)
3. [Core Exercises (Middle)](#core-exercises-middle)
4. [Advanced Exercises (Senior)](#advanced-exercises-senior)
5. [Production Exercises (Professional)](#production-exercises-professional)
6. [Capstone Projects](#capstone-projects)
7. [Self-Check Checklist](#self-check-checklist)
8. [Hints](#hints)
9. [Sparse Solutions](#sparse-solutions)

---

## How to Use This Page

Each exercise has a **goal**, a **self-check box** you tick when you've genuinely verified the result (not just "it compiled"), and a difficulty tier. Do the work *with a tool that shows you the bytes* — `sizeof`/`offsetof` in C, `unsafe.Sizeof`/`Offsetof` in Go, `std::mem::size_of`/`offset_of!` in Rust, JOL in Java, `sys.getsizeof` in Python, `--allow-natives-syntax`/`--trace-deopt` in Node. Layout is a topic you must *measure*, not reason about abstractly, or you'll be confidently wrong.

Hints are in a later section so you can struggle first. Solutions are deliberately **sparse** — enough to confirm you're right or unstick you, not enough to copy. The point is the muscle memory of "I changed the layout, here's the number that moved."

> Rule of the page: **never guess a size. Print it.**

---

## Warm-Up (Junior)

### Exercise 1 — Predict then print

- [ ] For `struct { char a; int b; char c; }`, predict `sizeof` and each field offset by hand, then verify with your language's tools.

**Goal:** Internalize that size ≠ sum of fields, and that the compiler tells you the truth.

### Exercise 2 — Shrink a struct by reordering

- [ ] Take a struct of `{char, double, int, char, short}`, compute its size, then reorder the fields to minimize padding and compute the new size. Verify both.

**Goal:** See the "biggest alignment first" rule produce a smaller object.

### Exercise 3 — The header surprise

- [ ] In Python, print `sys.getsizeof(0)`, `sys.getsizeof(2**70)`, `sys.getsizeof("")`, and `sys.getsizeof("hi")`. Explain why none of them is the "obvious" small number.

**Goal:** Discover the per-object header tax empirically.

### Exercise 4 — Inline vs boxed memory

- [ ] In Java (or C# / a language with both), fill `int[1_000_000]` and `Integer[1_000_000]` with the same values. Estimate (or measure with a profiler) the memory of each and explain the ratio.

**Goal:** Feel the cost of boxing in bulk.

### Exercise 5 — Offset arithmetic by hand

- [ ] Given a struct laid out as `[a@0 (1B)] [pad] [b@4 (4B)] [c@8 (2B)]`, write the byte offset of each field and the total size. Confirm against the tool.

**Goal:** Practice the `base + offset` mental model with real padding.

---

## Core Exercises (Middle)

### Exercise 6 — Inspect a JVM object header

- [ ] Use OpenJDK JOL to print the layout of a class with one `int` field. Identify the mark word, the class pointer, the field, and any padding. Confirm the minimum object size.

**Goal:** Make the JVM header concrete instead of folklore.

### Exercise 7 — `__slots__` memory win

- [ ] Create a Python class with two attributes, with and without `__slots__`. Create 1,000,000 instances of each and compare process memory (RSS). Confirm the `__slots__` version lacks a `__dict__`.

**Goal:** Quantify the per-instance dict overhead and the slots fix.

### Exercise 8 — Monomorphic vs polymorphic in V8

- [ ] Write a function that reads `obj.x` from objects constructed in two different property orders. Run under Node with `--trace-ic` (or `%HasFastProperties` via `--allow-natives-syntax`) and observe the access site go polymorphic. Then fix construction to a single shape and confirm it's monomorphic.

**Goal:** Witness a shape transition turning a fast site slow.

### Exercise 9 — AoS vs SoA timing

- [ ] Store 10,000,000 particles as AoS (`struct {x,y,z,vx,vy,vz}[]`) and as SoA (parallel arrays). Time a loop that reads only `x` for all particles in each layout. Explain the difference with cache lines.

**Goal:** Measure the cache cost of touching one field across many records.

### Exercise 10 — The vtable tax

- [ ] In C++, print `sizeof` of a class before and after adding a single `virtual` method. Account for every byte of the increase.

**Goal:** See the vptr appear and the dispatch cost made visible.

### Exercise 11 — Go field-alignment lint

- [ ] Write a Go struct with poorly ordered fields, run `go vet` with the `fieldalignment` analyzer (or `unsafe.Sizeof`), then apply the suggested ordering and confirm the size drop.

**Goal:** Use tooling to catch wasteful layout.

### Exercise 12 — Boxed-map overhead

- [ ] Estimate the per-entry memory of `HashMap<Long, Long>` at 10,000,000 entries by accounting for Node + boxed key + boxed value. Then look up a primitive-specialized map and estimate its per-entry cost. Compare.

**Goal:** Connect layout knowledge to a real data-structure choice.

---

## Advanced Exercises (Senior)

### Exercise 13 — Reproduce the compressed-oops cliff

- [ ] Write a program that allocates reference-heavy objects until OOM at `-Xmx31g` and at `-Xmx34g`. Compare how much live data fit in each, and check `UseCompressedOops` in both. Explain the paradox.

**Goal:** Prove that a bigger heap can hold less.

### Exercise 14 — Watch the mark word change

- [ ] Using JOL, print an object's header (a) fresh, (b) after calling `hashCode()`, and (c) inside a `synchronized` block on it. Identify what each state stores and where the hash goes when locked.

**Goal:** See the mark word as a state machine, not a fixed field.

### Exercise 15 — Reproduce false sharing

- [ ] Create an array of counters with no padding and have N threads each hammer one counter; measure throughput vs thread count. Then pad each counter to 128 bytes and re-measure. Confirm the padded version scales and (if on Linux) capture `perf c2c` for the unpadded one.

**Goal:** Turn "false sharing" from a phrase into a reproduced benchmark.

### Exercise 16 — Hot/cold split

- [ ] Define a ~96-byte object whose hot loop reads only two small fields. Measure the loop's cache-miss rate (`perf stat -e cache-misses`). Split hot fields into a dense array, re-measure, and quantify the improvement.

**Goal:** Apply field-level cache engineering and measure it.

### Exercise 17 — Force a deopt loop and fix it

- [ ] Write a Node function that you can flip between monomorphic and megamorphic by varying object shapes per call. Run with `--trace-deopt` and observe the compile/deopt cycle. Fix the shapes and confirm the deopts stop.

**Goal:** Understand deopt as a mechanism, including the pathological loop.

### Exercise 18 — Multiple-inheritance vptr layout

- [ ] In C++, define `struct C : A, B` where both `A` and `B` have virtual methods. Print `sizeof(C)`, and print the pointer values of `(A*)pc`, `(B*)pc`, and `pc`. Explain why one differs.

**Goal:** Observe multiple vptrs and `this`-adjustment in real pointer values.

### Exercise 19 — Niche optimization in Rust

- [ ] Confirm `size_of::<Option<&u8>>() == size_of::<&u8>()` and `size_of::<Option<Box<u8>>>() == size_of::<Box<u8>>()`. Then show a type where `Option<T>` is *bigger* than `T` and explain why no niche was available.

**Goal:** Understand when tagged representation is free and when it costs a discriminant.

---

## Production Exercises (Professional)

### Exercise 20 — Footprint budget for 1 billion records

- [ ] For a record `{id: u64, a: u32, b: u32, flag: u8}`, compute the on-heap (managed, with header + padding), off-heap (flat), and columnar footprints at N = 1,000,000,000. Tabulate and identify the dominant overhead in each.

**Goal:** Practice the "multiply by N" architecture decision with numbers.

### Exercise 21 — Off-heap record store

- [ ] Implement a store for 100,000,000 fixed-size records off-heap (Java Foreign Memory API, or `mmap` in C/Rust/Go). Benchmark its footprint and (in Java) GC-pause impact against an on-heap object version.

**Goal:** Build the GC-dodging layout and measure the win and the new burdens.

### Exercise 22 — Pin an ABI struct in CI

- [ ] Define a wire struct with `repr(C)` / `#pragma pack`, add compile-time or test assertions on its `sizeof` and each field offset, then add a field "by accident" and confirm the build fails.

**Goal:** Encode layout as a tested contract.

### Exercise 23 — Interior vs boundary codec

- [ ] Build a type with a CPU-optimized in-memory layout and a separate packed, little-endian, versioned wire layout, plus `to_wire`/`from_wire`. Write a round-trip test and a schema-evolution test (read an old version with a new reader).

**Goal:** Separate the two layouts and own the conversion.

### Exercise 24 — Columnar scan engine

- [ ] Load a dataset (e.g. 100M rows of 4 columns) both row-wise and columnar. Benchmark "sum of one column" in each. Add per-column dictionary or bit-packing compression to the columnar version and re-measure.

**Goal:** Demonstrate why analytical engines are columnar.

### Exercise 25 — Allocation-rate gate

- [ ] Write a hot path with a hidden autoboxing allocation (e.g. a `Stream<Integer>` or `Optional` in a loop). Add an allocation-rate assertion (via JFR/async-profiler) that fails when bytes-per-op exceeds a budget. Fix the boxing and watch the gate pass.

**Goal:** Catch a layout/boxing regression in CI rather than in production.

---

## Capstone Projects

### Capstone A — Struct layout visualizer

- [ ] Build a tool that, given a struct/class definition, prints each field's offset, the padding bytes, the total size, the alignment, and a reordered version with its smaller size and the bytes saved. Support at least two languages' rules.

**Goal:** Make layout legible to other engineers; teach the "biggest first" rule by tool.

### Capstone B — Deopt detector for a real codebase

- [ ] Take a non-trivial Node/TS service, run a representative workload under `--trace-deopt --trace-ic`, parse the output, and produce a report of the hottest deoptimizing functions with the likely shape-forking construction path for each. Fix one and show the before/after.

**Goal:** Apply shape discipline to real, messy code and prove the improvement.

### Capstone C — Footprint & GC report for an object model

- [ ] For a chosen domain model (say, a graph or a market-data feed), produce a report comparing on-heap, off-heap, and columnar representations on footprint, allocation rate, GC pause, and one representative scan/lookup. Recommend a layout with quantified justification, as you would in a design review.

**Goal:** Own a layout decision end to end, with numbers and a defensible recommendation.

---

## Self-Check Checklist

Tick these when you can do them *without looking anything up*:

- [ ] Compute a struct's size and field offsets by hand from its field types, including all padding.
- [ ] Reorder any struct to minimal padding and state the bytes saved.
- [ ] Name the header contents and approximate size for a JVM object, a CPython object, and a C++ virtual object.
- [ ] Explain why `int[]` and `Integer[]` differ ~5x in memory.
- [ ] Decide AoS vs SoA for a given access pattern and justify it with cache lines.
- [ ] Explain a hidden-class deopt: what forks the shape, and the mono→poly→megamorphic progression.
- [ ] Encode/decode a compressed oop and explain the 32 GB cliff.
- [ ] Read a mark word's state and explain how hashing interacts with locking.
- [ ] Reproduce false sharing and fix it with padding; explain why 128 bytes.
- [ ] Separate an interior layout from a boundary (wire) layout and describe the conversion and endianness handling.
- [ ] Multiply a per-object overhead by N and turn it into an architecture decision.

---

## Hints

**Ex 1–2 (size & reorder):** alignment of a primitive ≈ its size; struct alignment = max field alignment; size rounds up to that. Padding goes *before* an under-aligned field and at the *end* to round the total.

**Ex 3 (Python sizes):** the number isn't the value's bits — it's `PyObject` header (refcount + type ptr) plus type-specific payload. Big ints grow with digit count; strings carry length + encoding metadata.

**Ex 6 (JOL):** `ClassLayout.parseClass(X.class).toPrintable()`. Look for "object header" rows, then the field, then "loss due to next object alignment."

**Ex 8 (V8 shapes):** construct objects two ways — `{a;b}` vs `{b;a}` add order — and read `obj.a` in one function. `--trace-ic` shows the site state change. Node flag `--allow-natives-syntax` enables `%HasFastProperties(obj)`.

**Ex 9 (AoS/SoA):** the SoA `x`-only loop streams a contiguous `float[]`; the AoS loop strides by the full struct size, so each cache line carries mostly fields you ignore. Make the struct big enough (e.g. 24+ bytes) for the effect to show.

**Ex 13 (oops cliff):** check `java -Xmx34g -XX:+PrintFlagsFinal -version | grep UseCompressedOops`. Crossing ~32 GB flips it to false; every reference field then doubles from 4 to 8 bytes.

**Ex 14 (mark word):** the identity hash isn't computed until first requested; while thin-locked the mark word holds a stack lock-record pointer, so a previously-stored hash is displaced into that record.

**Ex 15 (false sharing):** pack `long`s adjacently and they share a 64-byte line; pad to 128 bytes (not just 64) to also defeat the adjacent-line prefetcher. `perf c2c` reports the contended line and the offending offsets.

**Ex 18 (MI vptr):** `(B*)pc` points to the `B` subobject, which sits *after* the `A` subobject in memory, so its pointer value is `pc + offsetof(B-subobject)` — nonzero. That offset is the `this`-adjustment.

**Ex 19 (niche):** `&T`, `Box<T>`, `NonZero*` have an invalid bit pattern (null/zero) the compiler reuses for `None`. A type that can legitimately hold *every* bit pattern (e.g. a plain `u8` — but `Option<u8>` actually does have a niche via the unused 256th value... use a type that fills all states) needs a separate discriminant, so `Option<T>` grows.

**Ex 20 (footprint):** on-heap = header + fields + padding, rounded; off-heap = packed fields (mind alignment if you want fast access); columnar = sum of column arrays, one schema. Multiply each by 1e9 and compare to RAM/cost.

**Ex 22 (ABI gate):** C++ `static_assert(sizeof(T)==N)` and `static_assert(offsetof(T,f)==K)`; Rust `const _: () = assert!(...)`; Go a test using `unsafe.Sizeof`/`Offsetof`.

---

## Sparse Solutions

**Ex 1:** `{char a; int b; char c;}` → `a@0`, 3 pad, `b@4`, `c@8`, 3 trailing pad → **12 bytes**. Reordered `{int b; char a; char c;}` → **8 bytes**.

**Ex 2:** `{char, double, int, char, short}` poorly ordered is typically 24 bytes; reordered `{double, int, short, char, char}` packs to **16 bytes**.

**Ex 3:** `getsizeof(0)` ≈ 28 (PyLong header + one digit). `2**70` is larger (more digits). `""` ≈ 49–51, `"hi"` a few bytes more — string objects carry length + hash + encoding fields beyond the base header.

**Ex 4:** `int[1_000_000]` ≈ 4 MB (one array, inline 4-byte values). `Integer[1_000_000]` ≈ 4 MB of references **plus** ~16 MB of `Integer` objects ≈ ~20 MB total, ~5x, and far worse locality (each element is a pointer chase).

**Ex 6:** single-`int` class on 64-bit HotSpot (compressed oops): 8 (mark) + 4 (class ptr) + 4 (int) = 16, already aligned → **16 bytes** minimum.

**Ex 7:** the `__slots__` version has **no `__dict__`** (`hasattr(obj, '__dict__')` is `False`) and is markedly smaller per instance; at 1M instances the RSS difference is large (often tens of MB).

**Ex 9:** the SoA `x`-only loop is typically several times faster; AoS wastes ~(struct_size − 4)/struct_size of each cache line on fields the loop ignores.

**Ex 10:** adding a `virtual` method adds an **8-byte vptr** at offset 0 (plus realignment padding); two `double`s (16B) → **24B**. Further virtual methods don't grow the object.

**Ex 13:** the ~31 GB heap (compressed oops **on**, 4-byte refs) can hold **more** live data than the ~34 GB heap (compressed oops **off**, 8-byte refs), because every reference field doubled.

**Ex 14:** fresh → unlocked/no-hash; after `hashCode()` → hash stored in the mark word; inside `synchronized` → mark word holds a lock-record pointer and the hash is **displaced** into the lock record.

**Ex 15:** unpadded counters scale poorly or negatively; padding each to **128 bytes** restores near-linear scaling. `perf c2c` flags the shared line with high cache-to-cache transfers.

**Ex 18:** `(A*)pc == pc` (A subobject first), but `(B*)pc == pc + sizeof(A-subobject)` — a **nonzero** offset, the `this`-adjustment; `sizeof(C)` includes **two** vptrs.

**Ex 19:** `Option<&u8>` and `Option<Box<u8>>` are the **same size** as the inner pointer (null niche). For a type with no spare pattern, `Option<T>` adds a discriminant (and possibly padding), so it's **larger**.

**Ex 20:** rough per-record: on-heap ≈ 16 (header) + 24 (fields+padding for `u64,u32,u32,u8` → padded) = ~40 B → ~40 GB; off-heap packed ≈ 17–24 B → ~17–24 GB; columnar ≈ sum of column widths ≈ ~21 B/row but with one schema and better scan/compression. At N=1e9 the header alone (on-heap) is ~16 GB of waste — the case for off-heap/columnar.

**Ex 22:** the deliberate field addition changes `sizeof`/offsets, so the `static_assert` / size test **fails the build** — exactly the regression catch you wanted.

---

> When you've ticked every box in the [Self-Check Checklist](#self-check-checklist) and finished at least one capstone, you understand object layout the way a runtime engineer does: as bytes you can see, measure, and move on purpose.
