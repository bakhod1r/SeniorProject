# Classes and Objects — Junior

> **What?** A *class* is a blueprint that describes a kind of thing — its data and the operations on that data. An *object* is a concrete instance of that blueprint living in memory at runtime.
> **How?** You declare a class with the `class` keyword, define fields and methods inside it, and create objects with the `new` operator.

---

## 1. The two-line mental model

```java
class Dog {                  // blueprint
    String name;             // data each dog has
    void bark() {            // behavior every dog can do
        System.out.println(name + " says woof");
    }
}

Dog rex = new Dog();         // instance #1 in memory
Dog buddy = new Dog();       // instance #2 — separate from rex
rex.name = "Rex";
buddy.name = "Buddy";
rex.bark();                  // Rex says woof
buddy.bark();                // Buddy says woof
```

`Dog` is the class. `rex` and `buddy` are objects. Each object has its own copy of `name`. The method `bark()` exists once (in the class), but when called via `rex` or `buddy`, the implicit `this` reference points to whichever instance you used.

---

## 2. Anatomy of a class declaration

```java
public class BankAccount {

    // 1. fields (instance variables)
    private String owner;
    private long balanceCents;

    // 2. constructor — runs once when `new` is used
    public BankAccount(String owner, long openingBalanceCents) {
        this.owner = owner;
        this.balanceCents = openingBalanceCents;
    }

    // 3. instance methods — operate on the object's data
    public void deposit(long cents) {
        balanceCents += cents;
    }

    public long getBalanceCents() {
        return balanceCents;
    }
}
```

| Part            | Meaning                                                       |
|-----------------|---------------------------------------------------------------|
| `public class`  | The class is visible everywhere; file must be `BankAccount.java` |
| field           | Per-object data; lives in the heap inside the object           |
| constructor     | Special "method" with the class's name and no return type     |
| instance method | Operates on `this` — the receiving object                     |

---

## 3. Creating objects: the `new` operator

```java
BankAccount alice = new BankAccount("Alice", 10_000);
```

Three things happen, in this order:

1. **Allocate** memory on the heap big enough for a `BankAccount`.
2. **Initialize** all fields to their default values (`0`, `null`, `false`).
3. **Run the constructor** body, then return a *reference* to the new object.

The variable `alice` does **not** hold the object itself — it holds a *reference* (a pointer) to the object on the heap.

```
stack                heap
┌──────────┐         ┌──────────────────────┐
│ alice ───┼────────▶│ BankAccount          │
└──────────┘         │  owner: "Alice"      │
                     │  balanceCents: 10000 │
                     └──────────────────────┘
```

---

## 4. The `this` keyword

`this` is an automatic reference to the current object inside an instance method or constructor. You use it to:

**(a) Disambiguate field vs parameter:**

```java
public BankAccount(String owner, long balanceCents) {
    this.owner = owner;          // field ← parameter
    this.balanceCents = balanceCents;
}
```

**(b) Pass the current object to another method:**

```java
public void register() {
    AccountRegistry.add(this);
}
```

**(c) Chain constructors:**

```java
public BankAccount(String owner) {
    this(owner, 0);              // calls the 2-arg constructor
}
```

---

## 5. Default constructor

If you write **no constructor at all**, the compiler gives you a free, public, no-arg one:

```java
class Point { int x, y; }            // implicit: public Point() {}
Point p = new Point();               // works
```

The moment you write **any** constructor, the freebie disappears:

```java
class Point {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
}
new Point();        // ❌ compile error — no no-arg constructor exists
```

If you still want both, declare both explicitly.

---

## 6. Reference semantics — the most common stumble

Java passes references by value. Two variables can point to the **same** object:

```java
BankAccount a = new BankAccount("Alice", 100);
BankAccount b = a;                    // same object, two names
b.deposit(50);
System.out.println(a.getBalanceCents()); // 150 — a saw the change!
```

Reassigning `b` does **not** affect `a`:

```java
b = new BankAccount("Bob", 0);        // b now points elsewhere
a.getBalanceCents();                   // still 150
```

Quick rule: `=` copies the reference, not the object. To get an independent copy you must explicitly clone or build a new one.

---

## 7. `==` vs `equals()` for objects

```java
String s1 = new String("hi");
String s2 = new String("hi");

s1 == s2          // false — two different objects on the heap
s1.equals(s2)     // true  — same content
```

- `==` compares **references** (are these the same object?).
- `.equals()` compares **logical equality** (do these objects represent the same value?). You override it in your own classes; the default `Object.equals` falls back to `==`.

Always use `.equals()` for `String`, `Integer`, `BigDecimal`, dates, your domain types — anything that represents a value.

---

## 8. Fields vs local variables

```java
class Counter {
    private int count;            // FIELD — lives with the object on heap

    void increment() {
        int delta = 1;            // LOCAL — lives on the call stack, gone after the method returns
        count += delta;
    }
}
```

| Aspect              | Field                       | Local variable          |
|---------------------|-----------------------------|-------------------------|
| Lives in            | Heap (inside the object)    | Stack (inside the frame)|
| Default value       | `0`/`null`/`false`          | None — compile error if unread |
| Lifetime            | While the object is reachable | Until the method returns |
| Visibility outside method | Yes, via the object | No — local only         |

---

## 9. Method calls dispatch on the object

When you write `rex.bark()`, the JVM:

1. Loads the reference `rex`.
2. Finds the class of the object (`Dog`).
3. Looks up `bark()` in `Dog`'s method table.
4. Invokes it with `this = rex`.

This is why every method (except `static` ones) has a hidden first parameter: `this`.

---

## 10. Garbage collection — you never `delete`

Java has no `delete` or `free`. Once nothing references an object, the garbage collector eventually reclaims its memory:

```java
BankAccount a = new BankAccount("Alice", 0);
a = null;                           // the Alice object is now unreachable → GC will collect it
```

You *can* hold onto objects too long (memory leak), but you cannot *prematurely free* one. Stop worrying about deletion; start thinking about *reachability*.

---

## 11. A class is also a *type*

```java
BankAccount a = new BankAccount(...);   // BankAccount is the static type of a
List<BankAccount> all = new ArrayList<>();   // type parameter
public BankAccount findById(int id) { ... }   // method return type
```

Every class you declare adds a new type to your program. Variables, parameters, return values, and generic arguments can all be typed by it.

---

## 12. One file, one public class

A single source file `Foo.java` may contain:

- Exactly **one** public top-level class — and its name must match the file name.
- Any number of non-public (package-private) top-level classes.
- Any number of nested classes.

```java
// File: Order.java
public class Order { ... }            // ✓ allowed — name matches
class OrderLine { ... }               // ✓ package-private helper
class Customer { ... }                // ✓ also fine
public class Customer2 { ... }        // ❌ second public class
```

---

## 13. The minimal cookbook

```java
// 1. Declare a class with state and behavior
public class Rectangle {
    private final double width;
    private final double height;

    public Rectangle(double width, double height) {
        this.width = width;
        this.height = height;
    }

    public double area() { return width * height; }
    public double perimeter() { return 2 * (width + height); }
}

// 2. Use it
Rectangle r = new Rectangle(3, 4);
System.out.println(r.area());       // 12.0
System.out.println(r.perimeter());  // 14.0
```

That's the whole "classes and objects" loop: declare → instantiate → call methods.

---

## 14. Common beginner mistakes

| Mistake                                       | Symptom                                | Fix                                 |
|-----------------------------------------------|----------------------------------------|-------------------------------------|
| Calling instance method on a `null` reference | `NullPointerException`                 | Initialize before use, check for null |
| Comparing strings with `==`                   | Spurious "not equal" results           | Use `.equals()`                     |
| Forgetting `this.` and shadowing a field      | Field stays at default value           | Use `this.x = x` in the constructor |
| Writing constructor with `void` return type   | It becomes a regular method, not a ctor| Remove `void`                       |
| Sharing a mutable object then modifying it    | Distant code "magically" sees changes  | Defensive copy or use immutables    |
| Returning the internal mutable list directly  | Callers break encapsulation            | Return `List.copyOf(...)`           |

---

## 15. Cheat sheet

```java
// Declaration
class Name { fields; constructors; methods; }

// Instantiation
Type ref = new Name(args);

// Field access
ref.field
ref.field = value;

// Method call
ref.method(args);

// Null
Type ref = null;            // legal — ref points to nothing
ref.method();               // throws NullPointerException
```

Master this and the rest of OOP — inheritance, interfaces, polymorphism — is just adding rules on top of the same foundation: **objects are state + behavior, accessed through references**.
