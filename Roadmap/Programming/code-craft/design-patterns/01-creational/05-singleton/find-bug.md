# Singleton — Find the Bug

> **Source:** [refactoring.guru/design-patterns/singleton](https://refactoring.guru/design-patterns/singleton)
> **Format:** Buggy code snippets + symptoms + solution + lesson learned. Read the snippet, try to spot the bug, then check the answer.

Bugs are distributed across **Go**, **Java**, and **Python** to expose language-specific gotchas.

---

## Table of Contents

1. [Bug 1: Non-thread-safe lazy init (Java)](#bug-1-non-thread-safe-lazy-init-java)
2. [Bug 2: Missing volatile in DCL (Java)](#bug-2-missing-volatile-in-dcl-java)
3. [Bug 3: sync.Once with closure capture (Go)](#bug-3-synconce-with-closure-capture-go)
4. [Bug 4: Reflection breaks Singleton (Java)](#bug-4-reflection-breaks-singleton-java)
5. [Bug 5: Serialization creates new instance (Java)](#bug-5-serialization-creates-new-instance-java)
6. Bug 6: __init__ runs every time (Python)
7. [Bug 7: Forking breaks state (Python)](#bug-7-forking-breaks-state-python)
8. [Bug 8: Singleton state leaks between tests](#bug-8-singleton-state-leaks-between-tests)
9. [Bug 9: Cloneable bypasses Singleton (Java)](#bug-9-cloneable-bypasses-singleton-java)
10. [Bug 10: Plain check-then-assign race (Go)](#bug-10-plain-check-then-assign-race-go)
11. [Bug 11: Lazy holder anti-pattern (Java)](#bug-11-lazy-holder-anti-pattern-java)
12. [Bug 12: Class loader duplication (Java)](#bug-12-class-loader-duplication-java)

---

## Bug 1: Non-thread-safe lazy init (Java)

```java
public final class Logger {
    private static Logger instance;
    private Logger() {}
    public static Logger getInstance() {
        if (instance == null) {
            instance = new Logger();
        }
        return instance;
    }
    public void log(String msg) { /* ... */ }
}
```

**Symptoms:** Under concurrent load, the application sometimes creates two `Logger` instances. Test code that compares `Logger.getInstance() == anotherRef` occasionally fails.

<details><summary>Find the bug</summary>

The check-and-construct sequence is not atomic. Two threads can both see `instance == null`, both proceed to `new Logger()`, and end up with two distinct instances. The thread that finishes second overwrites the first — earlier callers hold a reference to the orphan.

</details>

### Fix

```java
public final class Logger {
    private static class Holder { static final Logger INSTANCE = new Logger(); }
    private Logger() {}
    public static Logger getInstance() { return Holder.INSTANCE; }
    public void log(String msg) { /* ... */ }
}
```

### Lesson

Lazy holder idiom is the simplest correct solution. The JVM's class initialization rules guarantee laziness + thread safety with no user-level locks.

---

## Bug 2: Missing volatile in DCL (Java)

```java
public final class Service {
    private static Service instance;   // ← BUG
    private final State state;

    private Service() {
        this.state = State.load();    // expensive
    }

    public static Service getInstance() {
        if (instance == null) {
            synchronized (Service.class) {
                if (instance == null) {
                    instance = new Service();
                }
            }
        }
        return instance;
    }
}
```

**Symptoms:** Rare, hard-to-reproduce NPEs in production: callers see `service.state.someField` throw NullPointerException even though the constructor sets `state`.

<details><summary>Find the bug</summary>

`instance = new Service()` is not atomic. The JVM may publish the reference before the constructor finishes, so another thread can see `instance != null` while `state` is still null. Without `volatile`, the JMM permits this reordering.

</details>

### Fix

```java
private static volatile Service instance;
```

Or — better — use enum or lazy holder:

```java
private static class Holder { static final Service INSTANCE = new Service(); }
public static Service getInstance() { return Holder.INSTANCE; }
```

### Lesson

DCL **requires** `volatile` (Java 5+) to be safe. Without it, you have a reordering bug that won't show up on x86 test machines but bites you on weak-memory architectures (ARM servers, mobile). When in doubt, prefer lazy holder.

---

## Bug 3: sync.Once with closure capture (Go)

```go
package config

import "sync"

type Config struct{ Path string }

var (
    instance *Config
    once     sync.Once
)

func Load(path string) *Config {
    once.Do(func() {
        instance = &Config{Path: path}
    })
    return instance
}
```

Caller:

```go
go config.Load("/path/A")
go config.Load("/path/B")
```

**Symptoms:** Tests assert `config.Load("/x").Path == "/x"` — passes locally, fails in CI under different goroutine scheduling.

<details><summary>Find the bug</summary>

`sync.Once` runs the function **exactly once** — but which one? Whichever goroutine wins the race captures its own `path` in the closure. Subsequent callers with different paths get the *first* path back, silently. The function name `Load(path)` implies it loads with the given path — but actually it ignores subsequent calls' paths.

</details>

### Fix — Option A: Reject conflicting calls

```go
func Load(path string) (*Config, error) {
    var first string
    once.Do(func() {
        first = path
        instance = &Config{Path: path}
    })
    if first != "" && first != path {
        return nil, fmt.Errorf("config already loaded with %s, can't load %s", instance.Path, path)
    }
    return instance, nil
}
```

### Fix — Option B: Caller-provided init

```go
func Init(path string) *Config {
    instance = &Config{Path: path}
    return instance
}

func Get() *Config {
    if instance == nil { panic("config not initialized") }
    return instance
}
```

Then call `config.Init(path)` exactly once in `main()`.

### Lesson

`sync.Once` is for "init exactly once," not "init with these arguments exactly once." If your init takes parameters, separate phases: `Init` (must be called once) and `Get` (used everywhere else).

---

## Bug 4: Reflection breaks Singleton (Java)

```java
public final class Token {
    private static final Token INSTANCE = new Token();
    private Token() {}
    public static Token getInstance() { return INSTANCE; }
    public String value = "secret";
}
```

Attacker code:

```java
Constructor<Token> c = Token.class.getDeclaredConstructor();
c.setAccessible(true);
Token rogue = c.newInstance();
```

**Symptoms:** Reflection produces a second `Token` instance, bypassing the singleton guarantee. Security audit flags this as a possible token forgery vector.

<details><summary>Find the bug</summary>

`Constructor.setAccessible(true)` overrides `private`. There is no compile-time protection against this. Anyone with reflection access can instantiate.

</details>

### Fix — Defensive constructor

```java
private Token() {
    if (INSTANCE != null) {
        throw new IllegalStateException("Use getInstance()");
    }
}
```

### Fix — Enum (immune)

```java
public enum Token {
    INSTANCE;
    public final String value = "secret";
}
```

`Constructor.newInstance()` on enum throws `IllegalArgumentException` — guaranteed by the JVM.

### Lesson

For security-sensitive singletons, prefer enum. The defensive constructor still works for non-enum cases. Note: a `SecurityManager` (deprecated in Java 17+) could also block reflection, but you can't rely on that.

---

## Bug 5: Serialization creates new instance (Java)

```java
public final class Settings implements Serializable {
    private static final long serialVersionUID = 1L;
    private static final Settings INSTANCE = new Settings();
    private Settings() {}
    public static Settings getInstance() { return INSTANCE; }
    public String theme = "light";
}
```

Test:

```java
ByteArrayOutputStream bos = new ByteArrayOutputStream();
new ObjectOutputStream(bos).writeObject(Settings.getInstance());
Settings deserialized = (Settings)
    new ObjectInputStream(new ByteArrayInputStream(bos.toByteArray())).readObject();

System.out.println(deserialized == Settings.getInstance());  // false!
```

**Symptoms:** After saving and restoring app state to disk, two `Settings` instances exist. Changes via the original aren't visible to the restored one (or vice versa).

<details><summary>Find the bug</summary>

`ObjectInputStream.readObject` constructs a new instance via the special serialization path (it bypasses constructors). The new instance has the deserialized field values but is a **different object** from the canonical singleton.

</details>

### Fix — readResolve

```java
private Object readResolve() {
    return INSTANCE;
}
```

The serialization protocol calls this method after deserialization; whatever it returns is what the user gets. Returning `INSTANCE` discards the freshly-deserialized object.

### Fix — Enum

```java
public enum Settings {
    INSTANCE;
    public String theme = "light";
}
```

Default enum serialization preserves identity by name — no `readResolve` needed.

### Lesson

Java serialization bypasses constructors. Singletons that implement `Serializable` **must** override `readResolve` or use enum. This is one of the most common Java interview gotchas.

---

## Bug 6: __init__ runs every time (Python)

```python
class Settings:
    _instance = None
    def __new__(cls, theme: str):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    def __init__(self, theme: str):
        self.theme = theme

a = Settings("dark")
b = Settings("light")

print(a is b)         # True (good)
print(a.theme)        # "light" (BUG)
```

**Symptoms:** The first caller sets a value; a second caller with a different value silently overwrites it.

<details><summary>Find the bug</summary>

Python calls `__init__` after `__new__` **every time** `Settings(...)` is invoked — even when `__new__` returns an existing instance. So `__init__("light")` runs on the *existing* instance, mutating its `theme` attribute.

</details>

### Fix — Guard re-initialization

```python
class Settings:
    _instance = None
    def __new__(cls, theme: str):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    def __init__(self, theme: str):
        if not hasattr(self, "_initialized"):
            self.theme = theme
            self._initialized = True
```

### Fix — Metaclass

```python
class SingletonMeta(type):
    _instances = {}
    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Settings(metaclass=SingletonMeta):
    def __init__(self, theme: str): self.theme = theme

a = Settings("dark")
b = Settings("light")
print(a.theme)  # "dark" — first wins
```

### Fix — Module-level instance (best in many cases)

```python
# settings.py
class Settings:
    def __init__(self, theme="dark"): self.theme = theme

settings = Settings()
```

### Lesson

`__new__`-based Python singletons trip on `__init__` re-running. Either guard with `_initialized`, use a metaclass that intercepts `__call__`, or use module-level instantiation.

---

## Bug 7: Forking breaks state (Python)

```python
# logger.py
class Logger:
    _instance = None
    @classmethod
    def get(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    def __init__(self):
        self.fd = open("/var/log/app.log", "a")
    def log(self, msg):
        self.fd.write(msg + "\n")
```

```python
# main.py
import multiprocessing
from logger import Logger

def worker():
    Logger.get().log("hello from worker")

if __name__ == "__main__":
    Logger.get().log("hello from parent")
    p = multiprocessing.Process(target=worker)
    p.start()
    p.join()
```

**Symptoms:** Log lines from parent and child are interleaved at the byte level — half-lines, missing newlines. Sometimes the log file is truncated.

<details><summary>Find the bug</summary>

`fork()` (the default `multiprocessing` start method on Linux/macOS up to Python 3.13) duplicates the process. The child inherits the parent's open file descriptor — both processes write to the same FD without coordination. Writes can interleave at non-atomic boundaries.

</details>

### Fix — Use `spawn` start method

```python
multiprocessing.set_start_method("spawn", force=True)
```

`spawn` re-imports modules in the child, getting a fresh `Logger` with its own FD. Slower startup but safe.

### Fix — Reset singletons after fork

```python
import os
def reset_logger():
    Logger._instance = None
os.register_at_fork(after_in_child=reset_logger)
```

### Fix — Don't share OS resources via singletons

Use a logging library (Python's `logging` module) that is fork-aware, or open a fresh FD per process.

### Lesson

Singletons holding OS resources (FDs, sockets, locks) are fundamentally unsafe to fork. Either avoid `fork()` (use `spawn`) or design singletons to be reinitializable.

---

## Bug 8: Singleton state leaks between tests

```python
# counter.py
class Counter:
    _instance = None
    @classmethod
    def get(cls):
        if cls._instance is None: cls._instance = cls()
        return cls._instance
    def __init__(self): self.n = 0
    def inc(self): self.n += 1

# test_counter.py
def test_increments_to_one():
    c = Counter.get()
    c.inc()
    assert c.n == 1

def test_starts_at_zero():
    c = Counter.get()
    assert c.n == 0       # FAILS if test_increments_to_one ran first
```

**Symptoms:** Tests pass individually but fail when run together. Order-dependent failures. Flakes that only show up in certain CI configurations.

<details><summary>Find the bug</summary>

The `Counter` Singleton survives across tests. Mutations from `test_increments_to_one` persist. The second test sees `n == 1`, not the expected `0`. Test isolation is broken.

</details>

### Fix — Reset fixture

```python
import pytest

@pytest.fixture(autouse=True)
def reset_counter():
    yield
    Counter._instance = None
```

### Fix — Refactor to DI

```python
class Counter:
    def __init__(self): self.n = 0
    def inc(self): self.n += 1

# Production
counter = Counter()

# Tests
def test_increments_to_one():
    c = Counter()  # fresh instance
    c.inc()
    assert c.n == 1
```

### Lesson

Stateful singletons + tests = leak machine. Either reset between tests or refactor to DI so each test gets a fresh instance. Resetting is pragmatic; DI is principled.

---

## Bug 9: Cloneable bypasses Singleton (Java)

```java
public final class Settings implements Cloneable {
    private static final Settings INSTANCE = new Settings();
    private Settings() {}
    public static Settings getInstance() { return INSTANCE; }

    @Override
    public Object clone() throws CloneNotSupportedException {
        return super.clone();   // ← creates a second instance!
    }
}
```

**Symptoms:** Calling `Settings.getInstance().clone()` returns a new object that is NOT the same as `getInstance()`. Code that compares with `==` may behave inconsistently.

<details><summary>Find the bug</summary>

`Object.clone()` produces a shallow copy — a fresh allocation with the same field values. This is a second instance, defeating the Singleton.

</details>

### Fix — Throw from clone

```java
@Override
public Object clone() throws CloneNotSupportedException {
    throw new CloneNotSupportedException();
}
```

### Fix — Don't implement Cloneable

The original problem is implementing `Cloneable` at all. If your singleton doesn't need to be cloneable (it usually doesn't), don't implement the interface.

### Fix — Enum

Enums automatically prevent cloning (they extend `Enum` which overrides `clone()` to throw).

### Lesson

`Cloneable` is rarely what you want, especially for singletons. If a class implements `Cloneable`, audit it for the singleton property. Default to enum to avoid these issues.

---

## Bug 10: Plain check-then-assign race (Go)

```go
package counter

var instance *Counter

type Counter struct{ n int64 }

func Get() *Counter {
    if instance == nil {
        instance = &Counter{}
    }
    return instance
}

func (c *Counter) Inc() { c.n++ }
```

Test:

```go
func TestParallel(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); Get().Inc() }()
    }
    wg.Wait()
}
```

Run with: `go test -race`

**Symptoms:** Race detector reports concurrent writes to `instance` and to `n`. Production occasionally has multiple `Counter` objects, and increments are lost.

<details><summary>Find the bug</summary>

Two races:
1. **`instance == nil` check then assignment** — multiple goroutines can both see nil and both assign.
2. **`c.n++`** — read-modify-write of an `int64` is not atomic.

</details>

### Fix

```go
package counter

import (
    "sync"
    "sync/atomic"
)

type Counter struct{ n atomic.Int64 }

var (
    instance *Counter
    once     sync.Once
)

func Get() *Counter {
    once.Do(func() { instance = &Counter{} })
    return instance
}

func (c *Counter) Inc() { c.n.Add(1) }
func (c *Counter) Value() int64 { return c.n.Load() }
```

### Lesson

In Go, two rules:
1. **Use `sync.Once` for lazy init.** Don't write your own check-and-init.
2. **Use `sync/atomic` or mutex for shared mutable state.** Plain integer ops are not atomic.

Run `go test -race` regularly. The race detector catches both bugs above.

---

## Bug 11: Lazy holder anti-pattern (Java)

```java
public final class Service {
    private static class Holder {
        static final Service INSTANCE = new Service();
        // BUG: side effect at class init
        static {
            System.out.println("Holder initialized");
            doExpensiveSideEffect();
        }
    }
    public static Service getInstance() { return Holder.INSTANCE; }
}
```

**Symptoms:** `doExpensiveSideEffect()` runs at unexpected times. Performance tests that warm up `Service` fail; the side effect happens during the *first* timed call.

<details><summary>Find the bug</summary>

The lazy holder relies on `Holder` being class-loaded only on `getInstance()` first call. The static block runs as part of class init — that timing is by design. But putting **expensive side effects** in there means: (a) first caller pays the cost, and (b) any error in the side effect makes `Holder` un-loadable, permanently breaking `Service`.

</details>

### Fix

Move side effects out of class init:

```java
public final class Service {
    private static class Holder { static final Service INSTANCE = new Service(); }

    private Service() {
        // construction is small and side-effect-free
    }

    public void warmup() {
        // explicit method, called by app startup
        doExpensiveSideEffect();
    }

    public static Service getInstance() { return Holder.INSTANCE; }
}
```

Caller does `Service.getInstance().warmup()` once at startup.

### Lesson

Class init failures are catastrophic — the class becomes unusable for the JVM lifetime. Keep static initializers tiny. Move expensive setup to an explicit method called from `main`.

---

## Bug 12: Class loader duplication (Java)

```java
// Loaded by application class loader (the "main" CL)
public final class CounterSingleton {
    private static final CounterSingleton I = new CounterSingleton();
    public static CounterSingleton get() { return I; }
    private long n;
    public synchronized void inc() { n++; }
    public synchronized long value() { return n; }
}
```

In a Tomcat web app:

```
WEB-INF/lib/lib-with-singleton.jar
WEB-INF/lib/another-lib-with-same-jar-shaded.jar
```

(Both JARs contain `CounterSingleton.class`. Tomcat loads them via the web app classloader, but a parent-first delegation order, plus shading, can put them under different classloaders.)

**Symptoms:** `CounterSingleton.get().inc()` followed by `CounterSingleton.get().value()` returns 0. Two threads/components see different counters.

<details><summary>Find the bug</summary>

Two `Class<CounterSingleton>` objects exist — one per classloader. Each has its own static field. Singletons are unique per `Class<T>`, not per process.

</details>

### Fix — Build hygiene

- Don't shade dependencies that contain singletons.
- Use a single source of truth (one JAR, one classloader).
- For libraries that *must* expose singletons, document classloader assumptions.

### Fix — Externalize state

If you genuinely need cross-classloader singleton-ness, store the state outside the JVM (e.g., in shared memory, in a coordination service). Java-level singletons can't span classloaders.

### Lesson

"JVM-global singleton" is a slight misnomer — it's actually "classloader-local." In simple apps with a single classloader, this is irrelevant. In app servers, plugin systems, OSGi, and Java web apps, it's a real source of bugs. When you see "two singletons" in a complex deployment, suspect classloader duplication first.

---

## Practice Tips

1. **Try to spot the bug *before* expanding the answer.** Time yourself — 30-60 seconds per snippet.
2. **Write down the symptom you'd see in production.** Tying bugs to symptoms is interview gold.
3. **Run the buggy code** in a sandbox with multi-threading / -race / multiprocessing enabled. Watch the race detector or Helgrind output.
4. **Categorize the bugs** by language. Patterns repeat:
   - **Java:** memory model, serialization, reflection, classloader.
   - **Go:** race conditions, `sync.Once` semantics.
   - **Python:** `__init__` re-runs, fork unsafety, GIL nuances.
5. **Re-read the JLS / Go memory model / Python language reference** sections relevant to each bug. The official spec language is the final authority.

---

← Back to Singleton folder · [↑ Creational Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Previous:** [Singleton — Tasks](tasks.md) | **Next:** [Singleton — Optimize](optimize.md)
