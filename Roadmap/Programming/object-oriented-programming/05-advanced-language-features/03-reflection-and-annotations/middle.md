# Reflection and Annotations — Middle

> **What?** Writing a custom annotation that drives real behaviour at runtime, reading it through `java.lang.reflect`, sketching a compile-time annotation processor, swapping reflective `Method.invoke` for a `MethodHandle`, and recognising how Spring's `@Component` scan works underneath.
> **How?** Build each idiom end-to-end on a small running example, then point at the framework that uses the same pattern at scale.

---

## 1. From "what is reflection" to "what to do with it"

Junior-level reflection is the API tour: `Class`, `Method`, `Field`, `invoke`. Middle-level reflection is *building something*: a tiny validator, a tiny serialiser, a tiny dependency injector. None of these need a framework — a few hundred lines of `java.lang.reflect` go a long way.

The middle-level reflexes:

- Define an annotation with the right retention and target.
- Scan a class for annotated members.
- Decide whether to act at runtime (reflection) or at compile time (annotation processor).
- Cache `Method`/`Field` lookups; never look them up in a hot loop.
- Prefer `MethodHandle` when the same method will be called many times.

---

## 2. A custom annotation that drives runtime validation

We will build a `@NotBlank` annotation that a tiny validator reads off any object's fields.

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
public @interface NotBlank {
    String message() default "must not be blank";
}
```

A field carrying it:

```java
public class SignupForm {
    @NotBlank                                 message = "email required"
    public String email;
    @NotBlank(message = "password required")
    public String password;
    public String referralCode;               // not validated
}
```

The validator walks `getDeclaredFields()`, picks the ones carrying `@NotBlank`, reads the value, and collects errors.

```java
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

public final class Validator {

    public List<String> validate(Object target) {
        List<String> errors = new ArrayList<>();
        for (Field f : target.getClass().getDeclaredFields()) {
            NotBlank nb = f.getAnnotation(NotBlank.class);
            if (nb == null) continue;

            f.setAccessible(true);
            try {
                Object value = f.get(target);
                if (value == null || (value instanceof String s && s.isBlank())) {
                    errors.add(f.getName() + ": " + nb.message());
                }
            } catch (IllegalAccessException e) {
                throw new IllegalStateException("cannot read " + f, e);
            }
        }
        return errors;
    }
}
```

Used:

```java
SignupForm form = new SignupForm();
form.email = "  ";
form.password = "hunter2";
List<String> errors = new Validator().validate(form);
// [email: email required]
```

This 30-line validator is, in spirit, what `jakarta.validation` does — except production validators cache `Field` lookups, support more constraint types, and validate nested objects. The mechanism is identical: annotation + reflection.

---

## 3. Caching reflective lookups

The validator above re-runs `getDeclaredFields()` and `f.getAnnotation(...)` on *every* `validate` call. For one form that is fine; for a request-per-millisecond API it isn't.

Cache the work by class:

```java
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class CachingValidator {

    private record Rule(Field field, NotBlank annotation) {}

    private final Map<Class<?>, List<Rule>> cache = new ConcurrentHashMap<>();

    public List<String> validate(Object target) {
        List<Rule> rules = cache.computeIfAbsent(target.getClass(), this::scan);
        List<String> errors = new ArrayList<>();
        for (Rule r : rules) {
            try {
                Object value = r.field().get(target);
                if (value == null || (value instanceof String s && s.isBlank())) {
                    errors.add(r.field().getName() + ": " + r.annotation().message());
                }
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
        return errors;
    }

    private List<Rule> scan(Class<?> c) {
        List<Rule> rules = new ArrayList<>();
        for (Field f : c.getDeclaredFields()) {
            NotBlank nb = f.getAnnotation(NotBlank.class);
            if (nb == null) continue;
            f.setAccessible(true);
            rules.add(new Rule(f, nb));
        }
        return rules;
    }
}
```

The pattern is universal: **scan once per class, store the result, reuse**. Every reflection-heavy framework does this. Jackson's `ObjectMapper`, Hibernate's `SessionFactory`, Spring's `BeanFactory` — all caches keyed by `Class<?>`.

---

## 4. Reading method annotations and invoking the method

The same idea, this time on methods. Build a tiny "test runner" that finds methods annotated `@Test` and invokes them.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Test { }

public final class TinyRunner {

    public int runAll(Class<?> testClass) throws Exception {
        Object instance = testClass.getDeclaredConstructor().newInstance();
        int passed = 0, failed = 0;
        for (Method m : testClass.getDeclaredMethods()) {
            if (!m.isAnnotationPresent(Test.class)) continue;
            try {
                m.invoke(instance);
                System.out.println(m.getName() + " PASS");
                passed++;
            } catch (InvocationTargetException wrapped) {
                System.out.println(m.getName() + " FAIL: " + wrapped.getCause());
                failed++;
            }
        }
        return failed;
    }
}
```

A user writes:

```java
public class MyTest {
    @Test public void addition()    { if (1 + 1 != 2) throw new AssertionError(); }
    @Test public void subtraction() { if (3 - 1 != 2) throw new AssertionError(); }
    public void notATest()          { throw new AssertionError("should not run"); }
}
```

`new TinyRunner().runAll(MyTest.class)` prints `addition PASS / subtraction PASS`. This is JUnit reduced to its essence: an annotation, a method scan, an invocation, unwrap `InvocationTargetException`. JUnit 5 adds parallelism, lifecycle (`@BeforeEach`), parameterised tests, and discovery across modules — but the spine is the same.

---

## 5. Annotation processors — moving work to compile time

Reflection happens at runtime. Sometimes the right answer is to read the annotation *at compile time* and generate code from it. That's an **annotation processor**.

An annotation processor is a `javax.annotation.processing.Processor` implementation registered through `META-INF/services/javax.annotation.processing.Processor`. The `javac` toolchain runs it during compilation and lets it inspect the source-level model of the program (no class loading, no reflection).

Sketch — a processor that, for every class annotated `@Builder`, generates a `XxxBuilder` class:

```java
@Retention(RetentionPolicy.SOURCE)              // source-level — discarded by javac
@Target(ElementType.TYPE)
public @interface Builder { }
```

```java
import javax.annotation.processing.AbstractProcessor;
import javax.annotation.processing.RoundEnvironment;
import javax.annotation.processing.SupportedAnnotationTypes;
import javax.annotation.processing.SupportedSourceVersion;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.Element;
import javax.lang.model.element.TypeElement;
import javax.tools.JavaFileObject;
import java.io.Writer;

@SupportedAnnotationTypes("Builder")
@SupportedSourceVersion(SourceVersion.RELEASE_21)
public final class BuilderProcessor extends AbstractProcessor {

    @Override
    public boolean process(Set<? extends TypeElement> annos, RoundEnvironment env) {
        for (Element e : env.getElementsAnnotatedWith(Builder.class)) {
            TypeElement type = (TypeElement) e;
            String pkg  = processingEnv.getElementUtils()
                          .getPackageOf(type).getQualifiedName().toString();
            String name = type.getSimpleName() + "Builder";

            try {
                JavaFileObject f = processingEnv.getFiler()
                        .createSourceFile(pkg + "." + name, type);
                try (Writer w = f.openWriter()) {
                    w.write("package " + pkg + ";\n");
                    w.write("public final class " + name + " {\n");
                    w.write("    // ... build a " + type.getQualifiedName() + " ...\n");
                    w.write("}\n");
                }
            } catch (Exception ex) {
                processingEnv.getMessager()
                        .printMessage(javax.tools.Diagnostic.Kind.ERROR, ex.getMessage());
            }
        }
        return true;
    }
}
```

The user writes `@Builder` on a class; the processor generates the builder source during compilation. **No runtime reflection.** Tools that work this way: Lombok (bytecode-time, technically), Google AutoValue, MapStruct, Dagger, Hibernate's JPA modelgen. The trade-off: more build complexity in exchange for runtime cost-free code generation.

A full processor needs a `META-INF/services/javax.annotation.processing.Processor` file listing `BuilderProcessor`, and the processor jar on the *annotation processor path* (`-processorpath` to `javac`, or a Maven `annotationProcessorPaths` entry). The detail belongs in `senior.md`; the shape belongs here.

---

## 6. `MethodHandle` — the faster alternative

`Method.invoke` is reflective and slow. `MethodHandle` is the JVM-level concept underneath: a typed, directly-callable reference to a method that the JIT can inline almost as aggressively as a direct call.

```java
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

public class HandleVsReflection {

    public static int square(int x) { return x * x; }

    public static void main(String[] args) throws Throwable {
        MethodHandles.Lookup lookup = MethodHandles.lookup();

        // Build a typed handle to square(int)->int.
        MethodHandle mh = lookup.findStatic(
                HandleVsReflection.class,
                "square",
                MethodType.methodType(int.class, int.class));

        // Invoke. Type signature is checked at link time, not on every call.
        int r = (int) mh.invokeExact(7);
        System.out.println(r);   // 49
    }
}
```

Key differences from `Method.invoke`:

| Aspect            | `Method.invoke`             | `MethodHandle`                                       |
| ----------------- | --------------------------- | ---------------------------------------------------- |
| Argument check    | Boxed `Object[]`, runtime   | Direct types, link time                              |
| Speed (cached)    | ~10× slower than direct     | Near-direct after JIT warmup                         |
| API surface       | Trivial: `invoke(target, args)` | Wider: `bindTo`, `asType`, `dropArguments`, etc. |
| Exception model   | Wraps in `InvocationTargetException` | Throws what the target throws                 |
| Available since   | Java 1.1                    | Java 7 (JSR 292)                                     |

`MethodHandle` is what `invokedynamic` (JEP 309 site, used by lambdas and `String` concatenation) sits on top of. When a framework cares about call speed at scale — e.g., Spring's expression engine, modern proxies — it migrates from `Method.invoke` to `MethodHandle`.

For the deeper performance discussion see `optimize.md`; for the dispatch instructions see [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/).

---

## 7. `@Repeatable`, `@Inherited`, `@Documented`

Three meta-annotations you'll meet once you go past the basics.

**`@Repeatable`** lets the same annotation appear multiple times on one element. You declare it together with a container annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@Repeatable(Schedules.class)
public @interface Schedule {
    String cron();
}

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Schedules {
    Schedule[] value();
}

class Job {
    @Schedule(cron = "0 0 * * *")
    @Schedule(cron = "0 12 * * *")
    public void run() { }
}

// Reading:
Schedule[] schedules = Job.class.getMethod("run").getAnnotationsByType(Schedule.class);
```

`getAnnotationsByType` (Java 8+) understands the container indirection so you read the repeated annotations as a flat array.

**`@Inherited`** says: if a superclass carries this annotation, subclasses are considered to carry it too. It applies *only to class annotations*, not methods or fields, and *only to direct superclass chains*, not interfaces:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@Inherited
public @interface RequiresAuth { }

@RequiresAuth class AdminController { }
class SuperAdminController extends AdminController { }

SuperAdminController.class.isAnnotationPresent(RequiresAuth.class);   // true
```

The "interfaces don't propagate `@Inherited`" rule trips up framework integrators regularly. See `find-bug.md` for the gotcha.

**`@Documented`** says the annotation should appear in generated Javadoc. Cosmetic, but standard practice for public API annotations.

---

## 8. Reflection in a real framework — Spring's `@Component` scan

Take the standard Spring annotation `@Component`. How does it work?

```java
@Component
public class OrderService {
    private final OrderRepository repo;
    public OrderService(OrderRepository repo) { this.repo = repo; }
}
```

Spring at startup does, in essence:

1. **Class path scan.** Walk every `.class` file under the configured base packages. Read the bytes; check whether `@Component` (or a meta-annotation that carries it, like `@Service`, `@Repository`) is present in the constant pool. Discovery is byte-code level, not reflection — discovery via reflection would force every class to be loaded just to be inspected, which is expensive.
2. **Class load for the survivors.** `Class.forName(name, false, classLoader)` on each component-bearing class.
3. **Constructor analysis.** Reflectively find a constructor (`getConstructors()`), look at parameter types — those are the dependencies.
4. **Resolve dependencies.** For each parameter, find another bean of that type; recurse if needed.
5. **Instantiate.** `Constructor.newInstance(deps...)`. Store the result in the application context.

Spring extends this with `@Autowired`, `@Qualifier`, configuration via `@Configuration` + `@Bean`, AOP proxies, and lazy initialisation — but the spine is what you just wrote with `TinyRunner` and `CachingValidator`. The principles transfer:

- **Scan once at startup**, never per-request.
- **Cache `Class<?>` → `BeanDefinition`** mappings.
- **Hide `Method.invoke` behind `MethodHandle` or generated proxies** for cross-cutting concerns.

You don't need to write a framework. You should *recognise* the moves when you read one.

---

## 9. Pitfalls a middle Java developer should already know

**Pitfall 1: confusing `getMethod` with `getDeclaredMethod`.**

`getMethod(...)` returns *public* methods including inherited ones. `getDeclaredMethod(...)` returns methods declared on *this exact class*, public or not, but not inherited. Asking `Sub.class.getMethod("baseMethod", ...)` works; `Sub.class.getDeclaredMethod(...)` does not unless `Sub` overrode it.

**Pitfall 2: forgetting `setAccessible(true)` on non-public reflection.**

Calling `getDeclaredField(...).get(instance)` on a non-public field without `setAccessible(true)` throws `IllegalAccessException`. The exception message is clear, but every newcomer hits it once.

**Pitfall 3: assuming `@Retention(SOURCE)` annotations can be read at runtime.**

They can't. Lombok's `@Getter`, JUnit's `@SuppressWarnings`-style helpers, IntelliJ's `@Nullable` (depends on the variant) — these don't reach the runtime. Choose retention based on *who reads it*.

**Pitfall 4: writing reflection in a hot loop.**

`Method.invoke` is 10–100× slower than a direct call. If a per-request controller method uses reflection once, that's nothing. If a per-row data loader uses it three times per row, you'll see it on a flame graph.

**Pitfall 5: `Class.forName` with the wrong class loader.**

In a server with separated class loaders (Tomcat, OSGi, modular JVM), `Class.forName("X")` uses the *caller's* class loader by default. If the class lives in a different loader, you'll get `ClassNotFoundException` even though `X` exists in the JVM. The fix: `Class.forName("X", true, Thread.currentThread().getContextClassLoader())` — but the deeper fix is to avoid `Class.forName` for plugin discovery and use `ServiceLoader` instead (see `senior.md`).

---

## 10. Quick rules

- [ ] One annotation declaration, one purpose, one retention — match retention to who reads it (source / class / runtime).
- [ ] Scan classes once at startup; cache results keyed by `Class<?>`.
- [ ] `getMethod` vs `getDeclaredMethod`: public+inherited vs this-class-only.
- [ ] `setAccessible(true)` for non-public; on Java 9+ may require `--add-opens`.
- [ ] Migrate hot reflection paths to `MethodHandle` once you've measured.
- [ ] Use annotation processors when work belongs at compile time (code gen, validation).
- [ ] Always unwrap `InvocationTargetException` to expose the real cause.
- [ ] Recognise the spine of every reflection-heavy framework: scan, cache, invoke.

---

## 11. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| MethodHandle/VarHandle, JPMS, `ServiceLoader`, classloader gotchas | `senior.md`      |
| Driving "no reflection unless necessary" in review               | `professional.md`  |
| JLS/JEP references that back reflection and annotations          | `specification.md` |
| 10 reflection bugs with stack traces and fixes                   | `find-bug.md`      |
| Reflection benchmarks, caching, `LambdaMetafactory`              | `optimize.md`      |
| Hands-on exercises                                               | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** middle-level reflection is *not* writing more reflection — it's building the smallest correct pattern (annotation + scanner + cache + invoker) and recognising the same pattern inside every framework you use. Cache lookups; unwrap `InvocationTargetException`; prefer `MethodHandle` once reuse outweighs setup; move work to compile time with annotation processors when you can. The framework you didn't write is one `Class.forName` and one `getDeclaredMethod` away.
