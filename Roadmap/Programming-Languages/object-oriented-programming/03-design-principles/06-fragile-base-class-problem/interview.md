# Fragile Base Class Problem — Interview Q&A

20 questions covering the term's origin, the three forms, mitigations, snippet critiques, and senior-level judgement.

---

## Q1. What is the Fragile Base Class Problem?

A working subclass can break when its *superclass* changes — even if the superclass's change is purely internal and the subclass author hasn't touched a line. The subclass inherits the parent's *implementation details* (which methods call which, internal state, lifecycle semantics) as part of its contract, not just the parent's public API. The term was formalized by Leonid Mikhajlov and Emil Sekerinski at ECOOP 1998. Joshua Bloch's *Effective Java* item 18 (favour composition) is the canonical practical treatment.

**Trap:** Saying "inheritance is bad". The honest version: inheritance is a *contract* that very few classes earn the right to ask of their subclasses.

---

## Q2. Name the three forms of FBCP.

(1) **Self-use change** — the parent's method calls another of the parent's methods that the subclass has overridden. When the parent refactors to *stop* calling it, the subclass's override silently stops firing. (2) **Accidental override** — the parent adds a new method whose signature collides with one the subclass already had; the subclass's helper now overrides the parent's method with unexpected effects. (3) **Removed/changed call** — the parent removes (or changes the call site of) a method the subclass relied on via `super.method()`; the subclass either fails to compile or, worse, silently does nothing.

**Follow-up:** "Which form is hardest to spot?" — form 1 (silent self-use change) — the code compiles, the behaviour just stops being right.

---

## Q3. Critique this snippet.

```java
public class CountingList<E> extends ArrayList<E> {
    private int addCount = 0;
    @Override public boolean add(E e)                       { addCount++; return super.add(e); }
    @Override public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return super.addAll(c);
    }
}
```

Classic FBCP. `ArrayList.addAll` internally calls `add(E)` once per element; the subclass's `addAll` *adds* `c.size()` *plus* the inherited self-use of `add` fires `addCount++` per element — double-counting. The bug depends on the JDK's *internal* implementation; if Oracle refactors `addAll` to use `System.arraycopy`, the subclass's count becomes correct again. The subclass's correctness is bound to private details of the parent. Fix: composition — `CountingList` holds an `ArrayList<E>` privately and forwards explicitly.

**Trap:** Saying "just override only one of `add` or `addAll`". You'd have to read the JDK source to know which is safe, and the answer can change.

---

## Q4. Why is `Stack extends Vector` in the JDK a problem?

`Stack` inherits every `Vector` method: `add(int, E)`, `set(int, E)`, `remove(int)`, `clear()`, `subList()` — none of which respect the LIFO invariant. A caller can `stack.add(0, "X")`, breaking the stack contract. The JDK has lived with this since 1.0 because of backward compatibility. Modern code uses `Deque<E>` (an interface, not a concrete class) and an implementation like `ArrayDeque` — composition over inheritance, no leaked API. The `Stack` example is the canonical "inheriting from a JDK collection" anti-pattern.

**Follow-up:** "How would you fix it today?" — design a `Stack<E>` with composition over `ArrayDeque<E>`, expose only `push`, `pop`, `peek`, `size`, `empty`. The class is `final`.

---

## Q5. Critique this constructor.

```java
public class Parent {
    public Parent() { onCreate(); }
    protected void onCreate() { /* default */ }
}
public class Child extends Parent {
    private final String name;
    public Child(String n) { super(); this.name = n; }
    @Override protected void onCreate() { System.out.println(name.length()); }
}
```

NullPointerException. JLS §12.5 specifies: `super()` runs *before* subclass field assignments. When `Parent`'s constructor calls `onCreate()`, the dispatch resolves to `Child.onCreate()` (virtual call), but `this.name` is still `null` because the `this.name = n` assignment hasn't happened yet. Bloch's rule: *never invoke an overridable method from a constructor*. Fix: provide a static factory or remove the virtual call; the constructor should only assign fields.

**Trap:** Saying "make `onCreate` `final`". That works for *this* parent, but the failure mode is general; `final` in the constructor's callees is the right policy.

---

## Q6. What is the "designed for inheritance" recipe?

Joshua Bloch's *Effective Java* item 19: a class designed for inheritance must (1) clearly document which methods are *hooks* (overridable), (2) mark every non-hook method `final`, (3) document each hook's self-use (which other methods call it, in what order) via `@implSpec`, (4) provide protected helpers if subclasses need them, and (5) ship contract tests that every subclass must pass. Without all five, the class is "accidentally extensible" — FBCP-prone.

**Follow-up:** "What if a class wasn't designed but already has subclasses?" — add the documentation retroactively, run contract tests against existing subclasses, and treat hook signatures as binary-incompatible-when-changed.

---

## Q7. How does `sealed` reframe FBCP?

`sealed` (JEP 409, Java 17) declares a closed set of permitted subclasses at compile time. The set is bounded, and you control every subclass. FBCP's three forms have different consequences: self-use changes are still possible but you update the (few, known) subclasses in lockstep; new methods on the parent don't accidentally override subclasses' helpers (you control all subclasses); removed methods are safe because you can refactor consumers too. `sealed` is FBCP made *manageable* — the contract is between known parties.

**Trap:** Saying `sealed` "eliminates" FBCP. It doesn't — it bounds the surface, making coordination tractable.

---

## Q8. Critique this `equals`.

```java
public class Point {
    int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
}
public class ColoredPoint extends Point {
    Color color;
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint)) return false;
        ColoredPoint cp = (ColoredPoint) o;
        return super.equals(cp) && color.equals(cp.color);
    }
}
```

Asymmetric. `point.equals(coloredPoint)` is `true` (Point's `instanceof Point` matches), but `coloredPoint.equals(point)` is `false` (ColoredPoint's `instanceof ColoredPoint` doesn't match). `HashSet.contains` returns different answers depending on which element you stored. Bloch's *Effective Java* item 10 covers this: inheritance + `equals` is broken by construction; the only safe fix is composition. `ColoredPoint` holds a `Point` and a `Color` and overrides `equals` to compare both.

**Follow-up:** "What about `getClass() == o.getClass()` to fix symmetry?" — fixes symmetry but breaks substitutability (a `Point` and a `ColoredPoint` with same coordinates aren't even comparable as Points). Composition is the cleaner answer.

---

## Q9. Why is `Cloneable` a FBCP minefield?

`Object.clone()` produces a shallow copy of declared fields; every level of the inheritance chain must implement `clone()` correctly for the protocol to work end-to-end. If `Animal.clone()` returns an `Animal`, the subclass `Dog` must override to cast appropriately and copy its own fields, and so must `PoliceDog` extending `Dog`, and so on. The contract is *non-local* — every level depends on every other. Bloch's item 13: avoid `Cloneable` entirely; use copy constructors or static factories. With modern records, copy semantics are auto-generated from components.

**Trap:** "I'll just call `super.clone()` carefully." It works for one level but breaks the moment any ancestor refactors.

---

## Q10. What is `@implSpec`?

A Javadoc tag (introduced in JDK 8 by JEP 224) that documents *how* a method is implemented, separate from *what* the method does. Three tags: `@apiNote` (informal API guidance), `@implSpec` (the implementation specification subclassers depend on), `@implNote` (informal implementation notes). For FBCP, `@implSpec` is the canonical place to document self-use:

```java
/**
 * Insert all elements from c.
 * @implSpec This implementation iterates over c and calls {@link #add(Object)} for each element.
 */
public boolean addAll(Collection<? extends E> c) { ... }
```

Subclassers depending on the documented self-use are *informed*; the parent author signs a contract not to change it without a major version bump.

**Follow-up:** "What if the team doesn't write @implSpec?" — then every override is FBCP-fragile because the contract is undocumented.

---

## Q11. When should a class be `final`?

By default, unless it's specifically designed for inheritance. Joshua Bloch's item 19: design and document for inheritance, or prohibit it. `final` prohibits — the compiler refuses any subclass. Three categories: (1) value types (records are implicitly final), (2) leaf service classes (no extension intended), (3) library API surfaces where you want to lock down evolution. Reserve non-final for: framework hook points, deliberately-extensible base classes with documented contracts, and `sealed` family parents.

**Trap:** "Never use `final`, it limits flexibility." `final` is the *expression* of design intent — limit by design, not by accident.

---

## Q12. How do you detect binary-incompatible changes?

Tools like `japicmp-maven-plugin` and `revapi` compare two versions of a JAR and list every change classified by binary compatibility (per JLS §13). Run them in CI on every release; fail the build if a binary-incompatible change ships without a major-version bump. Examples of changes they catch: adding `final` to a method, removing a method, changing return types, narrowing access modifiers. For FBCP, these are the parent-side changes that break subclasses; the tool catches them before consumers do.

**Follow-up:** "Are minor-version binary-incompatible changes ever OK?" — only with explicit team policy (e.g., "internal modules can break minor"). Public-facing libraries should never break minor.

---

## Q13. What is "fake FBCP cure"?

Patterns that *look* like fixes but aren't. Examples: adding `@Override` everywhere (catches form 2 only); marking all methods `final` then realizing the design needs hooks (and not having them); writing contract tests *after* shipping (they capture current behaviour, not the original contract); deeply documenting self-use but never enforcing it. Real cures: `final` + composition by default; `sealed` for closed variants; `@implSpec` plus contract tests for designed-for-inheritance; binary-compat tools in CI.

**Trap:** "Our codebase has good comments, so FBCP doesn't apply." Comments rot; types and `final` don't.

---

## Q14. Critique this Spring snippet.

```java
public abstract class BaseService {
    @Transactional public void save(Object entity) { ... }
}
public class OrderService extends BaseService {
    public void process(Order o) {
        validate(o);
        save(o);                  // intra-class call
    }
}
```

The `@Transactional` annotation works via Spring's proxy, which intercepts *external* calls. Intra-class `this.save(...)` (or `super.save(...)`) bypasses the proxy because the call goes through `this` directly. The transaction doesn't start; database writes commit individually; partial state on failure. This is FBCP at the framework level — `BaseService`'s `@Transactional` contract is broken by inheritance + framework-proxy semantics. Fix: move `save` to a separate `@Component` and inject it; the transaction boundary becomes a component boundary, which the proxy can intercept.

**Trap:** "Add `AopContext.currentProxy()` calls." Works, but couples your code to Spring's internals. Composition is cleaner.

---

## Q15. When does the JDK itself exhibit FBCP?

Several places: (1) `Stack extends Vector` — inherits indexed mutation that violates the stack invariant; (2) `Properties extends Hashtable<Object, Object>` — allows non-string keys/values that break the `Properties` contract; (3) `Date` and the `java.util.Calendar` hierarchy — mutability + inheritance combine into known bugs; (4) `Cloneable` itself — the protocol is FBCP by construction. Modern JDK code avoids these patterns: `java.time` uses immutable value classes, `Map.of(...)` returns specific implementations not extensible by consumers, `List.copyOf(...)` returns an unmodifiable view.

**Follow-up:** "Why hasn't the JDK fixed `Stack`?" — backward compatibility. Existing code that uses `Stack` and depends on its `Vector` heritage would break. The recommended modern replacement is `Deque<E>` + `ArrayDeque<E>`.

---

## Q16. Explain "binary compatibility" in one sentence.

A change is *binary-compatible* (per JLS §13) if callers compiled against the old version continue to work without recompilation when linked against the new version. For FBCP: a change is *subclass-binary-compatible* if existing subclasses' compiled bytecode keeps working — adding `final` to a method, removing a `protected` method, narrowing access — all break this. `japicmp` enumerates the rules mechanically; in production library evolution, "binary compat" is the senior shorthand for "doesn't break consumers".

**Trap:** Confusing source compatibility with binary compatibility. Adding a method's default to an interface is source-compatible but can still be binary-incompatible (it can hide a subclass's method with the same signature).

---

## Q17. When does a class deserve to be open for inheritance?

Three criteria: (1) it has a *documented* extension contract (which methods are hooks, what they guarantee, what subclasses must preserve); (2) it ships *contract tests* that every subclass passes; (3) the maintainers commit to *binary stability* — they treat hook changes as breaking changes. Without all three, the class is "accidentally extensible" — FBCP-prone. Frameworks earn extension trust by meeting all three; most application code shouldn't ask for it.

**Follow-up:** "Can a class become open later?" — yes, by retroactively writing the contract tests, documenting self-use, and accepting that hook signatures are now locked.

---

## Q18. How does FBCP interact with cohesion?

A *cohesive* parent class — one purpose, methods that belong together — often *encourages* FBCP, because subclasses want to specialize a single aspect of the cohesive whole. The senior corrective: split cohesive classes that attract subclassing into *composed collaborators*. The parent becomes a thin orchestrator; the variable aspects are interfaces with strategies. Cohesion is preserved at the system level; FBCP is eliminated because no class is open for extension.

**Trap:** Reading "split the class" as "split it into many small classes". The split is along the *axis of variation*, not arbitrarily.

---

## Q19. When does FBCP lose to performance?

The two cures interact with performance positively: `final` classes get aggressive CHA inlining; sealed types dispatch faster than open hierarchies for multi-variant call sites. The "FBCP is fine because performance" claim is folklore. The honest performance cost of FBCP is *hidden*: framework-mandated inheritance adds reflection overhead at startup; deep chains slow class loading; megamorphic call sites caused by many subclasses pessimize the JIT.

**Trap:** "We can't use composition because it adds a virtual call." Modern JITs inline monomorphic interface calls for free. Measure before assuming.

---

## Q20. What's the senior policy on inheritance?

Roughly: (a) default `final` on new classes; (b) un-`final` only with documented inheritance design + contract tests; (c) `sealed` for closed variant families; (d) interfaces (not abstract classes) at cross-team/cross-module boundaries; (e) framework-mandated `extends` is acceptable but the subclass is a thin adapter delegating to composition; (f) binary-compat tools in CI; (g) treat inheritance as a contract with a *retirement plan* — deprecation cycles, versioning, eventual replacement. Inheritance is one tool among many; FBCP is the cost of using it unwisely.

**Follow-up:** "How do you sell this policy to a team that loves inheritance?" — show them the last three FBCP incidents, name the parent change that caused each, and argue from the cost of those incidents. Evidence beats principles.

---

**Use this list:** rotate one question per axis (definition, forms, snippet critique, JLS-level mitigations, framework intersections, performance, policy). Strong candidates name the *specific* FBCP form they see, the JLS feature that mitigates it, and the team-level policy that prevents it from recurring.
