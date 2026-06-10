# Method Overloading / Overriding — Specification Deep-Dive

> JLS §8.4.8 (overriding), §15.12 (method invocation, overload resolution), JVMS §4.3.3 (descriptors), JVMS §5.4.5 (method dispatch), JVMS §6.5 (invoke* opcodes).

---

## 1. Where canonical text lives

| Topic                            | Source            |
|----------------------------------|-------------------|
| Method declaration               | JLS §8.4          |
| Method signatures                | JLS §8.4.2        |
| Override-equivalent signatures   | JLS §8.4.2        |
| Overriding rules                 | JLS §8.4.8        |
| Method invocation                | JLS §15.12        |
| Overload resolution              | JLS §15.12.2      |
| Most-specific method             | JLS §15.12.2.5    |
| Hiding (static) vs overriding    | JLS §8.4.8.2      |
| Covariant return                 | JLS §8.4.8.3      |
| Exception narrowing              | JLS §8.4.8.4      |
| Method descriptors               | JVMS §4.3.3       |
| `invokevirtual`                  | JVMS §6.5         |
| Vtable / dispatch                | JVMS §5.4.5       |

---

## 2. JLS §8.4.2 — override-equivalent signatures

Two methods have *override-equivalent* signatures iff:
- They have the same name AND
- After type-parameter substitution and erasure, their parameter types match exactly OR
- One is a subsignature of the other.

This rule determines whether one method overrides/hides another.

---

## 3. JLS §15.12.2 — overload resolution phases

When you call `e.m(args)`, the compiler picks one method:

> The process to determine the most specific applicable method has three phases:
> - Phase 1: identify methods applicable by *strict invocation*.
> - Phase 2: identify methods applicable by *loose invocation*.
> - Phase 3: identify methods applicable by *variable arity invocation*.
>
> The phases are tried in order. As soon as one phase finds an applicable method, it is selected; the most specific is chosen.

Strict: no boxing, no varargs.
Loose: allow boxing/unboxing.
Variable arity: allow varargs.

---

## 4. JLS §15.12.2.5 — most specific method

> Method `m1` is more specific than `m2` if: every argument that's valid for `m1` is also valid for `m2` and `m1` has stricter parameter types than `m2`.

For ambiguity, the compiler errors.

Specifically, for parameter types `S` of m1 and `T` of m2:
- Reference: `S` is a subtype of `T`.
- Primitive: `S` is implicitly convertible to `T` (widening).
- Generic: subtyping rules apply.

---

## 5. JLS §8.4.8.1 — when one method overrides another

Method `m1` declared in class `C` overrides method `m2` declared in class `A` (or interface `A`) iff:
1. `C` is a subtype of `A`.
2. `m1`'s signature is a subsignature of `m2`'s.
3. `m1` is not `private`.
4. `m2` is accessible from `C`, OR there's an intermediate method `m3` such that `m1` overrides `m3` and `m3` overrides `m2`.

---

## 6. JLS §8.4.8.3 — return type compatibility

The override's return type must be:
- The same primitive type (no widening), OR
- A subtype of the parent's return (covariant), OR
- The same reference type.

Bridge methods preserve binary compatibility for covariant returns.

---

## 7. JLS §8.4.8.4 — throws clause compatibility

The override's throws clause must be a *subset* (in subtype terms) of the parent's:

```java
class Parent { void m() throws IOException { } }
class Child extends Parent {
    void m() throws FileNotFoundException { }   // OK — narrower
    void m() throws Exception { }               // ERROR — wider
    void m() { }                                 // OK — empty (narrower)
    void m() throws RuntimeException { }         // OK — unchecked always allowed
}
```

---

## 8. JLS §8.4.8.2 — method hiding (static)

> A static method `m1` declared in class `C` hides method `m2` declared in superclass `A` iff:
> 1. `C` is a subclass of `A`.
> 2. `m1`'s signature is a subsignature of `m2`'s.
> 3. `m1` is `static`.

Hiding is *not* overriding. Static dispatch picks the method based on declared type, not actual class.

---

## 9. JLS §8.4.8 — restrictions

The override:
- Cannot have weaker access.
- Cannot have wider throws.
- Cannot be `static` if parent is instance.
- Cannot be `final` if it overrides.

---

## 10. JVMS §4.3.3 — method descriptors

Descriptor format:
```
( ParameterTypes ) ReturnType
```

Type encodings:
- `B` = byte
- `S` = short
- `I` = int
- `J` = long
- `F` = float
- `D` = double
- `Z` = boolean
- `C` = char
- `V` = void (return only)
- `L<class>;` = reference
- `[<type>` = array

```java
int add(int, int)  →  (II)I
String name()       →  ()Ljava/lang/String;
void put(Object)    →  (Ljava/lang/Object;)V
int[] sort(int[])   →  ([I)[I
```

Two methods with different descriptors are different methods, even if names match. This is what enables overloading.

---

## 11. JVMS §5.4.5 — method resolution

When a `methodref` is resolved (at link time):
1. Find class containing the method.
2. Search recursively up the class chain.
3. Search interface tables.
4. Bind to the resolved method.

For `invokevirtual`, the resolved slot is then used at runtime to dispatch to the receiver's actual method.

---

## 12. JVMS §6.5 — invoke* opcodes

| Opcode           | Use                              | Dispatch          |
|------------------|----------------------------------|-------------------|
| `invokevirtual`  | Instance methods                 | Vtable            |
| `invokeinterface`| Interface methods                | Itable            |
| `invokestatic`   | Static methods                   | Direct            |
| `invokespecial`  | Constructors, super, private     | Direct            |
| `invokedynamic`  | Bootstrap-resolved (lambda, indy)| CallSite          |

---

## 13. Reading order

1. JLS §8.4.2 — signatures
2. JLS §8.4.8 — overriding
3. JLS §15.12 — method invocation
4. JLS §15.12.2 — overload resolution
5. JLS §15.12.2.5 — most specific
6. JVMS §4.3.3 — descriptors
7. JVMS §5.4.5 — resolution
8. JVMS §6.5 — invoke* opcodes

---

**Memorize this**: overloading is a JLS §15.12.2 compile-time selection in three phases. Overriding is JLS §8.4.8 with rules on return types, throws, access. Bytecode encodes signatures via descriptors (JVMS §4.3.3). Dispatch is via `invokevirtual`/`invokeinterface`/`invokestatic`/`invokespecial` based on method kind.
