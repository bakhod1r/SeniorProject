# Command — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/command](https://refactoring.guru/design-patterns/command)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Counter with undo](#task-1-counter-with-undo)
2. [Task 2: Editor with undo / redo](#task-2-editor-with-undo-redo)
3. [Task 3: Macro Command](#task-3-macro-command)
4. [Task 4: Idempotent task queue](#task-4-idempotent-task-queue)
5. [Task 5: Transactional macro with rollback](#task-5-transactional-macro-with-rollback)
6. [Task 6: Async Command bus](#task-6-async-command-bus)
7. [Task 7: Command serialization](#task-7-command-serialization)
8. [Task 8: Command logging interceptor](#task-8-command-logging-interceptor)
9. [Task 9: Saga orchestrator](#task-9-saga-orchestrator)
10. [Task 10: Snapshot-based undo](#task-10-snapshot-based-undo)
11. [How to Practice](#how-to-practice)

---

## Task 1: Counter with undo

**Brief.** A `Counter` with `inc()` / `dec()`. An `IncrementCommand` with `execute()` and `undo()`.

### Solution (Java)

```java
class Counter {
    private int value;
    public void inc() { value++; }
    public void dec() { value--; }
    public int value() { return value; }
}

interface Command {
    void execute();
    void undo();
}

class IncrementCommand implements Command {
    private final Counter c;
    public IncrementCommand(Counter c) { this.c = c; }
    public void execute() { c.inc(); }
    public void undo()    { c.dec(); }
}

public class Demo {
    public static void main(String[] args) {
        Counter c = new Counter();
        Command cmd = new IncrementCommand(c);
        cmd.execute(); cmd.execute(); cmd.execute();
        System.out.println(c.value());   // 3
        cmd.undo();
        System.out.println(c.value());   // 2
    }
}
```

---

## Task 2: Editor with undo / redo

**Brief.** A document supporting `append(text)`. Implement undo and redo with two stacks.

### Solution (Java)

```java
import java.util.*;

class Document {
    private final StringBuilder buf = new StringBuilder();
    public void append(String s) { buf.append(s); }
    public void truncate(int by)  { buf.setLength(buf.length() - by); }
    public String text() { return buf.toString(); }
}

class AppendCommand implements Command {
    private final Document doc;
    private final String text;
    public AppendCommand(Document d, String t) { this.doc = d; this.text = t; }
    public void execute() { doc.append(text); }
    public void undo()    { doc.truncate(text.length()); }
}

class History {
    private final Deque<Command> undo = new ArrayDeque<>();
    private final Deque<Command> redo = new ArrayDeque<>();

    public void execute(Command c) {
        c.execute();
        undo.push(c);
        redo.clear();
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

Key invariant: any new `execute()` clears the redo stack.

---

## Task 3: Macro Command

**Brief.** Combine multiple Commands into one; `execute()` runs them; `undo()` reverses them in reverse order.

### Solution (Java)

```java
import java.util.*;

class MacroCommand implements Command {
    private final List<Command> cmds;
    public MacroCommand(List<Command> cs) { this.cmds = cs; }
    public void execute() { for (Command c : cmds) c.execute(); }
    public void undo() {
        for (int i = cmds.size() - 1; i >= 0; i--) cmds.get(i).undo();
    }
}

public class Demo {
    public static void main(String[] args) {
        Document doc = new Document();
        Command macro = new MacroCommand(List.of(
            new AppendCommand(doc, "Hello, "),
            new AppendCommand(doc, "World!"),
            new AppendCommand(doc, "\n")
        ));
        macro.execute();
        System.out.println(doc.text());   // "Hello, World!\n"
        macro.undo();
        System.out.println(doc.text());   // "" (empty)
    }
}
```

---

## Task 4: Idempotent task queue

**Brief.** A queue with idempotency keys. Same key submitted twice executes once.

### Solution (Python)

```python
from collections import OrderedDict
from typing import Callable, Optional


class IdempotentQueue:
    def __init__(self, max_keys: int = 10_000) -> None:
        self._results: OrderedDict[str, object] = OrderedDict()
        self._max_keys = max_keys

    def submit(self, key: str, fn: Callable[[], object]) -> object:
        if key in self._results:
            self._results.move_to_end(key)
            return self._results[key]
        result = fn()
        self._results[key] = result
        if len(self._results) > self._max_keys:
            self._results.popitem(last=False)
        return result


if __name__ == "__main__":
    q = IdempotentQueue()
    counter = {"value": 0}

    def increment():
        counter["value"] += 1
        return counter["value"]

    print(q.submit("k1", increment))   # 1
    print(q.submit("k1", increment))   # 1 (cached)
    print(q.submit("k2", increment))   # 2 (new)
    print(counter["value"])             # 2 (only ran twice)
```

LRU eviction keeps memory bounded.

---

## Task 5: Transactional macro with rollback

**Brief.** A macro that rolls back partial work on failure.

### Solution (Java)

```java
class TransactionalMacro implements Command {
    private final List<Command> cmds;
    private final List<Command> done = new ArrayList<>();

    public TransactionalMacro(List<Command> cs) { this.cmds = cs; }

    public void execute() {
        try {
            for (Command c : cmds) {
                c.execute();
                done.add(c);
            }
        } catch (Exception e) {
            for (int i = done.size() - 1; i >= 0; i--) {
                try { done.get(i).undo(); }
                catch (Exception ex) { /* log; can't recover further */ }
            }
            throw e;
        }
    }

    public void undo() {
        for (int i = cmds.size() - 1; i >= 0; i--) cmds.get(i).undo();
    }
}
```

If step 3 fails, steps 1 and 2 are undone. Caller sees the original exception.

---

## Task 6: Async Command bus

**Brief.** A bus where `dispatch(cmd)` returns a `CompletableFuture<Result>`. Handlers run on an executor.

### Solution (Java)

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;

public final class AsyncCommandBus {
    private final ExecutorService exec = Executors.newFixedThreadPool(8);
    private final Map<Class<?>, Function<?, ?>> handlers = new ConcurrentHashMap<>();

    public <C, R> void register(Class<C> type, Function<C, R> handler) {
        handlers.put(type, handler);
    }

    @SuppressWarnings("unchecked")
    public <C, R> CompletableFuture<R> dispatch(C cmd) {
        Function<C, R> h = (Function<C, R>) handlers.get(cmd.getClass());
        if (h == null) {
            return CompletableFuture.failedFuture(new IllegalArgumentException("no handler"));
        }
        return CompletableFuture.supplyAsync(() -> h.apply(cmd), exec);
    }

    public void shutdown() throws InterruptedException {
        exec.shutdown();
        exec.awaitTermination(5, TimeUnit.SECONDS);
    }
}

class Demo {
    record Add(int a, int b) {}

    public static void main(String[] args) throws Exception {
        var bus = new AsyncCommandBus();
        bus.register(Add.class, (Add cmd) -> cmd.a() + cmd.b());

        var future = bus.<Add, Integer>dispatch(new Add(2, 3));
        System.out.println(future.get());   // 5
        bus.shutdown();
    }
}
```

---

## Task 7: Command serialization

**Brief.** Serialize a Command to JSON, send "over the wire," deserialize, execute.

### Solution (Python)

```python
import json
from dataclasses import dataclass, asdict


@dataclass
class PlaceOrder:
    order_id: str
    items: list[str]


def execute(cmd: PlaceOrder) -> None:
    print(f"placing {cmd.order_id} with {cmd.items}")


# Serialize.
cmd = PlaceOrder(order_id="o1", items=["a", "b"])
wire = json.dumps({"type": "PlaceOrder", "data": asdict(cmd)})
print("wire:", wire)

# Deserialize on the other side.
parsed = json.loads(wire)
assert parsed["type"] == "PlaceOrder"
restored = PlaceOrder(**parsed["data"])

execute(restored)
```

For cross-language: use schema-managed formats (Avro, Protobuf).

---

## Task 8: Command logging interceptor

**Brief.** Wrap any Command with a logger that prints before + after execute.

### Solution (Java)

```java
class LoggingCommand implements Command {
    private final Command inner;
    private final String name;

    public LoggingCommand(String name, Command inner) {
        this.name = name;
        this.inner = inner;
    }

    public void execute() {
        long start = System.nanoTime();
        try {
            inner.execute();
            System.out.printf("[%s] ok in %d µs%n", name, (System.nanoTime() - start) / 1000);
        } catch (Exception e) {
            System.out.printf("[%s] failed: %s%n", name, e);
            throw e;
        }
    }

    public void undo() { inner.undo(); }
}
```

Decorator over Command. Stack multiple wrappers (logging, retry, metrics).

---

## Task 9: Saga orchestrator

**Brief.** Three Commands sequenced: charge, ship, notify. On failure, compensate previous.

### Solution (Python)

```python
from typing import Callable, List


class Saga:
    def __init__(self) -> None:
        self._steps: List[tuple[Callable[[], None], Callable[[], None]]] = []

    def add(self, action: Callable[[], None], compensation: Callable[[], None]) -> None:
        self._steps.append((action, compensation))

    def run(self) -> None:
        completed: List[int] = []
        try:
            for i, (action, _) in enumerate(self._steps):
                action()
                completed.append(i)
        except Exception as e:
            print(f"failed at step {len(completed)}: {e}")
            for i in reversed(completed):
                _, comp = self._steps[i]
                try:
                    comp()
                except Exception as ce:
                    print(f"compensation {i} failed: {ce}")
            raise


# Usage.
saga = Saga()
saga.add(lambda: print("charged"),       lambda: print("refund"))
saga.add(lambda: print("shipped"),       lambda: print("recall"))
saga.add(lambda: (_ for _ in ()).throw(RuntimeError("notify failed")), lambda: print("nothing to do"))

try:
    saga.run()
except Exception:
    pass
# Output:
# charged
# shipped
# failed at step 2: notify failed
# recall
# refund
```

---

## Task 10: Snapshot-based undo

**Brief.** A document where undo restores the previous state via snapshot (not by computing inverse).

### Solution (Java)

```java
class Document {
    private String text = "";
    public String text() { return text; }
    public void setText(String s) { this.text = s; }
}

class SnapshotUndoCommand implements Command {
    private final Document doc;
    private final String newText;
    private String oldText;

    public SnapshotUndoCommand(Document d, String newText) {
        this.doc = d;
        this.newText = newText;
    }

    public void execute() {
        oldText = doc.text();   // snapshot
        doc.setText(newText);
    }

    public void undo() {
        doc.setText(oldText);
    }
}
```

Works for any state change. Memory cost: one snapshot per Command.

---

## How to Practice

- **Build the editor first.** Most intuitive Command application; covers undo, history, redo.
- **Add macros and grouping.** Real editors group typing into single undo units.
- **Build a queue with retries and idempotency.** Production-grade Command scenarios.
- **Try a saga.** Even three steps illustrate the pattern's power and the compensation pain.
- **Serialize Commands.** Round-trip through JSON to feel what's required for transmission.
- **Read Spring's `CommandGateway` source** or NestJS CQRS for production-grade Command buses.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
