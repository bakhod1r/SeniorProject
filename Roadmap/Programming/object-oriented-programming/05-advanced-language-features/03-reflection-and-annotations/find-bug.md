# Reflection and Annotations — Find the Bug

> 10 buggy snippets that compile, look reasonable in review, and only bite at runtime. For each: read the code, name the misuse (wrapped exception, bridge method, JPMS, retention mismatch, classloader, `@Inherited`, default value, cache pollution, inlining loss, etc.), identify the symptom (stack trace, wrong value, silent failure), and write down the fix.

---

## Bug 1 — `InvocationTargetException` swallowing the real cause

```java
public final class HandlerInvoker {
    public Object call(Method m, Object target, Object... args) {
        try {
            return m.invoke(target, args);
        } catch (Exception e) {
            log.warn("handler failed: " + m.getName());
            return null;
        }
    }
}
```

```java
// Caller:
Object result = invoker.call(orderHandler.getClass().getMethod("place", Order.class),
                             orderHandler, order);
// result is null. No idea why. No exception in the log beyond "handler failed: place".
```

**Symptom.** Orders silently fail. The log says `handler failed: place` with no cause. Under load, support tickets pile up because no one can explain why some orders never appear.

**Violation.** `Method.invoke` wraps any exception thrown by the target in `InvocationTargetException`. The catch-all `Exception e` matches the wrapper, not the cause. Logging `e.getMessage()` would show "null" because `InvocationTargetException`'s own message is the wrapped class name, not the underlying problem.

**Fix.** Always unwrap, separate the two failure modes (the reflection failed vs the target threw):

```java
public Object call(Method m, Object target, Object... args) throws Throwable {
    try {
        return m.invoke(target, args);
    } catch (InvocationTargetException wrapped) {
        throw wrapped.getCause();                  // expose the real exception
    } catch (IllegalAccessException blocked) {
        throw new IllegalStateException(
            "reflection blocked on " + m, blocked);
    }
}
```

The caller now sees `OrderValidationException: invalid SKU`, not a useless wrapper.

---

## Bug 2 — `getMethod` finds the bridge, not the real method

```java
public class StringBox implements Comparable<StringBox> {
    private final String value;
    public StringBox(String v) { this.value = v; }
    @Override
    public int compareTo(StringBox other) { return value.compareTo(other.value); }
}

Method m = StringBox.class.getMethod("compareTo", Object.class);
// returns the synthetic bridge: int compareTo(Object) — calls into the real one
m.invoke(new StringBox("a"), "not a StringBox");
// throws ClassCastException inside the bridge
```

**Symptom.** A reflective dispatcher that walks `getMethods()` and groups by name finds *two* `compareTo` methods on `StringBox` — the real one taking `StringBox` and the synthetic *bridge* method taking `Object`. Calling the wrong one produces:

```
java.lang.reflect.InvocationTargetException
  Caused by: java.lang.ClassCastException: class java.lang.String cannot be cast to class StringBox
    at StringBox.compareTo(StringBox.java:1)
```

**Violation.** Generic methods compile to a bridge that erases generics to `Object`. Reflection sees both the typed method and the bridge; `getMethod("compareTo", Object.class)` returns the bridge.

**Fix.** Filter out bridge and synthetic methods, or look up the typed signature directly:

```java
for (Method m : StringBox.class.getDeclaredMethods()) {
    if (m.isBridge() || m.isSynthetic()) continue;
    // real method only
}

// Or look up the typed signature:
Method real = StringBox.class.getMethod("compareTo", StringBox.class);
```

For deeper background on bridge methods see [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/).

---

## Bug 3 — `setAccessible(true)` blocked by JPMS

```java
public final class FastJson {
    public String toJson(Object o) {
        StringBuilder sb = new StringBuilder("{");
        for (Field f : o.getClass().getDeclaredFields()) {
            f.setAccessible(true);                  // bang on Java 9+
            sb.append('"').append(f.getName()).append("\":")
              .append(f.get(o));                    // unreachable in some setups
        }
        return sb.append('}').toString();
    }
}
```

```java
// In a modular consumer:
new FastJson().toJson(java.time.LocalDate.now());
```

**Symptom.** Works on Java 8. Fails on Java 17 with:

```
java.lang.reflect.InaccessibleObjectException: Unable to make field private final
int java.time.LocalDate.day accessible: module java.base does not "opens java.time"
to unnamed module @5e91993f
```

**Violation.** JDK internal packages are not `opens` to outside modules. `setAccessible(true)` on `java.time.LocalDate.day` is illegal regardless of the field's visibility.

**Fix.** Three options, in order of preference:

1. **Don't reflect into JDK internals.** Use the type's documented API (`LocalDate.getDayOfMonth()`).
2. **Use a serialiser library that understands JPMS.** Jackson, Gson, and Moshi each handle this for the JDK types they know.
3. **Open the package at deployment time** (last resort, for legacy code):
   ```
   --add-opens java.base/java.time=ALL-UNNAMED
   ```

For the broader module rules see [../02-jpms-modules/](../02-jpms-modules/).

---

## Bug 4 — `@Retention(SOURCE)` annotation read at runtime

```java
@Retention(RetentionPolicy.SOURCE)             // <-- source-level
@Target(ElementType.METHOD)
public @interface RateLimited {
    int rps() default 100;
}

public class PricingApi {
    @RateLimited(rps = 50)
    public Money price(Order o) { /* ... */ }
}

// A "rate limiter" interceptor:
RateLimited rl = method.getAnnotation(RateLimited.class);
int limit = rl.rps();   // NullPointerException
```

**Symptom.**

```
java.lang.NullPointerException: Cannot invoke "RateLimited.rps()" because "rl" is null
    at com.acme.RateLimiterInterceptor.intercept(...)
```

The `RateLimited` annotation is *in the source*, *visible to the IDE*, *documented in Javadoc* — and *invisible at runtime*. `javac` deleted it.

**Violation.** `@Retention(SOURCE)` annotations don't exist in the class file. Reflection cannot read them. Lombok-style annotations are `SOURCE`-retained on purpose; runtime annotations are `RUNTIME`-retained.

**Fix.** Change the retention to `RUNTIME`:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface RateLimited { int rps() default 100; }
```

If you wanted compile-time rate limit *generation* instead — say, generating a wrapper class with the limits hard-coded — keep `SOURCE` retention and write an annotation processor that does the codegen.

---

## Bug 5 — `Class.forName` with the wrong class loader

```java
public final class PluginLoader {
    public static Plugin loadByName(String fqn) throws Exception {
        Class<?> c = Class.forName(fqn);                    // (*)
        return (Plugin) c.getDeclaredConstructor().newInstance();
    }
}

// In a Tomcat webapp:
Plugin p = PluginLoader.loadByName("com.acme.WelcomeBannerPlugin");
```

**Symptom.** In production:

```
java.lang.ClassNotFoundException: com.acme.WelcomeBannerPlugin
    at java.base/jdk.internal.loader.BuiltinClassLoader.loadClass(...)
    at PluginLoader.loadByName(PluginLoader.java:4)
```

The class definitely exists in `WEB-INF/lib/plugins.jar`. It just isn't visible to the loader that loaded `PluginLoader`.

**Violation.** `Class.forName(String)` (without an explicit loader) uses the *defining class loader of the caller* (`PluginLoader`). In Tomcat, `PluginLoader` lives in `shared/lib` (system loader), but plugins live in the webapp (webapp loader). The system loader cannot see the webapp's classes.

**Fix.** Pass the right loader explicitly, or — better — use `ServiceLoader`:

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
Class<?> c = Class.forName(fqn, true, cl);
```

```java
// Better, no string typo possible:
for (Plugin p : ServiceLoader.load(Plugin.class)) { /* ... */ }
```

The `ServiceLoader` version uses the *thread context class loader* by default, which is set by Tomcat to the webapp loader.

---

## Bug 6 — reflecting on a non-static inner class

```java
public class Outer {
    public class Inner {
        public String hello() { return "hi"; }
    }
}

// Trying to instantiate Inner via reflection:
Object inner = Outer.Inner.class.getDeclaredConstructor().newInstance();
```

**Symptom.**

```
java.lang.NoSuchMethodException: Outer$Inner.<init>()
    at java.base/java.lang.Class.getConstructor0(Class.java:...)
    at Outer$Inner.<clinit>(...)
```

There is no no-arg constructor — a non-static inner class always has an implicit reference to its enclosing instance, so its real constructor signature is `Inner(Outer)`.

**Violation.** Non-static inner classes carry a synthetic first parameter (the enclosing `Outer` instance). Forgetting that is a classic newcomer trap.

**Fix.** Pass the enclosing instance, or make `Inner` static:

```java
Outer o = new Outer();
Object inner = Outer.Inner.class
        .getDeclaredConstructor(Outer.class)
        .newInstance(o);
```

```java
// Or, if Inner doesn't need to access Outer's state:
public class Outer {
    public static class Inner { /* ... */ }    // no enclosing reference
}
```

The static form has the natural no-arg constructor — almost always what reflection-driven code wants.

---

## Bug 7 — `@Inherited` doesn't propagate through interfaces

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@Inherited
public @interface Auditable { }

@Auditable
public interface Trackable { }

public class Order implements Trackable { }

boolean tracked = Order.class.isAnnotationPresent(Auditable.class);
// false — but every reviewer reads it as true
```

**Symptom.** A security filter that "audits all classes marked `@Auditable`" silently skips orders. There is no exception — the security check just returns `false` and lets the request through. The bug surfaces during an audit, weeks later.

**Violation.** `@Inherited` walks the *superclass chain only*. Interfaces are excluded. `Order` does not directly carry `@Auditable`, and the JDK does not search `Trackable` for it.

**Fix.** Either move the annotation onto the class:

```java
@Auditable
public class Order implements Trackable { }
```

…or use a recursive helper that walks superclasses *and* interfaces, the way Spring's `AnnotationUtils.findAnnotation` does:

```java
static <A extends Annotation> A findOnHierarchy(Class<?> c, Class<A> ann) {
    while (c != null) {
        A a = c.getAnnotation(ann);
        if (a != null) return a;
        for (Class<?> i : c.getInterfaces()) {
            A onInterface = findOnHierarchy(i, ann);
            if (onInterface != null) return onInterface;
        }
        c = c.getSuperclass();
    }
    return null;
}
```

This is one of the most common framework-vs-JDK confusions: Spring `findAnnotation` finds it, JDK `getAnnotation` doesn't.

---

## Bug 8 — annotation default value treated as "always present"

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Cache {
    int ttlSeconds() default 60;
    String name() default "";
}

public class Pricing {
    @Cache(ttlSeconds = 120) public Money price(Order o) { return ...; }
    @Cache                   public Money discount(Order o) { return ...; }
}

// In the cache configurator:
for (Method m : Pricing.class.getDeclaredMethods()) {
    Cache c = m.getAnnotation(Cache.class);
    if (c == null) continue;
    if (!c.name().isEmpty()) {
        registerCache(m, c.name(), c.ttlSeconds());
    }
}
```

**Symptom.** `discount` is *never* registered. Production traffic always misses the cache for that method. The author insists "but I added `@Cache` to it." The configurator's `if (!c.name().isEmpty())` excludes any method whose `name()` element wasn't explicitly set.

**Violation.** The author conflated "annotation present" with "all elements set explicitly." `Cache` *is* present on `discount`; its `name()` element returns the default `""`. The reflective API gives you back the default value just as if it were explicit; you cannot tell from `c.name()` alone whether the user wrote it.

**Fix.** Either (a) make the registration unconditional based on annotation presence, and use a *generated* name when none is given, or (b) introspect more carefully if you really need to distinguish:

```java
if (c.name().isEmpty()) {
    registerCache(m, m.getDeclaringClass().getSimpleName() + "." + m.getName(),
                  c.ttlSeconds());
} else {
    registerCache(m, c.name(), c.ttlSeconds());
}
```

Java has no API to ask "was this annotation element set explicitly?" — the default value mechanism deliberately hides that distinction. Design your annotations so the default *means something*, not so the default flags "skip."

---

## Bug 9 — reflection cache keyed on the wrong thing

```java
public final class BeanIntrospector {
    private static final Map<String, List<Method>> CACHE = new ConcurrentHashMap<>();

    public List<Method> properties(Class<?> c) {
        return CACHE.computeIfAbsent(c.getName(), name -> {                  // (*)
            List<Method> getters = new ArrayList<>();
            for (Method m : c.getDeclaredMethods()) {                        // (**)
                if (m.getName().startsWith("get") && m.getParameterCount() == 0) {
                    getters.add(m);
                }
            }
            return getters;
        });
    }
}
```

**Symptom.** In a multi-classloader environment (Tomcat, OSGi, Spring DevTools hot-reload), introspection returns the *wrong* `Method` objects after a redeploy. Calling them throws:

```
java.lang.IllegalArgumentException: object is not an instance of declaring class
    at jdk.internal.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
```

The cache key — `c.getName()` — is just a string. Loader A's `com.acme.Order` and loader B's `com.acme.Order` collide; whichever was scanned first wins forever.

**Violation.** Using `String` as a cache key ignores the *identity* of the class. Two different `Class<?>` objects with the same name are *different classes* if they come from different class loaders.

**Fix.** Key on the `Class<?>` itself. The JVM unloads class loaders (and their classes) eventually; use `WeakHashMap` or `ClassValue` so the cache doesn't pin them:

```java
private static final ClassValue<List<Method>> CACHE = new ClassValue<>() {
    @Override protected List<Method> computeValue(Class<?> c) {
        List<Method> getters = new ArrayList<>();
        for (Method m : c.getDeclaredMethods()) {
            if (m.getName().startsWith("get") && m.getParameterCount() == 0) {
                getters.add(m);
            }
        }
        return getters;
    }
};

public List<Method> properties(Class<?> c) { return CACHE.get(c); }
```

`ClassValue` is the JDK's purpose-built cache for "value associated with a class," with the right liveness semantics for class unloading.

---

## Bug 10 — reflection breaks JIT inlining in a hot path

```java
public final class Dispatcher {
    private final Method handlerMethod;
    private final Object handler;

    public Dispatcher(Object handler, String name) throws NoSuchMethodException {
        this.handler = handler;
        this.handlerMethod = handler.getClass().getMethod(name, Event.class);
    }

    public void dispatchAll(List<Event> events) {
        for (Event e : events) {
            try { handlerMethod.invoke(handler, e); }      // (*)
            catch (ReflectiveOperationException ex) { throw new RuntimeException(ex); }
        }
    }
}
```

**Symptom.** On a benchmark replaying 10 M events per second through a single handler, `dispatchAll` is 30× slower than a direct call. `async-profiler` shows time inside `NativeMethodAccessorImpl.invoke`, `DelegatingMethodAccessorImpl`, and `Method.invoke` itself. The hot loop is not JIT-friendly.

**Violation.** `Method.invoke` does per-call argument boxing into an `Object[]`, per-call access checks, and per-call exception bookkeeping. The JIT treats `invoke` as opaque and cannot inline through it the way it inlines direct calls.

**Fix.** Build a `MethodHandle` and hold it in a `static final` field (for JIT constant folding) or instance field (cheaper than `Method` but no constant folding):

```java
public final class FastDispatcher<H> {
    private final H handler;
    private final MethodHandle handlerHandle;

    public FastDispatcher(H handler, String name) throws ReflectiveOperationException {
        this.handler = handler;
        MethodHandles.Lookup lookup = MethodHandles.publicLookup();
        this.handlerHandle = lookup.findVirtual(
                handler.getClass(),
                name,
                MethodType.methodType(void.class, Event.class));
    }

    public void dispatchAll(List<Event> events) throws Throwable {
        for (Event e : events) {
            handlerHandle.invokeExact(handler, e);
        }
    }
}
```

After JIT warmup, the loop is within 10–20% of a direct call — the per-call boxing and access check are gone. For more on the cost model see `optimize.md`.

---

## Pattern summary

| Misuse                                                | What to look for                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Wrapped exception (Bug 1)                             | `try { invoke } catch (Exception)` without unwrapping `InvocationTargetException`.        |
| Bridge / synthetic method (Bug 2)                     | Reflective dispatch on generic methods; check `m.isBridge() / m.isSynthetic()`.            |
| JPMS encapsulation (Bug 3)                            | `setAccessible(true)` on JDK or third-party module types; expect `InaccessibleObjectException`. |
| Wrong retention (Bug 4)                               | `getAnnotation(X.class)` returns `null` despite the annotation being on the source.       |
| Wrong class loader (Bug 5)                            | `Class.forName(String)` without explicit loader; multi-classloader environment.           |
| Inner-class constructor (Bug 6)                       | `getDeclaredConstructor()` on a non-static inner class — needs the enclosing instance.    |
| `@Inherited` interface gap (Bug 7)                    | Annotation declared on an interface, checked with `isAnnotationPresent` on an implementor. |
| Default-value invisibility (Bug 8)                    | Conditional logic on `c.name().isEmpty()` to mean "user didn't set it" — wrong.            |
| Cache key collision (Bug 9)                           | Cache keyed by class name `String` in a multi-classloader environment.                    |
| Hot-path reflection (Bug 10)                          | `Method.invoke` in a million-call-per-second loop; flame graph shows native accessors.   |

Most of these bugs share a theme: reflection *moves errors from compile time to runtime*, and the runtime error message is rarely the obvious one. Read each stack trace carefully, mistrust messages like "Cannot invoke X because X is null" — the missing X is almost always an annotation with the wrong retention, a method from the wrong loader, or an `InvocationTargetException` you forgot to unwrap.
