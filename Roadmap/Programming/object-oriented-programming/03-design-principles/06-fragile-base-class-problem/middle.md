# Fragile Base Class Problem — Middle

> **What?** At the middle level you stop just spotting FBCP and start *designing around it* with concrete recipes: document self-use, mark hook methods explicitly, prohibit extension on non-hook methods with `final`, and refactor inheritance trees into composition. You also learn to recognise the three forms of FBCP (self-use change, new collision, removed call) in real PRs.
> **How?** Four mechanical recipes: (1) for new classes, default `final`; (2) for designed-for-inheritance classes, document self-use and freeze hook signatures; (3) for legacy `extends` chains, replace with composition step-by-step; (4) for must-keep inheritance, write *contract tests* that verify subclass-parent compatibility.

---

## 1. The "design for inheritance" recipe

Joshua Bloch's *Effective Java* item 19: *design and document for inheritance, or prohibit it*. The "design" half has a recipe:

1. **Identify hook methods.** Which methods are *meant* to be overridden? Document them explicitly as the extension surface.
2. **Mark every other method `final`.** Closes the rest of the API to inheritance.
3. **Document self-use of hooks.** For each hook, write which other methods call it, when, and how often. Subclass authors need this to override safely.
4. **Provide protected helpers if needed.** Helpers a subclass might need to call from its override.
5. **Test through inheritance.** Write a `MockSubclass` and exercise the parent's hooks; the test ensures the parent's hook protocol is stable.

```java
public abstract class HttpHandler {
    /**
     * Handle one HTTP request. The default implementation:
     *  1. calls {@link #authenticate(Request)} — hook 1
     *  2. if authenticated, calls {@link #process(Request)} — hook 2
     *  3. always calls {@link #log(Request, Response)} — hook 3
     * Override any hook to customize, but do not override handle() itself.
     */
    public final Response handle(Request req) {            // final — not a hook
        if (!authenticate(req)) return Response.unauthorized();
        Response resp = process(req);
        log(req, resp);
        return resp;
    }

    protected abstract boolean authenticate(Request req);  // hook 1
    protected abstract Response process(Request req);      // hook 2
    protected void log(Request req, Response resp) { /* default no-op */ }  // hook 3, defaultable
}
```

The contract is now *explicit*: subclasses override `authenticate`, `process`, `log`. The `handle` method's structure is `final` — the parent author can change `handle`'s internal logic *without* breaking subclasses, because subclasses can't depend on it. The hooks' signatures and call order are the published API.

---

## 2. Documenting self-use — the contract subclasses need

When the parent's method *calls another of the parent's methods*, that self-use is part of the contract for subclasses. Document it.

```java
/**
 * Insert all elements from c into this list.
 *
 * @implSpec This implementation iterates over c and calls {@link #add(Object)}
 *           for each element. Subclasses that override {@code add} will see
 *           that override invoked once per element of c.
 */
@Override
public boolean addAll(Collection<? extends E> c) {
    boolean changed = false;
    for (E e : c) changed |= add(e);
    return changed;
}
```

The `@implSpec` (a Javadoc tag since JEP 224) is the canonical place. It tells subclass authors:

- *What* this method does for users (specification).
- *How* this method does it for subclassers (`@implSpec`).
- *What* subclasses are required to do if overriding (`@implNote`).

Without this, subclassers must read the source — and the source's behaviour might change in the next release.

---

## 3. Refactoring an inheritance chain to composition

You inherited a 4-level `extends` chain that exhibits FBCP whenever the base is touched:

```java
abstract class BaseProcessor {
    public final void run() { before(); doWork(); after(); }
    protected void before() {}
    protected abstract void doWork();
    protected void after() {}
}
abstract class AbstractDomainProcessor extends BaseProcessor {
    @Override protected void before() { acquireLock(); }
    @Override protected void after()  { releaseLock(); }
}
class OrderProcessor extends AbstractDomainProcessor {
    @Override protected void doWork() { /* place order */ }
}
```

Three levels of inheritance. A change to `BaseProcessor.run()` (say, adding a `validate()` step) affects all three layers. Refactor to composition:

```java
// 1. Extract the shared behaviours into final classes
public final class LockAcquisition {
    public void acquire() { /* ... */ }
    public void release() { /* ... */ }
}

// 2. Express the workflow explicitly, no inheritance
public final class OrderProcessor {
    private final LockAcquisition lock;
    public OrderProcessor(LockAcquisition lock) { this.lock = lock; }

    public void run() {
        lock.acquire();
        try {
            placeOrder();
        } finally {
            lock.release();
        }
    }
    private void placeOrder() { /* ... */ }
}
```

No inheritance. The workflow is one method, readable top-to-bottom. Lock acquisition is a composed collaborator. Future changes to "what's done before and after" are local edits to `OrderProcessor.run()` — no parent class to coordinate with.

---

## 4. Contract tests — verifying subclass-parent compatibility

When you genuinely need an inheritance hierarchy (a framework you publish), write *contract tests* the subclasses must pass.

```java
public abstract class AbstractHttpHandlerContractTest {
    protected abstract HttpHandler newHandler();

    @Test void unauthenticatedRequestsReturn401() {
        HttpHandler handler = newHandler();
        Response r = handler.handle(unauthenticatedRequest());
        assertEquals(401, r.status());
    }

    @Test void authenticatedRequestsAreLogged() {
        HttpHandler handler = newHandler();
        AtomicBoolean logged = new AtomicBoolean();
        // Subclass arranges for logging to set this — via newHandler() returning a test subclass
        handler.handle(authenticatedRequest());
        assertTrue(logged.get());
    }
}

public class OrderHandlerContractTest extends AbstractHttpHandlerContractTest {
    @Override protected HttpHandler newHandler() { return new OrderHandler(); }
}
```

Every subclass author runs the contract suite against their implementation. A FBCP failure (a parent change that breaks a subclass) shows up as a failing contract test — *before* it ships.

---

## 5. Spotting FBCP form 1 — self-use changes

The PR adds a logging step to the parent:

```java
// Parent v1
public class Account {
    public void deposit(BigDecimal amount) {
        validateAmount(amount);
        this.balance = balance.add(amount);
        notifyChange();
    }
    protected void notifyChange() { /* default no-op */ }
}

// Parent v2 — adds metric increment
public class Account {
    public void deposit(BigDecimal amount) {
        validateAmount(amount);
        this.balance = balance.add(amount);
        metrics.increment("account.balance.change");      // <-- new
        notifyChange();
    }
}

// Subclass — unchanged
public class AuditedAccount extends Account {
    @Override protected void notifyChange() {
        super.notifyChange();
        audit.record("notified");
    }
}
```

The metric increment is *outside* the `notifyChange` hook. The subclass's audit still fires. But what if the parent refactors so `notifyChange()` is no longer called? The audit silently stops. FBCP form 1.

Mitigation: when reviewing a parent's PR, scan for changes to self-use of overridable methods. The mental model: *every override binds the subclass to today's self-use pattern*. Any change to that pattern is potentially breaking.

---

## 6. Spotting FBCP form 2 — accidental override

The parent adds a new method:

```java
// Parent v1
public class Repository {
    public void save(Object entity) { /* ... */ }
}

// Subclass — pre-existing
public class CachingRepository extends Repository {
    private void invalidate(String key) { cache.remove(key); }      // private helper
    @Override public void save(Object entity) {
        super.save(entity);
        invalidate(keyOf(entity));
    }
}

// Parent v2 — adds invalidate as a public hook
public class Repository {
    public void save(Object entity) { /* ... */ }
    public void invalidate(String key) { /* default: no-op */ }     // <-- new
}
```

The subclass's `private void invalidate(String key)` doesn't accidentally override (Java's compiler enforces `private` is per-class). But what if it had been `protected void invalidate(...)`? The subclass's helper would silently override the parent's hook — and any caller of `parent.invalidate(...)` would invoke the subclass's *private* logic.

The `@Override` annotation catches this: if the subclass *did* mean to override, adding `@Override` confirms it; if it didn't, the annotation makes the unexpected match obvious in review.

---

## 7. Spotting FBCP form 3 — removed methods

```java
// Parent v1
public class Service {
    protected void preProcess() { /* ... */ }
    public void run() { preProcess(); ... }
}

// Subclass
public class AuditedService extends Service {
    @Override protected void preProcess() {
        super.preProcess();
        audit.record("pre");
    }
}

// Parent v2 — removes preProcess
public class Service {
    public void run() { /* inlined the work */ }
}
```

The subclass fails to compile: `super.preProcess()` no longer exists. That's *fortunate* — it's a loud error. The dangerous case is when the parent makes the method *no-op* without removing it; the subclass continues to compile but its override never runs.

Mitigation: deprecate before removing (`@Deprecated(since = "5.0", forRemoval = true)`). Subclassers get a compile warning, then a compile error two versions later — a managed migration.

---

## 8. The "template method" pattern done right

The classic FBCP shape is the *Template Method* pattern: parent defines the algorithm, subclass overrides the steps.

```java
public abstract class ImportPipeline {
    public final ImportResult run(Path file) {           // final — workflow frozen
        validate(file);                                  // hook 1
        var rows = parse(file);                          // hook 2
        var entities = transform(rows);                  // hook 3
        return persist(entities);                        // hook 4
    }
    protected abstract void validate(Path file);
    protected abstract List<Row> parse(Path file);
    protected abstract List<Entity> transform(List<Row> rows);
    protected abstract ImportResult persist(List<Entity> entities);
}
```

Done well, Template Method:
- Marks `run` `final`. Subclasses can't change the workflow.
- Names every hook `protected abstract` — the extension surface is explicit.
- Documents each hook's contract (preconditions, postconditions, exceptions).
- Provides contract tests every subclass must pass.

Done badly, Template Method:
- `run` is not `final`; subclasses override it to "add a step" — fragility multiplies.
- Hooks are `protected void` with default empty bodies, no documentation.
- Subclasses inherit a 10-level chain of templated overrides; the actual algorithm is impossible to find.

The Template Method pattern is sound *only* when the parent is designed and documented for it. Otherwise it's the FBCP factory.

---

## 9. The "extension by default" trap

A new framework class:

```java
public class EventHandler {
    public void handle(Event e) { /* ... */ }
}
```

No `final`, no documentation. The author thinks "subclasses might want to extend; I'll leave it open." Six months later, 30 subclasses exist across the company. The author wants to refactor `handle` — and discovers that *every* internal call to `handle` from the parent is part of a contract the subclasses depend on.

The middle-level corrective: *default* `final`. The author asks themselves "do I have a documented inheritance design? Am I prepared to make this a public extension API?" If no — `final`. If yes — apply the design-for-inheritance recipe.

---

## 10. Quick rules

- Default `final` on new classes; un-`final` only with a designed-for-inheritance plan.
- Mark non-hook methods `final` even within designed-for-inheritance classes.
- Document self-use with `@implSpec`. The contract subclasses depend on is explicit.
- Replace inheritance for code reuse with composition — see [../02-composition-over-inheritance/](../02-composition-over-inheritance/).
- Contract tests verify subclass-parent compatibility; subclassers must pass them.
- Use `@Override` everywhere; catches accidental matches and misses.
- Deprecate hooks before removing them — managed FBCP migration.
- Template Method pattern: `final` workflow, `protected abstract` hooks, documented contracts.
- A subclass that requires reading the parent's source code to write correctly is fragile by construction.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Edge cases, self-use evolution, framework FBCP              | `senior.md`        |
| Driving FBCP awareness across a team                        | `professional.md`  |
| JLS rules on overriding, sealed types, final                | `specification.md` |
| Spotting FBCP-shaped runtime bugs                           | `find-bug.md`      |
| Performance: virtual calls, devirtualization                | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the mid-level skills are *design-for-inheritance recipes* and *FBCP form recognition*. The recipes: default `final`, document self-use, mark hooks explicitly, write contract tests. The forms: self-use changes (parent stops calling overridden method), accidental override (parent adds method that collides with subclass helper), removed call (parent removes the `super.x()` the subclass relied on). Apply the recipes; spot the forms; refactor to composition when possible.
