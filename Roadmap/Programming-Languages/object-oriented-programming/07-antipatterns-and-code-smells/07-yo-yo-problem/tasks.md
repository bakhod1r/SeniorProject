# Yo-Yo Problem — Tasks

Eight exercises that build practical skill at detecting, measuring, and eliminating yo-yo hierarchies. Each task includes a validation column. Work through them in order; later tasks assume the earlier setup.

---

## Task 1 — Measure DIT in your own codebase

**Goal:** Produce a sorted list of every class in your project by DIT.

**Steps:**
1. Open your project in IntelliJ.
2. Run Code → Analyze → Inspect Code with the "Class structure" inspection enabled.
3. Or run CKJM-extended from the command line:
   ```
   java -jar ckjm-ext.jar -d -p target/classes > metrics.txt
   ```
4. Sort by DIT descending. Identify the top 5.

**Validation:** Top-5 list with class name, DIT, NOC, package.

---

## Task 2 — Reproduce a yo-yo bug

**Goal:** Write code that demonstrates the constructor-calls-virtual-method bug.

**Steps:**
1. Create a `Parent` class whose constructor calls a protected `init()` method.
2. Create a `Child` that overrides `init()` and depends on a field initialized in `Child`'s constructor body.
3. Write a `main` method that constructs a `Child` and observes the bug.
4. Add a test asserting the failing behavior.
5. Fix the bug by making `init()` final and moving initialization into the constructor.

**Validation:** Failing test before fix, passing test after fix, plus a one-paragraph explanation of why.

---

## Task 3 — Flatten a Template Method

**Goal:** Convert a 3-level Template Method into Strategy.

**Steps:**
1. Start with this skeleton:
   ```java
   abstract class Pipeline {
       public final Result run(Input in) {
           Stage1 s1 = stage1(in);
           Stage2 s2 = stage2(s1);
           return finalize(s2);
       }
       protected abstract Stage1 stage1(Input in);
       protected abstract Stage2 stage2(Stage1 s);
       protected Result finalize(Stage2 s) { return new Result(s); }
   }
   abstract class CachedPipeline extends Pipeline {
       @Override protected Stage1 stage1(Input in) { return cache.computeIfAbsent(in, this::doStage1); }
       protected abstract Stage1 doStage1(Input in);
   }
   class ConcretePipeline extends CachedPipeline {
       @Override protected Stage1 doStage1(Input in) { /* ... */ }
       @Override protected Stage2 stage2(Stage1 s) { /* ... */ }
   }
   ```
2. Refactor to a single concrete `Pipeline` class that takes `Function<Input, Stage1>` and `Function<Stage1, Stage2>` strategies.
3. Move caching to a `Caching` wrapper function.

**Validation:** Final code has DIT = 1 for `Pipeline`. All previous behavior preserved (unit tests pass).

---

## Task 4 — Add an ArchUnit rule to your CI

**Goal:** Bound project DIT at 3 in the build.

**Steps:**
1. Add ArchUnit dependency:
   ```xml
   <dependency>
       <groupId>com.tngtech.archunit</groupId>
       <artifactId>archunit-junit5</artifactId>
       <version>1.3.0</version>
       <scope>test</scope>
   </dependency>
   ```
2. Copy the DIT < 4 rule from `professional.md`.
3. Run `mvn test`. If it fails, list the offending classes. If it passes, lower the threshold to 3 and try again.
4. For each violation, decide: refactor, exempt, or raise the threshold (and document why).

**Validation:** Test class committed, CI green, exception list (if any) documented in `docs/inheritance-exceptions.md`.

---

## Task 5 — Inline trivial overrides

**Goal:** Reduce DIT in a real chain by inlining empty/super-only overrides.

**Steps:**
1. Pick a chain from Task 1's top-5.
2. Open Method Hierarchy on the most-overridden method.
3. For each override that is empty or only calls `super.x(args)`, use IntelliJ Refactor → Inline Method.
4. Run all tests after each inline.
5. Measure DIT after.

**Validation:** Git diff showing N inlined methods, all tests passing, DIT reduced.

---

## Task 6 — Replace an entity inheritance chain with composition

**Goal:** Remove a JPA `@MappedSuperclass` chain in favor of an embeddable.

**Steps:**
1. Find a JPA entity that extends 2+ `@MappedSuperclass` levels (auditing, soft-delete, versioning).
2. Convert each parent into an `@Embeddable` value object.
3. Replace inheritance with `@Embedded` fields in the entity.
4. Update the schema migration to keep the same column names.
5. Run integration tests.

**Validation:** Entity now extends Object directly. Same SQL schema. Tests pass.

---

## Task 7 — Bench virtual call cost

**Goal:** Measure the runtime cost of depth on a hot path.

**Steps:**
1. Set up JMH (`org.openjdk.jmh:jmh-core` + `jmh-generator-annprocess`).
2. Use the benchmark skeleton from `optimize.md`.
3. Run with 1 leaf type, 2 leaf types, and 5 leaf types.
4. Record ns/op for each.
5. Plot.

**Validation:** A table or chart showing the megamorphic cliff between 2 and 3 receiver types.

---

## Task 8 — Migrate a JUnit 4 abstract test base to JUnit 5 extension

**Goal:** Eliminate one yo-yo from the test suite.

**Steps:**
1. Pick an `AbstractXyzTest` class in your project with 5+ subclasses.
2. Identify what it provides: setup, fixtures, helper methods.
3. Create a JUnit 5 `@Extension` that provides the setup via `BeforeEachCallback`.
4. Create helper *static* methods or a `TestHelper` class for the helpers.
5. For each subclass, remove `extends AbstractXyzTest` and add `@ExtendWith(XyzExtension.class)`.
6. Run all tests.

**Validation:** No `AbstractXyzTest` referenced anywhere. All test classes extend Object. All tests still pass.

---

## Validation table

| Task | Output | Acceptance criterion |
|---|---|---|
| 1 | Top-5 DIT list | Includes class name, DIT value, NOC value |
| 2 | Failing test + fix | Test fails before fix, passes after |
| 3 | Refactored pipeline | DIT = 1, behavior preserved |
| 4 | ArchUnit rule in CI | Build passes, exceptions documented |
| 5 | Inlined chain | DIT reduced by ≥ 1, all tests pass |
| 6 | Entity refactor | No `@MappedSuperclass`, same schema |
| 7 | JMH benchmark report | Shows monomorphic vs megamorphic gap |
| 8 | JUnit 5 extension | No abstract test base, tests pass |

---

## Worked solution sketch — Task 3

Starting point: 3-level `Pipeline`/`CachedPipeline`/`ConcretePipeline`.

**Target shape:**
```java
public final class Pipeline {
    private final Function<Input, Stage1> stage1;
    private final Function<Stage1, Stage2> stage2;
    private final Function<Stage2, Result> finalize;

    public Pipeline(Function<Input, Stage1> s1,
                    Function<Stage1, Stage2> s2,
                    Function<Stage2, Result> fin) {
        this.stage1 = s1; this.stage2 = s2; this.finalize = fin;
    }

    public Result run(Input in) {
        return finalize.apply(stage2.apply(stage1.apply(in)));
    }
}

public final class Caching {
    public static <A, B> Function<A, B> memoize(Function<A, B> inner) {
        Map<A, B> cache = new ConcurrentHashMap<>();
        return a -> cache.computeIfAbsent(a, inner);
    }
}

// Wiring (was a 3-class hierarchy, now one expression):
Pipeline p = new Pipeline(
    Caching.memoize(in -> doStage1(in)),
    s1 -> doStage2(s1),
    s2 -> new Result(s2)
);
```

Key moves:
1. `final class` instead of `abstract class` — bounded extension.
2. Strategies as `Function` — no overriding required.
3. Cross-cutting concerns (caching) as wrappers, not subclasses.
4. The whole pipeline is described in one place at construction time.

Result: DIT for `Pipeline` is 1 (just Object). To understand `p.run(in)`, a reader follows three lambdas in one file — no yo-yo.

The same technique generalizes to any Template Method: identify the variation points, lift them out as function parameters, mark the host class `final`.
