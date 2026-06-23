# Memento — Find the Bug

> **Source:** [refactoring.guru/design-patterns/memento](https://refactoring.guru/design-patterns/memento)

Each section presents a Memento that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Mutable reference in Memento](#bug-1-mutable-reference-in-memento)
2. [Bug 2: Caretaker reads Memento internals](#bug-2-caretaker-reads-memento-internals)
3. [Bug 3: Mutable Memento](#bug-3-mutable-memento)
4. [Bug 4: Redo stack not cleared on new action](#bug-4-redo-stack-not-cleared-on-new-action)
5. [Bug 5: Unbounded history leaks memory](#bug-5-unbounded-history-leaks-memory)
6. [Bug 6: Memento captures resource handle](#bug-6-memento-captures-resource-handle)
7. [Bug 7: Concurrent capture races](#bug-7-concurrent-capture-races)
8. [Bug 8: Schema breakage on deserialization](#bug-8-schema-breakage-on-deserialization)
9. [Bug 9: Memento exposes sensitive data in logs](#bug-9-memento-exposes-sensitive-data-in-logs)
10. [Bug 10: Half-restore corrupts state](#bug-10-half-restore-corrupts-state)
11. [Bug 11: Diff-based Memento applied out of order](#bug-11-diff-based-memento-applied-out-of-order)
12. [Bug 12: Memento captures wrong scope](#bug-12-memento-captures-wrong-scope)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Mutable reference in Memento

```java
public final class Editor {
    private final List<String> lines = new ArrayList<>();

    public Memento save() { return new Memento(lines); }   // BUG: shares the same list

    public static class Memento {
        private final List<String> lines;
        Memento(List<String> l) { this.lines = l; }
    }
}
```

After save, modifying the editor changes the Memento too.

<details><summary>Reveal</summary>

**Bug:** The Memento stores a reference to the same `lines` list. When the editor mutates `lines`, the Memento sees the change.

**Fix:** deep-copy on save.

```java
public Memento save() { return new Memento(new ArrayList<>(lines)); }
```

Or use immutable lists:

```java
public Memento save() { return new Memento(List.copyOf(lines)); }
```

**Lesson:** Mementos must capture *values*, not references to mutable objects. Either copy or use immutable data.

</details>

---

## Bug 2: Caretaker reads Memento internals

```java
public final class History {
    private final List<Memento> stack = new ArrayList<>();

    public void log(Memento m) {
        // BUG: reaches into Memento
        System.out.println("snapshot: " + m.content + " @ " + m.cursor);
    }
}
```

<details><summary>Reveal</summary>

**Bug:** The Caretaker reads Memento's internal fields. Encapsulation broken; refactoring the Originator's state shape breaks the Caretaker.

**Fix:** Caretaker only stores; doesn't read. If logging is needed, the Originator can produce a `String` representation:

```java
public final class Editor {
    public String describe(Memento m) { return "content=" + m.content + " cursor=" + m.cursor; }
}

// History calls editor.describe(m) instead of reading m directly
```

Or expose a public `summary()` on Memento that the Originator controls.

**Lesson:** Caretakers are storage only. Reading defeats the encapsulation contract.

</details>

---

## Bug 3: Mutable Memento

```python
class Memento:
    def __init__(self, content):
        self.content = content   # mutable

m = editor.save()
m.content = "tampered"
editor.restore(m)   # restores tampered state
```

<details><summary>Reveal</summary>

**Bug:** Memento is mutable. After capture, anyone can modify it. The "snapshot" is no longer a snapshot.

**Fix:** make Mementos immutable.

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Memento:
    content: str
```

Or in JS, freeze:

```javascript
class Memento {
    constructor(content) {
        this.content = content;
        Object.freeze(this);
    }
}
```

**Lesson:** Mementos are values. Once created, they don't change. Use immutability primitives.

</details>

---

## Bug 4: Redo stack not cleared on new action

```java
public final class History {
    public void execute(Command c) {
        c.execute();
        undo.push(c);
        // BUG: redo not cleared
    }
}
```

Steps: do A, undo, do B, redo. Redo replays A — but A was undone and B is current.

<details><summary>Reveal</summary>

**Bug:** New `execute` doesn't clear the redo stack. After "undo + new execute," redo holds stale commands.

**Fix:**

```java
public void execute(Command c) {
    c.execute();
    undo.push(c);
    redo.clear();
}
```

**Lesson:** Redo is valid only after an undo, before any new execute. Branching the history breaks redo.

</details>

---

## Bug 5: Unbounded history leaks memory

```python
class History:
    def __init__(self):
        self._stack = []

    def push(self, m):
        self._stack.append(m)
```

After hours of editing, OOM.

<details><summary>Reveal</summary>

**Bug:** No size limit. Mementos accumulate forever.

**Fix:** cap with a deque.

```python
from collections import deque

class History:
    def __init__(self, max_size=1000):
        self._stack = deque(maxlen=max_size)

    def push(self, m):
        self._stack.append(m)
```

`deque(maxlen=N)` automatically evicts the oldest when full.

**Lesson:** Histories must be bounded. Always.

</details>

---

## Bug 6: Memento captures resource handle

```python
class FileEditor:
    def __init__(self, path):
        self.fd = open(path, 'r+')   # open file
        self.cursor = 0

    def save(self) -> 'Memento':
        return Memento(fd=self.fd, cursor=self.cursor)
```

After process restart, restoring a serialized Memento has a stale `fd`.

<details><summary>Reveal</summary>

**Bug:** Memento captures a file descriptor. On restart, the `fd` is invalid (or could refer to a different file).

**Fix:** capture identifiers, reacquire resources on restore.

```python
class FileEditor:
    def save(self) -> 'Memento':
        return Memento(path=self.path, cursor=self.cursor)

    def restore(self, m: 'Memento'):
        self.fd = open(m.path, 'r+')   # reacquire
        self.cursor = m.cursor
```

**Lesson:** Mementos capture state, not resources. Strip transient resources; reacquire on restore.

</details>

---

## Bug 7: Concurrent capture races

```java
public final class Counter {
    private int count;
    private String label;

    public Memento save() {
        return new Memento(count, label);   // not atomic
    }
}
```

Thread A calls `save()`. Thread B updates `count`. Snapshot has new count + old label (or vice versa).

<details><summary>Reveal</summary>

**Bug:** Save reads multiple fields without synchronization. The Memento may capture inconsistent state.

**Fix:** synchronize, or use immutable atomic state.

```java
public synchronized Memento save() { return new Memento(count, label); }
```

Or immutable holder:

```java
private final AtomicReference<State> state = new AtomicReference<>(...);
public Memento save() { return new Memento(state.get()); }
```

**Lesson:** Multi-field captures need atomicity. Single AtomicReference + immutable record is the cleanest pattern.

</details>

---

## Bug 8: Schema breakage on deserialization

```typescript
class Memento {
    constructor(public count: number, public label: string) {}

    serialize(): string { return JSON.stringify(this); }
    static deserialize(s: string): Memento {
        const data = JSON.parse(s);
        return new Memento(data.count, data.label);   // BUG: breaks if v1 has no label
    }
}
```

Loading v1 data: `data.label` is undefined; `Memento` ends up with `label = undefined`.

<details><summary>Reveal</summary>

**Bug:** Deserializer assumes all fields present. V1 Mementos (before `label` was added) break.

**Fix:** schema version + defaults.

```typescript
static deserialize(s: string): Memento {
    const data: any = JSON.parse(s);
    const version = data.__version ?? 1;
    if (version === 1) {
        return new Memento(data.count ?? 0, "");   // default label
    }
    return new Memento(data.count, data.label);
}
```

Always include version field. Always handle missing fields.

**Lesson:** Persistent Mementos need schema versioning. Migrations live in the deserializer.

</details>

---

## Bug 9: Memento exposes sensitive data in logs

```python
@dataclass
class UserMemento:
    username: str
    password: str
    email: str


m = user.save()
logger.info(f"snapshot: {m}")   # logs the password
```

<details><summary>Reveal</summary>

**Bug:** Default `__repr__` includes all fields. Password leaks into logs.

**Fix:** custom `__repr__` that redacts sensitive fields.

```python
@dataclass
class UserMemento:
    username: str
    password: str = field(repr=False)   # excluded from default repr
    email: str
```

Or override:

```python
def __repr__(self) -> str:
    return f"UserMemento(username={self.username!r}, password='[REDACTED]', email={self.email!r})"
```

**Lesson:** Mementos can contain sensitive data. Mark explicitly; redact in logs.

</details>

---

## Bug 10: Half-restore corrupts state

```java
public void restore(Memento m) {
    this.title = m.title;
    if (m.body == null) return;   // BUG: early return; cursor not restored
    this.body = m.body;
    this.cursor = m.cursor;
}
```

Restoring a Memento with null body leaves the editor with new title but old body and cursor.

<details><summary>Reveal</summary>

**Bug:** Partial restore. Some fields set, others left at old values. State is now incoherent — neither the Memento's nor the original's.

**Fix:** restore atomically. Either all fields set, or none.

```java
public void restore(Memento m) {
    Objects.requireNonNull(m);
    Objects.requireNonNull(m.title);
    Objects.requireNonNull(m.body);
    this.title = m.title;
    this.body = m.body;
    this.cursor = m.cursor;
}
```

If null is valid, the Memento should NOT have null fields — they should be `Optional` or "absent" markers.

**Lesson:** Restore is all-or-nothing. Validate Memento; restore all fields.

</details>

---

## Bug 11: Diff-based Memento applied out of order

```python
class Document:
    def revert(self, patches):
        for p in patches:   # BUG: forward order
            setattr(self, p.field, p.old)
```

If patches are dependent, applying in forward order corrupts state.

<details><summary>Reveal</summary>

**Bug:** Diff patches must be reverted in **reverse** order. Applying them forward means later patches' "old" values are based on a state that doesn't exist anymore.

**Fix:**

```python
def revert(self, patches):
    for p in reversed(patches):
        setattr(self, p.field, p.old)
```

**Lesson:** Diff-based undo applies patches in reverse order. Like nested function calls — last in, first out.

</details>

---

## Bug 12: Memento captures wrong scope

```java
public final class Editor {
    private String content;
    private final List<Listener> listeners = new ArrayList<>();   // not part of "state"

    public Memento save() {
        return new Memento(this.content, this.listeners);   // BUG: includes listeners
    }
}
```

Restoring resets the listener list — observers are silently disconnected.

<details><summary>Reveal</summary>

**Bug:** Memento captures *all* fields, including transient infrastructure (listeners, locks, executors). Restoring corrupts observers.

**Fix:** capture only "state," not "infrastructure."

```java
public Memento save() {
    return new Memento(this.content);   // listeners are not state
}

public void restore(Memento m) {
    this.content = m.content;   // listeners stay attached
}
```

**Lesson:** Decide what's "state" (saved) vs "infrastructure" (kept). Mementos shouldn't disrupt the Originator's wiring.

</details>

---

## Practice Tips

- **Mutable references in Mementos cause silent drift.** Deep-copy or use immutable values.
- **Caretaker reads = encapsulation broken.** Caretaker stores opaque tokens only.
- **Mementos must be immutable.** Frozen / final / readonly.
- **Redo invariant: cleared on new action.** Always.
- **Bound history.** Always.
- **Strip resources before saving.** Capture identifiers; reacquire on restore.
- **Concurrent captures need atomicity.** Synchronize or use immutable atomic state.
- **Persistent Mementos need versioning.** Migrate in deserializer.
- **Sensitive data → explicit redaction.**
- **Restore is all-or-nothing.** Validate; set all fields.
- **Diff-based undo: reverse order.**
- **Capture state, not infrastructure.** Listeners, locks, executors stay.

[← Tasks](tasks.md) · [Optimize →](optimize.md)
