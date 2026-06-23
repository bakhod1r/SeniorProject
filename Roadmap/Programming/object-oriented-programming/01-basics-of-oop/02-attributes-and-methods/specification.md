# Attributes and Methods — Specification Deep-Dive

> The binding rules for fields and methods live in **JLS §8.3** (fields), **§8.4** (methods), **§15.12** (method invocation expressions), and the corresponding bytecode rules in **JVMS §4.5–4.6** and **§6.5**. This file maps each rule to its spec section, what `javac` enforces, and what the JVM enforces.

---

## 1. Where to find the rules

| Concept                                  | Authoritative source                              |
|------------------------------------------|---------------------------------------------------|
| Field declarations and modifiers         | **JLS §8.3**                                      |
| Field initialization order               | JLS §8.3.3, §12.4 (statics), §12.5 (instance)     |
| Method declarations                      | **JLS §8.4**                                      |
| Method overload resolution               | **JLS §15.12**                                    |
| Override / hide rules                    | JLS §8.4.8                                        |
| `final` field semantics (JMM)            | **JLS §17.5**                                     |
| `volatile` semantics (JMM)               | JLS §17.4                                         |
| Class file `field_info` / `method_info`  | **JVMS §4.5**, **§4.6**                           |
| Field access bytecodes                   | JVMS §6.5 — `getfield`, `putfield`, `getstatic`, `putstatic` |
| Method invocation bytecodes              | JVMS §6.5 — `invokestatic`, `invokespecial`, `invokevirtual`, `invokeinterface`, `invokedynamic` |
| Method resolution at runtime             | JVMS §5.4.3.3 (method resolution), §5.4.6 (selection) |

Read the JLS sections for *what your code is allowed to express*; the JVMS sections for *what runs*.

---

## 2. JLS §8.3 — Field declarations

The grammar (simplified):

```
FieldDeclaration:
    {FieldModifier} UnannType VariableDeclaratorList ;

FieldModifier (one of):
    Annotation public protected private static final transient volatile
```

Rules the spec enforces (§8.3.1):

- Visibility — at most one of `public` / `protected` / `private`.
- `final` and `volatile` are mutually exclusive.
- A `static` field initialized to a *constant expression* (§15.28) is treated specially — its value can be inlined into bytecode at compile time. This is why `int MAX = 1000` declared as `public static final` may end up baked into every reader at compile time.

Field initialization (§8.3.3):

1. Static fields receive their declared type's default value during preparation (JLS §12.3.2).
2. Static initializers and static field initializers run in *textual order* during initialization (§12.4.2).
3. Instance fields and instance initializers run in textual order during construction (§12.5).

Forward references to instance fields are restricted (§8.3.3):

```java
class A {
    int j = i;        // ✓ legal? It depends — see "Definite Assignment"
    int i = 1;
}
```

Per §8.3.3, this is *legal* — `j`'s initializer reads `i` which has its default `0` at that point. The result is `j = 0; i = 1`. This is a textbook subtle bug.

The "rule of strict initialization order" only catches *some* forward references. The compiler's full rule, with all corner cases, is in §8.3.3 — read it once.

---

## 3. JLS §8.4 — Method declarations

```
MethodDeclaration:
    {MethodModifier} MethodHeader MethodBody

MethodHeader:
    Result MethodDeclarator [Throws]

Result:
    UnannType
    void

MethodDeclarator:
    Identifier ( [ReceiverParameter,] [FormalParameterList] )
```

Rules:

- **Method signature (§8.4.2)**: name + parameter type list. Two methods in the same class with the same signature are illegal. *Return type is not part of the signature for overload resolution.*
- **Override-equivalent signatures (§8.4.2)**: two methods are override-equivalent if they have the same erasure. This is why a generic method and a non-generic method with the same erasure can clash.
- **Receiver parameters (§8.4.1)**: optional explicit `this` declaration in the signature, used purely for type-use annotations. Does not affect resolution.
- **Throws clause (§8.4.6)**: a method may declare checked exceptions in its `throws` clause; the compiler enforces caller handling. `RuntimeException` and `Error` subclasses don't need to be declared.

Modifiers and their constraints (§8.4.3):

| Modifier         | Notes                                                     |
|------------------|-----------------------------------------------------------|
| `public/protected/private` | At most one.                                       |
| `static`         | No `this`; can't be `abstract`.                            |
| `final`          | Cannot be overridden. Can't be `abstract`.                 |
| `abstract`       | No body. Class must be `abstract`. Cannot be `final`/`static`/`private`/`synchronized`/`native`. |
| `synchronized`   | Acquires monitor on receiver (or `Class` for static).      |
| `native`         | No body; implementation provided externally (JNI/FFI).     |
| `strictfp`       | Historical; no effect since JEP 306 (always strict).       |
| `default` (interfaces only) | Provides a default implementation in an interface. |

---

## 4. JLS §15.12 — Method invocation resolution

The most-referenced section after §8 itself. The compiler picks a method through three stages (§15.12.2):

**Phase 1: Strict invocation.** No boxing, no unboxing, no varargs. Find applicable methods.

**Phase 2: Loose invocation.** Allow boxing / unboxing.

**Phase 3: Variable-arity invocation.** Allow varargs.

Each phase, if it finds applicable methods, picks the *most specific* one (§15.12.2.5). Most-specific is itself a complex set of rules (subtyping on types, generics, etc.), but the intuition: a method whose parameters are *more refined* wins.

This is why `add(0)` calls `add(int)` over `add(Integer)`: phase 1 finds `add(int)` directly applicable (no boxing needed), and there's no phase 2 to consider.

The classic gotcha — `List.remove(int)` vs `List.remove(Object)`:

```java
List<Integer> ints = new ArrayList<>(List.of(10, 20, 30));
ints.remove(1);                      // calls remove(int) → removes element at index 1
ints.remove(Integer.valueOf(1));     // calls remove(Object) → removes the value 1 (if present)
```

Phase 1 finds `remove(int)` for an `int` argument. To call the `Object` overload, you must explicitly box.

---

## 5. Override and hide rules — JLS §8.4.8

A method `mC` in class `C` *overrides* method `mA` in class `A` (a superclass) if:

- `C` is a subclass of `A`.
- `mA`'s signature is a subsignature of `mC`'s (after erasure).
- `mA` is accessible to `C` (visible).
- `mA` is not `private` or `static`.

Rules for an override (§8.4.8.3):

- `mC`'s return type must be the same or a subtype (covariant returns since Java 5).
- `mC` must not throw any *checked* exception not declared by `mA`.
- `mC`'s access modifier must be the same or wider.
- `mC` cannot declare an exception thrown that `mA` does not declare and is not unchecked.

`@Override` annotation (§9.6.4.4) doesn't *make* a method an override — the rules above do — but it makes the compiler verify your intent.

`static` methods are *hidden*, not overridden. The resolution at the call site is by static type, not runtime type.

---

## 6. JLS §17 — Memory model touchpoints

Field semantics interact with the JMM:

### `volatile` (JLS §17.4.4)

Reads and writes of `volatile` fields establish *happens-before* relationships:

- A `volatile` write *synchronizes-with* every subsequent `volatile` read of the same field.
- All actions before the write are observed by the reader.

This is the "release-acquire" semantics. In hardware terms (x86): writes need a StoreLoad fence; reads are essentially free.

### `final` (JLS §17.5)

The "freeze" rule: if a constructor finishes without letting `this` escape, then any thread observing the constructed reference is guaranteed to see all `final` fields fully initialized — even without synchronization.

Concretely: if you build an immutable object and publish it via a `volatile` field or `Atomic*` (or even via a data race), readers will see correctly-initialized `final` fields. Non-`final` fields in the same object don't get this guarantee.

This is why immutable classes with all-`final` fields are "safe to publish."

---

## 7. JVMS §4.5 — Class file `field_info`

```
field_info {
    u2 access_flags;           // ACC_PUBLIC, PRIVATE, PROTECTED, STATIC, FINAL,
                                // VOLATILE, TRANSIENT, SYNTHETIC, ENUM, MANDATED
    u2 name_index;
    u2 descriptor_index;
    u2 attributes_count;
    attribute_info attributes[];
}
```

Possible attributes:

- **ConstantValue** (§4.7.2) — for `static final` primitive/`String` fields with a constant initializer. The JVM uses this value to initialize the field; the static initializer doesn't need to set it.
- **Signature** (§4.7.9) — preserves generic type info (e.g. `List<String>` not just `List`).
- **Synthetic** — compiler-generated field.
- **Deprecated**, **RuntimeVisibleAnnotations**, **RuntimeInvisibleAnnotations**.

A descriptor (§4.3.2) encodes the type:

| Java type            | Descriptor                |
|----------------------|---------------------------|
| `boolean/byte/char/short/int/long/float/double` | `Z B C S I J F D` |
| Reference (e.g. `String`) | `Ljava/lang/String;`  |
| `int[]`              | `[I`                      |
| `String[][]`         | `[[Ljava/lang/String;`    |

Inspect with `javap -v -p MyClass.class`.

---

## 8. JVMS §4.6 — Class file `method_info`

```
method_info {
    u2 access_flags;            // ACC_PUBLIC, PRIVATE, PROTECTED, STATIC, FINAL,
                                 // SYNCHRONIZED, BRIDGE, VARARGS, NATIVE, ABSTRACT,
                                 // STRICT, SYNTHETIC
    u2 name_index;
    u2 descriptor_index;        // (paramTypes) returnType
    u2 attributes_count;
    attribute_info attributes[];
}
```

Possible attributes:

- **Code** (§4.7.3) — bytecode + exception table + StackMapTable + LocalVariableTable.
- **Exceptions** (§4.7.5) — checked exceptions thrown.
- **MethodParameters** (§4.7.24) — preserves parameter names and modifiers (when compiled with `-parameters`).
- **Signature** — preserves generic info.
- **AnnotationDefault** — for annotation methods with a default value.
- **RuntimeVisible/InvisibleAnnotations**, **RuntimeVisible/InvisibleParameterAnnotations**.

A method descriptor: `(arg_descriptors)return_descriptor`. Examples:

| Java method                                | Descriptor                      |
|--------------------------------------------|---------------------------------|
| `void foo()`                               | `()V`                           |
| `int add(int, int)`                        | `(II)I`                         |
| `<T> T id(T)` (after erasure)              | `(Ljava/lang/Object;)Ljava/lang/Object;` |
| `String[] split(String, int)`              | `(Ljava/lang/String;I)[Ljava/lang/String;` |

---

## 9. JVMS §6.5 — Field access bytecode

The four field-access instructions:

| Bytecode      | Semantics                                                |
|---------------|----------------------------------------------------------|
| `getstatic`   | Read static field. Operand: index into constant pool's `Fieldref`. |
| `putstatic`   | Write static field.                                       |
| `getfield`    | Read instance field. Stack: `[..., objectref] → [..., value]`. |
| `putfield`    | Write instance field. Stack: `[..., objectref, value] → [...]`. |

Resolution rules (JVMS §5.4.3.2):

1. Find the class/interface containing the field (may walk superclasses and superinterfaces).
2. Check accessibility from the calling class.
3. If `static`, the class must be initialized.
4. The field's offset is then the *direct reference*, used for the actual load/store.

`final` instance fields have an extra rule (JVMS §6.5, `putfield`): only `<init>` of the same class may write them. If a `putfield` to a `final` field appears outside `<init>`, the verifier rejects the class.

---

## 10. JVMS §6.5 — Method invocation bytecodes

The five method invocation instructions:

| Bytecode          | Used for                                       |
|-------------------|------------------------------------------------|
| `invokestatic`    | `static` methods                               |
| `invokespecial`   | `<init>`, `private`, `super.foo()`             |
| `invokevirtual`   | Non-`final`, non-`private`, non-`static` instance methods of classes |
| `invokeinterface` | Interface methods (non-`private`)              |
| `invokedynamic`   | Lambdas, string concat, pattern dispatch       |

Method resolution (JVMS §5.4.3.3) and selection (§5.4.6):

1. **Resolution** turns a symbolic reference (`CONSTANT_Methodref`) into a *resolved method* — the compile-time identity of the method.
2. **Selection** picks the actual runtime method:
   - `invokestatic` and `invokespecial`: the resolved method itself.
   - `invokevirtual` / `invokeinterface`: the *most specific* overriding method in the receiver's class hierarchy.

This selection is what HotSpot accelerates with vtables/itables and inline caches.

---

## 11. JVMS §4.10 — Bytecode verification

The bytecode verifier proves that no execution can violate JVM safety. For methods specifically:

- The operand stack at every program point has a known depth.
- Each instruction's input types match what's on the stack.
- Branch targets agree on stack types (this is where StackMapTable comes in — the verifier doesn't reconstruct types; it checks the recorded map).
- `<init>` invocations leave `this` "initialized."
- `final` fields aren't written outside `<init>`.

Failures throw `VerifyError`. Common causes: bytecode rewriting tools that don't update the StackMapTable, agents that miscompile, hand-written class files.

---

## 12. JLS §8.3.1.4 — `volatile` constraints

A `volatile` field:

- Cannot also be `final`.
- Establishes happens-before with respect to itself across threads.
- Reads/writes are *atomic* even for `long`/`double` (without `volatile`, those may be torn into two 32-bit operations on some JVMs — though modern 64-bit HotSpot makes them atomic by default).

The "atomic for long/double" guarantee is the single concrete reason to mark a `long` `volatile` even if you don't care about cross-thread visibility.

---

## 13. JLS §15.27 — Lambda expressions and method references

Modern Java's anonymous-class replacement. JLS §15.27 specifies:

- Target type — every lambda must have a *target type* (a functional interface).
- Capture rules — lambdas can capture *effectively final* local variables; cannot capture `this` of an enclosing instance unless explicitly passed.
- Translation strategy — typically via `invokedynamic` + `LambdaMetafactory.metafactory`. The bootstrap method generates a synthetic class implementing the functional interface with the lambda body.

This is why lambdas are usually *cheaper* than anonymous classes: the JIT-friendly `invokedynamic` enables stable inlining and scalar replacement of the capture object.

---

## 14. Reading order

1. **JLS §8.3** — fields. Don't skip §8.3.3 (initialization order).
2. **JLS §8.4** — methods.
3. **JLS §15.12** — method invocation. Read alongside §15.27 (lambdas) for modern Java.
4. **JLS §17.4 & §17.5** — JMM and final field semantics. Required before any concurrent code.
5. **JVMS §4.5 & §4.6** — class file fields/methods. Use `javap -v` to make this concrete.
6. **JVMS §5.4** — resolution.
7. **JVMS §6.5** — bytecode reference. Look up specific opcodes as you encounter them.

The spec rewards selective reading: pick the section relevant to the question, skim the surrounding context, and move on. Spec text is dense but precise — once you train your eye, it's the fastest way to settle "is this defined?" arguments.

---

## 15. The takeaway

Almost every Java field/method behavior question has a definitive answer in the JLS or JVMS. "Why isn't my field initialized?" → §8.3.3 / §12.4. "Why didn't the compiler pick this overload?" → §15.12. "Why does another thread see stale data?" → §17.4. "Why does my bytecode tool produce a `VerifyError`?" → §4.10.

The longer you spend with the spec, the fewer mysteries you have — and the more confidently you can refactor, optimize, or argue with a colleague over what Java *actually does*.
