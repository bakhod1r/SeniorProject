# Mediator — Find the Bug

> **Source:** [refactoring.guru/design-patterns/mediator](https://refactoring.guru/design-patterns/mediator)

Each section presents a Mediator that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Cyclic notifications](#bug-1-cyclic-notifications)
2. [Bug 2: Component reaches into another via Mediator](#bug-2-component-reaches-into-another-via-mediator)
3. [Bug 3: Magic-string event typo](#bug-3-magic-string-event-typo)
4. [Bug 4: Mediator holds strong refs causing leak](#bug-4-mediator-holds-strong-refs-causing-leak)
5. [Bug 5: Saga compensation runs in wrong order](#bug-5-saga-compensation-runs-in-wrong-order)
6. [Bug 6: Compensations not idempotent](#bug-6-compensations-not-idempotent)
7. [Bug 7: Synchronized Mediator becomes bottleneck](#bug-7-synchronized-mediator-becomes-bottleneck)
8. [Bug 8: Component leaks into constructor before init](#bug-8-component-leaks-into-constructor-before-init)
9. [Bug 9: Mediator's notify swallows exceptions](#bug-9-mediators-notify-swallows-exceptions)
10. [Bug 10: Workflow non-determinism](#bug-10-workflow-non-determinism)
11. [Bug 11: State scattered across Mediator and Components](#bug-11-state-scattered-across-mediator-and-components)
12. [Bug 12: Distributed Mediator double-spends on retry](#bug-12-distributed-mediator-double-spends-on-retry)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Cyclic notifications

```java
public final class Dialog implements Mediator {
    private final TextField a = new TextField(this);
    private final TextField b = new TextField(this);

    public void notify(Component sender, String event) {
        if (sender == a) b.setValue(a.value());   // triggers b's notify
        if (sender == b) a.setValue(b.value());   // triggers a's notify
    }
}
```

Setting `a` causes infinite recursion.

<details><summary>Reveal</summary>

**Bug:** `b.setValue` triggers `b`'s `notify`, which calls `a.setValue`, which triggers `a`'s `notify`, which calls `b.setValue`... StackOverflow.

**Fix:** detect cycles with a thread-local flag.

```java
private final ThreadLocal<Boolean> inUpdate = ThreadLocal.withInitial(() -> false);

public void notify(Component sender, String event) {
    if (inUpdate.get()) return;
    inUpdate.set(true);
    try {
        if (sender == a) b.setValue(a.value());
        if (sender == b) a.setValue(b.value());
    } finally {
        inUpdate.set(false);
    }
}
```

Or, only update if values actually differ to break the cycle.

**Lesson:** Two-way bindings between Components through a Mediator can cycle. Detect or design out.

</details>

---

## Bug 2: Component reaches into another via Mediator

```java
public final class FormDialog implements Mediator {
    public final TextField username = new TextField(this);
    public final Button submit = new Button(this);

    // expose components publicly; defeats encapsulation
}

class UsernameField {
    public void onChange() {
        if (text.isEmpty()) {
            ((FormDialog) mediator).submit.setEnabled(false);   // BUG
        }
    }
}
```

<details><summary>Reveal</summary>

**Bug:** The Component reaches *through* the Mediator to manipulate another Component. Defeats decoupling. The Component is now coupled to `FormDialog`'s structure.

**Fix:** Mediator exposes named actions, not Components.

```java
public interface Mediator {
    void onTextChanged(String fieldName, String value);
}

class UsernameField {
    public void onChange() {
        mediator.onTextChanged("username", text);
    }
}

// FormDialog handles the routing privately:
public void onTextChanged(String fieldName, String value) {
    if ("username".equals(fieldName) && value.isEmpty()) submit.setEnabled(false);
}
```

**Lesson:** Components ask the Mediator; the Mediator decides. Don't reach back through.

</details>

---

## Bug 3: Magic-string event typo

```java
public void notify(Component sender, String event) {
    if ("submit_clicked".equals(event)) handleSubmit();   // expects this
    // ...
}

class SubmitButton {
    public void onClick() {
        mediator.notify(this, "submit-clicked");           // BUG: hyphen, not underscore
    }
}
```

Submit button does nothing. No error.

<details><summary>Reveal</summary>

**Bug:** Magic strings don't match. Compiler can't catch typos. The Mediator silently ignores the event.

**Fix:** typed methods or enums.

```java
public interface DialogMediator {
    void onSubmitClicked();
    void onCancelClicked();
}

class SubmitButton {
    public void onClick() { mediator.onSubmitClicked(); }
}
```

Or enum events:

```java
enum DialogEvent { SUBMIT_CLICKED, CANCEL_CLICKED, USERNAME_CHANGED }
```

**Lesson:** Magic strings are a fragile interface. Always typed.

</details>

---

## Bug 4: Mediator holds strong refs causing leak

```java
public class GlobalMediator {
    private static final GlobalMediator INSTANCE = new GlobalMediator();
    private final List<Component> components = new ArrayList<>();

    public void register(Component c) { components.add(c); }
    // No unregister
}

class RequestComponent {
    public RequestComponent() {
        GlobalMediator.INSTANCE.register(this);
    }
}
```

After thousands of requests, OOM.

<details><summary>Reveal</summary>

**Bug:** Components register but never unregister. The static Mediator holds them; they can't be GC'd.

**Fix:** add unregister or use weak references.

```java
public void unregister(Component c) { components.remove(c); }

class RequestComponent implements AutoCloseable {
    public void close() { GlobalMediator.INSTANCE.unregister(this); }
}
```

Or:

```java
private final List<WeakReference<Component>> components = new ArrayList<>();
```

**Lesson:** Mediators outliving Components must support unregister or use weak refs.

</details>

---

## Bug 5: Saga compensation runs in wrong order

```python
class Saga:
    def run(self):
        for action, comp in self.steps:
            try: action()
            except:
                # compensate in same order
                for _, c in self.steps[:i]:
                    c()
                raise
```

Compensations run in execute order, causing dependency errors.

<details><summary>Reveal</summary>

**Bug:** Compensations run in *forward* order. They should run in *reverse* order. If `charge` ran first and `reserve` second, you must `release` (reverse `reserve`) before `refund` (reverse `charge`) — otherwise dependencies are violated.

**Fix:**

```python
for _, c in reversed(self.steps[:i]):
    c()
```

**Lesson:** Compensations always run in reverse order. Like nested function calls — last in, first out.

</details>

---

## Bug 6: Compensations not idempotent

```python
async def refund(order):
    await payment_api.refund(order_id=order.id)   # creates a new refund
```

Saga retries trigger duplicate refunds; customer gets multiple refunds.

<details><summary>Reveal</summary>

**Bug:** `refund` creates a new refund record every call. Retries duplicate refunds.

**Fix:** check before acting, or use idempotency keys.

```python
async def refund(order):
    if await payment_api.is_refunded(order.id): return
    await payment_api.refund(order_id=order.id, idempotency_key=f"refund:{order.id}")
```

**Lesson:** Compensations are Commands; they must be idempotent. Saga retries are inevitable.

</details>

---

## Bug 7: Synchronized Mediator becomes bottleneck

```java
public final class GlobalEventMediator {
    public synchronized void notify(Event e) {
        for (Component c : components) c.handle(e);
    }
}
```

Throughput collapses under load; tens of thousands of events/sec is impossible.

<details><summary>Reveal</summary>

**Bug:** `synchronized` serializes all notifications. With many concurrent producers, they queue.

**Fix:** if Components are independent, dispatch async.

```java
private final ExecutorService exec = Executors.newFixedThreadPool(8);

public void notify(Event e) {
    for (Component c : components) {
        exec.submit(() -> {
            try { c.handle(e); }
            catch (Exception ex) { log.error("handle", ex); }
        });
    }
}
```

Or: shard by event type / source; one Mediator per shard.

**Lesson:** Centralized Mediators must be designed for concurrency. `synchronized` everywhere is the classic mistake.

</details>

---

## Bug 8: Component leaks into constructor before init

```java
public final class FormDialog implements Mediator {
    private final SubmitButton submit;

    public FormDialog() {
        // submit is created BEFORE FormDialog is fully constructed
        submit = new SubmitButton(this);   // `this` partially constructed
        submit.click();   // calls back into FormDialog's notify
    }

    public void notify(...) {
        someField.access();   // someField not yet initialized
    }
}
```

NPE deep in `notify`.

<details><summary>Reveal</summary>

**Bug:** `this` leaked into `SubmitButton` while the constructor was still running. `notify()` runs against a partially-constructed Mediator.

**Fix:** initialize all fields BEFORE creating Components / wiring callbacks.

```java
public final class FormDialog implements Mediator {
    private final SubmitButton submit;
    private final SomeField someField;

    public FormDialog() {
        someField = new SomeField();   // initialized first
        submit = new SubmitButton(this);   // safe: someField exists
    }
}
```

Or, separate "create" from "start" / "wire":

```java
public FormDialog() { /* fields */ }
public void wire() { submit.attachTo(this); }
```

**Lesson:** Don't leak `this` from constructors. Component subscriptions / callbacks must happen after full construction.

</details>

---

## Bug 9: Mediator's notify swallows exceptions

```java
public void notify(Component sender, String event) {
    try {
        // routing logic that may throw
        validateAndDispatch(sender, event);
    } catch (Exception e) {
        // silently ignored
    }
}
```

Bugs go unnoticed. Logs show nothing.

<details><summary>Reveal</summary>

**Bug:** Catch-all empty. Exceptions disappear. Components and the surrounding system never know something went wrong.

**Fix:** at minimum, log. Better, surface or rethrow appropriately.

```java
try {
    validateAndDispatch(sender, event);
} catch (Exception e) {
    log.error("mediator notify failed; sender={}, event={}", sender, event, e);
    throw e;   // or convert to a known exception type
}
```

**Lesson:** Empty catch blocks hide bugs. Mediator is a critical path — failures must be observable.

</details>

---

## Bug 10: Workflow non-determinism

```python
@workflow.defn
class OrderWorkflow:
    @workflow.run
    async def run(self, order_id):
        timestamp = datetime.now()   # BUG: non-deterministic
        await workflow.execute_activity(charge, order_id, timestamp)
```

In Temporal, workflow replay produces a different timestamp; activity result mismatch.

<details><summary>Reveal</summary>

**Bug:** `datetime.now()` is non-deterministic. Replay sees a different time. Workflow engine detects mismatch and fails.

**Fix:** use Temporal's `workflow.now()` (deterministic — recorded in history).

```python
timestamp = workflow.now()
```

Or pass the timestamp as input.

**Lesson:** Workflows must be deterministic. Random, time, network — all become activities, with results recorded for replay.

</details>

---

## Bug 11: State scattered across Mediator and Components

```java
class FormDialog {
    private boolean isValid;   // also stored in components
}

class TextField {
    private boolean valid;   // duplicate state
    public void onChange() {
        valid = !value.isEmpty();
        mediator.notify(this, "changed");
    }
}
```

Inconsistencies: dialog's `isValid` says false, but field's `valid` says true.

<details><summary>Reveal</summary>

**Bug:** State of validity duplicated. They drift.

**Fix:** single source of truth. Either:
- Mediator computes validity from Component values when needed.
- Component owns validity; Mediator queries.

```java
class FormDialog {
    public boolean isValid() {
        return !username.value().isEmpty() && !password.value().isEmpty();
    }
}
```

No `isValid` field; computed from Components.

**Lesson:** Decide upfront where state lives. Don't duplicate.

</details>

---

## Bug 12: Distributed Mediator double-spends on retry

```python
class Orchestrator:
    async def place(self, order):
        await self.payment.charge(order)   # no idempotency key
        await self.inventory.reserve(order)
        await self.shipping.dispatch(order)
```

Network glitch causes orchestrator retry; customer charged twice.

<details><summary>Reveal</summary>

**Bug:** No idempotency. Retries duplicate charges, reservations, shipments.

**Fix:** every Component call gets an idempotency key.

```python
async def place(self, order):
    key_prefix = f"order:{order.id}"
    await self.payment.charge(order, idempotency_key=f"{key_prefix}:charge")
    await self.inventory.reserve(order, idempotency_key=f"{key_prefix}:reserve")
    await self.shipping.dispatch(order, idempotency_key=f"{key_prefix}:ship")
```

Components dedup based on the key.

**Lesson:** Distributed Mediators must assume at-least-once delivery. Every Component call must be idempotent.

</details>

---

## Practice Tips

- **Cycles in Mediators are common.** Detect with thread-local flags or design out two-way bindings.
- **Components shouldn't reach through Mediator.** Mediator exposes actions, not Components.
- **Magic strings rot.** Use typed events.
- **Long-lived Mediators leak.** Add unregister or use weak refs.
- **Compensations: reverse order, idempotent.** Always.
- **Synchronized Mediators don't scale.** Async dispatch + per-handler error isolation.
- **`this` leak from constructor is silent and devastating.** Wire after full init.
- **Empty catch blocks hide bugs.** At minimum, log.
- **Workflows must be deterministic.** Outsource non-determinism to activities.
- **Single source of truth for state.** Mediator OR Component, not both.
- **Distributed Mediators retry.** Idempotency keys everywhere.

[← Tasks](tasks.md) · [Optimize →](optimize.md)
