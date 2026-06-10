# Escape Analysis and Scalar Replacement — Specification Reading Guide

> Escape analysis is *not* part of the Java Language Specification or the Java Virtual Machine Specification. There is no `§EscapeAnalysis` chapter. EA is a JIT-level optimization, defined by the implementations that perform it — HotSpot's C2 and GraalVM. This file maps the optimization to the source code that implements it, the JEPs that *change the language* to make EA stronger or unnecessary (most notably Valhalla), and the related JEPs on value-based classes and immutability that EA leans on.

---

## 1. Where EA does *not* live

Worth being explicit: the JLS and JVMS describe the *semantics* of the language and the *behaviour* of the virtual machine. They do not mandate or even mention any specific optimization technique. The relevant text is the negative space:

- **JLS §17 (Threads and Locks)** defines the *happens-before* memory model. Anything that observably violates it is forbidden. EA must respect this — it can eliminate an allocation only if doing so cannot be detected by another thread.
- **JVMS §2.5.3 (Heap)** says: "The heap is the run-time data area from which memory for all class instances and arrays is allocated." It does not say *every* `new` must reach the heap — only that the heap is where instances would be allocated if needed. This is the loophole EA lives in.
- **JLS §15.9.4 (Run-Time Evaluation of Class Instance Creation Expressions)** describes what `new T(...)` must accomplish *observably*. As long as the observable result is the same, an implementation may decide not to allocate.

EA is allowed by the *omission* of any requirement that `new` reach the heap. It is not described positively anywhere normative.

---

## 2. HotSpot source pointers

For anyone reading the HotSpot source, the EA implementation is concentrated in:

| File                                          | What lives there                                                     |
|-----------------------------------------------|----------------------------------------------------------------------|
| `src/hotspot/share/opto/escape.hpp/.cpp`      | The main escape analysis pass — `ConnectionGraph` construction, fixed-point resolution, classification into NoEscape / ArgEscape / GlobalEscape. |
| `src/hotspot/share/opto/macro.cpp`            | `PhaseMacroExpand::scalar_replacement` — the pass that actually rewrites a NoEscape `AllocateNode` into scalar SSA values. |
| `src/hotspot/share/opto/c2compiler.cpp`       | `C2Compiler::do_escape_analysis()` — the entry point that decides whether to run EA for a given compilation. |
| `src/hotspot/share/opto/locknode.cpp`         | Lock elimination based on EA's classification of the monitor's target object. |
| `src/hotspot/share/opto/compile.cpp`          | The compilation pipeline — shows where EA fits between earlier optimisations and macro expansion. |

Reading order, if you want to trace one allocation through:

1. `C2Compiler::do_escape_analysis()` — guarded by `-XX:+DoEscapeAnalysis`. Decides whether to bother for this compilation unit.
2. `ConnectionGraph::do_analysis()` in `escape.cpp` — builds the points-to graph, propagates escape states until fixed point.
3. `PhaseMacroExpand::eliminate_allocate_node()` and `scalar_replacement()` in `macro.cpp` — does the actual rewrite.
4. `EliminateLocksAndScalarReplaceableObjects()` paths — fold lock elimination into the same pass.

The textual log produced by `-XX:+PrintEscapeAnalysis` and `-XX:+PrintEliminateAllocations` comes from `escape.cpp`'s `print_statistics()` and a few inline `tty->print_cr(...)` calls in `macro.cpp`.

---

## 3. The JEP-less nature of EA

EA has no JEP. There is no `JEP-EscapeAnalysis-1.0`. The optimization was added to HotSpot in JDK 6 (around 2008), enabled by default, and has been incrementally improved across every JDK version since. The absence of a JEP is meaningful: EA is treated by the JVM team as a *quality-of-implementation* matter, not a *language feature*. The compiler is free to add or remove EA passes, change the heuristics, or implement entirely different mechanisms (Graal's PEA, Valhalla's value types) without going through the JEP process.

This has a practical consequence: the strength of EA on your code can vary between minor JDK versions. JDK 17 may eliminate an allocation that JDK 11 didn't. Production benchmarks should be re-run on every JDK upgrade, especially for code that depends on EA wins.

---

## 4. JEPs that *do* matter — Valhalla and value classes

The JEP track that *will* change EA's relevance is Project Valhalla. The core idea: introduce *value classes* that the JVM treats as flat aggregates by default, with no identity, no header, no pointer indirection. For value classes, EA stops being an optimization and starts being a *contract*.

- **JEP 401 — Value Classes and Objects (Preview)** — the current Valhalla preview, target preview in a recent JDK. Declares a class with `value class Point { int x; int y; }`. Instances have no identity (`==` compares fields, `System.identityHashCode` is undefined). The VM is free to lay them out flat: in a register, in a field of another value class, as a contiguous element of an array. No heap allocation is required; no EA is required.
- **JEP 169 — Value-Based Classes** (informational, JDK 8) — the precursor. Marks classes like `Optional`, `LocalDate`, `Instant` as *value-based*: callers should not rely on identity (`==`, synchronisation), should treat them as immutable carriers. The annotation `@jdk.internal.ValueBased` exists in modern JDKs. Value-based classes are EA's most fertile ground because the contract already forbids the constructs that defeat EA (synchronisation, identity-sensitive operations).
- **JEP 192 — Null-Restricted Value Class Types** (Preview, future) — the second half of Valhalla: declare a field or parameter as `Point!` (non-null value), allowing the VM to flatten the layout completely with no null check.

When Valhalla ships, the rough mental model is: today you write a `record` and *hope* EA succeeds; tomorrow you write a `value class` and the VM *guarantees* a flat layout. The optimization moves from compile-time heuristic to spec-level contract.

---

## 5. Related JEPs

| JEP   | Title                                                  | Why it matters for EA                                 |
|-------|--------------------------------------------------------|-------------------------------------------------------|
| 169   | Value-Based Classes (informational)                    | Defines the *should not have identity* contract that EA's NoEscape proof relies on. |
| 192   | Null-Restricted Value Class Types (preview, Valhalla)  | Allows non-null value fields; removes the null check that prevents some flat layouts. |
| 401   | Value Classes and Objects (preview, Valhalla)          | The headline Valhalla JEP — value classes with flat layout. |
| 218   | Generics over Primitive Types (also Valhalla track)    | Enables `List<int>` semantics — eliminates boxing, which is one of the most expensive escape vectors. |
| 395   | Records (final, JDK 16)                                | Records are *not* value classes, but they share enough properties (final, immutable, equal-by-fields) that EA succeeds on them readily. |

JEP 395 (records) is the *available today* version of Valhalla's eventual contract. A record cannot be a value class until JEP 401 ships, but until then it is the cleanest signal to both the reader and the JIT that the type is a value carrier and should be EA-friendly.

---

## 6. What the spec *does* mandate that EA must respect

Even though EA isn't in the spec, the JVMS imposes a few obligations that EA implementations must honour:

- **Object identity (`==`)** must be preserved for any object whose identity is observable. If `a` and `b` both refer to an allocation, then `a == b` must be true. EA may eliminate the allocation only when no `==` comparison of the reference is observable.
- **`System.identityHashCode(obj)`** must return a consistent value if called. EA may eliminate the allocation only if `identityHashCode` is not called on it.
- **Synchronization semantics** must be preserved. EA may eliminate a lock only if it can prove the object is thread-local (NoEscape).
- **Finalization** must run if the class has a non-trivial finaliser. EA conservatively skips any class with a custom `finalize()`. (Finalisers are deprecated in modern Java but the JVM still honours them where present.)

These constraints are why EA must analyse the *full* use of the reference, not just whether it leaves the method. A NoEscape object whose identityHashCode is called inside the method cannot be eliminated — the eliminated form has no identity to hash.

---

## 7. Reading the JIT log against the spec

When `-XX:+PrintEscapeAnalysis` prints `GlobalEscape` for an allocation, the spec-shaped question is: *what observable behaviour prevented elimination?* The common answers map to spec constructs:

- `escapes(GlobalEscape) via field`  — the reference is written to a heap-reachable field; observable through that field per JLS §17 happens-before.
- `escapes(GlobalEscape) via return` — the reference flows out of the method; observable to the caller.
- `escapes(GlobalEscape) via JNI/native call` — the reference is passed to native code; spec-level requires the object to be live during the native call.
- `escapes(GlobalEscape) via synchronization` — `synchronized(obj)` requires a monitor, which requires identity, which requires the heap. (Lock elision overrides this when NoEscape is proved first.)

Each "escape reason" corresponds to a spec obligation the JIT can't violate. EA isn't fighting the spec — it's finding the cases where the spec permits elimination because no obligation applies.

---

## 8. Quick rules

- [ ] EA is not in the JLS or JVMS — no JEP, no normative text. It is an implementation matter.
- [ ] The spec permits EA by *omission*: nothing forces `new` to reach the heap if the observable behaviour is preserved.
- [ ] HotSpot's EA lives in `share/opto/escape.cpp` and `share/opto/macro.cpp`.
- [ ] `C2Compiler::do_escape_analysis()` is the entry point; `-XX:+DoEscapeAnalysis` (default on) gates it.
- [ ] JEP 401 (Valhalla value classes) will replace EA's heuristic with a layout *contract*.
- [ ] JEP 169 (value-based classes) defines the identity-free contract EA exploits.
- [ ] Records (JEP 395) are the value-class precursor — EA-friendly today, not yet value-typed.
- [ ] EA must respect identity (`==`), `identityHashCode`, synchronization, and finalization.

---

## 9. What's next

| Topic                                                                | File                |
| -------------------------------------------------------------------- | ------------------- |
| 10 silent-failure case studies                                       | `find-bug.md`       |
| Records + EA pipelines, Graal PEA, Valhalla future                   | `optimize.md`       |
| Hands-on JMH exercises                                               | `tasks.md`          |
| 20 interview Q&A                                                     | `interview.md`      |

See also: [../04-object-memory-layout/](../04-object-memory-layout/) for the actual byte layout EA chooses not to create, and [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) for the inlining-and-CHA machinery EA depends on.

---

**Memorize this:** EA is not in the spec; it is an optimization permitted by the spec's omissions. The HotSpot implementation lives in `share/opto/escape.cpp` and `share/opto/macro.cpp`. The future direction is Valhalla (JEP 401) — value classes with flat layout as a *contract* rather than an optimization. Today's records (JEP 395) and value-based classes (JEP 169) are the bridge: EA-friendly today, value-typed tomorrow.
