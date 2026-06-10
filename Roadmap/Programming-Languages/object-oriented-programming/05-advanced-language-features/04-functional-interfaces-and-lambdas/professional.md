# Functional Interfaces and Lambdas — Professional

> **What?** The vocabulary, tooling, and review heuristics for keeping lambda-heavy code legible at team scale: method-reference vs lambda choice, over-capture and long bodies as smells, ArchUnit guardrails, refactor playbooks, and the rules of thumb for designing library APIs that accept functional interfaces.
> **How?** Treat lambdas as *callable values*. In review, ask three questions: what shape does this callback have, what does it capture, and where does its instance live? Most lambda problems show up as answers to those three questions.

---

## 1. Code-review vocabulary

A lambda is a value of a functional interface. When you comment on one, name the shape and the move you'd prefer. "Use a lambda" or "this is too complex" are not actionable reviews — pointing at the SAM is.

```java
// PR diff:
orders.stream()
      .filter(o -> {
          if (o.status() == Status.CANCELLED) return false;
          if (o.customer() == null)            return false;
          var country = o.customer().address().country();
          if (country == null || country.isBlank()) return false;
          return o.total().compareTo(THRESHOLD) > 0;
      })
      .forEach(this::escalate);
```

> **Reviewer:** This `Predicate<Order>` is a 7-line block doing four checks. Extract them as named predicates and compose with `and`: `notCancelled.and(hasCustomer).and(hasCountry).and(largeEnough)`. The intent becomes readable and each predicate becomes individually testable.

Contrast:

```java
events.forEach(e -> {
    log.info("got {}", e);
    metrics.increment("events");
    bus.dispatch(e);
    if (e.isPriority()) priorityQueue.add(e);
});
```

> **Reviewer:** The `Consumer<Event>` body is doing four side-effects. Pull it into a private method `handleEvent(Event e)` and pass `this::handleEvent`. The lambda then names itself, and unit tests can call `handleEvent` directly without rebuilding the stream.

Both reviews are short, both name the functional interface, both end with a concrete move. That is the shape of useful lambda feedback.

---

## 2. Method reference or lambda? The rule

Method references are shorter; lambdas are more explicit. The line between them isn't aesthetic — it's about what readers must remember.

Prefer a **method reference** when:

- The body is one method call with the same arguments in the same order.
- The method's name *describes what is happening* at the call site (`Integer::parseInt`, `Order::isPaid`, `String::trim`).
- There is no overload ambiguity (find-bug.md covers the ambiguous case).

Prefer a **lambda** when:

- The body needs *any* logic beyond a single call (a cast, a null-check, an extra argument).
- The method is overloaded and you'd otherwise need to disambiguate by signature in your head.
- The reference would be `this::handle` next to several `handle*` siblings — the lambda makes the choice explicit.

```java
// Method reference earns its place — names the action:
list.stream().map(String::toUpperCase).toList();

// Lambda is clearer — extra argument:
list.stream().map(s -> s.toUpperCase(Locale.ROOT)).toList();

// Method reference *loses* — overloaded `process` makes readers guess:
items.forEach(this::process);

// Lambda makes the intent explicit:
items.forEach(item -> process(item, currentTenant));
```

In review, when you see a method reference that needs a *thought* to resolve (which overload? which argument order?), ask for the lambda back. The two characters you save don't beat the two seconds the next reader spends.

---

## 3. Over-capture — the silent smell

A lambda *captures* the enclosing instance whenever it references `this`, a field, or an instance method via an unbound reference. In long-lived registrations, that's a quiet way to retain unrelated state.

```java
public final class PageController {
    private final byte[] pageImage;             // 8 MB
    private final EventBus bus;

    PageController(EventBus bus, byte[] pageImage) {
        this.bus = bus;
        this.pageImage = pageImage;
        bus.on("tick", () -> log("tick"));      // implicit this — bus retains *this*
    }
    private void log(String s) { /* ... */ }
}
```

`PageController` registers a listener with `bus` and *cannot be garbage collected until the bus releases the listener*, even after the page is "closed". With many such pages, that's a real-memory leak.

Three fixes in order of preference:

```java
// 1. Use a static method — no `this` capture:
bus.on("tick", PageController::staticLog);

// 2. Pull just what you need into locals — capture is by value:
String name = this.name;
bus.on("tick", () -> System.out.println(name));

// 3. Maintain explicit subscriptions so you can unregister:
Subscription sub = bus.on("tick", () -> log("tick"));
onClose(() -> sub.cancel());
```

In review, the cue is "I see this lambda survives the surrounding method's scope, and it references a field or `this`. What keeps it alive?". If the answer is "forever, in a registry, until the JVM dies", the lambda is too greedy.

---

## 4. Long bodies — extract the method

A common anti-pattern is the multi-line lambda hidden inside a stream:

```java
events.stream().map(e -> {
    var enriched = enricher.lookup(e.id());
    var validated = validator.check(enriched);
    var normalized = normaliser.normalise(validated);
    return new Indexed(normalized, clock.instant());
}).forEach(indexer::index);
```

Three independent reasons to extract:

- The lambda body is a *named transformation*; give it a name.
- The body's intermediate variables become *unit-testable* once they live in a real method.
- Stack traces in production point at `lambda$N$M` — useless. A real method shows up as `enrichToIndexed` in the stack and in the profiler.

After:

```java
events.stream().map(this::enrichToIndexed).forEach(indexer::index);

private Indexed enrichToIndexed(Event e) {
    var enriched   = enricher.lookup(e.id());
    var validated  = validator.check(enriched);
    var normalized = normaliser.normalise(validated);
    return new Indexed(normalized, clock.instant());
}
```

Style threshold: a lambda body longer than ~3 lines or containing a single non-trivial statement is usually a method waiting to happen. Encode it as a lint rule (Sonar `java:S5612` style) if the team agrees.

---

## 5. ArchUnit rules you can actually enforce

ArchUnit reads bytecode and can encode structural rules. A few that catch lambda-related mistakes before review:

```java
@ArchTest
static final ArchRule functional_interfaces_are_annotated =
    classes().that().areInterfaces()
             .and().resideInAPackage("..api.functional..")
             .should().beAnnotatedWith(FunctionalInterface.class);

@ArchTest
static final ArchRule no_serializable_lambdas_in_domain =
    noClasses().that().resideInAPackage("..domain..")
               .should().dependOnClassesThat()
               .haveSimpleName("Serializable");
// Catches `(SAM & Serializable) (...) -> ...` casts in the domain layer.

@ArchTest
static final ArchRule prefer_predicate_over_custom_filter =
    noClasses().that().resideInAPackage("..filter..")
               .should().haveSimpleNameEndingWith("Filter")
               .andShould().beInterfaces();
// Nudge: use Predicate<T>, don't invent FooFilter.
```

These won't catch every misuse, but they make the team's policy *executable* — and they keep "we agreed not to do this" from drifting back into the codebase six months later.

---

## 6. Designing library APIs that take functional interfaces

When you expose a method that takes a callback, you are designing a *contract* between your library and arbitrary callers. Some discipline:

```java
// Bad — Function<Order, Order> tells callers nothing about what's expected:
public Pipeline<Order> register(Function<Order, Order> step) { ... }

// Better — domain functional interface names the role and the contract:
@FunctionalInterface
public interface OrderStep {
    Order apply(Order in) throws OrderProcessingException;
}

public Pipeline<Order> register(OrderStep step) { ... }
```

Three rules:

1. **Name for the role, not the shape.** `OrderStep` is more useful than `Function<Order, Order>` because the name communicates *when the callback runs* and *what it's expected to do*.
2. **Be honest about exceptions.** If the callback may legitimately throw checked, declare it on the SAM. Forcing callers to wrap with `try/catch` to fit `Function<T,R>` is a smell on your side.
3. **Pin nullability and threading expectations in Javadoc.** Lambdas can hide null returns, blocking calls, and shared-state assumptions. Document them.

For overloads, beware that lambdas resolve by *shape*, which can collide with other functional-interface-typed overloads:

```java
// Caller writes `foo(x -> x.toString())`. Which overload?
public R foo(Function<X, String> f) { ... }
public R foo(Function<Y, String> f) { ... }
```

When this happens, callers must write a type annotation (`(X x) -> x.toString()`). Avoid overloads that differ only by functional-interface generic parameters; rename instead.

---

## 7. Refactor playbook — anonymous class → lambda → method reference

The IDE's "convert anonymous class to lambda" quick-fix is right 95% of the time. The 5% where it's wrong:

- The anonymous class uses `this` to refer to itself. After conversion, `this` is the *outer* class — semantics change silently.
- The anonymous class has fields (e.g., a per-instance counter). A lambda can't carry fields; the converted code captures a local instead, and the lifetime/semantics change.
- The anonymous class implements **more than one** abstract method. A lambda can only target a SAM; the IDE refuses, but a tired reviewer may apply the change manually anyway.

Audit checklist for a PR that mass-converts anonymous classes:

1. Search for `this` inside the converted bodies — confirm each usage was an *outer* reference, not a *self* reference.
2. Search for converted classes that previously had fields — those should *not* have been converted.
3. Verify no `Serializable` was lost (anonymous classes can be serialised; lambdas only when the target type is `Serializable`).
4. Run the test suite plus any reflection-based serialization tests.

The reverse refactor — lambda → method reference — is almost always safe; the only watchout is overload resolution ambiguity, which the compiler will flag.

---

## 8. Mentoring without dogma

Juniors discovering lambdas often produce:

```java
list.stream()
    .filter(x -> x != null)
    .map(x -> x.toString())
    .filter(s -> !s.isEmpty())
    .map(s -> s.toUpperCase())
    .collect(Collectors.toList());
```

Every step is a lambda where a method reference would be clearer, and the chain has no name. The mentoring move is concrete, not stylistic:

> **Mentor:** Each `x -> x.method()` here is a method reference waiting to happen — `Objects::nonNull`, `Object::toString`, `String::toUpperCase`. Once you swap them in, the chain reads as a sentence. Then ask whether the whole thing wants to be a single named transformation.

Anchor the rule to *reader experience*, not to "be more idiomatic". A junior who internalises "lambda body == one method call" → "method reference" learns the rule once and applies it everywhere.

---

## 9. Mistakes that ride along in lambda-heavy code

**Premature stream-everything.** Loops with control flow (early returns, exceptions, mixed side-effects) often read better as `for`. Streams are for transformations, not for replacing all iteration. Reviewer phrasing: "this stream is doing imperative work; a `for` would read more clearly."

**Reaching for `Function<T, R>` when the operation isn't pure.** If your callback writes to a database, sends a message, or mutates global state, it's not really a *function* — name it `OrderHandler`, `EventListener`, `RecordWriter`. The shape is the same; the name carries the contract.

**Over-decomposing.** Splitting one short predicate into three composed predicates because "composition is good" hurts more than helps. Compose when the predicates are *reused* or *named in the domain*; inline when they're not.

**Capturing in benchmarks.** A microbenchmark that creates the lambda inside the measured method captures locals on every iteration — you're measuring allocation, not the body. Hoist the lambda out of the measurement loop. Optimize.md covers this.

**Treating method references as always-shorter.** A method reference can be longer to *understand* than the equivalent lambda, even when it's shorter to *write*. Optimise for the reader.

---

## 10. Quick rules

- [ ] In review, name the SAM and the move ("this `Predicate<Order>` wants to be three composed predicates").
- [ ] Long lambda body → extract a private method; method references win on stack traces and tests.
- [ ] Audit long-lived lambdas for outer-instance capture; replace with `static` method refs or held subscriptions when the registration outlives the registering object.
- [ ] Encode lambda-design policy as ArchUnit rules where you can — `@FunctionalInterface` presence, no `Serializable` in domain, etc.
- [ ] In library APIs, prefer a named domain functional interface over a raw `Function<T, R>` — names communicate the contract.
- [ ] Audit IDE "convert anonymous to lambda" PRs for `this` semantics, fields, and `Serializable`.
- [ ] Method reference if and only if the body is exactly one method call with matching arguments; lambda otherwise.

---

## 11. What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| JLS/JVMS authority for everything claimed here                     | `specification.md` |
| Ten silent bugs that survive review                                | `find-bug.md`      |
| Cold-start cost, primitive specializations, JIT inlining           | `optimize.md`      |
| Hands-on refactors                                                 | `tasks.md`        |
| Interview Q&A                                                      | `interview.md`     |

See also: [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/) for `default`-method evolution of functional interfaces, [../03-reflection-and-annotations/](../03-reflection-and-annotations/) for `MethodHandle`-related APIs, and [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/).

---

**Memorize this:** lambdas are *callable values* — review them as values, not as syntax. Pick names for the role, watch for outer-instance capture, extract long bodies to named methods, and only use a method reference when the name *says what's happening*. The team gains nothing from clever lambdas and loses a lot to obscure ones.
