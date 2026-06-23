# Moving Features Between Objects — Interview Q&A

> 50+ questions covering the 8 techniques in this category.

---

## Conceptual (Q1–Q10)

**Q1.** What's the goal of "Moving Features" refactorings?
A. To put each method, field, and class on the **right** owner — minimizing coupling, maximizing cohesion.

**Q2.** What's Move Method?
A. A method on class A is moved to class B because the method uses B's data more than A's.

**Q3.** What smell does Move Method primarily cure?
A. [Feature Envy](../../01-code-smells/05-couplers/junior.md). Also helps with [Inappropriate Intimacy](../../01-code-smells/05-couplers/junior.md) and [Shotgun Surgery](../../01-code-smells/03-change-preventers/junior.md).

**Q4.** What's Move Field?
A. A field belongs more on a different class than where it lives. Move it.

**Q5.** What's Extract Class?
A. One class doing two responsibilities → split into two classes. The original delegates to the new one.

**Q6.** What's the inverse of Extract Class?
A. Inline Class.

**Q7.** What's Hide Delegate?
A. Replace `a.getB().doIt()` with `a.doIt()` — a forwarding method on the source.

**Q8.** What's the inverse of Hide Delegate?
A. Remove Middle Man — when too many forwarding methods accumulate, expose the delegate.

**Q9.** What's Introduce Foreign Method?
A. When you need a method on a class you can't modify, create a wrapper method elsewhere (a static utility).

**Q10.** What's Introduce Local Extension?
A. Promote multiple foreign methods on the same type into a subclass or wrapper class.

---

## When to apply (Q11–Q20)

**Q11.** When is Move Method right vs. wrong?
A. Right: method uses target's data more than source's. Wrong: target is a value object that shouldn't grow behavior; source is an aggregate root that orchestrates.

**Q12.** When does Move Field come before Move Method?
A. When the method follows the field. Move the field, the method becomes obviously envious, then move the method.

**Q13.** When should you Extract Class?
A. When the class has two reasons to change, two clusters of fields, or a name that doesn't capture all jobs.

**Q14.** When should you NOT Extract Class?
A. When the "second responsibility" is too small (one method) or you're speculating ahead of need.

**Q15.** When is Inline Class right?
A. The class has no behavior beyond getter/setter on a single primitive; it's a leftover after most logic moved away.

**Q16.** When is Inline Class wrong?
A. The class is a value object (encapsulates an invariant), a port (DI boundary), mocked in tests, or part of public API.

**Q17.** When is Hide Delegate right?
A. The chain `a.getB().doIt()` is repeated; callers shouldn't know about `B`.

**Q18.** When is Remove Middle Man right?
A. The wrapper has 5+ delegating methods adding no value; expose the delegate.

**Q19.** When do you use Introduce Foreign Method?
A. You need a method on a class you can't modify (third-party, JDK).

**Q20.** When do you upgrade to Introduce Local Extension?
A. You have 4+ foreign methods on the same type; cluster them.

---

## Code-smell mapping (Q21–Q30)

**Q21.** Which smell does Extract Class cure?
A. [Large Class](../../01-code-smells/01-bloaters/junior.md), [Data Clumps](../../01-code-smells/01-bloaters/junior.md), [Divergent Change](../../01-code-smells/03-change-preventers/junior.md).

**Q22.** Which smell does Inline Class cure?
A. [Lazy Class](../../01-code-smells/04-dispensables/junior.md).

**Q23.** Which smells does Move Method cure?
A. [Feature Envy](../../01-code-smells/05-couplers/junior.md), [Inappropriate Intimacy](../../01-code-smells/05-couplers/junior.md), [Shotgun Surgery](../../01-code-smells/03-change-preventers/junior.md).

**Q24.** Which smell does Hide Delegate cure?
A. [Message Chains](../../01-code-smells/05-couplers/junior.md).

**Q25.** Which smell does Remove Middle Man cure?
A. [Middle Man](../../01-code-smells/05-couplers/junior.md).

**Q26.** What's the relationship between Move Method and the Single Responsibility Principle?
A. SRP says one class, one reason to change. When a method's reason-to-change differs from the class's, Move it.

**Q27.** How does Hide Delegate relate to Demeter's Law?
A. Demeter says "talk to direct neighbors." Chains break Demeter; Hide Delegate restores it.

**Q28.** When is a method chain not a Demeter violation?
A. Fluent APIs, builders, stream pipelines, immutable transformations — when each `.` returns the same kind of object.

**Q29.** Which smell does Inline Class help with at scale?
A. Speculative Generality combined with Lazy Class — wrappers created "in case we need them" that turned out unused.

**Q30.** How do Extract Class and Inline Class oscillate?
A. Extract when a class grows beyond its responsibility. Inline when a class shrinks below relevance. The pendulum is normal as requirements change.

---

## Architecture & DDD (Q31–Q40)

**Q31.** What's a DDD aggregate?
A. A cluster of objects treated as a unit; the root is the only entry point for outsiders.

**Q32.** How does Move Method relate to aggregates?
A. When code calls deep into an aggregate, Move the method to the root.

**Q33.** What's an Anti-Corruption Layer?
A. A translator class at a bounded-context boundary that prevents one model leaking into another.

**Q34.** When should Move Method NOT cross a bounded context?
A. Almost always. Use an ACL or extract a service instead.

**Q35.** How does Conway's Law inform Move Method decisions?
A. Don't couple code across team boundaries. Either teams merge or code separates.

**Q36.** What three "rings of extract" exist?
A. Extract Class (same package) → Extract Module (separate target) → Extract Service (separate process).

**Q37.** What's the typical anti-pattern when going from monolith to microservices?
A. Skipping the class- and module-level steps; you end up with a distributed monolith.

**Q38.** When does Move Method prepare for microservice extraction?
A. When a method's data and behavior cluster around a clear domain concept that could become a service boundary.

**Q39.** What's a "Move Method orphan"?
A. A stub left in the source class that just delegates; over time it becomes a permanent Middle Man.

**Q40.** When does Hide Delegate hurt module structure?
A. When the wrapper module gains a new dependency on the delegate's module — increasing coupling instead of hiding it.

---

## Tooling & process (Q41–Q50)

**Q41.** How does IntelliJ handle Move Method?
A. F6 with caret on the method. It updates all callers; static analysis confirms safety.

**Q42.** What's OpenRewrite?
A. A Java/Kotlin tool for declarative refactoring recipes that run as a build step. Used for framework migrations.

**Q43.** What's Strangler Fig at the class level?
A. Wrap legacy class with a new one; migrate callers gradually; eventually delete legacy.

**Q44.** What's Branch by Abstraction?
A. Insert an interface, provide two implementations, toggle via flag.

**Q45.** Why is Bazel useful for cross-repo moves?
A. Strict visibility / dependency declarations make refactoring safe — the build system enforces the constraints.

**Q46.** What characterization tests are needed before Move Method?
A. Tests that capture current behavior — usually approval / golden tests on representative inputs.

**Q47.** How does Move Method affect dispatch in JIT?
A. Changes from direct call (this) to virtual call (through field). After warmup, JIT inlines and the cost is ~zero, *if* call site is monomorphic.

**Q48.** When does Move Field hurt cache locality?
A. When a hot field moves out of an object that's iterated millions of times — adds an extra dereference per element.

**Q49.** What's `@Contended` for?
A. Pad a field to its own cache line, preventing false sharing between threads.

**Q50.** How does Project Valhalla change Inline Class?
A. Future Java value classes will give the encapsulation of a wrapper without the heap allocation. Inline Class as a perf refactoring becomes less necessary.

---

## Bonus (Q51–Q60)

**Q51.** What's the difference between Move Method and Extract Method?
A. Extract Method (Composing Methods) creates a new method **on the same class**. Move Method (Moving Features) **changes the class** the method lives on.

**Q52.** When do you Extract Method first, then Move Method?
A. Almost always — extract the envious fragment, then move the now-isolated helper to its rightful owner.

**Q53.** Which Composing Methods technique is closest to Move Method?
A. None — Move Method is class-level, all Composing Methods stay within one class.

**Q54.** What's "false sharing" and how does it relate to Move Field?
A. Two threads writing to two fields in the same cache line invalidate each other's caches. Move Field can introduce or fix this.

**Q55.** How does Kotlin's extension function compare to Java's wrapper class?
A. Extension functions are static methods at runtime — no allocation, no wrapper. Strictly cheaper than Java's wrapper approach.

**Q56.** When does Inline Class save real memory?
A. With many instances (~millions). Removing a header + reference saves ~24 bytes/instance.

**Q57.** Why does CPython `__slots__` matter when Extracting a class?
A. Without `__slots__`, every instance has its own dict — significant memory overhead at scale.

**Q58.** What does PGO (Profile-Guided Optimization) buy for Moved Methods in Go?
A. The compiler can devirtualize hot interface calls, recovering perf lost to indirection.

**Q59.** What's the riskiest move in this category?
A. Extract Class without good test coverage — moving fields and methods can subtly change behavior in ways tests would catch.

**Q60.** What's the discipline behind small reversible moves?
A. Behavior-preserving steps + green CI + small commits = always shippable, always auditable, always revertible.

---

## Next

- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md)
- Recap: [junior.md](junior.md) → [middle.md](middle.md) → [senior.md](senior.md) → [professional.md](professional.md)
