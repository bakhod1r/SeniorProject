# Annotations & Decorators — Senior Level

> **Topic:** [Annotations & Decorators](README.md)
> **Focus:** Writing real annotation processors (APT rounds, code generation), how Lombok and Dagger actually work, runtime reflection scanning at scale, and the `reflect-metadata`/design-type machinery behind TypeScript & Angular DI.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)

---

## Introduction

> Focus: **You can already use and define these. Now you build the *machinery that processes them* — and you understand exactly how the famous frameworks pull off their magic.**

A senior engineer is the person on the team who can answer "but *how* does Lombok actually add a getter?", "why does Dagger have no runtime reflection?", "what does `@Component` cost at Spring startup?", and "why does Angular need `reflect-metadata` and `emitDecoratorMetadata`?" Those answers are the substance of this page.

The deep structure remains the same axis: **compile-time processing vs runtime processing**. But now we go inside each:

- **Compile time:** how `javac` drives annotation processors in *rounds*, how a processor reads the program's `Element` model and uses `JavaPoet`/`Filer` to *generate* new source, why Dagger generates a whole DI graph this way, and why Lombok is the controversial outlier that *mutates the compiler's AST* instead of generating files.
- **Runtime:** how reflection-based scanners (Spring's classpath scan, JUnit's discovery, Jackson's introspection) find annotated elements, what that costs at startup and per call, and how mature frameworks cache reflective metadata.
- **The TypeScript bridge:** how `@Component`/`@Injectable` decorators, the `emitDecoratorMetadata` compiler flag, and the `reflect-metadata` polyfill cooperate so a JS runtime — which has erased all the types — can still do constructor-based dependency injection.

By the end you should be able to design a code-generating annotation processor, reason quantitatively about reflection cost, and explain the Angular DI metadata pipeline from `@Injectable` to a resolved constructor argument.

---

## Prerequisites

- **Required:** Middle-level fluency: retention, `@Target`, meta-annotations, decorator factories, class decorators, stacking, `functools.wraps`.
- **Required:** Solid grasp of compile-time vs runtime processing as distinct phases.
- **Required:** Comfort with Java reflection (`Class`, `Method`, `getAnnotation`) and basic TypeScript classes.
- **Helpful but not required:** Having seen generated-sources folders (`target/generated-sources`, `build/generated`).
- **Helpful but not required:** Awareness that TypeScript types are *erased* — they don't exist at runtime in plain JS.

You do **not** yet need:

- The full TC39 Stage-3 decorator semantics and migration concerns (that's `professional.md`).
- Build-performance budgeting and incremental-processing strategy at monorepo scale (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **`Processor`** | A class implementing `javax.annotation.processing.Processor`, invoked by `javac` during compilation. |
| **Round** | One pass of annotation processing; generated files can trigger further rounds until none remain. |
| **`RoundEnvironment`** | The API a processor uses to query elements annotated in the current round. |
| **`Element`** | The compile-time model of a program node: `TypeElement` (class), `ExecutableElement` (method), `VariableElement` (field/param). |
| **`Filer`** | The API a processor uses to write generated source/class/resource files. |
| **`Messager`** | The API a processor uses to emit compile errors/warnings tied to an element. |
| **JavaPoet** | A popular library for programmatically building `.java` source to emit from a processor. |
| **AST mutation** | Editing the compiler's parse tree in place (Lombok's approach) rather than generating separate files. |
| **Classpath scanning** | Walking the classpath at startup to find classes carrying certain annotations (Spring). |
| **Reflective cache** | Storing the results of reflective annotation lookups to avoid repeating expensive reflection. |
| **`reflect-metadata`** | A polyfill implementing the `Reflect.metadata` API decorators use to store/read metadata in JS. |
| **`emitDecoratorMetadata`** | A TS compiler flag that emits `design:type`/`design:paramtypes` metadata for decorated declarations. |
| **`design:paramtypes`** | The metadata key under which TS stores a constructor's parameter types for DI. |
| **Type erasure (TS)** | TypeScript types vanish after compilation; runtime sees only JS. Metadata emission is the workaround. |

---

## Core Concepts

### 1. The annotation-processing round model

`javac` runs annotation processing as a loop:

1. Parse and enter sources; determine which annotations are present.
2. For each registered `Processor` whose `getSupportedAnnotationTypes()` matches, call `process(annotations, roundEnv)`.
3. A processor may *generate new source files* via the `Filer`.
4. If new files were generated, `javac` runs **another round** so processors can see (and process) the newly generated code.
5. Repeat until a round generates nothing; then a final round runs with `processingOver() == true`.

This round model is why code generators can build on each other and why a processor must be idempotent and tolerant of partial type information in early rounds. The processor never executes your program — it inspects the *`Element`* model (a static, type-level view) and emits text.

### 2. Reading the program: the `Element` model

A processor doesn't see objects; it sees `Element`s — a structural model of declarations:

- `TypeElement` — a class or interface.
- `ExecutableElement` — a method or constructor.
- `VariableElement` — a field or parameter.

You walk these to discover what to generate. Crucially, you cannot run any user code or read field *values* — only the declared structure and the annotations on it. This is what makes APT safe and deterministic.

### 3. Code generation: Dagger's model

Dagger is the canonical compile-time DI framework. From `@Inject`, `@Module`, `@Provides`, and `@Component`, Dagger's processor:

- Builds a dependency graph entirely at compile time.
- **Generates plain Java** (`DaggerAppComponent`, factory classes) that constructs your objects with direct `new` calls — no reflection.
- Surfaces missing-binding errors *as compile errors*, not runtime crashes.

The payoff: startup is fast (no scanning), the wiring is debuggable (it's real generated source you can read), and dependency mistakes fail the build. The cost: build time grows, and the generated code is unfamiliar to newcomers.

### 4. Lombok: the controversial AST mutator

Lombok's `@Getter`, `@Setter`, `@Data`, `@Builder` *look* like ordinary annotations, but Lombok does **not** generate separate files. It registers as an annotation processor and then reaches into `javac`/`ecj` internal APIs to **mutate the AST** — injecting methods directly into your class before bytecode is emitted. That's why the getters don't appear in your source but do appear in the compiled class.

This is powerful and reduces enormous boilerplate, but it's contentious because:

- It depends on **non-public compiler internals**, breaking across JDK versions (the JDK 9+ module system and later JDK releases repeatedly required Lombok updates).
- IDEs need a **plugin** to "see" the synthesized methods, since they aren't in the source.
- It blurs the "annotations are inert" rule — Lombok annotations *feel* like they have behavior, because the processor gives them behavior at compile time by editing your code.

Knowing this distinction (generate-new-files like Dagger vs mutate-AST like Lombok) is a senior-level differentiator.

### 5. Runtime reflection scanning: Spring's model and its cost

Spring's component model is the runtime counterpart. At startup, Spring:

- **Scans the classpath** for classes annotated `@Component`/`@Service`/`@Repository`/`@Controller` (often via bytecode-level scanning like ASM to avoid loading every class).
- Reads `@Autowired`, `@Value`, `@Qualifier` via reflection to build the bean graph.
- Creates and wires beans, frequently using proxies for `@Transactional`/`@Async` (AOP).

The costs are real and measurable:

- **Startup scanning** is O(classpath size); large apps spend meaningful seconds here.
- **Reflection** is slower than direct calls; hot paths that reflect per-invocation pay repeatedly.
- **Proxies** add indirection and can surprise (self-invocation bypasses the proxy, so `@Transactional` on an internally-called method silently does nothing).

This is precisely why frameworks like Micronaut and Quarkus moved DI/AOP to **compile time** (annotation processors) to slash startup time and enable native images — the same compile-vs-runtime trade-off, played out at framework scale.

### 6. The TypeScript metadata pipeline (Angular/NestJS DI)

Here's the puzzle: TypeScript types are *erased* at compile time. So how does Angular inject the right service into a constructor it can't see the types of?

```typescript
@Injectable()
class UserService {
  constructor(private http: HttpClient) {}
}
```

The pieces that make this work:

1. **Decorators must be enabled.** `@Injectable()` runs at class-definition time.
2. **`emitDecoratorMetadata: true`** tells the TS compiler to *emit* type information for decorated declarations as metadata — specifically `design:paramtypes`, an array of the constructor parameter *types* (`[HttpClient]`).
3. **`reflect-metadata` polyfill** provides the `Reflect.getMetadata('design:paramtypes', UserService)` API that lets Angular *read* that emitted array at runtime.
4. Angular's injector reads `design:paramtypes`, looks each type up in its DI registry, and supplies the instances.

So the decorator triggers metadata emission, the compiler writes the erased types back as runtime metadata, and the framework reflects on that metadata to do injection. **Crucially, the metadata is only emitted for declarations that have at least one decorator** — a famous gotcha (a class with no decorator gets no `design:paramtypes`, so DI on it fails).

### 7. The unifying picture

Every framework on this page is choosing *when* to pay:

| Framework | When it processes annotations | Mechanism | Runtime reflection? |
|-----------|------------------------------|-----------|---------------------|
| Dagger | compile time | generate Java | none |
| Lombok | compile time | mutate AST | none |
| MapStruct/AutoValue | compile time | generate Java | none |
| Spring (classic) | runtime startup | reflection + proxies | yes |
| Micronaut/Quarkus | compile time | generate Java | minimal |
| Angular/NestJS | definition + runtime | decorators + `reflect-metadata` | yes (metadata) |

Senior judgment is picking the right column for your latency, startup, and native-image constraints.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **APT rounds** | An assembly line that, after each pass, may add new parts that themselves need another pass — looping until stable. |
| **`Element` model** | An architect's drawing of a building: structure and labels, but no actual furniture or running utilities. |
| **Dagger codegen** | A factory that, from the blueprint's wiring notes, prefabricates the entire electrical harness before construction — plug-and-play, no on-site rewiring. |
| **Lombok AST mutation** | A contractor who edits the blueprint in pencil right before pouring concrete, so the finished building has rooms that never appeared on the filed plans. |
| **Spring runtime scan** | An inspection crew that, once the building is occupied, walks every floor reading plaques and wiring things up live. |
| **`reflect-metadata` pipeline** | The architect re-stamping the erased material specs onto each part so the live crew can still read what each component is made of. |

---

## Mental Models

### The "Pay Now or Pay Later" Model

Compile-time processing **pays now** (slower build) to make runtime free. Runtime reflection **pays later** (startup + per-call) to keep builds simple. There is no free lunch; there is only *when you'd rather pay*. Native images and cold-start-sensitive serverless push the whole industry toward "pay now."

### The "Erased Types Resurrected" Model (TypeScript)

Picture TS compilation as shredding all type information. `emitDecoratorMetadata` is a photocopier that, *only for decorated declarations*, copies the types onto a separate sheet (`design:paramtypes`) before shredding. `reflect-metadata` is the filing cabinet that holds those sheets at runtime. DI is the act of reading the right sheet. No decorator → no photocopy → no sheet → DI can't find the types.

### The "Two Halves, Industrialized" Model

The junior "annotation = half a feature, reader = other half" idea scales up: at framework level, the *reader* is an entire subsystem — a processor pipeline (Dagger) or a scanning/proxy engine (Spring). Choosing a framework is choosing which industrialized reader you adopt.

---

## Code Examples

### Java — a real annotation processor that generates code

```java
// processor module
@SupportedAnnotationTypes("com.example.GenerateToString")
@SupportedSourceVersion(SourceVersion.RELEASE_17)
public class ToStringProcessor extends AbstractProcessor {
    @Override
    public boolean process(Set<? extends TypeElement> annos, RoundEnvironment env) {
        for (Element e : env.getElementsAnnotatedWith(GenerateToString.class)) {
            TypeElement type = (TypeElement) e;
            String pkg = processingEnv.getElementUtils()
                    .getPackageOf(type).getQualifiedName().toString();
            String cls = type.getSimpleName() + "ToString";

            StringBuilder body = new StringBuilder();
            for (Element member : type.getEnclosedElements()) {
                if (member.getKind() == ElementKind.FIELD) {
                    body.append("    sb.append(\"")
                        .append(member.getSimpleName())
                        .append("=\").append(obj.")          // reads structure, not values
                        .append(member.getSimpleName()).append(");\n");
                }
            }
            try {
                JavaFileObject f = processingEnv.getFiler()
                        .createSourceFile(pkg + "." + cls);   // Filer writes a new file
                try (Writer w = f.openWriter()) {
                    w.write("package " + pkg + ";\n");
                    w.write("public final class " + cls + " {\n");
                    w.write("  public static String of(" + type.getSimpleName() + " obj){\n");
                    w.write("    StringBuilder sb = new StringBuilder();\n");
                    w.write(body.toString());
                    w.write("    return sb.toString();\n  }\n}\n");
                }
            } catch (IOException ex) {
                processingEnv.getMessager().printMessage(
                    Diagnostic.Kind.ERROR, ex.getMessage(), e);   // error tied to element
            }
        }
        return true;
    }
}
```

This processor walks the `Element` model, emits a new `XxxToString` source file via the `Filer`, and reports errors via the `Messager`. The generated file is compiled in a later round. This is exactly the shape (minus JavaPoet polish) of Dagger, AutoValue, and MapStruct.

### Java — registering the processor (`META-INF/services`)

```text
src/main/resources/META-INF/services/javax.annotation.processing.Processor
---------------------------------------------------------------------------
com.example.ToStringProcessor
```

`javac` discovers processors via this service file (or `@AutoService` generating it). Without registration, the processor never runs — a common "why is nothing generated?" mistake.

### Java — runtime scanning, with the reflective lookup cached

```java
final class HandlerRegistry {
    private final Map<Class<?>, Method[]> cache = new ConcurrentHashMap<>();

    Method[] handlers(Class<?> c) {
        return cache.computeIfAbsent(c, cls ->        // cache the reflection
            Arrays.stream(cls.getDeclaredMethods())
                  .filter(m -> m.isAnnotationPresent(Handler.class))
                  .toArray(Method[]::new));
    }
}
```

The reflective scan happens once per class; subsequent dispatches hit the cache. Mature frameworks (Spring, Jackson) all cache reflective metadata like this — never reflect in a hot loop.

### TypeScript — the full DI metadata round-trip

```typescript
import 'reflect-metadata';

function Injectable() {
  return function (_target: Function) { /* presence forces metadata emission */ };
}

class Logger {}
class Database {}

@Injectable()
class Service {
  constructor(public log: Logger, public db: Database) {}
}

// With emitDecoratorMetadata: true, the compiler emitted design:paramtypes.
const deps = Reflect.getMetadata('design:paramtypes', Service);
// deps === [Logger, Database]

function resolve<T>(ctor: new (...args: any[]) => T): T {
  const params: any[] = Reflect.getMetadata('design:paramtypes', ctor) || [];
  const args = params.map(p => resolve(p));   // recursively construct deps
  return new ctor(...args);
}

const s = resolve(Service);   // Logger and Database auto-injected
```

This is a miniature Angular/NestJS injector. The decorator's *presence* triggers `design:paramtypes` emission; `reflect-metadata` exposes it; `resolve` reads it to wire the graph. Remove `@Injectable()` and `design:paramtypes` is `undefined` — DI breaks.

### Python — a decorator that registers via metadata for later reflection

```python
import functools

def command(name):
    def deco(func):
        func._command_name = name          # attach metadata to the function object
        @functools.wraps(func)
        def wrapper(*a, **k):
            return func(*a, **k)
        wrapper._command_name = name        # keep metadata on the wrapper too
        return wrapper
    return deco

class CLI:
    @command("greet")
    def do_greet(self): print("hi")

# Discovery via reflection over the class:
def commands(obj):
    return {getattr(m, "_command_name"): m
            for m in (getattr(obj, n) for n in dir(obj))
            if callable(m) and hasattr(m, "_command_name")}
```

Python decorators can *also* play the "attach metadata, reflect later" game — annotating the function object and scanning with `dir`/`getattr`. This is how many Python frameworks (click, some test runners) blur the decorator/annotation line.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **APT code generation** | Zero runtime reflection; compile-time error checking; debuggable generated source; native-image friendly. | Build time grows; processors are intricate; round model and partial types are tricky. |
| **Lombok-style AST mutation** | Maximal boilerplate removal with minimal annotations. | Depends on compiler internals (fragile across JDKs); needs IDE plugins; obscures "inert annotation" mental model. |
| **Runtime reflection scanning** | No build coupling; adapts to any annotated code; simplest to start. | Startup scan cost; per-call reflection cost; errors at runtime; proxy surprises (self-invocation). |
| **`reflect-metadata` DI** | Enables type-driven DI despite TS type erasure; ergonomic constructor injection. | Requires a global polyfill + compiler flag; metadata only for decorated classes; brittle config. |
| **Caching reflective lookups** | Recovers most of reflection's cost. | Cache invalidation and memory; still slower than codegen on the cold path. |

---

## Use Cases

- **Compile-time DI/codegen:** Dagger, Micronaut, Quarkus, MapStruct, AutoValue — when startup latency or native images matter.
- **Boilerplate reduction:** Lombok, records-style generators — when teams accept the tooling dependency.
- **Runtime-flexible frameworks:** classic Spring, Jackson, Hibernate — when developer velocity and dynamism beat startup cost.
- **TypeScript DI:** Angular, NestJS, TypeDI, InversifyJS — constructor injection via `reflect-metadata`.
- **Plugin/handler discovery:** scanning for annotated handlers/commands/listeners across a codebase.

---

## Coding Patterns

### Pattern 1: Generate, don't reflect, on hot paths

When per-call latency matters, prefer a processor that emits direct code over runtime reflection. The generated `new`-based wiring eliminates reflection entirely. This is the architectural difference between Dagger and classic Spring.

### Pattern 2: Cache every reflective lookup

```java
private static final Map<Class<?>, List<Field>> FIELDS = new ConcurrentHashMap<>();
// reflect once per class, reuse forever
```

Never call `getAnnotation`/`getDeclaredMethods` in a loop without memoizing.

### Pattern 3: Tie processor errors to elements

Always pass the offending `Element` to `Messager.printMessage(ERROR, msg, element)` so the compiler points the developer at the exact line — a hallmark of a well-built processor.

### Pattern 4: Guard the TS metadata requirements

Ensure `experimentalDecorators` *and* `emitDecoratorMetadata` are on, `reflect-metadata` is imported once at entry, and **every injectable class carries a decorator** so `design:paramtypes` is emitted. Bake these into a lint rule.

---

## Best Practices

- **Choose your processing time deliberately.** Decide compile-time vs runtime based on startup budget, native-image needs, and team familiarity — not by default.
- **Make processors idempotent and round-safe.** Tolerate partial type info early; never assume all types exist in round one.
- **Cache all runtime reflection.** Reflect once per class; store the result; dispatch from the cache.
- **Treat Lombok's compiler-internals dependency as a real risk.** Pin versions, test JDK upgrades early, ensure IDE plugins are mandated.
- **Document the reader.** For any custom annotation, state whether a processor or a reflective scanner consumes it, and which.
- **For TS, centralize and lint the metadata config.** The three-part requirement (flag + flag + polyfill + decorator presence) fails silently; enforce it.
- **Measure startup scanning.** Profile Spring/Hibernate scan time; if it's a problem, shard scanning or move to a compile-time framework.
- **Beware proxy self-invocation.** `@Transactional`/`@Cacheable` via proxies don't apply to internal `this.method()` calls; structure accordingly.

---

## Edge Cases & Pitfalls

- **Processor not registered.** No `META-INF/services` entry (or `@AutoService`) means the processor silently never runs.
- **Reading field *values* in a processor.** Impossible — APT sees declarations, not runtime state. New processor authors hit this wall constantly.
- **Round-ordering assumptions.** Code that assumes a type generated in round 2 exists in round 1 throws `NullPointerException`s or "cannot find symbol" during the build.
- **Lombok after a JDK upgrade.** New JDKs change internal APIs; an un-upgraded Lombok breaks compilation entirely. Test JDK bumps with Lombok first.
- **Spring proxy self-invocation.** `this.transactionalMethod()` bypasses the proxy; the annotation does nothing — a perennial production bug.
- **TS: missing decorator → missing `design:paramtypes`.** A class without any decorator gets no emitted constructor types; DI fails with "can't resolve parameters."
- **TS: forgetting to import `reflect-metadata` once at the entry point.** `Reflect.getMetadata` is undefined; DI throws at startup.
- **`emitDecoratorMetadata` only emits for decorated members**, and only types the compiler can name — generics and interfaces erase to `Object`, breaking interface-based injection (why Angular/Nest use `@Inject(TOKEN)` for interfaces).
- **Reflection in a hot loop.** Uncached annotation lookups can dominate request latency; always memoize.
- **Generated code in version control.** Checking in generated sources causes drift and merge pain; generate during the build instead.
- **Annotation retention mismatch with the chosen reader.** A `SOURCE`-retained annotation can never be read by a runtime scanner, and a `RUNTIME`-retained one needlessly bloats the class file if only a processor reads it.
