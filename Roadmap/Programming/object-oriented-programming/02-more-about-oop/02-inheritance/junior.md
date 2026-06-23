# Inheritance — Junior

> **What?** Inheritance is the mechanism by which one class (the *subclass*) extends another (the *superclass*), automatically gaining its fields and methods, and optionally overriding or adding to them.
> **How?** With the `extends` keyword. A class can extend exactly one other class. Every class that doesn't explicitly extend something extends `Object`.

---

## 1. The simplest example

```java
class Animal {
    String name;
    void breathe() { System.out.println(name + " breathes"); }
}

class Dog extends Animal {
    void bark() { System.out.println(name + " barks"); }
}

Dog d = new Dog();
d.name = "Rex";
d.breathe();   // inherited from Animal
d.bark();      // declared in Dog
```

`Dog` is-a `Animal`. Every `Dog` has every member that `Animal` has, plus its own additions. The phrase **"is-a"** is the core test for inheritance: only inherit when "B is-a kind of A" makes sense in your domain.

---

## 2. What gets inherited

| Member             | Inherited?                                       |
|--------------------|--------------------------------------------------|
| Public fields      | Yes                                              |
| Protected fields   | Yes (same package or subclass)                   |
| Package-private    | Yes within the same package                      |
| Private fields     | **No** — exist in the parent but invisible       |
| Public methods     | Yes                                              |
| Protected methods  | Yes (same package or subclass)                   |
| Private methods    | No                                               |
| Constructors       | **Never inherited** — but called via `super(...)` |
| Static members     | Accessible via the subclass name (not "inherited" in the OO sense) |

A subclass cannot directly access its parent's `private` fields, but it can call public/protected getter/setter methods that operate on them.

---

## 3. The `Object` root

Every class in Java extends `Object` directly or transitively. So every object has these methods inherited from `Object`:

- `equals(Object)`
- `hashCode()`
- `toString()`
- `getClass()`
- `wait()`, `notify()`, `notifyAll()` (legacy concurrency)
- `clone()` (protected; rarely used)
- `finalize()` (deprecated; do not override)

This is why you can call `myDog.toString()` even though `Dog` didn't declare it — it inherits the version from `Object`.

---

## 4. Constructors and inheritance

A subclass constructor must call a parent constructor first. If you don't write one, the compiler inserts an implicit `super()`:

```java
class Animal {
    Animal() { System.out.println("Animal ctor"); }
}
class Dog extends Animal {
    Dog() {                       // implicit super() here
        System.out.println("Dog ctor");
    }
}

new Dog();
// Animal ctor
// Dog ctor
```

If `Animal` only has constructors that take arguments, you must call `super(...)` explicitly:

```java
class Animal {
    Animal(String name) { /* ... */ }
}
class Dog extends Animal {
    Dog(String name) {
        super(name);              // required — Animal has no no-arg ctor
    }
}
```

---

## 5. Method overriding

A subclass can replace an inherited method's implementation by **overriding** it:

```java
class Animal {
    void speak() { System.out.println("..."); }
}
class Dog extends Animal {
    @Override
    void speak() { System.out.println("Woof"); }
}
class Cat extends Animal {
    @Override
    void speak() { System.out.println("Meow"); }
}

Animal a = new Dog();
a.speak();    // Woof — runtime decides based on actual object type
```

The `@Override` annotation tells the compiler "I intend to override; check me." If you misspell the name or change the signature, the compiler errors. **Always use `@Override`.**

---

## 6. The `super` keyword

`super` refers to the parent class. Two main uses:

**Call parent's method from inside an override:**

```java
class Dog extends Animal {
    @Override
    void speak() {
        super.speak();             // call Animal.speak()
        System.out.println("then woof");
    }
}
```

**Call parent's constructor from inside subclass constructor:**

```java
class Dog extends Animal {
    Dog(String name) {
        super(name);               // first statement
    }
}
```

---

## 7. Polymorphism: a reference to the parent type can hold any subclass

```java
Animal a;
a = new Dog();
a = new Cat();
a = new Animal();
```

This is the foundation of polymorphism. A method that takes `Animal` can accept any subclass. A list `List<Animal>` can hold dogs and cats. Method calls dispatch to the *actual* runtime type:

```java
List<Animal> zoo = List.of(new Dog(), new Cat(), new Animal());
for (Animal a : zoo) a.speak();   // Woof / Meow / ...
```

This is *dynamic dispatch* — handled by the JVM. We dive into the mechanism in `senior.md` and the dedicated **Static vs Dynamic Binding** topic.

---

## 8. The `final` modifier

You can prevent inheritance or overriding:

- **`final` class:** cannot be extended. `String`, `Integer`, etc. are final.
- **`final` method:** cannot be overridden by subclasses.
- **`final` field:** cannot be reassigned after initialization.

```java
final class Money { /* nothing extends Money */ }

class Account {
    final void close() { /* subclasses can't override */ }
}
```

Use `final` when extension would break invariants (security-sensitive, immutability-sensitive types).

---

## 9. Casting between types in a hierarchy

**Upcast (always safe, often implicit):**

```java
Dog d = new Dog();
Animal a = d;          // implicit upcast
```

**Downcast (manual, can fail at runtime):**

```java
Animal a = new Dog();
Dog d = (Dog) a;       // works because a actually IS a Dog
```

```java
Animal a = new Cat();
Dog d = (Dog) a;       // ClassCastException at runtime
```

Java 16+ has *pattern matching for instanceof*:

```java
if (a instanceof Dog d) {
    d.bark();           // d is bound to the cast Dog inside this branch
}
```

This is safer than manual casting and reads better.

---

## 10. Single inheritance, multiple interfaces

A class extends **at most one** other class but can implement many **interfaces**:

```java
class Dog extends Mammal implements Trainable, Walker {
    /* ... */
}
```

Interfaces are covered in their own topic. The key lesson here: Java forbids multiple class inheritance to avoid the "diamond problem" (which parent's method should I inherit?). Interfaces with default methods solve it via explicit conflict resolution.

---

## 11. Composition vs inheritance

> "Favor composition over inheritance" — Effective Java, Item 18.

Inheritance is *tightly coupled*: a subclass depends on its parent's implementation details. If the parent changes, subclasses break. Composition (holding a member and forwarding to it) is *loosely coupled*.

**Inheritance:**
```java
class Stack<E> extends ArrayList<E> {       // BAD — Stack inherits all List methods
    public void push(E e) { add(e); }
}
```

`Stack` now leaks every `ArrayList` method (`add`, `set`, `remove(int)`) — users can corrupt the stack invariants.

**Composition:**
```java
class Stack<E> {
    private final ArrayList<E> data = new ArrayList<>();
    public void push(E e) { data.add(e); }
    public E pop() { return data.remove(data.size() - 1); }
}
```

Now only the methods you publish are visible. Use inheritance only when the subclass is truly an *extension* of the parent, not a *use* of it.

---

## 12. Common newcomer pitfalls

**Pitfall 1: shadowing fields instead of overriding**

```java
class Animal { int legs = 4; }
class Snake extends Animal { int legs = 0; }     // SHADOW, not override

Animal a = new Snake();
System.out.println(a.legs);    // 4 — fields are dispatched statically
```

Fields are *not* polymorphic. Always use methods (and getters) for polymorphic behavior.

**Pitfall 2: accidentally overloading instead of overriding**

```java
class Animal { void speak() { } }
class Dog extends Animal { void speak(String volume) { } }   // overload, not override
```

Without `@Override`, you wouldn't notice. Always use `@Override`.

**Pitfall 3: assuming subclass constructor "inherits" parent's**

```java
class Animal { Animal(String name) { } }
class Dog extends Animal { /* no ctor */ }     // compile error: implicit super() not found
```

Constructors are not inherited. You either get the parent's no-arg or you write `super(...)` explicitly.

---

## 13. When to use inheritance

Use it when:
- "B is-a A" is true in the domain (Dog is-a Animal)
- B reuses A's behavior nearly verbatim, with small variations
- A is designed for extension (`open` in Kotlin, documented hooks in Java)
- Polymorphism through A's reference is needed (collections of A holding B's, methods accepting A)

Avoid it when:
- "B has-a A" or "B uses A" — use composition
- Reusing A's code by extending is a shortcut to skip writing the right abstraction
- A wasn't designed for extension (no `protected` hooks, undocumented invariants, marked `final`)

---

## 14. Quick reference

| Keyword       | Meaning                                              |
|---------------|------------------------------------------------------|
| `extends`     | "this class is a subclass of …"                       |
| `super`       | reference to parent's constructor, method, or field   |
| `super(...)`  | call parent's constructor                              |
| `super.X`     | call parent's method `X` or read parent's field `X`   |
| `final`       | cannot be extended/overridden/reassigned              |
| `@Override`   | annotation: "I intend to override the parent's method" |
| `instanceof`  | runtime type check (also pattern-matching syntax)     |

---

## 15. What's next

| Question                                           | Read              |
|----------------------------------------------------|-------------------|
| How does dynamic dispatch actually work?           | `senior.md`        |
| What is the Liskov Substitution Principle?         | `middle.md`        |
| Multiple inheritance via interfaces, default methods | `06-interfaces`   |
| Sealed classes (Java 17+)                           | `senior.md`        |
| The diamond problem and how Java prevents it       | `professional.md`  |

---

**Memorize this**: Inheritance models *is-a*. Use `extends` only when the subclass truly is a kind of the parent. Use `@Override` to make intent explicit. Use composition by default; inheritance is the special case, not the default.
