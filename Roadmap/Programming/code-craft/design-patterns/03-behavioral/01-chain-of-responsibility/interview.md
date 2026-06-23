# Chain of Responsibility — Interview Prep

> **Source:** [refactoring.guru/design-patterns/chain-of-responsibility](https://refactoring.guru/design-patterns/chain-of-responsibility)

A practice bank for CoR pattern interviews — concise answers, code, and trade-offs.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Questions](#system-design-questions)
7. [Anti-pattern / "What's wrong" Questions](#anti-pattern-whats-wrong-questions)
8. [Cross-pattern Questions](#cross-pattern-questions)
9. [Quick Drills (1-line answers)](#quick-drills-1-line-answers)
10. [Tips for Interviews](#tips-for-interviews)

---

## Junior Questions

### Q1: What is the Chain of Responsibility pattern?

**A.** A behavioral pattern where a request travels through a chain of handlers. Each handler decides to:
1. Handle the request itself, OR
2. Pass it to the next handler, OR
3. Both — handle then forward.

The sender doesn't know which handler will respond. Handlers know only their `next`.

### Q2: Why use CoR?

**A.**
- Decouples sender from receiver — sender just talks to chain head.
- Open/Closed: add handlers without modifying existing.
- Dynamic composition — different chains for different contexts.
- Single Responsibility — each handler does one thing.

### Q3: When NOT to use CoR?

**A.**
- One handler always processes — no need for chain.
- All handlers must run — that's a Pipeline, not CoR.
- Performance-critical inner loop — chain traversal overhead.
- Complex routing logic — use a state machine or rule engine.

### Q4: What roles are in CoR?

**A.**
- **Handler** (interface/abstract class) — has `handle(request)` and a reference to next.
- **ConcreteHandlers** — implement specific logic.
- **Client** — assembles chain, sends requests to head.

### Q5: What's the difference between CoR and Pipeline?

**A.** CoR: each handler may short-circuit (stop the chain). Pipeline: every step always runs (transforms data through). Servlet Filters that can return early are CoR; logging frameworks where each appender always processes are Pipeline-flavored.

### Q6: Show a minimal CoR example.

**A.**

```java
abstract class Handler {
    protected Handler next;
    public Handler setNext(Handler n) { this.next = n; return n; }
    public abstract void handle(Request r);
}

class AuthHandler extends Handler {
    public void handle(Request r) {
        if (!r.hasToken()) throw new UnauthorizedException();
        if (next != null) next.handle(r);
    }
}
```

### Q7: What's a real-world example?

**A.** HTTP middleware (Express, Koa), Servlet Filters, Spring Security FilterChain, gRPC interceptors, logging appenders, validation chains, customer support escalation, expense approval workflows.

### Q8: What happens if you forget `next.handle(r)`?

**A.** Chain breaks. Downstream handlers never run. Most common CoR bug. Test with mocks: verify `next.handle` was called when expected.

---

## Middle Questions

### Q9: What's the onion model?

**A.** Each middleware does work *before* AND *after* `next`:

```javascript
async function logger(ctx, next) {
    console.log("REQ:", ctx.url);
    await next();
    console.log("RESP:", ctx.status);
}
```

Used in Koa, .NET ASP.NET, Spring's `OncePerRequestFilter`. Outer middleware sees request first AND response last.

### Q10: How do you implement async CoR?

**A.** With Promises (JS) / `CompletableFuture` (Java) / async/await:

```java
public CompletableFuture<Response> handle(Request req) {
    return validate(req)
        .thenCompose(this::auth)
        .thenCompose(this::business);
}
```

Each step's future composes with the next. Errors propagate via exception handling.

### Q11: How do you pass shared state through a chain?

**A.** Context object:

```java
class RequestContext {
    Map<String, Object> attrs = new HashMap<>();
}

// Each handler reads/writes context:
ctx.set("user", decodedUser);
// downstream:
User u = ctx.get("user");
```

Per-request, mutable, scoped. Express's `req` object is this. Avoid handler-level state (race conditions).

### Q12: Fail-fast vs collect-all validation chains?

**A.**
- **Fail-fast**: stop on first error (login form: "email invalid" — don't bother checking other fields).
- **Collect-all**: every rule runs; aggregate errors (batch import: report all bad rows).

Same chain structure; different short-circuit semantics. Choose based on UX.

### Q13: How do you avoid order-dependency bugs in chains?

**A.**
1. Document order requirements.
2. Each handler self-validates (don't trust previous handlers).
3. Use named/typed context (e.g., `ctx.user` only set after auth).
4. Integration tests over the full chain.

### Q14: How does Express middleware work?

**A.**

```javascript
app.use((req, res, next) => {
    // pre-work
    next();   // forward
    // (Express doesn't naturally support post; use Koa for that)
});
```

Each `app.use(fn)` adds to chain. `next()` forwards. Skipping `next()` ends the chain. Sending response (`res.send`) typically also ends.

### Q15: How does Koa differ from Express?

**A.** Koa supports `await next()` — code after runs as response unwinds. True onion model. Express's middleware is "fire and forget" forward; post-processing via separate "after" middlewares is awkward.

### Q16: What's the difference between CoR and Decorator?

**A.**
- **Decorator**: wraps to add behavior; usually doesn't decide whether to forward (always wraps).
- **CoR**: each handler decides to forward or short-circuit.

Onion-model CoR overlaps with Decorator chains. Name by intent: routing/filtering = CoR; behavior addition = Decorator.

### Q17: What's the difference between CoR and Interpreter?

**A.** Interpreter executes a language by walking AST nodes. CoR routes a request through handlers. They share the chain idea but differ in purpose: Interpreter has *a tree of operations*; CoR has *a list of handlers*.

### Q18: Can a handler modify the request?

**A.** Yes — handlers commonly enrich the request (e.g., decode token → set user; parse body → set body). Pass the modified request to `next.handle(modified)`. Or mutate context.

For purely functional flows: handler returns a new request; chain forwards new one.

---

## Senior Questions

### Q19: How does Spring Security's FilterChainProxy work?

**A.** Spring Security defines a `SecurityFilterChain` with ~15 filters in a specific order:

```
SecurityContextPersistenceFilter
HeaderWriterFilter
CsrfFilter
LogoutFilter
BearerTokenAuthenticationFilter
AuthorizationFilter
ExceptionTranslationFilter
... (terminal)
```

Each filter has its concern. Order critical — auth before authorization, exception translation before any throwing filter. `addFilterBefore`/`addFilterAfter` lets you insert custom filters at specific positions.

### Q20: What's a Servlet Filter chain?

**A.** Java EE's foundational CoR. `Filter` interface has `doFilter(req, resp, FilterChain chain)`. Chain managed by container based on `@WebFilter` annotations or `web.xml`. Each filter calls `chain.doFilter()` to forward, or returns to short-circuit.

### Q21: How do gRPC interceptors form a chain?

**A.** `ServerInterceptor` chain wraps the actual method call:

```java
serverBuilder
    .intercept(authInterceptor)
    .intercept(loggingInterceptor)
    .intercept(tracingInterceptor)
```

Last `.intercept()` is innermost (closest to handler). Forms onion: outer wraps inner. Same in client interceptors.

### Q22: How do you ensure idempotency in a retried chain?

**A.** Each handler must be idempotent:
- Idempotency keys (e.g., Stripe's `Idempotency-Key` header).
- Database UPSERT instead of INSERT.
- Set membership check (`if !sent.add(key) skip`).
- Stateless handlers (no side effects).

If chain may be retried (transient failures, at-least-once delivery), retry-safety is non-negotiable.

### Q23: Where does a circuit breaker fit in the chain?

**A.** Place it close to the call it protects (typically wrapping outbound calls):

```
Application → CB → External Service
```

Within a CoR, the CB handler short-circuits when downstream is failing — fast-fail without waiting for timeout. Resilience4j, Hystrix (deprecated), Polly.

### Q24: How would you make a chain dynamically reconfigurable?

**A.**
1. Wrap handlers in a holder with `AtomicReference`.
2. On config change, swap the underlying handler.
3. Or rebuild entire chain from config (Spring `@RefreshScope`).

For runtime additions (e.g., feature flags toggling middleware): `if (flag) next.handle()` else short-circuit, all in a wrapper handler.

### Q25: What's a service mesh sidecar's relationship to CoR?

**A.** Sidecar (Envoy, Linkerd) intercepts all traffic to/from the app. Internally it's a CoR of filters: mTLS, tracing, retry, circuit breaker, load balancer. The chain is config-driven (xDS protocol). Updates push new chain configs without restart.

### Q26: How do you observe a CoR (metrics, traces)?

**A.** Each handler emits:
- Latency timer (start before next, stop after).
- Counter (request reached this handler).
- Error counter (exceptions in this handler).

Wrap handlers in a `MetricsMiddleware` decorator. Or build into base class. OpenTelemetry instrumentation often does this auto.

### Q27: What security mistakes are common in CoR?

**A.**
1. **Auth after logging:** sensitive data logged before auth fails.
2. **Trusting upstream headers:** `X-User` set by client, not by auth.
3. **Bypassing chain:** path matchers leave routes unprotected.
4. **Information leakage on errors:** stack traces returned to client.
5. **Wrong filter order:** authorization before authentication.

Default-deny: every endpoint goes through full security chain unless explicitly allowed.

### Q28: How do you test a chain?

**A.**
1. **Unit-test each handler:** mock `next`, verify forwarded or not.
2. **Integration test the full chain:** realistic request → assert end state.
3. **Property tests:** for chains where order shouldn't matter, verify with shuffled orders.
4. **Security tests:** verify auth bypass attempts fail.

### Q29: What's the trade-off of OO vs functional CoR?

**A.**
- **OO**: classes with state; explicit interface; verbose. Good for stateful handlers, dependency injection.
- **Functional**: lambdas/closures; concise; lighter. Good for pure transformation, ad-hoc composition.

Modern Java/Kotlin/TypeScript: functional preferred for stateless. Spring still mostly OO.

### Q30: Reactive CoR — explain.

**A.** Each handler returns a `Mono`/`Flux`/`Single`/`Observable`:

```java
public Mono<Response> handle(Request req) {
    return doSomething(req).flatMap(next::handle);
}
```

Backpressure propagates upstream via `request(n)`. Errors via `onError`. Composable, lazy, async-by-default. Cost: ~µs per chain step due to operator allocation.

---

## Professional Questions

### Q31: How does JIT optimize a CoR chain?

**A.** If chain shape is monomorphic (same instance shapes seen at call sites), JIT inlines `next.handle()` into the caller. After warmup, dispatch effectively zero. JVM's `MaxInlineLevel` (default 9) caps depth — long chains hit the limit.

For polymorphic chains: vtable lookup ~3-5ns per `next` call. 10-deep × 100K req/s = 5ms/s overhead.

### Q32: What's `MaxInlineLevel`?

**A.** JVM flag controlling max depth of nested method inlining. Default 9. CoR chains > 9 deep won't be fully inlined past depth 9. Tune with `-XX:MaxInlineLevel=15`. Trade-off: more JIT time, more code cache, slightly faster steady state.

### Q33: How do CompletableFuture chains allocate?

**A.** Each `thenCompose` allocates:
- A new `CompletableFuture` for the result.
- A `BiCompletion` linking input to output.

For 4-step chain × 100K req/s: ~20MB/s GC pressure. Visible.

Mitigation: combine multiple steps into one `thenApply`/`thenCompose`; use Project Loom virtual threads to skip async entirely.

### Q34: How does Project Loom change CoR?

**A.** Java 21+ virtual threads make blocking I/O cheap. CoR chains become synchronous code:

```java
public Response handle(Request req) {
    Request validated = validate(req);
    Request authed = auth(validated);
    return business(authed);
}
```

Each step blocks; virtual thread mounts/unmounts on carrier. 1M concurrent virtual threads cheap. Goodbye `CompletableFuture` for I/O concurrency. CoR returns to its OO origins.

### Q35: How does Envoy's filter chain work?

**A.** C++ filter chain configured via xDS API. Each filter has hooks (decode_headers, decode_data, encode_headers, encode_data). Onion model: decode = request path, encode = response path.

Filters can be C++ (compiled), WASM (sandbox), or Lua (scripting). WASM hot-deployable.

### Q36: Compile-time chain assembly — explain.

**A.** Generate Java code that inlines the entire chain:

```java
public static void process(Request r) {
    if (!verify(r.token())) throw ...;   // inlined Auth
    log.info(r.url());                    // inlined Log
    business(r);                          // inlined Business
}
```

Annotation processor reads config; emits Java. Maximum performance: zero CoR overhead.

Tools: ANTLR, Dagger, MapStruct, Roslyn analyzers.

### Q37: Backpressure across reactive CoR?

**A.** Each `flatMap` operator implements Reactive Streams `request(n)`. Subscriber requests N items; flatMap pulls N from upstream. Cascade: subscriber → flatMap C → flatMap B → flatMap A → source.

If downstream slow, upstream stalls. Bounded buffers prevent overflow. Reactor's `Sinks.many().multicast().onBackpressureBuffer(N)`.

### Q38: How would you design a chain that processes 1M packets/sec?

**A.**
- C/C++/Rust for native performance (avoid JVM dispatch).
- Tail-call style (compiler TCO) or explicit loop — no recursion.
- Batch processing: 16-64 packets per filter call (SIMD).
- Lock-free queues between filters.
- Pin to CPU cores (cache locality).
- DPDK, eBPF, FD.io for kernel bypass.

Java would top out at ~100K packets/s; native scales to 10M+.

### Q39: How does WASM enable hot-deployable filters?

**A.** Filters compiled to WASM bytecode; loaded into Envoy at runtime. No restart. Sandboxed: filter can't crash Envoy. Cold start ~ms; JIT-compiled WASM near-native (x86 ~95%, ARM ~85%).

Use cases: security policy, custom metrics, A/B testing, traffic shaping. Update without restart.

### Q40: Spring AOP interceptor chain — internals?

**A.** When a method is called on a Spring bean, Spring substitutes a proxy (JDK or cglib). Proxy invokes a `MethodInterceptor` chain — each interceptor wraps the next, terminal calls real method.

Order via `@Order` or `@Priority`. Auto-wired aspects (`@Transactional`, `@Cacheable`, `@PreAuthorize`) become interceptors. Pure CoR over method invocation.

---

## Coding Tasks

### Task 1: Implement an HTTP middleware chain.

```java
abstract class Middleware {
    Middleware next;
    abstract void handle(Request req, Response resp);
}

class Auth extends Middleware {
    void handle(Request req, Response resp) {
        if (!req.hasToken()) { resp.send(401); return; }
        if (next != null) next.handle(req, resp);
    }
}
```

### Task 2: Convert this if/else to CoR.

```java
void process(Order o) {
    if (o.amount < 100) lead.approve(o);
    else if (o.amount < 1000) manager.approve(o);
    else director.approve(o);
}
```

**Solution:**

```java
abstract class Approver {
    Approver next;
    abstract void approve(Order o);
}

class TeamLead extends Approver {
    void approve(Order o) {
        if (o.amount < 100) System.out.println("approved");
        else next.approve(o);
    }
}
// ... Manager, Director similar
```

### Task 3: Implement a validation chain (fail-fast).

```java
abstract class Rule {
    Rule next;
    Result validate(User u) {
        Result r = check(u);
        return r.isValid() && next != null ? next.validate(u) : r;
    }
    abstract Result check(User u);
}

class EmailRule extends Rule {
    Result check(User u) { return u.email.contains("@") ? Result.ok() : Result.fail("email"); }
}
```

### Task 4: Functional middleware compose.

**TypeScript:**

```typescript
type Middleware<T> = (next: (x: T) => void) => (x: T) => void;

function compose<T>(mw: Middleware<T>[], terminal: (x: T) => void) {
    return mw.reduceRight((next, m) => m(next), terminal);
}
```

### Task 5: Chain with onion model.

```java
abstract class Middleware {
    Middleware next;
    Response handle(Request req) {
        // pre-work
        Response r = next.handle(req);
        // post-work
        return r;
    }
}
```

### Task 6: Iterative chain runner (no recursion).

```java
class ChainRunner {
    void run(List<Handler> handlers, Request req) {
        for (Handler h : handlers) {
            HandleResult r = h.handle(req);
            if (r.shortCircuited()) break;
        }
    }
}
```

### Task 7: Chain with context object.

```java
class Context { Map<String, Object> attrs = new HashMap<>(); }

class AuthHandler extends Handler {
    void handle(Request r, Context ctx) {
        User u = decode(r.token());
        ctx.attrs.put("user", u);
        if (next != null) next.handle(r, ctx);
    }
}
```

### Task 8: Async chain with CompletableFuture.

```java
abstract class AsyncHandler {
    AsyncHandler next;
    CompletableFuture<Response> handle(Request r) {
        return process(r).thenCompose(processed ->
            next != null ? next.handle(processed) : CompletableFuture.completedFuture(...)
        );
    }
    abstract CompletableFuture<Request> process(Request r);
}
```

### Task 9: Build a logging appender chain.

```java
abstract class Appender {
    Appender next;
    Level minLevel;
    void log(LogEntry e) {
        if (e.level >= minLevel) write(e);
        if (next != null) next.log(e);   // pipeline-style: every appender runs
    }
    abstract void write(LogEntry e);
}
```

### Task 10: Add a circuit breaker handler.

```java
class CBHandler extends Handler {
    CircuitBreaker cb;
    void handle(Request r) {
        if (cb.isOpen()) throw new ServiceUnavailableException();
        try {
            next.handle(r);
            cb.recordSuccess();
        } catch (Exception e) {
            cb.recordFailure();
            throw e;
        }
    }
}
```

---

## System Design Questions

### Q41: Design a request rate limiter.

**A.** CoR handler:

```java
class RateLimiter extends Handler {
    Cache<String, AtomicInteger> counts;   // per-IP
    int maxPerMin = 60;

    void handle(Request r) {
        AtomicInteger count = counts.get(r.ip(), k -> new AtomicInteger());
        if (count.incrementAndGet() > maxPerMin) {
            throw new TooManyRequestsException();
        }
        if (next != null) next.handle(r);
    }
}
```

Real production: Token Bucket / Sliding Window algorithms; Redis for cluster-wide; sliding log for accuracy. Place early in chain (before expensive work).

### Q42: Design an API Gateway.

**A.** CoR architecture:
- TLS termination
- Auth (JWT/OAuth)
- Rate limiting
- Request transformation
- Routing (per upstream)
- Load balancing
- Circuit breaker
- Forward to upstream
- Response transformation
- Logging / metrics

Each = a handler. Configure via YAML/UI. Hot-reload supported. Examples: Kong, Tyk, AWS API Gateway, Envoy, Istio.

### Q43: Design a logging system with multiple destinations.

**A.** Pipeline-style chain:

```java
LogChain chain = new ConsoleAppender(DEBUG);
chain.next(new FileAppender(INFO, "app.log"))
     .next(new NetworkAppender(ERROR, "logs.example.com"));
```

Each appender filters by level, writes if applicable, always forwards. Log4j / Logback / SLF4J use this. Async wrappers for non-blocking writes.

### Q44: Design a permission system with role hierarchies.

**A.** Permission check as a chain:

```
RoleCheck → PermissionCheck → ResourceOwnerCheck → DefaultDeny
```

Each handler checks one rule. First to deny short-circuits. Default-deny terminal. ABAC (attribute-based) extends with attributes-based handlers.

### Q45: Design an event-driven workflow engine.

**A.** Event flows through a chain of processors. Each processor:
- Examines event.
- May produce side effects (DB updates, external calls).
- May produce new events (chained workflows).
- Forwards to next or short-circuits.

Real systems: Camunda, Apache Airflow, Temporal — all CoR-flavored at the workflow step level.

---

## Anti-pattern / "What's wrong" Questions

### Q46: What's wrong here?

```java
class LoggingHandler extends Handler {
    public void handle(Request r) {
        System.out.println(r);
        // forgot next.handle(r)
    }
}
```

**A.** Doesn't forward. Chain breaks. Downstream handlers never reached. Add `if (next != null) next.handle(r);`.

### Q47: What's the bug?

```java
class CounterHandler extends Handler {
    int count = 0;
    public void handle(Request r) {
        count++;
        next.handle(r);
    }
}
```

**A.** `count` shared across requests. Concurrent requests race. Use `AtomicInteger` or per-request context.

### Q48: What's wrong?

```java
SecurityFilterChain chain = http
    .securityMatcher("/api/**")
    .authorizeHttpRequests(...)
    .build();
// /admin/* — no chain configured → no security → public!
```

**A.** Default-deny missing. Routes outside `/api/**` have no security. Spring 6+ requires explicit chain for all paths. Add a default chain that requires authentication.

### Q49: What's the bug?

```java
class TokenDecoder extends Handler {
    public void handle(Request r) {
        r.user = decode(r.header("X-User"));   // trusts client header!
        next.handle(r);
    }
}
```

**A.** `X-User` is a client-supplied header. Attackers spoof it. Real auth must validate signed token (JWT) or session cookie. Strip security headers at gateway.

### Q50: What's wrong?

```java
class ErrorHandler extends Handler {
    public void handle(Request r) {
        try { next.handle(r); }
        catch (Exception e) {
            response.send("Error: " + e.toString());   // exposes stack trace
        }
    }
}
```

**A.** Internal error details leaked to client. Log details internally; return generic message externally:

```java
catch (Exception e) {
    log.error("internal error", e);
    response.send(500, "internal server error");
}
```

---

## Cross-pattern Questions

### Q51: CoR vs Decorator?

**A.** Decorator wraps to add behavior; chains decorators add behavior cumulatively. CoR routes a request; each handler may stop or forward. Onion-model CoR overlaps with Decorator. Differentiate by intent.

### Q52: CoR vs Strategy?

**A.** Strategy: one algorithm chosen, runs. CoR: many handlers; each may run, defer, or short-circuit. Strategy is "pick one"; CoR is "ask each in turn".

### Q53: CoR vs Command?

**A.** Command: encapsulates an action as object (with undo). CoR: chains handlers for processing requests. Different problems.

### Q54: CoR vs Composite?

**A.** Composite structures a tree (e.g., directory + files). CoR is a linear chain. Composite represents structure; CoR represents process flow.

### Q55: CoR vs Observer?

**A.** Observer: one subject notifies many subscribers — broadcast. CoR: one request goes to one (or short subset) of handlers — routed. Both have "many handlers", but Observer's are independent; CoR's are sequential.

### Q56: CoR + Builder?

**A.** Use Builder to assemble chain:

```java
Handler chain = ChainBuilder.start()
    .add(new Auth())
    .add(new Log())
    .add(new Business())
    .build();
```

Cleaner than nested `setNext`.

### Q57: CoR + Memento?

**A.** Save chain state before processing; restore on rollback. E.g., transaction handler captures Memento at start; rolls back on failure downstream.

### Q58: CoR + Iterator?

**A.** Iterative chain runner uses an Iterator over handlers:

```java
Iterator<Handler> it = chain.iterator();
while (it.hasNext()) {
    if (it.next().handle(req).shortCircuited()) break;
}
```

Avoids recursion, supports pause/resume.

---

## Quick Drills (1-line answers)

- **CoR's purpose?** Pass request through chain of handlers; each handles or forwards.
- **Sender/receiver coupling?** Decoupled — sender talks to head, doesn't know who handles.
- **Common bug?** Forgetting `next.handle()`.
- **Onion model?** Each middleware does pre + post work, wrapping downstream.
- **Express middleware?** `(req, res, next) => { /* pre */; next(); }` (no post — use Koa).
- **Koa middleware?** `async (ctx, next) => { /* pre */; await next(); /* post */; }`.
- **CoR vs Pipeline?** CoR may short-circuit; Pipeline always runs all.
- **Servlet Filter foundation?** `doFilter(req, resp, FilterChain chain)`.
- **gRPC interceptor chain?** `serverBuilder.intercept(...)` — wraps in reverse.
- **Spring Security?** `SecurityFilterChain` with ~15 ordered filters.
- **AOP interceptor chain?** `MethodInterceptor` wraps the actual method.
- **Idempotency?** Required for retried chains; use idempotency keys.
- **Circuit breaker placement?** Close to call it protects.
- **JIT inlining limit?** `MaxInlineLevel=9` default.
- **Reactive CoR?** Each handler returns `Mono`/`Flux`; backpressure propagates.
- **Loom changes?** Virtual threads make blocking CoR cheap; less need for `CompletableFuture`.
- **Envoy filters?** xDS-config'd C++/WASM chain in service mesh.
- **CoR + Builder?** Build chains via fluent API.
- **Default-deny?** Every path needs explicit chain; no path bypasses security.
- **Performance for 1M pps?** Native code, batched SIMD, no GC.

---

## Tips for Interviews

1. **Lead with the *why*.** "Decouple sender from handler; enable dynamic composition." Then mechanism.
2. **Mention real frameworks.** Spring Security, Express, Koa, Servlet Filter, gRPC interceptors — anchors the pattern.
3. **Onion model bonus.** Mentioning pre/post phases and wrapping shows depth beyond junior level.
4. **Trade-offs.** "Decoupled but order-dependent" — interviewers want balanced views.
5. **Common bug.** Forgetting `next.handle()` is universally known. Expect it.
6. **Security awareness.** Auth/authz order, default-deny, idempotency — senior signal.
7. **Performance.** JIT inlining, allocation per `flatMap`, virtual threads — professional signal.
8. **Pipeline distinction.** Many candidates conflate CoR and Pipeline. Knowing the difference impresses.
9. **Code on whiteboard.** Show the abstract `Handler` + `setNext` + concrete handler. Standard.
10. **Async story.** `CompletableFuture.thenCompose`, Reactor `flatMap`, Loom virtual threads. Show evolution awareness.

---

[← Professional](professional.md) · [Tasks →](tasks.md)
