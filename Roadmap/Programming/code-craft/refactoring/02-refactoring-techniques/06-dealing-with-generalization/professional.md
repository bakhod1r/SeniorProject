# Dealing with Generalization — Professional Level

> Virtual dispatch, vtables, devirtualization, JIT specialization, and the runtime cost of inheritance.

---

## Table of Contents

1. [Virtual dispatch and vtables](#virtual-dispatch-and-vtables)
2. [Inline caches and polymorphic dispatch](#inline-caches-and-polymorphic-dispatch)
3. [Devirtualization](#devirtualization)
4. [Pull Up / Push Down: dispatch effects](#pull-up-push-down-dispatch-effects)
5. [Form Template Method: inlining limits](#form-template-method-inlining-limits)
6. [Replace Inheritance with Delegation: extra indirection](#replace-inheritance-with-delegation-extra-indirection)
7. [Interface dispatch in Go](#interface-dispatch-in-go)
8. [Method dispatch in Python](#method-dispatch-in-python)
9. [Layout and cache locality](#layout-and-cache-locality)
10. [Review questions](#review-questions)

---

## Virtual dispatch and vtables

In Java/C++, every non-final / non-static method on a class is potentially dispatched virtually:

1. CPU loads the object reference.
2. Dereferences to find the **vtable pointer**.
3. Looks up the method's slot in the vtable.
4. Calls indirectly.

Cost: ~3-5 cycles uncached, ~1-2 cycles with branch prediction.

### When the JVM optimizes

- **`final` methods/classes** — compile-time direct call.
- **Monomorphic call sites** — JIT inlines the receiver and the call.
- **Bimorphic call sites** — JIT keeps a 2-entry inline cache.

### When dispatch costs

- Megamorphic sites (4+ types) — fall back to vtable lookup.
- Cold call sites (not yet profiled) — interpreted dispatch.

---

## Inline caches and polymorphic dispatch

Inline caches (IC) at each virtual call site:

```
[receiver_class | target_method_pointer]
```

If the next call's receiver matches → fast path (1 compare + jump).
If not → fall through to vtable.

For a 2-type callsite, JIT generates a 2-entry IC. For 3 types: PIC (polymorphic IC). For 4+: megamorphic, vtable.

### Implication for refactoring

Replace Conditional with Polymorphism (Simplifying Conditionals) creates a virtual call site. **The number of distinct types observed determines the cost.**

If a hot site sees 4 types in production, it's megamorphic. If you can drop to 2 (e.g., split logic into two call sites each handling 2 types), perf improves.

---

## Devirtualization

JIT replaces virtual calls with direct calls when:

1. The method is `final`.
2. The class is `final` or never extended at runtime.
3. CHA (Class Hierarchy Analysis) proves no overrides exist.
4. The receiver type is statically known via inlining.

Devirtualization is the most important JIT optimization for OO code. A devirtualized call:
- Inlines the body.
- Eliminates the dispatch.
- Runs as if you'd written the body directly.

### Verifying

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining
```

Look for `inline (hot)` annotations.

### What blocks devirtualization

- Multiple subclasses observed.
- Loading a new subclass at runtime invalidates the optimization (deopt).
- Reflection-based instantiation that JIT can't analyze.

---

## Pull Up / Push Down: dispatch effects

### Pull Up Method

Before:
```java
class Engineer { void work() { ... } }   // direct call when Engineer reference
class Manager { void work() { ... } }
```

After Pull Up:
```java
abstract class Employee { abstract void work(); }
class Engineer extends Employee { void work() { ... } }
class Manager extends Employee { void work() { ... } }
```

Calls through `Employee employee = ...; employee.work();` are virtual. Two types → bimorphic IC. Negligible cost.

If only Engineer instances exist at the call site → monomorphic; JIT inlines.

### Push Down Method

Before: virtual call on `Employee.work()`.

After: direct call on `Engineer.work()` (if static type is `Engineer`).

Push Down can sometimes *help* perf by removing virtual dispatch — but only when callers know the concrete type.

---

## Form Template Method: inlining limits

```java
abstract class Statement {
    public final String emit(Customer c) {
        return header() + lines(c) + footer();
    }
    protected abstract String header();
    protected abstract String lines(Customer c);
    protected abstract String footer();
}
```

`emit` itself is `final` → direct call. Inside, `header()` / `lines()` / `footer()` are virtual.

Three virtual calls per `emit`. If sites are bimorphic, ~3 ns. If megamorphic, ~30 ns.

### Optimization

- Mark the entire class hierarchy `final` if no further subclassing intended.
- Or use sealed types so JIT knows the closed set.

Modern Java's sealed types enable JIT to fully devirtualize closed hierarchies — Form Template Method becomes free.

---

## Replace Inheritance with Delegation: extra indirection

Before:
```java
class Stack<E> extends Vector<E> { ... }
stack.push(e);   // direct call to Vector.add
```

After:
```java
class Stack<E> {
    private final Vector<E> data;
    public void push(E e) { data.add(e); }
}
stack.push(e);   // dereferenced data, then call
```

One extra pointer dereference. JIT inlines `push()`, eliminating the indirection.

In steady state: zero perf cost.

In interpreted mode: 1 extra cycle per call.

---

## Interface dispatch in Go

Go interfaces use a different mechanism than Java's vtables. An interface variable is `(type_pointer, value_pointer)` — a "fat pointer."

### Cost

Calling a method on an interface in Go:
1. Load type_pointer.
2. Look up method in itable (interface table).
3. Indirect call.

~3-5 cycles, similar to Java's virtual call.

### Devirtualization

Pre-Go-1.21: very limited. PGO (1.21+) enables it for hot sites.

### Implication

Replacing direct struct calls with interface-based calls in Go has a real perf cost. Use sparingly in hot loops; prefer concrete types or generics for performance-critical code.

---

## Method dispatch in Python

Every Python method call:
1. Look up `obj.method` in the MRO.
2. Build a bound method object.
3. Call.

Cost: ~100-500 ns per call. CPython has no JIT.

### PyPy

PyPy's tracing JIT inlines polymorphic methods aggressively when the call site is monomorphic. Refactorings in this category have small relative cost in PyPy.

### Implication

CPython refactorings should consider:
- Each Pull Up Method adds no cost.
- Each Push Down Method adds no cost.
- Avoiding deep MRO chains helps if you're seeing slow attribute access.

---

## Layout and cache locality

### Java

Object layout is JVM-specific. Generally:
- Header (12-16 bytes).
- Fields ordered by JVM heuristic (often largest first to align).
- Padding for 8-byte alignment.

Pull Up Field changes which class owns the field, but layout is determined per-class. Subclass instances inherit parent fields; layout extends the parent's.

### Go

Struct layout is declared (Go doesn't reorder). Embedded structs are inlined into the outer struct.

```go
type Animal struct { name string }
type Dog struct {
    Animal       // embedded, inlined
    breed string
}
```

`Dog` is `[Animal | breed]` — contiguous. Excellent cache locality.

### When Pull Up Field hurts cache locality

Pulling up a field used only by one subclass means *all* instances of all subclasses have the field. If subclasses are common but the field is rarely used, you've widened every instance.

Example:
```java
abstract class Animal {
    String name;
    String breed;   // only Dogs have a breed; Cats also carry it
}
```

Cats waste 4-8 bytes per instance. For 10M Cats, ~80 MB.

### Cure

Push the field down to Dog only. Or use `Optional<String>` (still a reference; same memory cost as String).

---

## Review questions

1. What's a vtable?
2. What's an inline cache?
3. When can JIT devirtualize a virtual call?
4. What's the cost difference between monomorphic and megamorphic call sites?
5. How do sealed types help devirtualization?
6. What's the runtime cost of Replace Inheritance with Delegation?
7. How does Go's interface dispatch differ from Java's vtable?
8. What does PGO buy for interface-heavy Go code?
9. Why does Pull Up Field sometimes hurt cache locality?
10. How does PyPy reduce the cost of OO dispatch in Python?
