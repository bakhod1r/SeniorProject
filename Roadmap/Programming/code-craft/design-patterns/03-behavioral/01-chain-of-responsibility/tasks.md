# Chain of Responsibility — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/chain-of-responsibility](https://refactoring.guru/design-patterns/chain-of-responsibility)

Each task has a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Expense approval](#task-1-expense-approval)
2. [Task 2: HTTP middleware (Java)](#task-2-http-middleware-java)
3. [Task 3: Validation chain (fail-fast)](#task-3-validation-chain-fail-fast)
4. [Task 4: Express-style functional middleware (Node.js)](#task-4-express-style-functional-middleware-nodejs)
5. [Task 5: Onion-model middleware (Koa-like)](#task-5-onion-model-middleware-koa-like)
6. [Task 6: Logging appender chain](#task-6-logging-appender-chain)
7. [Task 7: Async chain with CompletableFuture](#task-7-async-chain-with-completablefuture)
8. [Task 8: Iterative chain runner (no recursion)](#task-8-iterative-chain-runner-no-recursion)
9. [Task 9: Circuit breaker handler](#task-9-circuit-breaker-handler)
10. [Task 10: Refactor if/else cascade to CoR](#task-10-refactor-ifelse-cascade-to-cor)
11. [How to Practice](#how-to-practice)

---

## Task 1: Expense approval

**Brief.** Build approval chain: TeamLead < $100, Manager < $1000, Director < $10000, VP < $100000. Above → reject.

### Solution (Java)

```java
public abstract class Approver {
    protected Approver next;
    public Approver setNext(Approver next) { this.next = next; return next; }
    public abstract void approve(Request r);
}

public final class TeamLead extends Approver {
    public void approve(Request r) {
        if (r.amount() < 100) System.out.println("TeamLead approved: " + r);
        else if (next != null) next.approve(r);
    }
}

public final class Manager extends Approver {
    public void approve(Request r) {
        if (r.amount() < 1000) System.out.println("Manager approved: " + r);
        else if (next != null) next.approve(r);
    }
}

public final class Director extends Approver {
    public void approve(Request r) {
        if (r.amount() < 10000) System.out.println("Director approved: " + r);
        else if (next != null) next.approve(r);
    }
}

public final class VP extends Approver {
    public void approve(Request r) {
        if (r.amount() < 100000) System.out.println("VP approved: " + r);
        else System.out.println("Rejected: " + r);
    }
}

record Request(String item, double amount) {}

class Demo {
    public static void main(String[] args) {
        Approver chain = new TeamLead();
        chain.setNext(new Manager()).setNext(new Director()).setNext(new VP());

        chain.approve(new Request("pen", 5));
        chain.approve(new Request("laptop", 1500));
        chain.approve(new Request("conference", 30000));
        chain.approve(new Request("car", 200000));
    }
}
```

Each level checks its threshold; forwards if exceeds. Final VP rejects if even VP can't.

---

## Task 2: HTTP middleware (Java)

**Brief.** Build OO middleware chain: AuthMiddleware (rejects if no token), LogMiddleware (logs URL), BusinessMiddleware (final).

### Solution

```java
public abstract class Middleware {
    protected Middleware next;
    public Middleware setNext(Middleware next) { this.next = next; return next; }
    public abstract void handle(Request req, Response resp);
}

public final class AuthMiddleware extends Middleware {
    public void handle(Request req, Response resp) {
        if (!req.hasHeader("Authorization")) {
            resp.send(401, "Unauthorized");
            return;   // short-circuit
        }
        if (next != null) next.handle(req, resp);
    }
}

public final class LogMiddleware extends Middleware {
    public void handle(Request req, Response resp) {
        long start = System.currentTimeMillis();
        if (next != null) next.handle(req, resp);
        long elapsed = System.currentTimeMillis() - start;
        System.out.println(req.method() + " " + req.url() + " - " + elapsed + "ms");
    }
}

public final class BusinessMiddleware extends Middleware {
    public void handle(Request req, Response resp) {
        resp.send(200, "Hello " + req.user());
    }
}

// Build:
Middleware chain = new AuthMiddleware();
chain.setNext(new LogMiddleware()).setNext(new BusinessMiddleware());

chain.handle(req, resp);
```

`LogMiddleware` is onion-style: measures around `next`. `AuthMiddleware` is pure CoR: rejects without forwarding.

---

## Task 3: Validation chain (fail-fast)

**Brief.** Validate User: email, age (≥18), unique username. Stop on first failure.

### Solution (Python)

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class User:
    email: str
    age: int
    username: str


@dataclass
class Result:
    ok: bool
    error: str | None = None

    @staticmethod
    def success(): return Result(True)
    @staticmethod
    def fail(err: str): return Result(False, err)


class Rule(ABC):
    def __init__(self):
        self._next: Rule | None = None

    def set_next(self, rule: "Rule") -> "Rule":
        self._next = rule
        return rule

    def validate(self, u: User) -> Result:
        r = self.check(u)
        if not r.ok:
            return r
        if self._next:
            return self._next.validate(u)
        return Result.success()

    @abstractmethod
    def check(self, u: User) -> Result: ...


class EmailRule(Rule):
    def check(self, u: User) -> Result:
        return Result.success() if "@" in u.email else Result.fail("invalid email")


class AgeRule(Rule):
    def check(self, u: User) -> Result:
        return Result.success() if u.age >= 18 else Result.fail("under 18")


class UsernameRule(Rule):
    def __init__(self, taken: set[str]):
        super().__init__()
        self.taken = taken

    def check(self, u: User) -> Result:
        return Result.fail("username taken") if u.username in self.taken else Result.success()


chain = EmailRule()
chain.set_next(AgeRule()).set_next(UsernameRule({"alice", "bob"}))

print(chain.validate(User("test@example.com", 25, "charlie")))   # ok
print(chain.validate(User("invalid", 25, "charlie")))            # invalid email
print(chain.validate(User("a@b.com", 17, "charlie")))            # under 18
print(chain.validate(User("a@b.com", 25, "alice")))              # username taken
```

Each rule short-circuits on failure. Reorder = different first-error behavior.

---

## Task 4: Express-style functional middleware (Node.js)

**Brief.** Functional middleware chain. Each is `(req, res, next) => ...`. Compose.

### Solution

```javascript
function compose(middlewares) {
    return function handle(req, res) {
        let i = 0;
        function next() {
            const mw = middlewares[i++];
            if (mw) mw(req, res, next);
        }
        next();
    };
}

const logger = (req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
};

const auth = (req, res, next) => {
    if (!req.headers.authorization) {
        res.statusCode = 401;
        res.end("Unauthorized");
        return;   // no next() — short-circuit
    }
    next();
};

const handler = (req, res, _next) => {
    res.end("Hello!");
    // terminal — no next call
};

const app = compose([logger, auth, handler]);

// In real Express: app.use(logger); app.use(auth); app.use(handler);
```

Each middleware decides whether to call `next`. Skipping ends the chain.

---

## Task 5: Onion-model middleware (Koa-like)

**Brief.** Async middleware where each does pre + post work around `await next()`.

### Solution (TypeScript)

```typescript
type Context = { url: string; method: string; status?: number; body?: string };
type Next = () => Promise<void>;
type Middleware = (ctx: Context, next: Next) => Promise<void>;

function compose(middlewares: Middleware[]): (ctx: Context) => Promise<void> {
    return async (ctx) => {
        let i = 0;
        async function dispatch() {
            const mw = middlewares[i++];
            if (mw) await mw(ctx, dispatch);
        }
        await dispatch();
    };
}

const logger: Middleware = async (ctx, next) => {
    const start = Date.now();
    console.log(`> ${ctx.method} ${ctx.url}`);
    await next();
    const elapsed = Date.now() - start;
    console.log(`< ${ctx.status} (${elapsed}ms)`);
};

const auth: Middleware = async (ctx, next) => {
    // pre-check
    await next();
};

const handler: Middleware = async (ctx, _next) => {
    ctx.status = 200;
    ctx.body = "hello";
};

const app = compose([logger, auth, handler]);
await app({ url: "/", method: "GET" });
```

Output shows logger's pre-message *first*, post-message *last* — onion model in action.

---

## Task 6: Logging appender chain

**Brief.** Each appender has a min level. All appenders run (pipeline-style).

### Solution (Java)

```java
public enum Level { DEBUG, INFO, WARN, ERROR }

public record LogEntry(Level level, String message, long timestamp) {}

public abstract class Appender {
    protected Appender next;
    protected Level minLevel;

    public Appender(Level minLevel) { this.minLevel = minLevel; }

    public Appender setNext(Appender next) { this.next = next; return next; }

    public void log(LogEntry e) {
        if (e.level().ordinal() >= minLevel.ordinal()) {
            write(e);
        }
        if (next != null) next.log(e);   // always forward (pipeline)
    }

    protected abstract void write(LogEntry e);
}

public final class ConsoleAppender extends Appender {
    public ConsoleAppender(Level minLevel) { super(minLevel); }
    protected void write(LogEntry e) {
        System.out.printf("[%s] %s%n", e.level(), e.message());
    }
}

public final class FileAppender extends Appender {
    private final java.io.PrintWriter out;

    public FileAppender(Level minLevel, String path) throws java.io.IOException {
        super(minLevel);
        this.out = new java.io.PrintWriter(new java.io.FileWriter(path, true));
    }

    protected void write(LogEntry e) {
        out.printf("[%s] %s%n", e.level(), e.message());
        out.flush();
    }
}

public final class ErrorAlertAppender extends Appender {
    public ErrorAlertAppender(Level minLevel) { super(minLevel); }
    protected void write(LogEntry e) {
        System.err.println("ALERT: " + e.message());
        // send pager notification
    }
}

// Build:
Appender chain = new ConsoleAppender(Level.DEBUG);
chain.setNext(new FileAppender(Level.INFO, "app.log"))
     .setNext(new ErrorAlertAppender(Level.ERROR));

chain.log(new LogEntry(Level.INFO, "user logged in", System.currentTimeMillis()));
// → console writes (≥ DEBUG)
// → file writes (≥ INFO)
// → alert skips (< ERROR)
```

Each appender filters; all run. Hybrid CoR+Pipeline.

---

## Task 7: Async chain with CompletableFuture

**Brief.** Async chain where each handler returns `CompletableFuture`. Chain composes.

### Solution (Java)

```java
public abstract class AsyncHandler {
    protected AsyncHandler next;
    public AsyncHandler setNext(AsyncHandler next) { this.next = next; return next; }

    public CompletableFuture<Response> handle(Request req) {
        return process(req).thenCompose(processed ->
            next != null
                ? next.handle(processed)
                : CompletableFuture.completedFuture(new Response(200, "ok"))
        );
    }

    protected abstract CompletableFuture<Request> process(Request req);
}

public final class ValidateHandler extends AsyncHandler {
    protected CompletableFuture<Request> process(Request req) {
        return CompletableFuture.supplyAsync(() -> {
            if (req.body() == null) throw new IllegalArgumentException("empty");
            return req;
        });
    }
}

public final class AuthHandler extends AsyncHandler {
    protected CompletableFuture<Request> process(Request req) {
        return CompletableFuture.supplyAsync(() -> {
            // simulate async auth check
            return req.withUser(decodeToken(req.token()));
        });
    }
}

public final class BusinessHandler extends AsyncHandler {
    protected CompletableFuture<Request> process(Request req) {
        return CompletableFuture.supplyAsync(() -> {
            // do business work
            return req;
        });
    }
}

// Build:
AsyncHandler chain = new ValidateHandler();
chain.setNext(new AuthHandler()).setNext(new BusinessHandler());

CompletableFuture<Response> futureResp = chain.handle(req);
futureResp.thenAccept(System.out::println);
```

Each step returns a future; `thenCompose` chains them. Errors propagate via exception. Project Loom alternative: synchronous code with virtual threads.

---

## Task 8: Iterative chain runner (no recursion)

**Brief.** Avoid stack growth — handlers signal via return value.

### Solution (Java)

```java
public enum HandleResult { CONTINUE, SHORT_CIRCUIT }

public abstract class Handler {
    public abstract HandleResult handle(Request req);
}

public class ChainRunner {
    private final List<Handler> handlers;

    public ChainRunner(List<Handler> handlers) {
        this.handlers = handlers;
    }

    public void run(Request req) {
        for (Handler h : handlers) {
            HandleResult r = h.handle(req);
            if (r == HandleResult.SHORT_CIRCUIT) return;
        }
    }
}

public class AuthHandler extends Handler {
    public HandleResult handle(Request req) {
        if (req.token() == null) {
            req.response().send(401);
            return HandleResult.SHORT_CIRCUIT;
        }
        return HandleResult.CONTINUE;
    }
}

// Usage:
ChainRunner runner = new ChainRunner(List.of(
    new AuthHandler(),
    new LogHandler(),
    new BusinessHandler()
));
runner.run(req);
```

No `next` references; runner iterates. Works for 1M-deep chain (limited only by RAM, not stack). Trade-off: lose onion model (no pre+post wrapping easily).

---

## Task 9: Circuit breaker handler

**Brief.** Wrap downstream call in circuit breaker. States: closed, open, half-open.

### Solution (Java)

```java
public final class CircuitBreaker {
    enum State { CLOSED, OPEN, HALF_OPEN }

    private State state = State.CLOSED;
    private int failures = 0;
    private long openedAt = 0;

    private final int failureThreshold = 5;
    private final long timeoutMs = 30_000;

    public synchronized boolean allow() {
        if (state == State.CLOSED) return true;
        if (state == State.OPEN && System.currentTimeMillis() - openedAt > timeoutMs) {
            state = State.HALF_OPEN;
            return true;   // try one
        }
        return state == State.HALF_OPEN;
    }

    public synchronized void recordSuccess() {
        failures = 0;
        state = State.CLOSED;
    }

    public synchronized void recordFailure() {
        failures++;
        if (failures >= failureThreshold) {
            state = State.OPEN;
            openedAt = System.currentTimeMillis();
        }
    }
}

public class CircuitBreakerHandler extends Handler {
    private final CircuitBreaker cb = new CircuitBreaker();

    public void handle(Request req) {
        if (!cb.allow()) {
            req.response().send(503, "Service Unavailable");
            return;
        }
        try {
            if (next != null) next.handle(req);
            cb.recordSuccess();
        } catch (Exception e) {
            cb.recordFailure();
            throw e;
        }
    }
}
```

Production: use Resilience4j's `CircuitBreaker` — has hold-time, ring buffer, sliding window, etc.

---

## Task 10: Refactor if/else cascade to CoR

**Brief.** Convert this:

```java
public class TicketRouter {
    public void route(Ticket t) {
        if (t.priority() == HIGH) {
            seniorTeam.handle(t);
        } else if (t.priority() == MEDIUM) {
            midTeam.handle(t);
        } else if (t.priority() == LOW) {
            juniorTeam.handle(t);
        } else if (t.category().equals("BUG")) {
            qaTeam.handle(t);
        } else {
            backlog.add(t);
        }
    }
}
```

### Solution

```java
public abstract class TicketHandler {
    protected TicketHandler next;
    public TicketHandler setNext(TicketHandler next) { this.next = next; return next; }
    public abstract void handle(Ticket t);
}

public final class SeniorTeamHandler extends TicketHandler {
    public void handle(Ticket t) {
        if (t.priority() == Priority.HIGH) System.out.println("Senior team: " + t);
        else if (next != null) next.handle(t);
    }
}

public final class MidTeamHandler extends TicketHandler {
    public void handle(Ticket t) {
        if (t.priority() == Priority.MEDIUM) System.out.println("Mid team: " + t);
        else if (next != null) next.handle(t);
    }
}

public final class JuniorTeamHandler extends TicketHandler {
    public void handle(Ticket t) {
        if (t.priority() == Priority.LOW) System.out.println("Junior team: " + t);
        else if (next != null) next.handle(t);
    }
}

public final class QATeamHandler extends TicketHandler {
    public void handle(Ticket t) {
        if ("BUG".equals(t.category())) System.out.println("QA team: " + t);
        else if (next != null) next.handle(t);
    }
}

public final class BacklogHandler extends TicketHandler {
    public void handle(Ticket t) {
        System.out.println("Backlog: " + t);
    }
}

// Build:
TicketHandler chain = new SeniorTeamHandler();
chain.setNext(new MidTeamHandler())
     .setNext(new JuniorTeamHandler())
     .setNext(new QATeamHandler())
     .setNext(new BacklogHandler());

chain.handle(ticket);
```

**Better still:** for one-shot routing, a `Map<Predicate, Handler>` is simpler than CoR. Use CoR when handlers need to compose, share context, or be reordered dynamically.

---

## How to Practice

- **Build expense approval first.** Smallest meaningful CoR.
- **Then HTTP middleware.** Real-world; pre+post style.
- **Try Express-style functional next.** Different idiom.
- **Onion model.** Important production pattern.
- **Try the iterative runner.** Avoids stack growth.
- **Add a circuit breaker.** See how observability/resilience layer in.
- **Read source code.** Spring's `OncePerRequestFilter`, Express's `app.use`, Servlet's `FilterChain` — all canonical.
- **Profile a chain.** Build a 10-deep chain; benchmark with JMH; observe JIT inlining effects.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
