# Designing for Extension & Polymorphism — Optimize

> For a design topic, "optimize" means **make extension cheaper and reasoning safer** — reduce the cost of adding the next variant — *without* paying a runtime penalty for the abstraction. We measure both: change-cost (files/feature) for design quality, and JMH/`javap` for dispatch cost. The thesis: a well-placed seam costs *near-zero* at runtime, so the only real optimization question is whether the seam is on the right axis.

---

## 1. The two things we measure

| Goal | Metric | Tool |
| --- | --- | --- |
| Cheaper extension (design) | files-touched & lines-changed per new variant | git history, `code-maat` |
| Right-axis seam | does adding a variant touch **one new file, zero existing**? | manual / git diff |
| No runtime tax | ns/op of polymorphic vs conditional dispatch | JMH |
| Dispatch shape | mono/bi/megamorphic call site | `javap -c`, `-XX:+PrintInlining` |

A seam that fails the *first two* is a bad seam regardless of speed. A seam that passes them and is fast is the goal.

---

## 2. Before/after: conditional explosion → polymorphism

**Before** — every new shipping option re-opens one method; cyclomatic complexity climbs by 1–2 each release:

```java
Money cost(Order o) {
    switch (o.method()) {
        case STANDARD: return base(o);
        case EXPRESS:  return base(o).times(2);
        case OVERNIGHT:return base(o).times(3).plus(Money.of(10));
        case FREIGHT:  return freightTable(o);
        // ...adding INTERNATIONAL edits this method again
    }
}
```

Change-cost of adding `INTERNATIONAL`: edit `cost` (risk to 4 working cases) + likely edit the parallel `estimatedDays(method)` switch + the `label(method)` switch. **~3 existing files touched.**

**After** — one `ShippingRule` per option:

```java
interface ShippingRule { Money cost(Order o); int days(Order o); String label(); }
```

Change-cost of adding `InternationalShipping`: **1 new file, 0 existing** (plus one line in the composition root's registry, or zero with `ServiceLoader`). The three parallel switches collapse into the one new class — `cost`, `days`, `label` for the new option live together and can't drift.

| | Before | After |
| --- | --- | --- |
| Files touched per new option | ~3 existing | 1 new, 0 existing |
| CC of `cost` | grows +1–2/release | flat (1) |
| Risk to existing options | high (shared method) | none (isolated class) |

That's the design optimization: the *marginal cost of the next variant* drops from "edit and re-test N methods" to "write one class".

---

## 3. Does the abstraction cost anything at runtime? (JMH)

The fear: replacing a `switch` with a virtual call slows the hot path. Measure it.

```java
@State(Scope.Thread)
public class DispatchBench {
    Shape[] shapes;                       // mix controls monomorphism
    @Param({"1","2","8"}) int kinds;      // distinct receiver types observed

    @Benchmark public double polymorphic() {       // shape.area()
        double sum = 0; for (Shape s : shapes) sum += s.area(); return sum;
    }
    @Benchmark public double switched() {          // switch on a tag
        double sum = 0; for (Shape s : shapes) sum += areaSwitch(s); return sum;
    }
}
```

Representative HotSpot results (your numbers will vary; the *shape* is the lesson):

| Receiver types at site | `polymorphic()` | `switched()` | Note |
| --- | --- | --- | --- |
| 1 (monomorphic) | ~baseline | ~baseline | both inlined to direct calls — *equal* |
| 2 (bimorphic) | ~baseline +small | ~baseline | inline cache, both still cheap |
| 8 (megamorphic) | noticeably slower | ~baseline | vtable/itable lookup, inlining blocked |

**Takeaways:**

- For **monomorphic and bimorphic** sites — the overwhelming majority of real seams in any given execution path — polymorphism is *the same speed* as a switch after JIT inlining. The abstraction is free.
- Only at **megamorphic** sites (3+ hot types) does virtual dispatch cost measurably more. And that's a property of the *call site*, not the number of implementations: a hierarchy with 50 classes is free at a site that only sees one.

So: choose the seam for design reasons; it won't cost you on the hot path unless the site is genuinely megamorphic.

---

## 4. Confirming the dispatch shape with `javap` and `-XX:+PrintInlining`

```bash
javac Shapes.java
javap -c -p Shapes        # see invokeinterface/invokevirtual at the call site
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining Bench   # did it inline?
```

What you'll see at a monomorphic `s.area()`:
- `invokeinterface Shape.area` in bytecode, but
- `PrintInlining` reports it *inlined* (CHA proved one target) — so no virtual dispatch executes.

At a megamorphic site, `PrintInlining` reports `not inlined (too many receiver types)` — the diagnosis that you have a real megamorphic hot site.

---

## 5. Optimizing a genuinely megamorphic hot site (without killing the seam)

If profiling shows a real megamorphic bottleneck — say `Channel.send` over 40 providers in a tight loop — the fix is to **reduce receiver types at the site**, never to delete the abstraction:

- **Partition the loop** so each inner loop sees one provider type (group messages by channel first). Each inner site becomes monomorphic.
- **Cache the resolved provider** per message kind so the dispatch happens once, not per element.
- **Bimorphic fast-path** for the two dominant types, slow path for the tail.
- **Batch at the interface** — `sendAll(List<Message>)` so one `invokeinterface` covers many messages.

Each keeps the open `Channel` seam (the design win) while restoring monomorphic dispatch (the perf win). Abandoning the seam would trade a localized, fixable perf issue for a global rigidity regression.

---

## 6. Optimizing the operation axis: sealed + switch vs visitor

When *operations* grow (per the Expression Problem), the cheap-to-extend design is a **sealed type + exhaustive `switch`**, and it's also fast:

- A pattern `switch` over a sealed type compiles (Java 21) to `invokedynamic` against `SwitchBootstraps.typeSwitch` — an indy call site the JIT optimizes well, typically a small dispatch table.
- The old **Visitor** pattern achieved the same operation-axis extensibility but with double-dispatch (`accept(visitor)` → `visit(this)`): two `invokevirtual`s, more allocation, more boilerplate.

**Optimization:** replace Visitor with sealed + exhaustive switch where you control the type hierarchy. You lose nothing in extensibility (operations still cheap to add), gain exhaustiveness checking, and shed the double-dispatch overhead and the accept/visit ceremony.

```java
// Before: Visitor — double dispatch, every new op = new Visitor + accept plumbing
// After:  one switch per operation, compiler-checked, single dispatch
int eval(Expr e) {
    return switch (e) {
        case Lit l  -> l.value();
        case Add a  -> eval(a.l()) + eval(a.r());
        case Mul m  -> eval(m.l()) * eval(m.r());
    };
}
```

---

## 7. Allocation: don't pay per-call for strategy objects

A subtle perf trap in extension design: creating a fresh strategy/lambda *per call* in a hot loop.

```java
// BAD: allocates a Comparator every iteration
for (var batch : batches)
    batch.sort((a, b) -> a.priority() - b.priority());   // new lambda capture each time?
```

Stateless lambdas that capture nothing are cached by the JVM (one instance), so the above is usually fine — but a *capturing* lambda allocates per creation. Optimization:

- Hoist stateless strategies to `static final` constants (`Comparator.comparingInt(Item::priority)`).
- Inject the strategy once (composition root) rather than building it inside the loop.
- A captured strategy in a hot path → make it a named field assigned once.

The seam stays; you just stop re-allocating it. Net: extension flexibility with zero steady-state allocation.

---

## 8. Measuring whether a seam earned its keep

After a quarter, validate the seam with data, not vibes:

- **NOC (number of children/implementations).** Seam interface still at NOC=1? It was speculative — inline it; you paid indirection for nothing. NOC growing = real variation, seam justified. See [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/).
- **files/feature trend** for the seam's feature kind: flat-at-one = the seam works; rising = wrong axis (you're editing callers anyway) — revisit the Expression-Problem decision in `senior.md` §2.
- **Change coupling:** if the "closed" caller changes every time a variant is added (git temporal coupling), the seam leaks — tighten the contract.

---

## 9. Optimization checklist

- [ ] Measure design cost: a new variant should touch **one new file, zero existing**. If not, the seam is wrong-axis or leaking.
- [ ] Don't fear virtual dispatch: monomorphic/bimorphic sites inline to direct calls (verify with `PrintInlining`).
- [ ] Only optimize *proven* megamorphic hot sites — by reducing receiver types, not by deleting the seam.
- [ ] Operations grow → sealed + exhaustive `switch`; prefer it over Visitor (no double-dispatch, compiler-checked).
- [ ] Hoist stateless strategies to `static final`; inject once, don't allocate per call.
- [ ] Audit seams quarterly via NOC and files/feature; kill speculative seams (NOC stuck at 1).

---

## 10. What's next

| Topic | File |
| --- | --- |
| The judgement behind axis choice and stable abstractions | `senior.md` |
| Review vocabulary, ArchUnit, change-cost tooling | `professional.md` |
| OCP/PV/Bloch/GoF/JLS sources | `specification.md` |
| Hands-on extensible-API exercises (incl. `javap`/JMH) | `tasks.md` |

---

**Memorize this:** the design optimization is dropping the marginal cost of the next variant to "one new file" — measure it with files/feature and NOC. The runtime cost of polymorphism is *zero* at monomorphic/bimorphic sites (JIT inlines them) and only real at proven megamorphic hot sites, which you fix by reducing receiver types, not by deleting the seam. When operations grow, sealed + exhaustive `switch` beats Visitor on both extensibility and speed.
