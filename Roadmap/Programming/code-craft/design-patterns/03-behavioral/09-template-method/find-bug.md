# Template Method — Find the Bug

> **Source:** [refactoring.guru/design-patterns/template-method](https://refactoring.guru/design-patterns/template-method)

Each section presents a Template Method that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Subclass overrides the template itself](#bug-1-subclass-overrides-the-template-itself)
2. [Bug 2: Public abstract steps callable out of order](#bug-2-public-abstract-steps-callable-out-of-order)
3. [Bug 3: Subclass forgets to call super](#bug-3-subclass-forgets-to-call-super)
4. [Bug 4: Constructor leaks `this` to template](#bug-4-constructor-leaks-this-to-template)
5. [Bug 5: Default hook with side effects](#bug-5-default-hook-with-side-effects)
6. [Bug 6: Liskov substitution violation](#bug-6-liskov-substitution-violation)
7. [Bug 7: Asynchronous step blocks the template](#bug-7-asynchronous-step-blocks-the-template)
8. [Bug 8: Recursive template re-entry](#bug-8-recursive-template-re-entry)
9. [Bug 9: Hook proliferation hides logic](#bug-9-hook-proliferation-hides-logic)
10. [Bug 10: Concurrent invocation corrupts shared state](#bug-10-concurrent-invocation-corrupts-shared-state)
11. [Bug 11: Subclass throws unexpected exception](#bug-11-subclass-throws-unexpected-exception)
12. [Bug 12: Missing exhaustiveness in pattern match](#bug-12-missing-exhaustiveness-in-pattern-match)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Subclass overrides the template itself

```java
public class Beverage {
    public void make() {   // not final
        boilWater();
        brew();
        pourIntoCup();
    }
    protected void brew() {}
}

public class WeirdTea extends Beverage {
    @Override
    public void make() {
        // skips boil water and pour
        brew();
    }
}
```

`WeirdTea` defeats the pattern.

<details><summary>Reveal</summary>

**Bug:** `make()` not `final`. Subclass overrides the entire template, breaking the algorithm structure.

**Fix:** mark `make()` `final`.

```java
public final void make() {
    boilWater();
    brew();
    pourIntoCup();
}
```

Subclasses can no longer override.

**Lesson:** Mark Template Methods `final`. Lock the algorithm structure.

</details>

---

## Bug 2: Public abstract steps callable out of order

```java
public abstract class Beverage {
    public final void make() {
        boilWater();
        brew();
    }
    public abstract void brew();   // public
}

// Caller:
Tea tea = new Tea();
tea.brew();   // BUG: skipped boilWater
```

<details><summary>Reveal</summary>

**Bug:** `brew()` is public; callers can invoke it directly, bypassing the template.

**Fix:** mark steps `protected`.

```java
public abstract class Beverage {
    public final void make() { ... }
    protected abstract void brew();   // protected
}
```

Only subclasses (and `make()`) can invoke `brew()`. External callers must use `make()`.

**Lesson:** Steps should be `protected`, not `public`. Encapsulate the lifecycle.

</details>

---

## Bug 3: Subclass forgets to call super

```java
public abstract class Component {
    protected void init() {
        registerListeners();
        loadConfig();
    }
}

public final class MyComponent extends Component {
    @Override
    protected void init() {
        // forgets super.init()
        customSetup();
    }
}
```

`registerListeners` and `loadConfig` never run.

<details><summary>Reveal</summary>

**Bug:** Subclass overrides `init()` but doesn't call `super.init()`. Parent's setup skipped.

**Fix:** restructure so the base class controls the flow:

```java
public abstract class Component {
    public final void init() {
        registerListeners();
        loadConfig();
        customInit();   // hook
    }

    protected void customInit() {}
}

public final class MyComponent extends Component {
    @Override
    protected void customInit() {
        customSetup();
    }
}
```

Base class always runs its setup. Subclass adds via `customInit`.

**Lesson:** Don't rely on subclasses calling `super`. Make the template `final` and provide explicit hooks.

</details>

---

## Bug 4: Constructor leaks `this` to template

```java
public abstract class Processor {
    protected final List<Hook> hooks;

    public Processor() {
        this.hooks = createHooks();   // calls overrideable method during construction
    }

    protected List<Hook> createHooks() { return new ArrayList<>(); }
}

public final class MyProcessor extends Processor {
    private String config;

    public MyProcessor(String config) {
        super();   // calls createHooks() before this.config is set
        this.config = config;
    }

    @Override
    protected List<Hook> createHooks() {
        return List.of(new ConfigHook(config));   // BUG: config is null
    }
}
```

NPE in `ConfigHook(config)` because it's called before `MyProcessor`'s constructor sets `config`.

<details><summary>Reveal</summary>

**Bug:** Constructor calls `createHooks()`, which is overridden. Subclass override runs before subclass constructor finishes initializing fields.

**Fix:** don't call overridable methods from constructors. Use a separate `init()` method.

```java
public abstract class Processor {
    protected List<Hook> hooks;

    public final void init() {
        this.hooks = createHooks();
    }

    protected List<Hook> createHooks() { return new ArrayList<>(); }
}

// Caller:
var p = new MyProcessor("cfg");
p.init();
```

Or use lazy initialization.

**Lesson:** Constructors shouldn't call overrideable methods. Subclass fields not yet initialized.

</details>

---

## Bug 5: Default hook with side effects

```java
public abstract class Pipeline {
    public final void run() {
        beforeRun();
        process();
        afterRun();
    }

    protected void beforeRun() {
        log.info("starting");
        metrics.startTimer();   // side effect
    }

    protected abstract void process();
    protected void afterRun() {
        metrics.stopTimer();   // expects startTimer
    }
}

public final class MyPipeline extends Pipeline {
    @Override
    protected void beforeRun() {
        // overrides to add custom logging; forgets to start timer
        log.info("custom start");
    }

    @Override
    protected void process() { /* ... */ }
}
```

`afterRun` calls `stopTimer` without `startTimer`. Metric corrupted.

<details><summary>Reveal</summary>

**Bug:** Default hook has side effects subclass might depend on. Override removes them.

**Fix:** make critical setup `final`, expose user customization separately.

```java
public abstract class Pipeline {
    public final void run() {
        baseSetup();
        userBeforeRun();
        process();
        userAfterRun();
        baseTeardown();
    }

    private void baseSetup() {
        metrics.startTimer();
    }

    private void baseTeardown() {
        metrics.stopTimer();
    }

    protected abstract void process();
    protected void userBeforeRun() {}
    protected void userAfterRun() {}
}
```

Subclass can override only `userBefore/AfterRun`; cannot break the timer flow.

**Lesson:** Critical lifecycle steps must be inviolable. Don't put them in overridable hooks.

</details>

---

## Bug 6: Liskov substitution violation

```java
public abstract class JsonParser {
    public final Result parse(String json) {
        validate(json);   // base: ensures non-empty
        return doParse(json);
    }

    protected void validate(String json) {
        if (json.isEmpty()) throw new IllegalArgumentException("empty");
    }

    protected abstract Result doParse(String json);
}

public final class StrictJsonParser extends JsonParser {
    @Override
    protected void validate(String json) {
        // override to add stricter checks
        super.validate(json);
        if (!json.startsWith("{")) throw new IllegalArgumentException("must start with {");
    }

    @Override
    protected Result doParse(String json) { /* ... */ }
}

// Caller:
JsonParser p = new StrictJsonParser();
p.parse("[]");   // throws — but JsonParser.parse contract says any non-empty JSON works
```

<details><summary>Reveal</summary>

**Bug:** Subclass strengthens preconditions. Code expecting any `JsonParser` to accept any non-empty JSON breaks when given a `StrictJsonParser`.

**Fix:** subclasses should weaken or maintain preconditions, not strengthen them. Or make the strict variant a separate type that doesn't claim to be a `JsonParser`.

```java
public final class StrictJsonObjectParser {   // not a JsonParser
    public Result parse(String json) {
        if (!json.startsWith("{")) throw new IllegalArgumentException("must start with {");
        // ...
    }
}
```

**Lesson:** Liskov substitution. Subclass methods must accept all inputs the base accepts. Strengthening preconditions is a violation.

</details>

---

## Bug 7: Asynchronous step blocks the template

```java
public abstract class AsyncPipeline {
    public CompletableFuture<Response> run(Request req) {
        return validate(req)
            .thenApply(this::handle)   // BUG: handle returns Future
            .thenApply(this::wrap);
    }

    protected abstract Response handle(Request req);   // returns synchronous Response
    protected CompletableFuture<Request> validate(Request req) { /* ... */ }
    protected Response wrap(Response r) { /* ... */ }
}

public final class MyHandler extends AsyncPipeline {
    @Override
    protected Response handle(Request req) {
        return restClient.callAsync(req).join();   // BLOCKS the executor thread
    }
}
```

Reactor thread starvation.

<details><summary>Reveal</summary>

**Bug:** Template forces synchronous `handle`. Subclass that needs async work blocks. Reactor thread unavailable for other tasks.

**Fix:** make `handle` return `CompletableFuture`.

```java
public abstract class AsyncPipeline {
    public CompletableFuture<Response> run(Request req) {
        return validate(req)
            .thenCompose(this::handle)   // thenCompose for async
            .thenApply(this::wrap);
    }

    protected abstract CompletableFuture<Response> handle(Request req);
}

public final class MyHandler extends AsyncPipeline {
    @Override
    protected CompletableFuture<Response> handle(Request req) {
        return restClient.callAsync(req);
    }
}
```

**Lesson:** Async templates must propagate async types. Don't force `.join()` in subclasses.

</details>

---

## Bug 8: Recursive template re-entry

```java
public abstract class Job {
    public final void run() {
        beforeRun();
        process();
        afterRun();
    }

    protected void afterRun() {}   // hook
    protected abstract void process();
}

public final class RetryingJob extends Job {
    @Override
    protected void afterRun() {
        if (failed()) run();   // BUG: re-enters run from within run
    }
}
```

Stack overflow on retry.

<details><summary>Reveal</summary>

**Bug:** `afterRun` calls `run()` directly. Re-entry into template; stack grows.

**Fix:** schedule the retry, don't call recursively.

```java
public final class RetryingJob extends Job {
    @Override
    protected void afterRun() {
        if (failed()) scheduleRetry();
    }

    private void scheduleRetry() {
        executor.schedule(this::run, 1, TimeUnit.SECONDS);
    }
}
```

Or move retry logic outside the template.

**Lesson:** Template hooks shouldn't re-enter the template. Schedule or restructure.

</details>

---

## Bug 9: Hook proliferation hides logic

```java
public abstract class Workflow {
    public final void run() {
        beforeStart();
        if (shouldStart()) {
            beforeAcquireResources();
            acquireResources();
            afterAcquireResources();
            beforeProcess();
            if (shouldProcess()) {
                process();
            }
            afterProcess();
            beforeReleaseResources();
            releaseResources();
            afterReleaseResources();
        }
        afterEnd();
    }

    // 12 hooks, all defaulting to no-op
}
```

What does the workflow do? Trace by reading subclasses one by one.

<details><summary>Reveal</summary>

**Bug:** Hook proliferation. The template is configuration; logic scattered across overrides. Discoverability tanked.

**Fix:** consolidate. Either fewer hooks, or use Strategy / middleware:

```java
public final class Workflow {
    private final List<Step> steps;

    public Workflow(List<Step> steps) { this.steps = steps; }

    public void run() {
        for (Step s : steps) s.execute();
    }
}

interface Step { void execute(); }
```

Composition over inheritance for highly customizable lifecycles.

**Lesson:** Hook proliferation is a smell. When you have 10+ hooks, switch to Strategy / middleware.

</details>

---

## Bug 10: Concurrent invocation corrupts shared state

```java
public abstract class StatefulPipeline {
    private List<String> buffer = new ArrayList<>();   // base-class field

    public final void run(String input) {
        buffer.clear();
        process(input);
        save(buffer);
    }

    protected final void emit(String item) {
        buffer.add(item);
    }

    protected abstract void process(String input);
    private void save(List<String> data) { /* ... */ }
}

// Two threads call run concurrently with same instance:
pipeline.run("a");
pipeline.run("b");   // races on buffer
```

<details><summary>Reveal</summary>

**Bug:** Shared mutable state in the base class. Concurrent calls race.

**Fix:** make the pipeline stateless; pass state explicitly.

```java
public abstract class Pipeline {
    public final void run(String input) {
        List<String> buffer = new ArrayList<>();   // local
        process(input, buffer);
        save(buffer);
    }

    protected abstract void process(String input, List<String> buffer);
}
```

Or synchronize:

```java
public final synchronized void run(String input) { ... }
```

Synchronization serializes; defeats throughput.

**Lesson:** Stateful templates are concurrency hazards. Prefer stateless; pass state through call parameters.

</details>

---

## Bug 11: Subclass throws unexpected exception

```java
public abstract class FileLoader {
    public final List<Row> load(String path) {
        String content = read(path);
        return parse(content);
    }

    protected String read(String path) throws IOException { /* ... */ }
    protected abstract List<Row> parse(String content);
}

public final class StrictParser extends FileLoader {
    @Override
    protected List<Row> parse(String content) {
        if (content.isBlank()) throw new IllegalStateException("empty file");
        // ...
    }
}

// Caller:
try {
    parser.load(path);
} catch (IOException e) { /* expected */ }
// IllegalStateException unhandled — crashes app
```

<details><summary>Reveal</summary>

**Bug:** Subclass throws exception type not declared by the template. Callers can't handle it generically.

**Fix:** subclasses should throw exceptions consistent with the contract. Or wrap:

```java
public abstract class FileLoader {
    public final List<Row> load(String path) {
        try {
            String content = read(path);
            return parse(content);
        } catch (RuntimeException e) {
            throw new ParseException("parse failed", e);
        }
    }
}
```

Document the exception contract.

**Lesson:** Exception types are part of the contract. Subclasses must respect what callers can catch.

</details>

---

## Bug 12: Missing exhaustiveness in pattern match

```java
sealed interface State permits Draft, Moderation, Published {}

public final class Workflow {
    public String describe(State state) {
        return switch (state) {
            case Draft d -> "draft";
            case Moderation m -> "moderating";
            // BUG: missing Published case
            default -> "unknown";
        };
    }
}
```

Adding `Archived` to the sealed interface compiles fine; default branch hides the issue.

<details><summary>Reveal</summary>

**Bug:** `default` clause swallows all unhandled cases. New states added to the sealed interface fall through silently. Defeats compile-time exhaustiveness.

**Fix:** remove `default`; let the compiler force all cases handled.

```java
return switch (state) {
    case Draft d -> "draft";
    case Moderation m -> "moderating";
    case Published p -> "published";
};   // compile error if a state is missing
```

Adding `Archived` now forces compile error here. Refactoring is safe.

**Lesson:** Don't use `default` with sealed types unless intentional. Compile-time exhaustiveness is the whole point.

</details>

---

## Practice Tips

- **Mark Template Methods `final`.** Lock structure.
- **Mark steps `protected`.** Encapsulate lifecycle.
- **Don't rely on subclasses calling `super`.** Restructure with `final` template + hooks.
- **Don't call overridable methods from constructors.** Subclass fields not yet initialized.
- **Critical lifecycle in `final` methods.** Hooks for user customization.
- **Liskov: subclasses can't strengthen preconditions.**
- **Async templates use Future / Promise types end-to-end.**
- **Don't re-enter the template from within hooks.**
- **Hook proliferation = refactor.** Strategy or middleware.
- **Stateful templates are concurrency hazards.** Pass state through calls.
- **Subclasses must respect exception contracts.**
- **Avoid `default` in pattern matches over sealed types.**

[← Tasks](tasks.md) · [Optimize →](optimize.md)
