# Command — Optimize

> **Source:** [refactoring.guru/design-patterns/command](https://refactoring.guru/design-patterns/command)

Each section presents a Command that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Coalesce small commands into one undo unit](#optimization-1-coalesce-small-commands-into-one-undo-unit)
2. [Optimization 2: Bound undo history](#optimization-2-bound-undo-history)
3. [Optimization 3: Snapshot only changed fields](#optimization-3-snapshot-only-changed-fields)
4. [Optimization 4: Batch outbox dispatching](#optimization-4-batch-outbox-dispatching)
5. [Optimization 5: Replace JSON with Protobuf for high-volume Commands](#optimization-5-replace-json-with-protobuf-for-high-volume-commands)
6. [Optimization 6: Lock-free Command queue](#optimization-6-lock-free-command-queue)
7. [Optimization 7: Snapshot every N events for fast replay](#optimization-7-snapshot-every-n-events-for-fast-replay)
8. [Optimization 8: Idempotency cache with hot/cold tier](#optimization-8-idempotency-cache-with-hotcold-tier)
9. [Optimization 9: Drop one-class Command abstractions](#optimization-9-drop-one-class-command-abstractions)
10. [Optimization 10: Asynchronous Command dispatch with backpressure](#optimization-10-asynchronous-command-dispatch-with-backpressure)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Coalesce small commands into one undo unit

### Before

```java
for (char c : "hello".toCharArray()) {
    history.execute(new InsertCharCommand(doc, c));
}
```

Five Commands on the stack. User presses Ctrl+Z five times to undo "hello."

### After

```java
history.execute(new InsertTextCommand(doc, "hello"));
```

One Command. One Ctrl+Z removes "hello" entirely.

For dynamic typing:

```java
class CoalescingHistory {
    private long lastTs;
    private InsertTextCommand pending;

    public void typeChar(char c) {
        long now = System.currentTimeMillis();
        if (pending != null && now - lastTs < 1000) {
            pending.append(c);   // mutate the in-progress command
        } else {
            pending = new InsertTextCommand(doc, "" + c);
            history.execute(pending);
        }
        lastTs = now;
    }
}
```

**Measurement.** Undo stack memory drops sharply; user experience improves (one Ctrl+Z = one logical undo).

**Lesson:** Match Command granularity to user-perceived actions, not implementation primitives.

---

## Optimization 2: Bound undo history

### Before

```java
class History {
    private final Deque<Command> undo = new ArrayDeque<>();
    public void execute(Command c) {
        c.execute();
        undo.push(c);   // unbounded
    }
}
```

After hours of editing, undo stack consumes gigabytes.

### After

```java
class History {
    private final Deque<Command> undo = new ArrayDeque<>();
    private static final int MAX = 1000;

    public void execute(Command c) {
        c.execute();
        undo.push(c);
        while (undo.size() > MAX) undo.removeLast();   // drop oldest
    }
}
```

**Measurement.** Memory bounded. Users rarely undo more than the last few dozen actions.

**Trade-off.** Old actions can't be undone. Acceptable for editors; document the limit.

**Lesson:** All histories must be bounded. Pick a reasonable limit; expose it as a configuration knob.

---

## Optimization 3: Snapshot only changed fields

### Before

```java
class UpdateDocumentCommand implements Command {
    private Document fullSnapshot;
    public void execute() {
        fullSnapshot = doc.deepCopy();   // entire document
        doc.applyChange(...);
    }
    public void undo() { doc.replaceWith(fullSnapshot); }
}
```

For a 10 MB document, every edit clones 10 MB.

### After

```java
class UpdateFieldCommand implements Command {
    private final String field;
    private final Object newValue;
    private Object oldValue;

    public void execute() {
        oldValue = doc.get(field);
        doc.set(field, newValue);
    }
    public void undo() { doc.set(field, oldValue); }
}
```

**Measurement.** Memory per Command goes from MBs to bytes.

**Lesson:** Snapshot at the smallest meaningful granularity. The whole document is rarely needed.

---

## Optimization 4: Batch outbox dispatching

### Before

```java
@Scheduled(fixedDelay = 100)
public void drain() {
    var entry = outboxRepo.findOne();    // one at a time
    if (entry != null) {
        broker.publish(entry);
        outboxRepo.markDispatched(entry.id());
    }
}
```

Hundreds of round-trips to DB and broker per second.

### After

```java
@Scheduled(fixedDelay = 100)
public void drain() {
    var batch = outboxRepo.findUndispatched(500);   // batch
    if (batch.isEmpty()) return;
    broker.publishBatch(batch);                     // batch send
    outboxRepo.markDispatchedBatch(batch.stream().map(OutboxEntry::id).toList());
}
```

**Measurement.** Throughput jumps 100×. DB load drops; broker network usage drops.

**Lesson:** Outbox dispatching is naturally batchable. Larger batches = better throughput at minor latency cost.

---

## Optimization 5: Replace JSON with Protobuf for high-volume Commands

### Before

```java
String json = mapper.writeValueAsString(cmd);
producer.send(json.getBytes());
```

JSON serialization: ~10K Commands/sec/thread. CPU dominated by string parsing.

### After

```protobuf
message PlaceOrder {
    string order_id = 1;
    string user_id = 2;
    repeated Item items = 3;
}
```

```java
byte[] bytes = cmd.toByteArray();
producer.send(bytes);
```

**Measurement.** Throughput rises ~10×. Payload shrinks ~3-5×.

**Trade-off.** Schema management; less inspectable in logs.

**Lesson:** Default to JSON for low-volume. For high-volume Command streams, Protobuf / Avro pays dividends.

---

## Optimization 6: Lock-free Command queue

### Before

```java
private final BlockingQueue<Command> queue = new ArrayBlockingQueue<>(10_000);

public void dispatch(Command c) { queue.offer(c); }
```

Under contention, the lock inside `ArrayBlockingQueue` becomes a bottleneck.

### After (LMAX Disruptor)

```java
Disruptor<CommandHolder> d = new Disruptor<>(CommandHolder::new, 16384, threadFactory);
d.handleEventsWith((event, seq, eob) -> handle(event.command));
d.start();
RingBuffer<CommandHolder> rb = d.getRingBuffer();

public void dispatch(Command c) {
    long seq = rb.next();
    try { rb.get(seq).command = c; }
    finally { rb.publish(seq); }
}
```

**Measurement.** Throughput rises 10-100× under high contention. Latency more predictable.

**Trade-off.** More complex; bounded buffer; harder to reason about.

**Lesson:** When throughput matters and a single-writer or low-contention model fits, the Disruptor outpaces locked queues.

---

## Optimization 7: Snapshot every N events for fast replay

### Before

```java
public Order load(String id) {
    var events = eventStore.findAll(id);   // 50K events for old aggregates
    Order o = new Order();
    for (Event e : events) o.apply(e);
    return o;
}
```

Loading takes 30 seconds for old aggregates.

### After

```java
public Order load(String id) {
    var snap = snapshotStore.findLatest(id);   // snapshot @ event 50K
    Order o = (snap != null) ? snap.toOrder() : new Order();
    long fromSeq = (snap != null) ? snap.sequence() + 1 : 0;
    for (Event e : eventStore.findFromSequence(id, fromSeq)) o.apply(e);
    return o;
}

// Background process:
public void snapshotPeriodically() {
    if (events.size() % 1000 == 0) snapshotStore.save(this);
}
```

**Measurement.** Load time drops from seconds to milliseconds. Worst-case replay = 1000 events.

**Lesson:** Event-sourced systems need snapshots. Frequency = trade-off between write cost and load latency.

---

## Optimization 8: Idempotency cache with hot/cold tier

### Before

```java
boolean seen = redis.get(key) != null;
```

For every Command. Redis under load with millions of keys.

### After

```java
class TwoTierIdempotency {
    private final Cache<String, Boolean> local = Caffeine.newBuilder()
        .maximumSize(100_000).expireAfterWrite(Duration.ofMinutes(5)).build();
    private final RedisClient redis;

    public boolean seen(String key) {
        Boolean cached = local.getIfPresent(key);
        if (cached != null) return cached;
        boolean inRedis = redis.exists(key);
        if (inRedis) local.put(key, true);
        return inRedis;
    }
}
```

**Measurement.** Redis load drops 90%+. Hot keys served from local cache (~100 ns). Cold keys still go to Redis but are then cached.

**Trade-off.** Local cache eviction may cause re-checks; but checks are cheap.

**Lesson:** Hot/cold tiering is the standard pattern for high-throughput idempotency. L1 (local) + L2 (distributed).

---

## Optimization 9: Drop one-class Command abstractions

### Before

```java
class SaveDocumentCommand implements Command {
    private final Document doc;
    public SaveDocumentCommand(Document doc) { this.doc = doc; }
    public void execute() { doc.save(); }
    public void undo() { /* impossible */ }
}

button.setCommand(new SaveDocumentCommand(doc));
```

There's exactly one save Command. There's no undo. There's no other invoker.

### After

```java
button.setOnAction(() -> doc.save());
```

Or: `button.setOnAction(doc::save);`. Direct.

**Measurement.** Less code. No indirection. Easier stack traces.

**Lesson:** Don't introduce Command for actions that don't need queue / undo / log / transmit. Lambdas or method references suffice.

---

## Optimization 10: Asynchronous Command dispatch with backpressure

### Before

```java
public void dispatch(Command c) {
    executor.submit(() -> c.execute());
}
```

Producer outpaces consumers. Executor's queue grows unbounded → OOM.

### After

```java
private final ExecutorService exec = new ThreadPoolExecutor(
    8, 16, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(10_000),
    new ThreadPoolExecutor.CallerRunsPolicy()   // backpressure
);

public void dispatch(Command c) {
    exec.submit(() -> c.execute());
}
```

`CallerRunsPolicy` makes the producer execute the task itself when the queue is full — naturally slowing it down.

**Measurement.** Memory bounded; producer throttled under load; no OOM.

**Trade-off.** Producer thread is occasionally slowed. Acceptable.

**Lesson:** Bounded queues + sane rejection policy = backpressure. Pick the right policy: `CallerRunsPolicy`, `AbortPolicy`, custom.

---

## Optimization Tips

- **Coalesce Commands to user-perceived units.** Each Ctrl+Z should undo one logical step.
- **Bound undo history.** Always.
- **Snapshot at the smallest granularity.** Don't deep-copy the world.
- **Batch outbox / queue operations.** Throughput multiplier with low latency cost.
- **Switch to Protobuf for high-volume serialization.** ~10× faster than JSON.
- **Use Disruptor for ultra-high throughput dispatch.** Lock-free wins.
- **Snapshot event-sourced aggregates.** Replay performance.
- **Two-tier idempotency cache** (local + Redis). Cuts Redis load dramatically.
- **Drop one-class Commands.** Premature abstraction.
- **Async dispatch needs backpressure.** Bounded queue + sane rejection policy.
- **Profile before optimizing.** Most Command code is fine; only hot paths matter.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
