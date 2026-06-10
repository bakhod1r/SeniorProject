# Fragile Base Class Problem — Senior

> **What?** The edge cases of FBCP: why even *designed-for-inheritance* classes can crack under version pressure, how `sealed` types reframe the problem, the trade-offs of frameworks that *require* extension (JPA, Spring), what "binary compatibility" means in the JVM, and how FBCP interacts with cohesion and SOLID. The senior view sees FBCP as one face of *coupling through inheritance* — and treats inheritance itself as a contract negotiation that very few APIs deserve.
> **How?** By recognising that every `extends` is a signed contract spanning the parent's *implementation*, not just its API. Apply inheritance only where the parent is documented and stable; apply `sealed` when the variant set is closed; apply composition everywhere else; manage version evolution with deprecation cycles and contract tests.

---

## 1. Why even "designed for inheritance" classes still crack

You wrote a designed-for-inheritance class: `final` workflow, documented hooks, contract tests. Subclasses pass the contract suite. You ship.

Three years later, requirements demand a *new step* in the workflow. The clean shape would be to add a new hook. But:

- Existing subclasses don't override it (it didn't exist when they were written).
- They use the default implementation — which can't easily know about new context, because the hook's signature is fixed.
- Adding a new parameter to the hook breaks every subclass (signature change).
- Renaming a hook breaks every subclass.
- Reordering the workflow changes the *visible* hook call order — subclasses depending on that order break.

The discipline of "designed for inheritance" buys you *one* future modification: adding a new hook. Beyond that, the parent's evolution is constrained by every subclass that exists. Bloch acknowledges this in *Effective Java*: "Once a class is designed for inheritance, you are stuck with its current state."

Senior recognition: even good inheritance design has a *lifetime* shorter than the codebase's. Plan for retirement.

---

## 2. `sealed` reframes the problem

Java 17's `sealed` types let you keep the inheritance shape *but close the extension set*:

```java
public sealed abstract class Result<T> permits Success, Failure {
    public abstract T orElse(T fallback);
}
public final class Success<T> extends Result<T> {
    private final T value;
    public Success(T value) { this.value = value; }
    @Override public T orElse(T fallback) { return value; }
}
public final class Failure<T> extends Result<T> {
    @Override public T orElse(T fallback) { return fallback; }
}
```

`sealed` means *no other class can extend `Result`*. The set of subclasses is fixed at compile time. FBCP's three forms have different consequences:

- **Self-use changes:** still possible inside `Success`/`Failure`, but you own both classes and can update them together.
- **New methods on parent:** still possible — but you also update the two permitted subclasses in the same PR.
- **Removed methods on parent:** safe — you can refactor freely since you control all extension points.

`sealed` is FBCP-tolerant because you control every subclass. Inheritance becomes a *closed-world* phenomenon, not an open-ended extension contract.

For *application* code where the variants are known, `sealed` is usually the right shape. For *library* code published to unknown consumers, `sealed` is too restrictive — you'd be telling consumers they can't extend at all.

---

## 3. Framework-mandated inheritance — the unavoidable FBCP

Some frameworks *require* you to extend. Examples:

- **Spring's `WebSecurityConfigurerAdapter`** (now deprecated, by the way — they removed it precisely because of FBCP).
- **JPA `@MappedSuperclass`** for shared entity fields.
- **JUnit 4's `TestCase`** (also deprecated for the same reason).
- **Hibernate's `EnversListener`** and many lifecycle interceptors.
- **`HttpServlet`** for the Servlet API.

When the framework demands `extends`, the FBCP is real — every framework version is a potential break. Mitigations:

- **Pin the framework version** until you can budget a migration sprint.
- **Cover the extension with integration tests** that exercise every framework hook you depend on. A regression in the framework breaks the test, not production.
- **Minimize the subclass.** Override the fewest methods possible; delegate to composition elsewhere. The smaller the subclass, the less surface for FBCP.
- **Watch the framework's deprecation cycle.** When `WebSecurityConfigurerAdapter` was deprecated, the cost of migration was already accruing.

```java
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override protected void configure(HttpSecurity http) throws Exception {
        // delegate immediately to a composed configuration object
        config.applyTo(http);
    }
}

public final class SecurityConfiguration {
    public void applyTo(HttpSecurity http) throws Exception {
        // the real logic — testable in isolation, not affected by framework upgrades
    }
}
```

The subclass is a thin adapter; the logic is composed. When the framework removes the adapter (as Spring did), you replace the adapter shell — the logic survives.

---

## 4. Binary compatibility — what the JVM cares about

The JLS distinguishes *source compatibility* from *binary compatibility*. A change is binary-compatible if recompilation isn't required for callers (the new class file works with old callers' bytecode). FBCP often surfaces as a *binary-incompatible* change:

- Adding a new method to an interface: source-compatible if it has a default, binary-compatible.
- Removing a method: binary-incompatible (callers throw `NoSuchMethodError`).
- Changing a method's return type: usually binary-incompatible.
- Adding `final` to a method: source-compatible for callers, binary-incompatible for subclasses that override.

For library authors, binary compatibility is the headline FBCP question: *"Does this change break callers without recompilation?"* The senior toolkit:

- Run `japicmp` or `revapi` on every release; they detect binary-incompatible changes mechanically.
- Maintain a *binary compatibility policy* (e.g., "minor versions are binary-compatible; only major versions break").
- Use `@Deprecated(since, forRemoval = true)` for at least one minor version before removal.

```bash
# Detect binary-incompatible changes between v1 and v2
japicmp -o old.jar -n new.jar --html-file report.html
```

The tool reads both jars and lists every change with its compatibility classification.

---

## 5. FBCP and cohesion — when the parent is too cohesive

A counterintuitive interaction: a *cohesive* parent class (one purpose, methods belong together) often *encourages* FBCP, because subclasses want to specialize one aspect of the cohesive whole.

```java
public abstract class HttpClient {
    public final Response send(Request r) {
        Request signed = sign(r);
        Request retried = applyRetryStrategy(signed);
        return execute(retried);
    }
    protected abstract Request sign(Request r);
    protected abstract Request applyRetryStrategy(Request r);
    protected abstract Response execute(Request r);
}
```

The class is cohesive — every method serves "send an HTTP request". But every method is a hook, and every subclass must override all three. A change to `send`'s structure breaks every subclass.

The senior alternative: *split the cohesive class into composed collaborators*.

```java
public final class HttpClient {
    private final RequestSigner signer;
    private final RetryStrategy retry;
    private final HttpTransport transport;
    public Response send(Request r) {
        Request signed = signer.sign(r);
        Request retried = retry.apply(signed);
        return transport.execute(retried);
    }
}
```

Cohesion preserved at the *system* level; the class is a thin orchestrator. Each collaborator can be replaced without touching `HttpClient.send`. Composition replaces FBCP-prone inheritance.

---

## 6. FBCP across module boundaries — JPMS implications

Before JPMS (Java 9+), every `public` class was reachable by every caller. After JPMS, a module's `exports` declaration restricts which packages are visible. This affects FBCP:

- A class in a *non-exported* package cannot be extended from outside the module.
- A class in an exported package can still be `final` to prevent extension entirely.
- `exports x to module.Y` lets you allow extension only to specific consumers — limited FBCP exposure.

```java
module com.acme.payment {
    exports com.acme.payment;
    // com.acme.payment.internal is NOT exported
}
```

Internal abstract classes are completely safe from external FBCP — no external code can extend them. The only subclasses are within the module, which you control. Internal classes that are public for module-internal reasons gain runtime-enforced isolation.

For library authors: prefer `final` + `exports` for the public API; use `non-final` only for documented hook classes.

---

## 7. The "stable abstract base" myth

Some teams keep an `AbstractBaseService` (or similar) and assume "if subclasses are well-behaved, the parent can evolve freely". Reality: the parent can evolve freely *only as long as nothing changes the call protocol*. Any change to:

- Which methods call which (self-use).
- The order of internal calls.
- The exception types thrown.
- The synchronization semantics (which methods hold locks).
- The thread-safety guarantees.

...is a potential break for every subclass. The parent isn't "stable" in any non-trivial sense; it's *binary-stable* only if its source is *literally* unchanged.

Senior corrective: when you find yourself maintaining a multi-subclass abstract base, ask:

- Could each subclass be a `final` class composed of focused collaborators?
- Could the abstract base be an *interface* with all methods abstract — no self-use?
- Could a `sealed` interface with a closed variant set replace the open hierarchy?

Often yes. The "stable base class" usually wants to be either an interface (no implementation to drift) or a `sealed` family (closed variants under your control).

---

## 8. FBCP and `equals`/`hashCode`/`compareTo`

Inheritance breaks substitutability for these methods in a subtle FBCP way:

```java
class Point {
    int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
}

class ColoredPoint extends Point {
    Color color;
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint)) return false;
        ColoredPoint p = (ColoredPoint) o;
        return super.equals(p) && color.equals(p.color);
    }
}
```

```java
Point p = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, RED);
p.equals(cp);              // true — Point's equals sees Point
cp.equals(p);              // false — ColoredPoint's equals refuses non-ColoredPoint
```

The *symmetry* contract of `equals` is broken. The parent's `equals` accepts the subclass; the subclass's refuses the parent. Hash collisions, comparator bugs, and `HashSet.contains` returning wrong answers follow.

Bloch's *Effective Java* item 10 covers this explicitly. The senior solution: don't extend a concrete class for these methods; compose. `ColoredPoint` holds a `Point` and a `Color`, not extends `Point`.

---

## 9. The cost of un-doing inheritance

When you discover an inheritance hierarchy is causing FBCP, un-doing it has a one-time cost:

- **Each subclass becomes a `final` class** composing the would-be parent's responsibilities.
- **Subclass-specific tests** move from the contract-test suite to focused unit tests.
- **The `extends` clause** is removed everywhere; the parent is either kept as an interface, made `final`, or deleted.

The strangler approach (composition first, inheritance removed second, base deleted last) lets each step ship independently. See [../02-composition-over-inheritance/](../02-composition-over-inheritance/) §6 for the recipe.

The cost is paid once; the FBCP risk is eliminated permanently.

---

## 10. Anti-patterns and "fake FBCP cures"

- **`final` everywhere without thinking.** Marking every class `final` prevents extension — but if the rest of the design requires inheritance (a sealed type's variants), `final` makes the design impossible.
- **"We document everything"** as a substitute for `final`. Documentation rots; `final` doesn't.
- **Deep inheritance "with hooks".** A 6-level chain where every level overrides a hook. Each level is a fresh FBCP risk. Flatten.
- **`@Override` as a "fix"**. The annotation catches *some* form-2 bugs (accidental override) but does nothing for form-1 (self-use change) or form-3 (removed method).
- **"We'll add contract tests later."** Tests written years after the parent are *unverified* — they test the *current* implementation, not the *original* contract.

---

## 11. Quick rules

- Every `extends` is a contract with the parent's *implementation*, not just its API.
- Default `final`; un-`final` only with a documented inheritance design.
- `sealed` reframes FBCP as a closed-world property — recommended for application code.
- Frameworks that demand extension: minimize the subclass, delegate to composition, integration-test the framework hooks.
- Binary compatibility tools (`japicmp`, `revapi`) detect FBCP-causing changes automatically.
- Cohesive parents *encourage* FBCP; consider splitting cohesion into composed collaborators.
- JPMS module exports restrict extensions to within-module subclasses — runtime-enforced limit.
- `equals`/`hashCode`/`compareTo` and inheritance break symmetry — compose, don't extend, for value types.
- Documenting self-use is necessary; *closing* it via `final` non-hooks is better.
- Plan inheritance's retirement: contract tests, deprecation cycle, version policy.

---

## 12. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving FBCP awareness across a team                        | `professional.md`  |
| JLS rules on overriding, sealed types, final                | `specification.md` |
| Spotting FBCP-shaped runtime bugs                           | `find-bug.md`      |
| Performance: virtual calls, devirtualization                | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** FBCP is the cost of inheritance's open-ended contract. Even good design buys you only one safe future modification. `sealed` reframes the contract as closed; composition avoids it; `final` prohibits it. Framework-mandated inheritance is unavoidable but mitigable through minimal subclasses and composition behind the framework's hooks. Plan inheritance's evolution — and its retirement — from day one.
