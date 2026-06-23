# Chain of Responsibility — Find the Bug

> **Source:** [refactoring.guru/design-patterns/chain-of-responsibility](https://refactoring.guru/design-patterns/chain-of-responsibility)

Each snippet has a bug. Read carefully, identify, fix.

---

## Table of Contents

1. [Bug 1: Forgotten next call](#bug-1-forgotten-next-call)
2. [Bug 2: Cycle in chain](#bug-2-cycle-in-chain)
3. [Bug 3: Shared mutable state](#bug-3-shared-mutable-state)
4. [Bug 4: No terminal handler](#bug-4-no-terminal-handler)
5. [Bug 5: Auth filter after logging](#bug-5-auth-filter-after-logging)
6. [Bug 6: Trusting upstream headers](#bug-6-trusting-upstream-headers)
7. [Bug 7: Non-idempotent handler in retry](#bug-7-non-idempotent-handler-in-retry)
8. [Bug 8: Silent error swallow](#bug-8-silent-error-swallow)
9. [Bug 9: Stack overflow in deep chain](#bug-9-stack-overflow-in-deep-chain)
10. [Bug 10: Order-dependent assumption](#bug-10-order-dependent-assumption)
11. [Bug 11: Forgotten await in async chain](#bug-11-forgotten-await-in-async-chain)
12. [Bug 12: Race in concurrent counter handler](#bug-12-race-in-concurrent-counter-handler)

---

## Bug 1: Forgotten next call

```java
public final class LoggingHandler extends Handler {
    public void handle(Request r) {
        System.out.println("LOG: " + r);
        // missing: if (next != null) next.handle(r);
    }
}

Handler chain = new AuthHandler();
chain.setNext(new LoggingHandler()).setNext(new BusinessHandler());
chain.handle(req);
// AuthHandler runs, LoggingHandler logs, BusinessHandler never runs.
```

**Bug.** Most common CoR bug. `LoggingHandler` doesn't forward → chain breaks.

**Fix.**

```java
public void handle(Request r) {
    System.out.println("LOG: " + r);
    if (next != null) next.handle(r);
}
```

Always forward unless explicitly short-circuiting. Add a base class that auto-forwards:

```java
public abstract class ChainedHandler extends Handler {
    @Override
    public final void handle(Request r) {
        if (doHandle(r) == HandleResult.CONTINUE && next != null) {
            next.handle(r);
        }
    }
    protected abstract HandleResult doHandle(Request r);
}
```

Now subclasses can't accidentally drop the chain.

---

## Bug 2: Cycle in chain

```java
Handler a = new HandlerA();
Handler b = new HandlerB();
Handler c = new HandlerC();

a.setNext(b);
b.setNext(c);
c.setNext(a);   // CYCLE!

a.handle(req);   // StackOverflowError
```

**Bug.** Cyclic chain causes infinite recursion.

**Fix.** Validate when building:

```java
public class ChainBuilder {
    private final Set<Handler> seen = new IdentityHashSet<>();

    public ChainBuilder add(Handler h) {
        if (!seen.add(h)) {
            throw new IllegalStateException("cycle: " + h);
        }
        // ... linking logic
        return this;
    }
}
```

Or detect at runtime with visited tracking:

```java
public void handle(Request r, Set<Handler> visited) {
    if (!visited.add(this)) throw new IllegalStateException("cycle");
    // ... handle
    if (next != null) next.handle(r, visited);
}
```

In practice: enforce DAG structure when building. Cycles are a configuration error.

---

## Bug 3: Shared mutable state

```java
public final class CounterHandler extends Handler {
    private int count = 0;   // shared across requests

    public void handle(Request r) {
        count++;
        if (count > 1000) throw new RateLimitException();
        if (next != null) next.handle(r);
    }
}

// Used by N concurrent threads:
chain.handle(req1);   // thread A
chain.handle(req2);   // thread B
// `count` racing
```

**Bug.** `count` is mutated from multiple threads without synchronization. Lost updates → undercounts → rate limit ineffective.

**Fix.**

```java
private final AtomicInteger count = new AtomicInteger();

public void handle(Request r) {
    if (count.incrementAndGet() > 1000) throw new RateLimitException();
    if (next != null) next.handle(r);
}
```

Or use a per-key sliding window with thread-safe data structures (`ConcurrentHashMap`).

For real rate limiting: token bucket algorithm with `AtomicLong` (last-refill time + tokens) or use Resilience4j / Bucket4j.

---

## Bug 4: No terminal handler

```java
Handler chain = new SmallExpenseHandler();
chain.setNext(new MediumExpenseHandler()).setNext(new LargeExpenseHandler());

chain.handle(new Request("car", 200_000));
// Doesn't match any handler. Silently drops. No error, no log, no rejection.
```

**Bug.** Request falls off the end of chain. Silent failure.

**Fix.** Add a terminal handler:

```java
public final class FallbackHandler extends Handler {
    public void handle(Request r) {
        log.warn("Unhandled request: " + r);
        throw new UnhandledRequestException(r);
    }
}

chain.setNext(new SmallExpenseHandler())
     .setNext(new MediumExpenseHandler())
     .setNext(new LargeExpenseHandler())
     .setNext(new FallbackHandler());
```

Or check after handling:

```java
public void handle(Request r) {
    if (canHandle(r)) {
        process(r);
        return;
    }
    if (next != null) {
        next.handle(r);
    } else {
        throw new IllegalStateException("no handler for " + r);
    }
}
```

Production CoR must always end with a known terminator (success or known rejection).

---

## Bug 5: Auth filter after logging

```java
public class SecurityConfig {
    public Handler chain() {
        return new LoggingHandler()
            .setNext(new AuthHandler())
            .setNext(new BusinessHandler());
    }
}

// Logger logs the request body (including credentials, PII)
// THEN auth runs and rejects unauthorized.
// PII has already been logged.
```

**Bug.** Logging before auth → sensitive data in logs even for failed requests.

**Fix.** Auth first:

```java
return new AuthHandler()
    .setNext(new LoggingHandler())
    .setNext(new BusinessHandler());
```

Or make logger sanitize:

```java
class SafeLogger extends Handler {
    public void handle(Request r) {
        log.info("{} {}", r.method(), r.url());   // no body
        // Headers redacted: Authorization, Cookie, Set-Cookie
        if (next != null) next.handle(r);
    }
}
```

Both, ideally: auth first, AND logger sanitizes.

---

## Bug 6: Trusting upstream headers

```java
public class AuthHandler extends Handler {
    public void handle(Request r) {
        String user = r.header("X-User");   // BUG: trusts client
        if (user != null) {
            r.setUser(user);
            if (next != null) next.handle(r);
        }
    }
}
```

**Bug.** Client-supplied `X-User` header is trusted. Attacker sends `X-User: admin` → bypass auth.

**Fix.** Validate signed credentials:

```java
public void handle(Request r) {
    String token = r.header("Authorization");
    if (token == null || !token.startsWith("Bearer ")) {
        throw new UnauthorizedException();
    }
    Claims claims = jwtValidator.validate(token.substring(7));   // signature check
    r.setUser(claims.subject());
    if (next != null) next.handle(r);
}
```

JWT signature ensures the user wasn't supplied by the client. Strip security-relevant headers at the gateway:

```java
class HeaderStripper extends Handler {
    public void handle(Request r) {
        r.removeHeader("X-User");
        r.removeHeader("X-Internal-*");
        if (next != null) next.handle(r);
    }
}
```

Place at the very front of the chain.

---

## Bug 7: Non-idempotent handler in retry

```java
public class EmailHandler extends Handler {
    public void handle(Request r) {
        emailService.send(r.userEmail(), "purchase complete");   // BUG: side effect
        if (next != null) next.handle(r);
    }
}

// Chain wrapped in retry on transient failure:
RetryWithBackoff.execute(() -> chain.handle(req));
// First call: email sent, downstream fails.
// Retry: email sent AGAIN, succeeds.
// Customer receives 2 emails. Or 5. Disaster.
```

**Bug.** EmailHandler is not idempotent. Retries cause duplicate side effects.

**Fix.** Idempotency key check:

```java
public class EmailHandler extends Handler {
    private final Set<String> sent = ConcurrentHashMap.newKeySet();

    public void handle(Request r) {
        String key = r.idempotencyKey() != null ? r.idempotencyKey() : r.id();
        if (sent.add(key)) {
            emailService.send(r.userEmail(), "purchase complete");
        }
        if (next != null) next.handle(r);
    }
}
```

For durability: store sent keys in DB / Redis. For Stripe-style: pass idempotency key to email service.

For retried chains: every handler with side effects MUST be idempotent. Audit: which steps make external calls? Each one needs idempotency.

---

## Bug 8: Silent error swallow

```java
public class ErrorHandler extends Handler {
    public void handle(Request r) {
        try {
            if (next != null) next.handle(r);
        } catch (Exception e) {
            // BUG: silently swallowed
        }
    }
}
```

**Bug.** Exceptions caught and dropped. Failures never surface. Critical bugs hidden.

**Fix.** Log + respond appropriately:

```java
public void handle(Request r) {
    try {
        if (next != null) next.handle(r);
    } catch (UnauthorizedException e) {
        r.response().send(401, "Unauthorized");
    } catch (NotFoundException e) {
        r.response().send(404, "Not Found");
    } catch (Exception e) {
        log.error("Internal error processing " + r, e);
        r.response().send(500, "Internal Server Error");
        // optionally: report to error tracker (Sentry, etc.)
    }
}
```

Empty catch is a bug 99% of the time. If you really mean "this can't happen": comment why and at least log if it does.

---

## Bug 9: Stack overflow in deep chain

```java
public abstract class Handler {
    protected Handler next;
    public abstract void handle(Request r);
}

// Auto-generated deep chain (e.g., one filter per route):
Handler chain = new Handler() { ... };
for (int i = 0; i < 100_000; i++) {
    chain.setNext(new PassThroughHandler());
}
chain.handle(req);   // StackOverflowError
```

**Bug.** Each handler's `next.handle(r)` is a stack frame. 100K handlers → 100K frames → stack overflow.

**Fix.** Iterative chain runner:

```java
public class ChainRunner {
    public void run(Handler head, Request r) {
        Handler current = head;
        while (current != null) {
            HandleResult result = current.handle(r);
            if (result == HandleResult.SHORT_CIRCUIT) return;
            current = current.next;
        }
    }
}
```

Each handler returns a result; runner iterates. No recursion.

Alternative: use a list:

```java
public void run(List<Handler> handlers, Request r) {
    for (Handler h : handlers) {
        if (h.handle(r) == HandleResult.SHORT_CIRCUIT) break;
    }
}
```

For 99% of cases (chain ≤ 50): recursion is fine. For pathological deep chains: iterative.

---

## Bug 10: Order-dependent assumption

```java
public class BusinessHandler extends Handler {
    public void handle(Request r) {
        User u = r.user();   // BUG: assumes AuthHandler ran
        process(u, r.body());
        if (next != null) next.handle(r);
    }
}

// Chain accidentally configured:
Handler chain = new LoggingHandler();
chain.setNext(new BusinessHandler())   // before auth!
     .setNext(new AuthHandler());

chain.handle(req);   // NullPointerException on r.user()
```

**Bug.** `BusinessHandler` assumes `AuthHandler` ran earlier. Reorder = NPE.

**Fix.** Self-validating handlers:

```java
public class BusinessHandler extends Handler {
    public void handle(Request r) {
        User u = r.user();
        if (u == null) throw new IllegalStateException("Auth not run; user missing");
        process(u, r.body());
        if (next != null) next.handle(r);
    }
}
```

Document chain order. Better: use typed context:

```java
public final class AuthenticatedRequest extends Request {
    public final User user;   // enforced by type
}

public class BusinessHandler extends TypedHandler<AuthenticatedRequest> {
    public void handle(AuthenticatedRequest r) {
        process(r.user, r.body());   // user always present
    }
}
```

Compiler enforces order: `BusinessHandler` only accepts `AuthenticatedRequest`, only producible after auth.

---

## Bug 11: Forgotten await in async chain

```javascript
async function compose(middlewares) {
    return async function handle(ctx) {
        let i = 0;
        async function next() {
            const mw = middlewares[i++];
            if (mw) mw(ctx, next);   // BUG: missing await
        }
        await next();
    };
}

// Logger:
async function logger(ctx, next) {
    const start = Date.now();
    await next();
    const elapsed = Date.now() - start;   // BUG: 0ms — next didn't await
    console.log(`${ctx.url} ${elapsed}ms`);
}
```

**Bug.** Without `await`, `mw(ctx, next)` returns a promise immediately; `await next()` resolves before downstream finishes. Onion model breaks; metrics wrong.

**Fix.** Await:

```javascript
async function next() {
    const mw = middlewares[i++];
    if (mw) await mw(ctx, next);   // await downstream
}
```

In TypeScript with proper types:

```typescript
type Middleware = (ctx: Ctx, next: () => Promise<void>) => Promise<void>;
```

Type system catches missing awaits if `next` returns `Promise<void>`.

---

## Bug 12: Race in concurrent counter handler

```java
public class HitCounter extends Handler {
    private final Map<String, Integer> hits = new HashMap<>();

    public void handle(Request r) {
        Integer current = hits.get(r.path());
        if (current == null) {
            hits.put(r.path(), 1);
        } else {
            hits.put(r.path(), current + 1);   // BUG: lost updates under concurrency
        }
        if (next != null) next.handle(r);
    }
}
```

**Bug.** Multiple threads increment same key concurrently. Both read same value, both write back same +1 — one increment lost. Also `HashMap` is not thread-safe.

**Fix.**

```java
public class HitCounter extends Handler {
    private final ConcurrentMap<String, AtomicInteger> hits = new ConcurrentHashMap<>();

    public void handle(Request r) {
        hits.computeIfAbsent(r.path(), k -> new AtomicInteger())
            .incrementAndGet();
        if (next != null) next.handle(r);
    }
}
```

`computeIfAbsent` is atomic; `AtomicInteger.incrementAndGet` is atomic. No locks; safe under concurrency.

For read-heavy: `LongAdder` is faster than `AtomicInteger` (sharded counters).

---

[← Tasks](tasks.md) · [Optimize →](optimize.md)
