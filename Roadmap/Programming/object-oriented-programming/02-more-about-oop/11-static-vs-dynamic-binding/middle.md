# Static vs Dynamic Binding — Middle

> **What?** A deeper look: how the compiler resolves overloads (static), how the JVM dispatches overrides (dynamic), the rules for when each applies, and the implications for design — when to use polymorphism, when to use static dispatch, and how to control which one happens.
> **How?** By understanding the JLS rules on method resolution and the JVMS rules on `invokevirtual`/`invokeinterface`/`invokespecial`/`invokestatic`.

---

## 1. The two-phase model

Every method call in Java is resolved in two phases:

1. **Compile-time resolution** (static): the compiler determines the *signature* of the called method based on the declared types of the receiver and arguments. This is overload resolution.
2. **Runtime dispatch** (dynamic, for non-static, non-private, non-final methods): the JVM looks up the actual method in the receiver's class.

Both phases happen for instance methods. Only the first happens for static, private, final, and constructor calls.

---

## 2. Compile-time resolution

The compiler picks the method *signature*:

```java
class A {
    void m(int x) { ... }
    void m(String s) { ... }
}

A a = ...;
a.m(5);   // compiler picks m(int) signature
```

This is overload resolution (covered in `09-method-overloading-overriding`). The result is a symbolic reference encoded in bytecode: `invokevirtual A.m(int)`.

---

## 3. Runtime dispatch

For overridable methods, the JVM at runtime:
1. Reads the receiver's klass pointer.
2. Looks up the method in the klass's vtable at the slot determined at link time.
3. Invokes whatever method is at that slot.

```java
class A { void m() { ... } }
class B extends A { @Override void m() { ... } }

A a = new B();
a.m();    // compile: invokevirtual A.m. runtime: dispatches to B.m via vtable
```

The `invokevirtual` instruction tells the JVM "look up the method dynamically." The `A.m` part is just the symbolic reference; the actual target is determined by the receiver's class.

---

## 4. `invokestatic` — fully static

```java
class C { static int compute() { return 0; } }

C.compute();    // invokestatic C.compute
```

No receiver, no vtable. The method to call is resolved at link time and never changes.

---

## 5. `invokespecial` — direct, but with a receiver

Used for:
- Constructor calls (`<init>`)
- `super.method()` calls
- `private` method calls (in older bytecode; Java 11+ may use invokevirtual for some)

```java
class B extends A {
    void m() { super.m(); }   // invokespecial A.m
}
```

The instance is involved (receiver passed), but no vtable lookup happens — the method is determined at compile time.

---

## 6. `invokevirtual` — dynamic dispatch

```java
class A { void m() { ... } }
class B extends A { @Override void m() { ... } }

A a = ...;
a.m();    // invokevirtual
```

The JVM reads `a`'s klass and dispatches via vtable. The runtime decides which class's `m` to call.

---

## 7. `invokeinterface` — dynamic dispatch via interface

```java
List<String> list = ...;
list.add("hi");    // invokeinterface List.add
```

Like `invokevirtual` but the receiver may implement many interfaces. The JVM searches the receiver's itable (interface method table) for the target. Slightly more expensive than `invokevirtual`, but still fast after JIT inline caching.

---

## 8. `invokedynamic` — bootstrap-resolved

Used for:
- Lambdas (LambdaMetafactory)
- String concatenation (StringConcatFactory)
- Pattern matching switch (SwitchBootstraps)
- Records' equals/hashCode/toString (ObjectMethods)

The first call invokes a bootstrap method that returns a `CallSite`. Subsequent calls use the bound target directly.

---

## 9. The five `invoke*` opcodes

| Opcode             | Use                              | Dispatch            |
|--------------------|----------------------------------|---------------------|
| `invokevirtual`    | Instance methods (non-private)   | Vtable              |
| `invokeinterface`  | Interface methods                | Itable              |
| `invokestatic`     | Static methods                   | Direct              |
| `invokespecial`    | Constructors, super, private     | Direct              |
| `invokedynamic`    | Bootstrap-resolved (lambda etc.) | Bootstrapped CallSite|

Most calls are `invokevirtual` or `invokeinterface`. The JIT optimizes both heavily.

---

## 10. JIT and binding

For `invokevirtual` / `invokeinterface`, the JIT installs an inline cache. After warmup:
- Monomorphic: one receiver class — direct call, often inlined.
- Bimorphic: two — branch on klass.
- Megamorphic: 3+ — fallback to vtable/itable lookup.

For monomorphic call sites, dynamic binding is essentially free.

---

## 11. Devirtualization via CHA

The JIT's class hierarchy analysis: if no override of a method is loaded, treat it as `final`. Direct call. If a new override loads later, deoptimize and recompile.

For typical apps, most virtual calls are devirtualized. Even non-`final` methods often dispatch directly after JIT warmup.

---

## 12. Static binding with `final`

`final` doesn't "make" calls statically bound — they already are at the bytecode level. But `final` *guarantees* the JIT can devirtualize:

```java
public final class Money { ... }   // JIT always devirtualizes
public class Money { ... }          // JIT may need CHA + deopt support
```

For hot paths, `final` is a hint to both the reader and the optimizer.

---

## 13. The double dispatch problem

Java's dispatch is *single dispatch* — based on the receiver only:

```java
shape.intersect(other);   // dispatches on shape, not on other
```

If you need to dispatch on two arguments (visitor pattern, double dispatch):

```java
abstract class Shape { abstract void intersect(Shape other); abstract void intersectCircle(Circle); ... }
```

The visitor pattern simulates double dispatch via two single dispatches. Sealed types + pattern matching handle this case more elegantly:

```java
double intersect(Shape a, Shape b) {
    return switch (a) {
        case Circle c -> intersectCircle(c, b);
        case Square s -> intersectSquare(s, b);
    };
}
```

---

## 14. Static binding for performance

When you absolutely don't want polymorphism in hot code:
- Mark the class `final`.
- Or use a record (records are final).
- Or use `private`/`final` methods.
- Or call static methods directly.

Each of these guarantees the JIT can use direct dispatch.

---

## 15. What's next

| Topic                         | File              |
|-------------------------------|-------------------|
| Inline caches, vtables, internals | `senior.md`     |
| Bytecode opcodes detailed     | `professional.md`  |
| JLS / JVMS spec               | `specification.md` |
| Common bugs                    | `find-bug.md`      |

---

**Memorize this**: compile time picks the method signature; runtime picks the actual method (for virtual calls). `invokevirtual`/`invokeinterface` are dynamic; `invokestatic`/`invokespecial`/`invokedynamic` are direct. The JIT inlines monomorphic virtual calls. Use `final` to guarantee devirtualization.
