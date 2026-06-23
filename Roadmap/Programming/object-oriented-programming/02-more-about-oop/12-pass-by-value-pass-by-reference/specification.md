# Pass by Value / Pass by Reference — Specification Deep-Dive

> JLS §8.4.1 (formal parameters), §15.7.4 (argument evaluation), §15.12.4 (runtime invocation), §5 (conversions), JVMS §2.6 (frames), §6.5 (invoke* opcodes).

---

## 1. Where canonical text lives

| Topic                          | Source            |
|--------------------------------|-------------------|
| Formal parameters               | JLS §8.4.1         |
| Argument evaluation order       | JLS §15.7.4         |
| Runtime method invocation        | JLS §15.12.4       |
| Type conversions on arguments    | JLS §5             |
| Boxing/unboxing conversions      | JLS §5.1.7, §5.1.8 |
| Varargs                          | JLS §15.12.4.2     |
| Frame format                     | JVMS §2.6          |
| Operand stack                    | JVMS §2.6.2        |
| Local variables                  | JVMS §2.6.1        |
| Method invocation opcodes         | JVMS §6.5          |

---

## 2. JLS §8.4.1 — formal parameters

> The formal parameters of a method declaration consist of zero or more comma-separated parameter specifiers. Each parameter specifier consists of a type and an identifier (the formal parameter name). The formal parameters of a method are visible only within the body of the method and behave like local variables.

Parameters are local variables; modifying them doesn't affect the caller (the variable, not the pointed-to object).

---

## 3. JLS §15.7.4 — argument evaluation order

> In a method or constructor invocation, the actual argument expressions, if any, are evaluated in left-to-right order. If evaluation of any argument expression completes abruptly, no part of any argument expression to its right appears to have been evaluated.

Critical for arguments with side effects:

```java
m(x++, ++x);
// equivalent to: tmp1 = x; x++; x++; tmp2 = x; m(tmp1, tmp2)
```

Right-to-left evaluation is wrong; rely on left-to-right.

---

## 4. JLS §15.12.4 — runtime method invocation

> 1. Compute the target reference (for non-static methods).
> 2. If null, NPE.
> 3. Evaluate arguments left-to-right.
> 4. Convert each argument value to the corresponding parameter type.
> 5. Bind args to formal parameters.
> 6. Execute method body.

Step 4 — *conversion* — is what handles boxing, widening, etc.

---

## 5. JLS §5 — conversions and contexts

When an argument is converted to fit a parameter:
- *Identity conversion* — same type.
- *Widening primitive conversion* — `int → long`, `int → double`, etc.
- *Boxing conversion* — `int → Integer`.
- *Unboxing conversion* — `Integer → int`.
- *Reference conversion* — subtype to supertype (covariance for arrays).
- *Capture conversion* — for generic wildcards.

These happen automatically per the rules in §5.

---

## 6. Boxing semantics (JLS §5.1.7)

```java
void m(Integer x) { }
m(5);    // 5 is implicitly Integer.valueOf(5)
```

`Integer.valueOf` returns cached instances for -128 to 127. For other values, allocates.

```java
Integer.valueOf(127);
Integer.valueOf(128);
```

The first returns a cached `Integer`. The second always allocates. This is why `==` on boxed integers is often surprising.

---

## 7. Varargs (JLS §15.12.4.2)

A method declared with `T...` can be called as `m(t1, t2, t3)` or `m(arr)` where arr is `T[]`. The compiler boxes loose args into an array.

If you pass a single null:
```java
void m(Object... args) { }
m(null);   // ambiguous: null is Object, but is it a single null or null[]?
```

Cast clarifies: `m((Object) null)` for single null; `m((Object[]) null)` for null array.

---

## 8. JVMS §2.6 — frames

Each method invocation has a frame:
- Local variable array (parameters + locals).
- Operand stack.
- Reference to runtime constant pool.

Frame is allocated on method entry, popped on return.

---

## 9. JVMS §2.6.1 — local variables

> A local variable can hold a value of type boolean, byte, char, short, int, float, reference, or returnAddress. A pair of local variables can hold a value of type long or double.

The first slots hold parameters in declaration order. Long/double take two slots.

For instance methods, slot 0 is `this`.

---

## 10. JVMS §2.6.2 — operand stack

The operand stack is a LIFO of values. Operations pop their operands and push results. Method invocations pop args and (for non-void) push return value.

The stack is sized at method compile time; the verifier checks it doesn't overflow.

---

## 11. Final parameters (JLS §8.4.1)

> A formal parameter may be declared final.

A final parameter cannot be reassigned within the method. It's a style/safety choice; doesn't affect caller-side semantics.

---

## 12. Synchronized parameters (legacy)

JLS allows `synchronized` on methods, but the synchronization is on `this` (instance methods) or `Class<...>` (static), not on parameters. Parameters are just locals.

---

## 13. Generic argument substitution

For a generic method:
```java
<T> void m(T x) { ... }
```

After erasure, parameter type is `Object` (or the bound). The compiler inserts a cast at the call site if needed:

```java
m("hi");   // calls m(Object), cast inserted at use site if T's reference is needed
```

The JVM doesn't see `T`; it sees `Object`. Pass-by-value of references is unaffected.

---

## 14. Reading order

1. JLS §8.4.1 — formal parameters
2. JLS §15.7.4 — argument evaluation
3. JLS §15.12.4 — runtime invocation
4. JLS §5 — conversions
5. JLS §15.12.4.2 — varargs
6. JVMS §2.6 — frames
7. JVMS §2.6.1, §2.6.2 — locals and operand stack
8. JVMS §6.5 — invoke* opcodes

---

**Memorize this**: JLS §8.4.1 says parameters are locals. §15.7.4 mandates left-to-right argument evaluation. §15.12.4 specifies the binding. §5 governs conversions (boxing, widening). JVMS §2.6 details frame layout. The mechanism is pass-by-value at every level: primitives copy, references copy.
