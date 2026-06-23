# Facade — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/facade](https://refactoring.guru/design-patterns/facade)

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

### Q1. What is the Facade pattern?

**A.** A structural pattern that provides a simplified interface to a complex subsystem. The Facade hides the moving parts behind a small, focused API so callers don't have to learn every internal detail.

### Q2. Give a real-world software example of Facade.

**A.** Python's `requests.get(url)` is a Facade over urllib3, sockets, and TLS. AWS SDK's high-level clients (`s3.upload_file`) are Facades over signing, multipart, retries.

### Q3. What's the difference between Facade and Adapter?

**A.** Facade simplifies a complex subsystem with a new API. Adapter retrofits a single class to fit a different expected API. Same code shape sometimes; different intent.

### Q4. Does Facade hide the subsystem completely?

**A.** No. The subsystem stays accessible to power users who need finer control. Facade *adds* a path; it doesn't usually *remove* others.

### Q5. What's a god-class Facade and why is it bad?

**A.** A Facade with too many methods (30+) that has stopped simplifying anything — it's collecting responsibility instead. Fix: split by task or audience.

### Q6. What roles does the pattern have?

**A.** **Facade** (the simplifying class), **Subsystem** (the complex set of classes the Facade orchestrates), **Client** (code that uses the Facade).

### Q7. Why is the Facade called a "Facade"?

**A.** Like a building's facade — a simple, presentable front that hides a complex interior.

### Q8. Should Facade methods return subsystem types?

**A.** No. That couples callers to the internal API and defeats the simplification. Return domain types or DTOs.

### Q9. When should you NOT use Facade?

**A.** When the subsystem is already small/simple, when every caller does something different (Facade can't simplify what's truly varied), when you'd duplicate an existing framework abstraction.

### Q10. Can you have multiple Facades over one subsystem?

**A.** Yes. Different audiences (customer vs admin vs analytics) often need different Facades that share the underlying subsystem.

---

## Middle Questions

### Q11. Where does business logic go — in the Facade or the subsystem?

**A.** In the subsystem (or domain). The Facade *orchestrates*; it doesn't decide. If a Facade has `if amount > threshold then ...` business policy, the policy belongs in a domain object.

### Q12. How do you keep a Facade small?

**A.** One Facade per task or audience. Cap at ~10 methods. Split when growing. Use named, task-oriented method names so the Facade's purpose is obvious.

### Q13. What's the relationship between Facade and Service Layer?

**A.** A Service Layer is a collection of Facades. The pattern names the *unit* (one Facade); the layer names the *position* (a layer of Facades sitting between UI and domain/persistence).

### Q14. How does Facade compare to Mediator?

**A.** Facade simplifies access from outside (focuses on entry point). Mediator coordinates objects so they don't talk directly to each other (focuses on object interaction). Different problems.

### Q15. How would you test a Facade?

**A.** Mock the subsystem dependencies. Assert orchestration order, default values, and error handling. Add an integration test with real subsystems for end-to-end confidence.

### Q16. How do you handle errors in a Facade?

**A.** Translate subsystem-specific errors to domain errors. Don't let `StripeException` or `JpaException` leak past the Facade. Document failure semantics (which side effects rolled back).

### Q17. What is "BFF" and how does it relate to Facade?

**A.** Backend-for-Frontend: a Facade tailored to a specific client (mobile, web, partner). Different clients get different shapes from the same underlying subsystem. It's Facade scaled to a deployment unit.

### Q18. How do you migrate from scattered orchestration to a Facade?

**A.** (1) Identify duplicated orchestration sequences. (2) Extract a Facade method with a focused signature. (3) Migrate one call site per PR. (4) Delete duplicated code. (5) Lock the boundary with linting or docs.

### Q19. Should Facade methods be async or sync?

**A.** Match the underlying subsystem's nature. If subsystems are async (network calls), Facade should be async to allow concurrency. If subsystems are sync (in-memory), sync is fine. Don't mix.

### Q20. What happens when the Facade signature needs to change?

**A.** Treat it as a public API. Backward-compatible adds (new optional parameters) are easy. Breaking changes need versioning (`OrderApiV1`, `OrderApiV2`), deprecation cycles, and migration guides.

---

## Senior Questions

### Q21. How does Facade relate to API Gateway?

**A.** API Gateway is Facade at distributed-system scale. The gateway routes, authenticates, rate-limits, aggregates, and translates protocols across many backend services. Same pattern, deployed as a service instead of a class.

### Q22. When does a Facade need to handle distributed-transaction semantics?

**A.** When orchestrating writes across services that aren't in one transaction. Patterns: synchronous compensation (Facade catches failures and rolls back), saga (orchestrator pattern with compensating actions), outbox (write intent atomically; async processor handles the rest).

### Q23. How do you handle backward compatibility in a published Facade SDK?

**A.** Strict semver. Breaking changes go in major versions. Deprecation cycles (mark, warn, remove) with documented timelines. Keep the old method working alongside the new one for a release or two.

### Q24. How do you design a Facade for high throughput?

**A.** Avoid lock contention; cache static dependencies (regex, configs); pre-allocate; reuse pools (DB, HTTP); parallelize independent subsystem calls; profile to find hot loops.

### Q25. What's the trade-off of putting auth at the Facade vs the subsystem?

**A.** At the Facade: single point of policy, easier to reason about. At the subsystem: defense-in-depth (every entry point checks). Most real systems do both: Facade enforces; subsystem also checks (zero-trust).

### Q26. How does Facade affect observability?

**A.** Naturally a great place for metrics, logging, tracing — one location captures the use case's start, success/failure, and duration. Don't bury observability inside subsystem services if the use case context lives at the Facade.

### Q27. What's the role of Facade in DDD?

**A.** DDD's **Application Layer** is essentially a collection of Facades — each use case (e.g., `PlaceOrder`) is a Facade method orchestrating Domain (entities, aggregates) and Infrastructure (DB, queue, third-party).

### Q28. How does Facade interact with idempotency?

**A.** The Facade is a natural place to generate / propagate idempotency keys. If `placeOrder` is called twice with the same key, the Facade returns the original result without re-executing. Underlying subsystems may need their own idempotency support; the Facade coordinates.

### Q29. When does a Facade become a bottleneck?

**A.** When it serializes calls that could be parallel; when it does too much work in the request path; when it lacks caching; when its code path acquires a contended lock. Profile, parallelize, cache, optimize.

### Q30. How do you handle versioning when a Facade is consumed by multiple teams?

**A.** Treat as a versioned public API. Document supported versions, sunset dates, breaking change policy. Provide a CI tool (compatibility checker) that fails if signatures break. Tag releases; track which clients are on which version.

---

## Professional Questions

### Q31. What's the per-call overhead of a Facade in Java?

**A.** Effectively zero for monomorphic, warm sites — HotSpot inlines the call. The Facade method body is fused into the caller. Subsystem calls within the Facade are also inlined where possible (up to MaxInlineLevel = 9).

### Q32. How does async fan-out in a Facade affect latency?

**A.** Parallelizing N subsystem calls reduces latency from sum to max. Cost: N × thread-pool dispatch (~5 μs each on JVM). Worth it when each inner call > 1 ms; below that, sequential is faster.

### Q33. What's the cost of DTO allocation at the Facade boundary?

**A.** Per-DTO allocation is ~50 ns (Java) / ~30 ns (Go) / ~500 ns (Python). At 100k QPS, the GC pressure becomes measurable. Mitigations: records, structs, pooled buffers, lazy mapping.

### Q34. How does CHA help Facade dispatch?

**A.** Class Hierarchy Analysis lets HotSpot prove that only one implementation of an interface exists (e.g., one `OrderService` in the application). Combined with `final` and sealed types, the JIT devirtualizes — direct call, fully inlinable.

### Q35. What's a performance pitfall in distributed Facades?

**A.** Sequential calls when parallel would work. Each network hop is 1-50 ms; serial three-step Facade is 3× one-hop. Use `CompletableFuture.allOf` (Java), `goroutines + sync.WaitGroup` (Go), `asyncio.gather` (Python).

### Q36. How does connection pooling affect Facade design?

**A.** A Facade that holds a connection pool must be a singleton (or at least long-lived). Per-request Facades that create their own pool waste TLS handshakes; reuse pools across requests via DI / static field.

### Q37. How do you measure Facade overhead?

**A.** JMH (Java) / `testing.B` (Go) / `pytest-benchmark` (Python). Compare direct subsystem call vs Facade call; ensure realistic subsystem behavior; warm up. The overhead is usually unmeasurable; the *content* of the Facade dominates.

### Q38. What's a "saga" and when does a Facade need one?

**A.** A long-running transaction across services with compensating actions on failure. A Facade needs saga semantics when its orchestration spans services not under a single transaction (microservices). Implement with synchronous compensation (simple) or an orchestrator service (robust at scale).

### Q39. How does a Facade interact with caching layers?

**A.** Facade is often the right place to cache results — it knows the use case and dependencies. Cache at the Facade is granular and invalidation is tractable. Caching inside subsystem services can leak across use cases and is harder to invalidate.

### Q40. What allocations should you watch for in a high-traffic Facade?

**A.** Per-call DTOs, lambdas, and closures (Java); per-call slices and maps (Go); per-call dicts (Python). Pre-allocate where possible; reuse buffers in tight loops; use structured logging APIs that don't allocate per call.

---

## Coding Tasks

### Task 1: HomeTheater Facade (Go)

```go
type HomeTheater struct{ tv TV; receiver Receiver; lights Lights }

func (h HomeTheater) WatchMovie() {
    h.lights.Dim(20)
    h.tv.On(); h.tv.SetSource("HDMI1")
    h.receiver.On(); h.receiver.SetVolume(50)
}

func (h HomeTheater) EndMovie() {
    h.receiver.Off(); h.tv.Off(); h.lights.On()
}
```

---

### Task 2: OrderService Facade (Java)

```java
public class OrderService {
    private final InventoryService inv;
    private final PaymentProcessor pay;
    private final OrderRepository orders;

    public Order placeOrder(PlaceOrderCommand cmd) {
        var reservation = inv.reserve(cmd.items());
        try {
            var receipt = pay.charge(cmd.userId(), cmd.total(), cmd.paymentMethod());
            return orders.save(new Order(cmd.userId(), cmd.items(), receipt));
        } catch (Exception e) {
            inv.cancel(reservation);
            throw e;
        }
    }
}
```

---

### Task 3: Compiler Facade (Python)

```python
class Compiler:
    def __init__(self, lexer, parser, optimizer, codegen):
        self._lexer, self._parser, self._optimizer, self._codegen = lexer, parser, optimizer, codegen

    def compile(self, source: str) -> bytes:
        tokens = self._lexer.tokenize(source)
        ast = self._parser.parse(tokens)
        ast = self._optimizer.optimize(ast)
        return self._codegen.emit(ast)
```

---

### Task 4: HTTP Facade with retries (Go)

```go
type Http struct{ pool *http.Client; retries int }

func (h *Http) Get(ctx context.Context, url string) ([]byte, error) {
    var lastErr error
    for i := 0; i < h.retries; i++ {
        req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
        res, err := h.pool.Do(req)
        if err != nil { lastErr = err; continue }
        defer res.Body.Close()
        if res.StatusCode >= 500 { lastErr = fmt.Errorf("status %d", res.StatusCode); continue }
        return io.ReadAll(res.Body)
    }
    return nil, lastErr
}
```

---

### Task 5: BFF aggregating multiple services (TypeScript)

```ts
class MobileBff {
    constructor(
        private orders: OrderClient,
        private user: UserClient,
        private recs: RecsClient,
    ) {}

    async homepage(userId: string): Promise<HomepageDto> {
        const [profile, recent, recommendations] = await Promise.all([
            this.user.profile(userId),
            this.orders.recent(userId, 5),
            this.recs.forUser(userId, 10),
        ]);
        return {
            displayName: profile.name,
            recentOrderIds: recent.map(o => o.id),
            recommended: recommendations.map(r => ({ id: r.id, title: r.title })),
        };
    }
}
```

---

## Trick Questions

### Q41. "Isn't every service class a Facade?"

**A.** Many are, structurally. The pattern names the *intent*: simplification of a subsystem. Calling a class a "Facade" tells reviewers "this should stay focused; don't add unrelated methods."

### Q42. "Can a Facade extend a subsystem class?"

**A.** Technically yes; usually no. Composition (holding subsystem classes as fields) is the conventional approach. Inheritance leaks subsystem methods into the Facade's API — opposite of simplification.

### Q43. "If my Facade method is just `subsystem.x()`, is it still a Facade?"

**A.** A single passthrough is just a wrapper, not Facade. Facade earns its name by *simplifying* — orchestrating multiple steps, picking defaults, hiding complexity.

### Q44. "Can Facade be a Singleton?"

**A.** Sure — many Facades are singletons. It's combining two patterns: Singleton for the lifecycle, Facade for the simplification.

### Q45. "Why not just put everything in one big class?"

**A.** Because the subsystem itself is well-decomposed. Facade is a *front* for the decomposed subsystem. A monolithic class loses the internal modularity, testability, and team ownership.

---

## Behavioral / Architectural Questions

### Q46. "Tell me about a time you used Facade."

**A.** *STAR:* Situation (a third-party payment SDK with 12 setup calls before a charge could happen, used in 80 places). Task (reduce coupling and simplify). Action (built `PaymentService` Facade with `charge(...)` method; migrated all callers). Result (vendor migration to Adyen took 2 days instead of weeks; fewer bugs from setup mistakes).

### Q47. "How do you decide between adding to an existing Facade or creating a new one?"

**A.** Look at audience and task. If it's the same audience doing a related task, add. If it's a new audience or unrelated task, create a new Facade. The test: "does adding this method dilute the Facade's purpose statement?"

### Q48. "When did you decide *not* to use Facade?"

**A.** A teammate proposed a Facade for our internal HTTP wrapper. The wrapper was already 15 lines; a Facade would just rename methods. We left it as-is. Pattern needs a real subsystem to simplify.

### Q49. "Your team's Facade has 40 methods. What do you do?"

**A.** Audit by audience and use case. Extract per-audience Facades (Customer, Admin, Reporting). Move methods to the right one. Keep the legacy class as a deprecated forward to the new ones during migration. Communicate widely.

### Q50. "How do you balance Facade simplification with caller flexibility?"

**A.** Default to the common case; expose a "raw" path for power users. Document both. The Facade is the recommended path; the subsystem is the escape hatch. Don't lock callers into the Facade unless the subsystem is truly internal.

---

## Tips for Answering

1. **Lead with "simplifying entry point to a complex subsystem."** That's the headline.
2. **Bring real examples.** `requests`, AWS SDK, `git`, OrderService. Pick one familiar.
3. **Distinguish from siblings.** Adapter (interface change), Mediator (object coordination), Service Layer (collection of Facades).
4. **Discuss when NOT to use it.** "If the subsystem is already simple, Facade is ceremony."
5. **Show senior signals.** Mention API Gateway, BFF, DDD Application Layer when discussing scale.
6. **Talk about what doesn't go in a Facade.** Business logic, subsystem types in the API, swallowed errors.
7. **Code: keep it small.** A single Facade with 3-4 orchestration steps is enough to demonstrate understanding.

---

← Back to Facade folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Facade — Hands-On Tasks](tasks.md)
