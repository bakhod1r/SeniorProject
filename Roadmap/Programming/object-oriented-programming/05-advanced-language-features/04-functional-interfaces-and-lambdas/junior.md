# Functional Interfaces and Lambdas — Junior

> **What?** A *functional interface* is an interface with exactly one abstract method — a SAM (Single Abstract Method). A *lambda expression* is a compact literal that creates an instance of such an interface without writing a named class. Together they let you pass behaviour the same way you pass a value.
> **How?** Annotate the interface with `@FunctionalInterface` so the compiler checks the SAM rule; then write `(args) -> body` wherever a method expects that interface. Use a method reference (`ClassName::method`) when the body would do nothing but call an existing method.

---

## 1. Why functional interfaces exist

Before Java 8, "passing behaviour" meant writing an anonymous inner class:

```java
Runnable r = new Runnable() {
    @Override public void run() {
        System.out.println("hello");
    }
};
```

Five lines of ceremony around one line of intent. Java 8 introduced lambdas (JEP 126) precisely to flatten this — but the type system stayed nominal. You can't write a lambda "in a vacuum"; every lambda needs a *target type*, and that target type must be a functional interface.

A functional interface is just any interface with **one** abstract method. `Runnable`, `Callable<V>`, `Comparator<T>`, `Function<T,R>` — all of them qualify. The compiler doesn't care about the *name* of the method; it cares that there is exactly one.

```java
@FunctionalInterface
public interface Greeter {
    String greet(String name);
}
```

The `@FunctionalInterface` annotation (JLS §9.8) is *optional* but recommended — `javac` issues an error if the interface accidentally grows a second abstract method, so future maintainers cannot break the lambda use sites.

---

## 2. Your first lambda

The shape is `(parameters) -> body`. The body is either a single expression (its value is returned) or a `{}` block (you write `return` yourself).

```java
Greeter g1 = (String name) -> "Hello, " + name + "!";
Greeter g2 = name -> "Hi, " + name;                          // type inferred
Greeter g3 = (String name) -> { return "Hey, " + name; };    // block body

System.out.println(g1.greet("Bakhodir"));   // Hello, Bakhodir!
```

Three things to notice:

- Parameter types may be omitted when the compiler can infer them from the target type.
- Single-parameter lambdas may drop the parentheses (`name -> ...`); zero- or multi-parameter ones may not.
- A block body uses `return`; an expression body does not.

A second canonical example uses the JDK's `Function<T,R>`:

```java
Function<Integer, Integer> increment = x -> x + 1;
System.out.println(increment.apply(10));   // 11
```

`Function<T,R>` is defined in `java.util.function` (specification.md will list the full family). Its SAM is `R apply(T t)`. Lambdas of the right shape — one argument in, one value out — fit it automatically.

---

## 3. Common JDK functional interfaces (the short list)

| Interface              | SAM                            | Use it when…                              |
|------------------------|--------------------------------|--------------------------------------------|
| `Function<T,R>`        | `R apply(T t)`                 | Transform one value into another           |
| `Consumer<T>`          | `void accept(T t)`             | Do something with a value, return nothing  |
| `Supplier<T>`          | `T get()`                      | Produce a value on demand                  |
| `Predicate<T>`         | `boolean test(T t)`            | Yes/no question about a value              |
| `UnaryOperator<T>`     | `T apply(T t)`                 | Transform a value to the same type         |
| `BinaryOperator<T>`    | `T apply(T t1, T t2)`          | Combine two values of the same type        |
| `BiFunction<T,U,R>`    | `R apply(T t, U u)`            | Transform two inputs into one output       |
| `Runnable`             | `void run()`                   | A no-arg, no-result action                 |

```java
Predicate<String> isBlank   = s -> s == null || s.isBlank();
Consumer<String>  println   = System.out::println;
Supplier<UUID>    randomId  = UUID::randomUUID;
UnaryOperator<String> trim  = String::trim;
```

Whenever you reach for `new SomeInterface() { ... }`, ask first: does one of these already say what I mean?

---

## 4. Method references — the four flavours

If the entire body of a lambda is *just calling an existing method*, replace it with a method reference. There are four flavours (JLS §15.13):

```java
// 1. Static method reference — ClassName::staticMethod
Function<String, Integer> parse = Integer::parseInt;

// 2. Bound instance method reference — instance::method
String prefix = "Hello, ";
Function<String, String> greet = prefix::concat;

// 3. Unbound instance method reference — ClassName::instanceMethod
Function<String, Integer> length = String::length;
//   equivalent to: s -> s.length()

// 4. Constructor reference — ClassName::new
Supplier<ArrayList<String>> mkList = ArrayList::new;
```

Use a method reference when it makes the call site read as a noun phrase ("parse this", "lengths"). When the lambda contains *any* logic beyond the call (a cast, an `if`, an extra argument), keep the lambda.

```java
list.forEach(System.out::println);            // a noun: "print each one"
list.forEach(x -> System.out.println("> " + x));   // logic — keep the lambda
```

---

## 5. Capturing local variables

A lambda may *capture* variables from its enclosing method. The rule (JLS §15.27.2) is strict: the captured variable must be **final or effectively final**.

```java
String tag = "user";          // effectively final — never reassigned
Consumer<String> log = msg -> System.out.println(tag + ": " + msg);
log.accept("logged in");      // user: logged in
```

"Effectively final" means: the variable is *not* declared `final`, but the compiler can see it is never reassigned after its initialiser. You don't need the `final` keyword — but you can add it for documentation, and many style guides do.

Try to reassign and the compiler refuses:

```java
int counter = 0;
Runnable r = () -> counter++;          // compile error: variable used in
                                       // lambda should be final or effectively final
counter = 1;                           // reassignment that disqualifies it
```

If you genuinely need a mutable counter, use a holder object:

```java
int[] count = {0};
Runnable r = () -> count[0]++;         // legal — the array reference is final;
                                       // its contents are not
```

Or, more idiomatically, an `AtomicInteger` if multiple threads are involved.

**Why?** A lambda may outlive the method that created it (think `executor.submit(...)`). If the lambda referred to a *mutable* stack variable, by the time it ran, the variable would no longer exist. Java sidesteps this by copying the value at capture time — which is only safe if the value can't change.

---

## 6. Common newcomer surprises

**Surprise 1: `final` is optional.** Many older tutorials wrote `final String tag = "..."`. Since Java 8, the `final` keyword is *not* required for captured locals — *effectively* final is enough. Both styles work.

**Surprise 2: `this` inside a lambda is the enclosing class.** Unlike anonymous inner classes, a lambda does **not** introduce its own `this`. Inside a lambda, `this` refers to the *outer* class instance.

```java
class Service {
    private final String name = "svc";

    Runnable hello() {
        return () -> System.out.println(this.name);    // Service.this, not the lambda
    }
}
```

This is usually what you want. (Senior.md covers the case where it isn't.)

**Surprise 3: lambdas need a target type.** You can't write a "bare" lambda:

```java
var r = () -> 42;     // compile error: lambda not expected here
                      // (cannot infer functional interface)
```

The compiler needs a context — an assignment to a functional-interface-typed variable, a method argument, a return statement of a functional-interface-typed method, or a cast like `(Supplier<Integer>) () -> 42`.

**Surprise 4: parameter types are usually inferable but sometimes not.** When overload resolution is ambiguous, you must spell them out:

```java
// If foo is overloaded for both Function<String,String> and Function<Integer,String>:
foo(x -> x.toString());                     // ambiguous
foo((String x) -> x.toString());            // explicit — picks the String overload
```

**Surprise 5: an interface with a `default` method is still functional.** `default` and `static` methods do not count toward the SAM rule.

```java
@FunctionalInterface
public interface Pipeline<T> {
    T run(T input);                                   // the SAM
    default Pipeline<T> andThen(Pipeline<T> next) {   // doesn't disqualify
        return x -> next.run(this.run(x));
    }
}
```

`equals`, `hashCode`, and `toString` (inherited from `Object`) are also exempt — they don't count as abstract methods for SAM detection.

---

## 7. A complete, runnable mini-example

```java
import java.util.*;
import java.util.function.*;

public class Demo {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>(List.of("Ada", "Bob", "Cara"));

        // Predicate as a filter:
        Predicate<String> startsWithA = n -> n.startsWith("A");
        names.removeIf(startsWithA);

        // Consumer as iteration:
        names.forEach(System.out::println);

        // Function as a transform (via Stream):
        List<Integer> lengths = names.stream()
                                     .map(String::length)
                                     .toList();
        System.out.println(lengths);
    }
}
```

Every piece of behaviour here — the filter rule, the print step, the length transform — is passed as a value. That is the entire point of functional interfaces and lambdas: behaviour as data.

---

## 8. Quick rules

- [ ] An interface is *functional* if it has **exactly one** abstract method. `default`/`static`/`Object` methods don't count.
- [ ] Annotate with `@FunctionalInterface` so the compiler enforces the SAM rule.
- [ ] Lambda shape: `(args) -> expression` or `(args) -> { block; return v; }`.
- [ ] Captured locals must be *final or effectively final* — no reassignment after the lambda sees them.
- [ ] `this` inside a lambda is the *enclosing class*'s `this`, not the lambda's.
- [ ] Use a method reference when the body would just call an existing method.
- [ ] Reach for `Function`, `Consumer`, `Supplier`, `Predicate` before inventing a new interface.

---

## 9. What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| Refactor anonymous classes; pick the right JDK functional type      | `middle.md`        |
| `invokedynamic`, `LambdaMetafactory`, capture internals             | `senior.md`        |
| Reviewing lambda-heavy PRs; API design with functional types        | `professional.md`  |
| JLS §9.8 / §15.27 / §15.13 and JEP references                       | `specification.md` |
| Ten silent bugs in lambdas                                          | `find-bug.md`      |
| Cold-start, JIT, boxing, primitive specializations                  | `optimize.md`      |
| Exercises                                                          | `tasks.md`        |
| Interview Q&A                                                       | `interview.md`     |

See also: [../03-reflection-and-annotations/](../03-reflection-and-annotations/), [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/), and the lambda-focused chapter at [../../../../05-lambda-expressions/](../../../../05-lambda-expressions/).

---

**Memorize this:** a functional interface is *one abstract method* and nothing more; a lambda is a literal for an instance of one. `(args) -> body` is the same shape every time; *effectively final* captures are the same rule every time; method references are the same four flavours every time. Master those three and the rest is just choosing the right JDK type.
