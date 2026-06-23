# Nested Classes — Specification Deep-Dive

> Rules for nested classes are in **JLS §8.1** (class declarations), **§8.5** (member type declarations), **§14.3** (local class declarations), **§15.9** (anonymous class instantiation), **§15.27** (lambdas), and class file rules in **JVMS §4.7.6** (`InnerClasses`), **§4.7.7** (`EnclosingMethod`), **§4.7.28-§4.7.29** (nest mates).

---

## 1. Where the rules live

| Concept                                  | Source                                |
|------------------------------------------|---------------------------------------|
| Top-level class declarations             | **JLS §8.1**                          |
| Static nested and inner classes (member) | **JLS §8.5**                          |
| Local classes                            | **JLS §14.3**                         |
| Anonymous classes                        | **JLS §15.9**                          |
| Lambda expressions                       | **JLS §15.27**                         |
| Nested types in interfaces               | JLS §9.5                               |
| Records (implicitly final, can be nested)| JLS §8.10                              |
| Sealed nested hierarchies                | JLS §8.1.1.4                            |
| Capture rules (effectively final)        | JLS §4.12.4, §15.27.2                   |
| `InnerClasses` attribute                 | **JVMS §4.7.6**                        |
| `EnclosingMethod` attribute              | **JVMS §4.7.7**                        |
| `NestHost` / `NestMembers` attributes    | JVMS §4.7.28, §4.7.29                  |
| `Synthetic` attribute / flag             | JVMS §4.7.8                            |

---

## 2. JLS §8.5 — Member type declarations

> *A class or interface type declared as a member of another class or interface is called a member type. A member type may be a class, an enum, an interface, an annotation type, or a record type.*

Key rules:

- A static nested member type: `static class Foo { ... }` or `static interface Foo { ... }`. Does not have an enclosing instance.
- An inner member type: `class Foo { ... }` (no `static`). Has an enclosing instance accessible via `Outer.this`.
- Member types of an interface are implicitly `public` and `static`.
- A nested record is implicitly `static` (records cannot capture enclosing instances).

---

## 3. JLS §14.3 — Local class declarations

A local class is a class declared inside a block (typically a method or initializer):

```java
void method() {
    class Foo { ... }
    new Foo();
}
```

Constraints:

- Cannot have access modifiers (`public`, `private`, etc.) — they're inherently scoped to the block.
- Cannot be `static` (until Java 16+ which relaxed this slightly).
- Can capture *effectively final* local variables and parameters.
- Can access enclosing class's instance and static members.
- Have an `EnclosingMethod` attribute in the class file pointing to their enclosing method.

In modern Java, local classes are largely replaced by lambdas (for behavior) or extracted classes (for reuse).

---

## 4. JLS §15.9 — Class instance creation expressions

> *Anonymous class declarations are automatically derived from a class instance creation expression by the compiler.*

The form `new T() { ... }` does two things:

1. Declares an anonymous class extending `T` (or implementing `T` if `T` is an interface).
2. Instantiates it.

Constraints:

- Can only extend one class or implement one interface.
- Cannot have explicit constructors (the constructor is implicit, taking the same parameters as `T`'s constructor).
- Can access effectively final locals.
- Get auto-generated names (`Outer$1`, `Outer$2`, etc.).

---

## 5. JLS §15.27 — Lambda expressions

> *A lambda expression denotes either a value of a functional interface type (§9.8) or a value of a primitive type, when the target type is a functional interface type.*

Key rules:

- Target type must be a functional interface (single abstract method).
- Captures effectively final locals (same rule as anonymous classes).
- Compiled via `invokedynamic` referring to `LambdaMetafactory`.
- The actual implementation class is generated at runtime as a hidden class.

Lambdas are *not* nested classes per se — they're a separate language feature with similar capture semantics.

---

## 6. JLS §4.12.4 — Effectively final

A variable is *effectively final* if:

- It is never assigned after initialization.
- (For `for`-loop variables) it is never reassigned in the loop body.

Lambdas and local/anonymous classes can capture either:

- Variables explicitly declared `final`.
- Variables that are effectively final.

The JLS §15.27.2 specifies this for lambdas; §15.9 specifies it for anonymous classes.

---

## 7. JVMS §4.7.6 — `InnerClasses` attribute

```
InnerClasses_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    {   u2 inner_class_info_index;        // pool index of the inner class
        u2 outer_class_info_index;         // pool index of the outer class (or 0)
        u2 inner_name_index;                // simple name (or 0 for anonymous)
        u2 inner_class_access_flags;        // access flags
    } classes[number_of_classes];
}
```

This attribute appears on:

- The outer class, listing its nested classes.
- Each nested class, recording its outer.

Reflection (`Class.getDeclaredClasses()`, `Class.getEnclosingClass()`) reads this.

---

## 8. JVMS §4.7.7 — `EnclosingMethod` attribute

```
EnclosingMethod_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 class_index;
    u2 method_index;        // 0 if not enclosed in a method
}
```

Local and anonymous classes have this attribute pointing to the enclosing method (or 0 if declared in a constructor or initializer). Reflection (`Class.getEnclosingMethod()`) reads it.

---

## 9. JVMS §4.7.28–§4.7.29 — Nest attributes (Java 11+)

`NestHost`:

```
NestHost_attribute {
    u2 attribute_name_index;
    u4 attribute_length;        // 2
    u2 host_class_index;
}
```

`NestMembers`:

```
NestMembers_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    u2 classes[number_of_classes];
}
```

These attributes mark classes as belonging to the same *nest*. JVMS §5.4.4 allows `private` access between nest members without bridge methods.

Inspect with `javap -v`. The compiler emits these for top-level classes (which become their own nest) and for nested types.

---

## 10. JVMS §4.7.8 — `Synthetic` flag and attribute

```
ACC_SYNTHETIC = 0x1000
```

Marks fields, methods, and classes as compiler-generated. Examples:

- The `this$0` field on inner classes.
- Bridge methods (also `ACC_BRIDGE`).
- Anonymous class constructors (sometimes).

Reflection uses `Modifier.isSynthetic` to filter these out — most users don't want compiler-generated members in their reflection output.

---

## 11. The implicit `this$0` field

For non-static inner classes, the compiler generates a synthetic field:

```
final synthetic LOuter; this$0;
```

Set by the constructor (which takes the outer instance as a hidden first parameter). The verifier accepts the field name `this$0` (per the synthetic-name conventions documented in informal compiler docs, not the JVMS itself).

For nested classes inside multiple levels: `this$1`, `this$2`, etc., each pointing to the appropriate enclosing instance.

---

## 12. JLS §15.9.5 — Capture of `this`

When an anonymous or local class is created in an instance method or constructor of a class, it captures *that* instance's `this` as `this$0`. When created in a static method, no enclosing instance exists; the class is effectively static.

```java
public class Outer {
    public Runnable inInstance() {
        return new Runnable() { public void run() {} };  // captures Outer.this
    }
    public static Runnable inStatic() {
        return new Runnable() { public void run() {} };  // no Outer.this
    }
}
```

The `inStatic` version is structurally a "static anonymous class" — though Java doesn't have explicit syntax for it.

---

## 13. JLS §8.10 — Records and nesting

> *A record class is implicitly final.*
>
> *A nested record class is implicitly static.*

So when you write:

```java
public class Outer {
    public record Pair(int a, int b) {}
}
```

`Pair` is `public static final` — both static and final, even though you didn't write either.

This makes records the canonical form for nested value types.

---

## 14. JLS §8.1.1.4 — Sealed classes nesting

```java
public sealed interface Result permits Result.Ok, Result.Err {
    record Ok(Object value) implements Result {}
    record Err(String error) implements Result {}
}
```

Per JLS:

- A sealed type's `permits` clause lists permitted direct subtypes.
- Permitted subtypes can be nested (and often are, for cohesion).
- Each permitted subtype must declare exactly one of: `final`, `sealed` (with its own permits), `non-sealed`.

The compiler emits a `PermittedSubclasses` attribute (JVMS §4.7.31) listing the permitted subtypes.

---

## 15. The grammar of nested type declarations

Simplified:

```
ClassBody:
    { { ClassBodyDeclaration } }

ClassBodyDeclaration:
    ClassMemberDeclaration
    InstanceInitializer
    StaticInitializer
    ConstructorDeclaration

ClassMemberDeclaration:
    FieldDeclaration
    MethodDeclaration
    ClassDeclaration               // nested class
    InterfaceDeclaration            // nested interface
    EnumDeclaration                 // nested enum
    RecordDeclaration                // nested record
    ;
```

Nested types are first-class members of their enclosing class. They appear alongside fields and methods in the declaration order.

---

## 16. Reading order

1. **JLS §8.5** — member types.
2. **JLS §14.3** — local classes.
3. **JLS §15.9** — anonymous classes.
4. **JLS §15.27** — lambdas.
5. **JLS §4.12.4** — effectively final / capture rules.
6. **JVMS §4.7.6, §4.7.7, §4.7.28-29** — class file attributes.

Most of these sections are short. Understanding them resolves 95% of "how does this nesting work?" questions.

---

## 17. The takeaway

Nested classes are governed by a small set of rules that span language and bytecode:

- **Language**: which can be `static`, which can capture, which can have access modifiers.
- **Compiler**: synthesizes `this$0`, `EnclosingMethod`, `InnerClasses`, `NestHost`/`NestMembers`.
- **Bytecode**: each nested type is a separate `.class` file with attributes linking to its parent.
- **JVM**: nest mates allow direct private access; lambdas use `invokedynamic` for hidden classes.

Understand the four kinds (static nested, inner, local, anonymous) and their compile/runtime mapping, and nested-class behavior becomes predictable.
