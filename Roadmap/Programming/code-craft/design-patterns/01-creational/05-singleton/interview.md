# Singleton — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/singleton](https://refactoring.guru/design-patterns/singleton)
> **Prerequisites:** [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Professional](professional.md)
> **Format:** Questions across all levels with model answers.

---

## Table of Contents

1. [Junior Questions (10)](#junior-questions)
2. [Middle Questions (10)](#middle-questions)
3. [Senior Questions (10)](#senior-questions)
4. [Professional Questions (10)](#professional-questions)
5. [Coding Tasks (5)](#coding-tasks)
6. [Trick Questions (5)](#trick-questions)
7. [Behavioral / Architectural Questions (5)](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is the Singleton pattern?

**Answer:** Singleton is a creational design pattern that ensures a class has **exactly one instance** and provides a **global access point** to it. Typical implementation: private constructor, static field holding the instance, static `getInstance()` method.

### J2. Why is the constructor private in a Singleton?

**Answer:** To prevent any code outside the class from creating new instances with `new`. The class itself is the only place that can create the instance; clients must use the static access method.

### J3. What's the difference between a Singleton and a static class?

**Answer:**
- **Singleton:** an *object* with state and lifecycle; can implement interfaces, can be passed as a parameter, can be lazy-initialized.
- **Static class:** just a namespace for static methods; no state, no polymorphism, no lifecycle. Used for utilities (`Math.max`).

### J4. Eager vs lazy initialization — what's the difference?

**Answer:**
- **Eager:** the instance is created when the class is loaded (at startup).
- **Lazy:** the instance is created on first call to `getInstance()`.

Eager is simpler and thread-safe by default; lazy avoids paying the cost if unused, but needs care in multi-threaded code.

### J5. What's the global access point in Singleton?

**Answer:** A well-known, named static method (typically `getInstance()`, `Get()`, `Instance()`) callable from anywhere. It returns the single instance.

### J6. Give three real-world examples of where Singleton fits.

**Answer:**
1. **Logger** — one log facility for the whole application.
2. **Application configuration** — loaded once at startup, read everywhere.
3. **Database connection pool** — one shared pool managing connections.

(Other valid examples: cache, hardware spooler, thread pool.)

### J7. In Go, what does `sync.Once` do?

**Answer:** `sync.Once.Do(f)` runs the function `f` **exactly once**, even if called concurrently from many goroutines. It's the idiomatic way to implement a lazy thread-safe singleton in Go.

### J8. Why is a Python module already kind of a Singleton?

**Answer:** Python caches modules in `sys.modules` after the first import. Every subsequent `import` returns the same module object. So a value defined at module level (e.g., `config = Config()`) is automatically shared and instantiated only once.

### J9. What two things does Singleton **guarantee**?

**Answer:**
1. **Single instance** — there is at most (and at least) one instance of the class for the lifetime of the program.
2. **Global access** — there is a known, named way to retrieve that instance from anywhere in the code.

### J10. Name one drawback of Singleton.

**Answer:** Hidden coupling — code that uses `Logger.getInstance()` looks dependency-free, but it actually depends on the global `Logger`. This makes unit testing harder (you can't easily inject a mock) and obscures the design.

---

## Middle Questions

### M1. How do you make a Singleton thread-safe?

**Answer:** Multiple options:

- **Eager initialization** — created at class load; thread-safe by default (JVM/Go runtime handles class init).
- **`synchronized` method** (Java) — simple but every read takes a lock.
- **Double-checked locking** with `volatile` (Java 5+).
- **Lazy holder idiom** (Java) — class init guarantees laziness + safety.
- **Enum** (Java) — preferred per *Effective Java*.
- **`sync.Once`** (Go) — idiomatic.
- **`threading.Lock`** (Python) — for `__new__`/metaclass approaches.

### M2. What's the lazy holder idiom in Java?

**Answer:**

```java
public final class S {
    private static class Holder { static final S INSTANCE = new S(); }
    public static S getInstance() { return Holder.INSTANCE; }
}
```

`Holder` is loaded only when `getInstance()` is first called. The JVM guarantees lazy + thread-safe class initialization. No locks at runtime.

### M3. Why is enum the recommended Singleton in Java?

**Answer (per Joshua Bloch, *Effective Java*, Item 3):**

1. **Serialization-safe** — default enum serialization preserves identity.
2. **Reflection-safe** — `Constructor.newInstance()` on enum throws.
3. **Thread-safe** — JVM handles enum constant init.
4. **Trivial syntax** — three lines.

Drawback: cannot extend a class (enums extend `java.lang.Enum`).

### M4. What's the problem with naive lazy initialization across threads?

**Answer:** Two threads can both see `instance == null` simultaneously and both proceed to construct, ending up with two instances. Subsequent `getInstance()` calls return whichever was assigned last. Even worse, threads may hold references to *different* instances.

### M5. How do you write a thread-safe Singleton in Python?

**Answer:**

```python
import threading

class SingletonMeta(type):
    _instances = {}
    _lock = threading.Lock()
    def __call__(cls, *args, **kwargs):
        with cls._lock:
            if cls not in cls._instances:
                cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Singleton(metaclass=SingletonMeta): ...
```

Or simpler: use module-level instantiation, which is thread-safe at module-load time.

### M6. How do you test code that depends on a Singleton?

**Answer (multiple strategies):**

1. **Reset method** — expose `_reset()` for tests; call before each test.
2. **Interface + DI** — code takes `ILogger`; production wires `Logger.getInstance()`, tests pass a mock.
3. **DI container** — Spring's `@Singleton` is container-scoped; each test uses its own container.
4. **Avoid the Singleton in tests** — refactor the unit-under-test to take the dependency explicitly.

### M7. What's the Multiton pattern? When would you use it?

**Answer:** Multiton is "one instance per key": a registry keyed by some identifier. Use when you need a *bounded* set of instances — e.g., one connection pool per database, one logger per module name.

```python
class Multiton:
    _instances: dict[str, "Multiton"] = {}
    @classmethod
    def get(cls, key): ...
```

Watch for unbounded growth.

### M8. What is "Singleton vs DI"? Which should I prefer?

**Answer:**
- **Singleton:** simple, but hidden global state; testability suffers.
- **DI:** explicit dependencies; tests can inject mocks; multi-environment friendly. Adds boilerplate.

Prefer DI for any project larger than a small CLI tool. Singleton is acceptable for genuinely shared resources (logger, config) when test pain is manageable.

### M9. Explain double-checked locking and the role of `volatile`.

**Answer:** Double-checked locking is:

```java
if (instance == null) {
    synchronized (S.class) {
        if (instance == null) instance = new S();
    }
}
```

The outer check avoids the lock on the hot path. **`volatile` is required** because without it, the JIT can publish `instance` *before* the constructor finishes — another thread sees a half-built object. `volatile` introduces a release/acquire barrier ensuring the constructor's writes are visible.

### M10. Can you serialize a Singleton in Java safely?

**Answer:** Not by default — deserialization creates a new instance, breaking the guarantee. Two solutions:

1. **`readResolve()`** — Java's serialization protocol returns whatever this method returns:
   ```java
   private Object readResolve() { return INSTANCE; }
   ```
2. **Use enum** — enums are serialization-safe by default.

---

## Senior Questions

### S1. When is Singleton an anti-pattern?

**Answer:** When it's used as a shortcut for "this is shared," not because the constraint "exactly one" is real. Symptoms: hidden dependencies, untestable code, mutable global state. The fix is **Dependency Injection** — pass the instance explicitly.

### S2. How would you refactor a codebase that's drowning in singletons?

**Answer:** Gradual migration:

1. Extract interfaces from singleton classes.
2. Add constructor injection alongside `getInstance()` (default to it for legacy callers).
3. Migrate callers PR-by-PR to pass the dependency.
4. Once all callers are migrated, delete the singleton's static accessor.
5. Optionally introduce a DI container.

Avoid Service Locator as an intermediate step — it's harder to remove than Singleton.

### S3. Compare Singleton with Dependency Injection.

**Answer:**

| | Singleton | DI |
|---|---|---|
| Coupling | Hidden (static lookup) | Explicit (constructor params) |
| Test mocking | Hard | Easy |
| Multi-environment | Awkward | Built-in |
| Boilerplate | Low | Higher |
| Discoverability | Easy globally | Requires reading wiring |

DI scales better for large/test-heavy projects.

### S4. When does Multiton make sense over Singleton?

**Answer:** When the constraint is "exactly one **per** something," not "exactly one." Examples:

- One DB pool per region/database.
- One cache per tenant.
- One logger per module.

Implementation: a static map from key → instance, with thread-safe access. Beware of unbounded growth — bound the registry or evict.

### S5. How do you handle multi-classloader environments (Java)?

**Answer:** In app servers (Tomcat, JBoss) or OSGi systems, the same `.class` file can be loaded by separate classloaders, producing **two distinct singletons**. Each classloader has its own `Class<S>` and its own static field.

Mitigations:
- Don't depend on JVM-global uniqueness.
- Use a **parent classloader** to load shared classes once.
- For shared state, externalize to a distinct service (Redis, etcd).

### S6. Walk me through a sharded singleton.

**Answer:** When the singleton's lock becomes a contention bottleneck, partition the state across N shards:

```go
const N = 32
type ShardedCache struct {
    shards [N]struct {
        mu sync.RWMutex
        m  map[string]any
    }
}
func (c *ShardedCache) Get(key string) any {
    s := &c.shards[hash(key)%N]
    s.mu.RLock(); defer s.mu.RUnlock()
    return s.m[key]
}
```

Contention drops by ~1/N. Use a power-of-two N for cheap hashing.

### S7. What's the difference between Spring's `@Singleton` and a JVM-level Singleton?

**Answer:**
- **JVM-level Singleton** — one instance per classloader (typically per JVM).
- **Spring `@Singleton`** — one instance per `ApplicationContext`. Multiple contexts (e.g., parent/child for web modules) can have separate instances.

The container-scoped form is testable: tests use their own `ApplicationContext` with mocks.

### S8. How do you make a Singleton both lazy and lock-free in Go?

**Answer:** Use `sync.Once`:

```go
var (
    instance *S
    once     sync.Once
)
func Get() *S { once.Do(func(){ instance = newS() }); return instance }
```

The fast path is one atomic load on `done` (typically 2-3 ns). No mutex acquisition unless first call.

For replaceable singletons (e.g., feature flags), use `atomic.Pointer[T]`:

```go
var p atomic.Pointer[State]
func Get() *State    { return p.Load() }
func Replace(s *State) { p.Store(s) }
```

### S9. What are the GC implications of Singleton?

**Answer:**
- Singletons are **GC roots** — they survive until the process exits.
- Anything they reference also survives.
- Common leaks: listener lists never cleared, unbounded caches, growing histories.
- Mitigations: provide unsubscribe methods, use weak references where supported, bound caches with eviction (LRU/TTL).

### S10. Explain leader election as "distributed singleton."

**Answer:** Leader election picks one active instance among N replicas. Used in K8s controllers, distributed databases, etc. Implementation usually leans on:

- A **lease** in a coordination service (etcd, Consul, Zookeeper).
- Heartbeats from leader; followers re-elect on timeout.
- **Fence tokens** so stale leaders can't write valid state.

Caveat: due to FLP impossibility, you can't guarantee both safety (one leader) and liveness (always a leader) under network partitions. Real systems pick safety.

---

## Professional Questions

### P1. Walk me through `sync.Once` implementation.

**Answer:**

```go
type Once struct { done atomic.Uint32; m Mutex }

func (o *Once) Do(f func()) {
    if o.done.Load() == 0 { o.doSlow(f) }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

Correctness: atomic load with acquire on `done` — if it sees 1, all writes from `f()` are visible (release/acquire pairing). Mutex serializes initialization. The deferred `Store(1)` runs even on panic, so `Once` doesn't retry.

### P2. Why does Java DCL need `volatile`?

**Answer:** The assignment `instance = new S()` consists of: (1) allocate, (2) publish reference, (3) run constructor. Without `volatile`, the JIT can reorder 2 and 3 — another thread observes `instance != null` while fields are still default. `volatile` introduces a release barrier on write and an acquire barrier on read, making constructor writes happen-before the publication.

### P3. How does the JVM guarantee enum singleton thread safety?

**Answer:** JLS §12.4.2 specifies class initialization. The JVM holds an internal lock during `<clinit>` (the class initializer that runs constants). Since `INSTANCE` is initialized in `<clinit>`, only one thread runs the constructor; other threads block until init completes, then see the fully-published `INSTANCE`. No user-level synchronization needed.

### P4. How does Python's GIL affect singleton thread safety?

**Answer:** The GIL serializes Python bytecodes — each individual bytecode is atomic. But singleton creation is **multi-bytecode** (read + check + write). A thread switch between read and write can produce two instances. Use `threading.Lock` for safety.

In free-threaded Python (3.13+ no-GIL), this becomes universally required — code that relied on accidental atomicity will break.

### P5. What's the cost of an atomic operation on different architectures?

**Answer:**
- **x86-64 (TSO):** `LOCK CMPXCHG` ~10-30 cycles. `volatile` reads on x86 are essentially free.
- **ARM64 (weak memory):** `LDAXR/STLXR` ~15-40 cycles plus barriers. Acquire/release have measurable cost.

So on x86, hot-path singleton reads are free; on ARM (Graviton, Apple Silicon), they show up in profiles.

### P6. How does HotSpot inline `getInstance()`?

**Answer:** After ~10,000 invocations, HotSpot's C2 compiler inlines small methods. `Logger.getInstance()` returning a static field becomes a direct `getstatic`. If the field is effectively final, the JIT may even constant-fold it into call sites — making subsequent reads free.

### P7. What happens to singletons when a process forks?

**Answer:** `fork()` copies the entire process. Children inherit:

- File descriptors — shared between parent and child; closing in one affects the other.
- Sockets — same; can lead to "connection lost" mysteries.
- Threads — child has only the calling thread; locks held by other threads are never released.
- Mutex state — undefined.

Mitigations: use `start_method="spawn"` in Python `multiprocessing`; reinit singletons in child via `os.register_at_fork`; or design singletons to be fork-safe.

### P8. What memory leaks can a Singleton cause?

**Answer:** The singleton is a GC root, so it (and everything it references) lives forever. Common leaks:

1. **Listener lists** that grow without unsubscribe.
2. **Unbounded caches.**
3. **Reference to short-lived objects** (history, audit logs).

Detect with `pprof` (Go), `jmap -histo` (Java), `tracemalloc` (Python). Mitigate with weak references, size-bounded caches, explicit cleanup.

### P9. What's FLP impossibility and why does it apply to "distributed singleton"?

**Answer:** Fischer, Lynch, Paterson (1985) proved that in an asynchronous distributed system with even one faulty process, no deterministic consensus algorithm guarantees both safety and liveness. For "distributed singleton" (leader election), you can't always pick exactly one leader in finite time under network partitions. Real systems trade liveness for safety: Raft, Paxos, K8s leader election will tolerate brief unavailability rather than allow two leaders.

### P10. How do you design a "leader-only writer" pattern that's safe under split-brain?

**Answer:** Use **fencing**. Every write carries an epoch number issued by the coordination service. Storage rejects writes with an old epoch:

```
leader v5: write(key, value, epoch=5) → ok
network partition; new leader v6 elected
old leader v5: write(key, value, epoch=5) → REJECTED (current epoch is 6)
```

This pattern ensures even if two leaders coexist briefly, only one's writes commit. See: Martin Kleppmann's "How to do distributed locking" (2016).

---

## Coding Tasks

### C1. Implement a thread-safe lazy Singleton in Go **without** `sync.Once`.

**Solution:**

```go
package singleton

import "sync"

type S struct{ /* fields */ }

var (
    instance *S
    mu       sync.Mutex
    initOnce sync.Once  // wait, the task says without sync.Once
)

// Use atomic + mutex approach:
import "sync/atomic"

var (
    done   atomic.Uint32
    instMu sync.Mutex
    inst   *S
)

func Get() *S {
    if done.Load() == 1 {
        return inst
    }
    instMu.Lock()
    defer instMu.Unlock()
    if done.Load() == 0 {
        inst = &S{}
        done.Store(1)
    }
    return inst
}
```

This is essentially `sync.Once` reimplemented. Note: must use atomic, not plain reads, for the fast path.

### C2. Resettable Singleton for testing in Java.

**Solution:**

```java
public final class Logger {
    private static volatile Logger instance;
    private Logger() {}

    public static Logger getInstance() {
        Logger ref = instance;
        if (ref == null) {
            synchronized (Logger.class) {
                ref = instance;
                if (ref == null) instance = ref = new Logger();
            }
        }
        return ref;
    }

    /** @VisibleForTesting */
    static synchronized void __reset() { instance = null; }
}
```

Tests:

```java
@AfterEach
void resetSingleton() { Logger.__reset(); }
```

### C3. Generic Singleton metaclass in Python.

**Solution:**

```python
import threading

class SingletonMeta(type):
    _instances: dict[type, object] = {}
    _lock = threading.Lock()

    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            with cls._lock:
                if cls not in cls._instances:
                    cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]


class Logger(metaclass=SingletonMeta):
    def __init__(self):
        self.entries = []

    def log(self, msg):
        self.entries.append(msg)


a = Logger(); b = Logger()
assert a is b
```

### C4. Multi-tenant Singleton (one instance per tenant ID).

**Solution (Multiton):**

```python
import threading

class TenantConfig:
    _instances: dict[str, "TenantConfig"] = {}
    _lock = threading.Lock()

    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id
        self.settings = {}

    @classmethod
    def get(cls, tenant_id: str) -> "TenantConfig":
        with cls._lock:
            if tenant_id not in cls._instances:
                cls._instances[tenant_id] = cls(tenant_id)
            return cls._instances[tenant_id]


a1 = TenantConfig.get("acme")
a2 = TenantConfig.get("acme")
assert a1 is a2
b = TenantConfig.get("globex")
assert a1 is not b
```

### C5. Distributed Singleton sketch using Redis SETNX.

**Solution (sketch):**

```python
import redis
import time
import os

r = redis.Redis()
LEADER_KEY = "myapp:leader"
LEASE_SECONDS = 15

my_id = f"{os.getpid()}@{os.uname().nodename}"

def try_acquire_leadership() -> bool:
    return bool(r.set(LEADER_KEY, my_id, nx=True, ex=LEASE_SECONDS))

def renew_leadership() -> bool:
    # Lua: only renew if I'm still the leader
    script = """
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("EXPIRE", KEYS[1], ARGV[2])
    else
        return 0
    end
    """
    return bool(r.eval(script, 1, LEADER_KEY, my_id, LEASE_SECONDS))

def leadership_loop():
    am_leader = False
    while True:
        if am_leader:
            am_leader = renew_leadership()
        else:
            am_leader = try_acquire_leadership()
        if am_leader:
            do_leader_work()
        time.sleep(LEASE_SECONDS // 3)
```

Caveats: Redis is not consensus-safe. For production, use etcd, Consul, or Kubernetes Lease. Always fence writes by epoch.

---

## Trick Questions

### T1. Is `enum` always lazier than `private static final` in Java?

**Answer:** No, both follow the same JLS §12.4 class-init rules: lazy on first use. Enum is **not** more lazy — it's the same. The advantages are serialization safety, reflection safety, and shorter syntax.

### T2. Can `sync.Once` be reset?

**Answer:** Not via the public API. You can `*o = sync.Once{}` to assign a fresh struct (zeroed `done` and `m`), but this is **only safe** if no other goroutine is concurrently using `o`. For tests in single-threaded test setup, it's acceptable.

### T3. Are Python module-level singletons thread-safe?

**Answer:** **At creation:** yes — Python's import lock serializes module init. **After creation:** depends on the singleton's own internal state. Mutating it from multiple threads requires explicit locking.

### T4. Does `sync.Once.Do(f)` retry if `f` panics?

**Answer:** **No.** `Once` marks itself "done" via a deferred `Store(1)` that runs even on panic. The contract is "exactly once," not "until success." If you need retry-on-failure, use `sync.OnceValues` (Go 1.21+) which captures errors, or build your own.

### T5. Can two threads see `instance == null` even **with** `volatile`?

**Answer:** **Yes, briefly.** `volatile` doesn't make the check-and-construct sequence atomic. Two threads racing the outer `if (instance == null)` can both proceed to the lock; one constructs, the other waits, then re-checks (DCL inner check) and skips. So eventually only one instance exists, but both threads *did* see null at the same time.

---

## Behavioral / Architectural Questions

### B1. Tell me about a time when Singleton caused a bug in production.

**Sample answer:**

"At a previous role, our `Logger` Singleton accumulated subscriber callbacks (we used it as an event bus too — first SRP violation). Tests added subscribers but never removed them. After 100k tests, the singleton's listener list had 100k entries; logging slowed proportionally because every `log()` iterated all listeners. The fix was twofold: (1) split the singleton into Logger and EventBus, and (2) make EventBus subscribers `WeakReference`-held, so test-scoped objects could be GC'd. We also added an integration test that asserted `EventBus.subscriberCount() < 100` after the test suite."

### B2. Walk me through how you'd convince a team to adopt DI over Singleton.

**Sample answer:**

"Lead with concrete pain: identify a recent bug or test that took >2 hours to write because of Singleton state pollution. Show a side-by-side: Singleton-based vs DI-based test for the same code. Then propose incremental migration: start with the next new feature using DI; gradually retrofit critical paths. Don't push a big-bang rewrite — it's politically and technically expensive. Use a DI container if the team is already comfortable with one (Spring, Guice, Wire); otherwise constructor injection is enough."

### B3. How would you decide whether a new component should be a Singleton?

**Sample answer:**

"Checklist:
1. Is 'exactly one' a *real* constraint (e.g., shared OS resource, single connection pool) or just convenience? If convenience, prefer DI.
2. Does the component have state that mutates? If yes, Singleton + tests = pain. Reconsider.
3. Will I need to swap implementations under test? If yes, at minimum extract an interface and inject.
4. Is the project small (<10k LoC)? Singleton is fine.
5. Does the component need different config in different environments? Use DI.

Default to: small/genuine resource → Singleton OK. Anything else → DI."

### B4. You're writing a CLI tool. Is Singleton appropriate?

**Sample answer:**

"For a CLI tool — typically yes. CLIs are short-lived, single-process, often single-threaded, and have low test surface. A Singleton logger or config reader is fine and keeps the code terse. The 'hidden coupling' argument is weakest here because the entire codebase fits in one head. I'd use Singleton freely but still extract interfaces where convenient (e.g., for a `--dry-run` mode that swaps the file writer)."

### B5. Describe the relationship between Singleton and Dependency Injection.

**Sample answer:**

"Singleton answers: 'How do I ensure one instance and provide global access?' DI answers: 'How do I get my dependencies?' They're orthogonal — DI containers often produce singletons (Spring's default scope is `@Singleton`).

The friction is between *static* Singleton (`Class.getInstance()`) and DI: static Singletons hide dependencies and are hard to mock. *Container-scoped* Singletons (Spring beans, Guice singletons) get the best of both: one instance per container, but injected explicitly into consumers. For new code, prefer container singletons over static singletons."

---

## Tips for Answering

1. **State the constraint first.** "Singleton ensures exactly one instance." Then explain why.
2. **Use the words "private constructor" and "static accessor."** Interviewers want to hear these.
3. **Mention thread safety unprompted.** It's the #1 follow-up.
4. **Know enum + lazy holder for Java.** These are senior-level signals.
5. **Have an opinion.** "I prefer DI for production code." Senior interviewers value calibrated opinions.
6. **Be specific about *when* you'd use each variant.** "Eager for cheap state, lazy for expensive, sharded for hot read paths."
7. **Acknowledge the criticism.** Don't defend Singleton uncritically.

---

← Back to Singleton folder · [↑ Creational Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Previous:** [Singleton — Professional](professional.md) | **Next:** [Singleton — Tasks](tasks.md)
