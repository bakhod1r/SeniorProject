# Mediator — Optimize

> **Source:** [refactoring.guru/design-patterns/mediator](https://refactoring.guru/design-patterns/mediator)

Each section presents a Mediator that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Split god-class Mediator into hierarchy](#optimization-1-split-god-class-mediator-into-hierarchy)
2. [Optimization 2: Async dispatch for I/O-bound notifications](#optimization-2-async-dispatch-for-io-bound-notifications)
3. [Optimization 3: Replace string events with enum or typed methods](#optimization-3-replace-string-events-with-enum-or-typed-methods)
4. [Optimization 4: Per-shard Mediator for horizontal scale](#optimization-4-per-shard-mediator-for-horizontal-scale)
5. [Optimization 5: Idempotency cache to skip duplicate steps](#optimization-5-idempotency-cache-to-skip-duplicate-steps)
6. [Optimization 6: Batch saga steps where possible](#optimization-6-batch-saga-steps-where-possible)
7. [Optimization 7: Replace synchronized notify with concurrent maps](#optimization-7-replace-synchronized-notify-with-concurrent-maps)
8. [Optimization 8: Use workflow engine for durable Mediators](#optimization-8-use-workflow-engine-for-durable-mediators)
9. [Optimization 9: Pre-compile dispatch tables](#optimization-9-pre-compile-dispatch-tables)
10. [Optimization 10: Drop Mediator when only two components](#optimization-10-drop-mediator-when-only-two-components)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Split god-class Mediator into hierarchy

### Before

```typescript
class PageController {
    onHeaderEvent(...) { ... }
    onFormFieldChanged(...) { ... }
    onFormSubmit(...) { ... }
    onSidebarClick(...) { ... }
    onFooterEvent(...) { ... }
    // 50+ methods, 2000+ lines
}
```

Every change requires understanding the whole class.

### After

```typescript
class PageMediator {
    private header = new HeaderMediator(this);
    private form = new FormMediator(this);
    private sidebar = new SidebarMediator(this);
    private footer = new FooterMediator(this);

    notify(source, event, data?) {
        // route between sub-mediators only
        if (source === 'form' && event === 'submitted') this.handleSubmit(data);
    }
}
```

**Measurement.** Lines per class drops; cognitive load drops. Each mediator can be tested independently.

**Lesson:** A god-class Mediator is just complexity in disguise. Split by sub-domain; each level handles its own concerns.

---

## Optimization 2: Async dispatch for I/O-bound notifications

### Before

```java
public void notify(Component s, String event) {
    for (Component c : components) c.handle(event);   // some Components do I/O
}
```

Notification latency = sum of all Component handlers, including I/O.

### After

```java
private final ExecutorService exec = Executors.newFixedThreadPool(8);

public void notify(Component s, String event) {
    for (Component c : components) {
        exec.submit(() -> {
            try { c.handle(event); }
            catch (Exception e) { log.error("handler", e); }
        });
    }
}
```

**Measurement.** Notify latency: sum → constant. I/O parallelized.

**Trade-off.** Ordering across handlers lost; errors must be handled per-task.

**Lesson:** Sync dispatch for cheap, in-memory handlers. Async for anything I/O-bound.

---

## Optimization 3: Replace string events with enum or typed methods

### Before

```java
mediator.notify(this, "submit-clicked");

// In Mediator:
if ("submit-clicked".equals(event)) handleSubmit();
else if ("cancel-clicked".equals(event)) handleCancel();
```

String comparison per call; typos compile fine.

### After

```java
public interface DialogMediator {
    void onSubmitClicked();
    void onCancelClicked();
}

class SubmitButton {
    public void onClick() { mediator.onSubmitClicked(); }
}
```

**Measurement.** No string comparison; direct method dispatch (sub-ns). Compile-time safety.

**Lesson:** Typed methods are faster AND safer. Use them.

---

## Optimization 4: Per-shard Mediator for horizontal scale

### Before

```java
public final class GlobalOrchestrator {
    public synchronized void process(WorkflowId id, Event e) { ... }
}
```

One Mediator handles all workflows. Single thread bottleneck.

### After

```java
public final class ShardedOrchestrator {
    private final Orchestrator[] shards = new Orchestrator[16];

    public void process(WorkflowId id, Event e) {
        int shard = (id.hashCode() & 0x7FFFFFFF) % shards.length;
        shards[shard].process(id, e);
    }
}
```

Each shard processes its workflows independently.

**Measurement.** Throughput scales linearly with shard count, up to core count.

**Lesson:** Shard by workflow ID for stateful Mediators. Avoids cross-shard coordination.

---

## Optimization 5: Idempotency cache to skip duplicate steps

### Before

```python
async def step(self, name, action):
    await action()   # always runs; retry → duplicate work
```

### After

```python
class Orchestrator:
    def __init__(self, idempotency):
        self.idempotency = idempotency

    async def step(self, name, key, action):
        if self.idempotency.seen(key):
            print(f"dedup: {key}")
            return
        await action()
        self.idempotency.record(key)
```

**Measurement.** Retried steps skip; no duplicate work. Saves CPU and external calls.

**Lesson:** Distributed Mediator + at-least-once = duplicate steps. Idempotency cache is essential.

---

## Optimization 6: Batch saga steps where possible

### Before

```python
async def place_orders(self, orders):
    for order in orders:
        await self.payment.charge(order)
        await self.inventory.reserve(order)
        await self.shipping.dispatch(order)
```

Sequential per order; per-call overhead dominates.

### After

```python
async def place_orders(self, orders):
    await self.payment.charge_batch(orders)
    await self.inventory.reserve_batch(orders)
    await self.shipping.dispatch_batch(orders)
```

**Measurement.** 100 orders: 100 round-trips → 3 round-trips. Throughput jumps ~30×.

**Trade-off.** Failure semantics: if `charge_batch` partially fails, what happens? Must handle.

**Lesson:** Batch external calls when the protocol supports it. Saga step latency drops dramatically.

---

## Optimization 7: Replace synchronized notify with concurrent maps

### Before

```java
public synchronized void notify(Component s, String event) {
    for (Listener l : listeners.get(event)) l.handle(s);
}
```

Lock around dispatch.

### After

```java
private final Map<String, List<Listener>> listeners = new ConcurrentHashMap<>();
// listeners per event use CopyOnWriteArrayList

public void notify(Component s, String event) {
    var lst = listeners.getOrDefault(event, List.of());
    for (Listener l : lst) l.handle(s);
}
```

**Measurement.** Lock removed from hot path. Dispatch parallelizes across threads.

**Lesson:** Hot Mediator dispatch should be lock-free. ConcurrentHashMap + CopyOnWriteArrayList is the standard pair.

---

## Optimization 8: Use workflow engine for durable Mediators

### Before

```python
class CustomOrchestrator:
    def __init__(self, db):
        self.db = db
    async def run(self, workflow_id):
        state = self.db.load(workflow_id)
        # ... custom retry logic, state persistence ...
```

Hand-rolled durability. Bugs everywhere; observability poor.

### After

```python
@workflow.defn
class OrderWorkflow:
    @workflow.run
    async def run(self, order):
        await workflow.execute_activity(charge, order, schedule_to_close_timeout=timedelta(minutes=5))
        await workflow.execute_activity(reserve, order)
        await workflow.execute_activity(ship, order)
```

Temporal handles state, retries, observability.

**Measurement.** Lines of code drops. Durability and observability improve dramatically. Operational tax: running Temporal cluster.

**Lesson:** Don't reinvent durable orchestration. Workflow engines are battle-tested.

---

## Optimization 9: Pre-compile dispatch tables

### Before

```java
public void notify(Component s, String event) {
    if (sender == username && event.equals("changed")) handleUsernameChange();
    else if (sender == password && event.equals("changed")) handlePasswordChange();
    else if (sender == submit && event.equals("clicked")) handleSubmit();
    // ... many more cases
}
```

Long if-else chain.

### After

```java
private final Map<Object, Map<String, Runnable>> dispatch = Map.of(
    username, Map.of("changed", this::handleUsernameChange),
    password, Map.of("changed", this::handlePasswordChange),
    submit, Map.of("clicked", this::handleSubmit)
);

public void notify(Component s, String event) {
    Map<String, Runnable> events = dispatch.get(s);
    if (events != null) {
        Runnable r = events.get(event);
        if (r != null) r.run();
    }
}
```

**Measurement.** Constant-time dispatch instead of linear if-else. For small switches, JIT may match; for large, table is clearly faster.

**Trade-off.** Less readable. Use when dispatch table is large.

**Lesson:** Mediator dispatch can be table-driven. Simpler conditional dispatch (10 cases) — leave as if-else; large dispatch — table.

---

## Optimization 10: Drop Mediator when only two components

### Before

```java
public final class ButtonAndLabelMediator {
    private final Button btn;
    private final Label lbl;
    public void notify(Component s, String event) {
        if (s == btn) lbl.setText("clicked");
    }
}
```

Two components, one interaction. Mediator is overhead.

### After

```java
button.onClick(() -> label.setText("clicked"));
```

**Measurement.** Less code. No indirection.

**Lesson:** Mediator earns its weight at N ≥ 3 components with non-trivial interactions. For two, direct callbacks suffice.

---

## Optimization Tips

- **Split god-class Mediators.** Cognitive load drops; tests improve.
- **Async dispatch for I/O handlers.** Don't make notify the bottleneck.
- **Typed methods over magic strings.** Faster, safer.
- **Shard stateful Mediators.** Linear scale by partition.
- **Idempotency caches in distributed Mediators.** Free deduplication.
- **Batch external calls.** Per-call overhead dominates serial calls.
- **Lock-free concurrent maps.** Remove `synchronized` from hot dispatch.
- **Use workflow engines for durability.** Don't reinvent.
- **Table-driven dispatch for large switches.** Constant-time lookup.
- **Drop Mediator when overkill.** Two components don't need it.
- **Profile before optimizing.** Mediator dispatch is rarely the bottleneck.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
