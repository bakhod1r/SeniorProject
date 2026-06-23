# Memento — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/memento](https://refactoring.guru/design-patterns/memento)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Counter with undo](#task-1-counter-with-undo)
2. [Task 2: Editor with undo / redo](#task-2-editor-with-undo-redo)
3. [Task 3: Diff-based Memento](#task-3-diff-based-memento)
4. [Task 4: Persistent draft autosave](#task-4-persistent-draft-autosave)
5. [Task 5: Bounded undo history](#task-5-bounded-undo-history)
6. [Task 6: Snapshot in event-sourced aggregate](#task-6-snapshot-in-event-sourced-aggregate)
7. [Task 7: Sensitive data redaction](#task-7-sensitive-data-redaction)
8. [Task 8: Concurrent snapshot via AtomicReference](#task-8-concurrent-snapshot-via-atomicreference)
9. [Task 9: Schema-versioned Memento](#task-9-schema-versioned-memento)
10. [Task 10: Memento + Command for undo](#task-10-memento-command-for-undo)
11. [How to Practice](#how-to-practice)

---

## Task 1: Counter with undo

**Brief.** A counter with `inc()`. Memento captures the value; restore replaces.

### Solution (Java)

```java
public final class Counter {
    private int value;
    public void inc() { value++; }
    public int value() { return value; }
    public Memento save() { return new Memento(value); }
    public void restore(Memento m) { value = m.value; }

    public static final class Memento {
        private final int value;
        Memento(int v) { this.value = v; }
    }
}

class Demo {
    public static void main(String[] args) {
        Counter c = new Counter();
        Counter.Memento m = c.save();
        c.inc(); c.inc(); c.inc();
        System.out.println(c.value());   // 3
        c.restore(m);
        System.out.println(c.value());   // 0
    }
}
```

---

## Task 2: Editor with undo / redo

**Brief.** Document with `append`. Implement undo and redo.

### Solution (Java)

```java
import java.util.*;

public final class Editor {
    private final StringBuilder buf = new StringBuilder();
    public void append(String s) { buf.append(s); }
    public String text() { return buf.toString(); }

    public Memento save() { return new Memento(buf.toString()); }
    public void restore(Memento m) {
        buf.setLength(0);
        buf.append(m.content);
    }

    public static final class Memento {
        private final String content;
        Memento(String c) { this.content = c; }
    }
}

public final class History {
    private final Deque<Editor.Memento> undo = new ArrayDeque<>();
    private final Deque<Editor.Memento> redo = new ArrayDeque<>();

    public void record(Editor.Memento m) { undo.push(m); redo.clear(); }
    public Editor.Memento undo(Editor.Memento current) {
        if (undo.isEmpty()) return null;
        redo.push(current); return undo.pop();
    }
    public Editor.Memento redo(Editor.Memento current) {
        if (redo.isEmpty()) return null;
        undo.push(current); return redo.pop();
    }
}
```

Stack-based; redo cleared on new action.

---

## Task 3: Diff-based Memento

**Brief.** Document fields; updating returns a Patch; reverting applies the inverse.

### Solution (Python)

```python
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Patch:
    field: str
    old: Any
    new: Any


class Document:
    def __init__(self) -> None:
        self.title = ""
        self.body = ""

    def update(self, field: str, value: Any) -> Patch:
        old = getattr(self, field)
        setattr(self, field, value)
        return Patch(field, old, value)

    def revert(self, p: Patch) -> None:
        setattr(self, p.field, p.old)


doc = Document()
patches = [doc.update("title", "Hello"), doc.update("body", "World")]
print(doc.title, "/", doc.body)   # Hello / World

for p in reversed(patches):
    doc.revert(p)
print(doc.title, "/", doc.body)   # / (empty)
```

Each patch is a tiny Memento.

---

## Task 4: Persistent draft autosave

**Brief.** Form state serialized to localStorage; restored on reload.

### Solution (TypeScript)

```typescript
interface FormState {
    name: string;
    email: string;
    notes: string;
}

class FormMemento {
    constructor(private state: FormState) {}
    serialize(): string { return JSON.stringify({ v: 1, ...this.state }); }
    static deserialize(s: string): FormMemento {
        const parsed = JSON.parse(s);
        return new FormMemento({
            name: parsed.name ?? "",
            email: parsed.email ?? "",
            notes: parsed.notes ?? "",
        });
    }
    state(): FormState { return this.state; }
}

class Form {
    private state: FormState = { name: "", email: "", notes: "" };
    save(): FormMemento { return new FormMemento({ ...this.state }); }
    restore(m: FormMemento): void { this.state = { ...m.state() }; }
    set<K extends keyof FormState>(key: K, value: FormState[K]) { this.state[key] = value; }
}

const form = new Form();
form.set("email", "alice@example.com");
localStorage.setItem("draft", form.save().serialize());

// On page load:
const raw = localStorage.getItem("draft");
if (raw) form.restore(FormMemento.deserialize(raw));
```

Schema-versioned (`v: 1`); defaults handle missing fields.

---

## Task 5: Bounded undo history

**Brief.** History stack with a max size; oldest dropped.

### Solution (Java)

```java
import java.util.*;

public final class BoundedHistory<T> {
    private final Deque<T> stack = new ArrayDeque<>();
    private final int maxSize;

    public BoundedHistory(int max) { this.maxSize = max; }

    public void push(T m) {
        stack.push(m);
        while (stack.size() > maxSize) stack.removeLast();
    }

    public T pop() { return stack.isEmpty() ? null : stack.pop(); }
    public int size() { return stack.size(); }
}

class Demo {
    public static void main(String[] args) {
        var hist = new BoundedHistory<Integer>(3);
        for (int i = 0; i < 5; i++) hist.push(i);
        System.out.println(hist.size());   // 3
        System.out.println(hist.pop());    // 4
    }
}
```

Memory bounded.

---

## Task 6: Snapshot in event-sourced aggregate

**Brief.** Aggregate with `apply(event)`; snapshot every N events; load uses latest snapshot + tail events.

### Solution (Python)

```python
from dataclasses import dataclass, field, asdict
from typing import List


@dataclass
class Order:
    items: List[str] = field(default_factory=list)
    status: str = "pending"
    sequence: int = 0

    def apply(self, event: dict) -> None:
        if event["type"] == "ItemAdded":
            self.items.append(event["item"])
        elif event["type"] == "Shipped":
            self.status = "shipped"
        self.sequence += 1


@dataclass
class Snapshot:
    sequence: int
    state: dict


class Repo:
    def __init__(self) -> None:
        self.events: List[dict] = []
        self.snapshots: List[Snapshot] = []
        self.snapshot_every = 5

    def append(self, event: dict) -> None:
        self.events.append(event)
        if len(self.events) % self.snapshot_every == 0:
            o = self.load()
            self.snapshots.append(Snapshot(sequence=o.sequence, state=asdict(o)))

    def load(self) -> Order:
        if self.snapshots:
            snap = self.snapshots[-1]
            o = Order(**snap.state)
            for e in self.events[snap.sequence:]:
                o.apply(e)
        else:
            o = Order()
            for e in self.events:
                o.apply(e)
        return o


repo = Repo()
for i in range(12):
    repo.append({"type": "ItemAdded", "item": f"item-{i}"})

order = repo.load()
print(order.sequence, len(order.items))   # 12 12
print(f"snapshots taken: {len(repo.snapshots)}")
```

Snapshots accelerate loading.

---

## Task 7: Sensitive data redaction

**Brief.** Memento containing a password; serializer redacts when logging.

### Solution (Python)

```python
from dataclasses import dataclass


@dataclass
class UserMemento:
    username: str
    password: str
    email: str

    def __repr__(self) -> str:
        return f"UserMemento(username={self.username!r}, password='[REDACTED]', email={self.email!r})"

    def serialize_for_log(self) -> dict:
        return {"username": self.username, "password": "[REDACTED]", "email": self.email}


m = UserMemento("alice", "supersecret", "alice@example.com")
print(m)                       # password redacted
print(m.serialize_for_log())   # password redacted
```

Override `__repr__` to prevent accidental leakage. Provide explicit serialization that strips sensitive fields.

---

## Task 8: Concurrent snapshot via AtomicReference

**Brief.** Lock-free Memento via AtomicReference + immutable record.

### Solution (Java)

```java
import java.util.concurrent.atomic.AtomicReference;

public final class Counter {
    public record State(int count, String label) {}
    private final AtomicReference<State> state = new AtomicReference<>(new State(0, "initial"));

    public State save() { return state.get(); }   // memento = current immutable state
    public void restore(State s) { state.set(s); }

    public void increment() {
        state.updateAndGet(s -> new State(s.count() + 1, s.label()));
    }

    public State current() { return state.get(); }
}

class Demo {
    public static void main(String[] args) {
        Counter c = new Counter();
        var snap = c.save();
        c.increment(); c.increment();
        System.out.println(c.current());   // count=2
        c.restore(snap);
        System.out.println(c.current());   // count=0
    }
}
```

Lock-free; snapshots are pointer-cheap.

---

## Task 9: Schema-versioned Memento

**Brief.** Memento format evolves; loader migrates old data.

### Solution (TypeScript)

```typescript
interface StateV1 { count: number }
interface StateV2 { count: number; label: string }

class Memento {
    constructor(public count: number, public label: string) {}

    serialize(): string {
        return JSON.stringify({ __version: 2, count: this.count, label: this.label });
    }

    static deserialize(s: string): Memento {
        const data: any = JSON.parse(s);
        const version = data.__version ?? 1;
        if (version === 1) return new Memento(data.count, "");
        return new Memento(data.count, data.label);
    }
}

// V1 data:
const v1 = `{"count": 42}`;
const restored = Memento.deserialize(v1);
console.log(restored);   // count=42, label=""
```

Schema migration in deserializer.

---

## Task 10: Memento + Command for undo

**Brief.** Command captures Memento on execute; restores on undo.

### Solution (Java)

```java
public interface Command {
    void execute();
    void undo();
}

public final class TypeCommand implements Command {
    private final Editor editor;
    private final String text;
    private Editor.Memento snapBefore;

    public TypeCommand(Editor e, String t) { this.editor = e; this.text = t; }

    public void execute() {
        snapBefore = editor.save();
        editor.append(text);
    }

    public void undo() {
        if (snapBefore != null) editor.restore(snapBefore);
    }
}

class Demo {
    public static void main(String[] args) {
        var editor = new Editor();
        var cmd = new TypeCommand(editor, "Hello, World!");
        cmd.execute();
        System.out.println(editor.text());   // Hello, World!
        cmd.undo();
        System.out.println(editor.text());   // (empty)
    }
}
```

Clean separation: Command knows the action; Memento knows the state.

---

## How to Practice

- **Build the editor first.** Most intuitive Memento application.
- **Try diff-based Memento.** Real-world editors use this for memory efficiency.
- **Persist a Memento.** Round-trip serialization → deserialization → restore. Verify byte-for-byte equivalence.
- **Bound the history.** Always. Run a stress test that fills the stack; verify oldest drops.
- **Pair with Command.** The canonical undo/redo pattern.
- **Read Redux + Immer source.** Production-grade Memento via persistent data structures.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
