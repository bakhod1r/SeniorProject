# Fluent Interface — Interview Questions

> **Category:** [Object & State Patterns](../README.md) — chain calls that each return the receiver, producing a readable mini-DSL.

---

## Junior Questions (10)

### J1. What is a fluent interface?
**Answer:** An API designed so calls chain — each non-terminal method returns an object (usually the receiver, `this`/`self`) so you can immediately call the next method: `assertThat(x).isNotNull().isEqualTo(y)`.

### J2. What's the one-line change that makes a method fluent?
**Answer:** Return the receiver instead of `void`: `void setX(v) {...}` becomes `T x(v) {...; return this;}`.

### J3. Who coined the term?
**Answer:** Martin Fowler and Eric Evans (2005).

### J4. What is a terminal method?
**Answer:** The last call that ends the chain and returns the real result/product — `build()`, `toString()`, `collect()`, `execute()`. Everything before returns the chainable object.

### J5. Is a fluent interface the same as the Builder pattern?
**Answer:** No. Fluent interface is about *readability via chaining*; Builder is about *constructing a complex object step by step*. They often co-occur (builders are usually fluent) but are orthogonal — `assertThat(x).isEqualTo(y)` is fluent and builds nothing.

### J6. Give three real fluent APIs.
**Answer:** Java Streams (`.filter().map().collect()`), AssertJ assertions, `StringBuilder.append().append()`, SQLAlchemy/jOOQ query builders, pandas frame chains.

### J7. Why are fluent chains called internal DSLs?
**Answer:** Because ordinary method calls in the host language read like a small domain-specific language: `select("id").from("users").where("active")`.

### J8. What is a "wither"?
**Answer:** An immutable-style chaining method that returns a *new copy* (`withX(...)`) instead of mutating the receiver.

### J9. Why is chaining awkward in Go?
**Answer:** It works (return the receiver pointer), but the idiomatic alternative for configuration is **functional options**. Chaining in Go is reserved for accumulation (query/string building).

### J10. What's a common bug when writing fluent methods in Python?
**Answer:** Forgetting `return self` — the method returns `None`, and the next call fails with `AttributeError: 'NoneType' object has no attribute ...`.

---

## Middle Questions (10)

### M1. When should you use a fluent interface vs plain statements?
**Answer:** When a *sequence of related operations* reads better as one expression (config, assertions, queries, pipelines). For a single operation, plain calls are clearer.

### M2. Mutable chain vs immutable wither — when each?
**Answer:** Mutable (return `this`) for throwaway objects built once — cheaper. Immutable wither (return a copy) when the object is shared, cached, or used as a template — avoids aliasing and is thread-safe.

### M3. What aliasing bug does a mutable chain risk?
**Answer:** `var b = base.x(t1); var c = base.x(t2);` mutates `base` itself; `b`, `c`, and `base` are all the *same* object. The wither style fixes it.

### M4. What are functional options in Go?
**Answer:** Each option is `Option = func(*T)`; `New(opts ...Option)` applies them. Composable, order-independent, no mutable receiver exposed. Idiomatic in `net/http`, `grpc`, AWS SDK.

### M5. Lazy vs eager chains?
**Answer:** Lazy chains (Java Streams, LINQ) do nothing until the terminal — steps fuse, unused steps are free. Eager chains (pandas) compute at each step, materializing intermediates.

### M6. Why is a single terminal important?
**Answer:** Without it, callers are left holding the intermediate object instead of the real result. The terminal returns the product and signals the chain's end.

### M7. How do you refactor imperative setters to fluent?
**Answer:** Change each `void` setter to return `this`; keep the action method (`render`/`build`) as the terminal; collapse call sites into one chained expression.

### M8. Should chainable methods be commands or queries?
**Answer:** Commands. Chaining genuine queries (`list.add(x).size()`) violates Command-Query Separation and hides intent. Keep real queries out of the chain.

### M9. Why does Java's `List.add` return `boolean` instead of the list?
**Answer:** Deliberate CQS — `add` is both a command and a query (did the set change?). Returning `boolean` prevents chaining a query as if it were fluent config.

### M10. What's the cost of a fluent chain vs direct construction?
**Answer:** Mutable chains ≈ direct construction after JIT (inlined, often scalar-replaced). Wither chains allocate per step (often elided). Go options allocate one closure each. Python ~2–3× a kwargs constructor. Negligible outside hot loops.

---

## Senior Questions (10)

### S1. What is a staged / progressive interface?
**Answer:** A fluent interface where each step returns a *different type* exposing only the next legal calls, encoding required steps and ordering into the type system. Misordered or incomplete chains become **compile errors** instead of runtime exceptions.

### S2. How do you handle errors mid-chain?
**Answer:** Three strategies: (1) defer — validate and throw at the terminal; (2) accumulate — collect all errors, report at the terminal; (3) railway/Result — each step short-circuits on the first error (Go's sticky-error `Scanner.Err()` is the canonical example).

### S3. How does a fluent interface conflict with Command-Query Separation?
**Answer:** A fluent setter is a command yet returns the receiver — violating CQS. It's a considered trade: readability over principle. Keep the returned value *always the receiver* (not new information) and keep genuine queries out of the chain.

### S4. Why do fluent chains produce bad stack traces?
**Answer:** The whole chain is effectively one statement; the trace points at the statement, not the failing step. Lambdas appear as mangled synthetic frames. Mitigate with one-step-per-line, helpful NPEs (Java 14+), and eager per-step validation.

### S5. How does inheritance break fluent chaining, and how do you fix it?
**Answer:** The self-type problem: a base setter returning `Base` loses the subtype, dropping subclass methods from the chain. Fix with recursively-bounded generics (`Base<SELF extends Base<SELF>>`, return `(SELF) this`). Lombok `@SuperBuilder` generates this.

### S6. How does a staged interface improve IDE discoverability?
**Answer:** Narrow return types mean autocomplete after `.` shows only the legal next calls. The type system doubles as documentation, guiding the caller through valid sequences.

### S7. Why must the implementation class of a staged interface be private?
**Answer:** If it's public and implements all stages, callers can cast back to it and skip required steps, defeating the type-state enforcement. Hide the impl; expose only the stage interfaces.

### S8. When is a fluent interface the wrong choice?
**Answer:** For single operations; when steps are genuine queries; when per-step debuggability matters; in Go where options are idiomatic; when a named-argument constructor (Python/Kotlin) is clearer.

### S9. How do you make a fluent config safe to use as a shared template?
**Answer:** Make it immutable (wither chain). The base is never mutated, so deriving variants (`base.withX(...)`) is safe and thread-safe. Mutable chains can't be shared as templates without aliasing bugs.

### S10. Lazy stream vs eager pipeline — performance implications?
**Answer:** Lazy fuses steps into one traversal and short-circuits (e.g. `findFirst`), so unused work is free. Eager materializes intermediates each step. A lazy chain can be O(n) one pass; an eager one O(n) per step plus intermediate allocations.

---

## Professional Questions (10)

### P1. Why does a mutable fluent chain cost almost nothing after JIT?
**Answer:** Each small step inlines; escape analysis sees the receiver never escapes and scalar-replaces it (no heap object). The chain compiles to the same code as direct field assignments plus the terminal.

### P2. Why does a Java Stream allocate more than a hand-written mutable chain?
**Answer:** A stream builds a pipeline: a stream head, a stage object per intermediate op, a spliterator, plus the result. A mutable chain mutates one receiver. You pay the allocation for laziness, fusion, and parallelism support.

### P3. When do wither-chain intermediates get elided?
**Answer:** When the intermediate copies are dead immediately and don't escape (not stored/returned/passed to non-inlined code). Escape analysis is fragile; in hot loops wither chains can show real allocation — profile.

### P4. How do persistent data structures help wither chains over collections?
**Answer:** Structural sharing: adding to a HAMT-backed map is O(log n) sharing nodes with the prior version, not O(n) full copy. Turns an n-step wither over a collection from O(n²) into O(n log n).

### P5. Why are Go functional options costlier than receiver chaining?
**Answer:** Each option is a returned closure that escapes to the heap (~16–32 bytes). Receiver chaining just returns the pointer already in hand — no closure. Options trade a small allocation for composability.

### P6. How do Java 14+ helpful NullPointerExceptions improve chain debugging?
**Answer:** They reconstruct the failing expression in the message (`Cannot invoke "Line.price()" because the return value of "..." is null`), naming the exact step that NPE'd inside a chain.

### P7. How does loop fusion work in a lazy chain?
**Answer:** Intermediate ops don't iterate; they wrap the source in a transformation. The terminal pulls elements through all stages in a single traversal, so `filter().map()` is one pass, not two — and short-circuiting terminals stop early.

### P8. How do you profile whether a fluent chain is a bottleneck?
**Answer:** Allocation profiling (`pprof -alloc_objects`, async-profiler alloc mode) flags wither/stream allocations; CPU profiling flags hot dispatch; Go `-gcflags='-m=2'` shows escape decisions. Benchmark before optimizing — chains rarely dominate.

### P9. Why are pandas chains expensive even though Python method calls are cheap?
**Answer:** The cost isn't the calls — it's the **intermediate frames**. Each eager step materializes a full DataFrame copy. Mitigate with `.pipe()`, in-place ops, or fewer materializing steps.

### P10. How does scalar replacement differ from stack allocation for a chain receiver?
**Answer:** Scalar replacement decomposes the object into its individual fields held in registers/stack slots — there's no object at all, not even on the stack. It's the most aggressive escape-analysis outcome and what makes inlined mutable chains effectively free.

---

## Coding Tasks (5)

### C1. Turn imperative setters into a fluent chain (Java).
```java
public final class Notification {
    private String to, title, body;
    public Notification to(String t)    { this.to = t; return this; }
    public Notification title(String t) { this.title = t; return this; }
    public Notification body(String b)  { this.body = b; return this; }
    public Sent send() { /* ...dispatch... */ return new Sent(); } // terminal
}
new Notification().to("a@x").title("Hi").body("...").send();
```

### C2. Immutable wither chain (Java record).
```java
public record Config(String region, Duration timeout, int retries) {
    public Config withRegion(String r)   { return new Config(r, timeout, retries); }
    public Config withTimeout(Duration t){ return new Config(region, t, retries); }
    public Config withRetries(int n)     { return new Config(region, timeout, n); }
}
Config base = new Config("us-east-1", Duration.ofSeconds(5), 3);
Config eu = base.withRegion("eu-west-1");   // base untouched
```

### C3. Error-accumulating fluent validator (Python).
```python
class Check:
    def __init__(self, value):
        self.value, self.errors = value, []
    def not_empty(self):
        if not self.value: self.errors.append("must not be empty")
        return self
    def max_len(self, n):
        if self.value and len(self.value) > n: self.errors.append(f"len <= {n}")
        return self
    def or_throw(self):
        if self.errors: raise ValueError("; ".join(self.errors))
        return self.value

name = Check(raw).not_empty().max_len(50).or_throw()
```

### C4. Sticky-error chain in Go.
```go
type Writer struct {
    w   io.Writer
    err error
}
func (x *Writer) Line(s string) *Writer {
    if x.err != nil { return x }            // sticky: skip after first error
    _, x.err = fmt.Fprintln(x.w, s)
    return x
}
func (x *Writer) Err() error { return x.err }

w := &Writer{w: buf}
w.Line("a").Line("b").Line("c")
if err := w.Err(); err != nil { /* one check */ }
```

### C5. Staged interface enforcing order (Java).
```java
public final class Conn {
    public interface HostStep { UserStep host(String h); }
    public interface UserStep { ReadyStep user(String u); }
    public interface ReadyStep { ReadyStep ssl(boolean s); Conn open(); }

    public static HostStep builder() { return new Impl(); }
    private static final class Impl implements HostStep, UserStep, ReadyStep {
        String host, user; boolean ssl = true;
        public UserStep  host(String h) { this.host = h; return this; }
        public ReadyStep user(String u) { this.user = u; return this; }
        public ReadyStep ssl(boolean s) { this.ssl = s; return this; }
        public Conn      open()         { return new Conn(host, user, ssl); }
    }
    private Conn(String host, String user, boolean ssl) { /* ... */ }
}
// Conn.builder().host("h").user("u").open();  // host before user enforced by compiler
```

---

## Trick Questions (5)

### T1. Is every chained API a Builder?
**No.** Assertions, query DSLs, and stream pipelines chain but build no object. Builder is one *use* of fluency, not its definition.

### T2. Does returning `this` always mean mutable?
**No.** You can return `this` from a method that only reads. But the *fluent setter idiom* of returning `this` is mutable. Immutable fluency returns a *copy*, not `this`.

### T3. Can a fluent chain be re-run safely?
**Depends.** Java Streams are single-use (re-running the terminal throws). Mutable builders accumulate state across calls. Wither chains are always safe. Know your DSL's contract.

### T4. Are Go functional options a fluent interface?
**No** — there's no chaining and no receiver returned. They solve the same *configuration* problem differently, and are the idiomatic Go alternative to fluent setters.

### T5. Does one-step-per-line change the stack trace?
**Yes, helpfully.** Distinct source lines give distinct line numbers per frame, so the trace can point at the failing step instead of "the whole statement."

---

## Behavioral Questions (5)

### B1. Tell me about a fluent API you designed.
**Sample:** "I built a staged email DSL — `from().to().subject().body().build()` — where each step returned the next interface. The compiler enforced required fields, killing a class of runtime 'missing subject' bugs we'd had with the old setter object."

### B2. When did a fluent interface cause pain?
**Sample:** "A mutable config builder was cached as a 'default template' and shared. Two requests derived variants off it and stomped each other — classic aliasing. We switched to immutable withers; the template became safe."

### B3. How do you debug a failing fluent chain?
**Sample:** "Split it one-step-per-line, lean on Java's helpful NPEs to name the failing expression, and add eager per-step validation so the bad step throws itself instead of corrupting state that explodes downstream."

### B4. Fluent interface vs functional options — how do you choose?
**Sample:** "Language idiom decides. Java/Python: fluent or builder. Go: functional options for config, chaining only for accumulation. I don't force a Java-style builder into Go."

### B5. How do you keep a fluent API readable as it grows?
**Sample:** "Keep methods as commands, give it one terminal, and use a staged interface when ordering matters so the IDE guides callers. If the menu of methods sprawls, that's a sign to split the DSL."

---

## Tips for Answering

1. **Lead with the definition:** chaining for readability, via returning the receiver.
2. **Always separate it from Builder** — interviewers test this.
3. **Name the mutable-vs-wither trade-off** and its aliasing/thread-safety consequences.
4. **Mention CQS tension** and stack-trace cost — shows senior depth.
5. **Know the Go idiom** (functional options) and Python idiom (kwargs/`Self`).

---

[← Professional](professional.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Tasks](tasks.md)
