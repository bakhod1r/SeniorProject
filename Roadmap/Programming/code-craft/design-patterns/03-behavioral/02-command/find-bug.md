# Command — Find the Bug

> **Source:** [refactoring.guru/design-patterns/command](https://refactoring.guru/design-patterns/command)

Each section presents a Command that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Undo without snapshot](#bug-1-undo-without-snapshot)
2. [Bug 2: Mutable Command shared between threads](#bug-2-mutable-command-shared-between-threads)
3. [Bug 3: Redo stack not cleared on new execute](#bug-3-redo-stack-not-cleared-on-new-execute)
4. [Bug 4: Macro partial failure leaves bad state](#bug-4-macro-partial-failure-leaves-bad-state)
5. [Bug 5: Idempotency key reused across operations](#bug-5-idempotency-key-reused-across-operations)
6. [Bug 6: Command holds stale reference](#bug-6-command-holds-stale-reference)
7. [Bug 7: Async Command swallows exceptions](#bug-7-async-command-swallows-exceptions)
8. [Bug 8: Compensating action is itself non-idempotent](#bug-8-compensating-action-is-itself-non-idempotent)
9. [Bug 9: Macro undo in execute order, not reverse](#bug-9-macro-undo-in-execute-order-not-reverse)
10. [Bug 10: Command serialization holds non-serializable resource](#bug-10-command-serialization-holds-non-serializable-resource)
11. [Bug 11: Outbox dispatcher race](#bug-11-outbox-dispatcher-race)
12. [Bug 12: Idempotency store grows unbounded](#bug-12-idempotency-store-grows-unbounded)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Undo without snapshot

```java
class ReplaceTextCommand implements Command {
    private final Document doc;
    private final String newText;

    public ReplaceTextCommand(Document d, String t) { this.doc = d; this.newText = t; }
    public void execute() { doc.setText(newText); }
    public void undo()    { doc.setText("");  /* what to restore? */ }
}
```

Undo always sets the text to empty.

<details><summary>Reveal</summary>

**Bug:** Undo doesn't restore the previous state — it sets a hardcoded empty string. The "before" state was never captured.

**Fix:** snapshot the old text in execute, restore it in undo.

```java
class ReplaceTextCommand implements Command {
    private final Document doc;
    private final String newText;
    private String oldText;

    public void execute() {
        oldText = doc.text();
        doc.setText(newText);
    }
    public void undo() { doc.setText(oldText); }
}
```

**Lesson:** When `undo` can't compute the inverse, snapshot. Undo is responsibility of the Command, not the document.

</details>

---

## Bug 2: Mutable Command shared between threads

```java
class IncrementCommand implements Command {
    private int attempts = 0;

    public void execute() {
        attempts++;
        counter.inc();
    }
    public int attempts() { return attempts; }
}

// Shared instance, two threads call execute().
```

Sometimes `attempts` shows 1 instead of 2.

<details><summary>Reveal</summary>

**Bug:** Race on `attempts++`. Without synchronization, increments can be lost.

**Fix:** make Commands immutable (no mutable state), or use atomic counters.

```java
private final AtomicInteger attempts = new AtomicInteger();
public void execute() { attempts.incrementAndGet(); counter.inc(); }
```

Better: don't share Commands across threads. Each invocation should get a fresh instance, or the Command should be a value (no mutable state at all).

**Lesson:** Commands shared concurrently must be immutable or properly synchronized. Default to immutable values.

</details>

---

## Bug 3: Redo stack not cleared on new execute

```java
class History {
    private Deque<Command> undo = new ArrayDeque<>();
    private Deque<Command> redo = new ArrayDeque<>();

    public void execute(Command c) {
        c.execute();
        undo.push(c);
        // BUG: redo not cleared
    }

    public void undo() {
        if (undo.isEmpty()) return;
        Command c = undo.pop();
        c.undo();
        redo.push(c);
    }

    public void redo() {
        if (redo.isEmpty()) return;
        Command c = redo.pop();
        c.execute();
        undo.push(c);
    }
}
```

Steps: execute(A); undo(); execute(B); redo(). The redo replays A — but A was undone, and B was just executed. State is now incoherent.

<details><summary>Reveal</summary>

**Bug:** A new `execute` doesn't clear the redo stack. After "undo + new execute," redo holds stale commands that no longer make sense in the new history.

**Fix:**

```java
public void execute(Command c) {
    c.execute();
    undo.push(c);
    redo.clear();   // any new action invalidates redo
}
```

**Lesson:** Redo invariant: only valid immediately after an undo, before any new execute. Branching the history breaks redo.

</details>

---

## Bug 4: Macro partial failure leaves bad state

```java
class MacroCommand implements Command {
    private final List<Command> cmds;

    public void execute() {
        for (Command c : cmds) c.execute();   // step 3 throws → 1 and 2 are committed; 4 and 5 not
    }
}
```

In production, multi-step user actions sometimes leave the system in a weird state.

<details><summary>Reveal</summary>

**Bug:** No rollback on partial failure. If step 3 throws, steps 1 and 2 stay committed; steps 4 and 5 never run.

**Fix:** track what executed; undo on failure.

```java
public void execute() {
    List<Command> done = new ArrayList<>();
    try {
        for (Command c : cmds) {
            c.execute();
            done.add(c);
        }
    } catch (Exception e) {
        for (int i = done.size() - 1; i >= 0; i--) {
            try { done.get(i).undo(); }
            catch (Exception ex) { /* log */ }
        }
        throw e;
    }
}
```

Or document the macro as non-transactional and let callers handle.

**Lesson:** Macros need an explicit failure policy: roll back, ignore, or compensate. Decide upfront.

</details>

---

## Bug 5: Idempotency key reused across operations

```python
def submit(idempotency_key: str, fn: Callable):
    if idempotency_key in cache: return cache[idempotency_key]
    result = fn()
    cache[idempotency_key] = result
    return result

# Caller:
result = submit("user-123", lambda: charge_card(100))
# Later, different operation:
result = submit("user-123", lambda: send_welcome_email())
# Returns the cached charge result, never sends email!
```

<details><summary>Reveal</summary>

**Bug:** The idempotency key is shared across different operations. The cache returns a stale result of a different operation.

**Fix:** scope the key to the operation type.

```python
def submit(operation: str, idempotency_key: str, fn: Callable):
    full_key = f"{operation}:{idempotency_key}"
    ...
```

Or: have the caller generate unique keys per Command, e.g., a UUID generated at request time.

**Lesson:** Idempotency keys are per-Command, not per-user. Mixing them silently corrupts the cache.

</details>

---

## Bug 6: Command holds stale reference

```java
class DeleteUserCommand implements Command {
    private final User user;   // reference captured at creation

    public DeleteUserCommand(User u) { this.user = u; }
    public void execute() {
        userRepo.delete(user.id());   // user might be a stale snapshot
    }
}

// Created at time T1; executed at T2.
```

In production, sometimes the wrong record is deleted.

<details><summary>Reveal</summary>

**Bug:** The Command holds a reference to a User object captured at creation. Between creation and execution, the user was deleted and a new one with the same ID was created. Command deletes the new one.

**Fix:** capture the **ID** (a value), not the **object** (a reference).

```java
class DeleteUserCommand implements Command {
    private final String userId;

    public DeleteUserCommand(String id) { this.userId = id; }
    public void execute() { userRepo.delete(userId); }
}
```

For optimistic concurrency, also capture a version:

```java
public DeleteUserCommand(String id, long version) { ... }
public void execute() {
    int rows = userRepo.deleteIfVersion(userId, version);
    if (rows == 0) throw new ConcurrentModificationException();
}
```

**Lesson:** Commands are values. They should hold values, not references — especially when execution is delayed.

</details>

---

## Bug 7: Async Command swallows exceptions

```java
public void dispatch(Command cmd) {
    executor.submit(() -> cmd.execute());
    // No exception handling
}
```

In production, some Commands fail silently. Logs show nothing.

<details><summary>Reveal</summary>

**Bug:** The submitted task throws; the resulting Future is never inspected. JDK's `submit` swallows the exception.

**Fix:**

```java
public Future<?> dispatch(Command cmd) {
    return executor.submit(() -> {
        try { cmd.execute(); }
        catch (Exception e) { log.error("command failed", e); throw e; }
    });
}
```

Or use `CompletableFuture` and attach `.exceptionally()`:

```java
return CompletableFuture.runAsync(cmd::execute, executor)
    .exceptionally(ex -> { log.error("command failed", ex); return null; });
```

**Lesson:** Async dispatch needs explicit error handling. Submitted Futures don't auto-log; you must inspect them.

</details>

---

## Bug 8: Compensating action is itself non-idempotent

```java
class RefundCharge implements Command {
    public void execute() {
        paymentService.refund(chargeId);   // creates a new refund every time
    }
}
```

Saga retries the compensation; multiple refunds occur for the same charge.

<details><summary>Reveal</summary>

**Bug:** `RefundCharge` is not idempotent. Retries create duplicate refunds.

**Fix:** check-then-act with idempotency.

```java
public void execute() {
    if (paymentService.alreadyRefunded(chargeId)) return;
    paymentService.refund(chargeId);
}
```

Or use the payment provider's idempotency key:

```java
paymentService.refund(chargeId, idempotencyKey);
```

**Lesson:** Compensating actions are Commands too — they must be idempotent. Especially since they often run in error-handling paths that retry.

</details>

---

## Bug 9: Macro undo in execute order, not reverse

```java
class MacroCommand implements Command {
    public void undo() {
        for (Command c : cmds) c.undo();   // BUG: forward order
    }
}
```

Tests pass for independent commands. In production, dependent commands corrupt state.

<details><summary>Reveal</summary>

**Bug:** Undo runs in execute order. For dependent commands (`addUser`, `assignRole`), undoing `addUser` first removes the user; then undoing `assignRole` fails because the user is gone.

**Fix:** undo in reverse order.

```java
public void undo() {
    for (int i = cmds.size() - 1; i >= 0; i--) cmds.get(i).undo();
}
```

**Lesson:** Undo runs in the opposite order of execute. Like nested function calls — last in, first out.

</details>

---

## Bug 10: Command serialization holds non-serializable resource

```java
class SendEmailCommand implements Command, Serializable {
    private final EmailService service;   // not serializable
    private final String to;
    private final String body;

    public void execute() { service.send(to, body); }
}

// Push to Kafka:
producer.send("email-queue", commandBytes);   // fails
```

<details><summary>Reveal</summary>

**Bug:** `EmailService` (with DB connections, config) can't serialize. Including it in the Command breaks transmission.

**Fix:** Commands hold *data*, not *services*. The Receiver is looked up at the destination.

```java
class SendEmailCommand implements Command {
    public final String to;
    public final String body;
    // NO service field
}

// At the destination:
class EmailHandler {
    private final EmailService service;
    public void handle(SendEmailCommand cmd) {
        service.send(cmd.to, cmd.body);
    }
}
```

**Lesson:** Commands transmitted across processes must be pure data. Resources (connections, services) live at each end.

</details>

---

## Bug 11: Outbox dispatcher race

```java
@Scheduled(fixedDelay = 100)
public void drain() {
    var batch = outboxRepo.findUndispatched(100);
    for (var entry : batch) {
        broker.publish(entry);
        outboxRepo.markDispatched(entry.id());
    }
}
```

Two dispatcher instances run; sometimes the same event is published twice.

<details><summary>Reveal</summary>

**Bug:** Two instances both fetch undispatched rows; both publish. No coordination.

**Fix:** Use `SELECT ... FOR UPDATE SKIP LOCKED` (Postgres) so different workers see different rows.

```sql
SELECT * FROM outbox
WHERE dispatched_at IS NULL
ORDER BY id
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Each transaction locks rows it claims; other workers skip them. After processing, mark dispatched and commit.

Alternatively: shard by hash; each worker handles its shard.

**Lesson:** When multiple workers process a shared queue, ensure only one claims each item. `SKIP LOCKED` is the standard SQL solution.

</details>

---

## Bug 12: Idempotency store grows unbounded

```python
seen: dict[str, object] = {}

def submit(key: str, fn):
    if key in seen: return seen[key]
    result = fn()
    seen[key] = result
    return result
```

After weeks of traffic, OOM.

<details><summary>Reveal</summary>

**Bug:** Idempotency keys accumulate forever. Memory grows linearly with traffic.

**Fix:** TTL on each entry.

```python
import time
from cachetools import TTLCache

seen = TTLCache(maxsize=1_000_000, ttl=86_400)   # 24-hour TTL
```

Or use Redis with `EX` parameter:

```redis
SET idemp:<key> <result> NX EX 86400
```

**Lesson:** Idempotency stores must have a TTL. Choose based on retry windows; 24 hours is a common default.

</details>

---

## Practice Tips

- **Always plan undo before the Command exists.** It's harder to retrofit.
- **Capture values, not references** in Commands that are stored or transmitted.
- **Make compensations idempotent.** They run during error paths that retry.
- **Macro undo runs in reverse order.** Always.
- **Async dispatch needs explicit error handling.** Don't rely on stack traces — they don't propagate.
- **Idempotency keys need scope** (per-operation, not just per-user).
- **Idempotency stores need TTL.** Or you're building a memory leak.
- **`SELECT FOR UPDATE SKIP LOCKED` for shared work queues.**
- **Commands transmitted across processes are pure data.** No service refs.
- **Test with deliberate failure injection.** Macros, sagas, async — all hide bugs that only appear under failure.

[← Tasks](tasks.md) · [Optimize →](optimize.md)
