# Adapter — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/adapter](https://refactoring.guru/design-patterns/adapter)

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What is the Adapter pattern?

**A.** A structural design pattern that lets two classes with incompatible interfaces work together. The adapter wraps one of them and translates calls so the other can use it.

### Q2. Name the three roles in the Adapter pattern.

**A.** **Target** (the interface the client expects), **Adapter** (the translator), **Adaptee** (the existing class with the wrong interface).

### Q3. What's the difference between an object adapter and a class adapter?

**A.** Object adapter holds the adaptee via composition (a field). Class adapter inherits from the adaptee. Object adapter is more flexible because you can swap the adaptee; class adapter requires multiple inheritance and locks you to one adaptee class at compile time.

### Q4. Why is the Adapter pattern called "Adapter"?

**A.** It works like a power-plug adapter: neither the wall nor the laptop changes; the adapter sits between them and lets them connect.

### Q5. Give a real-world example of Adapter.

**A.** SLF4J in Java is an adapter standard — it provides one logging interface; concrete adapters wrap log4j, java.util.logging, logback. Your application code calls `Logger.info(...)`; the adapter routes it to whichever framework is on the classpath.

### Q6. What's the difference between Adapter and Wrapper?

**A.** "Wrapper" is the umbrella term — Adapter, Decorator, and Proxy are all wrappers. Adapter changes the interface; Decorator adds behavior; Proxy controls access.

### Q7. What's the difference between Adapter and Facade?

**A.** Adapter wraps **one** existing class with a **different** interface. Facade simplifies **many** subsystem classes behind a **new** interface. Adapter targets compatibility; Facade targets simplicity.

### Q8. Can you put business logic in an adapter?

**A.** No. The adapter should only translate calls. Business logic belongs in the domain layer. If you put policy in the adapter, it becomes a different pattern (often Facade or Strategy).

### Q9. Why is the constructor of an Adapter typically not private?

**A.** Because we want callers to be able to construct an adapter, often passing in the adaptee. Adapter is a regular class — only Singleton has the private-constructor rule.

### Q10. When should you NOT use the Adapter pattern?

**A.** When you control both sides — just change one of the interfaces. When the mismatch is one line — a function alias is shorter. When the translation has lots of branches and conditionals — you probably want a Facade or Strategy.

---

## Middle Questions

### Q11. How would you map vendor exceptions to your domain in an adapter?

**A.** Catch the vendor's specific exceptions and re-throw your own domain exception. For example, `StripeCardException` → `PaymentException(PaymentError.DECLINED, ...)`. This keeps the rest of the codebase free of vendor types and lets the domain handle errors uniformly.

### Q12. How do you test an adapter?

**A.** Two layers: (1) unit tests with a mock or fake adaptee — verify each translation path including error mapping; (2) integration tests against a sandbox of the real adaptee, run nightly or on adapter-specific changes. The two layers verify *your code* and *your assumptions about the vendor*.

### Q13. You have 8 payment providers. How do you organize the adapters?

**A.** One target interface, one adapter per provider, all in a `providers/` package. A registry maps provider names to factory functions. A higher-level Strategy (router) picks the adapter at runtime by config. Each adapter is owned by a small subteam.

### Q14. How would you refactor 200 call sites that use a vendor SDK directly?

**A.** Strangler-fig migration:
1. Define the target interface from current usage.
2. Write the adapter and unit-test it.
3. Migrate one call site at a time in small PRs.
4. After all sites move, lint forbids vendor imports outside the adapter package.
5. Optionally, write a second adapter for a different vendor.

### Q15. What are common mistakes when writing adapters?

**A.** Putting business logic inside; returning vendor types from adapter methods; letting vendor exceptions leak; growing the adapter into a god class; building "future-proof" adapters for swaps that never happen.

### Q16. How would you adapt an async API to a sync target (or vice versa)?

**A.** First, ask if the target *should* be async — propagating async-ness is usually correct. If you must adapt async to sync, block on the future inside the adapter and document the cost (one thread per concurrent call). Don't do this in async runtimes (Node.js, Python `asyncio`) — you'll deadlock.

### Q17. What's a two-way adapter?

**A.** An adapter that implements both interfaces, so the same instance can be passed where either is expected. Useful in plug-in systems where the adapter sits between a host and a plugin.

### Q18. How does Adapter relate to Hexagonal Architecture?

**A.** Hexagonal Architecture (Ports and Adapters) names exactly what GoF Adapter does, scaled to system level. Ports are target interfaces owned by the application core. Adapters are concrete implementations that wire ports to HTTP, DB, queues, vendor SDKs.

### Q19. What's the Anti-Corruption Layer in DDD, and how does it relate?

**A.** An Anti-Corruption Layer is a module dedicated to translating between two bounded contexts. It contains adapters, but also domain mappers, error translators, and sometimes caching. It's "Adapter scaled up to a whole boundary," with the rule that no foreign concept escapes.

### Q20. How would you handle pagination if the adaptee uses callbacks and the target wants an iterator?

**A.** Buffer events in a bounded queue inside the adapter, then expose `__iter__` (Python) or a channel (Go). Decisions to pin down: queue size, behavior on overflow (block, drop, error), error propagation, cancellation. Don't default to unbounded — that's choosing OOM.

---

## Senior Questions

### Q21. When does an adapter become a bottleneck, and how do you fix it?

**A.** Common smells:
- **Too many methods** → apply Interface Segregation; split into smaller targets.
- **Conditional branches by vendor** → that's policy; move to a Strategy pattern.
- **Two adapters share 80% of code** → extract a shared base or compose.
- **Translation is slow** → profile; cache deterministic conversions; consider exposing batched methods.
- **Tests hit the network** → inject and fake the adaptee.

### Q22. How do you keep an adapter thin in a real codebase?

**A.** Discipline + tooling:
- Code review rule: adapters do translation only, no `if` over policy.
- Lint rule: no vendor imports outside the adapter package.
- Adapter size limit (e.g., 200 lines) as a smell, not a hard rule.
- Cross-cutting concerns (retries, metrics, circuit breaker) go in **Decorators** wrapping the adapter, not in the adapter.

### Q23. Describe a decorator stack around an adapter.

**A.**
```
PaymentPort
  ↑ implemented by
RetryDecorator(MetricsDecorator(StripeAdapter(client)))
```
The adapter is thin. Each decorator is independently testable. Wired by a factory or DI container.

### Q24. What's the interface segregation problem with Adapter, and how do you avoid it?

**A.** If the target interface has 20 methods (charge, refund, dispute, subscribe, ...), every adapter must implement all 20 — even when a vendor doesn't support some. Solution: split the target by capability (`Charger`, `Refunder`, `Subscriber`) and let each adapter implement only what its vendor supports. The router/DI can compose them.

### Q25. How would you handle a vendor SDK that's unstable across minor versions?

**A.** Lock the SDK version. Or, if churn is severe, write the adapter against the *raw HTTP API* instead of the SDK. The wire protocol is more stable than the SDK's surface. More upfront work; much less long-term churn.

### Q26. How does an adapter affect distributed tracing?

**A.** It adds a span per call (`Caller → Adapter → Vendor`). Tag the spans clearly: adapter span includes the vendor name and call type; vendor span includes the vendor's own request ID. Without good tagging, traces become noisy. Most APM tools auto-instrument standard adapters (JDBC, HTTP clients).

### Q27. How would you design adapters for a system that needs to swap vendors per request (e.g., based on user country)?

**A.** Adapter + Strategy + Factory:
- One target interface, N adapters (one per vendor).
- A Router/Strategy picks the adapter based on a key (country, customer tier, market).
- A Factory or DI container instantiates the chosen adapter.
- Cache adapter instances when the adaptee is heavy (e.g., HTTP clients with connection pools).

### Q28. What are the trade-offs of versioned adapters during a vendor migration?

**A.** Two adapters (`StripeAdapterV1`, `StripeAdapterV2`), gated by config. Pros: gradual rollout, easy rollback. Cons: parallel test infrastructure, double the integration testing cost, drift risk if the two implementations diverge in subtle ways. Worth it during high-stakes migrations; overkill for small ones.

### Q29. How would you enforce "no vendor types leak across the adapter"?

**A.** Combination of:
1. **Code review** — easy to spot in PRs.
2. **Linting** — ArchUnit (Java), import-linter (Python), depguard/golangci-lint (Go) — block `import com.stripe.*` outside the adapter package.
3. **Domain types are records/value objects** — clearly distinct from vendor entities.
4. **Build module structure** — adapter is its own Maven/Go module with the vendor as a dependency; the domain module doesn't depend on it.

### Q30. When does the adapter pattern not apply, even though it looks like it does?

**A.** When the "two interfaces" are actually the same shape — you don't need translation, just an alias. When you control both sides — fix one of them. When the integration is one-shot (a script, a migration tool) — direct calls are fine. When the translation logic is huge — that's a Facade or a service, not an adapter.

---

## Professional Questions

### Q31. What's the JVM cost of an interface call through an adapter?

**A.** Cold: ~10 ns (vtable + inline-cache fill). Warm + monomorphic site: ~1 ns or 0 (HotSpot inlines the call). Megamorphic site (3+ types seen): much worse — every call goes through the full vtable lookup. This is why "one adapter per interface" beats "many adapters at one site" in microbenchmarks.

### Q32. Does Class Hierarchy Analysis (CHA) optimize adapter calls?

**A.** Yes. If HotSpot can prove only one class implements the interface, it devirtualizes — the call becomes direct, then can be inlined. Mark adapter classes `final` to help: it tells the JIT (and human readers) the class is leaf, enabling more optimizations.

### Q33. How does Go's interface dispatch compare?

**A.** Go uses an `iface` (two words: `itab` + `data`). Calls go through an indirect function pointer in the `itab`. The Go compiler does *not* inline indirect calls. Cost is ~3-4 ns per call regardless of warm/cold. Cheaper than cold JVM, more expensive than warm JVM.

### Q34. What's the boxing cost in Java adapters?

**A.** A target with `Optional<Long>` or `Integer` return types boxes on every call. For high-throughput adapters, prefer primitives or `OptionalLong` etc. The difference can be 10-20× in tight loops. For request/response code (one call per HTTP request), boxing cost is invisible.

### Q35. How does CPython's adaptive interpreter affect adapters?

**A.** PEP 659 (CPython 3.11+) specializes `LOAD_ATTR` after a few hits — repeated attribute access on the same type drops from ~150 ns to ~50 ns. Adapter calls are still 2-3× slower than direct calls in pure Python, but the gap narrowed. For I/O-bound Python apps the difference is invisible.

### Q36. What's the cache-line story for an adapter?

**A.** A small adapter object plus its adaptee reference often fit in one cache line — one fetch covers both. The problem case is **arrays of adapters**: each element is a pointer to a heap-scattered object, so iteration thrashes the cache. Mitigations: flat structs (Go, Rust), batching, sorting by type.

### Q37. How does escape analysis help adapter performance?

**A.** If an adapter is created and used in the same method without escaping, HotSpot's escape analysis can elide the allocation entirely (scalar replacement) — the adapter becomes inlined fields on the stack, no heap, no GC. Brittle: a debugger attaching, an `identityHashCode` call, or a `synchronized` block can disable EA. Always measure.

### Q38. Why pass adapters as pointers in Go?

**A.** Because converting a value type to an interface allocates a heap copy (so the interface can hold a stable pointer). `var p Target = adapter` (value) → allocation. `var p Target = &adapter` (pointer) → no allocation. Pointer-receiver methods are the idiomatic way to pass adapters through interfaces in Go.

### Q39. How does idempotency interact with adapter retries?

**A.** If the adapter retries internally (or a retry decorator wraps it), the underlying adaptee call must be idempotent — otherwise retried calls cause duplicate side effects (charging twice, sending two emails). Either generate idempotency keys inside the adapter (UUIDv7 or hash of request) and pass them to the vendor, or document loudly that retries happen at a higher layer.

### Q40. How would you benchmark adapter overhead correctly?

**A.** Use the language's standard tool (JMH, `testing.B`, `pytest-benchmark`). Prevent dead-code elimination with `Blackhole`/`b.N` properly. Warm up to reach JIT steady state. Make sure each call site is monomorphic (one type) — otherwise inline caches fail and numbers explode. Compare direct vs adapter on the same input. Expect: warm Java ≈ no overhead; Go ≈ 3 ns; Python ≈ 2× direct.

---

## Coding Tasks

### Task 1: Basic Adapter (Go)

> Implement an `EmailSender` interface and adapter for a hypothetical `MailgunClient`.

```go
package main

import "fmt"

// Target
type EmailSender interface {
    Send(to, subject, body string) error
}

// Adaptee — third party, can't change
type MailgunClient struct{ apiKey string }

func (m *MailgunClient) Deliver(payload map[string]string) error {
    fmt.Printf("Mailgun -> %s: %q\n", payload["recipient"], payload["text"])
    return nil
}

// Adapter
type MailgunAdapter struct{ client *MailgunClient }

func (a *MailgunAdapter) Send(to, subject, body string) error {
    return a.client.Deliver(map[string]string{
        "recipient": to,
        "subject":   subject,
        "text":      body,
    })
}

func main() {
    var sender EmailSender = &MailgunAdapter{client: &MailgunClient{apiKey: "k"}}
    sender.Send("a@b.com", "hi", "hello")
}
```

---

### Task 2: Adapter with Error Translation (Java)

```java
public interface UserRepository {
    User findById(String id) throws UserNotFoundException;
}

public final class JpaUserRepositoryAdapter implements UserRepository {
    private final JpaEntityManager em;

    public JpaUserRepositoryAdapter(JpaEntityManager em) { this.em = em; }

    @Override
    public User findById(String id) throws UserNotFoundException {
        try {
            JpaUser jpa = em.find(JpaUser.class, id);
            if (jpa == null) throw new UserNotFoundException(id);
            return new User(jpa.getId(), jpa.getEmail(), jpa.getCreatedAt());
        } catch (PersistenceException e) {
            throw new UserNotFoundException(id, e);
        }
    }
}
```

---

### Task 3: Iterator Adapter (Python)

> Adapt a callback-based event source to a Python iterator.

```python
import queue


class EventIteratorAdapter:
    _SENTINEL = object()

    def __init__(self, source, max_buffer=1000):
        self._q = queue.Queue(maxsize=max_buffer)
        source.on_event(self._q.put)
        source.on_done(lambda: self._q.put(self._SENTINEL))

    def __iter__(self):
        return self

    def __next__(self):
        item = self._q.get()
        if item is self._SENTINEL:
            raise StopIteration
        return item
```

---

### Task 4: Money Adapter (Java)

> Adapt a vendor SDK that uses `double` for money to a domain that uses `Money` (long minor units + currency).

```java
public final class Money {
    public static Money ofMinor(long minor, String currency) { ... }
    public long minorUnits() { ... }
    public String currency() { ... }
}

public final class VendorAdapter implements PaymentProcessor {
    private final VendorClient client;

    public VendorAdapter(VendorClient c) { this.client = c; }

    @Override
    public void pay(Money amount) {
        // Convert minor units to vendor's double major units, rounding HALF_EVEN.
        double major = BigDecimal.valueOf(amount.minorUnits())
                                 .movePointLeft(2)
                                 .setScale(2, RoundingMode.HALF_EVEN)
                                 .doubleValue();
        client.charge(major, amount.currency());
    }
}
```

---

### Task 5: Two-way Adapter (Java)

> Build a plug-in adapter that implements both `Host` and `Plugin` interfaces.

```java
public class PluginBridge implements Host, Plugin {
    private final Host host;
    private final Plugin plugin;

    public PluginBridge(Host host, Plugin plugin) {
        this.host = host;
        this.plugin = plugin;
    }

    // Host methods — called by the plugin.
    @Override public void log(String msg) { host.log(msg); }

    // Plugin methods — called by the host.
    @Override public void onTick() { plugin.update(); }
}
```

---

## Trick Questions

### Q41. "If both sides are mine, should I still write an adapter?"

**A.** Usually no. Adapter is a tax for irreconcilable mismatch. If you control both sides, fix the mismatch. Exceptions: when the two sides are large, owned by different teams, and changing the contract requires coordination — an adapter buys time. But it's a workaround, not the goal.

### Q42. "Is `ArrayList → List` a use of Adapter?"

**A.** No — `ArrayList` *implements* `List`. Adapter is for *incompatible* interfaces. Implementing an existing interface is just polymorphism.

### Q43. "Is a constructor that takes incompatible parameters an adapter?"

**A.** No. A constructor builds an object; an adapter is a class with translation methods. They can co-exist (the adapter's constructor takes the adaptee).

### Q44. "If the adapter has no methods to translate (the adaptee already matches), is it still an adapter?"

**A.** No — it's just a delegating wrapper, sometimes called a "pass-through." The pattern's whole purpose is *changing the interface*. If nothing changes, the wrapper is dead weight.

### Q45. "Can an Adapter and a Decorator be the same class?"

**A.** Conceptually no — they have different intents. In practice some classes do both (rename methods *and* add caching). When that happens, name the dominant intent and document the secondary. Better: split into two classes.

---

## Behavioral / Architectural Questions

### Q46. "Tell me about a time you used an adapter pattern in production."

**A.** *Structured answer:* Situation (we were integrating Stripe; legacy code called PayPal directly across 80 sites). Task (migrate without breaking). Action (defined a `PaymentProcessor` interface, wrote `PayPalAdapter` matching current behavior, migrated sites in 6 PRs, then added `StripeAdapter`). Result (vendor swap took 2 days; previously similar swaps took 2 weeks).

### Q47. "How would you convince a teammate that an adapter is needed when they want to call the SDK directly?"

**A.** Three angles: (1) *Testability* — show how the SDK call is hard to mock vs the interface; (2) *Vendor risk* — prices/policies/SDK contracts change; demonstrate cost of a future swap without adapter; (3) *Domain purity* — vendor types in the domain layer ripple complexity outward. If the integration is genuinely one-off, accept the direct call.

### Q48. "Your team writes adapters for every external call, even trivial ones. What do you do?"

**A.** Push back on the rule. Adapter is a tool for genuine mismatch — universal mandates create busywork and cargo-culted code. Suggest a heuristic: if the SDK type touches three or more files, wrap it; otherwise direct call is fine. Document the trade-off.

### Q49. "An adapter you own has grown to 800 lines. What's your first move?"

**A.** Read it carefully and categorize each block: (1) translation, (2) policy, (3) cross-cutting (logging, retries), (4) caching. Move (2) to the domain or a Strategy; move (3) to Decorators; move (4) to a Decorator or a separate cache. The adapter should shrink to translation only. If after that it's still large, the target interface itself may be too broad — segregate.

### Q50. "How do you decide between Adapter and Facade in code review?"

**A.** Adapter wraps **one** existing class with a **different** interface (compatibility). Facade wraps **many** classes behind a **simpler** interface (simplicity). If a PR introduces a class that holds one collaborator and renames methods → Adapter. If it holds 4 collaborators and exposes a coarse-grained method that orchestrates them → Facade. Wrong name leads to wrong evolution.

---

## Tips for Answering

1. **Always lead with the intent.** "Adapter exists to make incompatible interfaces work together." If you can't state the intent, the rest of the answer drifts.
2. **Distinguish from sibling patterns.** Adapter ≠ Decorator ≠ Proxy ≠ Facade. Interviewers love this comparison; have one-line distinctions ready.
3. **Bring an example from real code.** Vendor SDK wrapping is the canonical answer; mainframe migration is impressive if you have it.
4. **Show trade-off awareness.** "Adapter pays an indirection cost; in 99% of code that's invisible, but in inner loops it can matter." Senior signal.
5. **Don't over-engineer in coding tasks.** A small clean adapter beats one with retries/metrics/caching in 100 lines. They'll ask if they want more.
6. **Map exceptions.** Mentioning "I'd translate vendor exceptions to domain exceptions" earns points instantly — most candidates forget.
7. **Mention Hexagonal Architecture.** Shows you've thought beyond the GoF book.
8. **Be honest about overuse.** If asked "should we wrap every external call?" say "no — only when the cost of leak is real."

---

← Back to Adapter folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Adapter — Hands-On Tasks](tasks.md)
