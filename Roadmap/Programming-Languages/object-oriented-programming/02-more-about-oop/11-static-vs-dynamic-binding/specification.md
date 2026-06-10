# Static vs Dynamic Binding — Specification Deep-Dive

> JLS §15.12 (method invocation), JVMS §6.5 (invoke* opcodes), JVMS §5.4.5 (method resolution), JLS §8.4.8 (override), JLS §8.3 (fields).

---

## 1. Where canonical text lives

| Topic                          | Source            |
|--------------------------------|-------------------|
| Method invocation               | JLS §15.12         |
| Compile-time method resolution  | JLS §15.12.2       |
| Runtime method invocation        | JLS §15.12.4       |
| Override rules                   | JLS §8.4.8         |
| Field access                     | JLS §15.11         |
| `invokevirtual`                  | JVMS §6.5          |
| `invokeinterface`                | JVMS §6.5          |
| `invokestatic`                   | JVMS §6.5          |
| `invokespecial`                  | JVMS §6.5          |
| `invokedynamic`                  | JVMS §6.5          |
| Method resolution                | JVMS §5.4.5        |
| `getfield`/`putfield`            | JVMS §6.5          |
| `getstatic`/`putstatic`          | JVMS §6.5          |

---

## 2. JLS §15.12 — method invocation

The method invocation expression `e.m(args)` is evaluated:

1. Evaluate `e` to a target reference.
2. Evaluate `args` left-to-right.
3. Resolve the method (compile time): determine the signature based on declared types.
4. Invoke the method (runtime): for instance methods, dispatch via receiver's class.

JLS §15.12.4 details the runtime invocation:

> If the form is `Primary.Identifier(...)`, the Primary is evaluated. If null, NPE. Otherwise, the method is dispatched.

For `invokevirtual` / `invokeinterface`, dispatch is dynamic.

---

## 3. JLS §15.11 — field access

> The form `Primary.Identifier`, where Identifier is a field, is evaluated by evaluating the Primary, then accessing the field declared in the *static type* of the Primary.

Field access is statically bound. The declared type wins, regardless of the actual class.

---

## 4. JLS §8.4.8 — override semantics

An override:
- Same name and parameters as the parent (post-erasure).
- Same or subtype return type (covariant).
- Same or fewer/narrower checked exceptions.
- Same or wider access.

The override participates in dynamic dispatch — calls land in the most-derived class's implementation.

---

## 5. JLS §8.4.8.2 — static method hiding

> A static method declared in a subclass with the same signature as a static method in the superclass *hides* the parent's, but does not override it. Hiding does not affect dynamic dispatch.

Static methods are dispatched at compile time via declared type.

---

## 6. JVMS §6.5.invokevirtual

The opcode performs:

1. Resolve method symbolic reference (link time, once).
2. Verify accessibility.
3. Pop receiver.
4. Search receiver's class C for matching method:
   a. If C has a method with same (name, descriptor) and it's not abstract, use it.
   b. Otherwise, recursively search C's superclasses.
   c. If still not found, search C's superinterfaces (with maximally specific matching).
5. Invoke the matched method.

Throws `NullPointerException` if receiver is null.

---

## 7. JVMS §6.5.invokeinterface

Similar to `invokevirtual` but the resolved class is an interface. The receiver searches its itable for the implementing method.

The instruction includes a `count` byte (historical; ignored by modern JVMs) and a final 0 byte (placeholder).

---

## 8. JVMS §6.5.invokestatic

```
1. Resolve method ref.
2. Verify the method is static.
3. Initialize the resolved class if needed.
4. Pop args (no receiver).
5. Invoke directly.
```

No receiver, no dispatch.

---

## 9. JVMS §6.5.invokespecial

Used for direct method invocation (no dynamic dispatch):

```
1. Resolve method ref.
2. Verify accessibility (the resolved method must be in the current class, an ancestor, or Object).
3. Pop receiver and args.
4. Invoke the method as resolved (NOT via vtable lookup).
```

For constructors, the resolved method must be a `<init>` of the same class or superclass.

---

## 10. JVMS §6.5.invokedynamic

```
1. On first invocation: call the bootstrap method to obtain a CallSite.
2. Subsequent calls: invoke the CallSite's target.
```

The CallSite is bound to a `MethodHandle` that performs the actual logic. After binding, the call is direct (or polymorphic, depending on the CallSite implementation).

---

## 11. JLS §15.12.4 — runtime method invocation

The full algorithm for dispatching `e.m(args)`:

> 1. Compute the actual class (from receiver).
> 2. Use the resolved method's vtable index to look up the method on the actual class.
> 3. Invoke that method with `this` bound to the receiver.

This is the formal specification of dynamic dispatch.

---

## 12. Field access: get/put opcodes

| Opcode      | Use                             | Static or instance |
|-------------|---------------------------------|--------------------|
| `getfield`  | Read instance field              | Instance           |
| `putfield`  | Write instance field             | Instance           |
| `getstatic` | Read static field                | Static             |
| `putstatic` | Write static field               | Static             |

All four are dispatched based on the field's declared class (no polymorphism). The receiver (for `getfield`/`putfield`) is just popped from the stack.

---

## 13. Constant variables (JLS §4.12.4)

A `final` field of primitive or String type, initialized to a constant expression, is a *constant variable*. Reading it does NOT trigger class init and is inlined at the use site.

```java
class A {
    public static final int X = 5;        // constant variable
    public static final Integer Y = 5;     // not (boxed)
    public static final int Z = compute(); // not (non-constant init)
}
```

Constant variables have no field-access overhead — they're literals at the use site.

---

## 14. Reading order

1. JLS §15.12 — method invocation
2. JLS §15.11 — field access
3. JLS §8.4.8 — override
4. JVMS §6.5 — invoke* opcodes
5. JVMS §5.4.5 — method resolution
6. JVMS §6.5 — getfield/putfield/getstatic/putstatic
7. JLS §4.12.4 — constant variables

---

**Memorize this**: JLS §15.12 + JVMS §6.5 govern method dispatch. `invokevirtual`/`invokeinterface` use vtable/itable (dynamic). `invokestatic`/`invokespecial`/`invokedynamic` are direct or bootstrap-resolved. Field access (get/put) is always static. Constant variables are inlined at compile time.
