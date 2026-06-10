# Covariant Returns and Bridge Methods — Middle

> **What?** A working knowledge of bridges: how to read them in `javap -v`, why generics produce them even when you didn't write a covariant return, what reflection shows, and where they routinely trip up developers building frameworks.
> **How?** Compile the snippets, run `javap -p -v` on the class files, and match what you see against the explanations here. Bridges are not theoretical — every Java codebase that uses `Comparable<T>`, `Iterable<T>`, `Function<T,R>`, or covariant clone has them.

---

## 1. Reading `javap -v` like a detective

`javap` is the diagnostic. Three flags matter for bridge work:

- `-p` shows `private` and synthetic members. Bridges are synthetic; without `-p` they may be hidden.
- `-v` shows full verbose output: constant pool, flags, bytecode, attributes.
- `-c` shows just the bytecode (useful once you've identified the method).

Compile a small program and inspect it:

```java
public class Score implements Comparable<Score> {
    private final int value;
    public Score(int v) { this.value = v; }
    @Override public int compareTo(Score other) {
        return Integer.compare(value, other.value);
    }
}
```

`javac Score.java && javap -p -v Score`:

```
public int compareTo(Score);
  descriptor: (LScore;)I
  flags: (0x0001) ACC_PUBLIC
  Code:
    0: aload_0
    1: getfield      #7   // Field value:I
    4: aload_1
    5: getfield      #7   // Field value:I
    8: invokestatic  #13  // Method java/lang/Integer.compare:(II)I
   11: ireturn

public int compareTo(java.lang.Object);
  descriptor: (Ljava/lang/Object;)I
  flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
  Code:
    0: aload_0
    1: aload_1
    2: checkcast     #2   // class Score
    5: invokevirtual #19  // Method compareTo:(LScore;)I
    8: ireturn
```

Reading this:

- The first `compareTo` has descriptor `(LScore;)I`. It's what you wrote — typed argument, real logic.
- The second `compareTo` has descriptor `(Ljava/lang/Object;)I`. Its flags include `ACC_BRIDGE` (0x0040) and `ACC_SYNTHETIC` (0x1000). Together with `ACC_PUBLIC` (0x0001) that gives `0x1041`.
- The bridge body is three instructions: `checkcast Score`, `invokevirtual compareTo:(LScore;)I`, `ireturn`. It exists *only* to receive the wider-typed call from `Comparable.compareTo(Object)` and forward it.

Anything called through a `Comparable<?>` reference lands in the bridge first.

---

## 2. Why generics force the bridge

The interface `Comparable<T>` looks generic, but at the JVM level it isn't:

```java
public interface Comparable<T> {
    public int compareTo(T o);
}
```

After **erasure** (JLS §4.6), the method signature becomes `compareTo(Object)I` — `T` is erased to its bound, which is `Object` here. The JVM only sees `compareTo(Object)`. So:

- `Score` implements `Comparable<Score>`. It must override `compareTo(Object)`.
- Source code uses the strongly typed `compareTo(Score)`. That alone has descriptor `(LScore;)I` — not the inherited `(LObject;)I`.
- The compiler adds the bridge `compareTo(Object)` to fill the inherited slot.

The two methods are not duplicates. They are a *pair* — one with the inherited erased descriptor, one with the source-level descriptor — that together make polymorphism work for the type-checked source while satisfying the JVM's descriptor matching.

This is exactly why bridges exist *whenever* a subclass narrows a return type **or** a parameter type via generics.

---

## 3. A non-Comparable generic example

```java
public interface Mapper<T, R> {
    R map(T input);
}

public class StringToInt implements Mapper<String, Integer> {
    @Override public Integer map(String input) {
        return Integer.parseInt(input);
    }
}
```

Erasure on `Mapper<T, R>` gives `Object map(Object)`. `StringToInt.map(String): Integer` does not match that descriptor — it would resolve to `(Ljava/lang/String;)Ljava/lang/Integer;`. So the compiler generates a bridge `Object map(Object)` that does:

1. `checkcast String` on the argument,
2. `invokevirtual map(String): Integer`,
3. `areturn` the result (Integer is already a subtype of Object, no cast needed).

`javap -p -v StringToInt`:

```
public java.lang.Integer map(java.lang.String);
  descriptor: (Ljava/lang/String;)Ljava/lang/Integer;
  flags: (0x0001) ACC_PUBLIC

public java.lang.Object map(java.lang.Object);
  descriptor: (Ljava/lang/Object;)Ljava/lang/Object;
  flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
  Code:
    0: aload_0
    1: aload_1
    2: checkcast     #2   // class java/lang/String
    5: invokevirtual #19  // Method map:(Ljava/lang/String;)Ljava/lang/Integer;
    8: areturn
```

The `checkcast` is significant. If a caller using a raw `Mapper` reference passes an `Integer`, the bridge will throw `ClassCastException` at the cast site — *not* deep inside `map`. The stack trace points at the bridge, which is one of the early indicators that a generic-typed call is going through a bridge:

```
Exception in thread "main" java.lang.ClassCastException:
    class java.lang.Integer cannot be cast to class java.lang.String
    at StringToInt.map(StringToInt.java)
```

Note the line number is often missing or refers to the bridge's synthetic origin — another tell.

---

## 4. Reflection's view of bridges

`Class.getDeclaredMethods()` returns *all* methods declared on the class, **including bridges**. `Class.getMethods()` returns public methods including inherited ones — and the bridge is public and declared on the subclass, so it's there too.

```java
for (Method m : Score.class.getDeclaredMethods()) {
    System.out.printf("%s  bridge=%b  synthetic=%b%n",
                      m, m.isBridge(), m.isSynthetic());
}
```

Output:

```
public int Score.compareTo(Score)            bridge=false  synthetic=false
public int Score.compareTo(java.lang.Object) bridge=true   synthetic=true
```

If you naively iterate and act on both, you act twice. Two common bug shapes follow from this:

- **Annotation scanners** that read `@Transactional` on every method find the annotation only on the real one (the compiler doesn't copy annotations onto bridges *by default*) and silently miss it when the bridge is the chosen entry point.
- **Argument validators** that read parameter generic types see `Object` on the bridge and `Score` on the real method, leading to inconsistent behaviour.

The right filter for "what the user actually wrote" is:

```java
Arrays.stream(Score.class.getDeclaredMethods())
      .filter(m -> !m.isBridge() && !m.isSynthetic())
      .toList();
```

Use this whenever you build framework code that reflects over user classes.

---

## 5. Covariant returns at the method level — the original example revisited

```java
class Animal {
    public Animal copy() { return new Animal(); }
}
class Dog extends Animal {
    @Override public Dog copy() { return new Dog(); }
}
```

`javap -p -v Dog`:

```
public Dog copy();
  descriptor: ()LDog;
  flags: (0x0001) ACC_PUBLIC
  Code:
    0: new           #2  // class Dog
    3: dup
    4: invokespecial #3  // Method Dog."<init>":()V
    7: areturn

public Animal copy();
  descriptor: ()LAnimal;
  flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
  Code:
    0: aload_0
    1: invokevirtual #4  // Method copy:()LDog;
    4: areturn
```

The bridge here is even simpler — there are no parameters to checkcast. It just forwards. The interesting bit is the `invokevirtual` to `copy:()LDog;`: the bridge calls *virtually*, so if a subclass of `Dog` overrides again with `Puppy copy()`, the call still resolves dynamically.

---

## 6. Chaining covariant returns

```java
class Animal { public Animal copy() { return new Animal(); } }
class Dog    extends Animal { @Override public Dog    copy() { return new Dog(); } }
class Puppy  extends Dog    { @Override public Puppy  copy() { return new Puppy(); } }
```

How many bridges does `Puppy` have? **Two**:

- A bridge `Dog copy()` overriding `Dog.copy()`.
- A bridge `Animal copy()` overriding `Animal.copy()`.

Each bridge invokes the most-specific real method through `invokevirtual`. Two levels of narrowing = two bridges in `Puppy`. `javap -p -v Puppy` lists three `copy` methods total: the real one and two bridges. Don't be surprised — every step up the hierarchy where the parent has a wider return type contributes one bridge to the most-derived class.

(`Dog` itself has one bridge, the `Animal copy()` forwarder. `Puppy` has both because the JVM expects to find `Animal copy()` and `Dog copy()` slots on a `Puppy` and dispatch through them when the caller uses those reference types.)

---

## 7. Subclass overriding a generic method always creates a bridge

```java
public class Box<T> {
    public T get() { return null; }
}

public class StringBox extends Box<String> {
    @Override public String get() { return "hello"; }
}
```

`Box<T>` erases to `Box` with `Object get()`. `StringBox.get(): String` doesn't match that descriptor, so:

```
public java.lang.String get();
  descriptor: ()Ljava/lang/String;
  flags: (0x0001) ACC_PUBLIC

public java.lang.Object get();
  descriptor: ()Ljava/lang/Object;
  flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
  Code:
    0: aload_0
    1: invokevirtual #7  // Method get:()Ljava/lang/String;
    4: areturn
```

Same pattern. The bridge is the contract with the JVM; the real method is the contract with you.

---

## 8. When `@Override` and bridges fight

A trap: writing the *erased* signature on the subclass by accident hides the real generic method.

```java
public class Score implements Comparable<Score> {
    @Override public int compareTo(Score s) { return 0; }
    public int compareTo(Object o) { return 1; }   // looks like the bridge — and replaces it
}
```

Now `javac` will *not* generate the bridge — there's already a method with that descriptor. `Comparable.compareTo` on a `Score` reference will route to your manually written method, which returns `1` regardless. `compareTo(Score)` is dead code as far as polymorphism is concerned.

Always use `@Override` and only the source-typed signature; trust the compiler with the bridge.

---

## 9. IDE behaviour around bridges

IntelliJ IDEA and Eclipse both *hide* bridge methods by default in outlines, completion, and "go to declaration". This is correct UX — you didn't write them and shouldn't directly call them. But it also means:

- Coverage tools may or may not show bridges as a separate uncovered line.
- Profiler call-graphs sometimes include the bridge as a separate frame, sometimes fold it away. async-profiler with `--threads` typically shows the bridge frame; that does *not* mean dispatch is slow — it's a one-instruction forwarder that the JIT inlines.
- "Find usages" on the real method may miss callers that resolve through the bridge (e.g. raw-type callers, reflection callers using the erased signature).

When something looks weird in tooling, run `javap -p -v` on the bytecode. The class file is the source of truth.

---

## 10. Quick rules

- [ ] Bridges appear in the class file with flags `ACC_BRIDGE | ACC_SYNTHETIC`, descriptor matching the *parent* (or *erased*) signature.
- [ ] Every implementation of `Comparable<T>`, `Iterable<T>`, `Function<T,R>`, etc. generates a bridge.
- [ ] Each covariant-return narrowing along an inheritance chain adds one bridge to the most-derived class.
- [ ] `Class.getDeclaredMethods()` returns bridges; filter with `Method.isBridge()` for framework code.
- [ ] Don't write the erased signature manually — you'll suppress the bridge and break polymorphic dispatch.
- [ ] When a generic type misuse throws `ClassCastException`, the stack often points at the bridge — that's normal.
- [ ] Don't trust IDE outlines for ground truth on synthetic methods. Trust `javap`.

---

## 11. What's next

| Topic                                                            | File                |
| ---------------------------------------------------------------- | ------------------- |
| Reflection bugs, vtable slots, MethodHandle, default methods     | `senior.md`         |
| Code review, Mockito's bridge handling, ArchUnit checks          | `professional.md`   |
| JLS §8.4.5, JVMS §4.6, ACC_BRIDGE                                | `specification.md`  |
| Ten realistic bugs caused by bridge methods                      | `find-bug.md`       |
| Bridge invocation cost, JIT inlining                             | `optimize.md`       |
| Hands-on exercises                                               | `tasks.md`          |
| Interview Q&A                                                    | `interview.md`      |

---

**Memorize this:** the bridge has the parent's (or erased) descriptor and a body of `checkcast` + `invokevirtual` + return. It exists because the JVM matches by descriptor, and generics or covariant returns force two descriptors for one logical method. Read `javap -p -v` whenever you doubt what's actually there.
