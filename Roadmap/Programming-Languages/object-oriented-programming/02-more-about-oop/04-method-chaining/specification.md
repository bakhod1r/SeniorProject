# Method Chaining — Specification Deep-Dive

> Chaining isn't a language feature — it's an *idiom* built on existing language rules: method invocation expressions (JLS §15.12), the receiver-based dispatch model (JVMS §6.5), and conventions about return types. This file pulls together the language rules that make chaining work.

---

## 1. Where the rules live

| Concept                          | Source                              |
|----------------------------------|-------------------------------------|
| Method invocation expression     | JLS §15.12                          |
| Receiver of an instance method   | JLS §15.12.4.1                      |
| `this` in instance methods       | JLS §15.8.3                         |
| Return statements                | JLS §14.17                          |
| Method dispatch                  | JVMS §6.5                           |
| Stream contract                  | `java.util.stream.Stream` package Javadoc |
| Optional / functional chains     | `java.util.Optional` package Javadoc |
| Records                          | JLS §8.10                           |
| Generics & self-types            | JLS §4.4, §4.5, §8.1.2              |

---

## 2. JLS §15.12 — method invocation expression

The expression `e.m(args)` is a *method invocation expression*. Its evaluation:

1. Evaluate the *target reference* (`e`).
2. Evaluate the *arguments* in left-to-right order.
3. Determine the method to invoke (by overload resolution).
4. Invoke the method; the result is the value of the expression.

For a chain `a.b().c().d()`:
- Step 1 evaluates `a`.
- The method `b()` is invoked, producing a value.
- That value is the receiver for `c()`.
- And so on.

This is the structural rule that makes chaining work. Each method's *return value* becomes the next receiver.

---

## 3. JLS §15.12.4 — runtime evaluation

Specifically, JLS §15.12.4 states:

> If the form is `Primary.Identifier`, then the Primary expression is evaluated. If the result is null, a NullPointerException is thrown.

So `a.b().c()` throws NPE if `a` is null *or* if `b()` returns null. This is the source of the "billion dollar mistake" in chained calls.

---

## 4. JLS §14.17 — return statement

> A `return` statement with an Expression must be contained in a method declaration that is declared to return a value (§8.4) [...] The value of the Expression must be assignable to the declared return type of the method.

For `return this`, the type of `this` is the enclosing class type. Hence the method's return type must be that class (or a supertype).

For chained generic self-types, the return type is the type parameter `T` (which extends the enclosing class).

---

## 5. JLS §15.8.3 — `this`

Inside a non-static method or constructor, `this` is a *final local variable* of the type of the enclosing class:

> The value of `this` is a reference to the object being acted on.

`return this` returns this reference, which is bound to the receiver of the call. The chain continues.

---

## 6. Evaluation order in a chain

Per JLS §15.7.1, "Evaluate Operands":

> The Java programming language guarantees that the operands of operators appear to be evaluated in a specific evaluation order, namely, from left to right.

For `a.b().c(args)`:
- `a.b()` is evaluated (left operand).
- Then `args` are evaluated.
- Then `c` is invoked.

This means side effects in `a.b()` happen before any args of `c` are evaluated. Important when chains have impurities.

---

## 7. Generic self-types (JLS §4.4)

A type parameter `T extends Animal<T>` is called *F-bounded*. Its purpose: give the parent class a way to refer to the subclass type without losing static type info.

```java
class Animal<T extends Animal<T>> {
    public T name(String n) { /* ... */ return (T) this; }
}
```

The JLS allows this; the cast `(T) this` is unchecked. The compiler emits an unchecked-cast warning. In practice, F-bounded self-types are correct as long as subclasses follow the convention `class Dog extends Animal<Dog>`.

---

## 8. Records (JLS §8.10)

Records are implicitly final and immutable. They auto-generate accessors and `equals`/`hashCode`. They don't auto-generate `withX` methods, so for chained "modify and return new" you write them manually.

```java
public record User(String name, int age) {
    public User withName(String name) { return new User(name, age); }
}
```

Each `withX` is a regular method returning a new record. Chains compose naturally.

---

## 9. Stream contract (`java.util.stream.Stream` Javadoc)

> A stream pipeline consists of a source, zero or more intermediate operations, and a terminal operation. Intermediate operations are always lazy: executing an intermediate operation does not actually perform any filtering, but instead creates a new stream that, when traversed, contains the elements of the initial stream that match the given predicate.

This contract is what makes stream chains work as a pipeline. Each intermediate op returns a new `Stream<T>`. The terminal op is what actually iterates.

---

## 10. Optional contract (`java.util.Optional` Javadoc)

> Optional is primarily intended for use as a method return type where there is a clear need to represent "no result," and where using null is likely to cause errors.

Chained ops: `map`, `flatMap`, `filter`, `or`, `ifPresent`, `orElse`, `orElseThrow`. Each non-terminal returns a new Optional. Use `Optional` for missing values, not as a general-purpose container.

---

## 11. CompletableFuture contract

Each `thenX` returns a new `CompletableFuture` that completes when the previous step does (with the transformed value). The chain forms a linked list of completion stages.

Spec: JEP 155 (Java 8) introduced `CompletionStage` as the underlying abstraction; `CompletableFuture` is the concrete implementation.

---

## 12. Builder pattern conventions

Not in any spec, but widespread:

- `static Builder builder()` — entry point
- `Builder` is a separate class, not the target type
- Each setter returns `this` (or a stage type)
- `build()` returns the final immutable object
- Builder is single-use; reuse is implementation-defined

The Effective Java book (Item 2) is the closest thing to a "spec" for builders.

---

## 13. The Demeter rule (informal)

Not in JLS. From Lieberherr's "Object-Oriented Programming: An Objective Sense of Style":

> A method M of an object O may only invoke methods of the following kinds:
> - O itself
> - M's parameters
> - Objects created within M
> - O's direct component objects

A chain `a.b().c().d()` violates the principle if `b()` and `c()` are accessor calls revealing structure. (Fluent chains where each step returns the same conceptual entity are OK.)

We cover this in the *Couplers* topic.

---

## 14. Reading order

1. JLS §15.12 — method invocation
2. JLS §15.7 — evaluation order
3. JLS §14.17 — return statement
4. JLS §15.8.3 — this
5. JLS §4.4-§4.5 — generic types and bounded type parameters
6. JLS §8.10 — records
7. JVMS §6.5 — invokevirtual/invokeinterface
8. `java.util.stream` package Javadoc
9. `java.util.Optional` Javadoc
10. `java.util.concurrent.CompletableFuture` Javadoc

---

**Memorize this**: chaining is built on JLS's method invocation rules and the convention of returning a usable receiver. Left-to-right evaluation order matters when steps have side effects. Records, sealed types, and self-types interact with chaining at the type-system level. Streams, Optional, and CompletableFuture each define their own chainable contract.
