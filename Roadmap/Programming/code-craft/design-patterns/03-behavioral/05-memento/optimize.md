# Memento — Optimize

> **Source:** [refactoring.guru/design-patterns/memento](https://refactoring.guru/design-patterns/memento)

Each section presents a Memento that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Diff-based Mementos for large state](#optimization-1-diff-based-mementos-for-large-state)
2. [Optimization 2: Persistent data structures for free Mementos](#optimization-2-persistent-data-structures-for-free-mementos)
3. [Optimization 3: Bound undo history](#optimization-3-bound-undo-history)
4. [Optimization 4: Coarse-grain Mementos for typing](#optimization-4-coarse-grain-mementos-for-typing)
5. [Optimization 5: Compress persisted Mementos](#optimization-5-compress-persisted-mementos)
6. [Optimization 6: Snapshot every N events for fast replay](#optimization-6-snapshot-every-n-events-for-fast-replay)
7. [Optimization 7: Lock-free snapshot via AtomicReference](#optimization-7-lock-free-snapshot-via-atomicreference)
8. [Optimization 8: Replace JSON with Protobuf for persistent Mementos](#optimization-8-replace-json-with-protobuf-for-persistent-mementos)
9. [Optimization 9: Off-heap Mementos for high-volume](#optimization-9-off-heap-mementos-for-high-volume)
10. [Optimization 10: Drop Memento for trivial state](#optimization-10-drop-memento-for-trivial-state)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Diff-based Mementos for large state

### Before

```java
public Memento save() {
    return new Memento(deepCopy(this.allDocumentText));   // 100MB per snapshot
}
```

50 undo levels × 100MB = 5GB. OOM.

### After

```java
public DiffMemento save(int position, String oldChar, String newChar) {
    return new DiffMemento(position, oldChar, newChar);   // few bytes
}
```

Each diff is tiny.

**Measurement.** Memory: 5GB → ~5KB for 50 small edits.

**Trade-off.** Restore must replay diffs in reverse — slightly slower.

**Lesson:** For large state with small changes, diff Mementos beat full snapshots by orders of magnitude.

---

## Optimization 2: Persistent data structures for free Mementos

### Before (Java with mutable HashMap)

```java
HashMap<String, String> state = new HashMap<>();
// every snapshot = deep copy
HashMap<String, String> snapshot = new HashMap<>(state);
```

Per-snapshot allocation: O(N).

### After (Vavr / PCollections / Clojure-style)

```java
import io.vavr.collection.HashMap;

HashMap<String, String> state = HashMap.empty();
state = state.put("k", "v");
// snapshot is just the reference; structural sharing
HashMap<String, String> snapshot = state;
```

Per-snapshot allocation: O(log N) for the modification, snapshot itself = pointer.

**Measurement.** 1M Mementos with mutable maps: hundreds of MB. With persistent: a few MB (shared structure).

**Lesson:** Persistent data structures give Mementos for free via structural sharing.

---

## Optimization 3: Bound undo history

### Before

```python
class History:
    def __init__(self):
        self._stack = []
    def push(self, m):
        self._stack.append(m)
```

Memory grows forever.

### After

```python
from collections import deque

class History:
    def __init__(self, max_size=1000):
        self._stack: deque = deque(maxlen=max_size)
    def push(self, m):
        self._stack.append(m)
```

Memory bounded; oldest auto-evicted.

**Measurement.** Memory steady regardless of session length.

**Lesson:** Always bound histories. `deque(maxlen=N)` is the simplest pattern.

---

## Optimization 4: Coarse-grain Mementos for typing

### Before

```java
class Editor {
    public void type(char c) {
        history.push(this.save());   // Memento per character
        content += c;
    }
}
```

For "hello world" — 11 Mementos.

### After (coalesce typing within 1 second)

```java
class Editor {
    private long lastTypeTs;
    private Memento pending;

    public void type(char c) {
        long now = System.currentTimeMillis();
        if (pending == null || now - lastTypeTs > 1000) {
            pending = this.save();
            history.push(pending);
        }
        lastTypeTs = now;
        content += c;
    }
}
```

11 keystrokes → 1 Memento. One Ctrl+Z removes "hello world."

**Measurement.** Memento count drops 10×; user gets sane undo granularity.

**Lesson:** Match Memento granularity to user-perceived actions, not implementation primitives.

---

## Optimization 5: Compress persisted Mementos

### Before

```java
String json = mapper.writeValueAsString(memento);
fs.write(json.getBytes());   // 1 MB per save
```

After 1000 saves, 1 GB on disk.

### After

```java
String json = mapper.writeValueAsString(memento);
byte[] compressed = zstd.compress(json.getBytes());
fs.write(compressed);   // ~100 KB per save
```

**Measurement.** ~10× compression for typical document JSON.

**Trade-off.** Save/load CPU adds tens of µs. Rarely noticeable for interactive apps.

**Lesson:** Compress persistent Mementos. zstd is the modern default.

---

## Optimization 6: Snapshot every N events for fast replay

### Before

```python
def load_aggregate(id):
    events = event_store.find_all(id)   # 100K events
    agg = Aggregate()
    for e in events: agg.apply(e)
    return agg
```

Load takes seconds.

### After

```python
def load_aggregate(id):
    snap = snapshot_store.find_latest(id)
    if snap:
        agg = Aggregate.from_snapshot(snap)
        events = event_store.find_after(id, snap.sequence)
    else:
        agg = Aggregate()
        events = event_store.find_all(id)
    for e in events: agg.apply(e)
    return agg
```

Save snapshot every 1000 events.

**Measurement.** Load time: seconds → milliseconds. Worst-case replay: 1000 events.

**Lesson:** Event-sourced systems need snapshots. Tune frequency by load latency.

---

## Optimization 7: Lock-free snapshot via AtomicReference

### Before

```java
public synchronized Memento save() {
    return new Memento(count, label);
}
public synchronized void increment() {
    count++;
}
```

All snapshots and writes serialize.

### After

```java
record State(int count, String label) {}
private final AtomicReference<State> state = new AtomicReference<>(new State(0, ""));

public State save() { return state.get(); }
public void increment() {
    state.updateAndGet(s -> new State(s.count() + 1, s.label()));
}
```

**Measurement.** Lock removed; concurrent snapshots are pointer reads.

**Lesson:** Immutable atomic state is lock-free for Mementos. CAS handles concurrent updates.

---

## Optimization 8: Replace JSON with Protobuf for persistent Mementos

### Before

```java
String json = mapper.writeValueAsString(memento);   // 100 µs, ~1KB
```

JSON: text-heavy, slow.

### After

```protobuf
message DocumentState {
    string content = 1;
    int32 cursor = 2;
}
```

```java
byte[] bytes = memento.toByteArray();   // 10 µs, ~300 bytes
```

**Measurement.** ~10× faster, ~3× smaller.

**Trade-off.** Schema management; less inspectable.

**Lesson:** For high-volume persistent Mementos, Protobuf / Avro / Kryo. JSON for low-volume and human inspection.

---

## Optimization 9: Off-heap Mementos for high-volume

### Before

```java
List<Memento> history = new ArrayList<>();
// many small Memento objects → GC pressure
```

GC pauses noticeable under load.

### After

```java
ByteBuffer offHeap = ByteBuffer.allocateDirect(SIZE);
// serialize Memento bytes into offHeap; address by offset
```

Or memory-mapped file:

```java
FileChannel ch = FileChannel.open(path, READ, WRITE);
MappedByteBuffer mmap = ch.map(MapMode.READ_WRITE, 0, size);
```

**Measurement.** GC pressure drops; pauses shorter. Trade-off: manual lifecycle management.

**Lesson:** For millions of Mementos, off-heap or memory-mapped storage avoids GC pressure. Common in databases, search engines.

---

## Optimization 10: Drop Memento for trivial state

### Before

```java
public final class IntCounter {
    private int value;
    public IntCounterMemento save() { return new IntCounterMemento(value); }
    public void restore(IntCounterMemento m) { this.value = m.value; }
}

public final class IntCounterMemento {
    final int value;
    IntCounterMemento(int v) { this.value = v; }
}
```

Memento class for one int.

### After

```java
public final class IntCounter {
    private int value;
    public int save() { return value; }
    public void restore(int v) { this.value = v; }
}
```

**Measurement.** Less code; no allocation.

**Lesson:** Memento earns its weight when state is non-trivial AND opacity matters. For one int, just return the value.

---

## Optimization Tips

- **Diff Mementos for large state with small changes.** Memory savings huge.
- **Persistent data structures = free Mementos.** Embrace them when possible.
- **Always bound histories.** `deque(maxlen=N)` or fixed-size circular buffer.
- **Match Memento granularity to user actions.** Coalesce typing.
- **Compress persistent Mementos.** zstd or similar.
- **Snapshot event-sourced aggregates.** Replay performance.
- **Lock-free with AtomicReference + immutable record.** Concurrent friendly.
- **Protobuf for high-volume persistent.** ~10× faster than JSON.
- **Off-heap for high-volume.** Avoids GC pressure.
- **Drop Memento when overkill.** Trivial state doesn't need the pattern.
- **Profile before optimizing.** Memento overhead is rarely the bottleneck — until it is.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
