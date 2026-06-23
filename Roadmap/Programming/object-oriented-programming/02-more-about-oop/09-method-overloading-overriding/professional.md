# Method Overloading / Overriding — Professional

> **What?** Bytecode of overloads (separate methods with distinct descriptors), bridge methods for covariant returns and erased generics, vtable construction for overrides, the verifier's role, and the JIT's view.
> **How?** Read with `javap -c -v -p`, observe class loading and method resolution, study HotSpot's `klass.cpp` for vtable layout.

---

## 1. Overloads in bytecode

Each overloaded method is a separate `method_info` entry with its own *descriptor* (parameter and return types):

```java
class Calc {
    int add(int a, int b)       { return a + b; }
    double add(double a, double b) { return a + b; }
}
```

```
methods:
  int add(int, int);
    descriptor: (II)I
  double add(double, double);
    descriptor: (DD)D
```

The compiler picks one at the call site by emitting the right descriptor:

```
0: aload_0
1: iconst_1
2: iconst_2
3: invokevirtual #5     // Method add:(II)I — picked by overload resolution
```

Once compiled, the call is fixed; no overload resolution at runtime.

---

## 2. Overrides in bytecode

An override is a method with the same name and descriptor as the parent's:

```java
class Animal { String speak() { return "..."; } }
class Dog extends Animal { @Override String speak() { return "woof"; } }
```

Both classes have:
```
String speak();
  descriptor: ()Ljava/lang/String;
```

At link time, the JVM builds Dog's vtable: copies Animal's, then replaces the `speak` slot with Dog's implementation.

`a.speak()` emits `invokevirtual Animal.speak`. Runtime dispatches via vtable to whichever class actually implements it.

---

## 3. Vtable construction

JVMS §5.4.5: at link time, the JVM builds the method table:

```
vtable construction (simplified):
  for each method m in class C:
    if m overrides a method m' inherited from ancestor:
      replace vtable[m'.slot] with C's m
    else:
      add new slot vtable[N] = m
```

Subclasses inherit and override. The vtable is contiguous; lookup is array indexing.

---

## 4. Bridge methods for covariance

```java
class Animal { Animal mate() { return null; } }
class Dog extends Animal { @Override Dog mate() { return new Dog(); } }
```

The compiler synthesizes a bridge on `Dog`:

```
Dog mate();        // user-written
Animal mate();     // synthetic bridge:
  Code:
    aload_0
    invokevirtual Dog.mate:()LDog;
    areturn
```

When code typed against `Animal` calls `mate()`, dispatch lands in the bridge, which calls the actual override and returns its result as `Animal`.

---

## 5. Bridge methods for generics

```java
class Box<T> { void put(T x) { } }
class IntBox extends Box<Integer> {
    @Override void put(Integer x) { }
}
```

After erasure, `Box.put` has descriptor `(Ljava/lang/Object;)V`. `IntBox.put(Integer)` has descriptor `(Ljava/lang/Integer;)V`. They're different methods — without a bridge, dispatch from `Box`-typed callers wouldn't reach the override.

```
IntBox class file:
  void put(Integer);   // user-written
  void put(Object);    // synthetic bridge — checkcast + invokevirtual
```

---

## 6. Hidden-class lambdas implementing overridden methods

Lambdas are hidden classes implementing functional interfaces. The functional interface's single abstract method becomes the only method on the hidden class. Dispatch is via `invokeinterface`.

The JIT inlines through the lambda's tiny method body, so monomorphic lambda call sites are direct after warmup.

---

## 7. `invokevirtual` semantics (recap)

JVMS §6.5.invokevirtual:

```
1. Resolve the method symbolic reference (at link time, once per call site).
2. Pop receiver and args.
3. Read receiver's klass.
4. Search receiver's vtable for a method matching the resolved name+descriptor.
5. Invoke.
```

The "search" is implemented as direct vtable indexing using a precomputed slot.

---

## 8. `invokespecial` for special calls

`invokespecial` is used for:
- Constructor calls (`<init>`)
- `super.method(...)` calls
- Private method calls (Java 11+ may use `invokevirtual`)

`invokespecial` is a *direct* call — no vtable lookup. This is why `super.m()` always calls the immediate parent's method, regardless of further overrides.

---

## 9. `invokestatic` for static methods

Static methods use `invokestatic`. No receiver, no vtable. The method is determined at compile time by the declared type:

```java
Parent.compute();        // invokestatic Parent.compute
Child.compute();         // invokestatic Child.compute (separate method)
```

Static methods don't override — they hide. The bytecode shows this explicitly.

---

## 10. The verifier's role

JVMS §4.10.1.6: at class load time, the verifier checks:
- Override compatibility (return type, exceptions, access)
- That `<init>` follows the constructor invariants
- That `final` methods aren't overridden

If checks fail, `LinkageError` (or subclass like `IncompatibleClassChangeError`).

---

## 11. JIT inlining of overrides

For monomorphic sites, the JIT inlines the override's body directly. The vtable lookup vanishes. Effective code:

```java
// source
void process(Animal a) { a.speak(); }
process(myDog);

// after JIT (conceptually)
void process_inlined() { System.out.println("woof"); }
```

For megamorphic sites, the lookup remains. Use `-XX:+PrintInlining` to see decisions.

---

## 12. Generics erasure and overload resolution

```java
void m(List<String> l) { }
void m(List<Integer> l) { }
```

Both erase to `m(List)` — same descriptor. **Compile error**: clashing methods.

You cannot overload by generic type alone — only by erased types. This is one of the noticeable limitations of erasure.

```java
void m(List<String> l) { }
void m(Set<Integer> s) { }    // different erased types — OK
```

---

## 13. Where the spec says it

| Topic                         | Source                |
|-------------------------------|-----------------------|
| Method invocation              | JLS §15.12           |
| Overload resolution            | JLS §15.12.2          |
| Most-specific method           | JLS §15.12.2.5        |
| Overriding rules               | JLS §8.4.8            |
| Covariant return               | JLS §8.4.8.3          |
| Exception narrowing            | JLS §8.4.8.4          |
| Method descriptor              | JVMS §4.3.3           |
| `invokevirtual`                | JVMS §6.5             |
| `invokespecial`                | JVMS §6.5             |
| `invokestatic`                 | JVMS §6.5             |
| Vtable                         | JVMS §5.4.5 (informal) |
| Bridge methods                 | JLS §8.4.8.3 (informally) |

---

**Memorize this**: overloads are separate methods with distinct descriptors, picked by the compiler. Overrides share a descriptor and replace a vtable slot at link time. Bridge methods bridge erased/covariant signatures. `invokevirtual` does vtable lookup; `invokespecial` is direct; `invokestatic` is direct. `@Override` is compile-time only — but invaluable.
