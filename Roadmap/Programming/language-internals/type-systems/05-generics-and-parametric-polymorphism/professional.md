# Generics & Parametric Polymorphism — Professional Level

> **Topic:** [Generics & Parametric Polymorphism](README.md)
> **Focus:** The engineering economics of generics at scale — binary size vs. runtime speed vs. compile time vs. runtime type information, and how to *measure and tune* the trade-off. Monomorphization bloat as a real cost center, accidental boxing as a real latency leak, raw-type `ClassCastException`s in production, and the cross-language design decisions you make on real systems.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **At scale, the choice of generics implementation stops being a language-design footnote and becomes a line item in your budget** — binary size, cold-start time, p99 latency, GC pressure, build duration, and on-call incidents. This page is about *operating* generics in production: measuring the costs, recognizing the failure modes, and making the right trade per call site.

Every preceding level treated the four implementation strategies (monomorphization, erasure, reified, hybrid) as *facts about languages*. The professional level treats them as *knobs you turn under constraints*. The same `<T>` that's free in a textbook can, in a real binary, cost you 40 MB of code, a 200 ms cold start, a hot loop that allocates a million boxed `Integer`s per second, or a compile that went from 90 seconds to 12 minutes when someone added one heavily-instantiated generic to a hot dependency.

The four costs are in tension and you cannot minimize all of them:

- **Runtime speed** (favored by monomorphization/reification — no boxing, full inlining),
- **Binary/code size** (favored by erasure/sharing — one copy),
- **Compile/build time** (favored by erasure — compile the generic once),
- **Runtime type information** (favored by reification — `typeof(T)`, `new T()`).

Monomorphization buys speed and runtime-type-per-copy by spending size and compile time. Erasure buys size and compile time by spending speed (boxing) and runtime type info. Reification buys speed *and* runtime type info by spending runtime complexity and some specialization cost. There is no free lunch; there is only the right trade for *this* service, *this* call site, *this* deployment target.

This page works through the production realities: **monomorphization bloat** (Rust/C++ binaries, `serde`/template explosions, cold-start and instruction-cache costs) and how to cap it; **accidental boxing** (Java/Scala/C# autoboxing in hot paths, the `List<Integer>` tax, GC pressure) and how to find and kill it; **raw-type and unchecked-cast `ClassCastException`s** that detonate in production far from their cause; the **Go before/after** story as a concrete migration case; and the **decision framework** for choosing and tuning generics on real systems — including when to *deliberately erase a monomorphized generic* or *specialize an erased one*. Throughout, the discipline is the same: **measure the four costs, locate the bottleneck, turn exactly the knob that addresses it.**

---

## Prerequisites

- **Required:** Senior level — parametricity, free theorems, rank-1 vs. higher-rank, specialization, the expression problem.
- **Required:** Solid middle-level command of monomorphization vs. erasure vs. reified vs. Go's hybrid and their observable consequences.
- **Required:** Working familiarity with profiling: CPU profiles, allocation profiles, binary-size analysis, build-time analysis.
- **Helpful:** Having shipped a service where binary size, cold start, p99 latency, or build time was a real constraint.
- **Helpful:** Exposure to at least two of {Rust/C++, Java/Scala, C#, Go} in production.

You do **not** need:

- The formal relational definition of parametricity (`senior.md` gave the intuition).
- Variance or higher-kinded types in depth (sibling topics).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Monomorphization bloat** | Binary-size and compile-time growth from emitting a specialized copy of a generic per type argument. |
| **Instruction-cache (i-cache) pressure** | Slowdown from a large hot code footprint (many monomorphized copies) thrashing the CPU's instruction cache. |
| **Accidental boxing** | Unintended heap allocation when a value type is silently promoted to a reference (e.g. Java autoboxing `int` → `Integer`). |
| **Autoboxing** | Automatic, implicit boxing/unboxing inserted by the compiler (Java, C#) — convenient and a frequent hidden cost. |
| **Boxing tax** | The aggregate runtime cost (allocation, GC, indirection, cache misses) of boxed value types in erased generics. |
| **Raw type** | (Java) A generic used without type arguments; disables checks and re-enables runtime `ClassCastException`. |
| **Heap pollution** | A generically-typed location holding a value of the wrong actual type, due to unchecked casts/raw types; the time bomb behind delayed `ClassCastException`s. |
| **Unchecked cast/warning** | A cast the compiler cannot verify due to erasure; the marked spot where the wrong type can enter. |
| **Code-size budget** | A hard or soft limit on binary size (embedded, WASM, mobile, fast cold-start serverless). |
| **Cold start** | Time to first useful work for a fresh process/instance; sensitive to binary size, JIT warmup, and code that must be loaded. |
| **PGO** | Profile-Guided Optimization; using runtime profiles to drive specialization/inlining decisions. |
| **Devirtualization** | The compiler/JIT turning a dynamic dispatch into a direct (often inlined) call when the target type is known — recovering monomorphization-like speed from erased/virtual code. |
| **`dyn`/trait object / interface boxing** | Deliberately erasing a monomorphized generic via dynamic dispatch to share one code copy. |
| **Striped/specialized container** | A primitive-specialized collection (`IntArrayList`, `int[]`, `IntStream`) avoiding the boxing tax. |

---

## Core Concepts

### 1. The Four-Cost Budget (and Why You Can't Win All Four)

Internalize this as the master frame. Every generics decision moves you in a 4-dimensional space:

| Strategy | Runtime speed | Binary size | Compile time | Runtime type info |
|----------|:-:|:-:|:-:|:-:|
| **Monomorphization** (C++, Rust, C# value types) | ✅ best | ❌ worst | ❌ worst | ✅ (each copy is a type) |
| **Erasure** (Java, Scala, TS, Haskell) | ❌ boxing | ✅ best | ✅ best | ❌ lost |
| **Reified** (C#) | ✅ no box | ~ medium | ~ medium (JIT) | ✅ best |
| **Hybrid** (Go) | ~ medium | ~ medium | ✅ good | ~ partial (dict) |

Your job at scale is to know *which cost is binding* for the system in front of you and turn the knob that relieves it — even if that means locally deviating from your language's default (erasing a Rust generic, specializing a Scala one). The mistake is optimizing a cost that isn't binding (e.g. fighting boxing in cold code, or shrinking a binary when latency is the actual problem).

### 2. Monomorphization Bloat: A Real Cost Center

In Rust and C++, every distinct type argument can spawn a full copy of the generic's code. Multiply by:

- **Number of type arguments** the generic is used with (transitively, across all dependencies),
- **Number of *generic functions* called inside** (each also monomorphized per type),
- **Inlining**, which duplicates code further.

Result: heavily generic codebases and template-heavy C++ produce **large binaries and long compiles**. Famous offenders: `serde` and `futures` in Rust (deep generic graphs), C++ template metaprogramming. The costs are not just disk:

- **Compile/build time** balloons — a single hot, widely-instantiated generic can dominate a build. CI minutes and developer iteration speed suffer.
- **Binary size** matters directly on **embedded**, **WASM** (download + parse), **mobile**, and **fast-cold-start serverless** targets.
- **I-cache pressure**: many near-identical hot copies can *reduce* performance by thrashing the instruction cache — the irony that "zero-cost" specialization can become net-negative at extreme instantiation counts.

**Mitigations** (each trades the specialization back for size): route a large, non-hot generic through **`dyn`/virtual dispatch** to share one copy; **factor a thin generic shell over a non-generic core** (the generic part is tiny and specialized; the bulk is monomorphization-free); **reduce instantiation count** by erasing at a boundary; use tooling (`cargo bloat`, `cargo-llvm-lines`, linker map analysis, C++ `-ftime-trace`) to *find* the offending instantiations before guessing.

### 3. Accidental Boxing: A Real Latency Leak

On erased runtimes (and at interface boundaries even on reified ones), value types get **autoboxed** silently. The classic Java case: `Map<Integer, Integer>`, `List<Long>`, a generic `Comparator<Integer>`, a `Stream<Integer>` — each element is a heap object. In a hot path this means:

- **Allocation** per boxed value → GC pressure, more frequent collections, longer pauses.
- **Pointer indirection** on every access → cache misses; a `List<Integer>` sum can be several times slower than an `int[]` sum.
- **Megamorphic/virtual costs** when the boxed type flows through generic interfaces.

Boxing is *invisible in the source* — `int total = map.get(key)` looks free but unboxes; passing an `int` to a `<T>` parameter boxes. You find it with **allocation profilers** (async-profiler `alloc`, JFR, `dotnet-trace`/`dotnet-gcdump`), which surface a flood of `Integer`/`Long` allocations, and you kill it with **primitive-specialized data structures** (`int[]`, `IntStream`, Eclipse Collections / fastutil / Trove primitive collections, `IntList`), `@specialized` (Scala) for hot generics, or by keeping the hot inner loop in primitive types and only boxing at the API boundary. On .NET, the equivalent is avoiding boxing at `object`/non-generic-interface boundaries; reified generics keep `List<int>` unboxed but a cast to `IComparable` or `object` reintroduces the box.

### 4. Raw Types, Unchecked Casts, and Production `ClassCastException`

Erasure's darkest operational failure mode: a wrong type enters a generic collection through a **raw type** or **unchecked cast** (heap pollution), passes all compile-time checks, and detonates as a `ClassCastException` at the *read* site — often a different module, a different team, and hours or days later. The stack trace points at the innocent reader, not the guilty writer.

```text
// Producer (the bug): raw type erases the check.
List raw = getStrings();      // raw List
raw.add(42);                  // compiler shrugs (unchecked) — an Integer sneaks in

// Consumer (the crash, far away):
for (String s : strings) { ... }   // ClassCastException: Integer cannot be cast to String
```

This is a *direct consequence* of erasure: the cast inserted by the compiler at the read site is the first place the lie is detected. The professional defenses: **treat every "unchecked" warning as a real defect** (CI fails on them, `-Werror`-style), **never use raw types in new code**, **fail fast** by validating element types at trust boundaries (deserialization, reflection, legacy interop) instead of letting bad data flow inward, and prefer immutable/typed factories over raw mutation. The reified-generics languages (C#) don't have this exact failure mode for the same reason they cost more at runtime — they kept the type at runtime.

### 5. The Go Before/After Story as a Migration Case Study

Go is the cleanest real-world illustration of *why* parametric polymorphism matters operationally, because the language shipped without it for a decade and then added it.

- **Before (Go < 1.18):** reusable containers and algorithms used `interface{}` plus runtime **type assertions**. This was hand-rolled erasure with *all* its costs and *none* of its compile-time safety: boxing of every value into an interface, a heap allocation and pointer indirection per element, and runtime `panic` if an assertion was wrong. Codegen tools (`go generate`) were a common workaround — *manual monomorphization by text templating* — trading the runtime cost for build-tooling complexity and code duplication.
- **After (Go 1.18+):** `[T any]` gives compile-time-checked, assertion-free generic code via the GC-shape-stencil-plus-dictionary hybrid. The win is **type safety and the elimination of assertion panics**; the performance is "usually better than `interface{}` boxing, not always as fast as Rust monomorphization" because of dictionary indirection. The lesson: generics removed an entire class of runtime panics and a whole category of codegen tooling, at the cost of a more sophisticated compiler — exactly the junior-level "stop casting" lesson at language scale.

### 6. The Decision Framework: Choosing and Tuning Per Call Site

A repeatable procedure for production generics decisions:

1. **Identify the binding cost.** Is the system constrained by latency, GC pauses, binary size, cold start, or build time? Measure — don't assume.
2. **Map the cost to the strategy.** Latency/GC → boxing is suspect (erased langs); binary/cold-start/build → monomorphization is suspect (Rust/C++).
3. **Locate the specific offender.** Allocation profile for boxing; `cargo-llvm-lines`/`cargo bloat`/linker maps for monomorphization; build-time tracing for compile cost.
4. **Turn exactly one knob:**
   - Boxing hot path → primitive-specialized container or `@specialized`; keep the loop in value types, box only at the boundary.
   - Monomorphization bloat → erase the large/cold generic via `dyn`/virtual; factor a thin generic shell over a non-generic core; cut instantiation count.
   - Need runtime `T` on an erased runtime → thread type tokens (`Class<T>`, `TypeReference`); don't fake it with reflection hacks.
5. **Re-measure.** Confirm the binding cost moved and you didn't push a different cost past its limit (e.g. specialization that re-bloated the binary).

The senior insight made operational: **specialization and erasure are sliders you set per call site**, not language-wide verdicts you accept passively.

### 7. Devirtualization and the JIT: Erased Code That Runs Like Monomorphized

A crucial nuance: erased/virtual generic code is *not* doomed to be slow. Modern JITs (HotSpot, .NET) and AOT optimizers perform **devirtualization** — when profiling shows a generic/virtual call site is *monomorphic in practice* (one actual type dominates), the JIT speculatively inlines the concrete implementation, recovering near-monomorphization speed *dynamically*. This is why a hot `Stream<T>` pipeline can run fast despite erasure, and why micro-benchmarks must use realistic type diversity. The flip side: a **megamorphic** call site (many actual types) defeats devirtualization and stays slow — so type diversity at a hot generic boundary is itself a performance concern. Professionals reason about *what the JIT can prove*, not just what the source says.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Four-cost budget** | A vehicle you can tune for speed, fuel economy, cargo space, or off-road capability — but not all four at once. Pick what *this trip* needs. |
| **Monomorphization bloat** | A warehouse stocking a full custom toolkit for every job type — instant readiness, but the warehouse overflows and restocking (builds) takes forever. |
| **I-cache pressure from bloat** | So many near-identical toolkits that the worker spends all day walking the aisles instead of working — the "fast" specialization becomes slow. |
| **Accidental boxing** | Shipping single screws each in its own padded crate because the conveyor only handles crates — enormous overhead for tiny items. |
| **Raw-type `ClassCastException`** | A mislabeled crate that passes every checkpoint and explodes only when finally opened, three buildings away from where it was mislabeled. |
| **Devirtualization** | A general-purpose worker who, noticing they do the *same* job 99% of the time, sets up a dedicated fast jig for it — regaining specialist speed without a permanent specialist line. |
| **Decision framework** | Triage in an ER: find the *binding* problem (what's actually killing the patient) before treating anything. |

---

## Mental Models

### The Binding-Constraint Lens

At scale there is always *one* dominating cost. Generics tuning is the discipline of (a) identifying which of {speed, size, build, runtime-type-info} is binding, and (b) moving *only* that one, watching that the others don't breach their limits. Optimizing a non-binding cost is wasted work — or worse, it pushes a non-binding cost into binding territory.

### The Per-Call-Site Slider

Don't think "my language monomorphizes" or "my language erases." Think: "at *this* call site, do I want the specialized-fast-big version or the shared-small-slower version?" Rust lets you slide toward erasure with `dyn`; Scala/JVM lets you slide toward monomorphization with `@specialized`; everyone can slide by factoring generic shells over concrete cores. The strategy is a *default*, not a *mandate*.

### Invisible-Cost Vigilance

The two costliest generics mistakes — **boxing** and **monomorphization bloat** — are both *invisible in the source*. `map.get(k)` doesn't look like an allocation; `Vec<Foo>` doesn't look like 30 KB of code. Professionals don't reason about generics costs from the source; they reason from **profiles and size reports**. Train yourself to distrust the source's apparent cost and reach for the tool.

### The Detonation-Distance Model (for erasure bugs)

Erasure-induced type errors detonate *far from their cause* — different time, module, team. The defense is to **shrink detonation distance**: validate at trust boundaries so the bad type is rejected at *entry*, where the cause is obvious, instead of at a distant *read*. Every unchecked cast you allow lengthens the fuse.

---

## Code Examples

### Finding and killing accidental boxing (Java)

```java
import java.util.*;

class BoxingHotPath {
    // SLOW: every key and value is a heap Integer; get() unboxes; GC churns.
    static long sumValuesBoxed(Map<Integer, Integer> m) {
        long total = 0;
        for (Integer v : m.values()) total += v;   // unbox per element
        return total;
    }

    // FAST: primitives throughout; no Integer objects, no GC pressure, cache-friendly.
    // (Use a primitive-specialized map such as fastutil Int2IntOpenHashMap, or
    //  restructure to int[] / IntStream for the hot path. Box only at the API edge.)
    static long sumValuesPrimitive(int[] values) {
        long total = 0;
        for (int v : values) total += v;
        return total;
    }
    // Allocation profiler reveals the boxed version allocating millions of Integers;
    // the fix is structural (primitive container), not a micro-optimization.
}
```

### Capping monomorphization bloat by erasing at a boundary (Rust)

```rust
use std::fmt::Display;

// MONOMORPHIZED: one full copy per T. If `report` is large and called with many
// types, the binary and compile time grow with every distinct T.
fn report_mono<T: Display>(items: &[T]) {
    for x in items { /* ...large body, duplicated per T... */ println!("{}", x); }
}

// ERASED via trait objects: ONE copy of the large body, dynamic dispatch on Display.
// Trades a little runtime speed for a lot less code when many Ts share this path.
fn report_dyn(items: &[&dyn Display]) {
    for x in items { println!("{}", x); }
}

// Pro pattern: thin generic SHELL over a non-generic CORE — specialize the tiny
// adapter, keep the bulk monomorphization-free.
fn process<T: Into<String>>(x: T) { process_core(x.into()); }  // tiny, per-T
fn process_core(s: String) { /* the large body, compiled ONCE */ }
```

### The raw-type heap-pollution time bomb (Java)

```java
import java.util.*;

class HeapPollution {
    @SuppressWarnings({"unchecked", "rawtypes"})   // <-- the smell that hides the bug
    static List<String> pollute() {
        List raw = new ArrayList();      // raw type: checks disabled
        raw.add("ok");
        raw.add(Integer.valueOf(42));    // unchecked: a non-String enters silently
        return raw;                       // returns a "List<String>" that lies
    }

    public static void main(String[] args) {
        List<String> strings = pollute();
        // Detonates HERE — far from the bug above — at the compiler-inserted cast:
        for (String s : strings) {        // ClassCastException: Integer -> String
            System.out.println(s.length());
        }
    }
    // Defense: -Xlint:unchecked + fail the build on warnings; never use raw types;
    // validate element types at the trust boundary so the bad value is rejected at ENTRY.
}
```

### Go before/after: assertion panic vs. compile-time safety

```go
package main

import "fmt"

// BEFORE: interface{} + assertion. Boxing + a runtime panic waiting to happen.
func MaxAny(items []interface{}) interface{} {
	max := items[0]
	for _, v := range items[1:] {
		if v.(int) > max.(int) { // PANICS at runtime if any element isn't an int
			max = v
		}
	}
	return max
}

// AFTER: type-safe, no boxing-by-interface for the element comparison path,
// no assertions, the wrong-type error is a COMPILE error at the call site.
func Max[T int | float64](items []T) T {
	max := items[0]
	for _, v := range items[1:] {
		if v > max {
			max = v
		}
	}
	return max
}

func main() {
	fmt.Println(Max([]int{3, 1, 4, 1, 5}))
	// MaxAny([]interface{}{3, "oops"}) would panic at runtime; Max can't even be
	// called with mixed types — the mistake is caught before the program runs.
}
```

### Measuring before tuning (the tooling that makes it real)

```text
# Rust: find which generic instantiations dominate code size / compile time.
cargo install cargo-bloat cargo-llvm-lines
cargo llvm-lines | head        # functions by generated LLVM lines (mono offenders)
cargo bloat --release          # functions by binary size

# C++: where does compile time go (often template instantiation)?
clang++ -ftime-trace foo.cpp   # produces a Chrome-trace of compile phases

# Java/JVM: find accidental boxing as an allocation flood.
# async-profiler:  ./profiler.sh -e alloc -d 30 <pid>   -> Integer/Long allocations
# JFR:             -XX:StartFlightRecording, inspect "Allocation" events

# The rule: never guess which generic costs you — these tools point at the exact one.
```

---

## Pros & Cons

| Decision | Pros | Cons |
|----------|------|------|
| **Default monomorphization (Rust/C++)** | Top runtime speed, no boxing, full inlining. | Bloat, slow builds, i-cache pressure at extreme instantiation counts. |
| **Erase a hot generic at a boundary** | Caps binary size and compile time; one shared copy. | Dynamic-dispatch cost; defeats some inlining (mitigated by JIT devirtualization). |
| **Default erasure (Java/Scala)** | Small code, fast builds, legacy interop. | Boxing tax in hot paths; raw-type `ClassCastException`s; no runtime `T`. |
| **Specialize an erased generic (`@specialized`)** | Kills boxing for chosen hot types. | Bytecode/class explosion; must be selective. |
| **Reified (C#)** | No value-type boxing *and* runtime `T`. | Heavier runtime; boxing still sneaks in at `object`/interface boundaries. |
| **Hybrid (Go)** | Type safety + fast builds + middling speed; killed `interface{}` panics. | Dictionary indirection; not as fast as monomorphization; perf still maturing. |

---

## Use Cases

- **Latency-critical JVM service with numeric hot paths** → hunt boxing with an allocation profiler; replace `List<Integer>`/`Map<Long,…>` with primitive-specialized collections; keep inner loops in primitives, box only at the edge.
- **Rust/C++ service or binary with a size/cold-start budget** (WASM, embedded, serverless, mobile) → measure with `cargo-llvm-lines`/`cargo bloat`/`-ftime-trace`; erase large cold generics via `dyn`/virtual; factor thin generic shells over concrete cores.
- **Library with a huge build-time footprint from a generic dependency** → identify the over-instantiated generic; reduce its instantiation surface or push an erased boundary between it and your code.
- **Legacy `Object`/raw-type Java codebase throwing intermittent `ClassCastException`** → enable `-Xlint:unchecked`, fail builds on warnings, validate types at deserialization/reflection boundaries, migrate raw types to parameterized ones.
- **Go service still on `interface{}` + assertions** → migrate hot, panic-prone reusable code to `[T any]` for compile-time safety; accept the dictionary cost or benchmark the few truly hot spots.
- **Cross-language platform team** → document, per language, which generics cost is binding and the standard mitigation, so the trade-off is a known playbook rather than rediscovered per incident.

---

## Coding Patterns

### Pattern 1: Thin Generic Shell Over a Non-Generic Core

Keep the per-type-specialized surface tiny; push the bulk of the logic into a single non-generic function. Caps monomorphization bloat while keeping a generic API.

```text
fn api<T: Into<Bytes>>(x: T) { core(x.into()); }   // specialized per T, tiny
fn core(b: Bytes) { /* large body, compiled once */ }
```

### Pattern 2: Primitive Boundary, Box Only at the Edge (erased langs)

Do the hot computation in value types (`int[]`, `IntStream`, primitive-specialized collections); convert to/from the generic/boxed form *once*, at the API boundary, not per element.

### Pattern 3: Specialize-the-Hot-Few

Profile, find the handful of type arguments dominating runtime or size, specialize *those* (`@specialized` on the minimal set, or explicit mono), and leave the cold majority erased/shared.

### Pattern 4: Fail Fast at Trust Boundaries

At every place untyped data becomes generically-typed (deserialization, reflection, JNI/FFI, legacy interop), validate element types *immediately* so heap pollution is rejected at entry — shrinking the detonation distance of any erasure bug to zero.

### Pattern 5: Measure-Then-Tune, Never Guess

No generics performance/size change without a before profile and an after profile. The offending instantiation or allocation is almost never the one you'd guess; the tools name it precisely.

---

## Best Practices

- **Know which of the four costs is binding for each service** and tune only that. Optimizing a non-binding cost is waste or harm.
- **Treat boxing and monomorphization bloat as invisible-in-source costs** — reason about them from allocation profiles and size/build reports, not from reading the code.
- **In erased languages, keep hot numeric paths in primitives**; use primitive-specialized collections; box only at boundaries; `@specialized` the minimal hot set.
- **In monomorphizing languages, watch instantiation count**; erase large/cold generics via `dyn`/virtual; factor thin generic shells over concrete cores; profile size and build time.
- **Make unchecked/raw-type warnings build failures**, never use raw types in new code, and validate types at trust boundaries to eliminate delayed `ClassCastException`s.
- **Trust the JIT's devirtualization for *monomorphic* hot call sites**, but treat *megamorphic* generic boundaries (many actual types) as a real performance concern — type diversity at a hot site is a cost.
- **Benchmark generic code with realistic type diversity**; a single-type microbenchmark hides megamorphic and boxing costs that production will expose.
- **Document the per-language generics trade-off as a team playbook** so the right knob is turned by reflex, not rediscovered during an incident.

---

## Edge Cases & Pitfalls

- **"Zero-cost" turning net-negative.** Extreme monomorphization can thrash the i-cache and *slow down* a hot path despite each copy being individually optimal. Measure end-to-end, not per-function.
- **Boxing reintroduced at a boundary on reified runtimes.** C# keeps `List<int>` unboxed, but casting an `int` to `object` or a non-generic `IComparable` boxes it again. The reified guarantee is local; boundaries leak.
- **`@specialized` combinatorial explosion.** Specializing multiple type parameters multiplies generated classes (a grid). Specialize the *minimum* parameters and the *minimum* primitive types.
- **Devirtualization defeated silently.** A call site that was monomorphic in dev becomes megamorphic in prod (more types flow through it), the JIT stops inlining, and latency regresses with no code change. Watch type diversity at hot generic boundaries.
- **Delayed `ClassCastException` blamed on the wrong code.** The crash site (a reader) is innocent; the bug (a raw-type/unchecked writer) is elsewhere. Chasing the stack trace alone misleads — trace the *value's* origin.
- **Build-time death by transitive instantiation.** A dependency's generic, instantiated with your types across your whole codebase, can dominate compile time invisibly. `cargo-llvm-lines`/`-ftime-trace` reveal it; reading your own source won't.
- **Cold-start regressions from binary growth.** Adding a heavily-instantiated generic enlarges the binary, increasing load/parse/JIT-warmup time — a cold-start regression that load tests on warm instances miss entirely.
- **Premature erasure of a genuinely hot generic.** Reaching for `dyn`/virtual to "save size" on a *hot* path can cost more latency than the size saved is worth. Erase the *cold and large*, specialize the *hot and small* — and verify with both profiles.

---

## Summary

- At scale, the four generics strategies are **knobs under constraints**, not language trivia. Every decision moves you in a 4-cost space — **runtime speed, binary size, compile time, runtime type info** — and **you cannot minimize all four**.
- **Monomorphization bloat** (Rust/C++, `serde`/template explosions) is a real cost center: large binaries, long builds, and i-cache pressure that can make "zero-cost" net-negative. Cap it by erasing large/cold generics via `dyn`/virtual, factoring thin generic shells over concrete cores, and cutting instantiation count — *after* `cargo-llvm-lines`/`cargo bloat`/`-ftime-trace` name the offender.
- **Accidental boxing** (Java/Scala/C# autoboxing, the `List<Integer>` tax) is a real latency/GC leak, **invisible in the source**. Find it with allocation profilers; kill it with primitive-specialized containers, keeping hot loops in value types and boxing only at the boundary, or `@specialized` for chosen hot types.
- **Raw types and unchecked casts** cause **heap pollution** and `ClassCastException`s that **detonate far from their cause** — a direct consequence of erasure. Defend by failing builds on unchecked warnings, banning raw types, and validating types at trust boundaries to shrink detonation distance to zero.
- **Go's before/after** is the clean case study: `interface{}` + assertions was hand-rolled erasure with boxing and runtime panics and `go generate` codegen tooling; `[T any]` delivered compile-time safety and killed the panics at the cost of dictionary indirection — usually faster than boxing, not always as fast as monomorphization.
- **The JIT's devirtualization** can make erased/virtual generics run like monomorphized ones *when a hot call site is monomorphic in practice* — but **megamorphic** boundaries defeat it, making type diversity at hot sites a genuine performance concern.
- The professional discipline is a loop: **identify the binding cost → map it to the strategy → locate the specific offender with tooling → turn exactly one knob → re-measure.** Specialization and erasure are **per-call-site sliders**, not language-wide verdicts.
- Above all: **the apparent cost of generics in the source is a lie; reason from profiles and size/build reports.** The expensive instantiation or allocation is rarely the one you'd guess — let the tools name it.
