# Yo-Yo Problem — Professional

At the professional level the Yo-Yo Problem stops being a textbook smell and becomes a real engineering constraint imposed by the frameworks you depend on. Spring, the Servlet API, JUnit, JPA — every major Java framework ships a deep inheritance chain that your code joins by extending. Managing that joined depth is the job.

---

## 1. Spring's `AbstractCrudRepository` family — a real yo-yo

A typical Spring Data JPA repository inheritance chain:

```
Repository                                  (level 0, marker)
  └── CrudRepository<T, ID>                 (level 1)
        └── PagingAndSortingRepository      (level 2)
              └── JpaRepository             (level 3)
                    └── YourCustomRepo      (level 4)
                          └── YourRepoImpl  (level 5, if you customize)
```

DIT is already 4–5 before you write a line of business logic. Every call to `save()` resolves through the proxy, then through `SimpleJpaRepository`, then potentially through your custom fragment, then back to a base class default. Stepping through this in a debugger is the canonical yo-yo experience.

**Professional rule:** never extend a Spring repository to add business logic. Use composition — inject the repository into a service class that owns the domain operations. The repository stays at its framework-imposed depth; your code stays at depth 1.

```java
// Wrong — adds depth on top of an already-deep chain
public interface OrderRepository extends JpaRepository<Order, Long> {
    default void confirmAndShip(Long id) { /* ... */ }   // business logic here is a trap
}

// Right — composition
@Service
public class OrderService {
    private final OrderRepository repo;
    public OrderService(OrderRepository repo) { this.repo = repo; }
    public void confirmAndShip(Long id) { /* ... */ }
}
```

---

## 2. Servlet API — the legacy yo-yo

The Servlet hierarchy is the canonical 1990s Java yo-yo:

```
Servlet (interface)
  └── GenericServlet
        └── HttpServlet
              └── YourBaseServlet (project-specific)
                    └── YourFeatureServlet
                          └── YourSpecialCaseServlet
```

In a 15-year-old codebase you will routinely find DIT = 6 or 7 with `service()` overridden at three levels, `doGet()` overridden at two, and a `super.doGet()` call somewhere in the middle that pulls you back up the chain.

**Migration approach for legacy servlets:**
1. Stop extending project-specific `BaseServlet` classes for new endpoints. Use Spring MVC controllers or filters instead.
2. For each existing chain, flatten by moving shared behavior into filter chain or interceptors (composition by configuration).
3. Replace `super.doGet()` calls with explicit delegation to a helper object.

---

## 3. JUnit hierarchies — the test-side yo-yo

JUnit 4 actively encouraged yo-yo with abstract test base classes:

```java
abstract class AbstractIntegrationTest { @Before public void setUp() { /* ... */ } }
abstract class AbstractRepositoryTest extends AbstractIntegrationTest { @Before public void setUp() { super.setUp(); /* ... */ } }
class OrderRepositoryTest extends AbstractRepositoryTest { @Before public void setUp() { super.setUp(); /* ... */ } }
```

Three levels of `setUp` with `super` calls is a textbook yo-yo, and the test failure messages are uninterpretable because the stack trace skips through three classes.

JUnit 5 fixes this culturally with `@ExtendWith` extensions (composition) and `@Nested` classes (containment). Professionally:
- Migrate test base classes to `@ExtendWith` extensions one at a time.
- Use `@Nested` for shared setup *within* a single test class instead of inheriting across files.
- Allow at most **one** abstract test base per project, and require code review approval to add a second.

---

## 4. ArchUnit — enforcing DIT < 4 in CI

[ArchUnit](https://www.archunit.org/) lets you encode architectural rules as JUnit tests. To bound DIT:

```java
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

@AnalyzeClasses(packages = "com.acme.app")
public class DepthOfInheritanceTest {

    private static final int MAX_DIT = 4;

    @ArchTest
    static final ArchRule depth_of_inheritance_is_bounded =
        classes()
            .that().resideInAPackage("com.acme.app..")
            .and().areNotInterfaces()
            .should(haveDepthOfInheritanceLessThan(MAX_DIT));

    private static ArchCondition<JavaClass> haveDepthOfInheritanceLessThan(int max) {
        return new ArchCondition<JavaClass>("have DIT < " + max) {
            @Override
            public void check(JavaClass item, ConditionEvents events) {
                int depth = 0;
                JavaClass current = item;
                while (current.getRawSuperclass().isPresent()
                       && !current.getRawSuperclass().get().getName().equals("java.lang.Object")) {
                    current = current.getRawSuperclass().get();
                    depth++;
                }
                if (depth >= max) {
                    events.add(SimpleConditionEvent.violated(item,
                        item.getName() + " has DIT " + depth + " (max " + (max - 1) + ")"));
                }
            }
        };
    }
}
```

This counts only your own classes (Object is excluded). For projects that extend framework classes you can either:
- Exclude framework superclasses from the count (above approach), or
- Use a higher threshold (e.g., 6) that accounts for framework depth.

ArchUnit runs in your normal `mvn test` cycle and fails the build on violation.

---

## 5. Migration playbook for a deep legacy hierarchy

You have inherited a codebase with `AbstractBaseEntityServiceImpl extends AbstractEntityServiceImpl extends AbstractServiceImpl extends BaseService` and 40 concrete subclasses. You cannot rewrite it in one sprint. Execute this playbook over a quarter.

### Week 1 — Measure

- Run a script (or use IntelliJ Code → Inspect Code → Class Metrics) to dump DIT for every class.
- Identify the top 10 deepest chains.
- For each, count callers (via Call Hierarchy) and bug-fix frequency (via git log).

### Week 2 — Inline trivial overrides

- For every override that is empty, only calls `super`, or only delegates, use IntelliJ `Inline Method`.
- Run tests after each batch of 5 inlines.
- This typically reduces DIT by 1 across half the chains for free.

### Weeks 3–6 — Carve out the leaves

- Pick the 5 most-modified leaf classes.
- For each, extract the leaf-specific behavior into a new class that the leaf *holds* (composition), not *inherits*.
- The leaf still extends the abstract chain temporarily — you are only adding a composition seam.

### Weeks 7–10 — Promote composition seams

- Where the composition seam is now stable, change the leaf's superclass to `Object` and pass the previously-inherited services in via constructor.
- One leaf at a time, with the ArchUnit rule progressively tightened from DIT < 8 to DIT < 6 to DIT < 4.

### Weeks 11–12 — Seal the survivors

- For abstract classes that genuinely model a type, mark them `sealed` and enumerate the permitted subtypes.
- Add javadoc explaining *why* this hierarchy resists flattening.

### Outcome

By the end of a quarter the ArchUnit rule passes at DIT < 4, the deepest chain is 3, and new code cannot regress because the build enforces it.

---

## 6. JPA `@MappedSuperclass` — yo-yo by entity inheritance

JPA inheritance strategies (`SINGLE_TABLE`, `JOINED`, `TABLE_PER_CLASS`) plus `@MappedSuperclass` produce some of the worst yo-yos because the *database schema* and the *Java hierarchy* are coupled.

Guidance:
- Prefer `@MappedSuperclass` for purely structural sharing (e.g., `id`, `createdAt`, `version`) — depth 1 only.
- For polymorphic entities, prefer the explicit discriminator with `SINGLE_TABLE` and a sealed Java hierarchy.
- Never go beyond two levels of entity inheritance. If you need a third, model it as a separate aggregate.

---

## 7. Quick rules

1. **Never extend a Spring framework class for business logic.** Compose.
2. **Cap project-defined DIT at 3.** Enforce with ArchUnit in CI.
3. **One abstract test base per project, max.** Code review gate on adding more.
4. **JUnit 5 extensions over inheritance.** `@ExtendWith` replaces `extends AbstractXyzTest`.
5. **Sealed types for legitimate hierarchies.** Bound the yo-yo at compile time.
6. **Migration is a quarter, not a sprint.** Measure, inline, carve, promote, seal — in that order.
7. **Framework depth does not excuse project depth.** Spring being deep is *more* reason for your code to be shallow.

---

## 8. What's next

| Topic | Why |
|---|---|
| [Fragile Base Class Problem](../06-fragile-base-class-problem/) | Deep framework hierarchies amplify fragility |
| [Composition Over Inheritance](../../../03-design-principles/02-composition-over-inheritance/) | The structural answer for framework-induced depth |
| [Refused Bequest](../05-refused-bequest/) | Common in framework subclasses that ignore inherited capability |

---

**Memorize this:** Frameworks impose 3–4 levels of DIT before you write any code. Your job is to add zero. Enforce it with ArchUnit, migrate legacy depth quarterly via inline-then-carve-then-promote, and never extend a Spring or Servlet class to host business logic.
