# Template Method — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/template-method](https://refactoring.guru/design-patterns/template-method)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Beverage maker](#task-1-beverage-maker)
2. [Task 2: HTTP request processor](#task-2-http-request-processor)
3. [Task 3: Data pipeline](#task-3-data-pipeline)
4. [Task 4: Test framework lifecycle](#task-4-test-framework-lifecycle)
5. [Task 5: Functional Template Method](#task-5-functional-template-method)
6. [Task 6: Async pipeline](#task-6-async-pipeline)
7. [Task 7: Plugin system with hooks](#task-7-plugin-system-with-hooks)
8. [Task 8: Sealed Template Method](#task-8-sealed-template-method)
9. [Task 9: Build tool lifecycle](#task-9-build-tool-lifecycle)
10. [Task 10: Refactor inheritance to functional](#task-10-refactor-inheritance-to-functional)
11. [How to Practice](#how-to-practice)

---

## Task 1: Beverage maker

**Brief.** Abstract `Beverage` with `make()` template. Subclasses Tea and Coffee.

### Solution (Java)

```java
public abstract class Beverage {
    public final void make() {
        boilWater();
        brew();
        pourIntoCup();
        if (wantsCondiments()) addCondiments();
    }

    private void boilWater()   { System.out.println("boiling water"); }
    private void pourIntoCup() { System.out.println("pouring into cup"); }

    protected abstract void brew();
    protected abstract void addCondiments();
    protected boolean wantsCondiments() { return true; }   // hook
}

public final class Tea extends Beverage {
    protected void brew()          { System.out.println("steeping tea"); }
    protected void addCondiments() { System.out.println("adding lemon"); }
}

public final class Coffee extends Beverage {
    protected void brew()          { System.out.println("dripping coffee"); }
    protected void addCondiments() { System.out.println("adding milk"); }
}

class PlainWater extends Beverage {
    protected void brew()          {}
    protected void addCondiments() {}
    protected boolean wantsCondiments() { return false; }
}

class Demo {
    public static void main(String[] args) {
        new Tea().make();
        System.out.println("---");
        new Coffee().make();
    }
}
```

`make()` is `final`. `wantsCondiments` is a hook. PlainWater opts out.

---

## Task 2: HTTP request processor

**Brief.** Template: parse → auth → handle → respond. Subclasses implement `handle`.

### Solution (Java)

```java
public abstract class HttpProcessor {
    public final Response process(Request req) {
        Response resp = new Response();
        try {
            beforeProcess(req);
            authenticate(req);
            authorize(req);
            Object result = handle(req);
            resp.setBody(result);
        } catch (UnauthorizedException e) {
            resp.setStatus(401);
        } catch (Exception e) {
            resp.setStatus(500);
            onError(e, resp);
        } finally {
            afterProcess(req, resp);
        }
        return resp;
    }

    protected abstract Object handle(Request req);

    protected void beforeProcess(Request req) {}
    protected void authenticate(Request req) {}
    protected void authorize(Request req) {}
    protected void onError(Exception e, Response resp) { e.printStackTrace(); }
    protected void afterProcess(Request req, Response resp) {}
}

public final class GetUserHandler extends HttpProcessor {
    protected Object handle(Request req) {
        return new User(req.param("id"));
    }

    protected void authenticate(Request req) {
        if (!req.hasValidToken()) throw new UnauthorizedException();
    }
}
```

Required: `handle`. Hooks: pre/post processing, auth, error.

---

## Task 3: Data pipeline

**Brief.** Template: extract → clean → transform → load. Hook for `clean` and `afterLoad`.

### Solution (Python)

```python
from abc import ABC, abstractmethod


class Pipeline(ABC):
    def run(self, source: str) -> None:
        data = self.extract(source)
        cleaned = self.clean(data)
        transformed = self.transform(cleaned)
        self.load(transformed)
        self.after_load()

    @abstractmethod
    def extract(self, source: str) -> list: ...

    def clean(self, data: list) -> list:
        return [d for d in data if d is not None]

    @abstractmethod
    def transform(self, data: list) -> list: ...

    @abstractmethod
    def load(self, data: list) -> None: ...

    def after_load(self) -> None: pass


class CsvPipeline(Pipeline):
    def extract(self, source: str) -> list:
        with open(source) as f: return [line.strip() for line in f]
    def transform(self, data: list) -> list:
        return [line.split(",") for line in data]
    def load(self, data: list) -> None:
        for row in data: print(f"INSERT {row}")
    def after_load(self) -> None:
        print("notification sent")


CsvPipeline().run("/tmp/data.csv")
```

Hooks: `clean` has default; `after_load` is no-op opt-in.

---

## Task 4: Test framework lifecycle

**Brief.** Abstract `TestCase` with setUp → test → tearDown.

### Solution (Java)

```java
public abstract class TestCase {
    public final void run() {
        try {
            setUp();
            runTest();
            System.out.println("passed");
        } catch (AssertionError e) {
            System.out.println("failed: " + e.getMessage());
        } catch (Exception e) {
            System.out.println("error: " + e);
        } finally {
            tearDown();
        }
    }

    protected void setUp() {}
    protected void tearDown() {}
    protected abstract void runTest();
}

public final class MyTest extends TestCase {
    private int x;

    protected void setUp() { x = 42; }

    protected void runTest() {
        if (x != 42) throw new AssertionError("expected 42 got " + x);
    }
}

class Demo {
    public static void main(String[] args) {
        new MyTest().run();
    }
}
```

JUnit-style lifecycle with optional setUp / tearDown.

---

## Task 5: Functional Template Method

**Brief.** Convert the beverage maker to a higher-order function with callbacks.

### Solution (Python)

```python
from typing import Callable


def make_beverage(brew: Callable[[], None], add_condiments: Callable[[], None] | None = None) -> None:
    print("boiling water")
    brew()
    print("pouring into cup")
    if add_condiments: add_condiments()


# Tea:
make_beverage(
    brew=lambda: print("steeping tea"),
    add_condiments=lambda: print("adding lemon")
)

# Coffee:
make_beverage(
    brew=lambda: print("dripping coffee"),
    add_condiments=lambda: print("adding milk")
)

# Water:
make_beverage(brew=lambda: None)
```

No inheritance. Same template; callbacks for variable parts.

---

## Task 6: Async pipeline

**Brief.** Pipeline with async steps; `run()` returns a future.

### Solution (TypeScript)

```typescript
abstract class AsyncPipeline<I, O> {
    async run(input: I): Promise<O> {
        const validated = await this.validate(input);
        const transformed = await this.transform(validated);
        return await this.persist(transformed);
    }

    protected async validate(input: I): Promise<I> { return input; }
    protected abstract transform(input: I): Promise<unknown>;
    protected abstract persist(data: unknown): Promise<O>;
}

class FetchAndStorePipeline extends AsyncPipeline<string, void> {
    async transform(url: string): Promise<unknown> {
        const r = await fetch(url);
        return r.json();
    }

    async persist(data: unknown): Promise<void> {
        console.log("storing", data);
    }
}

new FetchAndStorePipeline().run("https://api.example.com/data");
```

Each step async; chains via await.

---

## Task 7: Plugin system with hooks

**Brief.** Plugin lifecycle: init → process → cleanup. Multiple plugins; framework runs them.

### Solution (Java)

```java
public abstract class Plugin {
    public final void run(Context ctx) {
        try {
            init(ctx);
            process(ctx);
        } catch (Exception e) {
            onError(e, ctx);
        } finally {
            cleanup(ctx);
        }
    }

    protected abstract void process(Context ctx);
    protected void init(Context ctx) {}
    protected void cleanup(Context ctx) {}
    protected void onError(Exception e, Context ctx) { e.printStackTrace(); }
}

public final class LoggingPlugin extends Plugin {
    protected void init(Context ctx) { System.out.println("logging init"); }
    protected void process(Context ctx) { System.out.println("processing: " + ctx); }
    protected void cleanup(Context ctx) { System.out.println("logging cleanup"); }
}

public final class PluginRunner {
    private final List<Plugin> plugins = new ArrayList<>();
    public void register(Plugin p) { plugins.add(p); }
    public void runAll(Context ctx) { for (Plugin p : plugins) p.run(ctx); }
}
```

Lifecycle enforced; plugins focus on `process`.

---

## Task 8: Sealed Template Method

**Brief.** Java 17+ sealed abstract class with permitted subclasses.

### Solution (Java 17+)

```java
public sealed abstract class Beverage permits Tea, Coffee, Water {
    public final void make() {
        boilWater();
        brew();
        pourIntoCup();
    }
    private void boilWater() { System.out.println("boiling water"); }
    private void pourIntoCup() { System.out.println("pouring into cup"); }
    protected abstract void brew();
}

public final class Tea extends Beverage {
    protected void brew() { System.out.println("steeping tea"); }
}

public final class Coffee extends Beverage {
    protected void brew() { System.out.println("dripping coffee"); }
}

public final class Water extends Beverage {
    protected void brew() { /* no brewing */ }
}
```

`permits` lists all subclasses. Adding a new beverage requires updating both `permits` and creating the class.

---

## Task 9: Build tool lifecycle

**Brief.** Template: validate → compile → test → package → install. Subclasses customize phases.

### Solution (Python)

```python
from abc import ABC, abstractmethod


class BuildLifecycle(ABC):
    PHASES = ["validate", "compile", "test", "package", "install"]

    def run(self) -> None:
        for phase in self.PHASES:
            getattr(self, phase)()

    @abstractmethod
    def compile(self) -> None: ...
    @abstractmethod
    def test(self) -> None: ...
    @abstractmethod
    def package(self) -> None: ...

    def validate(self) -> None: print("validating")
    def install(self) -> None: print("installing")


class JavaBuild(BuildLifecycle):
    def compile(self) -> None: print("javac")
    def test(self) -> None: print("running JUnit")
    def package(self) -> None: print("creating JAR")


JavaBuild().run()
```

Phases run in order; subclasses customize.

---

## Task 10: Refactor inheritance to functional

**Brief.** Take an inheritance-based template and convert to a functional one.

### Before

```java
public abstract class Importer {
    public void run(String path) {
        var data = read(path);
        var rows = parse(data);
        save(rows);
    }
    protected String read(String path) { /* ... */ }
    protected abstract List<Row> parse(String data);
    protected void save(List<Row> rows) { /* ... */ }
}

class CsvImporter extends Importer {
    protected List<Row> parse(String data) { /* CSV parse */ }
}
```

### After (functional)

```java
public final class ImporterFn {
    public static void run(String path, Function<String, List<Row>> parser) {
        String data = read(path);
        List<Row> rows = parser.apply(data);
        save(rows);
    }

    private static String read(String path) { /* ... */ }
    private static void save(List<Row> rows) { /* ... */ }
}

// Usage:
ImporterFn.run("data.csv", CsvParser::parse);
ImporterFn.run("data.json", JsonParser::parse);
```

No inheritance. Pass the parser as a function. More flexible, less hierarchy.

---

## How to Practice

- **Build the beverage maker first.** Classic Template Method intro.
- **HTTP request processor next.** Real-world; many hooks.
- **Try sealed types** if your language supports.
- **Convert inheritance to functional.** See the trade-offs first-hand.
- **Async template.** Composition of futures.
- **Read Spring's `JdbcTemplate` source.** Production-grade Template Method via callbacks.
- **Read JUnit's `TestCase` source.** Inheritance-based; clean lifecycle.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
