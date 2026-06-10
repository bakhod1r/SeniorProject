# Reflection and Annotations — Professional

> **What?** Driving "no reflection unless necessary" across a team: the review vocabulary, the ArchUnit and Sonar checks that flag reflective code automatically, framework reflection costs at startup and at scale, mentoring without dogma, the discipline of designing an annotation processor, and migrating ad-hoc `Class.forName` paths to `ServiceLoader`.
> **How?** Treat reflection as an architectural choice with a measurable cost, not a coding idiom. Wire mechanical checks where you can; spend review attention on the cases tooling cannot reach.

---

## 1. The default position: no reflection unless necessary

Reflection is a hammer with three costs that compound across a codebase:

1. **It defeats the compiler.** A reflective call site does not break when a method is renamed, deleted, or has its signature changed. The breakage moves to runtime.
2. **It defeats the IDE.** "Find usages" misses reflective callers. Refactor-rename is unsafe.
3. **It defeats the JIT** (to a degree). `Method.invoke` warmed up still allocates argument arrays. `MethodHandle` is cheaper but not free.

The default position in a team's code review culture should be: **reach for reflection last, after every other option is ruled out.** Acceptable options to try first:

- A direct call, optionally through an interface (DIP).
- A `sealed` type with a `switch` (closed-world polymorphism).
- A `Function<A,B>` parameter (open-world without reflection).
- A `ServiceLoader<T>` for plugin discovery.
- An annotation processor (compile-time code generation).

If none of those fit, then reflection — with caching, scoped at startup, behind a small façade so the rest of the code never touches `java.lang.reflect`.

---

## 2. Code-review vocabulary

When you flag a reflection PR in review, name the cost concretely.

> **Reviewer:** This `Class.forName(System.getProperty("adapter"))` will break IDE rename. Use a `ServiceLoader<Adapter>` instead — the JDK handles discovery and the implementation list lives in `META-INF/services`, so adding an adapter is a configuration change, not a string-typed config.

> **Reviewer:** `getDeclaredMethod` on every request is doing the hash lookup per call. Hoist it to a `static final MethodHandle` initialised in `<clinit>`; the JIT will inline through it.

> **Reviewer:** This annotation is `@Retention(SOURCE)`; reading it via `getAnnotation` at runtime returns `null` always. Either change to `RUNTIME` or move the logic to an annotation processor.

> **Reviewer:** The wrapping `try { … } catch (Exception)` here swallows `InvocationTargetException.getCause()`. The user will see "operation failed" with no idea why — unwrap before rethrowing.

Each comment names *what's wrong*, *why it's a cost*, and *one concrete change*. Reflection PRs often arrive as a "magic" prototype the author is proud of; the review is more productive when it shows the cheaper alternative rather than scolding the choice.

---

## 3. ArchUnit checks that catch reflective code

ArchUnit reads bytecode, so it sees every reflective call. Wire these rules into CI to catch reflection *before* a reviewer has to read the diff.

```java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.*;

@AnalyzeClasses(packages = "com.example")
class ReflectionDisciplineTest {

    @ArchTest
    static final ArchRule no_reflection_in_domain =
        noClasses().that().resideInAPackage("..domain..")
                   .should().dependOnClassesThat()
                   .resideInAnyPackage("java.lang.reflect..", "java.lang.invoke..");

    @ArchTest
    static final ArchRule reflection_only_in_framework_layer =
        classes().that().dependOnClassesThat()
                 .resideInAPackage("java.lang.reflect..")
                 .should().resideInAnyPackage("..framework..", "..bootstrap..", "..plugin..");

    @ArchTest
    static final ArchRule no_classforname_with_string_literal =
        noMethods().that().areDeclaredInClassesThat()
                   .resideInAPackage("..service..")
                   .should().callMethodWhere(target ->
                       target.getOwner().getName().equals("java.lang.Class")
                       && target.getName().equals("forName"));
}
```

The intent is *not* to ban reflection — it is to confine it. Domain code never uses it; only a designated framework/bootstrap layer does. New hires can't accidentally add reflective glue inside business logic because CI rejects the PR.

You can layer a SonarQube rule on top: `S3878` (avoid unnecessary varargs), `S2658` (don't use `Class.forName` with classloader-sensitive arguments). The combined effect: every reflective code path is *intentional*, *located in a known package*, and *visible in CI logs*.

---

## 4. Framework reflection costs at startup

Spring, Hibernate, and Jackson together spend 100–500 ms at startup on reflective scanning for a non-trivial application. That cost is fixed; you can measure it and shrink it.

**Where the time goes (Spring Boot startup, illustrative profile):**

| Phase                                              | Typical cost |
| -------------------------------------------------- | ------------ |
| Classpath scan for `@Component`/`@Configuration`   | 80–200 ms    |
| Bean definition reflection (constructors, setters) | 40–100 ms    |
| AOP proxy generation (CGLIB / JDK proxies)         | 20–80 ms     |
| `@Autowired` field/parameter resolution            | 30–60 ms     |
| Hibernate `@Entity` and `@Column` reading          | 60–150 ms    |
| Jackson `ObjectMapper` mixin/serialiser warmup     | 20–80 ms     |

What you can do to compress it:

- **Narrow the scan path.** `@ComponentScan(basePackages = "com.acme.orders")` instead of the entire root. Order of magnitude difference on a fat jar.
- **Prefer constructor injection.** Spring resolves it faster than field injection (no per-field reflection on every bean), and tests don't need the container.
- **Use AOT compilation.** Spring Boot 3 (`spring-aot`) and GraalVM Native Image (`native-image`) move the reflective scan to *build* time. The runtime starts with prebaked bean definitions and a generated reflection config; startup drops from seconds to tens of milliseconds.
- **Cache reflection at the framework's level, not yours.** If you write a framework-style component, ship a `ConcurrentHashMap<Class<?>, ...>` keyed by class — never re-scan.

You won't always get to pick the framework, but you should *measure* its startup share with the JVM flag `-XX:+UnlockDiagnosticVMOptions -XX:+PrintFlagsFinal` and a startup profiler (`async-profiler`, JFR's `jdk.ClassLoad` event). "Reflective startup is slow" is folklore; "our `@ComponentScan` is scanning 18 000 classes because the base package is wrong" is a fact you can fix in one line.

---

## 5. Designing an annotation processor — the discipline

If you ship a processor as part of a library, treat it as a *public API*:

**Stable annotation surface.** Once `@MyAnnotation(value = "...")` is in someone's code, you cannot change `value()` to `name()` without breaking every consumer. Annotation elements are forever.

**Incremental compatibility.** Declare yourself as an `IncrementalAnnotationProcessor` (Gradle) or implement the equivalent Bazel/Buck protocol. A processor that breaks incremental compilation can double a downstream team's build times overnight.

**Idempotent output.** Re-running the processor on the same input must produce identical generated files. Determinism matters because build caches key on file hashes.

**Clear error messages.** Use `processingEnv.getMessager().printMessage(Kind.ERROR, "message", element)`. The IDE displays the error *on the source element*, not at the bottom of build output.

```java
private void requireNonStatic(ExecutableElement method) {
    if (method.getModifiers().contains(Modifier.STATIC)) {
        processingEnv.getMessager().printMessage(
            Diagnostic.Kind.ERROR,
            "@MyAnnotation cannot be applied to static methods",
            method);
    }
}
```

**A test harness.** `compile-testing` (Google) gives you fluent assertions on generated output:

```java
JavaFileObject source = JavaFileObjects.forSourceLines("com.example.Sample",
    "package com.example;",
    "@Builder public class Sample { int x; }");

Compilation result = Compiler.javac()
    .withProcessors(new BuilderProcessor())
    .compile(source);

assertThat(result).succeededWithoutWarnings();
assertThat(result)
    .generatedSourceFile("com.example.SampleBuilder")
    .containsElementsIn(...);
```

A processor without a test suite *will* regress; processors are easier to break than to write because they run inside someone else's build.

---

## 6. Mentoring without dogma

The junior who has just discovered reflection wants to write a "framework" for everything. The junior who has just heard a senior say "no reflection unless necessary" wants to ban it everywhere. Both miss the point.

The mentoring move is to anchor each rule to a felt outcome.

> **Mentor:** Remember the renaming bug last week, where `getDeclaredMethod("findById", long.class)` survived our refactor because the method was now called `find`? That's why we don't reflect-by-name on stable interfaces. The string was a private API contract nobody knew existed.

> **Junior:** Should I rewrite our test runner to avoid `@Test` reflection then?
> **Mentor:** No. JUnit's discovery is the right place for reflection — a fixed framework, scanned once at startup, behind an API everyone understands. The bad cases are reflection in *application* code, not in *infrastructure* code.

The recurring theme: reflection is *infrastructure*. It belongs in a `framework`, `bootstrap`, or `plugin` package, scoped to startup, behind a typed API. When it leaks into `domain` or `application`, the team has a smell to fix.

---

## 7. ArchUnit + reviewers: what each catches

| Concern                                                            | Tooling   | Reviewer |
| ------------------------------------------------------------------ | --------- | -------- |
| Reflection used in domain package                                  | ArchUnit  | —        |
| `Class.forName(stringLiteral)` instead of `ServiceLoader`          | ArchUnit  | Reviewer (suggest replacement) |
| Annotation with `@Retention(SOURCE)` read at runtime               | SpotBugs (`UWF`-style) or custom rule | Reviewer |
| `Method.invoke` in a hot loop without caching                      | Profile/benchmark | Reviewer  |
| `setAccessible(true)` on someone else's module without `opens`     | Runtime fails | Reviewer (anticipate) |
| `InvocationTargetException` not unwrapped                          | SpotBugs (`REC`-style) | Reviewer |
| `Class<?>` used without bound generics                             | IDE warning | Reviewer |
| Annotation processor with no `@SupportedSourceVersion`             | javac warning | Reviewer |

The pattern: tooling handles location and shape; reviewers handle intent and consequences.

---

## 8. Refactoring `Class.forName` to `ServiceLoader`

The most common reflective pattern in legacy code is plugin loading via configured class names:

```java
// Before — fragile, IDE-blind, hand-rolled
public final class CodecRegistry {
    public static Codec load(String configProp) throws Exception {
        String className = System.getProperty(configProp);
        return (Codec) Class.forName(className)
                .getDeclaredConstructor()
                .newInstance();
    }
}
```

Problems:

- Class name is a string. Typo at deploy time, `ClassNotFoundException` at startup.
- The implementation has to have a no-arg constructor; expressing that contract is implicit.
- If `Codec` is loaded by one class loader and the impl by another, the cast fails (see senior.md).
- Discovery is one-at-a-time; if a deployment ships two codecs, you discover them in some other configured property.

After:

```java
public interface Codec {
    String name();
    byte[] encode(String s);
}

// Each provider:
// META-INF/services/com.example.Codec  (one class FQN per line)

// Consumer:
public final class CodecRegistry {
    private final Map<String, Codec> byName;

    public CodecRegistry() {
        this.byName = ServiceLoader.load(Codec.class).stream()
                .map(ServiceLoader.Provider::get)
                .collect(Collectors.toUnmodifiableMap(Codec::name, c -> c));
    }

    public Optional<Codec> find(String name) {
        return Optional.ofNullable(byName.get(name));
    }
}
```

What you gained:

- The JDK does the class loading with the right loader.
- The provider list is declared in `META-INF/services` (or `provides` in `module-info.java`) — discoverable by tooling.
- The contract — `Codec` with `name()` and `encode(...)` — is fully typed; IDEs and the compiler enforce it.
- Multiple providers are first-class. Iteration order is the discovery order.
- Replacing the implementation in a downstream module *adds* a service file; no source change.

This is the prototypical reflection-to-`ServiceLoader` refactor. Once a team does it twice they stop writing `Class.forName` over strings entirely.

---

## 9. When reflection is the right tool

To balance the discipline: there are cases where reflection is the *cheapest* solution.

- **Test-only access.** A unit test wants to verify a private invariant. `getDeclaredField("state").get(instance)` is faster to write than a "test-only" getter that pollutes production.
- **One-off scripts.** Ten lines to read a JSON file with reflection, no Jackson on the classpath, runs once a quarter. Don't over-engineer.
- **Adapter shims for older APIs.** Sometimes you need to call a method that exists in JDK 21 but not JDK 17, and your code must compile against both. `Class.forName("java.util.NewClass")` with a fallback is the standard idiom.
- **Genuinely dynamic dispatch.** A scripting engine, a rules engine, a configuration system where types arrive at runtime and you cannot enumerate them ahead of time.

In each case, the rule is the same: write the reflection once, *behind a typed facade*, with caching, with proper exception handling, and document why it had to be reflective. The next reader (often you) sees the rationale, not just the magic.

---

## 10. Quick rules

- [ ] Default to no reflection in application code; confine it to framework, bootstrap, plugin layers.
- [ ] Wire ArchUnit rules to block reflective imports in the domain package.
- [ ] In review, name the cost concretely: IDE rename, JIT inlining, retention mismatch.
- [ ] Cache `Class<?>` → metadata, hold `MethodHandle` in `static final` fields.
- [ ] Replace ad-hoc `Class.forName(stringLiteral)` with `ServiceLoader<T>`.
- [ ] Ship annotation processors with incremental support and a test harness.
- [ ] Always unwrap `InvocationTargetException` before re-raising.
- [ ] Match annotation retention to who reads it; `SOURCE` is invisible at runtime.
- [ ] Measure framework reflection at startup; trim component scan paths; consider AOT for native images.
- [ ] Mentor by attaching each rule to a felt bug; don't dogma it.

---

## 11. What's next

| Topic                                                  | File              |
| ------------------------------------------------------ | ----------------- |
| JLS/JEP references                                     | `specification.md` |
| Ten reflection bugs with stack traces and fixes        | `find-bug.md`      |
| JMH numbers, MethodHandle vs Method.invoke vs direct   | `optimize.md`      |
| Hands-on exercises                                     | `tasks.md`         |
| Interview Q&A                                          | `interview.md`     |
| Plain-English intro and `Class.forName` example        | `junior.md`        |
| Custom annotation + processor + `MethodHandle`         | `middle.md`        |
| Performance, JPMS, `ServiceLoader`, classloader bugs   | `senior.md`        |

---

**Memorize this:** reflection is infrastructure, not application code. Confine it to a named layer, wire ArchUnit rules to keep it there, cache lookups, hold `MethodHandle` as `static final`, replace `Class.forName` over strings with `ServiceLoader`, ship annotation processors with tests and incremental support. The mentor's job is to attach each rule to a real outcome — a renamed method that silently broke, a startup time that halved when scan paths shrank — never as a five-word slogan.
