# Mediator — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/mediator](https://refactoring.guru/design-patterns/mediator)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Login dialog Mediator](#task-1-login-dialog-mediator)
2. [Task 2: Chat room](#task-2-chat-room)
3. [Task 3: Smart-home hub](#task-3-smart-home-hub)
4. [Task 4: Saga orchestrator](#task-4-saga-orchestrator)
5. [Task 5: Hierarchical Mediator](#task-5-hierarchical-mediator)
6. [Task 6: MediatR-style command bus](#task-6-mediatr-style-command-bus)
7. [Task 7: Cycle detection in Mediator](#task-7-cycle-detection-in-mediator)
8. [Task 8: Wizard form Mediator](#task-8-wizard-form-mediator)
9. [Task 9: Air-traffic control simulation](#task-9-air-traffic-control-simulation)
10. [Task 10: Distributed orchestrator with idempotency](#task-10-distributed-orchestrator-with-idempotency)
11. [How to Practice](#how-to-practice)

---

## Task 1: Login dialog Mediator

**Brief.** Username, password fields; submit button. Submit enables only when both fields are filled.

### Solution (Java)

```java
public interface DialogMediator {
    void onTextChanged(String fieldName, String value);
    void onSubmitClicked();
}

public final class TextField {
    private final DialogMediator m;
    private final String name;
    private String value = "";
    public TextField(DialogMediator m, String name) { this.m = m; this.name = name; }
    public String value() { return value; }
    public void setValue(String v) { value = v; m.onTextChanged(name, v); }
}

public final class Button {
    private boolean enabled = false;
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean e) { enabled = e; }
}

public final class LoginDialog implements DialogMediator {
    public final TextField username = new TextField(this, "username");
    public final TextField password = new TextField(this, "password");
    public final Button submit = new Button();

    public void onTextChanged(String fieldName, String value) {
        submit.setEnabled(!username.value().isEmpty() && !password.value().isEmpty());
    }

    public void onSubmitClicked() {
        if (submit.isEnabled()) System.out.println("logging in: " + username.value());
    }
}

class Demo {
    public static void main(String[] args) {
        LoginDialog d = new LoginDialog();
        System.out.println(d.submit.isEnabled());   // false
        d.username.setValue("alice");
        System.out.println(d.submit.isEnabled());   // false
        d.password.setValue("secret");
        System.out.println(d.submit.isEnabled());   // true
        d.onSubmitClicked();
    }
}
```

---

## Task 2: Chat room

**Brief.** Multiple users post; the room broadcasts to all except sender.

### Solution (Python)

```python
from typing import List


class User:
    def __init__(self, name: str, room: "ChatRoom") -> None:
        self.name = name
        self.room = room
        self.room.join(self)

    def say(self, msg: str) -> None:
        self.room.send(self, msg)

    def receive(self, sender_name: str, msg: str) -> None:
        print(f"[{self.name} sees] {sender_name}: {msg}")


class ChatRoom:
    """Mediator."""
    def __init__(self) -> None:
        self.users: List[User] = []

    def join(self, u: User) -> None:
        self.users.append(u)

    def send(self, sender: User, msg: str) -> None:
        for u in self.users:
            if u is not sender:
                u.receive(sender.name, msg)


if __name__ == "__main__":
    room = ChatRoom()
    alice = User("Alice", room)
    bob = User("Bob", room)
    carol = User("Carol", room)

    alice.say("hi everyone")
    bob.say("hey Alice")
```

Users don't know each other.

---

## Task 3: Smart-home hub

**Brief.** Motion sensor → hub → light + alarm.

### Solution (Python)

```python
class Hub:
    def __init__(self) -> None:
        self.devices = {}

    def register(self, name: str, device) -> None:
        self.devices[name] = device

    def notify(self, source: str, event: str) -> None:
        if source == "motion" and event == "detected":
            self.devices["light"].on()
            if self._is_night():
                self.devices["alarm"].arm()

    def _is_night(self) -> bool:
        from datetime import datetime
        return datetime.now().hour < 6 or datetime.now().hour >= 22


class MotionSensor:
    def __init__(self, hub: Hub) -> None:
        self._hub = hub
    def detect(self) -> None:
        print("[motion] detected")
        self._hub.notify("motion", "detected")


class Light:
    def on(self) -> None: print("[light] ON")
    def off(self) -> None: print("[light] OFF")


class Alarm:
    def arm(self) -> None: print("[alarm] armed")


hub = Hub()
hub.register("motion", MotionSensor(hub))
hub.register("light", Light())
hub.register("alarm", Alarm())

hub.devices["motion"].detect()
```

---

## Task 4: Saga orchestrator

**Brief.** Three steps with compensations. On failure, run reverse compensations.

### Solution (Python)

```python
from typing import Callable, List


class Saga:
    def __init__(self, name: str) -> None:
        self.name = name
        self.steps: List[tuple[str, Callable, Callable]] = []

    def add(self, name: str, action: Callable, comp: Callable) -> None:
        self.steps.append((name, action, comp))

    def run(self, ctx: dict) -> None:
        completed = []
        try:
            for name, action, _ in self.steps:
                action(ctx)
                completed.append(name)
            print(f"[{self.name}] done")
        except Exception as e:
            print(f"[{self.name}] failed: {e}; rolling back {completed}")
            for name, _, comp in reversed([s for s in self.steps if s[0] in completed]):
                try: comp(ctx)
                except Exception as ce: print(f"comp {name} failed: {ce}")
            raise


def charge(ctx): print("charged"); ctx["charged"] = True
def refund(ctx): print("refunded")
def reserve(ctx): print("reserved"); ctx["reserved"] = True
def release(ctx): print("released")
def ship(ctx): raise RuntimeError("shipping unavailable")
def recall(ctx): print("recalled")


saga = Saga("OrderSaga")
saga.add("charge", charge, refund)
saga.add("reserve", reserve, release)
saga.add("ship", ship, recall)

try: saga.run({})
except Exception: pass
# charged
# reserved
# [OrderSaga] failed: shipping unavailable; rolling back ['charge', 'reserve']
# released
# refunded
```

---

## Task 5: Hierarchical Mediator

**Brief.** Page mediator coordinating header, form, footer sub-mediators.

### Solution (TypeScript)

```typescript
interface Mediator {
    notify(source: string, event: string, data?: unknown): void;
}

class HeaderMediator implements Mediator {
    constructor(private parent: Mediator) {}
    notify(source: string, event: string): void {
        if (source === 'logo' && event === 'clicked') {
            this.parent.notify('header', 'go-home');
        }
    }
}

class FormMediator implements Mediator {
    constructor(private parent: Mediator) {}
    private valid = false;
    notify(source: string, event: string, data?: unknown): void {
        if (source === 'submit' && event === 'clicked' && this.valid) {
            this.parent.notify('form', 'submitted', data);
        } else if (source === 'field' && event === 'changed') {
            // re-validate
            this.valid = true;
        }
    }
}

class PageMediator implements Mediator {
    private header = new HeaderMediator(this);
    private form = new FormMediator(this);

    notify(source: string, event: string, data?: unknown): void {
        if (source === 'header' && event === 'go-home') {
            console.log('navigating home');
        } else if (source === 'form' && event === 'submitted') {
            console.log('form submitted:', data);
        }
    }
}
```

Sub-mediators handle local concerns; page mediator routes between them.

---

## Task 6: MediatR-style command bus

**Brief.** `bus.send(Command)` routes to a registered handler. Add a logging behavior.

### Solution (Python)

```python
from typing import Callable, Dict, Type


class CommandBus:
    def __init__(self) -> None:
        self._handlers: Dict[Type, Callable] = {}
        self._behaviors = []

    def register(self, cmd_type: Type, handler: Callable) -> None:
        self._handlers[cmd_type] = handler

    def add_behavior(self, behavior: Callable) -> None:
        self._behaviors.append(behavior)

    def send(self, cmd) -> None:
        handler = self._handlers[type(cmd)]
        # Build pipeline.
        pipeline = handler
        for b in reversed(self._behaviors):
            next_step = pipeline
            pipeline = lambda c, b=b, n=next_step: b(c, n)
        return pipeline(cmd)


# Behavior: logging.
def logging_behavior(cmd, next_):
    print(f"[bus] dispatching {type(cmd).__name__}")
    result = next_(cmd)
    print(f"[bus] done {type(cmd).__name__}")
    return result


# Commands and handlers.
class PlaceOrder:
    def __init__(self, order_id): self.order_id = order_id


def handle_place_order(cmd: PlaceOrder):
    print(f"placing order {cmd.order_id}")


bus = CommandBus()
bus.register(PlaceOrder, handle_place_order)
bus.add_behavior(logging_behavior)

bus.send(PlaceOrder("o1"))
# [bus] dispatching PlaceOrder
# placing order o1
# [bus] done PlaceOrder
```

Pipeline behaviors decorate dispatch; logging, validation, retry can chain.

---

## Task 7: Cycle detection in Mediator

**Brief.** Mediator that detects nested notifications and breaks the cycle.

### Solution (Java)

```java
public final class CycleAwareMediator {
    private final ThreadLocal<Boolean> inDispatch = ThreadLocal.withInitial(() -> false);

    public void notify(String source, String event) {
        if (inDispatch.get()) {
            System.out.println("nested notify; skipping");
            return;
        }
        inDispatch.set(true);
        try {
            handle(source, event);
        } finally {
            inDispatch.set(false);
        }
    }

    private void handle(String source, String event) {
        // routing logic; if it causes a re-notify, the flag short-circuits
        if (source == "a") notify("a", "echo");   // would loop without the guard
    }
}
```

Re-entrant calls return early; main flow continues normally.

---

## Task 8: Wizard form Mediator

**Brief.** Multi-step wizard; state shared across steps; navigation buttons coordinated.

### Solution (TypeScript)

```typescript
interface Step {
    name: string;
    isValid(): boolean;
}

class WizardMediator {
    private steps: Step[];
    private currentIndex = 0;
    private state: Record<string, unknown> = {};

    constructor(steps: Step[]) { this.steps = steps; }

    current(): Step { return this.steps[this.currentIndex]; }

    canNext(): boolean {
        return this.currentIndex < this.steps.length - 1 && this.current().isValid();
    }
    canPrev(): boolean { return this.currentIndex > 0; }

    next(): void { if (this.canNext()) this.currentIndex++; }
    prev(): void { if (this.canPrev()) this.currentIndex--; }

    set(key: string, value: unknown): void { this.state[key] = value; }
    get(key: string): unknown { return this.state[key]; }
}

class FormStep implements Step {
    constructor(public name: string, private mediator: WizardMediator) {}
    isValid(): boolean { return Boolean(this.mediator.get(`${this.name}_filled`)); }
}

const wizard = new WizardMediator([
    new FormStep("contact", null!),
    new FormStep("payment", null!),
    new FormStep("review", null!),
]);
```

(Skipping wiring for brevity; the principle: Mediator owns state and navigation.)

---

## Task 9: Air-traffic control simulation

**Brief.** Tower (Mediator) coordinates planes; only one plane lands at a time.

### Solution (Python)

```python
from collections import deque


class Tower:
    def __init__(self) -> None:
        self.runway_busy = False
        self.queue: deque = deque()

    def request_landing(self, plane: "Plane") -> None:
        if not self.runway_busy:
            self.runway_busy = True
            print(f"tower: cleared {plane.callsign} to land")
            plane.land()
        else:
            print(f"tower: {plane.callsign} hold; queue {len(self.queue)+1}")
            self.queue.append(plane)

    def landed(self, plane: "Plane") -> None:
        print(f"tower: {plane.callsign} landed; runway free")
        self.runway_busy = False
        if self.queue:
            next_plane = self.queue.popleft()
            self.request_landing(next_plane)


class Plane:
    def __init__(self, callsign: str, tower: Tower) -> None:
        self.callsign = callsign
        self.tower = tower

    def request_land(self) -> None:
        self.tower.request_landing(self)

    def land(self) -> None:
        # simulated landing
        self.tower.landed(self)


tower = Tower()
p1 = Plane("UA42", tower); p1.request_land()
p2 = Plane("DL11", tower); p2.request_land()
p3 = Plane("AA99", tower); p3.request_land()
# Tower coordinates; planes don't know each other.
```

---

## Task 10: Distributed orchestrator with idempotency

**Brief.** Async orchestrator with idempotency keys; retries safe.

### Solution (Python)

```python
import asyncio
import uuid
from typing import Set


class IdempotencyStore:
    def __init__(self) -> None:
        self._seen: Set[str] = set()

    def seen(self, key: str) -> bool:
        if key in self._seen: return True
        self._seen.add(key)
        return False


class Orchestrator:
    def __init__(self, store: IdempotencyStore):
        self.store = store

    async def step(self, name: str, key: str, action) -> None:
        if self.store.seen(key):
            print(f"[{name}] dedup hit: {key}")
            return
        await action()
        print(f"[{name}] done: {key}")

    async def place(self, order_id: str) -> None:
        prefix = f"order:{order_id}"
        await self.step("charge", f"{prefix}:charge", self._charge)
        await self.step("reserve", f"{prefix}:reserve", self._reserve)
        await self.step("ship", f"{prefix}:ship", self._ship)

    async def _charge(self): await asyncio.sleep(0.01); print("charged")
    async def _reserve(self): await asyncio.sleep(0.01); print("reserved")
    async def _ship(self): await asyncio.sleep(0.01); print("shipped")


async def main():
    orch = Orchestrator(IdempotencyStore())
    await orch.place("o1")
    print("--- retry ---")
    await orch.place("o1")   # all dedup hits


asyncio.run(main())
```

Each step's idempotency key prevents duplicate work on retries.

---

## How to Practice

- **Build the login dialog first.** Most intuitive Mediator.
- **Try the chat room.** Compares cleanly with Observer (one-to-many).
- **Implement a simple saga.** Steps + compensations; trigger failures to test rollback.
- **Build a hierarchical Mediator.** Real UIs are multi-level.
- **Read MediatR source code.** Production-grade pipeline behavior.
- **Look at Temporal SDK examples.** Workflow IS Mediator — see how the engine handles state.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
