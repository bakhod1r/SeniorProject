# Final Keyword — Interview

> 50+ Q&A across all levels. Answers concise enough to deliver in interview but specific enough to demonstrate depth.

---

## Junior (1–15)

### Q1. What does `final` mean for a variable?
The variable can only be assigned once. After assignment, it cannot be reassigned. For local variables and parameters, this is enforced by the compiler at compile time.

### Q2. What does `final` mean for a method?
The method cannot be overridden by any subclass. Subclasses can still call it (if accessible), but cannot replace its behavior.

### Q3. What does `final` mean for a class?
The class cannot be subclassed. `String`, `Integer`, `Long` are all `final` in the JDK.

### Q4. Does `final` make an object immutable?
No. `final` controls the *variable*, not the object it references. A `final List<String>` can still be mutated (`list.add(...)`) — only reassignment is forbidden.

### Q5. When must a `final` field be assigned?
Exactly once before the constructor (or static initializer for static fields) finishes. Either at declaration, in an initializer block, or in every constructor path.

### Q6. Can a `final` field be reassigned via reflection?
Historically yes (`Field.setAccessible(true)` + `Field.set(...)`), but the JIT may have inlined the original value, leading to non-deterministic reads. Java 17+ flags this as undefined behavior.

### Q7. What's the difference between `final` and `static final`?
- `final` (without static): each instance has its own copy, assigned once per instance.
- `static final`: one copy per class. For primitives and `String`, often inlined as a compile-time constant.

### Q8. Can constructors be `final`?
No. Constructors are not inherited, so the concept of overriding doesn't apply. The compiler rejects `final` on constructors.

### Q9. What happens if I try to override a `final` method?
Compile error: "Cannot override the final method from ParentClass."

### Q10. What does `final` parameter mean?
The parameter cannot be reassigned within the method body. It's local hygiene — has no effect on the caller. Required (or "effectively final") for capture by lambdas/anonymous classes.

### Q11. What is "effectively final"?
A variable that's never reassigned, even though `final` isn't written. Lambdas can capture either explicitly final or effectively final variables.

### Q12. Why is `String` declared `final`?
For:
- **Security**: a malicious subclass could break the immutability that the string pool relies on.
- **Performance**: the JIT can rely on `String`'s shape; methods can be inlined.
- **Hashing**: caching `hashCode()` is safe because the value never changes.

### Q13. Can an `abstract` method be `final`?
No. `abstract` requires the subclass to implement; `final` forbids subclasses from overriding. The two are contradictory. The compiler rejects the combination.

### Q14. What's the purpose of `final` on a class?
- Prevent inheritance entirely.
- Lock in the class's behavior — no subclass can change it.
- Enable JIT to inline aggressively.
- For value types, prevents `equals` symmetry violations.

### Q15. What's the difference between `final` and `const`?
Java has no `const` keyword (despite it being reserved). `final` is the equivalent — but `final` doesn't mean "compile-time constant" by itself. Compile-time constants are `static final` of primitive or `String` type whose initializer is a constant expression.

---

## Middle (16–30)

### Q16. Why default fields to `final`?
- **JMM safe publication**: `final` fields are guaranteed visible to other threads after construction without synchronization (JLS §17.5).
- **Compiler-enforced invariants**: catches accidental reassignment.
- **Cleaner reasoning**: readers know the field doesn't change.
- **No runtime cost**: it's a compile-time + JMM contract; the bytecode is identical.

### Q17. How does `final` interact with the Java Memory Model?
JLS §17.5 freeze rule: if a constructor finishes without leaking `this`, all threads observing the constructed object's reference see fully-initialized `final` fields without any synchronization. This is the foundation of safe immutable-object publication.

### Q18. What's the difference between `final List<X>` and `List<X>` of immutables?
- `final List<X>` locks the *reference*. The list itself can still be mutated.
- An immutable list (`List.of(...)`, `List.copyOf(...)`) cannot be mutated through any reference.

For deeply immutable data, you need both: `final` reference + immutable list type.

### Q19. Can an inner class access outer class's `final` local variables?
Yes — that's why local classes / lambdas need `final` (or effectively final) locals. The captured value is copied into the inner class's synthetic field; if the local could change, the captured copy would diverge.

### Q20. What's a "blank final"?
A `final` field that's not assigned at declaration. It must be assigned exactly once, in an instance initializer block or in every constructor path (for instance fields), or in a static initializer (for static fields).

### Q21. Can you declare an array's elements as `final`?
No — Java has no syntax for that. You can declare the array reference `final` (so the variable can't be reassigned), but the elements remain mutable. For immutable element collections, use `List.of(...)` or `Collections.unmodifiableList(...)`.

### Q22. What's the difference between `final` and `sealed`?
- `final` class: no subclass allowed.
- `sealed` class: only specifically permitted subclasses allowed; each must declare `final`, `sealed`, or `non-sealed`.

`sealed` (Java 17+) is a middle ground between fully `final` and fully open.

### Q23. What's wrong with this code?
```java
public class Order {
    private final List<OrderLine> lines;
    public Order() { this.lines = new ArrayList<>(); }
    public List<OrderLine> lines() { return lines; }
}
```
The `lines()` getter exposes the mutable internal list. Callers can `add` and `remove` freely, breaking encapsulation. Fix: return `List.copyOf(lines)` or `Collections.unmodifiableList(lines)`.

### Q24. Can you have a `final` constructor parameter and pass it through?
Yes:
```java
public Foo(final String name) {
    this.name = name;       // this is fine — name is read-only
}
```
The `final` is local hygiene; the field assignment uses the value, doesn't reassign the parameter.

### Q25. Why does Java require lambdas to capture only `final` or effectively final variables?
The captured value is copied into the lambda's environment. If the local could be reassigned, the captured copy would become inconsistent with the local. The restriction prevents bugs that look like "I changed `count` but the lambda sees the old value."

### Q26. What does `ACC_FINAL` mean in a class file?
The `0x0010` access flag bit. Set on classes, fields, methods, parameters that are declared `final`. Used by the verifier and JIT.

### Q27. Why are records implicitly final?
Records model values; subclassing a value object breaks `equals` semantics (symmetry, transitivity). Making records `final` prevents this entire class of bugs at compile time.

### Q28. What's the difference between `final` and `volatile`?
- `final` says the field is set once and never reassigned.
- `volatile` says the field may be reassigned, but every read/write establishes happens-before with other threads.

They're mutually exclusive — a field can't be both `final` and `volatile`.

### Q29. Can a static method be final?
Yes — but it's redundant. Static methods aren't virtual, so they cannot be overridden. Marking a static method `final` is a no-op (and stylistically considered noise).

### Q30. How does `final` help with concurrency?
Two ways:
1. Final fields enable safe publication without synchronization (JMM freeze rule).
2. `final` (immutable) classes don't need any synchronization for sharing — they're inherently thread-safe.

---

## Senior (31–42)

### Q31. When would you mark a class `final` vs use `sealed`?
- `final`: when the class is *complete* — no extension contemplated.
- `sealed`: when you have a closed set of variants that should be exhaustively handled (state machines, ADTs, result types).

For value types, `final`. For domain hierarchies you control, `sealed`.

### Q32. What's the impact of `final` on the JIT?
- A `final` class has no subclasses; the JIT inlines methods directly.
- A `final` method cannot be overridden; same.
- A non-`final` monomorphic method also gets inlined (via CHA), but with a deopt hook if a new subclass loads.
- `final` removes the deopt risk entirely.

For hot paths on stable classes, `final` is a small but free win.

### Q33. How does `final` interact with DI proxies (Spring, Guice)?
DI containers often generate runtime subclasses (CGLIB, ByteBuddy) for AOP cross-cutting concerns. A `final` class blocks subclassing → Spring throws `IllegalArgumentException` if you try to proxy.

Workaround: extract an interface, make the implementation `final`, proxy the interface (JDK dynamic proxies work on interfaces).

### Q34. What's the danger of constructor escape with final fields?
The freeze guarantee requires the constructor to finish *before* the reference is published. If `this` escapes mid-construction (registering with an event bus, starting a thread, calling overridable methods), readers may see `final` fields at default values. Don't escape `this` from constructors.

### Q35. How would you design a thread-safe immutable class?
- `final` class.
- All fields `final`.
- All fields are themselves immutable types (or defensively copied).
- Constructor doesn't leak `this`.
- No setters; "modifications" return new instances.
- `equals`/`hashCode`/`toString` consistent.

This shape is automatically thread-safe; readers don't need any synchronization.

### Q36. What's the role of `final` in the builder pattern?
The result object is `final` (immutable). The builder is mutable but local, used briefly to construct the result. Once `build()` runs, the builder is typically discarded.

### Q37. Why is "all fields `final`" insufficient for true immutability?
The fields might reference mutable objects. `final List<X>` means the list reference can't change, but the list contents can. For deep immutability, every reachable object must be immutable — defensive copies, immutable types throughout.

### Q38. How does `final` help with the equals contract?
A non-final class with overridden `equals` faces the symmetry trap: a subclass's `equals` may check additional fields, breaking `parent.equals(child) == child.equals(parent)`. Marking the class `final` eliminates this entirely. (Or use `getClass()` strict equality, which has its own downsides.)

### Q39. What's the test-friendly alternative to `final` classes?
Interfaces. Define the API as an interface; make the implementation `final`. Tests can substitute the interface with a fake; production wires the final implementation.

```java
public interface OrderService { ... }
public final class DefaultOrderService implements OrderService { ... }
```

### Q40. Why might marking a hot static utility class `final` not improve performance?
Static method calls (`invokestatic`) are already direct dispatch — no virtual lookup. Marking the *class* `final` doesn't change static-method dispatch. The win is from preventing subclass instantiation, not from method dispatch.

For hot *instance* methods on a non-static class, `final` does help the JIT.

### Q41. How does `final` work with method references?
Method references compile to `invokedynamic` + `LambdaMetafactory`. The captured environment (any locals referenced) must be effectively final. The method reference itself can refer to a final method just like any other.

### Q42. What's the relationship between `final` and `record`?
Records are implicitly `final`. Their components are implicitly `private final`. The canonical constructor sets the components. So records bake in the value-object pattern's two most important `final` decisions automatically.

---

## Professional (43–52)

### Q43. Walk through the JMM freeze guarantee at the bytecode level.
After the constructor's `<init>` body, the JVM inserts a release-store barrier (or equivalent on hardware). Reads of `final` fields after the freeze are guaranteed to see the constructor-written values. The JIT must respect this — it cannot reorder a final-field write with a subsequent publication of the reference.

### Q44. Why does the verifier reject `putfield` on a final field outside `<init>`?
Because the JLS commits to "final fields are written exactly once in the constructor." Allowing arbitrary writes would break the freeze guarantee — readers couldn't rely on field values being stable. The verifier enforces this at class load time; `VerifyError` if violated.

### Q45. What's the difference between `final` and `effectively final` at the bytecode level?
None. Both compile to the same bytecode (no `ACC_FINAL` flag on locals). The compiler enforces "no reassignment" syntactically; effectively final is just the compiler proving the same property without the keyword. Lambdas treat them identically.

### Q46. How does `-XX:+TrustFinalNonStaticFields` change JIT behavior?
By default, the JIT is conservative about `final` instance fields — it doesn't constant-fold them, because reflection (via `setAccessible(true)`) could mutate them. With `-XX:+TrustFinalNonStaticFields`, the JIT treats them as truly immutable, enabling more aggressive optimizations like constant-folding and dead-code elimination.

The risk: code that mutates final fields via reflection (deserialization, some frameworks) breaks. Use only when you control the entire codebase.

### Q47. How does the verifier handle `final` fields in records?
A record's canonical constructor writes its `final` component fields normally — the verifier accepts this because it's standard `<init>` behavior. The auto-generated accessors only read; no `putfield` to a final field outside `<init>`.

### Q48. Why is `String.hashCode()` cached in a `final`-shaped pattern?
`String` declares `private int hash;` — *not* `final`, because it's lazily computed:
```java
private int hash; // default 0
public int hashCode() {
    int h = hash;
    if (h == 0 && !isEmpty()) {
        h = computeHash();
        hash = h;
    }
    return h;
}
```
The race condition is benign — two threads computing simultaneously produce the same result. But the field can't be `final` because of the lazy init pattern.

### Q49. How does `MethodHandle.findVarHandle` interact with final fields?
For final fields, the returned `VarHandle` only supports read access modes (`get`, `getAcquire`, `getOpaque`, `getVolatile`). Write modes (`set`, `compareAndSet`, etc.) throw `IllegalAccessException` at lookup time. `VarHandle` respects `final` better than older `Field.set` reflection.

### Q50. What's the cost of `final` in terms of class file size?
Zero. `final` is a single bit in the access flags. For `static final` constants of primitive/`String` type with constant initializers, the `ConstantValue` attribute adds 8 bytes — negligible.

### Q51. How do sealed classes affect the `final` decision?
Sealed classes restrict subclassing to permitted subtypes. Each permitted subtype must declare `final`, `sealed`, or `non-sealed`. So `final` becomes part of a three-way decision: closed (`final`), tightly extended (`sealed permits`), or open (`non-sealed`).

In a sealed hierarchy, you'd typically have `final` leaf records and `sealed` intermediate types — modeling closed algebraic data types.

### Q52. Why might removing `final` from a leaf class be a breaking change?
If consumers depended on the class being `final` for `equals` symmetry, instanceof exhaustiveness, or proxy-disabled behavior, removing `final` allows new subclasses that break those assumptions. From a binary compatibility perspective, removing `final` is binary-compatible (existing class files keep working) — but it's an API contract change that may break call-site assumptions.

---

## Behavioral / Design Round (bonus)

- *"Tell me about a time `final` saved you a bug."* — concrete example: a thread reading partially-constructed shared object before fields were assigned. Final field freeze rule fixed it without explicit synchronization.
- *"How do you decide between `final class` and `sealed`?"* — `final` for values; `sealed` for closed hierarchies you want exhaustive switches on.
- *"What's your stance on `final` parameters?"* — team convention; consistency matters more than the rule.

The pattern across all of these: senior answers are *specific*. "I prefer immutable" is filler; "I made `Order` immutable to fix a checkout race condition" is signal.
