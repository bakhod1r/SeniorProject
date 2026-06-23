# Observer — Optimize

> **Source:** [refactoring.guru/design-patterns/observer](https://refactoring.guru/design-patterns/observer)

Each section presents an Observer that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: CopyOnWriteArrayList over locked ArrayList](#optimization-1-copyonwritearraylist-over-locked-arraylist)
2. [Optimization 2: Snapshot once for multi-step dispatch](#optimization-2-snapshot-once-for-multi-step-dispatch)
3. [Optimization 3: Async dispatch for I/O handlers](#optimization-3-async-dispatch-for-io-handlers)
4. [Optimization 4: Per-event-type dispatch instead of giant switch](#optimization-4-per-event-type-dispatch-instead-of-giant-switch)
5. [Optimization 5: Batch high-frequency events](#optimization-5-batch-high-frequency-events)
6. [Optimization 6: Debounce or throttle](#optimization-6-debounce-or-throttle)
7. [Optimization 7: Replace synchronous bus with Disruptor](#optimization-7-replace-synchronous-bus-with-disruptor)
8. [Optimization 8: Backpressure with bounded queues](#optimization-8-backpressure-with-bounded-queues)
9. [Optimization 9: Avoid allocation in event payloads](#optimization-9-avoid-allocation-in-event-payloads)
10. [Optimization 10: Outbox + dispatcher pulls in batches](#optimization-10-outbox-dispatcher-pulls-in-batches)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: CopyOnWriteArrayList over locked ArrayList

### Before

```java
private final List<Listener> listeners = Collections.synchronizedList(new ArrayList<>());

public void publish(Event e) {
    synchronized (listeners) {
        for (Listener l : listeners) l.on(e);
    }
}
```

Every publish locks. Hot dispatch path serializes.

### After

```java
private final List<Listener> listeners = new CopyOnWriteArrayList<>();

public void publish(Event e) {
    for (Listener l : listeners) l.on(e);   // no lock; iterator on snapshot
}
```

**Measurement.** Throughput goes up sharply when many threads publish concurrently. Subscribe is now slower (O(n) copy), but if reads >> writes (typical), big win.

**Lesson:** When subscriber lists are read-mostly, CopyOnWriteArrayList eliminates the lock from the hot path.

---

## Optimization 2: Snapshot once for multi-step dispatch

### Before

```java
public void publishMany(List<Event> events) {
    for (Event e : events) {
        for (Listener l : listeners) l.on(e);   // listeners read each iteration
    }
}
```

For 1000 events × 100 listeners = 100K reads of `listeners` (volatile/COW each).

### After

```java
public void publishMany(List<Event> events) {
    Listener[] snapshot = listeners.toArray(new Listener[0]);
    for (Event e : events) {
        for (Listener l : snapshot) l.on(e);
    }
}
```

One snapshot, used for all events.

**Measurement.** With 100 listeners and 1000 events: noticeable speedup; volatile reads avoided.

**Lesson:** If you broadcast a batch, snapshot the subscriber list once. Saves volatile reads.

---

## Optimization 3: Async dispatch for I/O handlers

### Before

```java
public void publish(Event e) {
    for (Listener l : listeners) l.on(e);   // some listeners do HTTP, DB
}
```

Publishing latency = sum of all handler latencies. One slow listener stalls the publisher.

### After

```java
private final ExecutorService exec = Executors.newFixedThreadPool(8);

public void publish(Event e) {
    for (Listener l : listeners) {
        exec.submit(() -> {
            try { l.on(e); }
            catch (Exception ex) { log.error("handler", ex); }
        });
    }
}
```

**Measurement.** Publisher returns immediately. Total handler runtime is parallelized.

**Trade-off.** Ordering across handlers is lost. Errors are async (need explicit handling).

**Lesson:** When handlers do I/O or are slow, async dispatch unblocks the publisher.

---

## Optimization 4: Per-event-type dispatch instead of giant switch

### Before

```java
public void publish(Event e) {
    for (Listener l : listeners) {
        if (l.handles(e.getClass())) l.on(e);
    }
}
```

Each listener runs a type check. With 1000 listeners and 10 event types, most listeners do a check that fails.

### After

```java
private final Map<Class<?>, List<Consumer<?>>> byType = new ConcurrentHashMap<>();

public <E> void subscribe(Class<E> type, Consumer<E> h) {
    byType.computeIfAbsent(type, k -> new CopyOnWriteArrayList<>()).add(h);
}

@SuppressWarnings("unchecked")
public <E> void publish(E e) {
    for (Consumer<?> h : byType.getOrDefault(e.getClass(), List.of())) {
        ((Consumer<E>) h).accept(e);
    }
}
```

**Measurement.** Dispatch cost is proportional to number of *interested* listeners, not total. Massive speedup for buses with many event types.

**Lesson:** Type-keyed dispatch beats per-listener filtering.

---

## Optimization 5: Batch high-frequency events

### Before

```java
sensor.onReading(value -> bus.publish(new Reading(value)));   // 10K/s
```

Each event triggers a full dispatch. Subscribers can't keep up.

### After

```java
final List<Reading> buffer = Collections.synchronizedList(new ArrayList<>(1024));

sensor.onReading(value -> {
    buffer.add(new Reading(value));
});

scheduledExecutor.scheduleAtFixedRate(() -> {
    List<Reading> batch;
    synchronized (buffer) { batch = new ArrayList<>(buffer); buffer.clear(); }
    if (!batch.isEmpty()) bus.publish(new ReadingBatch(batch));
}, 0, 100, TimeUnit.MILLISECONDS);
```

Subscribers handle 10/s of `ReadingBatch` instead of 10K/s of `Reading`.

**Measurement.** Subscriber CPU drops dramatically; dispatch overhead amortized over batches.

**Lesson:** For high-frequency events with no need for per-event reaction, batch.

---

## Optimization 6: Debounce or throttle

### Before

```java
input.onChange(text -> bus.publish(new SearchQuery(text)));   // every keystroke
```

User types "hello world" (11 chars) → 11 search queries fired. Backend swamped.

### After (debounce)

```javascript
import { fromEvent, debounceTime, map } from 'rxjs';

fromEvent(input, 'input').pipe(
    debounceTime(300),
    map(e => e.target.value)
).subscribe(text => bus.publish(new SearchQuery(text)));
```

After 300ms of no input, publishes. 11 keystrokes → 1 publish.

**Measurement.** Backend load drops 90%+ for typing.

**Lesson:** For user-input events, debounce. For high-frequency event streams that only need samples, throttle.

---

## Optimization 7: Replace synchronous bus with Disruptor

### Before

```java
public final class SimpleBus {
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    public void publish(Event e) {
        for (Listener l : listeners) l.on(e);
    }
}
```

CPU profile shows `publish` itself is the bottleneck under high load.

### After (Disruptor)

```java
import com.lmax.disruptor.*;

public final class DisruptorBus {
    private final Disruptor<EventHolder> disruptor;
    private final RingBuffer<EventHolder> ringBuffer;

    public DisruptorBus(int bufferSize) {
        disruptor = new Disruptor<>(EventHolder::new, bufferSize, Executors.defaultThreadFactory());
        // Multiple handlers in parallel.
        disruptor.handleEventsWith(this::handleA, this::handleB);
        disruptor.start();
        this.ringBuffer = disruptor.getRingBuffer();
    }

    public void publish(Event e) {
        long seq = ringBuffer.next();
        try {
            ringBuffer.get(seq).event = e;
        } finally {
            ringBuffer.publish(seq);
        }
    }

    private void handleA(EventHolder h, long seq, boolean endOfBatch) { /* ... */ }
    private void handleB(EventHolder h, long seq, boolean endOfBatch) { /* ... */ }

    static class EventHolder { Event event; }
}
```

**Measurement.** Throughput jumps from ~1M ops/sec (synchronized bus) to 10M+ ops/sec. Latency more predictable (no GC churn).

**Trade-off.** More complex; bounded buffer means producer can block. Worth it only at very high throughput.

**Lesson:** When throughput matters more than simplicity, the Disruptor or similar lock-free designs win.

---

## Optimization 8: Backpressure with bounded queues

### Before

```java
private final Queue<Event> queue = new LinkedList<>();

public void publish(Event e) { queue.offer(e); }
```

Unbounded queue. Producer outpaces consumer → OOM.

### After

```java
private final BlockingQueue<Event> queue = new ArrayBlockingQueue<>(10_000);

public boolean publish(Event e) {
    return queue.offer(e);   // returns false if full → caller decides drop or retry
}

// or block:
public void publishBlocking(Event e) throws InterruptedException {
    queue.put(e);
}
```

**Measurement.** Memory bounded; OOM eliminated. With `offer`, dropped events visible (track in metric); with `put`, producer slows.

**Lesson:** Always bound queues. Decide drop / block / spill upfront.

---

## Optimization 9: Avoid allocation in event payloads

### Before

```java
public void publish(Map<String, Object> data) {
    bus.publish(new Event("temp_changed", data));
}
```

Every publish allocates an `Event` and copies the map.

### After (object pool for high-frequency events)

```java
public final class EventPool {
    private final Queue<Event> pool = new ConcurrentLinkedQueue<>();

    public Event borrow() {
        Event e = pool.poll();
        return e != null ? e : new Event();
    }

    public void release(Event e) { e.reset(); pool.offer(e); }
}
```

Subscribers must release events back to the pool. Trade-off: more complex; events must be transient.

For most apps: stick with allocation; modern GC handles small short-lived objects well.

**Measurement.** Pooling helps in extreme allocation-pressure scenarios. Otherwise, allocation overhead is invisible.

**Lesson:** Don't pool until profiling shows allocation pressure. Modern allocators are fast.

---

## Optimization 10: Outbox + dispatcher pulls in batches

### Before

```java
@Transactional
public void place(Order o) {
    repo.save(o);
    bus.publish(new OrderPlaced(o));   // dual-write hazard
}
```

If the publish fails after the save, state and event diverge.

### After (Outbox)

```java
@Transactional
public void place(Order o) {
    repo.save(o);
    outboxRepo.save(new OutboxEntry(/* event */));   // same txn
}

// Background dispatcher:
@Scheduled(fixedDelay = 100)
public void drain() {
    var batch = outboxRepo.findUndispatched(100);
    for (var e : batch) {
        try {
            broker.send(e.payload());
            outboxRepo.markDispatched(e.id());
        } catch (Exception ex) { /* retry */ }
    }
}
```

**Measurement.** No more dual-write race. At-least-once delivery; idempotent consumers handle duplicates.

**Lesson:** For domain events that must be eventually consistent, Outbox is the standard. Batch-pull keeps DB load reasonable.

---

## Optimization Tips

- **Profile before optimizing.** Observer dispatch is rarely the bottleneck — usually it's the handler bodies.
- **CopyOnWriteArrayList for read-mostly subscriber lists.** Eliminates the lock from hot dispatch.
- **Snapshot once for batch dispatch.** Avoids per-event volatile reads.
- **Async dispatch when handlers do I/O.** Don't make the publisher wait for HTTP.
- **Per-type dispatch beats per-listener filtering.** Map keyed by event class.
- **Batch high-frequency events.** Convert 10K/s to 10/s of batches.
- **Debounce / throttle user input.** Keystrokes don't need per-keystroke action.
- **Bound queues.** Always. Choose drop or block based on durability needs.
- **Outbox for domain events that must be durable.** Same transaction; separate dispatcher.
- **Don't pool prematurely.** Modern GC handles small allocations well; pool only with proven pressure.
- **Disruptor for ultra-high throughput.** When millions of events/sec are required.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
