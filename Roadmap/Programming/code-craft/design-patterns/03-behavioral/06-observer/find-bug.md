# Observer — Find the Bug

> **Source:** [refactoring.guru/design-patterns/observer](https://refactoring.guru/design-patterns/observer)

Each section presents an Observer that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: ConcurrentModificationException during dispatch](#bug-1-concurrentmodificationexception-during-dispatch)
2. [Bug 2: One bad observer breaks the chain](#bug-2-one-bad-observer-breaks-the-chain)
3. [Bug 3: Memory leak from never-unsubscribed observer](#bug-3-memory-leak-from-never-unsubscribed-observer)
4. [Bug 4: Cyclic notifications](#bug-4-cyclic-notifications)
5. [Bug 5: Race on the listener list](#bug-5-race-on-the-listener-list)
6. [Bug 6: Push vs pull data race](#bug-6-push-vs-pull-data-race)
7. [Bug 7: Async dispatch with shared mutable event](#bug-7-async-dispatch-with-shared-mutable-event)
8. [Bug 8: `equals` confusion in unsubscribe](#bug-8-equals-confusion-in-unsubscribe)
9. [Bug 9: Order dependency between observers](#bug-9-order-dependency-between-observers)
10. [Bug 10: Subscribe inside a constructor](#bug-10-subscribe-inside-a-constructor)
11. [Bug 11: Missing per-handler exception isolation in async](#bug-11-missing-per-handler-exception-isolation-in-async)
12. [Bug 12: SSE / WebSocket leak on disconnect](#bug-12-sse-websocket-leak-on-disconnect)
13. [Practice Tips](#practice-tips)

---

## Bug 1: ConcurrentModificationException during dispatch

```java
public final class Bus {
    private final List<Listener> listeners = new ArrayList<>();
    public void subscribe(Listener l)   { listeners.add(l); }
    public void unsubscribe(Listener l) { listeners.remove(l); }
    public void publish(Event e) {
        for (Listener l : listeners) l.on(e);
    }
}

// One listener unsubscribes itself in on(...).
```

In production, intermittent `ConcurrentModificationException`.

<details><summary>Reveal</summary>

**Bug:** A listener modifies the `listeners` list during iteration. `ArrayList`'s iterator detects the modification and throws.

**Fix:** snapshot before iterating, or use `CopyOnWriteArrayList`.

```java
public void publish(Event e) {
    for (Listener l : new ArrayList<>(listeners)) l.on(e);
}
```

Or:

```java
private final List<Listener> listeners = new CopyOnWriteArrayList<>();
```

**Lesson:** The dispatch loop runs while observers might modify the list. Either snapshot or use a copy-on-write collection.

</details>

---

## Bug 2: One bad observer breaks the chain

```java
public void publish(Event e) {
    for (Listener l : listeners) {
        l.on(e);   // any listener throwing kills the loop
    }
}
```

In production, sometimes only some listeners run; the rest are skipped. Logs show a `NullPointerException`.

<details><summary>Reveal</summary>

**Bug:** No per-listener try/catch. The first listener that throws aborts the loop — subsequent listeners never run.

**Fix:** wrap each invocation.

```java
for (Listener l : listeners) {
    try { l.on(e); }
    catch (Exception ex) { log.error("listener failed", ex); }
}
```

**Lesson:** In a broadcast chain, one observer's failure must not affect the rest. Always isolate.

</details>

---

## Bug 3: Memory leak from never-unsubscribed observer

```java
public final class GlobalBus {
    public static final GlobalBus INSTANCE = new GlobalBus();
    private final List<Listener> listeners = new ArrayList<>();
    public void subscribe(Listener l) { listeners.add(l); }
}

// In a request-scoped object:
public final class RequestHandler {
    public RequestHandler() {
        GlobalBus.INSTANCE.subscribe(e -> handle(e));
    }
    public void handle(Event e) { /* ... */ }
}
```

After hours, memory grows. Heap dump shows millions of `RequestHandler` instances.

<details><summary>Reveal</summary>

**Bug:** Each `RequestHandler` subscribes; the `GlobalBus` holds a strong reference to the lambda; the lambda captures `this`. The `RequestHandler` can never be GC'd. Classic Observer leak.

**Fix:** unsubscribe in lifecycle / use weak references.

```java
public final class RequestHandler implements Closeable {
    private final Listener l = e -> handle(e);
    public RequestHandler() { GlobalBus.INSTANCE.subscribe(l); }
    public void close() { GlobalBus.INSTANCE.unsubscribe(l); }
}
```

Or:

```java
private final List<WeakReference<Listener>> refs = new CopyOnWriteArrayList<>();
```

**Lesson:** Long-lived subjects + short-lived observers = leaks unless cleaned up. Manage lifecycle explicitly or use weak refs.

</details>

---

## Bug 4: Cyclic notifications

```java
class Bus {
    void publish(Event e) { for (Listener l : listeners) l.on(e); }
}

class A implements Listener {
    public void on(Event e) {
        bus.publish(new Event());   // re-publishes
    }
}
```

Stack overflow.

<details><summary>Reveal</summary>

**Bug:** Listener publishes the event that caused it to be invoked. Infinite loop until the stack runs out.

**Fix:** detect cycles or restructure.

```java
class Bus {
    private final ThreadLocal<Boolean> inDispatch = ThreadLocal.withInitial(() -> false);

    void publish(Event e) {
        if (inDispatch.get()) {
            log.warn("nested publish; skipping or queueing");
            return;
        }
        inDispatch.set(true);
        try { /* dispatch */ } finally { inDispatch.set(false); }
    }
}
```

Or model as a state machine: listener emits a *different* event type that closes the loop.

**Lesson:** Observer chains are easy to make cyclic. Detect or design out cycles.

</details>

---

## Bug 5: Race on the listener list

```java
class Bus {
    private final List<Listener> listeners = new ArrayList<>();   // not thread-safe

    public void subscribe(Listener l) { listeners.add(l); }
    public void publish(Event e) {
        for (Listener l : listeners) l.on(e);
    }
}
```

Threads A subscribe; thread B publishes. Sometimes B sees an inconsistent list (NPE during iteration, or recent subscriptions missing).

<details><summary>Reveal</summary>

**Bug:** `ArrayList` is not thread-safe. Concurrent reads + writes have undefined behavior in the JMM.

**Fix:** use a thread-safe collection.

```java
private final List<Listener> listeners = new CopyOnWriteArrayList<>();
```

Or synchronize externally.

**Lesson:** Subscriber lists in multi-threaded code must use thread-safe collections. `CopyOnWriteArrayList` is purpose-built for this case.

</details>

---

## Bug 6: Push vs pull data race

```java
class WeatherStation {
    private double temp;
    private List<Listener> listeners;

    public void setTemp(double t) {
        notifyAll();   // observers pull
        this.temp = t;   // BUG: order
    }

    private void notifyAll() {
        for (Listener l : listeners) l.onChanged(this);   // pulls .getTemp() — old value!
    }

    public double getTemp() { return temp; }
}
```

Observers read the old temp.

<details><summary>Reveal</summary>

**Bug:** State updated AFTER notifications. Observers pull the stale value.

**Fix:** update first, notify after.

```java
public void setTemp(double t) {
    this.temp = t;
    notifyAll();   // now observers see new value
}
```

In sync chains this is enough. In async or with multiple state updates, batching may be needed.

**Lesson:** Order matters in pull model: state must be settled before notification.

</details>

---

## Bug 7: Async dispatch with shared mutable event

```java
class Bus {
    private final ExecutorService exec = Executors.newFixedThreadPool(4);

    public void publish(MutableEvent e) {
        for (Listener l : listeners) {
            exec.submit(() -> l.on(e));   // all listeners share one event
        }
    }
}

// One listener:
public void on(MutableEvent e) { e.setProcessed(true); }
// Another listener:
public void on(MutableEvent e) { if (e.isProcessed()) skip(); }
```

Inconsistent results: the second observer's behavior depends on the order in which the executor schedules — which is non-deterministic.

<details><summary>Reveal</summary>

**Bug:** Shared mutable state across listeners. One mutates; another reads. Race condition.

**Fix:** make events immutable.

```java
public final class Event {
    public final String type;
    public final Map<String, Object> data;   // also immutable
    public Event(String t, Map<String, Object> d) {
        this.type = t;
        this.data = Map.copyOf(d);
    }
}
```

Or give each listener its own copy.

**Lesson:** Events should be immutable values. Mutating events leak coupling between observers.

</details>

---

## Bug 8: `equals` confusion in unsubscribe

```java
class Bus {
    private final List<Listener> listeners = new ArrayList<>();

    public void subscribe(Listener l)   { listeners.add(l); }
    public void unsubscribe(Listener l) { listeners.remove(l); }
}

class App {
    void setup() {
        bus.subscribe(this::handle);
        // ...later...
        bus.unsubscribe(this::handle);   // doesn't unsubscribe!
    }
    void handle(Event e) { /* ... */ }
}
```

Memory grows; logs show observer never removed.

<details><summary>Reveal</summary>

**Bug:** Each `this::handle` is a *new* lambda. Two different objects, even pointing to the same method. `remove()` searches for an `equals`-equal entry; doesn't find it.

**Fix:** keep a reference.

```java
class App {
    private final Listener l = this::handle;
    void setup() { bus.subscribe(l); }
    void teardown() { bus.unsubscribe(l); }
}
```

Or have `subscribe` return a `Disposable`:

```java
Disposable d = bus.subscribe(this::handle);
d.dispose();
```

**Lesson:** Method references and lambdas don't have `equals` based on the underlying method. Always retain the exact object you subscribed.

</details>

---

## Bug 9: Order dependency between observers

```java
bus.subscribe(o -> calculateTax(o));
bus.subscribe(o -> applyDiscount(o));
bus.subscribe(o -> commitOrder(o));
```

Tests pass. In production, sometimes `commitOrder` runs before `applyDiscount`, missing the discount.

<details><summary>Reveal</summary>

**Bug:** Observer doesn't promise order. The implementation may have happened to be insertion-ordered, but switching to `CopyOnWriteArraySet` or async dispatch reorders. Discount and commit shouldn't be observers of the same event — they're a *pipeline*.

**Fix:** model as a pipeline (Chain of Responsibility) or sequence the steps explicitly.

```java
void onOrderPlaced(Order o) {
    var taxed = calculateTax(o);
    var discounted = applyDiscount(taxed);
    commitOrder(discounted);
}
```

Or: split events. `OrderPlaced` triggers `calculateTax`; that emits `OrderTaxed`; that triggers `applyDiscount`; etc.

**Lesson:** Observer is for independent reactions. If you have ordered steps, use a different pattern (or an explicit handler).

</details>

---

## Bug 10: Subscribe inside a constructor

```java
public final class Listener {
    public Listener(Bus bus) {
        bus.subscribe(this);   // `this` published before construction completes
    }

    public void on(Event e) {
        useField();   // BUG: field might not be initialized yet
    }
}
```

NPEs in `useField()` for events fired during construction.

<details><summary>Reveal</summary>

**Bug:** Publishing `this` before the constructor finishes. If the bus dispatches synchronously while the constructor is running, the partially-constructed object handles events with uninitialized fields.

**Fix:** subscribe AFTER construction, in a factory or `start()` method.

```java
public final class Listener {
    public Listener() { /* fields initialized */ }
    public void start(Bus bus) { bus.subscribe(this); }
}
```

**Lesson:** Don't leak `this` during construction. Subscriptions should happen in a separate post-construction step.

</details>

---

## Bug 11: Missing per-handler exception isolation in async

```java
public void publish(Event e) {
    CompletableFuture<Void> all = CompletableFuture.allOf(
        listeners.stream()
            .map(l -> CompletableFuture.runAsync(() -> l.on(e)))
            .toArray(CompletableFuture[]::new)
    );
    // No try/catch
}
```

In production, a poison-pill event makes one handler throw; nothing in logs; the future fails silently.

<details><summary>Reveal</summary>

**Bug:** `CompletableFuture` exceptions are not propagated unless you `.exceptionally()`, `.handle()`, or `.join()`. Failures vanish.

**Fix:**

```java
listeners.forEach(l -> CompletableFuture
    .runAsync(() -> l.on(e))
    .exceptionally(ex -> { log.error("handler failed", ex); return null; })
);
```

**Lesson:** Async handlers are easier to lose than sync ones. Always attach an error handler.

</details>

---

## Bug 12: SSE / WebSocket leak on disconnect

```python
class LiveStream:
    def __init__(self):
        self._subscribers: list[asyncio.Queue] = []

    def publish(self, msg):
        for q in self._subscribers:
            q.put_nowait(msg)

    async def subscribe(self):
        q = asyncio.Queue()
        self._subscribers.append(q)
        while True:
            yield await q.get()
```

Clients disconnect; queues stay in `self._subscribers`. Memory grows.

<details><summary>Reveal</summary>

**Bug:** Disconnection is not handled. The async iterator never reaches its `finally` because cancellation isn't propagated to the generator.

**Fix:** clean up on cancellation.

```python
async def subscribe(self):
    q = asyncio.Queue()
    self._subscribers.append(q)
    try:
        while True:
            yield await q.get()
    finally:
        self._subscribers.remove(q)
```

(With proper async-generator cancellation, the `finally` runs when the consumer stops awaiting.)

**Lesson:** Live streams (SSE, WebSocket) need explicit unsubscribe on client disconnect. `try/finally` around the consume loop is the standard idiom.

</details>

---

## Practice Tips

- **Concurrent modification is the most common bug.** Always snapshot or use COW.
- **Per-handler error isolation is non-negotiable.** Wrap each invocation.
- **Audit observer lifecycle.** Long-lived subject + short-lived observer = leak unless cleaned up.
- **Beware lambda equality.** `this::method` is a new lambda each time.
- **Mutable shared events are a recipe for races.** Make events immutable.
- **State first, notify after.** In pull model, observers see what's settled.
- **Observers shouldn't depend on each other's order.** If they do, use a pipeline.
- **Don't leak `this` from constructors.** Subscribe after construction.
- **Async dispatch swallows exceptions silently.** Attach error handlers.
- **WebSocket / SSE need explicit cleanup on disconnect.**

[← Tasks](tasks.md) · [Optimize →](optimize.md)
