# Default Methods and the Diamond Problem — Junior

> **What?** A *default method* is an instance method declared on an `interface` with a body. Java 8 added them (JEP 126) so libraries could grow new interface methods *without breaking* every existing implementor. The *diamond problem* is what happens when one class inherits two unrelated defaults with the same signature — Java forces you to resolve it explicitly.
> **How?** Add `default` before the method header inside an interface and write the body. When you implement two interfaces that supply conflicting defaults, override the method in your class and call the one you want with `InterfaceName.super.method()`.

---

## 1. One example in 20 lines

```java
public interface Greeter {
    String name();

    default String greet() {
        return "Hello, " + name() + "!";
    }
}

public class EnglishGreeter implements Greeter {
    public String name() { return "Sam"; }
    // no greet() needed — inherited from the interface as a default
}

public static void main(String[] args) {
    System.out.println(new EnglishGreeter().greet());   // Hello, Sam!
}
```

The interface ships a working `greet()` body. Any class implementing `Greeter` only has to supply `name()`. Before Java 8 this was impossible — every method on an interface was abstract, so adding `greet()` to a published library interface would break every existing implementor at recompile time.

---

## 2. Why default methods exist — the library evolution story

Imagine the JDK team in 2014 wanting to add `forEach` to `java.util.Collection`. There were millions of existing classes out there in the wild implementing `Collection`. If `forEach` were abstract, every one of them would fail to compile against Java 8.

The fix was *default methods*. The new method was added with a body:

```java
default void forEach(Consumer<? super T> action) {
    for (T t : this) action.accept(t);
}
```

Now every old `Collection` keeps compiling — it inherits the default. Implementations that want a faster version (`ArrayList`, `HashSet`) override it. **Default methods are how interfaces evolve without breaking implementors.** Keep that one sentence in your head; the rest of this file is consequences.

---

## 3. The diamond problem in pictures

Two unrelated interfaces both declare `default String describe()`:

```java
public interface Walker {
    default String describe() { return "I walk."; }
}
public interface Swimmer {
    default String describe() { return "I swim."; }
}

public class Duck implements Walker, Swimmer { }   // compile error
```

The compiler can't pick one for you — both defaults are equally specific. The error message names both candidates and refuses to choose. This is the *diamond problem*: two inheritance paths into the same method signature, no rule to break the tie.

C++ has the same shape and tried to solve it with `virtual` inheritance. Java said: *make the programmer disambiguate explicitly*.

---

## 4. Resolving the diamond — `InterfaceName.super.method()`

You override the conflicting method in the class and choose which path to invoke:

```java
public class Duck implements Walker, Swimmer {
    @Override
    public String describe() {
        return Walker.super.describe() + " And " + Swimmer.super.describe();
    }
}

new Duck().describe();   // "I walk. And I swim."
```

`Walker.super.describe()` means "the `describe` default declared on `Walker`". The general syntax is `InterfaceName.super.method(args)`. It is the only way to reach a specific interface's default once your class has multiple candidates.

You can also just pick one:

```java
public class Duck implements Walker, Swimmer {
    @Override
    public String describe() { return Walker.super.describe(); }
}
```

Or write something entirely new and ignore both defaults. The point: the compiler forces a deliberate choice.

---

## 5. The two rules you must memorise

Java's resolution algorithm is short. When the compiler picks an implementation for an interface method:

1. **Classes win over interfaces.** A method declared on the class (or inherited from a superclass) always beats any interface default.
2. **More specific interfaces win.** If interface `B extends A` and both supply a default for `m()`, `B`'s default wins because `B` is more specific.
3. **Otherwise, conflict.** The implementer must override and resolve manually with `super` syntax.

Rule 1 is the most important. Newcomers often expect interface defaults to override an inherited class method — they don't. The class hierarchy always wins.

```java
public class Base {
    public String describe() { return "from class"; }
}
public interface Talker {
    default String describe() { return "from interface"; }
}
public class Child extends Base implements Talker { }

new Child().describe();   // "from class" — class wins, no compile error
```

---

## 6. Common newcomer surprises

**Default methods can't be `static`.** A `static` interface method is a different feature (also Java 8) and is *not inherited* by implementing classes. You call it as `Interface.method()`, never as `obj.method()`. Mixing the two up is the most common confusion.

```java
public interface Maths {
    static  int squareS(int x) { return x * x; }       // static, not inherited
    default int squareD(int x) { return x * x; }       // default, inherited
}

public class Calc implements Maths { }

Maths.squareS(3);          // OK
new Calc().squareD(3);     // OK
// new Calc().squareS(3);  // compile error — static is not inherited
```

**Default methods can't override `Object` methods.** `equals`, `hashCode`, and `toString` cannot be made `default`. JLS §9.4.3 forbids it explicitly — every class already inherits these from `Object`, and rule 1 (classes win) means an interface default could never be reached anyway. The compiler rejects the declaration outright.

**Default methods don't carry state.** Interfaces cannot have instance fields. A default method can only read state through methods the implementer provides (`name()` in section 1). This is the deliberate difference between *behaviour reuse* (defaults are fine for it) and *state inheritance* (still class-only).

**Default doesn't mean "use this if you forget".** It means "this is the implementation unless you override it". Defaults are inherited like any other method — they're not fallbacks the compiler ignores when convenient.

---

## 7. When you'll actually use a default method

The honest answer for a junior: rarely, on day one. The pattern you'll see most often is:

- An interface defines a single abstract method (the SAM) like `String name()`.
- The interface supplies one or two *derived* methods as defaults that build on the SAM: `default String greet() { return "Hello, " + name(); }`.
- Implementors only have to supply `name()` and get `greet()` for free.

The other pattern is *library evolution* — adding a method to an interface that already exists in production code, supplying a sensible default to keep old implementors compiling. You don't write that pattern often, but you read it constantly in the JDK (`Collection.forEach`, `Map.getOrDefault`, `Iterator.remove`).

---

## 8. Quick rules

- [ ] Use `default` to add a method to an interface *without breaking implementors*.
- [ ] If two interfaces give conflicting defaults, override and call `Interface.super.method()` explicitly.
- [ ] **Classes win over interfaces.** Class-side methods always beat interface defaults.
- [ ] **More specific interface wins.** Sub-interface default beats parent-interface default.
- [ ] Default methods can't be `static` and can't override `Object` methods (`equals`, `hashCode`, `toString`).
- [ ] Interfaces still cannot have instance fields — defaults give you behaviour reuse, not state inheritance.
- [ ] If you find yourself adding three default methods to one interface, you probably want a class — or composition. See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

## 9. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Library evolution, resolution rules with worked examples         | `middle.md`        |
| FBCP, binary compatibility, records, sealed types                | `senior.md`        |
| Code review, ArchUnit rules, library discipline                  | `professional.md`  |
| JLS §9.4.3 / §8.4.8 / §9.4.1, JEP 126, JEP 213                   | `specification.md` |
| Ten broken default-method snippets                               | `find-bug.md`      |
| Bytecode, `invokeinterface`, JIT inlining of defaults            | `optimize.md`      |
| Hands-on refactors                                               | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** a default method is an interface method with a body, added for *library evolution without breakage*. When two unrelated defaults collide, override the method and pick one with `Interface.super.m()`. Classes always win over interface defaults; more specific interfaces win over less specific ones. Default methods are *not* static, *not* `equals`/`hashCode`/`toString`, and *not* state — they are reusable behaviour you can hang on a type.
