# Access Specifiers — Interview

> 50+ Q&A across all levels. Each answer is short enough to deliver in a real interview but specific enough to demonstrate depth.

---

## Junior (1–15)

### Q1. What are the four access specifiers in Java?
`private`, package-private (no keyword), `protected`, and `public`. From most to least restrictive. Package-private is the default if you write nothing.

### Q2. Why is package-private called "default"?
Because that's what you get when you don't specify a modifier. It limits access to classes in the same package. Some style guides prefer the term "package-private" to make the intent explicit — saying "default" obscures that there *is* a level being chosen.

### Q3. Can a top-level class be `private`?
No. Top-level classes can only be `public` or package-private. `private` and `protected` apply only to nested members (fields, methods, constructors, and nested classes).

### Q4. What's the visibility of a class with no access modifier?
Package-private — only classes in the same package can use it.

### Q5. What's the difference between `protected` and package-private?
- Package-private: visible only within the same package.
- `protected`: visible within the same package *and* to subclasses (even in other packages).

So `protected` is a *superset* of package-private.

### Q6. Can a subclass in a different package access a `private` field of its parent?
No. `private` is restricted to the same class (and same nest in Java 11+). Subclasses get no special privilege. They can only access the field through `protected` (or wider) accessors.

### Q7. What's the convention for fields?
Almost always `private`. Loosen only when there's a real reason. Public fields bypass any future invariants you might want to enforce.

### Q8. Can you use `private` on a constructor?
Yes — common for singleton patterns, utility classes (no instances), and static-factory-only classes.

### Q9. What does it mean for a field to be `public static final`?
- `public`: anyone can read it.
- `static`: belongs to the class, not to instances.
- `final`: cannot be reassigned after initialization.

Together: a class-level constant. The compiler may inline its value into reading bytecode if the value is a compile-time constant expression.

### Q10. What's the access level of constructor-less classes?
The class itself follows its declared modifier. The compiler-generated default constructor matches the *class's* access (public class → public constructor; package-private class → package-private constructor).

### Q11. Can you reduce the visibility of an overridden method?
No. The JLS requires that an overridden method's access be the same or *wider* than the parent's. So a `protected` method in the parent can be overridden as `protected` or `public`, but not `private`.

### Q12. Can a `private` method be overridden?
No — `private` methods are not virtual. They are not part of the inheritance contract. A subclass with a method of the same signature *hides* the parent's, but that's not overriding; the parent's method is still called when invoked through the parent class.

### Q13. What's the access level of fields and methods inside an interface?
Interface methods are implicitly `public`. Fields are implicitly `public static final`. Java 9+ allows `private` methods (helpers used by `default` methods).

### Q14. Why might you make a class `final`?
- To prevent subclassing (security, simplicity).
- For value types where subclassing breaks `equals` semantics.
- To enable JIT to inline methods aggressively (no class hierarchy analysis needed).

`final` is not directly an access specifier but interacts strongly with extensibility.

### Q15. What's wrong with `public` mutable fields?
- Anyone can write any value, bypassing validation.
- You can't add validation later without a breaking change.
- You can't change the field's type or replace it with a computed value.
- Cross-thread visibility (`volatile`, `synchronized`) is unenforceable.

The fix: `private` + getter/setter (or, better, a record).

---

## Middle (16–30)

### Q16. When would you use `protected`?
When designing a base class that subclasses must extend, and the subclass needs access to a method or field. Most often for *template method* patterns: parent calls `protected` hooks, subclass overrides them. Avoid `protected` *fields* — use `protected` methods that wrap private state.

### Q17. Why is `protected` rarely the right choice?
- It exposes the member to *every subclass anywhere in the world*, not just to "trusted code."
- For "package access" use package-private instead.
- For "subclass safety," prefer `protected final` methods over `protected` fields.

### Q18. How do you test package-private code?
Place the test class in the same package as the production class. Maven/Gradle's standard layout puts tests in a parallel directory tree, but the same package — so tests can access package-private members without you weakening production access. Also: `@VisibleForTesting` annotation marks members deliberately broader-than-needed.

### Q19. What does `setAccessible(true)` do?
It flips an internal flag on a reflection object that disables Java's access checks. Subsequent calls (`Field.get`, `Method.invoke`) skip the access check.

In Java 9+, this is also subject to the JPMS module check — if the target package isn't `opens`-ed to the caller, `setAccessible(true)` itself throws `InaccessibleObjectException`.

### Q20. What's the purpose of `module-info.java`?
It declares a *module* — a deployable unit with explicit dependencies and exports. Key directives:
- `requires <module>` — depend on another module.
- `exports <package>` — make public types in this package accessible to importers.
- `opens <package>` — allow reflection (`setAccessible(true)`) into this package.
- `uses` / `provides` — service loader integration.

Within a module, all packages are accessible. Outside, only `exports`-ed packages are.

### Q21. What's the difference between `exports` and `opens` in JPMS?
- `exports`: exposes public types' public API to other modules — compile-time and at-runtime access via normal mechanisms.
- `opens`: additionally allows reflective access into private members. Use when a framework (Jackson, Hibernate) needs to reflect on your types.

A package can be `exports`-ed without being `opens`-ed (typical for normal API), or `opens`-ed to a specific framework module without `exports` (data classes that are JSON-serialized but not part of the API).

### Q22. What's a "nest" in Java 11+?
A group of classes that share a common `NestHost` and can access each other's `private` members directly at the JVM level. Typically used for inner-class access without synthetic bridges. Pre-11, `Outer` and `Outer$Inner` accessed each other's privates through compiler-generated bridge methods.

### Q23. How does access control interact with reflection?
Reflection respects access modifiers by default. `setAccessible(true)` bypasses them — but only if (a) a Security Manager (deprecated) doesn't reject it, and (b) JPMS allows it (the package must be `opens` if cross-module).

For framework code, prefer `MethodHandles.privateLookupIn(targetClass, lookup)` plus `lookup.findVarHandle(...)` — this is JIT-friendly and integrates with JPMS cleanly.

### Q24. What's wrong with `protected` fields?
They expose mutable state across an arbitrary subclass boundary. Any subclass — even one written by a third party — can read or write the field, bypassing the parent's invariants. Worse, refactoring the parent must consider every conceivable subclass; you've built a contract on private state.

The fix: `private` field + `protected final` accessors / mutators. The parent owns the state; subclasses interact through controlled methods.

### Q25. Why does `private` constructor + static factory give more flexibility than `public` constructor?
- Factories can have meaningful names (`Money.usd(100)` vs `new Money(100, "USD")`).
- Factories can return cached instances (`Boolean.valueOf`, `Integer.valueOf`).
- Factories can return subtypes — the runtime type doesn't have to match the static one.
- New factories can be added without touching existing ones (constructors don't compose this way).

### Q26. What's the difference between `private` and `package-private` in terms of file-level visibility?
- `private`: within the same class only. Same-nest helpers in Java 11+ can also access.
- Package-private: any class in the same package, even from another file.

Both restrict to the JVM-level definition of a "package" — same fully-qualified name *and* same defining class loader.

### Q27. What happens if you import a package-private class?
You can't — it's invisible from outside the package. The compiler rejects the import. (Or rather: the class's name is not visible outside the package, so the import doesn't resolve.)

### Q28. What's the access level of an enum constant?
Enum constants are implicitly `public static final`. They are accessible everywhere the enum class is.

### Q29. Can you make a method less accessible than the class?
Yes — and often you should. A `public` class with `private` helper methods is normal. The reverse (private class with public methods) is legal but pointless — the public methods are unreachable from outside the package.

### Q30. What is "method hiding"?
When a `static` method in a subclass has the same signature as a `static` method in the parent, the subclass's *hides* the parent's. Resolution is by *static type* of the reference, not by runtime type. So this is not polymorphism — it's name shadowing at a class level.

```java
class A { static String name() { return "A"; } }
class B extends A { static String name() { return "B"; } }

A a = new B();
a.name();        // "A" — static type of a is A
B.name();        // "B"
```

---

## Senior (31–42)

### Q31. How do access modifiers affect API stability?
Public surface is the contract. Once shipped:
- Renaming a public field/method = breaking change.
- Removing a public member = breaking change.
- Tightening preconditions (e.g., adding null check) = breaking change.
- Internal refactors that don't change the public surface are *not* breaking.

So tightening access is one of the cheapest ways to enable future flexibility. Library authors fight to keep public surface minimal.

### Q32. What's the right way to separate API from implementation in a library?
Create two packages: `com.lib.api` (exported) and `com.lib.internal` (not exported). The `api` package contains interfaces and factory methods; `internal` contains implementations.

```java
package com.lib.api;
public interface PaymentService { ... }
public final class Payments {
    private Payments() {}
    public static PaymentService create() { return new com.lib.internal.DefaultPaymentService(); }
}

package com.lib.internal;
final class DefaultPaymentService implements PaymentService { ... }   // package-private
```

Combined with JPMS `exports com.lib.api` (and not `internal`), even reflection from outside the module can't reach the implementation.

### Q33. When is `protected` the right choice?
When designing an *open* base class with documented extension hooks. The classic case: template method pattern.

```java
public abstract class HttpServlet {
    protected void doGet(HttpServletRequest req, HttpServletResponse res) { /* default 404 */ }
    protected void doPost(...) { /* default 404 */ }
    public void service(...) { /* dispatch to doGet/doPost */ }
}
```

Subclasses (in any package) override `doGet`. The `service` method is `final`-ish; the hooks are explicit.

For application code (closed hierarchies), `protected` is rarely needed. Composition or sealed types do better.

### Q34. How does the JPMS module system interact with class loaders?
A module is loaded by a class loader. Each class loader can host multiple modules (the *bootstrap*, *platform*, and *application* class loaders each load several JDK and app modules). Module-level access checks operate within and across these loaders.

Two classes with the same name in different modules are different runtime classes. Two classes in the same module but different loaders... should not happen — JPMS forbids split modules across loaders. If you see this, you have a misconfiguration.

### Q35. What does `--add-opens` do at runtime?
It opens a package from one module to another (or to `ALL-UNNAMED` for classpath code). Equivalent to adding an `opens` directive to `module-info.java` without recompiling. Frameworks that reflect on JDK internals often document these.

Operationally, `--add-opens` is a *crutch* — any project relying on it should plan to upgrade frameworks or add proper `module-info.java` directives. Each `--add-opens` is a future-fragile config item.

### Q36. How does `MethodHandles.privateLookupIn(...)` relate to `setAccessible(true)`?
Both bypass Java's access check, but `privateLookupIn` is the modern, JIT-friendly approach:

```java
MethodHandles.Lookup lookup = MethodHandles.privateLookupIn(Account.class, MethodHandles.lookup());
VarHandle balanceField = lookup.findVarHandle(Account.class, "balance", long.class);
```

Differences:
- `privateLookupIn` requires the target class's module to `opens` the package to the caller's module. JPMS-compliant.
- `MethodHandle`/`VarHandle` are JIT-compiled to direct calls. No reflection overhead per call.
- More secure: the lookup capability is scoped, not global.

Use `privateLookupIn` for new framework code. Reserve `setAccessible(true)` for legacy code that hasn't migrated.

### Q37. Why does Effective Java recommend "minimize the accessibility of classes and members"?
Three reasons:
1. Smaller surface = smaller maintenance burden. Each `public` is a permanent commitment.
2. Loosely coupled modules / packages refactor independently.
3. Hidden details can be optimized, replaced, or removed without coordinated changes.

The discipline: start with `private`; widen only when a concrete external need appears.

### Q38. How would you refactor a class with many `protected` fields?
- Identify each `protected` field's purpose.
- For each: replace with a `private` field plus a `protected final` accessor (and, if needed, a `protected` mutator with validation).
- Audit subclasses for direct field access — replace with calls to the new accessors.
- Add tests that confirm subclasses still work.
- Remove the original `protected` fields once no caller depends on them.

This is Effective Java's "encapsulate state" rule applied at the inheritance level.

### Q39. What's the difference between a "monkey patching" and "controlled extension"?
Both involve modifying a class's behavior from outside.

- **Monkey patching** (Ruby, Python, JavaScript): change methods at runtime via reflection or language features. Common in dynamic languages.
- **Controlled extension** (Java's preferred way): the base class declares `protected` hooks, subclasses override them, and the inheritance chain is part of the design.

Java doesn't really support monkey patching — `setAccessible(true)` plus dynamic class generation can fake it, but it's not idiomatic. Controlled extension via `protected` and `abstract` is the design-time mechanism.

### Q40. How does access control interact with serialization?
Java's default serialization (`Serializable`) reads `private` fields directly via reflection (it's a privileged operation in the JDK). It bypasses normal access checks.

For modern code:
- Avoid `Serializable`. Use Jackson/Gson with explicit field annotations.
- For frameworks that *do* need reflection on private fields, ensure JPMS `opens` is configured.
- Records simplify this: their canonical constructor is public, and the canonical accessors are `public` per the language spec.

### Q41. What's the access modifier story for records?
- The record class itself: declared with whatever modifier you choose.
- Component fields: `private final` (synthesized).
- Component accessors: `public` (synthesized) — name matches the component, no `get`-prefix.
- Canonical constructor: matches the record's access.

You cannot change a component's access. If you need a hidden field, declare it as a regular field on the record class (not as a component).

### Q42. How is access enforced in compiled code vs at the JVM level?
Both layers enforce access:

1. **`javac`** — compiles your code only if access rules are satisfied. Checks at compile time.
2. **JVM verifier** — at class load time, checks every `getfield`/`putfield`/`invoke*` against the resolved class's access flags.

If you produce a class file with a `getfield` for a private field of another class (e.g., via ASM), `javac` won't get the chance — the verifier rejects it at class-load time. So access is *not* purely a compile-time fiction.

---

## Professional (43–52)

### Q43. What does `access_flags = 0x0001` mean on a class?
`ACC_PUBLIC`. The class is `public`. Other flags (e.g., `ACC_FINAL = 0x0010`, `ACC_SUPER = 0x0020`, `ACC_INTERFACE = 0x0200`) are OR'ed in. So a `public final class` has flags `0x0031` plus `ACC_SUPER` for modern code = `0x0051` typically.

### Q44. What's `ACC_SUPER` and why is it always set?
A historical flag that changed the semantics of `invokespecial`. In old JVMs, without `ACC_SUPER`, `invokespecial` would do "exact dispatch" — even for a superclass call, it would resolve to the superclass's method exactly. Modern semantics (with `ACC_SUPER`) walks up the class hierarchy at runtime.

Every modern class file has `ACC_SUPER` set, including those generated by `javac`. It exists to maintain backward-compatibility with class files from before the JDK 1.1 era.

### Q45. How does the verifier check `private` access at load time?
It walks the bytecode. For each `getfield`/`putfield`/`invokespecial`/`invokestatic`/`invokevirtual`/`invokeinterface`, it:
1. Resolves the constant-pool entry to a `(class, member)` pair.
2. Looks up the member's access flags in the resolved class.
3. Applies JVMS §5.4.4 rules — including the nest mate rule for `private`.
4. Throws `IllegalAccessError` if the check fails.

This happens once per resolution, then the result is cached.

### Q46. What's the difference between `IllegalAccessException` and `IllegalAccessError`?
- `IllegalAccessException` (checked, java.lang.IllegalAccessException): thrown by reflective access (`Field.get`, `Method.invoke`) when access is denied.
- `IllegalAccessError` (unchecked, subclass of `LinkageError`): thrown at link time when bytecode references an inaccessible member.

The first happens at runtime via reflection. The second happens during class loading.

### Q47. What's an `InaccessibleObjectException`?
Java 9+ exception (subclass of `RuntimeException`). Thrown when `setAccessible(true)` is called but JPMS forbids it — typically because the target package isn't `opens`-ed to the caller's module. Replaces the older "you can do this if you really want to" semantics with strong encapsulation.

### Q48. How do nest members affect class file size?
Pre-11: each cross-class `private` access generated a synthetic bridge method (~30–50 bytes per bridge). A class with N inner classes accessing M outer privates created up to N×M bridges.

Post-11: zero synthetic bridges. The class file has only:
- `NestHost` attribute on inner classes (~6 bytes each).
- `NestMembers` attribute on the outer class (~4 bytes per member).

For complex nested-class hierarchies, this can shrink the class file significantly — and produces cleaner stack traces.

### Q49. How does `MethodHandles.lookup()` relate to access checks?
`MethodHandles.lookup()` returns a `Lookup` object whose access is *restricted to the calling class*. The lookup can resolve members visible to that class (including its `private` members — same-class access), but not members of other classes' privates.

To gain broader access:
- `Lookup.in(otherClass)` switches the lookup's target — but the original caller's access constraints still apply.
- `MethodHandles.privateLookupIn(target, originalLookup)` returns a fresh lookup that *can* see the target class's privates — but only if the JPMS `opens` permits it.

This design lets `MethodHandle` chains carry exact access capabilities, much more securely than `setAccessible(true)`.

### Q50. What's the runtime cost of access enforcement?
Effectively zero per access. Access checks happen at:
1. Compile time (in `javac`) — no runtime cost.
2. Class load / link time (verifier + resolver) — once per (class, member) reference. Result cached.
3. First reflective access — once per `Field`/`Method`/`Constructor` object. Cached.

Subsequent accesses (whether bytecode `getfield` or reflection after caching) have zero access-check cost. The flags exist purely for the verifier and reflective API.

### Q51. How does access control interact with the JIT?
Access modifiers affect *what the JIT can prove* about a method:

- `private`/`final`/`static` methods can be inlined directly — no virtual dispatch.
- `public` non-`final` methods need vtable dispatch (or speculative inlining via CHA).

The flags themselves have no per-call cost, but they shape the dispatch path. Marking a hot method `final` (when subclassing isn't part of the contract) is a cheap JIT-friendly improvement.

### Q52. What's the relationship between `ACC_BRIDGE` and access?
`ACC_BRIDGE` (= `0x0040` for methods, same bit as `ACC_VOLATILE` for fields) marks compiler-generated bridge methods. Bridges are typically `package-private` or `public` — whatever the resolved overridden method requires. The verifier and resolver treat bridges as ordinary methods for access purposes; they exist purely to bridge erasure or covariance gaps.

You see `ACC_BRIDGE | ACC_SYNTHETIC` flags in `javap` output for any compiler-generated method that's not actually written by the developer.

---

## Behavioral / Design Round (bonus)

- *"Tell me about a time you tightened access in a large codebase."* — describe the steps: survey usages, replace external callers with proper APIs, run tests, remove the broader access in stages.
- *"How do you decide between `protected` and package-private?"* — `protected` only for documented extension points; package-private otherwise. If you're unsure, package-private is safer.
- *"What's your stance on `setAccessible(true)`?"* — appropriate for framework code that owns the access boundary; problematic in application code. Migrate to `MethodHandles.privateLookupIn(...)` + JPMS `opens` for cross-module access.

The signal across all of these: **specifics over generalities**. "I usually default to private" is filler; "I split this 60-method service into a public 5-method interface and a 55-method package-private impl" is concrete and shows judgment.
