# vtable and itable — Professional

> **What?** How to teach and lead this material on a team: setting expectations about when vtable/itable knowledge actually matters, picking the right tools for an investigation, enforcing structural guardrails so pathological dispatch shapes don't reach production, and turning hand-wavy "polymorphism is slow" complaints into measurable engineering work.
> **How?** By giving senior engineers a script for mentoring on this topic, a small toolkit (HSDB, async-profiler, JOL), and a few ArchUnit rules that catch known-bad shapes before they ship. Most teams don't need to know everything in `senior.md` — they need to know what to look at when something is wrong.

---

## 1. The mentoring story — "deep inheritance is free at dispatch, expensive at load"

The most useful single sentence to teach a team about vtables is the headline of this section. Once an engineer internalises it, several things follow naturally:

- They stop assuming `final` everywhere is a meaningful runtime optimisation (the vtable slot is precomputed regardless; the JIT decision is the real lever).
- They stop fearing reasonable inheritance depths (3-4 levels). Class loading is paid once; dispatch is paid forever, and dispatch is essentially free.
- They start questioning *broad* interface implementation. A class that `implements` 15 marker-like interfaces costs less in dispatch than in `instanceof` checks and class-loading cost.

When you mentor on this, lead with the cost model rather than the mechanism. The HSDB walk-through is fascinating to some engineers and uninteresting to others. The cost model is universally useful.

---

## 2. When this knowledge actually matters

Be honest with juniors and mids: 95% of Java code never makes a vtable/itable difference visible. The cases where it does:

- **Hot polymorphic loops in a service's critical path.** If profiling shows a megamorphic call site at the top, you need this knowledge to diagnose and fix.
- **Latency-sensitive systems** (HFT, low-latency game servers, real-time bidding) where every nanosecond of dispatch matters.
- **Class-loader-intensive workloads.** Plugin systems, hot-deploy servers, code-generation frameworks — class loading time correlates directly with vtable construction.
- **Memory-constrained systems** (large container fleets, mobile) where metaspace footprint of vtables adds up across thousands of classes.
- **Investigating mysterious slowdowns** after a refactor. "We added an interface and now this loop is 20% slower" is a real conversation.

For everyone else: knowing that vtables exist and that the JIT devirtualizes monomorphic sites is enough.

---

## 3. The minimum useful toolkit

A senior engineer should be able to pick the right tool in under a minute. Here's the decision tree.

| Question                                                                | Tool                                          |
| ----------------------------------------------------------------------- | --------------------------------------------- |
| "What does this class's vtable actually look like?"                      | `jhsdb hsdb` -> Klass browser                |
| "Where is the time really going in this loop?"                           | `async-profiler` flame graph (CPU + lock)    |
| "Is this call site monomorphic or megamorphic?"                          | `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` |
| "Is the JIT inlining the method I think it is?"                          | `-XX:+PrintCompilation` + `-XX:+PrintInlining` |
| "What does this object's header look like — Klass pointer, lock state?" | JOL (`org.openjdk.jol`)                       |
| "Does this method have a bridge variant in the class file?"              | `javap -v -p ClassName.class`                 |
| "Why does my class implement so many interfaces?"                        | ArchUnit rule + IDE structure view            |
| "Is class loading dominating my startup?"                                | `-Xlog:class+load=info`, JFR class-loading event |

You don't need all of these for daily work. You need to know which one to reach for when a question lands on your plate.

---

## 4. Async-profiler for polymorphic hot paths

`async-profiler` (Andrei Pangin's tool) is the production-grade profiler the JVM ships closest to. To find dispatch overhead:

```
asprof start -e cpu -d 30 -f profile.html <pid>
```

In the flame graph, look for:

- Tall stacks ending in `vtable_stub` or `itable_stub` — direct evidence of megamorphic dispatch making it into the hot path.
- Time spent in `Klass::is_subtype_of` or `secondary_super_check` — too many `instanceof` checks on classes with deep interface chains.
- A method that appears as both a direct call and via a vtable stub in different parts of the graph — split call sites with different polymorphism profiles.

The key insight: async-profiler shows *symbol names* including JIT-emitted stubs. A regular profiler (sampling JVM stacks only) would miss the stub frames entirely and tell you "the loop is hot" without explaining why.

---

## 5. ArchUnit rules that prevent pathological shapes

Catch the bad shapes before they reach review:

```java
@ArchTest
static final ArchRule classes_should_not_implement_too_many_interfaces =
    classes().that().resideInAPackage("..domain..")
             .should(new ArchCondition<JavaClass>("implement at most 5 interfaces") {
                 @Override public void check(JavaClass c, ConditionEvents events) {
                     int n = c.getInterfaces().size();
                     if (n > 5) events.add(SimpleConditionEvent.violated(
                         c, c.getName() + " implements " + n + " interfaces"));
                 }
             });

@ArchTest
static final ArchRule inheritance_depth_should_be_bounded =
    classes().that().resideInAPackage("..domain..")
             .should(new ArchCondition<JavaClass>("be no more than 4 levels deep") {
                 @Override public void check(JavaClass c, ConditionEvents events) {
                     int d = 0;
                     for (var p = c.getSuperclass(); p.isPresent(); p = p.get().getSuperclass())
                         d++;
                     if (d > 4) events.add(SimpleConditionEvent.violated(
                         c, c.getName() + " has inheritance depth " + d));
                 }
             });
```

These rules don't claim 5-deep is *correct* — they catch 10-deep, which is almost always wrong. Like all ArchUnit, they encode a *team agreement*, not a JVM constraint.

Pair these with rules that *encourage* sealed types where you have a closed set:

```java
@ArchTest
static final ArchRule public_abstract_classes_should_be_sealed_or_final =
    classes().that().areAssignableTo(DomainEvent.class)
             .should().beAnnotatedWith("__sealed_or_final_marker__")
             .as("DomainEvent hierarchy should be sealed");
```

The marker is a convention; you can also check `class.getModifiers()` directly via reflection inside ArchUnit. The point is to make "I added a new event type" visible as a structural change, not a hidden subclass appearing somewhere in the codebase.

See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) for the design rationale behind these rules.

---

## 6. HSDB in 30 seconds for code review

If a review surfaces a question like "what does this class's vtable look like now that we added the interface?", here is the fastest path:

```bash
# 1. Get the JVM running with the class loaded (a test fixture is easiest).
jhsdb hsdb --pid <pid>

# 2. In the GUI: Tools -> Class Browser -> find the class.
# 3. Double-click the Klass -> "Vtable" tab.
# 4. Each entry shows: slot index, method holder, method signature.
```

A 10-minute screenshare with a junior is more memorable than a 1,000-word doc. The vtable is real. Inheritance is *not* magical action at a distance; it's an array.

---

## 7. Mentoring conversations — common questions

**"Should I mark everything `final`?"**

No. `final` helps the JIT in two scenarios: (a) `final` on a *class* lets CHA prove monomorphism without runtime profiling; (b) `final` on a *method* removes it from the vtable. Both matter when the JIT couldn't already prove the same thing via CHA + profiling. In well-profiled, mostly-monomorphic code, the JIT is already optimal. In megamorphic hot paths, `final` doesn't help because there's no single target to bind. Use `final` for *design intent* (don't extend me) first, optimisation second.

**"Are interfaces slower than abstract classes?"**

Slightly, in the worst case (megamorphic itable lookup + secondary super search). In monomorphic and bimorphic cases, identical. In modern JDKs with packed secondary-super caches, the difference is essentially noise unless you're in HFT-grade microbenchmarks. Design with interfaces freely; profile if you have a specific concern.

**"Why is my Spring app slow to start?"**

Mostly class loading. Spring's classpath scan + the framework's heavy use of interfaces and proxies means thousands of vtables and itables get constructed. CDS / AppCDS can cut this dramatically. Spring Boot 3's GraalVM native image bypasses the JVM entirely. Vtable construction is *one part* of the cost; reflection-driven bean wiring is another.

**"Should I avoid deep hierarchies?"**

For *design* reasons, yes (Fragile Base Class, LSP risk, composition reads better). For *vtable* reasons, only if your class-loading time matters. The dispatch cost is identical regardless of depth.

---

## 8. Reading a profile and writing a real fix

A scenario that comes up: a service degrades from 12k req/s to 8k req/s after adding a new caching layer. Profile shows `itable_stub` near the top. Walk-through:

1. Identify the call site. async-profiler's flame graph points at `CacheLayer.get` in a tight loop.
2. Check the receiver type at the call site. There are now 6 distinct `CacheStrategy` implementations.
3. The site is megamorphic. The pre-cache code only had 1 strategy; the new code branches per request type.
4. Options:
   - Split the loop by request type at a higher level. Each loop is now monomorphic.
   - Make `CacheStrategy` `sealed` with a final permits list. CHA improves.
   - Use a `Map<RequestType, CacheStrategy>` lookup once outside the loop, then call the (still virtual) method on the resolved strategy. The call is now bimorphic per outer-loop iteration, often monomorphic per request batch.

The fix is a *source-level refactor*, not a JVM flag. This is the pattern: profiling shows the dispatch shape, refactoring restores monomorphism.

---

## 9. Code review checklist — dispatch and interface use

- [ ] Does this class need to be open (extendable)? If not, mark it `final` or seal it.
- [ ] If this is an interface, who implements it? If only one production class, consider whether the interface is real abstraction or just ceremony.
- [ ] If this class implements 5+ interfaces, is there a reason? Marker interfaces, multi-role objects, or accidental sprawl?
- [ ] Is there a hot loop that calls a method on a polymorphic reference? What's the receiver type diversity?
- [ ] Was a covariant return added to an existing API? Bridge method, extra vtable slot — usually harmless, but note it.
- [ ] Sealed types where a closed set exists? Records for value carriers?

These don't all need to be *fixed*; they need to be *noticed*. A reviewer who knows the vtable model spots over-segregation, over-abstraction, and accidental megamorphism.

---

## 10. When to stop optimizing dispatch

If async-profiler shows dispatch overhead at 2% of total CPU, the right move is usually to leave it alone and look elsewhere. Dispatch is a small slice of most real applications:

- Allocation, GC, and I/O usually dominate.
- Network and database wait time dwarfs any local dispatch cost.
- The JIT is genuinely good at the common cases.

Spending an afternoon turning a monomorphic interface call into a `final` direct call saves a single-digit-nanosecond per call. Unless that call runs billions of times in your hot loop, the win is below noise. The professional discipline is *measure first, refactor for the cost the profile shows, not for the cost the textbook describes*.

---

## 11. Quick rules

- [ ] Teach the cost model ("free at dispatch, expensive at load") before the mechanism.
- [ ] Reach for async-profiler first, HSDB only for structural questions.
- [ ] Enforce hierarchy depth and interface count bounds via ArchUnit, not via review nitpicks.
- [ ] `final`, `sealed`, and records are design choices that *also* help the JIT — don't sell them as performance tricks.
- [ ] If a profile shows `itable_stub` or `vtable_stub` in the hot path, refactor source code; don't tweak JVM flags.
- [ ] Class-loading cost matters for startup; dispatch cost matters for steady-state. Different optimizations.

---

## 12. What's next

| Topic                                                   | File              |
| ------------------------------------------------------- | ----------------- |
| JVMS sections, HotSpot source pointers                  | `specification.md` |
| Bug stories with stack traces and HSDB output           | `find-bug.md`      |
| Cost numbers, benchmarks, devirtualization recipes      | `optimize.md`      |
| Hands-on HSDB/JOL/JMH exercises                         | `tasks.md`         |
| Interview Q&A                                           | `interview.md`     |

---

**Memorize this:** as a tech lead, you teach this material as a *cost model*, not a tour of HotSpot internals. The two practical levers are (a) keep hot call sites monomorphic by structuring source code accordingly, and (b) prefer sealed/final/records so CHA can prove monomorphism. Reach for async-profiler before HSDB. Set ArchUnit guardrails so pathological shapes are caught at PR time, not in production.
