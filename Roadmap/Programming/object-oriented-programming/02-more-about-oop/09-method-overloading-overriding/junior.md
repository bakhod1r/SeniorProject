# Method Overloading / Overriding — Junior

> **What?** Two distinct mechanisms with similar-sounding names: **overloading** is having multiple methods with the same name but different parameters in the same class. **Overriding** is providing a new implementation in a subclass for a method inherited from the parent.
> **How?** Overloading is resolved at *compile time* based on argument types. Overriding is resolved at *runtime* based on the receiver's actual class.

---

## 1. The simplest examples

**Overloading** (compile-time, same class):

```java
public class Calc {
    public int add(int a, int b)        { return a + b; }
    public double add(double a, double b) { return a + b; }
    public int add(int a, int b, int c) { return a + b + c; }
}

calc.add(1, 2);        // calls add(int, int)
calc.add(1.0, 2.0);    // calls add(double, double)
calc.add(1, 2, 3);     // calls add(int, int, int)
```

**Overriding** (runtime, subclass):

```java
public class Animal {
    public String speak() { return "..."; }
}
public class Dog extends Animal {
    @Override
    public String speak() { return "woof"; }
}

Animal a = new Dog();
a.speak();    // "woof" — runtime decides based on actual class
```

---

## 2. Overloading rules

To overload, a method must:
- Have the **same name** as another method in the same class.
- Have a **different parameter list** — different types or different number of params.

**Cannot overload** by:
- Changing only the return type (insufficient).
- Changing only the parameter names (irrelevant).
- Changing only the throws clause (insufficient).

```java
class Bad {
    int compute(int x) { return x; }
    long compute(int x) { return x; }    // ERROR — same parameter list
}
```

---

## 3. Overriding rules

To override, a method must:
- Have the **same signature** (name + parameter types) as the parent's method.
- Have the **same or covariant** return type (return type can be a subtype).
- Have **same or wider access** (can't make a public method package-private).
- Throw **same or fewer/narrower** checked exceptions.

```java
class Parent {
    public Number compute() throws IOException { return 0; }
}
class Child extends Parent {
    @Override
    public Integer compute() {       // covariant return; narrower throws — OK
        return 42;
    }
}
```

---

## 4. The `@Override` annotation

Use `@Override` on every override:

```java
@Override
public String toString() { return "..."; }
```

If your method doesn't actually override anything (typo, wrong signature), the compiler errors. This catches countless bugs.

```java
class Bad extends Animal {
    @Override
    public String Speak() { return "woof"; }   // ERROR — no parent method 'Speak'
}
```

Always use `@Override`. Always.

---

## 5. Static vs dynamic dispatch

**Overloading is resolved at compile time** based on the static (declared) types of the arguments:

```java
void m(Object o) { System.out.println("Object"); }
void m(String s) { System.out.println("String"); }

Object o = "hello";
m(o);    // prints "Object" — the static type is Object, not String
```

**Overriding is resolved at runtime** based on the actual class of the receiver:

```java
Animal a = new Dog();
a.speak();   // "woof" — dispatch to Dog.speak based on the actual object
```

---

## 6. Mixing overloading and overriding

You can have both — multiple methods of the same name (overloads), some of which are overridden by subclasses:

```java
class Parent {
    void m(int x) { System.out.println("Parent int"); }
    void m(String s) { System.out.println("Parent String"); }
}
class Child extends Parent {
    @Override
    void m(int x) { System.out.println("Child int"); }
    // m(String) inherited unchanged
}

new Child().m(5);       // "Child int" — overridden
new Child().m("hi");    // "Parent String" — inherited
```

---

## 7. The classic gotcha — overloading not overriding

```java
class Parent {
    void compute(Object o) { System.out.println("Parent"); }
}
class Child extends Parent {
    void compute(String s) { System.out.println("Child"); }   // overload, NOT override!
}

Parent p = new Child();
p.compute("hello");    // "Parent" — surprised? compile-time dispatch picks Object overload
```

`compute(Object)` and `compute(String)` are *different methods*. Without `@Override`, the compiler doesn't catch the mistake. Add `@Override`:

```java
class Child extends Parent {
    @Override
    void compute(String s) { ... }   // ERROR — no parent method with this signature
}
```

The compiler catches this immediately.

---

## 8. Constructors are not overridden

Constructors aren't inherited and aren't overridden. Each class declares its own constructors. A subclass constructor *invokes* the parent's via `super(...)`:

```java
class Parent {
    Parent(String name) { ... }
}
class Child extends Parent {
    Child(String name, int age) {
        super(name);    // call parent constructor
    }
}
```

---

## 9. Overloading varargs

```java
void m(int... values) { System.out.println("varargs int"); }
void m(int x, int y) { System.out.println("two ints"); }

m(1, 2);   // "two ints" — exact match wins over varargs
m(1, 2, 3); // "varargs int"
m(1);      // "varargs int" — fixed-arity overload (m(int)) doesn't exist
```

The compiler prefers exact matches over varargs. This is part of overload resolution.

---

## 10. Overloading by primitive vs wrapper

```java
void m(int x) { System.out.println("int"); }
void m(Integer x) { System.out.println("Integer"); }

m(5);                     // "int" — exact primitive match
m(Integer.valueOf(5));    // "Integer" — exact reference match
m((Object) 5);            // "Integer" if Object overload doesn't exist; else compile error
```

The compiler picks the most specific match. Boxing/unboxing happens only if no exact match exists.

---

## 11. Common newcomer mistakes

**Mistake 1: not using `@Override`**

```java
class Dog extends Animal {
    String Speak() { return "woof"; }   // typo — no compiler help
}
```

Use `@Override` and the compiler catches it.

**Mistake 2: thinking overloading is polymorphism**

```java
Animal a = new Dog();
process(a);     // calls process(Animal), not process(Dog), even if a is a Dog

void process(Animal a) { ... }
void process(Dog d) { ... }
```

Overloading is compile-time, based on declared type. To dispatch on actual type, use overriding (or pattern matching).

**Mistake 3: changing return type without changing signature**

```java
class Parent { int m() { return 0; } }
class Child extends Parent {
    String m() { return ""; }   // ERROR — incompatible return type
}
```

Override return must be same or subtype. `String` is not a subtype of `int`.

---

## 12. Quick reference

| Aspect                | Overloading                  | Overriding                     |
|-----------------------|------------------------------|--------------------------------|
| Same name?            | Yes                          | Yes                            |
| Same parameters?      | No                           | Yes                            |
| Same class?           | Yes                          | No (parent + subclass)         |
| Resolved when?        | Compile time                 | Runtime                        |
| Annotation            | (none)                       | `@Override`                    |
| Polymorphic?          | No                           | Yes                            |

---

## 13. What's next

| Topic                                  | File              |
|----------------------------------------|-------------------|
| Overload resolution rules in detail     | `middle.md`        |
| Bridge methods, generics                | `senior.md`        |
| Bytecode of dispatch                    | `professional.md`  |
| JLS rules                               | `specification.md` |

---

**Memorize this**: overloading = same name, different parameters, same class, compile-time resolution. Overriding = same signature in subclass, runtime resolution. Always use `@Override`. Don't expect overloading to dispatch on runtime type.
