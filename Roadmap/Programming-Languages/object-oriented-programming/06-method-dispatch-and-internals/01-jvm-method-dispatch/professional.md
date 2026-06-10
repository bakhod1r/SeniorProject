# JVM Method Dispatch — Professional

> **What?** Driving dispatch-awareness across a team: code-review vocabulary that names the opcode and the receiver-type distribution; ArchUnit rules to keep hot paths monomorphic; JFR / async-profiler workflows for spotting megamorphic call sites in production; mentoring `final` and `sealed` discipline; and refactor strategies for hot dispatch paths that don't require rewriting business logic.
> **How?** Treat dispatch as an *operational* concern, not just a JIT detail. Encode the invariants in tooling, surface them in review, profile them in production, and turn the senior knowledge in [`senior.md`](./senior.md) into team practice.

---

## 1. Code-review vocabulary: name the opcode

A useful review comment names *exactly* what changed at the bytecode level. Vague comments like "this might be slow" do not help; specific ones do.

```java
// PR diff under review:
- public final class JsonFormatter implements Formatter { ... }
+ public class JsonFormatter implements Formatter { ... }
```

> **Reviewer:** Dropping `final` here changes the dispatch profile. The call site in `Pipeline.run` is currently monomorphic on `JsonFormatter`; CHA devirtualizes it because `JsonFormatter` is `final`. Without `final`, CHA's assumption is speculative — any future subclass deoptimizes the compiled `Pipeline.run`. Keep `final` unless you have a concrete reason to subclass.

Contrast with:

> **Reviewer:** This new `EventHandler` joins three existing implementations at the same call site. The site was bimorphic; with the fourth implementer it goes megamorphic. Consider `sealed permits` on the interface so CHA stays useful, or split the dispatch into two narrower call sites that each see two impls.

Both reviews are concrete, both name the opcode behaviour, and both end with a single proposed fix. That is the shape of dispatch-aware review.

The vocabulary you should be able to use in a review comment, without looking it up:

- *Monomorphic* / *bimorphic* / *megamorphic* call site.
- *Inline cache miss* and *polymorphic inline cache (PIC)*.
- *CHA* (class hierarchy analysis), *deoptimization*, *uncommon trap*.
- *Devirtualization* and *guarded inlining*.
- The five opcodes by name (`invokestatic`, `invokespecial`, `invokevirtual`, `invokeinterface`, `invokedynamic`).
- *Profile pollution* — one shared call site, many concrete callers.

---

## 2. ArchUnit rules for dispatch discipline

ArchUnit can encode structural rules that keep dispatch fast at scale. Three patterns we use in practice.

**Rule 1 — hot-path packages forbid open hierarchies.**

```java
@ArchTest
static final ArchRule hot_path_classes_are_final_or_sealed =
    classes().that().resideInAPackage("..hotpath..")
             .and().areNotInterfaces().and().areNotAbstract()
             .should().beTopLevelClasses()
             .andShould().haveModifier(JavaModifier.FINAL);
```

Any class under `..hotpath..` must be `final`. The package boundary tells reviewers and the JIT "no subclassing here".

**Rule 2 — interfaces with many implementers must be sealed.**

```java
@ArchTest
static final ArchRule dispatch_critical_interfaces_are_sealed =
    classes().that().resideInAPackage("..dispatch..")
             .and().areInterfaces()
             .should(beSealedOrHaveSingleImplementer());
```

`beSealedOrHaveSingleImplementer` is a custom `ArchCondition` that checks the class file for the `PermittedSubclasses` attribute (`sealed`) or counts implementers across the imported classes. The rule keeps the type set closed for the JIT.

**Rule 3 — no service locator in dispatch-critical packages.**

```java
@ArchTest
static final ArchRule no_static_getInstance_in_hot_path =
    noClasses().that().resideInAPackage("..hotpath..")
               .should().callMethodWhere(target(name("getInstance"))
                                         .and(target(owner(modifier(STATIC))))));
```

Static `getInstance()` calls hide the receiver from CHA. The JIT can't reason about a global singleton's polymorphism unless the field holding it is itself `final` and statically resolvable. Inject explicit collaborators instead.

These rules do not catch every dispatch problem — megamorphic call sites in shared utilities, for instance, can't be detected from class structure alone — but they catch the structural risks that turn into deopts.

---

## 3. JFR and async-profiler for dispatch profiling

Production diagnosis needs profiling tools that show *which call sites are slow and why*. Two tools dominate:

**Java Flight Recorder (JFR)** is built into the JDK. Start a recording:

```
$ java -XX:StartFlightRecording=duration=60s,filename=app.jfr,settings=profile App
```

JFR records every JIT compilation, deoptimization, and inline-cache transition with timestamps. In Java Mission Control or via `jfr` CLI, look at:

- **Compilation events** — methods compiled, recompiled, made not-entrant. A method that appears repeatedly in this stream is being deopted.
- **Class load events** — correlate class loads with subsequent deopts to see CHA invalidations.
- **Method profiling samples** — `[execution_sample]` events tell you which methods burn CPU. A hot method that *also* shows up in compilation events suggests dispatch-related deopts.

**async-profiler** is open-source, lower overhead than JFR for CPU sampling, and produces flame graphs:

```
$ async-profiler -d 60 -f profile.html -e cpu PID
```

In the flame graph, frames labeled `vtable stub` or `itable stub` are *uncached megamorphic* dispatch. They show up in stack frames just above the dispatched method. If they account for more than ~1% of total CPU in a hot service, you have a megamorphic call site worth investigating.

A typical workflow:

1. async-profiler shows 4% CPU in `itable stub` under `PaymentProcessor.process`.
2. JFR's compilation log shows `PaymentProcessor.process` being recompiled twice during the recording window.
3. Class-load events list a new `PaymentMethod` implementation loading right before each recompile.
4. The fix: seal `PaymentMethod`, or pin the type set at startup so all impls load before the JIT compiles.

---

## 4. Mentoring `final` discipline

The discipline most teams lack is the default reflex to make classes `final`. The arguments against `final` ("but what if someone wants to extend it?") are usually theoretical — a real subclass appears in a code review and someone removes the `final` then, with awareness of the consequences.

> **Mentor:** Every concrete class in this service is `final` by default. If you want to subclass one, that's a design decision worth a separate PR — we can talk about whether the right tool is inheritance or composition. Adding `final` is not blocking your work; removing it is the decision that needs justification.

The corollary for interfaces is `sealed`:

> **Mentor:** This interface has three implementers in our codebase and we don't expect a fourth. Seal it. Adding a fourth in the future will require updating the `permits` clause — that's *correct*: a new implementer is a real decision, not an accident. The exhaustive switch you wrote in `EventHandler.handle` is now guaranteed to stay exhaustive.

The mentoring shape: anchor the rule to a *consequence the team has felt*. After the first deoptimization cascade in production (or the first time a sealed switch saved a missed case), the lesson sticks.

What does *not* work: lecturing about CHA without a story. Juniors will dutifully add `final` everywhere because they were told to, including on classes that genuinely should be extended. The judgement is what you teach, not the keyword.

---

## 5. Sealed types as a dispatch optimization — the case

`sealed` is widely advertised as a *modelling* feature (closed sum types, exhaustive switch). It is also a *dispatch* optimization, and that case is worth making explicitly.

```java
public sealed interface RouteDecision permits Allow, Deny, Challenge {}
public record Allow()                    implements RouteDecision {}
public record Deny(String reason)        implements RouteDecision {}
public record Challenge(String mfaToken) implements RouteDecision {}

public Response route(Request req, Authenticator auth) {
    return switch (auth.decide(req)) {
        case Allow a       -> proceed(req);
        case Deny d        -> error(403, d.reason());
        case Challenge c   -> redirect(c.mfaToken());
    };
}
```

Three benefits at the JIT level:

1. **Closed CHA.** No new `RouteDecision` can ever load. CHA's "exactly three impls" is permanent.
2. **All implementers are records → `final`.** Each branch is fully devirtualized; the record accessors inline.
3. **Pattern switch lowers to a type-switch chain.** C2 emits three `instanceof` checks + three inlined branches, no vtable / itable walk.

The result is a dispatch shape closer to "C `switch` on a tagged union" than to "OO virtual dispatch". You haven't lost expressiveness; the design still composes; the JIT just has more to work with.

The argument to make in design review:

> Sealed types aren't only about types — they're a JIT contract. The compiler knows the type set is closed; CHA can't be invalidated by any future class load; the pattern switch is exhaustive without a default. For dispatch-critical code, `sealed` plus `record` is the strongest invariant we can hand HotSpot.

---

## 6. Refactor strategies for hot dispatch paths

When profiling has shown a hot path is dispatch-bound, you have four moves, in order of severity.

**Move 1 — seal the type set.** No code changes outside the type declarations.

```java
- public interface RouteDecision {}
+ public sealed interface RouteDecision permits Allow, Deny, Challenge {}

- public class Allow implements RouteDecision {}
+ public final class Allow implements RouteDecision {}
```

Lowest-cost change. If CHA was already de-virtualizing speculatively, this removes the deopt risk. If CHA wasn't, this enables it.

**Move 2 — split the call site.** If a shared utility is profile-polluted, copy it into the two or three places that account for most of its volume and let each see its own monomorphic type.

```java
// Before: one shared method, all callers funnel through.
public <T> List<T> applyAll(List<Function<T, T>> fns, T initial) {
    T cur = initial;
    for (var fn : fns) cur = fn.apply(cur);
    return List.of(cur);
}

// After: callers inline the loop. Each sees its own concrete function types.
```

Move 2 has a cost in DRY — you've duplicated a loop. The trade is honest: the JIT cannot inline a megamorphic shared utility; you inline it manually by source-level duplication.

**Move 3 — replace virtual dispatch with explicit switch.** When the type set is small and known, an exhaustive `switch` on a sealed type is often faster than `invokeinterface`, because the switch chain inlines all branches and the interface call doesn't.

```java
// Before
public BigDecimal cost(Carrier c, Parcel p) { return c.rate(p); }

// After
public BigDecimal cost(Carrier c, Parcel p) {
    return switch (c) {
        case Ground g  -> g.rate(p);
        case Express e -> e.rate(p);
        case Freight f -> f.rate(p);
    };
}
```

The `switch` body still has `invokevirtual` instructions, but each is at a *different* call site with a known, single receiver class — fully monomorphic. The original `c.rate(p)` was one megamorphic call site.

**Move 4 — break SOLID locally.** For an inner loop in measured hot code, replace an injected interface with a concrete class field, accept the SRP / DIP loss, and document.

```java
public final class FastPaymentBatch {
    private final CardPayment card;     // concrete, on purpose
    public FastPaymentBatch(CardPayment c) { this.card = c; }
    public void payAll(List<Order> orders) {
        for (var o : orders) card.charge(o.amount());   // direct invokevirtual on final class
    }
}
```

This is a *local* decision, justified by a profile, documented in a comment naming the speedup measured.

---

## 7. JIT compilation tunables (and when to leave them alone)

A few HotSpot flags pay off for production diagnostics. Most others don't.

**Worth knowing:**

- `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` — logs every inline decision. Slow, use in dev/staging.
- `-XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation` — logs every compile / deopt event. Cheap, OK in prod.
- `-XX:+UnlockDiagnosticVMOptions -XX:+TraceDeoptimization` — explicit deopt reasons. Useful when chasing a deopt cascade.
- `-XX:MaxInlineLevel=N` (default 9) — caps inlining depth. Raising it helps deep abstraction chains; lower it to bound startup time.
- `-XX:CompileCommand=...` — pin specific methods to specific compilers, force inlining decisions, exclude troublesome methods. Last resort.

**Generally not worth tweaking:**

- `-XX:CICompilerCount` — autoconfigures.
- `-XX:TieredStopAtLevel` — disabling tiered compilation produces consistently worse results in modern HotSpot.
- `-XX:+AggressiveOpts` — removed in JDK 11+. If you find it in old docs, ignore.

The rule: tunables are evidence-driven. Run with defaults; profile; if a flag fixes a measurable regression and you can explain *why* in a sentence, use it. Otherwise leave them alone.

---

## 8. Documenting dispatch contracts

Performance-sensitive APIs benefit from explicit dispatch contracts in their Javadoc. An example:

```java
/**
 * Computes the price for one lease day.
 *
 * <p><b>Dispatch contract.</b> This method is called from the hot pricing loop;
 * call sites typed as {@link PricingRule} are expected to be monomorphic in steady state.
 * Implementations should be {@code final} to allow CHA-based devirtualization.
 * Adding a new {@code PricingRule} implementer that loads after warm-up will trigger
 * deoptimization of {@link PricingEngine#priceFor}; pre-load all implementers at startup.
 *
 * <p>The {@link PricingRule} interface is {@code sealed} as of v3.2;
 * adding a new variant requires updating the {@code permits} clause.
 */
public sealed interface PricingRule permits ... { ... }
```

Most callers of `PricingRule` never read this paragraph. The one who modifies the type set in two years will, and they will know the dispatch invariant they're touching. Document the contract; trust the future.

---

## 9. Migrating a legacy hot path — strangler with dispatch invariants

The strangler-fig pattern from [`../../03-design-principles/01-solid-principles/professional.md`](../../03-design-principles/01-solid-principles/professional.md) applies to dispatch-sensitive migrations.

Suppose `BillingManager` (3,000 lines) has a hot pricing method called from a per-event loop. Direct rewrite is too risky. Phased move:

1. **Define a sealed port.** `sealed interface Pricer permits LegacyPricer, ModernPricer`. The two implementers are `final` records or classes.
2. **Wrap legacy as the first impl.** `LegacyPricer` delegates to `BillingManager.priceOf(...)`. The call site through the new port is bimorphic (two impls, the JIT inlines both).
3. **Build the modern impl beside it.** `ModernPricer` reimplements `Pricer.priceOf`. Run both in shadow; A/B compare.
4. **Switch the wiring.** Flip the composition root to inject `ModernPricer`. The call site becomes monomorphic on `ModernPricer`.
5. **Delete `LegacyPricer` and remove it from `permits`.** The sealed interface now has one implementer; CHA gives it zero-cost dispatch.

The dispatch invariant is encoded in the port from day one. The migration is *both* a SOLID move (DIP across the legacy seam) and a dispatch move (sealed type set, monomorphic eventual state). Both pay off.

---

## 10. Anti-patterns to call out in review

**Anti-pattern 1 — reflective dispatch in hot paths.**

```java
Method m = obj.getClass().getMethod("doIt", String.class);
m.invoke(obj, "x");
```

Reflective `invoke` bypasses CHA and inline caches. Each call is a generic dispatch through `Method.invoke`. The JIT can specialize *one* call site that always reflects on the same method, but a generic reflective utility called from many places is a black box. Replace with `MethodHandle`, a dynamic proxy, or an interface. Call out in review.

**Anti-pattern 2 — heterogeneous lists in tight loops.**

```java
List<Animal> zoo = ...;   // mixed Dog, Cat, Lion, Bear, ...
for (Animal a : zoo) a.speak();
```

The loop's call site is megamorphic by construction. Group by concrete type before the loop, or accept that this isn't a hot path.

**Anti-pattern 3 — service locator inside business methods.**

```java
public void process(Event e) {
    Logger logger = LoggerFactory.getLogger();
    logger.log(e);
}
```

`getLogger()` returns "some `Logger`". The JIT sees an opaque static call returning the supertype. Better: inject `Logger` into the class constructor, store as `final` field, let CHA see the actual type.

**Anti-pattern 4 — `Object` as parameter type for hot paths.**

```java
public boolean test(Object o) { ... }
```

If `o` is then dispatched on (`o.equals(...)`, `o.toString()`), the call site is necessarily megamorphic — `Object` has every Java class as a possible runtime type. Tighten the parameter type.

**Anti-pattern 5 — `Optional` returned from hot dispatch.**

```java
public Optional<Handler> findHandler(Event e) { ... }
```

The call site `handler.handle(e)` is now under an `Optional` indirection; each call site sees either `Some` or `Empty` and the dispatch into `handle` happens *inside* `Optional.ifPresent`'s lambda, which is itself another call site. The chain accumulates dispatch layers. Use `Optional` for return values you keep for a while; not for fast inner loops.

---

## 11. Quick rules

- [ ] In review, name the opcode, the receiver-type distribution, and propose one concrete fix.
- [ ] ArchUnit rules: hot-path classes are `final`, dispatch-critical interfaces are `sealed`, no `getInstance()` in `..hotpath..`.
- [ ] Profile production with async-profiler or JFR; `vtable stub` and `itable stub` frames are megamorphic.
- [ ] Correlate compile events with class-load events — class loads triggering deopts are a CHA-invalidation cascade.
- [ ] Mentor `final` and `sealed` discipline by anchoring to a felt consequence (deopt cascade, missed switch case).
- [ ] Refactor hot paths in increasing severity: seal → split call site → explicit switch → break SOLID locally.
- [ ] Document dispatch contracts in Javadoc on shared types; future maintainers will need to know.
- [ ] In migrations, build the port as `sealed` from day one; the final state is monomorphic.
- [ ] Call out reflective dispatch, heterogeneous loops, service locators, `Object` parameters, and `Optional` over hot dispatch in review.

---

## 12. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Junior-level introduction to the 5 opcodes                  | `junior.md`        |
| Reading bytecode, CHA, sealed types, lambdas                | `middle.md`        |
| Inline caches, deopt, megamorphic profiles, indy bootstrap  | `senior.md`        |
| JVMS §6.5, §5.4.5, JLS §8.4.8, JEPs 181/280/309             | `specification.md` |
| 10 buggy dispatch snippets                                  | `find-bug.md`      |
| Cost per opcode, CHA, sealed, JMH                           | `optimize.md`      |
| Hands-on exercises with `javap`, JMH, PrintInlining         | `tasks.md`         |
| 20 interview questions                                      | `interview.md`     |

See also [../02-vtable-and-itable/](../02-vtable-and-itable/) for the table mechanics, and [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) for the design-level case against deep inheritance trees that pollute call-site profiles.

---

**Memorize this:** dispatch-aware engineering is *operational*, not just theoretical. Encode invariants in ArchUnit, surface them in code review with opcode-specific vocabulary, profile production with JFR and async-profiler, and mentor `final` / `sealed` discipline by anchoring to felt pain. Performance is not a separate discipline; it is a *consequence* of the structural decisions reviewers make every day. The tools above turn that consequence from accident into design.
