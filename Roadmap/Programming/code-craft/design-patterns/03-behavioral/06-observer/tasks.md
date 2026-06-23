# Observer — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/observer](https://refactoring.guru/design-patterns/observer)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Weather station with multiple displays](#task-1-weather-station-with-multiple-displays)
2. [Task 2: Typed event bus](#task-2-typed-event-bus)
3. [Task 3: Async dispatch with error isolation](#task-3-async-dispatch-with-error-isolation)
4. [Task 4: Weak-ref subject](#task-4-weak-ref-subject)
5. [Task 5: Disposable / unsubscribe function](#task-5-disposable-unsubscribe-function)
6. [Task 6: Cycle detection](#task-6-cycle-detection)
7. [Task 7: SSE-style live stream](#task-7-sse-style-live-stream)
8. [Task 8: Backpressure with bounded buffer](#task-8-backpressure-with-bounded-buffer)
9. [Task 9: Hierarchical event types](#task-9-hierarchical-event-types)
10. [Task 10: Outbox pattern for domain events](#task-10-outbox-pattern-for-domain-events)
11. [How to Practice](#how-to-practice)

---

## Task 1: Weather station with multiple displays

**Brief.** A `WeatherStation` with `setTemp(t)`. Displays `Phone`, `Web`, `Console` subscribe and print on update.

### Solution (Java)

```java
import java.util.*;

interface Listener { void onTempChanged(double t); }

class WeatherStation {
    private final List<Listener> listeners = new ArrayList<>();
    public void subscribe(Listener l)   { listeners.add(l); }
    public void unsubscribe(Listener l) { listeners.remove(l); }
    public void setTemp(double t) {
        for (Listener l : new ArrayList<>(listeners)) l.onTempChanged(t);
    }
}

class Demo {
    public static void main(String[] args) {
        WeatherStation w = new WeatherStation();
        w.subscribe(t -> System.out.println("phone: " + t));
        w.subscribe(t -> System.out.println("web:   " + t));
        w.subscribe(t -> System.out.println("cli:   " + t));

        w.setTemp(22.5);
        w.setTemp(23.0);
    }
}
```

---

## Task 2: Typed event bus

**Brief.** A bus where `subscribe(SomeEvent.class, handler)` is type-safe.

### Solution (Java)

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

public final class TypedBus {
    private final Map<Class<?>, List<Consumer<?>>> subs = new ConcurrentHashMap<>();

    public <E> void subscribe(Class<E> type, Consumer<E> handler) {
        subs.computeIfAbsent(type, k -> new CopyOnWriteArrayList<>()).add(handler);
    }

    @SuppressWarnings("unchecked")
    public <E> void publish(E event) {
        for (Consumer<?> c : subs.getOrDefault(event.getClass(), List.of())) {
            try { ((Consumer<E>) c).accept(event); }
            catch (Exception e) { e.printStackTrace(); }
        }
    }
}

class Demo {
    record OrderPlaced(String orderId) {}
    record OrderShipped(String orderId) {}

    public static void main(String[] args) {
        var bus = new TypedBus();
        bus.subscribe(OrderPlaced.class, e -> System.out.println("placed: " + e.orderId()));
        bus.subscribe(OrderShipped.class, e -> System.out.println("shipped: " + e.orderId()));

        bus.publish(new OrderPlaced("o1"));
        bus.publish(new OrderShipped("o1"));
    }
}
```

---

## Task 3: Async dispatch with error isolation

**Brief.** A bus that runs handlers on an executor; one handler throwing doesn't break others.

### Solution (Java)

```java
import java.util.concurrent.*;
import java.util.function.Consumer;

public final class AsyncBus {
    private final ExecutorService exec;
    private final List<Consumer<String>> listeners = new CopyOnWriteArrayList<>();

    public AsyncBus(int threads) { this.exec = Executors.newFixedThreadPool(threads); }
    public void subscribe(Consumer<String> h) { listeners.add(h); }
    public void publish(String event) {
        for (Consumer<String> h : listeners) {
            exec.submit(() -> {
                try { h.accept(event); }
                catch (Exception e) { System.err.println("handler failed: " + e); }
            });
        }
    }
    public void shutdown() throws InterruptedException {
        exec.shutdown();
        exec.awaitTermination(5, TimeUnit.SECONDS);
    }
}

class Demo {
    public static void main(String[] args) throws Exception {
        var bus = new AsyncBus(4);
        bus.subscribe(e -> System.out.println("ok: " + e));
        bus.subscribe(e -> { throw new RuntimeException("boom"); });
        bus.subscribe(e -> System.out.println("also ok: " + e));

        bus.publish("hello");
        Thread.sleep(200);
        bus.shutdown();
    }
}
```

---

## Task 4: Weak-ref subject

**Brief.** Subscribers held by weak refs; the bus skips cleared refs.

### Solution (Java)

```java
import java.lang.ref.WeakReference;
import java.util.*;
import java.util.function.Consumer;

public final class WeakBus<T> {
    private final List<WeakReference<Consumer<T>>> refs = Collections.synchronizedList(new ArrayList<>());

    public void subscribe(Consumer<T> c) { refs.add(new WeakReference<>(c)); }

    public void publish(T value) {
        synchronized (refs) {
            Iterator<WeakReference<Consumer<T>>> it = refs.iterator();
            while (it.hasNext()) {
                Consumer<T> c = it.next().get();
                if (c == null) it.remove();
                else { try { c.accept(value); } catch (Exception ignored) {} }
            }
        }
    }
}

class Demo {
    public static void main(String[] args) {
        var bus = new WeakBus<String>();
        Consumer<String> strong = s -> System.out.println("strong: " + s);
        bus.subscribe(strong);
        bus.subscribe(s -> System.out.println("weak: " + s));   // no strong ref

        System.gc();   // weak one likely reclaimed
        bus.publish("hello");   // strong always; weak: maybe
    }
}
```

(Caveat: GC behavior is JVM-specific; for testing weak refs reliably, use `WeakHashMap` semantics or test with explicit clears.)

---

## Task 5: Disposable / unsubscribe function

**Brief.** `subscribe()` returns a function that, when called, unsubscribes.

### Solution (TypeScript)

```typescript
type Observer<T> = (value: T) => void;
type Unsubscribe = () => void;

class Subject<T> {
    private observers = new Set<Observer<T>>();

    subscribe(obs: Observer<T>): Unsubscribe {
        this.observers.add(obs);
        return () => { this.observers.delete(obs); };
    }

    next(value: T): void {
        for (const obs of [...this.observers]) {
            try { obs(value); } catch (e) { console.error(e); }
        }
    }
}

const s = new Subject<number>();
const unsub1 = s.subscribe(v => console.log("A", v));
const unsub2 = s.subscribe(v => console.log("B", v));

s.next(1);     // A 1, B 1
unsub1();
s.next(2);     // B 2
```

This is the RxJS-style API. Easier than tracking the observer reference for unsubscribe.

---

## Task 6: Cycle detection

**Brief.** A bus where Subject A → publishes → handler → publishes back to A. Detect and break the cycle.

### Solution (Java)

```java
public final class CycleAwareBus {
    private final List<Runnable> handlers = new CopyOnWriteArrayList<>();
    private final ThreadLocal<Boolean> inDispatch = ThreadLocal.withInitial(() -> false);

    public void subscribe(Runnable h) { handlers.add(h); }

    public void publish() {
        if (inDispatch.get()) {
            System.out.println("cycle detected; skipping nested publish");
            return;
        }
        inDispatch.set(true);
        try {
            for (Runnable h : handlers) {
                try { h.run(); } catch (Exception e) { e.printStackTrace(); }
            }
        } finally {
            inDispatch.set(false);
        }
    }
}
```

---

## Task 7: SSE-style live stream

**Brief.** A simple in-process pub/sub mimicking SSE: clients subscribe and the server pushes events.

### Solution (Python)

```python
import asyncio
from typing import AsyncIterator, Set


class LiveStream:
    def __init__(self) -> None:
        self._subscribers: Set[asyncio.Queue] = set()

    async def publish(self, msg: str) -> None:
        for q in list(self._subscribers):
            await q.put(msg)

    async def subscribe(self) -> AsyncIterator[str]:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            self._subscribers.discard(q)


async def main():
    stream = LiveStream()

    async def consumer(name: str):
        async for msg in stream.subscribe():
            print(f"{name}: {msg}")

    asyncio.create_task(consumer("A"))
    asyncio.create_task(consumer("B"))
    await asyncio.sleep(0.1)
    await stream.publish("hello")
    await stream.publish("world")
    await asyncio.sleep(0.1)


if __name__ == "__main__":
    asyncio.run(main())
```

---

## Task 8: Backpressure with bounded buffer

**Brief.** A producer generates 1000 events fast; a slow consumer can keep up with 100. Use a bounded buffer that drops oldest when full; report dropped count.

### Solution (Java)

```java
import java.util.concurrent.*;

public final class BackpressureBus {
    private final BlockingQueue<String> queue;
    private final int capacity;
    private long dropped = 0;

    public BackpressureBus(int capacity) {
        this.capacity = capacity;
        this.queue = new ArrayBlockingQueue<>(capacity);
    }

    public synchronized void publish(String e) {
        if (queue.size() == capacity) {
            queue.poll();        // drop oldest
            dropped++;
        }
        queue.offer(e);
    }

    public String poll() throws InterruptedException { return queue.take(); }

    public long droppedCount() { return dropped; }
}
```

Producer fast-feeds; consumer reads slowly; `droppedCount()` shows the loss.

---

## Task 9: Hierarchical event types

**Brief.** A bus where `OrderPlaced extends OrderEvent extends DomainEvent`. Subscribing to `OrderEvent` receives `OrderPlaced`.

### Solution (Java)

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

public final class HierarchicalBus {
    private final Map<Class<?>, List<Consumer<?>>> subs = new ConcurrentHashMap<>();

    public <E> void subscribe(Class<E> type, Consumer<E> h) {
        subs.computeIfAbsent(type, k -> new CopyOnWriteArrayList<>()).add(h);
    }

    @SuppressWarnings("unchecked")
    public <E> void publish(E event) {
        Class<?> c = event.getClass();
        while (c != null) {
            for (Consumer<?> h : subs.getOrDefault(c, List.of())) {
                try { ((Consumer<E>) h).accept(event); } catch (Exception ignored) {}
            }
            c = c.getSuperclass();
        }
    }
}

class Demo {
    static abstract class DomainEvent {}
    static abstract class OrderEvent extends DomainEvent { String orderId; }
    static class OrderPlaced extends OrderEvent { OrderPlaced(String id) { this.orderId = id; } }

    public static void main(String[] args) {
        var bus = new HierarchicalBus();
        bus.subscribe(DomainEvent.class, e -> System.out.println("any domain event"));
        bus.subscribe(OrderEvent.class,  e -> System.out.println("order event: " + e.orderId));
        bus.subscribe(OrderPlaced.class, e -> System.out.println("placed: " + e.orderId));

        bus.publish(new OrderPlaced("o1"));
        // prints: placed → order event → any domain event
    }
}
```

---

## Task 10: Outbox pattern for domain events

**Brief.** An aggregate emits events; a transactional save commits state + outbox; a separate dispatcher publishes from outbox.

### Solution (Pseudocode)

```java
// In-memory simulation; in production use a real DB.
class OutboxEntry { UUID id; String type; String payload; boolean dispatched; }

class OrderRepo {
    List<Order> orders = new ArrayList<>();
    List<OutboxEntry> outbox = new ArrayList<>();

    public synchronized void place(Order o, DomainEvent e) {
        orders.add(o);
        outbox.add(new OutboxEntry(UUID.randomUUID(), e.getClass().getSimpleName(), Json.encode(e), false));
    }

    public synchronized List<OutboxEntry> findUndispatched(int limit) {
        return outbox.stream().filter(x -> !x.dispatched).limit(limit).toList();
    }

    public synchronized void markDispatched(UUID id) {
        outbox.stream().filter(x -> x.id.equals(id)).findFirst().ifPresent(x -> x.dispatched = true);
    }
}

class Dispatcher {
    void run(OrderRepo repo, Bus bus) {
        for (var entry : repo.findUndispatched(100)) {
            try {
                bus.publish(entry.type, entry.payload);
                repo.markDispatched(entry.id);
            } catch (Exception e) { /* retry */ }
        }
    }
}
```

In production: outbox table in same DB as state; transactional save; CDC or polling-based dispatcher.

---

## How to Practice

- **Start with the simple one** — weather station. Internalize the subscribe/notify dance.
- **Build a typed bus.** Real apps need it; magic strings rot.
- **Compare sync vs async.** Run both; measure latency.
- **Provoke leaks.** Subscribe and never unsubscribe; observe memory growth. Then add weak refs.
- **Build a real reactive flow.** RxJS, Reactor, Flow — pick one. Subscribe, transform, manage backpressure.
- **Implement Outbox.** Most underrated production pattern in distributed systems.
- **Read Kafka client code.** It's Observer at scale, with retries and offsets.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
