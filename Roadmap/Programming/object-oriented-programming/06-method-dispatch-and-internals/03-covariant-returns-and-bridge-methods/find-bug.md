# Covariant Returns and Bridge Methods — Find the Bug

> 10 buggy scenarios where a synthetic bridge method silently changes program behaviour. For each: read the code, identify the bridge interaction, observe the runtime symptom (wrong test result, missed annotation, ClassCastException), and apply the fix. Most of these compile and pass static checks — they bite only at runtime, often inside frameworks.

---

## Bug 1 — Mockito stubs the bridge instead of the real method

```java
public abstract class GenericHandler<T> {
    public abstract String handle(T input);
}

public class UserHandler extends GenericHandler<User> {
    @Override public String handle(User user) {
        return "real: " + user.name();
    }
}

@ExtendWith(MockitoExtension.class)
class HandlerTest {
    @Mock GenericHandler<User> handler;

    @Test void stubReturnsValue() {
        when(handler.handle(any())).thenReturn("stub");

        @SuppressWarnings("rawtypes")
        GenericHandler raw = handler;
        Object result = raw.handle(new User("a"));

        assertEquals("stub", result);   // sometimes fails
    }
}
```

**Symptom.** Depending on Mockito version and inline-mock mode, the assertion fails with `null` returned or with `UnnecessaryStubbingException` — the stub was registered against `handle(User)` but the raw-typed call went through `handle(Object)`, the bridge.

**Cause.** The bridge `handle(Object)` and the real `handle(User)` are *two different methods*. Mockito records invocations by method handle; the raw call hit the bridge frame, the typed stub bound to the real frame.

**Fix.** Never call mocked methods through raw references. Use the typed reference:

```java
String result = handler.handle(new User("a"));   // typed → real method, stub matches
```

If you cannot avoid raw access, upgrade to Mockito 4.x where the resolver follows bridges, and assert via `verify` on the typed reference.

---

## Bug 2 — Spring AOP advice fires on the bridge but not on the real call

```java
@Component
public class UserRepository extends GenericRepository<User> { /* ... */ }

@Aspect
@Component
public class AuditAspect {
    @Around("execution(public * com.acme..*.save(..))")
    public Object audit(ProceedingJoinPoint pjp) throws Throwable {
        log.info("audit");
        return pjp.proceed();
    }
}
```

```java
// Caller A — strongly typed:
userRepository.save(user);   // aspect runs

// Caller B — raw / parent-typed:
GenericRepository repo = userRepository;
repo.save(user);             // historically, aspect did not run
```

**Symptom.** Audit log lines appear only for some callers. The "missing" callers all go through a raw or parent-typed reference.

**Cause.** Pre-fix Spring matched the pointcut against the bridge method `save(Object)`, missed the annotation/declaration on the bridge, and skipped advice. Spring `BridgeMethodResolver` was introduced precisely for this.

**Fix.** Upgrade Spring (any 4.0+ handles it). For custom interceptors, resolve manually:

```java
Method actual = m.isBridge() ? BridgeMethodResolver.findBridgedMethod(m) : m;
Annotation a = actual.getAnnotation(Audit.class);
```

---

## Bug 3 — Reflection finds two methods, registers both

```java
public class Score implements Comparable<Score> {
    @Override public int compareTo(Score s) { return 0; }
}

class HandlerRegistry {
    void register(Class<?> c) {
        for (Method m : c.getDeclaredMethods()) {
            handlers.put(m.getName() + m.getParameterCount(), m);
            log.info("registered {}", m);
        }
    }
}
```

**Symptom.** Logs show `registered public int Score.compareTo(Score)` *and* `registered public int Score.compareTo(java.lang.Object)`. The map's second `put` overwrites the first (or vice versa), and downstream code that invokes via `m.invoke(score, otherScore)` either ClassCastExceptions or routes through the wrong frame.

**Cause.** `getDeclaredMethods()` returns the bridge. The key collision (`compareTo1`) makes the order-of-iteration determine which method wins.

**Fix.** Filter:

```java
for (Method m : c.getDeclaredMethods()) {
    if (m.isBridge() || m.isSynthetic()) continue;
    handlers.put(m.getName() + m.getParameterCount(), m);
}
```

---

## Bug 4 — `Class.getMethod` returns the bridge, not the real one

```java
public class StringBox extends Box<String> {
    @Override public String get() { return "hello"; }
}

Method m = StringBox.class.getMethod("get");
System.out.println(m.getReturnType());   // sometimes Object, sometimes String
```

**Symptom.** Depending on JVM and how `Box<T>` was declared, `m.getReturnType()` is `Object`, not `String`. A serializer that decides format by return type uses the wrong adapter.

**Cause.** `Class.getMethod` may return the bridge if the bridge's parameter types match exactly (here, no parameters). The order of methods returned by the JVM is not specified.

**Fix.** Walk to the real method:

```java
Method real = m.isBridge()
    ? Arrays.stream(StringBox.class.getDeclaredMethods())
            .filter(x -> x.getName().equals("get") && !x.isBridge())
            .findFirst().orElseThrow()
    : m;
```

For Spring-using code: `BridgeMethodResolver.findBridgedMethod(m)`.

---

## Bug 5 — "Covariant return doesn't compile because erasure clashes"

```java
public interface Provider<T> {
    T provide();
}

public class StringProvider implements Provider<String> {
    public String provide() { return "x"; }
    public Object provide() { return new Object(); }   // wait...
}
```

**Symptom.** The developer expected a clash. The compiler instead refuses with:

```
error: method provide() is already defined in class StringProvider
    public Object provide() { return new Object(); }
                  ^
```

Then they conclude "covariant returns don't work with generics".

**Cause.** They tried to *manually write* the erased signature. That's the slot reserved for the bridge. The compiler can't have two methods with the same erased descriptor.

**Fix.** Delete the manual `Object provide()`. The compiler generates it as a bridge automatically. Trust the bridge.

---

## Bug 6 — Subclass accidentally hides via missing `@Override`

```java
public class ScoreList implements Comparable<ScoreList> {
    @Override public int compareTo(ScoreList other) { return 0; }
}

public class SortedScoreList extends ScoreList {
    public int compareTo(ScoreList other) { return -1; }   // no @Override
}
```

The developer later refactors `ScoreList` to implement `Comparable<ScoreList>` slightly differently:

```java
public class ScoreList implements Comparable<ScoreList> {
    @Override public int compareTo(ScoreList other) {
        return Integer.compare(this.size(), other.size());
    }
}
```

`SortedScoreList.compareTo(ScoreList)` still compiles, still looks fine, but no longer behaves as expected when called through `Comparable`:

```java
Comparable<ScoreList> c = new SortedScoreList();
c.compareTo(other);   // calls bridge → real → returns -1, not size comparison
```

**Symptom.** Sort order is wrong. The override is *not* an override of `Comparable.compareTo` because the bridge on `SortedScoreList` was never generated — its parent already had the bridge, and `SortedScoreList.compareTo(ScoreList)` is just a regular method on the subclass.

**Cause.** Without `@Override`, the developer didn't notice they aren't actually overriding the right method, and the bridge that dispatches from `Comparable.compareTo(Object)` keeps invoking `ScoreList.compareTo(ScoreList)` (which `SortedScoreList` doesn't override under `invokevirtual`? — it does, actually, because `SortedScoreList.compareTo(ScoreList)` has the same descriptor). The bug is in the *new* refactor: the bridge points to the wrong method on subclasses that inherited an unexpected default.

**Fix.** Always use `@Override`. The compiler then catches refactor drift.

---

## Bug 7 — Generic comparable subclass missing the bridge through inheritance

```java
public abstract class Identifier<T extends Identifier<T>> implements Comparable<T> {
    protected final String value;
    protected Identifier(String v) { this.value = v; }
    @Override public int compareTo(T other) { return value.compareTo(other.value); }
}

public class UserId extends Identifier<UserId> {
    public UserId(String v) { super(v); }
}
```

`UserId` does *not* override `compareTo`. But:

```java
List<UserId> ids = ...;
Collections.sort(ids);   // ClassCastException at runtime
```

**Symptom.**

```
Exception in thread "main" java.lang.ClassCastException:
    class UserId cannot be cast to class UserId
    at Identifier.compareTo(Identifier.java:5)
```

Yes, "UserId cannot be cast to UserId" — confusing.

**Cause.** `Identifier<T>.compareTo(T)` erases to `compareTo(Identifier)` because `T`'s bound is `Identifier<T>`. The bridge on `Identifier` (the abstract class) is `compareTo(Object)` → `checkcast Identifier`. `UserId` inherits this bridge. When `Collections.sort` calls `compareTo(Object)` with a `UserId` argument, the bridge `checkcast`s to `Identifier` (succeeds) and calls the real method. The real method then casts again somewhere.

Actually the error here often comes from `getClass()` mismatches in equals or `hashCode` interactions — the message is misleading because two distinct class loaders saw `UserId`, but the bridge dispatch is what surfaces it.

**Fix.** Avoid F-bounded polymorphism unless necessary; prefer composing `Comparator<UserId>` externally. When you must use it, ensure all `UserId` instances share a class loader.

---

## Bug 8 — `super` call routing through bridge unexpectedly

```java
public class Animal { public Animal copy() { return new Animal(); } }
public class Dog extends Animal {
    @Override public Dog copy() { return new Dog(); }
}
public class Puppy extends Dog {
    @Override public Puppy copy() {
        Animal a = super.copy();   // expected to call Dog.copy()
        return (Puppy) a;          // ClassCastException
    }
}
```

**Symptom.** `new Puppy().copy()` throws `ClassCastException: Dog cannot be cast to class Puppy`.

**Cause.** `super.copy()` is dispatched via `invokespecial` to `Dog.copy()`, which creates a `Dog`, not a `Puppy`. The developer intended `super.copy()` to "magically" produce a `Puppy` — bridges don't help with this; `super` is non-virtual.

**Fix.** Don't do this. If `Puppy.copy()` needs to leverage `Dog.copy()`'s logic, refactor `Dog.copy()` to take a factory parameter, or build the `Puppy` directly:

```java
@Override public Puppy copy() { return new Puppy(); }
```

The covariant return narrows the *declared* type; it does not change the *constructed* type of `super.copy()`.

---

## Bug 9 — Framework introspection skips bridges and misses annotations

```java
public class SoapClient implements RemoteCaller<SoapRequest, SoapResponse> {
    @Override
    @Retry(attempts = 3)
    public SoapResponse call(SoapRequest req) { /* ... */ }
}

public class RetryProcessor {
    void scan(Object bean) {
        for (Method m : bean.getClass().getDeclaredMethods()) {
            if (m.isBridge()) continue;       // skip bridges, sound enough?
            Retry r = m.getAnnotation(Retry.class);
            if (r != null) install(m, r);
        }
    }
}
```

**Symptom.** `@Retry` is detected fine — *until* someone calls the method through the raw `RemoteCaller` reference. The retry wrapper isn't applied because the framework installed retry on the *real* method, but invocation went through the bridge.

**Cause.** Filtering bridges is *one* of two valid strategies; the *other* is to also install on the bridge so that calls through any reference path are intercepted. Pure filtering plus dynamic proxy at the typed level misses raw-typed callers.

**Fix.** Either (a) install retry on both the real method and the bridge, recognising that the bridge forwards through `invokevirtual` and your wrapper must wrap at the dispatch level, or (b) ensure all callers go through a typed reference (often easier in modern code). Document the chosen strategy.

---

## Bug 10 — Deserialization picks the bridge over the real method

```java
public class Container<T> {
    private T value;
    public void setValue(T value) { this.value = value; }
    public T getValue() { return value; }
}

public class StringContainer extends Container<String> {
    @Override public void setValue(String value) { super.setValue(value.trim()); }
}
```

A custom JSON deserializer:

```java
for (Method m : type.getMethods()) {
    if (m.getName().startsWith("set") && m.getParameterCount() == 1) {
        Method setter = m;
        // ... invoke setter with the parsed value
    }
}
```

**Symptom.** Deserialising `{ "value": "  hello  " }` into a `StringContainer` produces a `value` of `"  hello  "` (untrimmed). The `trim()` logic was bypassed.

**Cause.** `getMethods()` returns both `setValue(String)` and the bridge `setValue(Object)`. Iteration order put the bridge first; the deserializer chose it; the bridge invokes the real setter via `invokevirtual`, which should still call the overridden one — but the deserializer cast the JSON value to `Object` (the bridge's parameter type) and passed it. The bridge then `checkcast`s to `String` (succeeds, since the value is a String), then calls the real setter — actually, in this case the trim *should* run.

The real bug shape here: the deserializer detected the bridge's parameter type as `Object`, decided "I'll pass any Object", and constructed an `Integer` from `{"value": 5}`. The bridge then `checkcast`-failed at runtime with `ClassCastException: Integer cannot be cast to String` — far from the JSON parsing code.

**Fix.** Always pair: filter bridges, *or* read `Method.getGenericParameterTypes()` after resolving to the real method. Jackson's `ObjectMapper` handles this correctly; hand-rolled deserialisers must too.

---

## Closing pattern

Nine of these ten bugs share the same root cause: the framework or test code treats *all methods equally* when in fact the JVM treats one as "the dispatched-by-the-runtime entry" (the bridge) and the other as "the implementation". The fix is always one of:

- **Filter** — `if (m.isBridge()) continue;` when you want what the user wrote.
- **Resolve** — `BridgeMethodResolver.findBridgedMethod(m)` when you have a bridge and want the real method.
- **Cover both** — install behaviour on both for full call-path coverage.

Pick a strategy explicitly. Don't leave it accidental.

---

**Memorize this:** bridges are real methods. Reflection sees them. Frameworks must decide — filter, resolve, or cover both. Bugs come from picking none of these, accidentally.
