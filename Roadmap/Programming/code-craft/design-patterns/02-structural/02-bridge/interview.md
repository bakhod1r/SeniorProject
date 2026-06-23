# Bridge — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/bridge](https://refactoring.guru/design-patterns/bridge)

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

### Q1. What is the Bridge pattern?

**A.** A structural pattern that splits a class — or a tightly coupled set of classes — into two separate hierarchies (an *abstraction* and an *implementation*) connected by composition, so each can vary independently.

### Q2. What problem does Bridge solve?

**A.** The class explosion that happens when two dimensions are modeled with inheritance: `N × M` subclasses for every combination of dimension A and dimension B. Bridge reduces it to `N + M`.

### Q3. Name the four roles.

**A.** **Abstraction** (`Shape`), **Refined Abstraction** (`Circle`, `Square`), **Implementor** (`Renderer`), **Concrete Implementor** (`VectorRenderer`, `RasterRenderer`).

### Q4. Why is the implementor injected, not constructed?

**A.** So callers can pick the implementor at runtime, swap it in tests, and let the abstraction stay agnostic of concrete classes.

### Q5. What's the difference between Bridge and Adapter?

**A.** Same shape (composition + interface), different intent and lifecycle. Bridge is *designed in* up-front to allow independent variation. Adapter is *applied after the fact* to retrofit incompatible APIs.

### Q6. What's the difference between Bridge and Strategy?

**A.** Strategy is one algorithm slot in one class; Bridge is a whole *family* of algorithms across a *hierarchy* of clients. If your `Renderer` had only one method and `Shape` were a single class, you'd be writing Strategy.

### Q7. Why is the name "Implementor" misleading?

**A.** Because in Java, "implementor" is the conventional word for a class that has `implements`. In Bridge, "Implementor" refers to the low-level operations *interface* — the thing the abstraction calls into. Mentally substitute "low-level operations interface."

### Q8. Give a real-world example of Bridge.

**A.** Logger × Sink. The `Logger` abstraction has `info()`, `error()`. The `Sink` implementor has `emit(level, msg)`. ConsoleSink and FileSink are concrete sinks. Adding a new sink (JSON, syslog) is one class.

### Q9. Can Bridge use multiple implementors?

**A.** Yes. A `Document` can hold both a `Renderer` and a `Storage`. The pattern's core idea is "split orthogonal dimensions"; two is the typical case, but more is possible.

### Q10. When should you NOT use Bridge?

**A.** When only one dimension actually varies; when there's only one implementor and there will only ever be one; when the two "dimensions" change together (not orthogonal); when you're solving a hypothetical future need.

---

## Middle Questions

### Q11. How do you recognize a Bridge opportunity?

**A.** Cross-product names like `WindowsCircle`, `LinuxCircle`. A class hierarchy that grows by every new feature. A feature matrix. A decision: "we want to support email *and* SMS *and* push *and* slack — for transactional *and* marketing *and* alert messages."

### Q12. How do you keep the implementor interface small?

**A.** Apply Interface Segregation. Start with the smallest set of methods the abstraction actually calls. Add methods deliberately, only when at least one concrete implementor needs them. If a method is no-op for some implementors, that's a signal to split.

### Q13. What's a three-hierarchy Bridge?

**A.** Three orthogonal dimensions: Notification × Channel × Provider. Apply Bridge twice nested — `Channel` is the implementor of `Notification` *and* the abstraction over `Provider`.

### Q14. How do you test a Bridge?

**A.** Two layers:
- **Abstraction tests** — fake the implementor (recording or in-memory) and assert behavior.
- **Implementor tests** — call each concrete implementor through a contract test suite that's identical across implementors.
This catches both bugs in the abstraction and divergence between implementors.

### Q15. What's a "stateful implementor" trap?

**A.** Sharing one stateful implementor across many abstractions creates thread-safety and lifecycle issues. Either make the implementor thread-safe, give one per abstraction, or pool them with explicit borrow/return.

### Q16. How do you refactor from class explosion to Bridge?

**A.**
1. List the cross-product subclasses; identify the two dimensions.
2. Extract the implementor interface from one dimension's varying behavior.
3. Add a field of the implementor interface to the abstraction's base class.
4. Replace each `<DimA><DimB>` subclass with `new A(new B())`.
5. Migrate call sites.
6. Delete the old subclasses.

### Q17. What happens when one dimension's interface needs vendor-specific extras?

**A.** Either expand the implementor interface so all implementors (possibly with no-ops) satisfy it, or split it (`BasicRenderer`, `StyledRenderer`). The second is usually cleaner.

### Q18. How does Bridge enable run-time swapping?

**A.** The implementor is held by reference. Replacing the field replaces the behavior. Combined with a registry or factory, you can pick the implementor by config, tenant, or feature flag.

### Q19. Bridge vs Strategy — give the rule of thumb.

**A.** If you have a hierarchy of clients (multiple Refined Abstractions) and a hierarchy of implementations, it's Bridge. If you have a single client class and a swappable algorithm, it's Strategy. Bridge = two hierarchies; Strategy = one.

### Q20. How does Bridge interact with DI containers?

**A.** Beautifully. The DI container injects the implementor based on configuration. Spring `@Profile`, .NET `[Service]`, Guice modules, Wire — all fit naturally. The abstraction declares `Renderer renderer` as a dependency; the container picks the implementation per environment.

---

## Senior Questions

### Q21. How does Bridge map to Hexagonal Architecture?

**A.** One-to-one at architectural scale. The application core is the abstraction; ports are the implementor interfaces; adapters are concrete implementors. "Ports and Adapters" is "Bridge applied to a whole bounded context."

### Q22. When should you collapse a Bridge?

**A.** When the second implementor never materialized after a year+ and you have no concrete plan for one. Inline the implementor's methods into the abstraction; delete the interface. Reverse the over-engineering — almost always cheap.

### Q23. How do you decide between Bridge and a tagged union (sum type)?

**A.** Bridge is for *open* extension — anyone can add a new implementor. Sum types are for *closed* sets — the variants are known at compile time. If you'll never add another implementor and you want exhaustive matching, use a sum type. If you want plug-in extensibility, use Bridge.

### Q24. How do you handle interface evolution in a Bridge with many implementors?

**A.** Backward-compatible additions go through default methods (Java) or interface-segregation expansions. Breaking changes need a versioning strategy: parallel interfaces, deprecation cycle, migration of one implementor at a time.

### Q25. What's the danger of the "lowest common denominator" implementor interface?

**A.** Vendor-specific power is hidden. You get *only* the operations every implementor supports; specialization is unreachable. Mitigation: capability-segregated interfaces (`AdvancedRenderer extends Renderer`) and feature detection at the abstraction level.

### Q26. How does Bridge interact with cross-cutting concerns (caching, retries, metrics)?

**A.** Wrap the implementor in Decorators. The abstraction sees an unchanged `Renderer`; the decorator stack adds caching/retries/metrics around the concrete implementor. Same approach as Adapter — keep the bridge interface clean.

### Q27. Multi-tenant SaaS — Bridge or feature flags?

**A.** Both. Bridge for orthogonal capabilities (per-tenant tax engine, currency handler). Feature flags for binary toggles within a tenant. Don't conflate: feature flags inside the abstraction lead to spaghetti; per-tenant Bridge keeps the logic in the right implementor.

### Q28. How do you choose the cut between abstraction and implementor?

**A.** Look at *what changes together*. If a change always affects both Shape and Renderer, the cut is wrong. If you can confidently say "Renderer can change without touching Shape" and vice versa, the cut is good. Wrong cuts are reversible but expensive.

### Q29. Bridge in plug-in architectures — what's the contract?

**A.** A stable, documented, versioned implementor interface. Backward compatibility is non-negotiable; breaking changes mean breaking every plug-in. Provide a sample plug-in, contract tests, and a clear extension surface (e.g., `register(plugin)`).

### Q30. How do you measure if your Bridge is "paying for itself"?

**A.** Count: how many implementors of side B exist for the same side A? If 1, the bridge has cost without benefit. If 3+, it's earning. Also check: how often do you ship without touching one side? If always touching both, the dimensions weren't orthogonal.

---

## Professional Questions

### Q31. What's the JVM cost of Bridge dispatch?

**A.** After warmup at a monomorphic site: zero — HotSpot inlines both hops. At a polymorphic site (2 receivers): still cheap with PIC. Megamorphic (3+ receivers at *both* sides): real cost, ~5-10× monomorphic. Mitigations: group by type, mark concrete classes `final`, use CHA-friendly code shapes.

### Q32. How does Class Hierarchy Analysis help Bridge?

**A.** If HotSpot can prove only one class implements the implementor interface (e.g., monomorphic deployment), it devirtualizes the call → direct call → inlinable. `final` classes and sealed type hierarchies (Java 17+) help the analysis.

### Q33. What's the Go cost?

**A.** ~3-4 ns per hop, no inlining. Two-hop Bridge ≈ 6-8 ns/call. For business code, invisible. For per-pixel rendering, real — that's why graphics code uses concrete types in inner loops.

### Q34. What's the Python cost?

**A.** ~150-300 ns/call total through Bridge (depending on attribute caching state). 2-3× direct call. Acceptable for I/O-bound code; rewrite in NumPy/Cython for inner loops.

### Q35. What allocations are involved in a Go Bridge call?

**A.** None per call if the bridge is held in a struct and the implementor is a pointer. Allocation happens only at construction. Be careful with ad-hoc interface conversions in loops — they can copy a value type onto the heap.

### Q36. How does megamorphism affect Bridge?

**A.** Worst case: both sides polymorphic at the same call site. The PIC fails on both, every call hits the vtable, branch prediction degrades. Mitigations: partition iteration by type, denormalize hot paths, profile-guided specialization.

### Q37. What's "data-oriented Bridge"?

**A.** Instead of array-of-pointers-to-bridges, use struct-of-arrays where each abstraction's data is laid out contiguously. Dispatch once per batch (e.g., "render all circles with vector renderer"). Used in game engines and ECS. Keeps the abstraction logically but gets cache-friendly memory access.

### Q38. How do you debug a slow Bridge call site?

**A.** Profile (perf, async-profiler, pprof). Inspect inline cache state (HotSpot: `-XX:+PrintInlining`, `-XX:+PrintCompilation`; Go: `pprof` and `go tool objdump`). Look at megamorphism, allocations, branch mispredictions. Most "slow Bridge" complaints are actually slow implementors.

### Q39. How do escape analysis and Bridge interact?

**A.** If a Bridge instance is built and used within a method, EA can stack-allocate it — both the abstraction and implementor become inlined fields. The bridge dispatch then erases. Brittle (a debugger or `synchronized` block can disable), but powerful for short-lived bridges.

### Q40. Bridge in distributed systems — what's the latency story?

**A.** Network dwarfs all dispatch cost. The Bridge layer adds local overhead in the nanoseconds; one network call is milliseconds. Optimize at the call shape (batching, caching, parallelism), not the bridge.

---

## Coding Tasks

### Task 1: Notification × Channel (Go)

```go
type Channel interface {
    Send(to, subject, body string) error
}

type EmailChannel struct{}
func (EmailChannel) Send(to, subject, body string) error {
    fmt.Printf("EMAIL %s | %s | %s\n", to, subject, body); return nil
}

type SmsChannel struct{}
func (SmsChannel) Send(to, subject, body string) error {
    fmt.Printf("SMS %s | %s\n", to, subject + " " + body); return nil
}

type Notification struct{ ch Channel }

type Welcome struct { Notification }
func (w Welcome) Send(to string) { w.ch.Send(to, "Welcome!", "Glad to have you.") }

type Receipt struct { Notification; amt float64 }
func (r Receipt) Send(to string) { r.ch.Send(to, "Receipt", fmt.Sprintf("Amount: %.2f", r.amt)) }
```

---

### Task 2: Logger × Sink (Java)

```java
public interface Sink { void write(String level, String msg); }

public class ConsoleSink implements Sink {
    public void write(String level, String msg) { System.out.printf("[%s] %s%n", level, msg); }
}

public class FileSink implements Sink {
    private final Path path;
    public FileSink(Path p) { this.path = p; }
    public void write(String level, String msg) {
        try { Files.writeString(path, "[" + level + "] " + msg + "\n", StandardOpenOption.APPEND); }
        catch (IOException e) { throw new UncheckedIOException(e); }
    }
}

public abstract class Logger {
    protected final Sink sink;
    protected Logger(Sink s) { this.sink = s; }
    public abstract void info(String msg);
}

public class StructuredLogger extends Logger {
    public StructuredLogger(Sink s) { super(s); }
    public void info(String msg) { sink.write("INFO", "{\"msg\":\"" + msg + "\"}"); }
}
```

---

### Task 3: Repository × Storage (Python)

```python
from abc import ABC, abstractmethod

class Storage(ABC):
    @abstractmethod
    def save(self, key: str, value: dict) -> None: ...
    @abstractmethod
    def load(self, key: str) -> dict | None: ...

class InMemoryStorage(Storage):
    def __init__(self): self._d = {}
    def save(self, k, v): self._d[k] = v
    def load(self, k): return self._d.get(k)

class FileStorage(Storage):
    def __init__(self, root): self._root = root
    def save(self, k, v):
        import json, os, pathlib
        p = pathlib.Path(self._root) / f"{k}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(v))
    def load(self, k):
        import json, pathlib
        p = pathlib.Path(self._root) / f"{k}.json"
        return json.loads(p.read_text()) if p.exists() else None

class Repository:
    def __init__(self, storage: Storage): self._s = storage

class UserRepository(Repository):
    def register(self, name: str, email: str) -> str:
        from uuid import uuid4
        uid = str(uuid4())
        self._s.save(uid, {"name": name, "email": email})
        return uid
    def by_id(self, uid: str): return self._s.load(uid)
```

---

### Task 4: Refactor a class explosion (Java)

> Given: `WindowsButton`, `LinuxButton`, `WindowsCheckbox`, `LinuxCheckbox`. Refactor.

**Solution:**

```java
public interface Platform { void render(Widget w); void onClick(Widget w); }
public class WindowsPlatform implements Platform { ... }
public class LinuxPlatform implements Platform { ... }

public abstract class Widget {
    protected final Platform platform;
    protected Widget(Platform p) { this.platform = p; }
    public abstract void render();
}
public class Button extends Widget { public Button(Platform p) { super(p); } public void render() { platform.render(this); } }
public class Checkbox extends Widget { public Checkbox(Platform p) { super(p); } public void render() { platform.render(this); } }
```

4 classes → 6 (3 + 3 -1 for the abstract base). Adding macOS: 1 class. Adding Slider: 1 class.

---

### Task 5: Three-hierarchy Bridge (Java)

> Notification × Channel × Provider, two bridges nested.

```java
public interface Provider { void deliver(Envelope e); }
public class TwilioProvider implements Provider { public void deliver(Envelope e) { ... } }
public class MailgunProvider implements Provider { public void deliver(Envelope e) { ... } }

public abstract class Channel {
    protected final Provider p;
    protected Channel(Provider p) { this.p = p; }
    public abstract void send(String to, String subject, String body);
}
public class SmsChannel extends Channel { public SmsChannel(Provider p) { super(p); } public void send(String t, String s, String b) { p.deliver(new Envelope(t, b)); } }
public class EmailChannel extends Channel { public EmailChannel(Provider p) { super(p); } public void send(String t, String s, String b) { p.deliver(new Envelope(t, s + "\n" + b)); } }

public abstract class Notification {
    protected final Channel c;
    protected Notification(Channel c) { this.c = c; }
    public abstract void send(String to);
}
public class Welcome extends Notification {
    public Welcome(Channel c) { super(c); }
    public void send(String to) { c.send(to, "Welcome!", "Hello there."); }
}
```

---

## Trick Questions

### Q41. "Is Bridge just two classes connected by composition? Why even name it?"

**A.** Most patterns are "X classes connected by Y." Names exist to flag *intent*. "Bridge" tells a reader: "this composition exists to prevent class explosion across two dimensions, and either side can grow."

### Q42. "If I never swap the implementor, isn't Bridge useless?"

**A.** Not necessarily — testability alone justifies it (you swap to a fake in tests). But yes, if you never swap *and* never test through fakes, you've over-engineered. Collapse the bridge.

### Q43. "Can Bridge work with no abstraction hierarchy?"

**A.** If `Shape` is concrete (no subclasses) and only `Renderer` varies, you have **Strategy**, not Bridge. Bridge requires both sides to be (or to grow into) hierarchies.

### Q44. "What if both my abstractions and implementors are sealed (closed) sets?"

**A.** Sum types / pattern matching might be cleaner, with exhaustiveness checking by the compiler. Bridge shines when one side is open for extension.

### Q45. "Is Bridge an antipattern?"

**A.** No — but mis-applied Bridge is. The classic antipattern is "Bridge for hypothetical future swap that never happens." Use only when both sides actually vary.

---

## Behavioral / Architectural Questions

### Q46. "Tell me about a time you used Bridge in production."

**A.** *STAR:* Situation (we needed to support Postgres and an in-memory test backend for the same repository). Task (avoid duplicating repository logic). Action (extracted `UserStorage` interface, made `UserRepository` hold it, wired Postgres in prod and in-memory in tests). Result (test runtime dropped 90%, integration tests stayed clean, adding Redis as a third backend was 1 class).

### Q47. "When did you decide *not* to use Bridge?"

**A.** A teammate proposed `PaymentMethod` × `Currency` as a Bridge. I pushed back: currency isn't a behavior dimension — it's a value. Currency belongs as a parameter, not a parallel hierarchy. Bridge would have invented complexity.

### Q48. "How do you explain Bridge to a junior?"

**A.** Show the class explosion problem first ("if we had 5 shapes and 3 platforms, that's 15 classes — plus 5 every new platform and 3 every new shape"). Then show the Bridge: 5 + 3, plus 1 each. They get it instantly.

### Q49. "An old codebase has Bridge everywhere, including for things with one implementor. What do you do?"

**A.** Audit: count implementors per interface. Anything with 1 implementor for >12 months and no plans → collapse. Be willing to delete code; the absence of a future swap is data.

### Q50. "How do you decide between Bridge and Hexagonal Architecture for a new service?"

**A.** Same answer at different scales. If you're designing one module that needs a swappable backend, write Bridge. If you're designing a service whose entire boundary needs swappable I/O (DB, MQ, HTTP), make it Hexagonal — same pattern, broader scope, with conventions about packaging and testing.

---

## Tips for Answering

1. **Lead with the class-explosion frame.** "Bridge solves the N×M problem when two dimensions vary independently."
2. **Distinguish from siblings.** Adapter (reactive), Strategy (single-slot), State (state-driven swap). Have one-line distinctions ready.
3. **Bring an example.** Logger × Sink, Notification × Channel, Repository × Storage. Pick one you've shipped.
4. **Show the cut decision.** Senior signal: "I split on platform vs widget because changes never spanned both." Don't say "we used Bridge"; say "we cut the dimensions on X."
5. **Discuss when NOT to use it.** Knowing the failure modes shows maturity.
6. **Map to Hexagonal at architectural questions.** It's the same pattern; making the connection is a senior signal.
7. **Don't over-engineer in coding tasks.** A clean two-hierarchy split with one Refined Abstraction and two Concrete Implementors is enough.

---

← Back to Bridge folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Bridge — Hands-On Tasks](tasks.md)
