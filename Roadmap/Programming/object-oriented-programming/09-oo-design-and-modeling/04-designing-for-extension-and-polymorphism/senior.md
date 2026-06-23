# Designing for Extension & Polymorphism — Senior

> **What?** The deep judgement: how to make an abstraction *stable* enough to be worth depending on, how variance and the Expression Problem decide between polymorphism and pattern matching, how to *evolve* an extension point without breaking implementers, and the failure modes — premature seams, leaky abstractions, fragile base classes, and sealing the wrong axis.
> **How?** Treat every published abstraction as a frozen contract, predict the *axis* of change before adding a seam, and pay the evolution tax knowingly — because a seam is a promise you can't cheaply retract.

---

## 1. The real cost model of an extension point

A seam is not free. Each one buys flexibility on one axis and charges on others:

| You gain | You pay |
| --- | --- |
| New variants without editing callers | An indirection (one more interface to read) |
| Isolated, mockable units | A wider API surface that must stay stable |
| Runtime/config-time substitution | Harder *whole-program* reasoning (what runs here?) |
| Open/Closed on the chosen axis | **Closed** on every *other* axis — see §2 |

The senior mistake is not "too few seams"; it's seams on the **wrong axis**, added before the axis of change was known. A seam predicts the future. Predict wrong and you've added cost with no payoff — and worse, you've *frozen the wrong thing*, because the interface you committed to now resists the change that actually arrived.

---

## 2. Every abstraction is closed on the axes it didn't choose — the Expression Problem

A class hierarchy and a `switch` are duals. This is the **Expression Problem** (Wadler), and it governs the polymorphism-vs-conditional choice at the deepest level.

You have two axes of growth: **new types** (Circle, Square, …) and **new operations** (area, render, serialize, …).

```
                     Add a new TYPE        Add a new OPERATION
Polymorphism         cheap (new class)     EXPENSIVE (edit every class)
(behaviour in type)
Sealed + switch      EXPENSIVE (edit       cheap (new switch, one place)
(behaviour outside)   every switch)
```

- **Open polymorphism** (plain interface, behaviour inside each type): adding a *type* is free; adding an *operation* means touching every implementation — and if the hierarchy is open, you *can't* touch implementations you don't own.
- **Sealed + exhaustive switch** (behaviour outside, in switches): adding an *operation* is free; adding a *type* breaks every switch — but the compiler tells you exactly where.

There is no design that makes both axes cheap in plain Java. So the question "polymorphism or conditional?" reduces to: **which axis do I expect to grow?** Types grow → polymorphism. Operations grow → sealed + switch. Pick the cheap axis for the change you actually expect. Getting this wrong is the most expensive design error in this topic, because it's the hardest to reverse.

---

## 3. Stable abstractions: what makes an interface worth depending on

The Dependency Inversion Principle says depend on abstractions. It's only true if the abstraction is *more stable than* the concretions behind it. An unstable abstraction is worse than no abstraction — it spreads its churn to every implementer and caller. Properties of a stable seam:

1. **Minimal surface.** Every method is a commitment. `Comparator<T>` is bulletproof because it commits to almost nothing — one logical operation. Add `reversed()`/`thenComparing()` as `default` methods *built on* the core, not new core obligations.
2. **Phrased in invariants, not implementations.** `ShippingRule.cost(Order)` is stable because "an order has a cost" is a domain truth. `cost(Order, TaxTableV2, boolean useLegacyRounding)` leaks the *current implementation* into the contract — it will change when the implementation does.
3. **No implementation-shaped parameters or returns.** If your interface returns a `GzipOutputStream`, you've leaked the implementation (a *leaky abstraction*). Return `OutputStream`.
4. **Total, not partial.** A method an implementer must throw `UnsupportedOperationException` from is a contract that doesn't fit its implementers — split the interface (Interface Segregation). `List` is partially leaky for this reason (immutable lists throw on `add`).

A practical stability test: *can a brand-new implementer satisfy this interface using only the words in the domain, without reading the original implementation?* If they must mimic internal behaviour to be "correct", the abstraction leaks.

---

## 4. Evolving a published seam without breaking implementers

Once code outside your control implements your interface, *adding a method is a breaking change*: every existing implementer fails to compile (and, across a binary boundary, throws `AbstractMethodError`). Senior extension design is mostly about *how the seam grows*. Options, best to worst:

**`default` methods.** Add the method with a sensible default body. Existing implementers keep working; new ones can override. This is the primary evolution tool since Java 8.

```java
public interface PaymentGateway {
    PaymentResult charge(Money amount, Card card);
    default PaymentResult refund(PaymentId id, Money amount) {       // added in v2
        throw new UnsupportedOperationException("refund not supported");
    }
    default boolean supportsRefund() { return false; }              // capability flag
}
```

But a `default` that throws is a *partial* contract — see §3.4. Prefer a default that's a *real, safe behaviour* (no-op, identity, conservative answer) over one that throws.

**Capability sub-interfaces.** Instead of forcing every gateway to refund, add `interface Refundable`. Callers `instanceof`-check. The base seam stays minimal; the capability is opt-in.

```java
if (gateway instanceof Refundable r) r.refund(id, amount);
```

**Versioned SPI.** `PaymentGatewayV2 extends PaymentGateway`. Old providers keep implementing V1; the loader prefers V2 when present. Heavyweight, but the only fully clean option across a hard binary boundary (the JDK uses this pattern).

**Abstract base provided alongside the interface.** Ship `AbstractPaymentGateway` implementing the interface with sane defaults. New interface methods go on the interface as `default`, but providers extending the base get richer help. (Bloch Item 20: "prefer interfaces to abstract classes" — but providing *both* gives implementers a choice.)

The asymmetry to internalize: **callers** of an interface are cheap to keep happy (adding methods doesn't break them); **implementers** are expensive (adding methods breaks them). The more an interface is *implemented* by outsiders, the more conservatively it must evolve.

---

## 5. Designing-for-inheritance, rigorously (Bloch Item 19)

If a seam uses subclassing (Template Method, framework base classes), the base class's *self-use pattern* is part of its public contract — not an implementation detail. The full obligations:

1. **Document self-use precisely.** "`handle()` calls `validate()` then `process()`; overriding `validate()` to throw will abort before `process()`." Bloch's `@implSpec`-style "Implementation Requirements" in Javadoc exist for exactly this. Without it, a subclasser cannot override safely, and you cannot change the self-use without silently breaking subclasses.
2. **Constructors must not call overridable methods.** The override runs against a half-built subclass. Demoted to a crash-waiting rule because it's so common:

```java
abstract class Base {
    Base() { init(); }                  // BUG: virtual call in constructor
    protected abstract void init();
}
class Sub extends Base {
    private final List<String> log = new ArrayList<>();
    Sub() { super(); }                  // super() runs init() BEFORE log is assigned
    protected void init() { log.add("x"); }   // NullPointerException
}
```

3. **`clone` and `readObject` are honorary constructors** — same rule: no overridable calls.
4. **Choose `protected` members minimally and commit to them.** Each `protected` method/field is exposed forever. Test by writing 2–3 subclasses *yourself* before publishing — if you can't subclass it usefully, neither can anyone else.
5. **Otherwise, `final`.** The default. "Design and document for inheritance, *or else prohibit it*" — there is no third "leave it open and hope" option that's responsible.

This is the discipline that prevents the **fragile base class problem** ([../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/)) from being *your* class.

---

## 6. Sealing: closing extension as a positive design act

`sealed` is the inverse of an extension point — and that makes it a design tool, not a restriction. Reasons to *close* a hierarchy:

- **Exhaustiveness.** The compiler proves every `switch` handles every case; adding a variant produces a compile error at every switch (a free, exact migration checklist). Impossible with open hierarchies.
- **Reasoning.** A reader of `sealed interface Result permits Ok, Err` knows the *complete* set of outcomes. Open hierarchies force defensive `default` branches that hide bugs.
- **Safe operation-axis growth.** Per §2, sealing makes adding operations cheap and safe — the right trade when *operations* grow faster than *types*.

The senior error is **sealing the wrong axis**. Seal a `PaymentMethod` domain model (complete, you own all variants) — good. Seal a *plugin point* (`Channel`, `Codec`) that third parties must extend — catastrophic, because `sealed` *forbids* the extension that is the whole point. Ask: "do I want this set to be complete and known, or open to strangers?" Sealed answers the first; a plain interface the second. Permitted subtypes also must co-locate (same module/package), which is itself a coupling decision.

`non-sealed` is the escape hatch: a permitted subtype can re-open its own branch, giving you "closed at the top, open in one place" — useful for a small known core plus a controlled extension wing.

---

## 7. Dispatch internals — does polymorphism cost anything?

A pragmatic worry: "polymorphism means virtual calls; switches are just branches." Reality, per HotSpot:

- A **monomorphic** call site (one receiver type ever observed) is inlined to a direct call after the JIT profiles it — *zero* virtual-dispatch cost. Most well-factored seams are monomorphic in any given execution path.
- A **bimorphic** site (two types) is handled with an inline-cache type guard + two inlined bodies — still very cheap.
- A **megamorphic** site (3+ types, e.g. a hot `Channel.send` over many providers) falls back to a real vtable/itable lookup and *blocks inlining* — the only case where dispatch is measurably costly.

So the dispatch cost of polymorphism is *path-dependent*, not type-count-dependent: a hierarchy with 50 implementations is free at a call site that only ever sees one. A `switch` over a sealed type compiles to a `tableswitch`/`lookupswitch` or a chain of `instanceof` (with `invokedynamic`-backed pattern dispatch in recent Java) — also cheap, also not the bottleneck. **Decide polymorphism-vs-switch on the Expression-Problem axis (§2), not on imagined dispatch cost.** Only optimize a *proven* megamorphic hot site, and then by reducing the receiver types at that site, not by abandoning the seam. Measurements in [`optimize.md`](optimize.md). See also [../../02-more-about-oop/11-static-vs-dynamic-binding/](../../02-more-about-oop/11-static-vs-dynamic-binding/).

---

## 8. Protected Variations — the principle under all of this

GRASP's **Protected Variations** (Larman) generalizes Open/Closed: *identify points of predicted variation or instability and create a stable interface around them.* It subsumes nearly every pattern in this topic — Strategy, Adapter, Facade, polymorphism, and even data-driven designs (config, rules engines) are all PV with different mechanisms.

The operative word is **predicted**. PV does *not* say "wrap everything." It says wrap the points you have *evidence* will vary: a second implementation exists or is on the roadmap, a vendor boundary, a regulatory rule that changes annually, an algorithm under active research. Speculative seams ("might need it") violate YAGNI and usually guess the axis wrong (§2).

A useful framing: **the cost of a variation point is paid now; the benefit is paid out only if the predicted variation occurs.** Add the seam when the *expected* benefit (probability × saved future cost) exceeds the *certain* cost (indirection + frozen surface). Two implementations today is near-certain benefit; "could imagine a second" rarely is. See [../01-grasp-responsibility-assignment/](../01-grasp-responsibility-assignment/).

---

## 9. Leaky abstractions — how seams betray their purpose

A seam fails silently when the abstraction *leaks* the implementation it was supposed to hide. Symptoms a senior reviewer catches:

- **Type leaks.** Interface mentions `GzipOutputStream`, `PreparedStatement`, `KafkaRecord`. The "abstraction" is welded to one implementation.
- **Behavioural leaks.** The contract is under-specified, so implementers mimic the original's *quirks* (ordering, null-handling, exception type) to be "correct". Now the quirk is the de-facto contract — change it and implementers break. (`HashMap` iteration order leaking into tests is the canonical example.)
- **Lifecycle leaks.** The interface assumes a connection is open, a transaction is active, threads are pinned — knowledge only the original implementation had.
- **Capability mismatch.** Half the implementers throw `UnsupportedOperationException`. The interface is too wide for its implementers (Interface Segregation violation).

The fix is always: tighten the *contract* (document the invariants so implementers needn't read the source) and narrow the *surface* (remove what not every implementer can honor). A seam is only as good as the precision of its contract.

---

## 10. Judgement summary — the senior decision tree

```
Is there evidence of real variation (2nd impl exists / on roadmap / vendor boundary)?
  No  → no seam yet. Keep the conditional / single class. (YAGNI)
  Yes → Which axis grows?
        Types grow  → polymorphism (open interface or sealed if set is complete)
        Operations grow → sealed type + exhaustive switch (behaviour outside)
        Both / unsure → favor the one with more evidence; sealed keeps switch-side safe

Will outsiders extend it?
  Yes → SPI: minimal surface, evolve via default/capability-interface/versioning, NEVER sealed
  No, but I want a known complete set → sealed
  No, internal reuse only → Strategy (compose) or, if fixed skeleton, Template Method

If subclassing is allowed:
  document self-use, no overridable calls in constructors, minimal protected hooks
  else → final
```

---

## 11. Quick rules

- [ ] A seam predicts an *axis* of change; predict before you build. Types grow → polymorphism; operations grow → sealed + switch.
- [ ] Stable abstraction = minimal surface, domain-phrased, no implementation types, total contract.
- [ ] Adding a method breaks implementers, not callers — evolve SPIs via `default`/capability interfaces/versioning.
- [ ] Designed-for-inheritance = documented self-use + no constructor callbacks + minimal `protected` + tested by subclassing. Else `final`.
- [ ] Seal complete known sets; never seal a plugin point.
- [ ] Don't fear virtual dispatch — monomorphic/bimorphic sites are inlined. Only megamorphic hot sites cost.
- [ ] A leaky contract is worse than no seam: tighten the spec, narrow the surface.

---

## 12. What's next

| Topic | File |
| --- | --- |
| Review vocabulary, ArchUnit, change-cost metrics, refactoring playbook | `professional.md` |
| OCP/PV/Bloch/GoF/JLS canonical sources | `specification.md` |
| Rigid-switch, leaky-abstraction, unsafe-subclass bugs | `find-bug.md` |
| Measuring conditional explosion and change-cost | `optimize.md` |

---

**Memorize this:** an extension point predicts an *axis* of change and freezes a contract — so add it only with evidence (Protected Variations, not speculation), pick polymorphism when *types* grow and sealed-plus-switch when *operations* grow (the Expression Problem), keep the abstraction minimal and domain-phrased so it stays stable, evolve published seams with `default`/capability/versioning because new methods break implementers, and either fully design-and-document for inheritance or mark the class `final`.
