# Premature Abstraction at Scale — Find the Bug

> **Category:** [Anti-Patterns at Scale](../README.md) → **Premature Abstraction at Scale**
> **Covers (collectively):** Speculative Generality · Wrapper-itis & needless indirection · Premature decoupling & one-implementation interfaces · The Wrong Abstraction · AHA / Rule of Three / YAGNI as the cure

This file is **critical-reading practice**. Each snippet is a plausible chunk of real-world code in Go, Java, or Python where someone removed duplication — or built flexibility — and the abstraction now costs **more than the duplication it replaced**. Read each the way a sharp reviewer does and answer three questions:

> **What over-abstraction is present? What does it cost — or what bug does it cause? What is the simpler form?**

Unlike the in-the-file [Over-Engineering → Find the Bug](../../01-development/03-over-engineering/find-bug.md), these snippets carry an **at-scale** sting: the abstraction has many call sites, so the cost is multiplied and the fix is a *migration*, not a one-line delete. Several snippets also hide a genuine functional bug — a wrong abstraction's flag fork mishandles a case, a config-driven "framework" silently does the wrong thing, a reflection-based generic crashes on a type it was never told about. **The clever version is often the buggy version**, precisely because nobody can read it.

One snippet is a deliberate **trap**: code that *looks* over-abstracted but whose abstraction genuinely earns its keep. Reflexively deleting abstraction is its own anti-pattern. The skill is judgment.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. Train the eye to see the shape — and to resist the easy "delete it all" reflex.

---

## Table of Contents

1. [The factory provider for one product](#snippet-1--the-factory-provider-for-one-product)
2. [The "DRY" merge that now needs a flag](#snippet-2--the-dry-merge-that-now-needs-a-flag)
3. [The one-impl interface and its DI wiring](#snippet-3--the-one-impl-interface-and-its-di-wiring)
4. [The config-driven engine that reimplements `if`](#snippet-4--the-config-driven-engine-that-reimplements-if)
5. [The plugin system for one plugin](#snippet-5--the-plugin-system-for-one-plugin)
6. [The generic reflection dispatcher](#snippet-6--the-generic-reflection-dispatcher)
7. [The repository wrapper around the ORM](#snippet-7--the-repository-wrapper-around-the-orm)

---

## Snippet 1 — The factory provider for one product

```java
// Java — "extensible object creation" for a single concrete product.
public interface ConnectionFactory {
    Connection create(Config cfg);
}

public abstract class AbstractConnectionFactoryProvider {
    public abstract ConnectionFactory getFactory(String type);
}

public class DefaultConnectionFactoryProvider extends AbstractConnectionFactoryProvider {
    @Override
    public ConnectionFactory getFactory(String type) {
        if ("postgres".equals(type)) {
            return cfg -> DriverManager.getConnection(cfg.url(), cfg.user(), cfg.pass());
        }
        throw new IllegalArgumentException("unknown type: " + type);
    }
}

// The entire codebase only ever does:
//   var provider = new DefaultConnectionFactoryProvider();
//   var factory  = provider.getFactory("postgres");
//   var conn     = factory.create(cfg);
```

> What over-abstraction is here? What's the cost? What's the simpler form?

<details><summary>Answer</summary>

**Speculative generality — a three-tier creation hierarchy (`AbstractProvider` → `Provider` → `Factory`) for exactly one product, Postgres.** The interface, the abstract base, the string-keyed dispatch, and the `IllegalArgumentException` branch all exist to support database types that were never added. The `"postgres"` string is matched against a single case; the `type` parameter is dead generality.

**The cost (multiplied at scale):** every caller writes three lines and two indirections to open a connection, every newcomer assumes multiple database backends exist and goes looking for them, and the string key invites a *runtime* failure (`getFactory("postgre")` — typo) where a direct call would be a compile error.

**Simpler form:**

```java
public final class Database {
    public static Connection open(Config cfg) throws SQLException {
        return DriverManager.getConnection(cfg.url(), cfg.user(), cfg.pass());
    }
}
// Caller: Connection conn = Database.open(cfg);
```

One static method, compile-time-checked, no strings, no hierarchy. If a *real* second backend ever lands, introduce a `ConnectionFactory` interface *then* — with two genuine implementations to shape it. The GoF names (`Provider`, `Factory`) are appropriate when you have the GoF *problem* (a family of products chosen at runtime); here there's one product chosen at compile time.
</details>

---

## Snippet 2 — The "DRY" merge that now needs a flag

```python
# Python — two report builders were merged to "remove duplication".
# Since then, callers pass flags to fork the behavior back apart.

def build_report(data, *, for_export=False, include_pii=False, legacy_header=False):
    header = "id,name,total" if not legacy_header else "ID|NAME|TOTAL"
    sep = "|" if legacy_header else ","
    lines = [header]
    for row in data:
        name = row.name if include_pii else mask(row.name)
        total = f"{row.total:.2f}"
        if for_export:
            # export wants raw cents, not formatted dollars
            total = str(row.total_cents)
        lines.append(sep.join([str(row.id), name, total]))
    return "\n".join(lines)

# Call sites:
#   build_report(data)                                  # screen view
#   build_report(data, for_export=True, include_pii=True)  # CSV download
#   build_report(data, legacy_header=True)              # the old integration
```

> What over-abstraction is here? What bug is lurking? What's the simpler form?

<details><summary>Answer</summary>

**The wrong abstraction.** Three genuinely different outputs — an on-screen view (masked PII, dollar formatting), a CSV export (raw PII, raw cents), and a legacy pipe-delimited feed — were merged into one function that now forks on three booleans. No caller exercises more than its own path; the flags exist only to undo the merge at runtime.

**The lurking bug:** the cases have already diverged in a way the merge can't keep straight. The export path sets `total = str(row.total_cents)` *after* the `total = f"{row.total:.2f}"` line — fine here — but the masking and formatting decisions are entangled: a future "export without PII" requirement (`for_export=True, include_pii=False`) is *expressible* yet was never intended or tested, and it silently produces a masked export. Every new flag multiplies the untested combinations. The shared function lets callers request combinations nobody designed.

**Simpler form — inline back to three honest functions:**

```python
def screen_report(data):
    lines = ["id,name,total"]
    for row in data:
        lines.append(f"{row.id},{mask(row.name)},{row.total:.2f}")
    return "\n".join(lines)

def export_csv(data):
    lines = ["id,name,total"]
    for row in data:
        lines.append(f"{row.id},{row.name},{row.total_cents}")
    return "\n".join(lines)

def legacy_feed(data):
    lines = ["ID|NAME|TOTAL"]
    for row in data:
        lines.append(f"{row.id}|{mask(row.name)}|{row.total:.2f}")
    return "\n".join(lines)
```

Each reads straight through, no flags, no impossible-combination surface. The duplicated loop skeleton is *coincidental* and fine to repeat. This is Metz's "duplication is cheaper than the wrong abstraction" made concrete: three readable functions beat one four-dimensional fork.
</details>

---

## Snippet 3 — The one-impl interface and its DI wiring

```go
// Go — a "decoupled" pricing service. One implementation; DI by hand.
type PriceCalculator interface {
    Calculate(order Order) Money
}

type defaultPriceCalculator struct {
    taxRate float64
}

func (c defaultPriceCalculator) Calculate(order Order) Money {
    sub := Money(0)
    for _, line := range order.Lines {
        sub += line.UnitPrice * Money(line.Qty)
    }
    return sub + Money(float64(sub)*c.taxRate)
}

// Wiring, repeated in main() and in every test:
func NewPriceCalculator() PriceCalculator {
    return defaultPriceCalculator{taxRate: 0.08}
}

// Callers take the interface "for testability":
type Checkout struct{ calc PriceCalculator }
```

> What over-abstraction is here? What does it cost? What's the simpler form?

<details><summary>Answer</summary>

**A one-implementation interface plus hand-rolled DI, justified by "testability" that doesn't need it.** `PriceCalculator` has exactly one implementor, `defaultPriceCalculator`, which is *pure* — no I/O, no clock, no network. There is nothing to fake: you test it by calling it with an `Order` and asserting the returned `Money`. The interface, the constructor, and the `calc PriceCalculator` field are all indirection over a pure function.

**The cost at scale:** every `Checkout`-like consumer carries a `PriceCalculator` field, every test constructs one through `NewPriceCalculator()`, jump-to-definition on `calc.Calculate` lands on the interface (a second hop to the real code), and newcomers hunt for the other implementations that the interface implies but that don't exist. Multiply across every consumer.

**Simpler form — it's a pure function:**

```go
func CalculatePrice(order Order, taxRate float64) Money {
    sub := Money(0)
    for _, line := range order.Lines {
        sub += line.UnitPrice * Money(line.Qty)
    }
    return sub + Money(float64(sub)*taxRate)
}
// Test: assert CalculatePrice(order, 0.08) == expected. No mock, no wiring.
```

**The discriminating rule:** an interface earns its keep at a *boundary you must substitute* — DB, HTTP, clock, queue (and then the fake is a real second implementation). Pure domain logic is not a boundary; "for testability" is a misdiagnosis, because pure functions are the *easiest* thing to test directly. If a real second pricing strategy appears, introduce the interface then, at the consumer, with two genuine implementations.
</details>

---

## Snippet 4 — The config-driven engine that reimplements `if`

```python
# Python — "business users can change discount rules without a deploy."
# (They can't: this config lives in the repo and ships with the code.)

DISCOUNT_RULES = [
    {"when": {"field": "total", "op": "gte", "value": 100}, "apply": {"pct": 10}},
    {"when": {"field": "tier",  "op": "eq",  "value": "gold"}, "apply": {"pct": 15}},
    {"when": {"field": "first_order", "op": "eq", "value": True}, "apply": {"pct": 5}},
]

OPS = {"gte": lambda a, b: a >= b, "eq": lambda a, b: a == b}

def discount_pct(order, rules):
    for rule in rules:
        w = rule["when"]
        field_val = getattr(order, w["field"])
        if OPS[w["op"]](field_val, w["value"]):
            return rule["apply"]["pct"]
    return 0
```

> What over-abstraction is here? What bug does it hide? What's the simpler form?

<details><summary>Answer</summary>

**Soft coding — a homemade rule interpreter (fields, operators, an evaluation loop) that reimplements `if`/`elif` with none of its safety.** The "config" is edited by the same engineers, in the same repo, behind the same deploy as code, so it buys *zero* real flexibility — only a stringly-typed DSL with no type checking, no IDE navigation, no static verification that `w["field"]` exists on `order`, and an `OPS` table that a typo (`"gt"`) turns into a `KeyError` at runtime.

**The hidden bug:** `getattr(order, w["field"])` blows up with `AttributeError` the moment a rule references a field the order doesn't have — and because rules are "just data," nothing catches it until that rule fires in production for some order. A real `if order.total >= 100` is a compile/lint-time reference; the soft-coded version defers the error to runtime, for an order that happens to reach that rule. The interpreter also silently changes behavior if two rules overlap, with precedence buried in list order rather than visible control flow.

**Simpler form — it's three ifs:**

```python
def discount_pct(order):
    if order.total >= 100:
        return 10
    if order.tier == "gold":
        return 15
    if order.first_order:
        return 5
    return 0
```

Type-checked, navigable, debuggable, and the precedence is *visible*. Soft coding earns its keep only when **non-engineers genuinely change rules at runtime without a deploy** (a real rules engine, feature flags, an admin UI writing to a database). Absent that, plain code wins on every axis.
</details>

---

## Snippet 5 — The plugin system for one plugin

```java
// Java — a "pluggable validation framework" with one validator.
public interface ValidationPlugin {
    boolean supports(Class<?> type);
    List<String> validate(Object target);
}

public class ValidationEngine {
    private final List<ValidationPlugin> plugins;

    public ValidationEngine(List<ValidationPlugin> plugins) {
        this.plugins = plugins;
    }

    public List<String> validate(Object target) {
        List<String> errors = new ArrayList<>();
        for (ValidationPlugin p : plugins) {
            if (p.supports(target.getClass())) {
                errors.addAll(p.validate(target));
            }
        }
        return errors;
    }
}

// The only plugin ever registered:
public class UserValidationPlugin implements ValidationPlugin {
    public boolean supports(Class<?> type) { return type == User.class; }
    public List<String> validate(Object target) {
        User u = (User) target;             // unchecked cast
        List<String> errs = new ArrayList<>();
        if (u.getEmail() == null) errs.add("email required");
        if (u.getAge() < 0)       errs.add("age must be non-negative");
        return errs;
    }
}
```

> What over-abstraction is here? What bug does it invite? What's the simpler form?

<details><summary>Answer</summary>

**Speculative generality — a `supports`/`validate` plugin protocol, an engine that loops over a registry, and `Object`-typed targets — to validate one type, `User`.** The whole framework exists to dispatch over a list with one entry. The generality has never been exercised and forces an unchecked downcast (`(User) target`) because the engine traffics in `Object` to stay "pluggable."

**The bug it invites:** the `Object` API throws type safety out the window. `engine.validate(someOrder)` compiles fine, finds no supporting plugin, and returns *zero errors* — silently treating an unvalidatable object as valid. And `UserValidationPlugin.supports` checks `type == User.class` exactly, so a `PremiumUser extends User` is silently *not* validated. A direct, typed method makes both of these compile errors or correct by construction.

**Simpler form — a typed method:**

```java
public final class UserValidator {
    public static List<String> validate(User u) {
        List<String> errs = new ArrayList<>();
        if (u.getEmail() == null) errs.add("email required");
        if (u.getAge() < 0)       errs.add("age must be non-negative");
        return errs;
    }
}
// Caller: List<String> errs = UserValidator.validate(user);   // typed, no cast
```

Compile-time-checked argument, no cast, no silent no-op. A plugin/registry design earns its keep when **third parties register validators you don't ship**, or when validators are genuinely discovered at runtime across many types you can't enumerate. For one in-house type, it's a framework built around a single `if`-free method.
</details>

---

## Snippet 6 — The generic reflection dispatcher

```go
// Go — a "generic event dispatcher" using reflection so it never needs
// to know concrete handler types. Sits on a hot path (every inbound event).
type Dispatcher struct {
    handlers map[string]any // event name -> some func value
}

func (d *Dispatcher) Register(event string, handler any) {
    d.handlers[event] = handler
}

func (d *Dispatcher) Dispatch(event string, payload any) error {
    h, ok := d.handlers[event]
    if !ok {
        return fmt.Errorf("no handler for %q", event)
    }
    fn := reflect.ValueOf(h)
    in := []reflect.Value{reflect.ValueOf(payload)}
    out := fn.Call(in) // panics if payload type != handler's param type
    if len(out) > 0 && !out[0].IsNil() {
        return out[0].Interface().(error)
    }
    return nil
}

// In practice there are three handlers, all func(Event) error,
// registered at startup and never changed.
```

> What over-abstraction is here? What bug does it cause? What's the simpler form?

<details><summary>Answer</summary>

**Speculative generality via reflection — `any` handlers and `reflect.Call` "so the dispatcher never needs to know handler types" — when all three real handlers share one static signature, `func(Event) error`.** The reflection buys flexibility nobody uses, on a hot path, at the cost of type safety and speed.

**The bug it causes:** `fn.Call(in)` **panics at runtime** if `payload`'s dynamic type doesn't match the handler's parameter type — a class of error the compiler would have caught entirely with a typed signature. `Register("x", "not a function")` also compiles fine and panics only when `x` is dispatched. The generality converts compile-time guarantees into runtime landmines.

**The cost on the hot path:** `reflect.ValueOf` and `reflect.Value.Call` allocate (boxing each argument into an `interface{}`/`reflect.Value`) and are an order of magnitude slower than a direct call, and they defeat inlining and escape analysis. On an every-inbound-event path this is measurable (see [`optimize.md`](optimize.md) for the benchmark).

**Simpler form — a typed map of typed funcs:**

```go
type Handler func(Event) error

type Dispatcher struct {
    handlers map[string]Handler
}

func (d *Dispatcher) Register(event string, h Handler) { d.handlers[event] = h }

func (d *Dispatcher) Dispatch(event string, e Event) error {
    h, ok := d.handlers[event]
    if !ok {
        return fmt.Errorf("no handler for %q", event)
    }
    return h(e) // direct call: typed, fast, inlinable, no panic surface
}
```

Now `Register` rejects non-handlers at compile time, `Dispatch` can't panic on a type mismatch, and the call is direct. Reflection earns its keep when handler signatures are *genuinely* heterogeneous and unknown at compile time (a generic serialization or RPC library). Three handlers of one signature is not that case.
</details>

---

## Snippet 7 — The repository wrapper around the ORM

```python
# Python — is THIS one premature? Read carefully before deleting.
class UserRepository:
    def __init__(self, session):
        self._session = session

    def get(self, user_id):
        return self._session.query(UserModel).get(user_id)

    def by_email(self, email):
        return self._session.query(UserModel).filter_by(email=email).one_or_none()

    def active_since(self, dt):
        return (self._session.query(UserModel)
                .filter(UserModel.last_seen >= dt)
                .filter(UserModel.status == "active")
                .all())

    def save(self, user):
        self._session.add(user)
        self._session.flush()
```

> Is this premature abstraction, or does it earn its keep?

<details><summary>Answer (the trap)</summary>

**It earns its keep — do not delete it.** This is the deliberate trap: it *looks* like a wrapper around the ORM (wrapper-itis), but it isn't a pass-through and it isn't speculative. Check it against "does the abstraction pay for itself":

- **It's not empty forwarding.** `active_since` encodes a real, reused query (the definition of "an active user seen since a date" — a domain concept), and `by_email` names a meaningful lookup. These methods *transform and name* queries; they aren't `return session.query(...)` echoes.
- **It hides something worth hiding.** The ORM query language (`filter_by`, `.one_or_none()`, the `status == "active"` business rule) is concentrated in one place. Callers say `repo.active_since(dt)` instead of copy-pasting the two-filter query — which is exactly the kind of *same-knowledge* duplication DRY is for. If "active" gains a third condition, one method changes.
- **It's a real test seam.** A fake repository lets domain/service tests run without a database — a genuine second implementation, not a hypothetical.

A naive reviewer pattern-matches "class wrapping the ORM → delete the layer," but that reflex is its own anti-pattern. The discriminator: a wrapper that only *forwards* is dead weight (kill it); a repository that *names domain queries, centralizes a business rule, and provides a substitutable seam* is a justified abstraction (keep it). The skill is telling these apart — not an allergy to layers.

> The one caveat: if a "repository" ever degrades into pure pass-throughs (`get`/`save` that just echo `session` with no added query logic), *that* portion has become wrapper-itis and the calling code can use the session directly. Judge per method, not per class.
</details>

---

## Summary

- Each snippet removed duplication or added flexibility and ended up costing **more than the duplication it replaced** — and at scale that cost is multiplied across call sites and the fix is a migration.
- **The clever/abstract version is often the buggy version:** the wrong-abstraction fork (2) lets callers request untested combinations; the soft-coded engine (4) defers a real error to runtime; the plugin engine (5) silently passes unvalidatable objects; the reflection dispatcher (6) turns a compile error into a hot-path panic.
- **The simpler form is usually concrete:** a static method (1, 3), three honest functions (2), plain `if`s (4), a typed method (5), a typed func map (6). Concrete code is type-checked, navigable, and faster.
- **Snippet 7 is the trap** — a repository that names domain queries, centralizes a business rule, and offers a real test seam *earns its keep*. Reflexive deletion of abstraction is itself an anti-pattern; judge per method, against "would inlining make it clearer or muddier?"

---

## Related Topics

- [Over-Engineering → Find the Bug](../../01-development/03-over-engineering/find-bug.md) — the in-the-file version of these snippets.
- [Premature Abstraction → Optimize This](optimize.md) — measuring the cost of the reflection dispatcher (Snippet 6) and inlining it.
- [Premature Abstraction → Tasks](tasks.md) — guided drills for inlining wrong abstractions and one-impl interfaces.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/junior.md) — applying these fixes across hundreds of call sites mechanically.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — deciding which over-abstraction is worth fixing first.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings.
- Level files: [`senior.md`](senior.md) — the cost model and unwinding playbook behind these diagnoses.
