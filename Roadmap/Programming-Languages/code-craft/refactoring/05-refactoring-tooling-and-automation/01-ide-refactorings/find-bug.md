# IDE & Automated Refactorings — Find the Bug

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

Each scenario: an "automated" refactoring ran, the IDE reported success, and behavior silently changed or a reference was missed. Find the bug, explain why the tool's guarantee didn't cover it, and fix it. The pattern to internalize: *the green checkmark proves the resolvable references were handled — not that behavior was preserved.*

---

## Scenario 1 — The rename the compiler couldn't catch

```java
// BEFORE
class PaymentProcessor {
    public void processCharge(Money m) { ... }
}
// elsewhere, a job runner:
Method handler = clazz.getMethod("processCharge", Money.class);
handler.invoke(processor, amount);
```

A developer ran **Rename** `processCharge` → `charge`. Build is green, unit tests pass. In staging, the nightly job throws `NoSuchMethodException`.

<details><summary>Diagnosis & fix</summary>

**Bug:** the method is invoked reflectively via the string `"processCharge"`. Rename rewrote every *resolved* reference but the string is invisible to the binding, so it stayed `"processCharge"` while the method became `charge`.

**Why the tool didn't catch it:** reflection lookup happens at runtime; there is no static reference to update or flag. Unit tests called `charge` directly and passed; nothing exercised the reflective path.

**Fix:** update the string to `"charge"`, *and* add an integration test that drives the job runner so this class of breakage fails in CI. Better long-term fix: replace the reflective dispatch with a typed interface (`Handler.charge(...)`) so the call becomes a resolvable reference Rename can track.
</details>

---

## Scenario 2 — Change Signature picked a different overload

```java
// BEFORE
void log(String msg)            { writer.write(msg); }
void log(String msg, int level) { writer.write("[" + level + "] " + msg); }

// call site:
log("disk full");
```

A developer used **Change Signature** to add an `int level` parameter to the *first* `log`, with default `0`. Build green. Now `log("disk full")` prints `[0] disk full` in some places and the *un-leveled* line in others, inconsistently.

<details><summary>Diagnosis & fix</summary>

**Bug:** after adding `int level` to the first overload, `log(String, int)` now exists twice — the two overloads collide, or the call `log("disk full")` (which the tool turned into `log("disk full", 0)`) now resolves to whichever overload the compiler prefers, which may differ from intent. Overload resolution shifted under the refactoring.

**Why the tool didn't catch it:** Change Signature updates call sites mechanically; it doesn't reason about whether the *new* signature collides with or out-prioritizes an existing overload at every call site. It compiled, so no error surfaced.

**Fix:** don't overload by adding a parameter that duplicates an existing overload — give the new method a distinct name (`logWithLevel`) or unify the two into one method with an explicit level. Verify with tests that assert the *output format* at each call site, not just that it compiles.
</details>

---

## Scenario 3 — Inline doubled a side effect

```java
// BEFORE
int id = nextSequence();   // increments a counter, returns new value
record(id);
audit(id);
```

A developer ran **Inline Variable** on `id`. Build green, the unit test (which stubbed `nextSequence` to return a constant) passes. In production, audit records reference a *different* id than the data records.

<details><summary>Diagnosis & fix</summary>

```java
// AFTER inline — bug
record(nextSequence());
audit(nextSequence());     // <-- second call increments again -> different id!
```

**Bug:** `nextSequence()` has a side effect (advances a counter). Inlining a multiply-used variable turned one invocation into two, so `record` and `audit` now see different ids.

**Why the tool didn't catch it:** the IDE can't prove `nextSequence()` is pure. Some engines warn for "expression has side effects"; if the warning was ignored (or absent), the inline went through. The unit test stubbed the method to a constant, masking the double-call.

**Fix:** revert the inline — the variable was load-bearing precisely because it captured a single side-effecting call. Keep `int id = nextSequence();`. Add a test where `nextSequence` returns *incrementing* values and assert `record` and `audit` got the *same* id.
</details>

---

## Scenario 4 — The "zero usages" deletion

```java
public class FeatureFlags {
    public boolean betaCheckout() { return get("beta_checkout"); }   // Find-Usages: 0
}
```

Find-Usages reported **0 usages** of `betaCheckout()`, so it was deleted. The next release silently disabled beta checkout for everyone.

<details><summary>Diagnosis & fix</summary>

**Bug:** `betaCheckout` was invoked from a **template / config / another language** the analyzer didn't index — e.g. a Thymeleaf/JSX template `${flags.betaCheckout()}` or a scripting layer — so Find-Usages (which shares Rename's binding) reported zero *resolvable* usages.

**Why the tool didn't catch it:** "0 usages" means "0 usages I can resolve," not "0 usages." Cross-language and string-built calls are outside the binding.

**Fix:** restore the method. Before deleting any framework/template-exposed member, grep the whole repo (including templates, config, JS) for the name as a string, and run the integration/UI suite. Treat "0 usages" on a publicly-exposed method as a hypothesis, not a fact.
</details>

---

## Scenario 5 — Encapsulate Field broke the wire format

```java
// BEFORE — serialized to JSON by a field-access mapper
public class Dto {
    public String userId;
}
// consumer expects: {"userId": "..."}
```

A developer ran **Encapsulate Field** on `userId` (now private, with `getUserId`/`setUserId`). Build green, the round-trip unit test passes. A downstream consumer starts receiving `{"userID": ...}` — or the field vanishes.

<details><summary>Diagnosis & fix</summary>

**Bug:** the serializer was configured for **field access** (or a default that now resolves differently). Making the field private and adding accessors changed which member the mapper picks up and/or the derived property name (getter `getUserId` → property `userID` under some naming strategies). The wire contract changed.

**Why the tool didn't catch it:** the serialization mapping is a framework concern keyed on reflection/conventions, invisible to the refactoring. The unit test round-tripped within the same config, so it stayed self-consistent and missed the *external* contract change.

**Fix:** pin the wire name explicitly — `@JsonProperty("userId")` — so it's independent of the field/accessor shape, *then* encapsulate freely. Add a golden/contract test asserting the exact JSON, so any future change to the wire format fails loudly.
</details>

---

## Scenario 6 — Rename leaked across a duck-typed boundary (Python)

```python
class Invoice:
    def settle(self): ...

class Subscription:
    def settle(self): ...     # unrelated, same name

def close(item):
    item.settle()             # item could be either
```

In PyCharm a developer renamed `Invoice.settle` → `finalize`. The tool also renamed `Subscription.settle` → `finalize` and the `item.settle()` call. Now `Subscription` callers elsewhere break, and an `Invoice`-only test still passes.

<details><summary>Diagnosis & fix</summary>

**Bug:** Python can't prove `item` is an `Invoice`, so the engine's heuristic swept in the same-named `Subscription.settle` and the ambiguous `item.settle()`. The rename over-reached across an unrelated class.

**Why the tool didn't catch it:** no static type binds `item`. The engine guessed by name and included references it shouldn't have — a false positive inherent to dynamic-language rename.

**Fix:** in the rename preview, *deselect* the `Subscription` occurrences (the preview is your only defense here). Restore `Subscription.settle`. To prevent recurrence, add type hints (`def close(item: Invoice)`) so the binding becomes provable, and run the full suite after any dynamic-language rename. See [middle.md](middle.md) §3.
</details>

---

## Scenario 7 — Move Class stranded a Spring bean

```java
// Moved com.app.PaymentService -> com.app.billing.PaymentService via Move Class
// applicationContext.xml:
//   <bean id="paymentService" class="com.app.PaymentService"/>
```

**Move Class** updated all Java imports; build green; unit tests pass. The app fails to start: `ClassNotFoundException: com.app.PaymentService`.

<details><summary>Diagnosis & fix</summary>

**Bug:** the fully-qualified class name is hard-coded as a *string* in the Spring XML. Move Class updated Java references (imports, FQ names in code) but the XML string is outside the Java binding, so it still points at the old package.

**Why the tool didn't catch it:** XML config is a cross-language boundary. (IntelliJ with the Spring plugin *can* sometimes track and update bean class references — but only if the facet is configured; a plain Move won't.) Unit tests don't boot the context, so they missed it.

**Fix:** update the `class="..."` attribute to the new FQN. Add a context-loading smoke test in CI so DI wiring is exercised. Prefer annotation/component-scan wiring over hard-coded FQNs so the binding is package-relative and survives moves. See [professional.md](professional.md) §3.
</details>
