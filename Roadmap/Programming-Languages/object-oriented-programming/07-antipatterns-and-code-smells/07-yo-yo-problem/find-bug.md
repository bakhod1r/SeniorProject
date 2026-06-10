# Yo-Yo Problem — Find the Bug

Ten realistic scenarios. For each: the symptom, the inheritance chain that causes it, the diagnosis path, and the fix.

---

## Scenario 1 — Deep Template Method chain swallows a hook

**Symptom:** A `Report` subclass renders blank footers even though the leaf overrides `footer()`.

**Chain:**
```
Report (final render() calls header/body/footer)
  └── TabularReport (overrides body, declares abstract tableHeader)
        └── PaginatedReport (overrides body to call super.body() + page numbers)
              └── SalesReport (overrides footer to add timestamp)
```

**Diagnosis:** Open Method Hierarchy on `body()`. `PaginatedReport.body()` calls `super.body()` which is `TabularReport.body()`, which calls `defaultBody()`. None of them invoke `footer()`. The `final render()` does — but `PaginatedReport` actually overrode `render()` last year to "fix pagination" and never calls `footer()`.

**Fix:** Inline the broken `PaginatedReport.render()` override. The leaf's `footer()` is now reachable. Add a regression test that asserts every concrete `Report` calls all three template methods.

---

## Scenario 2 — Double-dispatch yo-yo (Visitor + inheritance)

**Symptom:** A visitor's `visit(Cat)` runs for a `PersianCat` instance instead of `visit(PersianCat)`.

**Chain:**
```
Animal { void accept(Visitor v) { v.visit(this); } }
  └── Cat extends Animal (no accept override)
        └── PersianCat extends Cat (no accept override)

Visitor { void visit(Animal a); void visit(Cat c); void visit(PersianCat p); }
```

**Diagnosis:** Java single-dispatches on the *static* type of `this` inside `accept`. Since `accept` is declared in `Animal`, `this` is `Animal` to the compiler, and `v.visit(this)` resolves to `visit(Animal)`. The intermediate `Cat` class never overrode `accept`, so the yo-yo upward stops too early.

**Fix:** Each concrete class must override `accept` to restore dispatch:
```java
class PersianCat extends Cat { @Override void accept(Visitor v) { v.visit(this); } }
```
Better fix: replace inheritance with sealed types + pattern matching (Java 21):
```java
sealed interface Animal permits Cat, Dog, PersianCat {}
switch (animal) { case PersianCat p -> ...; case Cat c -> ...; case Dog d -> ...; }
```

---

## Scenario 3 — Framework lifecycle chain swallows an exception

**Symptom:** A Spring `@PostConstruct` method's exception disappears; the bean appears to start cleanly but is in a broken state.

**Chain:**
```
AbstractInitializingBean
  └── AbstractCachedBean (overrides afterPropertiesSet, calls super)
        └── AbstractMonitoredBean (overrides afterPropertiesSet, wraps in try/catch logging)
              └── OrderProcessor (overrides afterPropertiesSet, calls super, throws on bad config)
```

**Diagnosis:** Step into `OrderProcessor.afterPropertiesSet()`. It throws. Stack unwinds into `AbstractMonitoredBean.afterPropertiesSet()` which has `try { ... } catch (Exception e) { log.warn(e); }`. The exception is logged at warn level and swallowed. Spring sees a clean startup.

**Fix:** Remove the catch-all in `AbstractMonitoredBean`, or rethrow as `BeanInitializationException`. Better: split monitoring into an `ApplicationListener<ContextRefreshedEvent>` (composition) so it never sits in the initialization path.

---

## Scenario 4 — Servlet `service()` chain doubles work

**Symptom:** Every request runs authentication twice, causing 2x DB load.

**Chain:**
```
HttpServlet
  └── SecureBaseServlet (overrides service, calls authenticate then super.service)
        └── AdminBaseServlet (overrides service, calls authenticate then super.service)
              └── UserManagementServlet (extends AdminBaseServlet)
```

**Diagnosis:** `SecureBaseServlet` and `AdminBaseServlet` each call `authenticate()` before `super.service()`. The chain executes both. A junior developer added `AdminBaseServlet`'s authenticate "to be safe" without checking the parent.

**Fix:** Delete the redundant `authenticate()` call in `AdminBaseServlet`. Add an ArchUnit rule forbidding multiple `service()` overrides in the same chain.

---

## Scenario 5 — `equals()` yo-yo breaks HashMap

**Symptom:** Entities silently disappear from a `HashMap` after being added.

**Chain:**
```
BaseEntity { equals: compare id }
  └── VersionedEntity extends BaseEntity { equals: super.equals && version match }
        └── Order extends VersionedEntity { equals: super.equals && status match }
```

**Diagnosis:** `equals` is symmetric? No. `new Order(id=1, version=1, status=NEW).equals(new Order(id=1, version=1, status=PAID))` returns false. But `hashCode` was only overridden at `BaseEntity` level — returning `Objects.hash(id)`. So two unequal Orders have the same hash code. The contract `a.equals(b) ⇒ a.hashCode() == b.hashCode()` is satisfied vacuously, but the *intent* is violated: HashMap puts them in the same bucket but then can't find them on retrieval because `equals` uses different criteria than the lookup expects.

**Fix:** Either keep equality at the id level only (recommended for entities — JPA convention) or override `hashCode` everywhere `equals` is overridden, ensuring consistency. Use Lombok `@EqualsAndHashCode(onlyExplicitlyIncluded = true)` to make this auditable.

---

## Scenario 6 — Constructor calls a virtual method (the classic)

**Symptom:** A field is null in a subclass even though the subclass constructor "set it".

**Chain:**
```
class Parent {
    Parent() { init(); }
    protected void init() {}
}
class Child extends Parent {
    private String name = "default";
    @Override protected void init() { System.out.println(name); }
    Child() { super(); name = "real"; }
}
```

**Diagnosis:** `new Child()` runs `Parent()` first, which calls the virtual `init()`. The override `Child.init()` runs while `name` has its field initializer value `"default"` — actually, even before the initializer runs in some orderings. The yo-yo here is the call going from `Parent` constructor *down* into `Child.init` before `Child`'s body executes.

**Fix:** Never call overridable methods from a constructor. Mark `init` `final` or `private`, or eliminate the inheritance entirely.

---

## Scenario 7 — `super.toString()` infinite loop

**Symptom:** `StackOverflowError` when logging an object.

**Chain:**
```
class A { @Override public String toString() { return "A:" + super.toString(); } }
class B extends A { @Override public String toString() { return "B:" + super.toString(); } }
// developer adds: 
class C extends B { @Override public String toString() { return super.toString() + ":C"; } }
// then refactors A to: @Override public String toString() { return "A:" + this.toString(); }
```

**Diagnosis:** Someone replaced `super.toString()` with `this.toString()` in `A` "to use the most derived form". For a `C` instance, `this.toString()` dispatches to `C.toString()`, which calls `super.toString()` → `B.toString()` → `super.toString()` → `A.toString()` → `this.toString()` → back to `C.toString()`. Infinite recursion.

**Fix:** Revert to `super.toString()`. Better: replace the chain with a single `toString` that uses `Objects.toString` or a builder, no inheritance.

---

## Scenario 8 — JPA `@PrePersist` chain misorders timestamps

**Symptom:** `createdAt` is set to a value 2 ms *after* `updatedAt`.

**Chain:**
```
Auditable { @PrePersist void onCreate() { createdAt = now(); updatedAt = now(); } }
  └── TimestampedAuditable extends Auditable { @PrePersist void onCreate() { super.onCreate(); updatedAt = now(); } }
        └── Order extends TimestampedAuditable {}
```

**Diagnosis:** JPA does not guarantee that `super.onCreate()` is called before the override's body — and worse, multiple `@PrePersist` methods in a hierarchy are each invoked independently by the provider. The exact order is implementation-defined. Hibernate calls them parent-to-child, so by the time `TimestampedAuditable.onCreate` runs, `createdAt` is already set, then `updatedAt` is reset to a fresher `now()`, making it strictly later.

**Fix:** Have only one `@PrePersist` in the hierarchy. Use composition via an entity listener:
```java
@EntityListeners(AuditingListener.class)
class Order { ... }
```

---

## Scenario 9 — `clone()` chain produces shallow copies

**Symptom:** Modifying a cloned object also modifies the original.

**Chain:**
```
class A implements Cloneable { Object clone() { return super.clone(); } }  // shallow
class B extends A { List<X> items; Object clone() { return super.clone(); } }  // still shallow
class C extends B { Map<K,V> index; Object clone() { return super.clone(); } }  // still shallow
```

**Diagnosis:** Each level overrode `clone` but only called `super.clone()`, which is `Object.clone()` — a field-by-field shallow copy. Neither `items` nor `index` was deep-copied. The yo-yo gave each developer the illusion of "doing their part" while none of them actually deep-copied.

**Fix:** Replace `Cloneable` with a copy constructor: `new C(other)`. Java's `Cloneable` is universally considered broken; do not extend chains that use it.

---

## Scenario 10 — Logging framework appender chain double-logs

**Symptom:** Every log line appears twice in the file appender.

**Chain:**
```
AppenderBase
  └── OutputStreamAppender (writes to stream)
        └── FileAppender (configures a FileOutputStream)
              └── RollingFileAppender (rotates file)
                    └── CustomRollingFileAppender (project-specific, overrides append, calls super.append, then writes again to a backup stream)
```

**Diagnosis:** `CustomRollingFileAppender.append(event)` calls `super.append(event)` (which writes to the configured stream) and then writes the same event to its own backup stream — except the backup stream was misconfigured to be the *same* file as the primary.

**Fix:** Remove `CustomRollingFileAppender`. Configure two appenders in Logback XML (composition) — one rolling, one backup — each pointing to a distinct file.

---

## Diagnosis cheat sheet

| Symptom | First action |
|---|---|
| "Method does something I did not write" | Open Method Hierarchy in IntelliJ |
| "Override has no effect" | Check if a parent overrode the caller |
| "Constructor sees null fields" | Search the parent constructor for virtual calls |
| "equals/hashCode misbehaves" | Confirm both are overridden at the same level |
| "Lifecycle hook fires wrong number of times" | Count `super.x()` calls in the chain |
| "Exception disappears" | Look for `catch (Exception)` in middle layers |
| "Cloned object shares state" | Replace `Cloneable` with copy constructor |
| "Visitor dispatches to wrong overload" | Confirm every concrete class re-declares `accept` |

The unifying tool is **IntelliJ's Method Hierarchy** (Ctrl+Shift+H). Run it before guessing. Every yo-yo bug above is solved in under a minute with that view open.
