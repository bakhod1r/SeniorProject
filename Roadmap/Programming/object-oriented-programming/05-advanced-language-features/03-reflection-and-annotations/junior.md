# Reflection and Annotations — Junior

> **What?** *Reflection* is the JDK's ability to inspect and call code by name at runtime — load a class given its string name, list its methods and fields, read or write fields, and invoke methods you didn't reference at compile time. *Annotations* are metadata you attach to declarations (`@Override`, `@Deprecated`, your own `@interface`) that the compiler, the JVM, or framework code can read.
> **How?** Reflection lives in `java.lang.Class` and the `java.lang.reflect` package: `Class<?>`, `Method`, `Field`, `Constructor`, `Parameter`. You start from a `Class<?>` object (`MyClass.class` or `Class.forName("a.b.MyClass")`), ask it for a `Method`, and `invoke` it. Annotations are declared with `@interface`, retained at one of three levels (`SOURCE`, `CLASS`, `RUNTIME`), and read off a `Class`/`Method`/`Field` with `getAnnotation(...)`.

---

## 1. What reflection actually is

Java is statically typed and statically linked: at compile time, every method call resolves to an exact target by name and signature. Reflection is the *escape hatch* that lets your program ask, at runtime, "what types and methods exist in this class loaded right now?" and call them indirectly.

Every loaded class in the JVM has a corresponding `Class<?>` object — a piece of metadata describing its name, methods, fields, supertypes, and annotations. Reflection is the API that reads (and to a limited degree, writes) that metadata.

You will not write reflection in everyday code. You will *read* it constantly — almost every Java framework you touch (Spring, Hibernate, Jackson, JUnit, Mockito) is reflection underneath. Knowing the API stops these frameworks from feeling like magic.

---

## 2. The first reflective call

The classic three-step reflective invocation: load the class, look up the method, call it.

```java
import java.lang.reflect.Method;

public class FirstReflection {

    public static String greet(String name) {
        return "Hello, " + name;
    }

    public static void main(String[] args) throws Exception {
        // 1. Load the class object by fully qualified name.
        Class<?> clazz = Class.forName("FirstReflection");

        // 2. Look up the method by name and parameter types.
        Method m = clazz.getMethod("greet", String.class);

        // 3. Invoke it. First argument is the receiver (null for static); rest are parameters.
        String result = (String) m.invoke(null, "world");

        System.out.println(result);   // Hello, world
    }
}
```

Three things to notice:

- `Class.forName(...)` takes the *fully qualified* class name as a string. The JVM finds it through the same class loader that loaded the caller.
- `getMethod(name, paramTypes...)` finds a *public* method whose declared parameter types match. For non-public methods you need `getDeclaredMethod(...)`.
- `invoke(receiver, args...)` calls the method. For static methods, the receiver is `null`. The return type is `Object` — you cast it back.

---

## 3. Fields, constructors, modifiers

The same pattern works for fields and constructors. Each one has a dedicated reflection type.

```java
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;

public class Person {
    public String name;
    private int age;

    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }
}

class InspectPerson {
    public static void main(String[] args) throws Exception {
        Class<?> c = Person.class;

        // Construct a Person reflectively.
        Constructor<?> ctor = c.getConstructor(String.class, int.class);
        Object p = ctor.newInstance("Ada", 36);

        // Read a public field.
        Field name = c.getField("name");
        System.out.println(name.get(p));    // Ada

        // List all declared fields (public + non-public, this class only).
        for (Field f : c.getDeclaredFields()) {
            System.out.println(Modifier.toString(f.getModifiers())
                    + " " + f.getType().getSimpleName()
                    + " " + f.getName());
        }
        // prints:
        // public java.lang.String name
        // private int age
    }
}
```

`Modifier` is a small utility class with constants and `toString` helpers — useful for printing readable modifier strings without bit-twiddling `int` flags.

---

## 4. `setAccessible(true)` and why private fields aren't really private under reflection

Java enforces access control at compile time and, to a degree, at runtime. Reflection bypasses it — *if you ask it to*. The escape hatch is `setAccessible(true)`:

```java
Field age = Person.class.getDeclaredField("age");
// age.get(p);                       // throws IllegalAccessException — age is private
age.setAccessible(true);             // disable the access check
System.out.println(age.get(p));      // 36
```

This is how serialisation libraries read private fields, how testing frameworks invoke private helpers, and how Spring assigns dependencies into non-public fields.

**Two important catches:**

1. **Calling `setAccessible(true)` is not silent permission.** Since Java 9 the module system (JPMS) blocks reflective access into modules that have not declared `opens` for the package — `setAccessible` will throw `InaccessibleObjectException`. See [../02-jpms-modules/](../02-jpms-modules/) for the module rules.
2. **It is a security-sensitive operation.** A `SecurityManager` (pre-Java 17) could veto it; in modern Java it is restricted by module boundaries instead.

For a first pass: if your reflective code worked on Java 8 and stopped working on Java 9+, the answer is almost always "you crossed a module boundary, add `--add-opens`."

---

## 5. What an annotation actually is

An annotation is metadata you attach to a declaration. `@Override`, `@Deprecated`, `@SuppressWarnings` are the three you have already seen. They look like keywords but they are *types* — instances of an `@interface` declaration.

```java
public class Animal {
    public void speak() { }
}

public class Dog extends Animal {
    @Override                                 // built-in compiler annotation
    public void speak() { System.out.println("woof"); }

    @Deprecated(since = "2.0", forRemoval = true)
    public void bark() { speak(); }
}
```

- `@Override` is a *compiler check*: javac refuses to compile if `speak()` doesn't actually override anything. It's a safety net against typos and signature drift.
- `@Deprecated` is read at compile time (warning) *and* at runtime (visible via reflection); IDEs strike it through.

Built-in annotations you should recognise without thinking:

| Annotation             | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `@Override`            | "This overrides a supertype method." Compiler checks.                  |
| `@Deprecated`          | "Don't use this in new code." Compiler warns; JDK 9+ adds `forRemoval`.|
| `@SuppressWarnings`    | "Stop warning me about X for this scope." e.g. `"unchecked"`.          |
| `@SafeVarargs`         | "I know what I'm doing with this varargs of a generic type."           |
| `@FunctionalInterface` | "This interface has exactly one abstract method." Compiler enforces.   |

---

## 6. Declaring your own annotation

The keyword is `@interface`. The body lists *elements* — each one looks like a method without a body, optionally with a `default`.

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)        // visible at runtime via reflection
@Target(ElementType.METHOD)                // legal on methods only
public @interface Timed {
    String value() default "";             // optional label
    long warnAboveMillis() default 1000;
}
```

Use it:

```java
public class ReportJob {
    @Timed(value = "monthly-report", warnAboveMillis = 5000)
    public void run() { /* ... */ }
}
```

Three things every custom annotation declares:

- **Retention** — until when does this annotation survive? `SOURCE` (discarded by javac), `CLASS` (kept in `.class` but not loaded by the runtime), `RUNTIME` (visible to reflection). Default is `CLASS`. If you want to *read* it at runtime, you need `RUNTIME`.
- **Target** — which declarations may this annotation appear on? `METHOD`, `FIELD`, `TYPE`, `PARAMETER`, `CONSTRUCTOR`, etc. Without `@Target`, it's legal everywhere.
- **Elements** — each "method" defines a key. Allowed types: primitives, `String`, `Class`, enums, other annotations, and arrays of those.

---

## 7. Reading an annotation at runtime

If the retention is `RUNTIME`, you can ask any `Class`, `Method`, `Field`, etc. for its annotations.

```java
import java.lang.reflect.Method;

for (Method m : ReportJob.class.getDeclaredMethods()) {
    Timed t = m.getAnnotation(Timed.class);
    if (t != null) {
        System.out.println(m.getName() + " is @Timed, warn > " + t.warnAboveMillis() + " ms");
    }
}
```

`getAnnotation(Class)` returns `null` if the annotation isn't there. `isAnnotationPresent(Class)` returns a boolean if you only want a yes/no answer.

This is how JUnit finds `@Test`, how Spring finds `@Component`, and how Jackson finds `@JsonProperty`. The mechanism is the same one your `Timed` example uses.

---

## 8. Common newcomer surprises

**Surprise 1: `Method.invoke` wraps your exception.** If the called method throws, `invoke` does not throw that exception — it throws `InvocationTargetException` with your exception as its cause:

```java
try {
    method.invoke(target);
} catch (InvocationTargetException wrapped) {
    Throwable real = wrapped.getCause();   // <-- this is your actual exception
}
```

Forgetting to unwrap is the most common reflection bug. See `find-bug.md` for a full example.

**Surprise 2: `@Retention(SOURCE)` annotations don't exist at runtime.** If you write:

```java
@Retention(RetentionPolicy.SOURCE)
public @interface MyMarker { }
```

…you cannot then read it via `getAnnotation(MyMarker.class)` — it was deleted by javac. Lombok's `@Getter` is `SOURCE`-only; you cannot reflect it.

**Surprise 3: Reflection is slow.** A reflective `Method.invoke` is typically 10–100 times slower than a direct call (millions of calls per second instead of billions). Frameworks cache `Method` objects and use `MethodHandle` to mitigate this. Don't put `invoke` in a hot loop without measuring.

**Surprise 4: `setAccessible(true)` may throw on Java 9+.** If the package is not `open` to your module, the JPMS refuses. The fix is `--add-opens module/package=ALL-UNNAMED` in JVM args, or a proper `module-info.java` `opens` directive.

**Surprise 5: Primitive types have `Class` objects too.** `int.class`, `void.class`, `int[].class` are all real `Class<?>` instances — use them when looking up methods that take primitives:

```java
Method m = Math.class.getMethod("abs", int.class);   // NOT Integer.class
```

---

## 9. Quick rules

- [ ] Three reflective steps: `Class.forName(...)` (or `X.class`) → `getMethod(...)` → `invoke(...)`.
- [ ] `getMethod` finds public methods including inherited ones; `getDeclaredMethod` finds *this class's* methods regardless of access.
- [ ] `setAccessible(true)` is required for private members and may be blocked by JPMS.
- [ ] Custom annotations need `@Retention(RUNTIME)` to be readable by reflection.
- [ ] `@Target` says where the annotation may appear; `default` values let elements be optional.
- [ ] `Method.invoke` wraps thrown exceptions in `InvocationTargetException` — always unwrap.
- [ ] Reflection is 10–100× slower than direct calls; cache `Method` objects when reuse matters.
- [ ] You're using reflection every time you use Spring, Hibernate, Jackson, or JUnit — you just don't see it.

---

## 10. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Custom annotation + processor, MethodHandle as a faster alt      | `middle.md`        |
| MethodHandle/VarHandle perf, JPMS impact, ServiceLoader          | `senior.md`        |
| Reviewing reflection in PRs, ArchUnit checks, mentoring          | `professional.md`  |
| Where reflection and annotations live in JLS/JVMS/JEPs           | `specification.md` |
| Ten reflection bugs with the exact stack trace they produce      | `find-bug.md`      |
| Reflection benchmarks, caching, `LambdaMetafactory`              | `optimize.md`      |
| Hands-on exercises                                               | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** reflection lets you look up code by name at runtime via `Class` → `Method`/`Field` → `invoke`/`get`; annotations are typed metadata declared with `@interface` and survive at one of three retention levels. Frameworks live on these two features. You will read more reflection than you write — but when you write it, expect `InvocationTargetException`, `IllegalAccessException`, `InaccessibleObjectException`, and a 10× slowdown unless you cache.
