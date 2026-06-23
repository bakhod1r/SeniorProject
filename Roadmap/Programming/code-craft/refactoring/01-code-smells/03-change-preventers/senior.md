# Change Preventers — Senior Level

> Focus: architectural diagnosis, code generation, hotspot analysis, and migration patterns.

---

## Table of Contents

1. [Diagnosing change patterns](#diagnosing-change-patterns)
2. [Hotspot and co-change analysis](#hotspot-and-co-change-analysis)
3. [Architectural Change Preventers](#architectural-change-preventers)
4. [Schema-driven design as Shotgun Surgery cure](#schema-driven-design-as-shotgun-surgery-cure)
5. [Domain-Driven Design and Bounded Contexts](#domain-driven-design-and-bounded-contexts)
6. [Migrating away from Divergent Change](#migrating-away-from-divergent-change)
7. [Aspect-Oriented Programming for cross-cutting concerns](#aspect-oriented-programming-for-cross-cutting-concerns)
8. [Code-review heuristics](#code-review-heuristics)
9. [Review questions](#review-questions)

---

## Diagnosing change patterns

The most reliable diagnostic for Change Preventers is **measuring how the codebase actually changes**.

### Tools

- **`code-maat`** (Adam Tornhill): Java tool that mines git history for hotspots, change coupling, and complexity-by-author.
- **`git-of-theseus`**: tracks how files age and which engineers contribute.
- **CodeScene**: commercial tool combining all of the above.
- **Custom shell scripts**: `git log --pretty='%H' --name-only` parsed with awk/Python.

### The metrics that matter

| Metric | Catches |
|---|---|
| Change frequency per file | Hotspots (files that need refactoring most) |
| Number of distinct authors per file | Files needing better ownership |
| Co-change matrix (which files always change together) | Shotgun Surgery |
| Commit-message diversity per file | Divergent Change |
| Complexity × change frequency | Refactor priority |

### Example shell pipeline

```bash
# Top 20 files by change frequency in the last year
git log --since='1 year ago' --pretty=format: --name-only | \
  grep -v '^$' | sort | uniq -c | sort -nr | head -20
```

A 2,000-line file at the top of this list is a Divergent Change candidate (or a legitimate boundary class — investigate).

```bash
# Co-change: which files appear together in commits
git log --since='1 year ago' --pretty=format:'==%H==' --name-only | \
  awk '/^==/{c=$0} /^[^=]/{f[c]=f[c]" "$0} END{for (k in f) print f[k]}' | \
  awk '{for(i=1;i<=NF;i++)for(j=i+1;j<=NF;j++)print $i" "$j}' | \
  sort | uniq -c | sort -nr | head -20
```

Pairs of files always changing together: Shotgun Surgery candidates.

---

## Hotspot and co-change analysis

### The 80/20 of refactoring

Studies (Tornhill, *Your Code as a Crime Scene*) repeatedly show:
- **80% of bug-causing changes** happen in **20% of files**.
- Hotspot files combine **high change frequency** with **high complexity**.

Refactoring priorities should follow this distribution. A 5,000-line stable class is *not* the priority. A 500-line file modified 200 times in the last year is.

### Co-change as a refactoring signal

If files A and B always change together but neither is "owned" by the other, two cures:

1. **Merge them** (Inline Class) — they're really one concept.
2. **Find the shared abstraction** — what about A's interface forces B to change? Extract it.

### Worked example

```
fileA  fileB   count
Customer.java  CustomerDto.java  47
Customer.java  CustomerEntity.java  43
Customer.java  CustomerMapper.java  38
```

Customer-* files all change together. The cause is duplication of structure across layers. Cure: code generation, or consolidating into fewer types.

---

## Architectural Change Preventers

The same smells appear at the architectural level:

| Code-level | Architectural |
|---|---|
| Divergent Change | A microservice touched in PRs about identity, billing, notifications — multiple bounded contexts squashed into one service |
| Shotgun Surgery | One feature change requires deploying 5 microservices in coordination |
| Parallel Inheritance | Each microservice has parallel `Customer` definitions / parallel "service-per-aggregate" structures |

### "Distributed monolith" — the architectural Shotgun Surgery

Microservices that look independent but **always have to deploy together** to release a feature. Symptoms:
- Release notes always span 3+ services.
- Backwards-incompatible changes propagate across the mesh.
- Service boundaries don't align with team boundaries.

**Cure:** redraw service boundaries along *changeability* lines, not data lines. Conway's Law: services should reflect team structure. If two teams must coordinate every release, they should be one team — or the services should be merged.

### Service per use case, not per entity

A service named `OrderService` that does `placeOrder`, `cancelOrder`, `refundOrder`, `shipOrder` is service-per-aggregate. It's a Divergent Change waiting to happen because the four operations evolve independently.

A `PlaceOrderService`, `CancelOrderService`, `RefundService`, `ShippingService` (services per use case) localizes change. Each is small, owned by one team, deployed independently.

> **Heuristic:** if your service has more than ~7 endpoints with unrelated reasons to change, split it.

---

## Schema-driven design as Shotgun Surgery cure

When a single concept lives in many representations, code generation is the cure.

### Tools by language

| Tool | Generates from |
|---|---|
| **MapStruct** | Java interface annotations → mappers |
| **Lombok** | Java annotations → boilerplate |
| **Records** (Java 16+) | Compact syntax → equals/hashCode/toString |
| **Pydantic v2** | Python type hints → validators, schemas, JSON serializers |
| **dataclass** + `@dataclass_json` (Python) | Python class → JSON serializer |
| **Protobuf + protoc** | `.proto` file → multi-language types |
| **Avro + avrohugger** | `.avsc` → Java/Scala/Python types |
| **OpenAPI + openapi-generator** | OpenAPI YAML → client/server code |
| **GraphQL + codegen** | GraphQL schema → typed resolvers/clients |
| **JSON Schema + quicktype** | JSON Schema → typed code in many languages |
| **TypeScript** | One source of truth via type system |

### When code generation is *not* the answer

- The "duplication" isn't structural — different layers have different *semantics*. Generation creates wrong types.
- The team can't manage a build-time generator (they aren't familiar with annotation processors, code-gen build steps).
- The generated code obscures behavior. Engineers debugging should be able to step through; if generated code is opaque, debugging is painful.

For most modern teams, generation is worth it. For small projects, hand-written + a strong test suite may be enough.

---

## Domain-Driven Design and Bounded Contexts

DDD provides vocabulary for diagnosing Change Preventers at architectural scale.

### Bounded Context

A **Bounded Context** is a logically consistent area of the domain where terms and concepts have unambiguous meaning. Within a context, "Customer" means one thing. Across contexts, "Customer" may mean different things (a Sales context's Customer is a lead; an Operations context's Customer is a logistics endpoint).

Failures:
- A god class spanning multiple contexts → Divergent Change at code level, distributed-monolith at architectural level.
- "One canonical Customer" across the whole company → Shotgun Surgery (every team's needs forced into one model).

### Anti-Corruption Layer (ACL)

When two bounded contexts must talk, an ACL translates between their models. The ACL is itself a small focused class (or service) — it's not Shotgun Surgery, it's an explicit boundary.

### Worked example

A B2B SaaS:
- **Identity context:** Users, roles, permissions.
- **Billing context:** Customers (= entities being billed), subscriptions, invoices.
- **Support context:** Customers (= people contacting support), tickets, escalations.

A god `Customer` class would conflate three contexts. Splitting along the contexts gives three smaller models, each owned by a team, each evolving independently. ACLs translate when needed.

---

## Migrating away from Divergent Change

### Step-by-step

1. **Diagnose:** confirm Divergent Change with git history (multiple unrelated commits per month).
2. **Map responsibilities:** list what the class does. Group by who-changes-it-for-what-reason.
3. **Extract one cluster at a time:** start with the cluster with fewest dependencies on the others.
4. **Migrate callers:** route calls to the new class.
5. **Repeat** until the original class is small (1-2 cohesive responsibilities) or empty.

### Branch by abstraction

For a god class with many users:
1. Define an interface representing what callers need.
2. Make the god class implement the interface.
3. Make callers depend on the interface.
4. Replace the god class with smaller implementations behind the interface.
5. Eventually, callers only know the interface; the god class is gone.

### Strangler fig

Wrap the god class in a new facade. Route new use cases to clean implementations behind the facade. Migrate old callers gradually. The god class shrinks until it's empty.

---

## Aspect-Oriented Programming for cross-cutting concerns

Cross-cutting concerns (logging, security, transactions, retries, audit) inevitably touch many classes. Without AOP, they manifest as Shotgun Surgery (changing the format = touching every method).

### Spring AOP / AspectJ (Java)

```java
@Aspect
@Component
public class LoggingAspect {
    @Around("execution(* com.example.service.*.*(..))")
    public Object logMethod(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.nanoTime();
        try {
            return pjp.proceed();
        } finally {
            long elapsed = System.nanoTime() - start;
            log.info("Method {} took {}ns", pjp.getSignature().toShortString(), elapsed);
        }
    }
}
```

One aspect applies logging to all service methods. Changing the log format = one place to edit.

### Decorators (Python, TypeScript)

```python
def with_retry(times=3):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            for i in range(times):
                try: return fn(*args, **kwargs)
                except TransientError:
                    if i == times - 1: raise
        return wrapper
    return decorator

@with_retry(times=5)
def fetch_data(url): ...
```

### Middleware (HTTP frameworks)

```javascript
app.use(authenticate);  // applies to all routes
app.use(rateLimit({max: 100}));
app.use(logRequest);
```

The right tool turns "edit every endpoint" into "edit one middleware."

---

## Code-review heuristics

Reviewers should flag:

- **Adding to an already-large file** — if the file has 500+ lines, ask "should this go in a new file?"
- **A PR touching 8+ files for one logical change** — Shotgun Surgery; suggest consolidation.
- **A new repository "manager" or "service" without clear single responsibility.**
- **Manual mappers between domain and DTO** when the project has a mapper-generation tool.
- **A new subclass that mirrors another hierarchy 1:1** — Parallel Inheritance candidate.

---

## Review questions

1. **A team's hotspot analysis shows `UserService.java` is the #1 hotspot. Plan?**
   Read the recent commits. If they cover unrelated topics, it's Divergent Change — extract focused services. If they're all about the same feature, the file may just be in a hot product area; refactoring is less urgent. Compare with co-change: are co-changing files showing patterns?

2. **MapStruct vs hand-written mappers — when is hand-written right?**
   When the mappings are non-trivial and require custom logic per field. MapStruct excels at field-by-name copies; complex transformations need hand code anyway. Hybrid: MapStruct for the simple parts, manual additions for complex.

3. **A microservice has 30 endpoints. Divergent Change?**
   Likely. 30 endpoints typically span multiple use cases (read paths, write paths, admin paths, sync paths). Examine: are they really all related? Often you can extract a "batch processing" subservice or an "admin API" subservice.

4. **Does Conway's Law mean every team needs its own service?**
   Roughly yes — services should mirror team boundaries. Two teams sharing a service means coordinated deploys, conflicting priorities, blurred ownership. The corollary: if you have one team owning two services that always deploy together, merge them.

5. **A team complains that their codebase has Shotgun Surgery. Where to start?**
   Co-change analysis. Find the top 5 file-pairs that change together. For each, diagnose: duplicated code (Extract), cross-cutting (AOP), or layer scatter (code generation). Cure one pair at a time.

6. **DDD is heavyweight — when to skip it?**
   For genuinely simple CRUD apps with no complex business rules. The DDD machinery (aggregates, repositories, value objects, bounded contexts, ACLs) is overhead unless the domain is rich enough to benefit. For a todo app, plain MVC is fine.

7. **Strangler fig vs branch-by-abstraction for migrating away from a god service?**
   Strangler fig: route new use cases away; migrate old ones gradually. Time scale: months. Branch-by-abstraction: introduce an interface, switch impls behind a flag. Time scale: weeks. Strangler fig for service-level migrations; branch-by-abstraction for class-level.

8. **AOP can replace Shotgun Surgery, but is it overused?**
   Yes when used for logic that's *not* truly cross-cutting (business rules, validation). Overusing AOP creates the "spooky action at a distance" anti-pattern — code behavior depends on aspects you can't see in the file. Use AOP only for genuinely cross-cutting concerns.

9. **Generated code vs hand-written — debugger pain?**
   Modern IDEs handle generated code well (step through generated code, breakpoints work). The bigger risk is *understanding* generated code — can a new engineer debug a Spring AOP failure? If your team isn't comfortable with the generation tool, prefer hand-written until they level up.

10. **Open/Closed Principle says "closed for modification." Doesn't refactoring violate that?**
    No. OCP is about extending behavior — adding a new variant should not require modifying the existing variants. Refactoring restructures the code while preserving behavior. The two are orthogonal: OCP is a design property; refactoring is an editing activity.

---

> **Next:** [professional.md](professional.md) — runtime cost of cross-cutting cures (AOP, decorators) and code generation overhead.
