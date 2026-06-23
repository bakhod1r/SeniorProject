# Escape Analysis and Scalar Replacement — Professional

> **What?** The senior-engineer toolkit: code-review vocabulary for EA-relevant decisions, the profiling discipline that distinguishes "feels fast" from "verified zero allocation", mentoring patterns for engineers who haven't yet internalised allocation cost, and the small set of team policies that keep allocation-free hot paths *staying* allocation-free as a codebase evolves.
> **How?** EA is a *property of the surrounding code*, not of any single object. A class that is EA-friendly today becomes EA-hostile the moment someone stores a reference to it. Your job at this level is to maintain the conditions for EA across many engineers' commits, not to win EA on a single benchmark.

---

## 1. Code-review vocabulary

In review, you need short phrases that a Junior or Middle engineer can act on. The vocabulary you want fluent:

- "This field store defeats EA on every call site." — A method writes to a field. Point at the field and ask: do we need *the object* in the field, or just its values?
- "This return makes the allocation observable." — The method returns a freshly constructed object. If the caller consumes scalars, factor the construction into the caller and pass the components separately.
- "This call site looks megamorphic; the inliner won't get through it." — A polymorphic call inside a hot loop. EA can't see across calls it can't inline. Either narrow the dispatch or push the allocation past the call.
- "Capturing `this` here forces the lambda to escape." — A lambda passed across a method boundary, capturing the enclosing instance. Often the lambda can be rewritten as a static utility taking explicit parameters.
- "Verify with `-prof gc` before claiming this is allocation-free." — Reject hand-wavy claims. Every "EA wins here" assertion in a PR description must come with JMH output or `PrintEliminateAllocations` evidence.

> **Reviewer:** This new `Aggregator.last` field defeats EA across every `process()` call. We chose records for `Point` precisely so the hot path could stay zero-allocation. Suggest storing `lastX` / `lastY` as scalars instead — same observable behaviour, restored EA, verified with `-prof gc`.

That's the shape of a useful review comment: name the EA-relevant decision, point at the symptom, propose the smallest move, ask for evidence.

---

## 2. Verification tooling — the three signals

No engineer should claim "this hot path doesn't allocate" without one of these three signals:

**JMH GC profiler.** The first stop. `gc.alloc.rate.norm` gives bytes-per-op.

```
Benchmark                       Mode  Cnt   Score   Error   Units
sumDistances                    avgt    5   3.2     0.1     ns/op
sumDistances:gc.alloc.rate.norm avgt    5   0.0     0.0     B/op
```

`0.0 B/op` is the only acceptable number for an allocation-free claim. `16 B/op` means one Point per op. `0.04 B/op` means *most* but not all calls succeed (uncommon — usually a deopt is happening, see below).

**`-XX:+PrintEliminateAllocations`.** The compiler's own log. If the compiler thinks it eliminated the allocation, this log will say so. If the log is silent for the allocation site you care about, EA failed.

**`async-profiler -e alloc` or JFR's `jdk.ObjectAllocationInNewTLAB` event.** Production-grade verification. JMH measures synthetic benchmarks; JFR/async-profiler measure your *actual* application. Run with allocation profiling on a production-shaped workload; the hot path should not show up in the allocation flame graph at all.

```bash
java -agentpath:libasyncProfiler.so=start,event=alloc,file=alloc.html -jar app.jar
```

The flame graph reveals what the synthetic benchmark hides: the same code may EA-eliminate in isolation and allocate in your real call graph, because the surrounding code defeats inlining.

---

## 3. The deopt problem

A method that ran allocation-free for an hour can suddenly start allocating because the JIT *deoptimised* it. Causes:

- A previously monomorphic call site saw a second receiver type. C2 deopts to C1, EA goes away, allocations come back.
- A class assumption became invalid (a new class loaded that defeats a CHA-based inline). Deopt.
- The method exceeded its bailout threshold for some other speculation.

The symptom in production: a service that handled 50 000 req/s for hours falls to 20 000 req/s during a deploy or after a hot-deploy. The flame graph after the regression shows allocations in places that were free before.

The discipline: monitor `gc.alloc.rate` (not `gc.alloc.rate.norm`) as a service-level signal. Sudden jumps mean either a new code path is now hot or an EA-eliminated site started allocating. The JIT's `-Xlog:jit+compilation*=debug` log identifies which method just deoptimised — match the timestamp to the regression.

---

## 4. Mentoring engineers on allocation-free hot paths

The two stages of mentoring:

**Stage 1 — "allocation is not free."** A Junior who has just learned that EA exists often jumps to "allocations are free, the JIT handles it". They write benchmarks that store nothing and conclude allocation is invisible. The mentor's move is to write the same code *with* a field store and re-run the benchmark together. The `0.0 → 16.0 B/op` jump is more instructive than any explanation.

**Stage 2 — "EA's win is fragile."** A Middle engineer who has read about EA often assumes "records will always scalar-replace". The mentor's move is to show a series of refactors of the *same* method, each of which silently defeats EA: introduce a field, introduce a return, add a `synchronized` outside the NoEscape scope, replace a `final` class with a non-final one. Each step demonstrates that EA's success is a property of the *whole* code shape, not the *type*.

The third-stage lesson — "design for short-lived objects" — comes naturally once the first two stages stick.

---

## 5. Refactor patterns to help EA succeed

When you find a hot path that allocates and shouldn't, the toolbox you reach for:

**Replace field-of-object with field-of-scalars.**

```java
// Before — escapes via field
private Point last;
void process(double x, double y) { last = new Point(x, y); use(last); }

// After — EA-friendly
private double lastX, lastY;
void process(double x, double y) {
    Point p = new Point(x, y);                 // local — NoEscape
    lastX = p.x(); lastY = p.y();
    use(p);
}
```

**Push the allocation past the polymorphic call.** If a method receives an interface and the call inside is megamorphic, EA can't see through it. Push the allocation to *after* the call:

```java
// Before — Point allocated, passed across megamorphic call
Point p = new Point(x, y);
handler.handle(p);                              // handler is megamorphic — EA fails

// After — handler receives the scalars; if it needs the object, it constructs it itself
handler.handle(x, y);
```

**Inline the helper.** A 40-line helper method holding the Point in a parameter is over the inlining budget. If the call is the hot path, inline the body and let EA see through.

**Use records instead of small POJOs.** Records are `final`, immutable, and constructed with one bytecode. EA likes them.

**Avoid premature stream APIs.** A `List<Point>.stream().map(...).filter(...).toList()` pipeline allocates a `Spliterator`, several `Sink` instances, and intermediate boxes. For a 10-element list, the overhead dwarfs the work. Use a `for` loop on the hot path; reserve streams for readability where the allocation cost is negligible.

---

## 6. Design discipline

The design choices that keep EA on your side, across many engineers' commits:

- **Small records over POJOs for value carriers.** A record is one line and removes accidental escape vectors (no setters, no subclassing, no `clone`).
- **`final` on every concrete class that isn't designed for extension.** Removes a class of CHA fragility.
- **No mutable static fields touched on the hot path.** Even a `final` field of mutable type can be an escape sink.
- **Avoid `synchronized` on objects that should be local.** Lock elision usually saves you, but only when EA succeeds first. If EA fails, the lock becomes real.
- **Prefer composition over inheritance for value-carrying types.** Inheritance forces non-final, which weakens EA reasoning.
- **No `Optional`-of-`Optional` chains in hot paths.** Each level allocates if EA fails. Use sentinel values or direct null-checks inside performance-critical code.

None of these are absolute. A small record in a CRUD path can also be a class, and the EA difference doesn't matter. The discipline applies to *hot paths*, identified by profiling, not to every line.

---

## 7. Team policy — hot-path benchmarks

For modules with measurable performance budgets, a useful team policy:

- **Identify the hot paths.** Production profiling (async-profiler) over a representative period. Mark the top 5–10 methods as "hot" in code comments.
- **Each hot method has a JMH benchmark in the repo.** The benchmark runs in CI with `-prof gc` and asserts `0.0 B/op` (or whatever budget you set: 16 B/op for known-escape returns, etc.).
- **CI fails on regression.** A PR that changes `0.0 → 16.0 B/op` on a hot benchmark must justify it or fix it before merging. This is the only way to keep allocation-free properties as a codebase evolves.
- **Review checklist references EA.** A PR template line: "If this changes a hot path, attach the JMH output."

The cost of the policy is real: writing a JMH benchmark per hot method, maintaining them across refactors, dealing with CI flakiness on shared runners. The payoff is that allocation regressions are caught at PR time, not in production six months later when nobody remembers why the original code was structured that way.

---

## 8. When EA is the wrong optimisation target

Worth saying explicitly: most code doesn't need EA wins. A method that runs 100 times a day allocates 10 KB total — the allocator handles it without measurable cost. EA is the right target when:

- The method runs at high frequency (≥ 1 000 calls/sec).
- The allocation rate is visible in GC pressure (you can see the difference in `gc.alloc.rate`).
- The downstream cost (GC pause time, cache misses from heap traffic) is on your SLA path.

If none of those are true, optimise for readability. A `record` plus a `Stream.map` is fine even if it allocates a few intermediate objects. The cost of mis-prioritising EA is a codebase optimised for the wrong thing: complex local-scalar refactors in code that runs once a day.

---

## 9. Quick rules

- [ ] No "allocation-free" claim without `-prof gc` or `PrintEliminateAllocations` evidence in the PR.
- [ ] Hot paths have JMH benchmarks asserting `0.0 B/op` (or budget); CI runs them.
- [ ] Monitor `gc.alloc.rate` in production — sudden jumps indicate deopt or new hot allocations.
- [ ] Mentoring sequence: allocation is not free → EA's win is fragile → design for short-lived objects.
- [ ] Refactor patterns: field-of-scalars, push allocation past polymorphic call, inline the helper.
- [ ] Final + records + no captures = EA-friendly value carriers.
- [ ] Don't apply EA discipline to cold paths. Profile first.

---

## 10. What's next

| Topic                                                                | File                |
| -------------------------------------------------------------------- | ------------------- |
| HotSpot source pointers, JEPs, Valhalla                              | `specification.md`  |
| 10 silent-failure case studies                                       | `find-bug.md`       |
| Records + EA pipelines, Graal PEA, Valhalla                          | `optimize.md`       |
| Hands-on exercises                                                   | `tasks.md`          |
| 20 interview Q&A                                                     | `interview.md`      |

See also: [../../03-design-principles/](../../03-design-principles/) for the design discipline (SRP, small records, final-by-default) that makes EA possible, and [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/) for why immutability serves both correctness and EA simultaneously.

---

**Memorize this:** at this level, EA is a *team property* preserved by discipline: code-review vocabulary, JMH benchmarks in CI, allocation profiling in production, and design rules that prevent accidental escape. The hardest part isn't winning EA once — it's keeping it across two years of commits from twelve engineers.
