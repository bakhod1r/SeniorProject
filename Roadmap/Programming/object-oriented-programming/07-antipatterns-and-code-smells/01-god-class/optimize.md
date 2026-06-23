# God Class — Optimize

God Classes are usually framed as a maintainability problem. They are also a *performance* problem. The JVM's optimizer makes assumptions that small, focused classes satisfy and large, fat classes violate. Below are ten angles, each with concrete numbers from HotSpot defaults.

All ns/op figures below are illustrative — measured on a single 4.6 GHz x86 core under JMH with `-XX:+UnlockDiagnosticVMOptions`. Treat them as ranges, not constants.

---

## 1. JIT Inlining Limits — `MaxInlineSize` and `FreqInlineSize`

C2 inlines a callee only if its bytecode size fits:

| Flag                          | Default  | Meaning                                      |
|-------------------------------|----------|----------------------------------------------|
| `-XX:MaxInlineSize`           | 35 bytes | Maximum bytecode size for cold callees       |
| `-XX:FreqInlineSize`          | 325 B    | Maximum bytecode size for hot callees        |
| `-XX:MaxInlineLevel`          | 9        | Inlining recursion depth                     |
| `-XX:InlineSmallCode`         | 1000 B   | Skip if target's compiled code is bigger     |

A method in a God Class is rarely small. A 200-line method easily compiles to 800-2000 bytes — beyond `FreqInlineSize`. C2 stops inlining; every call becomes a real virtual dispatch with a stack frame.

```java
// likely inlined — 12 bytes
int subtotal() { return qty * unitPrice; }

// not inlined — 600+ bytes; full call cost ~3-5 ns
Money computeTotalWithDiscountsAndTaxesAndShippingAndLoyalty() { /* 180 lines */ }
```

| Method shape       | Bytecode size | Inlined? | Call cost (illustrative) |
|--------------------|---------------|----------|--------------------------|
| Tiny getter        | ~6 B          | Yes      | ~0.3 ns                  |
| Small calc         | ~30 B         | Yes      | ~0.5 ns                  |
| Medium             | ~120 B        | Maybe    | ~1.5 ns                  |
| Large (god method) | ~700 B        | No       | ~3-5 ns                  |

---

## 2. Code Cache Pressure

`ReservedCodeCacheSize` defaults to 240 MB on modern JDKs. Big methods compile to big code. A God Class with 40 large methods can occupy several megabytes of code cache by itself, leaving less room for the rest of the application.

When the code cache fills, the JVM stops compiling and falls back to interpretation. Symptom: throughput drops 20-40% under load, with no GC pressure.

```
-XX:+PrintCodeCache
-XX:+PrintCompilation
```

A 2 MB compiled God Class is a red flag: see the address ranges in `PrintCompilation` output.

---

## 3. Megamorphic Call Sites

C2 specializes call sites based on observed receiver types:

| Receiver types seen | Site type      | Optimization                       |
|---------------------|----------------|------------------------------------|
| 1                   | Monomorphic    | Direct call, full inlining         |
| 2                   | Bimorphic      | Type check + two inlined targets   |
| ≥ 3                 | Megamorphic    | Vtable lookup; no inlining         |

A God Class often *is* the receiver everywhere — so the call sites that target *it* stay monomorphic. The problem appears when the God Class implements many interfaces and a caller dispatches into it through one of them, while other callers dispatch through different interfaces. The shared method becomes megamorphic.

```java
class GodService implements UserOps, OrderOps, ReportOps, BillingOps { /* ... */ }
// every interface call site sees GodService plus other implementations -> megamorphic
```

Split the God Class into one implementation per interface; each call site becomes monomorphic again.

---

## 4. Instance Footprint

A God Class accumulates fields. Each reference is 4 bytes (with compressed oops) or 8 bytes (without). A class with 40 fields has at least 160 bytes of header + fields, often more after padding.

| Class shape          | Fields | Instance footprint |
|----------------------|--------|--------------------|
| Small domain object  | 4      | 32 B               |
| Medium service       | 8      | 56 B               |
| Big service          | 20     | 104 B              |
| God class            | 40     | 184 B              |

For singletons this barely matters. For per-request or per-row objects, multiplying 184 B × 1 million rows = 184 MB of avoidable heap.

Even worse: many of those fields are *unused* by most operations. Cache lines get filled with cold data and crowd out the hot fields.

---

## 5. Cache Locality and False Sharing

A focused class with 4 fields fits comfortably in one 64-byte cache line. A God Class with 40 fields spans 3+ cache lines. Worse, methods often touch fields scattered across all lines, defeating prefetch.

In multi-threaded code, writes from different threads to different fields of the same big object can cause **false sharing** when those fields share a cache line. Splitting the class — or at least adding `@Contended` (`-XX:-RestrictContended`) to hot counters — restores throughput.

---

## 6. Escape Analysis on Small Classes

HotSpot's escape analysis (`-XX:+DoEscapeAnalysis`, on by default) can eliminate allocations entirely when a small object does not escape its creating scope.

```java
// scalar replaced — zero allocation
var pos = new Position(x, y);
return pos.distanceTo(origin);
```

EA gives up on large or complex objects. Methods inside a God Class that create another God Class instance get no allocation elision: every transient instance hits the eden generation.

Empirical pattern: replacing a 40-field god-helper with a 3-field record often cuts allocation rate 5-10x for that path.

---

## 7. GC Behavior on Large vs Small Objects

G1 and ZGC handle small short-lived allocations cheaply. But:

- **Humongous objects** (≥ 50% of a G1 region, default region 1 MB) bypass the young generation entirely. A God Class instance with many array fields can become humongous if any of those arrays grow.
- **Promotion cost** scales with object size. Big objects survive young GC and pollute the old generation, increasing full-GC frequency.
- **Card marking** writes one byte per 512-byte card. Wider objects trigger more card marks under write barriers.

Splitting a 200 KB structure into 5 × 40 KB structures keeps every piece below the humongous threshold and below the card boundary.

---

## 8. Benchmark — Splitting a God Class

| Benchmark (JMH, single-thread, illustrative) | God Class | Split version |
|---------------------------------------------|-----------|---------------|
| `processOrder`                              | 1,250 ns  | 410 ns        |
| `lookupUser`                                | 980 ns    | 220 ns        |
| `calculateDiscount`                         | 1,840 ns  | 690 ns        |
| Allocation per op                           | 312 B     | 96 B          |
| Eden churn per million ops                  | 297 MB    | 91 MB         |
| Code cache used                             | 1.9 MB    | 720 KB        |

The speedup is rarely from one cause. It is JIT inlining + cache locality + reduced allocation + monomorphic dispatch all combining.

---

## 9. Method Profile Pollution

C2 builds a profile per method: branch taken counts, type seen at call sites, null checks. A method inside a God Class is invoked from many disjoint contexts. The profile becomes "average of everything" — none of its predictions match a single caller well.

After a split, each smaller method has a profile that matches its actual usage. C2 generates code specialized for that profile.

This is why a refactor that does not change the algorithm can still produce a measurable speedup: the profile is sharper.

---

## 10. Class Loading and Initialization

Loading a God Class loads everything it transitively references. If the class has 30 imports, all 30 classes load, run their `<clinit>` blocks, and consume metaspace.

Symptom: cold-start latency. A microservice that loads a God Service at startup pays ~50-200 ms of class loading it would not pay for a focused one.

For serverless / Lambda workloads, this is the difference between meeting and missing a 1-second cold-start budget.

---

## Quick Rules Checklist

- Hot methods stay under 325 bytes of bytecode — keep them inlinable.
- Prefer many small classes over one big one; EA, locality, and GC all benefit.
- Watch `PrintCompilation` for "too big" or "hot method too big" messages.
- Suspect megamorphic call sites when a single interface method becomes a hotspot.
- Records and immutable small classes give the JIT its best optimization surface.
- Split God Classes before tuning GC — you may not need to tune at all.
- Measure with JMH on a quiet box; never trust a single timing.
- Use `-XX:+PrintInlining` to confirm what gets inlined and what does not.

**Memorize this:** Small classes give the JVM what it needs — inlining, monomorphic dispatch, escape analysis, locality — so the same logic in a God Class is almost always slower, allocates more, and pressures the code cache.
