# Covariant Returns and Bridge Methods — Practice Tasks

Eight hands-on exercises. Each forces you to compile real code, inspect bytecode with `javap`, and verify the bridge's presence/behaviour. Treat this as lab work — your goal is to see bridges, manipulate them, and learn to predict them on sight.

For each task: (1) write the code, (2) run `javac` and `javap -p -v`, (3) record what you see in the bytecode, (4) write a small test or assertion that confirms your understanding.

---

## Task 1 — Comparable<T> and finding the bridge

Implement a `Score` class:

```java
public class Score implements Comparable<Score> {
    private final int value;
    public Score(int v) { this.value = v; }
    @Override public int compareTo(Score other) {
        return Integer.compare(this.value, other.value);
    }
    public int value() { return value; }
}
```

**Steps:**

1. `javac Score.java`.
2. `javap -p -v Score | grep -A2 'compareTo'`.
3. Identify both `compareTo` methods. Record their descriptors and flags.
4. Write a small driver that calls `compareTo` through both a `Score` reference and a `Comparable<Score>` reference. Use `-XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation` to see which compilation tier the methods reach.

**Deliverable:** the two descriptors (`(LScore;)I` and `(Ljava/lang/Object;)I`), the flag mask of the bridge (`0x1041`), and a brief note on whether the bridge appears in `+PrintCompilation` output.

---

## Task 2 — Covariant returns three levels deep

Build the hierarchy:

```java
class Animal { public Animal copy() { return new Animal(); } }
class Dog    extends Animal { @Override public Dog    copy() { return new Dog();   } }
class Puppy  extends Dog    { @Override public Puppy  copy() { return new Puppy(); } }
```

**Steps:**

1. `javac *.java`.
2. `javap -p -v Puppy`. How many `copy` methods are listed? You should see three: the real `Puppy copy()` plus two bridges (`Animal copy()` and `Dog copy()`).
3. `javap -p -v Dog`. How many? (Two — real plus `Animal` bridge.)
4. Trace, on paper, what happens when:
   - `Animal a = new Puppy(); a.copy();` is called.
   - `Dog d = new Puppy(); d.copy();` is called.
   - `Puppy p = new Puppy(); p.copy();` is called.

**Deliverable:** for each of the three call sites, the *chain* of methods invoked (caller → bridge(s) → real method).

---

## Task 3 — Debug a Mockito test that fails because of bridge methods

Given:

```java
public abstract class GenericHandler<T> {
    public abstract String handle(T input);
}

public class StringHandler extends GenericHandler<String> {
    @Override public String handle(String input) { return input.toUpperCase(); }
}
```

Write a failing Mockito test (Mockito 4.x):

```java
@ExtendWith(MockitoExtension.class)
class HandlerTest {
    @Mock GenericHandler<String> handler;

    @Test void demonstrateBridgeRouting() {
        when(handler.handle(any())).thenReturn("stubbed");

        @SuppressWarnings({"rawtypes","unchecked"})
        GenericHandler raw = handler;
        Object result = raw.handle("hello");

        assertEquals("stubbed", result);
    }
}
```

**Steps:**

1. Run the test. Observe whether it passes (Mockito version dependent).
2. If it fails, log `Mockito.mockingDetails(handler).getInvocations()` and confirm which `Method` was recorded.
3. Fix by always using the typed reference: `handler.handle("hello")`.
4. Add `verify(handler).handle("hello")` to confirm matcher works on typed call.

**Deliverable:** the exact failure message, the recorded `Method` object (real vs. bridge), and the fix.

---

## Task 4 — Reflection filtering with Method.isBridge

Write a utility:

```java
public class MethodScanner {
    public static List<Method> userDeclaredMethods(Class<?> c) {
        return Arrays.stream(c.getDeclaredMethods())
                     .filter(m -> !m.isBridge() && !m.isSynthetic())
                     .toList();
    }
}
```

**Steps:**

1. Apply to `Score`, `StringHandler`, `Puppy`. For each, list real methods only.
2. Apply to a class with both `Comparable<T>` and a covariant-return override.
3. Compare with `c.getDeclaredMethods()` directly. Note the synthetic methods present.
4. Verify `getMethods()` (returns inherited public) also includes bridges by counting before and after filter.

**Deliverable:** for each test class, the count of real methods vs. all methods, and a one-line conclusion about what `getDeclaredMethods()` returns.

---

## Task 5 — Override a default method with covariant return

```java
public interface Cloner<T> {
    default T clone() { return null; }
}

public class DogCloner implements Cloner<Dog> {
    @Override public Dog clone() { return new Dog(); }
}
```

**Steps:**

1. Compile and run `javap -p -v DogCloner`. Where does the bridge live — on the interface or on the implementing class?
2. Add another implementer `CatCloner implements Cloner<Cat>` with covariant return. Confirm `CatCloner` has its own bridge.
3. Confirm the interface `Cloner` has **no** bridges (open the class file with `javap -p -v Cloner`).
4. Trace what happens when `Cloner<Dog> c = new DogCloner(); c.clone();` runs — through the itable, into the bridge, into the real method.

**Deliverable:** the bridge's flag mask and bytecode for `DogCloner`, and a confirmation that the interface itself has none.

---

## Task 6 — A generic factory and its bridges

```java
public interface Factory<T> {
    T create();
}

public class UserFactory implements Factory<User> {
    @Override public User create() { return new User("default"); }
}
```

**Steps:**

1. Compile and inspect `UserFactory` with `javap`. Find the bridge `Object create()`.
2. Write a test that calls `create()` through a `Factory<User>` reference and asserts the runtime class is `User`.
3. Add `AdminFactory extends UserFactory` with `@Override public Admin create() { return new Admin(); }`. How many bridges does `AdminFactory` have? (Two: one for `Factory.create()` returning `Object`, one for `UserFactory.create()` returning `User`.)
4. Verify with `javap`.

**Deliverable:** the bridge count on `UserFactory` (one) and `AdminFactory` (two), with the descriptors of each.

---

## Task 7 — Annotation processor inspecting bridges

Write a small annotation processor (or a runtime equivalent) that:

```java
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface Audited {}

public class AuditedHandler implements GenericHandler<String> {
    @Override @Audited public String handle(String input) { return input; }
}
```

**Steps:**

1. Reflectively scan `AuditedHandler.getDeclaredMethods()`. For each method, check `m.getAnnotation(Audited.class)`. Is the annotation present on the bridge?
2. Spring's `BridgeMethodResolver.findBridgedMethod(m)` is the resolution helper; replicate the algorithm yourself by walking the class hierarchy.
3. Confirm that `m.isBridge() == true` and `m.getAnnotation(Audited.class) == null` for the bridge, but the real method has the annotation.
4. Conclude: a naive scan that picks the bridge will miss the annotation.

**Deliverable:** a working `realMethod(Method m)` helper that returns the bridged method when `m` is a bridge, plus a test demonstrating it surfaces the `@Audited` annotation correctly.

---

## Task 8 — MethodHandle resolution to real vs. bridge

```java
public class Score implements Comparable<Score> {
    @Override public int compareTo(Score other) { return 0; }
}

MethodHandles.Lookup lookup = MethodHandles.lookup();

MethodHandle real = lookup.findVirtual(Score.class, "compareTo",
        MethodType.methodType(int.class, Score.class));

MethodHandle bridge = lookup.findVirtual(Score.class, "compareTo",
        MethodType.methodType(int.class, Object.class));
```

**Steps:**

1. Both `findVirtual` calls succeed. Confirm they return *different* method handles.
2. Invoke each with the same arguments and confirm the result is identical (the bridge forwards correctly).
3. Use `MethodHandleInfo` (via `lookup.revealDirect(handle)`) to see the underlying method's descriptor for each.
4. Benchmark a tight loop calling `real.invokeExact` vs `bridge.invokeExact`. Quantify the cost difference (expect a few nanoseconds at most, likely below noise after warmup).

**Deliverable:** the two `MethodHandleInfo` outputs, the benchmark numbers, and a one-line conclusion about which `MethodType` to specify when generating handles programmatically.

---

## Self-check questions

After completing the tasks:

- For a class with `Comparable<T>` and a covariant clone, how many bridges does `javap -p -v` show?
- What's the flag mask for a bridge method? (`ACC_PUBLIC | ACC_BRIDGE | ACC_SYNTHETIC = 0x1041`.)
- What does `Method.isBridge()` return for a manually written `compareTo(Object)`? (False — only the compiler-generated one is flagged.)
- Why does Spring need `BridgeMethodResolver` even though it could just filter bridges? (Because annotations live on the real method, but AOP needs to advise both call paths.)

---

**Memorize this:** the way to internalise bridges is to *see them* with `javap -p -v` again and again. Do all eight tasks; by the end you will predict the bridge count and descriptors before you compile.
