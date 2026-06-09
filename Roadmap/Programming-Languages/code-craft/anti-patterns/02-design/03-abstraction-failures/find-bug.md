# Abstraction Failures Anti-Patterns — Find the Bug

> **Category:** [Design Anti-Patterns](../README.md) → **Abstraction Failures** — *the chosen abstraction fights the problem instead of fitting it.*
> **Covers (collectively):** Golden Hammer · Inner-Platform Effect · Interface Bloat · Premature Abstraction

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world code in Go, Java, or Python. Read it the way a good reviewer does and answer three questions:

> **What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?**

Abstraction failures are subtle. The code usually *compiles*, *passes the happy-path test*, and often *looks sophisticated* — a configurable rule engine, a clean strategy interface, an elegant recursive solution. The damage shows up later: a malformed rule silently evaluates wrong, a clever regex mishandles one edge case, a "not-yet-supported" interface method gets hit in production, a guessed extension point lets a caller reach an invalid state. Several snippets here contain a **real functional bug** caused directly by the wrong abstraction. One snippet is a **deliberate trap**: it looks over-abstracted but is genuinely justified — learn to tell the difference.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is noticing when an abstraction has stopped serving the problem — not recalling a name.

---

## Table of Contents

1. [The rule engine that evaluates a malformed rule](#snippet-1--the-rule-engine-that-evaluates-a-malformed-rule)
2. [Everything is a graph traversal](#snippet-2--everything-is-a-graph-traversal)
3. [The repository that cannot stream](#snippet-3--the-repository-that-cannot-stream)
4. [One strategy, invented for the first case](#snippet-4--one-strategy-invented-for-the-first-case)
5. [The email validator regex](#snippet-5--the-email-validator-regex)
6. [The config-driven workflow interpreter](#snippet-6--the-config-driven-workflow-interpreter)
7. [The collection that is read-only sometimes](#snippet-7--the-collection-that-is-read-only-sometimes)
8. [The recursive directory sizer](#snippet-8--the-recursive-directory-sizer)
9. [The pluggable notifier with one knob](#snippet-9--the-pluggable-notifier-with-one-knob)
10. [The clock interface](#snippet-10--the-clock-interface)
11. [The in-database expression language](#snippet-11--the-in-database-expression-language)
12. [The shape hierarchy that guessed wrong](#snippet-12--the-shape-hierarchy-that-guessed-wrong)
13. [The JSON store built on a relational table](#snippet-13--the-json-store-built-on-a-relational-table)
14. [The animal interface every implementer dreads](#snippet-14--the-animal-interface-every-implementer-dreads)

---

## Snippet 1 — The rule engine that evaluates a malformed rule

```python
# Python — a home-grown rule engine for eligibility checks, grown over two years
def evaluate(rule, ctx):
    op = rule["op"]
    if op == "and":
        return all(evaluate(r, ctx) for r in rule["rules"])
    elif op == "or":
        return any(evaluate(r, ctx) for r in rule["rules"])
    elif op == "eq":
        return ctx.get(rule["field"]) == rule["value"]
    elif op == "gt":
        return ctx.get(rule["field"]) > rule["value"]
    elif op == "in":
        return ctx.get(rule["field"]) in rule["value"]
    # unknown op falls through

# rules are authored in a web UI and stored as JSON:
discount_rule = {"op": "and", "rules": [
    {"op": "gt", "field": "age", "value": 18},
    {"op": "eq", "field": "country", "valeu": "US"},   # typo by the rule author
]}

if evaluate(discount_rule, {"age": 25}):
    apply_discount()
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Inner-Platform Effect.** This is a custom, half-baked reimplementation of a boolean-expression interpreter — a worse, slower copy of the language's own `and`/`or`/comparison operators, plus a JSON dialect that business users author by hand in a web UI.

**The concrete bug — silent mis-evaluation of a malformed rule:**

1. The author misspelled `"value"` as `"valeu"`. There is **no schema validation**, so the malformed rule reaches `evaluate`.
2. In the `"eq"` branch, `rule["value"]` raises `KeyError` — *or*, in a slightly more defensive version using `rule.get("value")`, it would return `None`. Either way the rule is broken at runtime, far from where it was authored.
3. Worse, consider the `ctx`: `{"age": 25}` has **no `country` key**. `ctx.get("country")` returns `None`. The `"eq"` compares `None == <whatever>` and quietly returns `False` — a *missing field* is silently treated as *not matching*, with no signal that the rule could never have been satisfied.
4. The **unknown-op fall-through returns `None`** (falsy), so a typo in `"op"` (`"gt "` with a trailing space, `"greater"`) silently makes the rule evaluate to `False` — eligibility is silently denied and nobody is alerted.

Every one of these is invisible: the function returns a bool, `apply_discount()` simply doesn't fire, and there is no exception, log, or test catching the divergence between *what the author meant* and *what the engine did*.

**Why it's an Inner-Platform Effect, not just a bug:** the team is rebuilding parsing, type-checking, null-semantics, and operator dispatch — everything a real language gives you for free — and doing it worse. The fix is not "add a few more `elif`s"; it's to stop reimplementing the platform.

**Fix:** if rules truly must be data-driven, **validate against a schema at author time** (fail loud, before storage), use a maintained expression library (`json-logic`, CEL, a real DSL with a parser), and make missing-field and unknown-op cases *errors*, not silent `False`.

```python
def evaluate(rule, ctx):
    op = rule["op"]
    handler = OPS.get(op)
    if handler is None:
        raise ValueError(f"unknown op: {op!r}")           # fail loud
    return handler(rule, ctx)

def _eq(rule, ctx):
    if rule["field"] not in ctx:
        raise KeyError(f"missing field: {rule['field']}")  # not silent False
    return ctx[rule["field"]] == rule["value"]
# ...and validate every stored rule against a JSON Schema at save time.
```

The deeper fix: if you only have a handful of rules, **just write them in code** — a plain function `is_eligible(ctx)` is testable, type-checked, and impossible to misspell into silent failure.

</details>

---

## Snippet 2 — Everything is a graph traversal

```go
// Go — the author wrote a graph library last quarter and now reaches for it everywhere
// Requirement: given a list of tasks with "dependsOn" ids, return them in an order
// where dependencies come first. (A simple topological sort.)

func OrderTasks(tasks []Task) ([]Task, error) {
    g := graph.New()
    for _, t := range tasks {
        g.AddNode(t.ID)
    }
    for _, t := range tasks {
        for _, dep := range t.DependsOn {
            g.AddEdge(dep, t.ID)
        }
    }
    // graph.ShortestPath uses Dijkstra; the author picked it because it
    // "returns nodes in order" and it worked on their 3-task test case.
    path := g.ShortestPath(g.Roots()[0], g.Leaves()[0])
    out := make([]Task, 0, len(path))
    for _, id := range path {
        out = append(out, taskByID(tasks, id))
    }
    return out, nil
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Golden Hammer** — *with a real correctness bug that the wrong tool guarantees.*

The requirement is a **topological sort**. The author, fresh off building a graph library, reached for `ShortestPath` because it "returns nodes in order." Shortest path and topological order are *different problems*. The code passed the 3-task test case by luck.

**The concrete bug:** `ShortestPath` returns the nodes **on a single path** from one root to one leaf — it does **not** return *all* tasks. Any task not on that particular root-to-leaf path is **dropped from the output entirely**. With a realistic dependency graph (diamonds, multiple roots, parallel branches), `OrderTasks` silently returns a subset of the tasks, so downstream code runs an incomplete plan. Additional landmines:

- `g.Roots()[0]` and `g.Leaves()[0]` **panic** if there are zero roots/leaves — which happens precisely when there's a dependency **cycle** (the one error case topological sort is supposed to *detect and report*).
- Even on a valid DAG with one root and one leaf, intermediate tasks on *other* branches are lost.

A reviewer who sees "graph library → graph problem → looks right" misses it; the mismatch is between *which* graph algorithm fits.

**Fix:** use the algorithm the problem actually names — Kahn's topological sort — which visits *every* node and detects cycles explicitly.

```go
func OrderTasks(tasks []Task) ([]Task, error) {
    indeg := map[string]int{}
    children := map[string][]string{}
    for _, t := range tasks { indeg[t.ID] = 0 }
    for _, t := range tasks {
        for _, dep := range t.DependsOn {
            children[dep] = append(children[dep], t.ID)
            indeg[t.ID]++
        }
    }
    var queue, order []string
    for id, d := range indeg { if d == 0 { queue = append(queue, id) } }
    for len(queue) > 0 {
        n := queue[0]; queue = queue[1:]
        order = append(order, n)
        for _, c := range children[n] {
            indeg[c]--
            if indeg[c] == 0 { queue = append(queue, c) }
        }
    }
    if len(order) != len(tasks) {
        return nil, errors.New("dependency cycle detected")   // the real error case
    }
    return mapIDs(order, tasks), nil
}
```

The lesson: owning a shiny tool biases you toward problems it *looks* like it solves. Let the problem name the algorithm. See [Algorithms → Topological Sort](../../../../../Data/datastructures-and-algorithms/11-graphs/08-topological-sort/junior.md) for the algorithm this problem actually calls for.

</details>

---

## Snippet 3 — The repository that cannot stream

```java
// Java — a generic repository interface, "so every entity is consistent"
public interface Repository<T> {
    T findById(long id);
    List<T> findAll();              // <-- loads the entire table into memory
    List<T> findByExample(T probe);
    void save(T entity);
    void saveAll(List<T> entities);
    void delete(long id);
    void deleteAll();
    long count();
    boolean exists(long id);
    Page<T> findPage(int page, int size);
    Stream<T> stream();             // added later; only JdbcAuditRepository implements it
}

public class InMemoryConfigRepository implements Repository<Config> {
    private final Map<Long, Config> data = new HashMap<>();
    public List<Config> findAll() { return new ArrayList<>(data.values()); }
    public void save(Config c) { data.put(c.id(), c); }
    // ...
    public Stream<Config> stream() {
        throw new UnsupportedOperationException("not supported for in-memory");
    }
    public Page<Config> findPage(int page, int size) {
        throw new UnsupportedOperationException("paging not supported");
    }
    public List<Config> findByExample(Config probe) {
        throw new UnsupportedOperationException("query-by-example not supported");
    }
}

// In an export job that runs nightly:
void exportAll(Repository<Config> repo) {
    try (Stream<Config> s = repo.stream()) {   // <-- relies on stream()
        s.forEach(this::writeRow);
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Interface Bloat** (Interface Segregation violation) — *and the bloat causes a real runtime failure.*

`Repository<T>` declares **eleven** methods covering CRUD, query-by-example, paging, counting, and streaming. No realistic in-memory or simple-table implementation needs all of them, so `InMemoryConfigRepository` "implements" three of them by **throwing `UnsupportedOperationException`** — the textbook smell of an interface too wide for its implementers.

**The concrete bug:** the nightly `exportAll` job is written against `Repository<Config>` and calls `repo.stream()`. When wired to an `InMemoryConfigRepository` (e.g. in a smaller deployment, a test environment, or after a config source was migrated in-memory), it **throws `UnsupportedOperationException` at runtime** — at 2 a.m., in a cron job, where nobody is watching. The compiler gave no warning because the method exists on the interface; the contract *says* every repository can stream, but it's a lie. This is the danger of "implement by throwing": the type system reports a capability the object does not have.

**Fix — Interface Segregation: split into role interfaces** so each consumer depends only on what it truly needs, and implementers only declare what they truly support.

```java
interface Reader<T>   { T findById(long id); boolean exists(long id); }
interface Writer<T>   { void save(T e); void delete(long id); }
interface Listable<T> { List<T> findAll(); long count(); }
interface Streamable<T> { Stream<T> stream(); }   // implemented only where real

// The export job now states its true requirement in its parameter type:
void exportAll(Streamable<Config> source) {
    try (Stream<Config> s = source.stream()) { s.forEach(this::writeRow); }
}
```

Now `InMemoryConfigRepository` simply **doesn't implement `Streamable`**, so wiring it into `exportAll` is a **compile error**, not a 2 a.m. exception. The interface stops lying.

</details>

---

## Snippet 4 — One strategy, invented for the first case

```python
# Python — added the day the first payment method (card) shipped
from abc import ABC, abstractmethod

class PaymentStrategy(ABC):
    @abstractmethod
    def authorize(self, amount): ...
    @abstractmethod
    def capture(self, amount): ...
    @abstractmethod
    def refund(self, amount): ...
    @abstractmethod
    def supports_partial_capture(self): ...   # guessed extension point

class CardPayment(PaymentStrategy):
    def authorize(self, amount):
        self._auth_id = gateway.authorize(amount)
        return self._auth_id
    def capture(self, amount):
        return gateway.capture(self._auth_id, amount)   # uses auth from authorize()
    def refund(self, amount):
        return gateway.refund(self._auth_id, amount)
    def supports_partial_capture(self):
        return True

# six months later, the second method arrives: store credit (no gateway, instant)
class StoreCreditPayment(PaymentStrategy):
    def authorize(self, amount):
        pass                                  # nothing to authorize
    def capture(self, amount):
        ledger.debit(self.account, amount)    # never calls authorize; no _auth_id
    def refund(self, amount):
        ledger.credit(self.account, amount)
    def supports_partial_capture(self):
        return True

def charge(strategy, amount):
    strategy.authorize(amount)
    strategy.capture(amount)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Premature Abstraction** (the `PaymentStrategy` interface was extracted from a *single* concrete case) — *and the guessed shape lets a caller reach an invalid state.*

When `CardPayment` was the only payment method, someone "designed for extension" and lifted out a `PaymentStrategy` interface, complete with an `authorize → capture → refund` lifecycle and a guessed `supports_partial_capture()` knob. The shape was reverse-engineered from how *cards* happen to work — and cards have a two-phase authorize/capture flow with an `_auth_id` tying the phases together.

**Why the abstraction is wrong (the rule of three was ignored):** six months later, store credit arrives and **doesn't fit the guessed shape**:

- Store credit has **no authorization phase**. `authorize` is a no-op, so the `authorize → capture` lifecycle baked into the interface is meaningless for it.
- The interface implicitly assumes `capture` can rely on state set by `authorize` (`CardPayment` uses `self._auth_id`). `StoreCreditPayment.capture` works *only because* it ignores that contract. The abstraction's hidden invariant — "call `authorize` before `capture`" — is now optional for one implementation and mandatory for another. **A caller can't tell which.**
- `supports_partial_capture()` was a guessed extension point that turns out to mean nothing meaningfully different between the two implementations — pure speculative ceremony.

**The latent bug:** `charge` calls `authorize` then `capture`, which is correct for cards. But if someone later writes a code path that calls `capture` directly on a `PaymentStrategy` reference (reasonable, since store credit "doesn't need authorize"), a `CardPayment` will `capture` with an **unset `_auth_id`** and crash or double-charge — an invalid state the abstraction *invited* by pretending the two methods share a lifecycle they don't.

**Fix:** delete the speculative interface. With only two real cases now visible, let the *actual* commonality emerge (the rule of three). Often the right shape is narrower and explicit:

```python
class Payment(Protocol):
    def charge(self, amount) -> Receipt: ...   # one method: the real shared operation
    def refund(self, amount) -> Receipt: ...

class CardPayment:
    def charge(self, amount):
        auth = gateway.authorize(amount)        # lifecycle is CardPayment's private detail
        return gateway.capture(auth, amount)
    def refund(self, amount): ...

class StoreCreditPayment:
    def charge(self, amount):
        ledger.debit(self.account, amount)      # no fake authorize step
        return Receipt(...)
    def refund(self, amount): ...
```

The two-phase flow is now a **private implementation detail of cards**, not a contract every payment type must fake. Callers can't reach the unset-`_auth_id` state because there's no public `authorize`/`capture` split to misuse.

</details>

---

## Snippet 5 — The email validator regex

```python
# Python — the author's favorite tool is regex; reaches for it for every parse
import re

# "Validate an email and extract the domain for routing."
EMAIL_RE = re.compile(r"^(\w+)@(\w+)\.(\w+)$")

def route(email):
    m = EMAIL_RE.match(email)
    if not m:
        raise ValueError("invalid email")
    domain = m.group(2) + "." + m.group(3)
    return ROUTES.get(domain, ROUTES["default"])
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Golden Hammer** (regex applied to a parsing problem it's bad at) — *with multiple real functional bugs from edge cases the pattern mishandles.*

Regex is the author's hammer, so every string problem looks like a regex nail. Email is famously *not* a regex-friendly format (the real grammar, RFC 5322, is not regular in any practical hand-written form), and this naive pattern silently rejects or mis-parses huge classes of **valid** addresses:

- **`\w` excludes the dot, hyphen, and plus** that are legal in the local part and common in real life: `john.doe@x.com`, `jane+promo@x.com`, `o'neil@x.com` all **fail validation** and raise `ValueError` — real users are rejected at signup.
- **Subdomains break domain extraction.** `user@mail.google.com` doesn't match (`^...@(\w+)\.(\w+)$` allows exactly one dot), so it's rejected. Even if the pattern were loosened, `m.group(2) + "." + m.group(3)` would compute the domain wrong for any multi-label domain — `a@b.c.d` would route on `b.c`, **not** `b.c.d`, sending mail to the wrong route silently.
- **Hyphenated domains** (`user@my-company.com`) fail because `\w` excludes `-`.
- The pattern is also **anchored loosely enough to accept nonsense** in other variants while rejecting valid input — the worst of both.

The "extract the domain" requirement makes this concrete: the wrong tool doesn't just over-reject, it **routes valid mail to the wrong place** when it does match.

**Fix:** don't validate email with a hand-rolled regex. For *validation*, accept liberally and verify by sending a confirmation (the only real proof an address works), or use a maintained library. For the actual need here — **extract the domain** — split on the *last* `@`, which is all routing requires:

```python
def route(email):
    if email.count("@") == 0:
        raise ValueError("invalid email: no @")
    local, _, domain = email.rpartition("@")   # rpartition handles the real cases
    if not local or not domain:
        raise ValueError("invalid email")
    return ROUTES.get(domain.lower(), ROUTES["default"])
```

`rpartition("@")` correctly handles subdomains, hyphens, plus-addressing, and dotted local parts — because it isn't trying to re-derive the email grammar from scratch. The Golden-Hammer tell: reaching for regex *before* asking "what does this format's spec actually say?"

</details>

---

## Snippet 6 — The config-driven workflow interpreter

```yaml
# A "workflow engine" configured entirely in YAML, parsed by an in-house interpreter.
# Business analysts edit this file directly; engineers maintain the interpreter.
workflow:
  - step: fetch_order
    assign: order
  - step: branch
    if: "${order.total} > 100"
    then:
      - step: set
        var: shipping
        value: "0"
      - step: call
        fn: notify_premium
    else:
      - step: set
        var: shipping
        value: "9.99"
  - step: loop
    over: "${order.items}"
    do:
      - step: call
        fn: reserve_stock
        args: ["${item.sku}"]      # note: 'item' loop variable
```

```python
# the interpreter — excerpt
def run_step(step, scope):
    if step["step"] == "branch":
        if eval_expr(step["if"], scope):           # eval_expr does string substitution + eval()
            for s in step["then"]: run_step(s, scope)
        else:
            for s in step["else"]: run_step(s, scope)   # KeyError if no 'else'
    elif step["step"] == "loop":
        for it in eval_expr(step["over"], scope):
            scope["item"] = it                     # leaks into outer scope; never cleaned up
            for s in step["do"]: run_step(s, scope)

def eval_expr(expr, scope):
    for k, v in scope.items():
        expr = expr.replace("${" + k + "}", repr(v))
    return eval(expr)                              # arbitrary code execution
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Inner-Platform Effect** (the dominant pattern) **+ Golden Hammer** (using string-substitution + `eval()` as the "expression engine") — a multi-pattern, multi-bug disaster, and one of the most common ways teams build themselves into a corner.

The team has reinvented a **programming language** — variables, branches, loops, function calls, expression evaluation — in YAML, and built a worse, slower, less-safe interpreter for it than the host language they're already running on. That's the Inner-Platform Effect by the book: a configurable system that has grown into a poor copy of the platform beneath it.

**Concrete bugs, all caused by the half-built platform:**

1. **`eval()` is remote code execution.** `eval_expr` does naive string substitution then `eval()`. Any analyst (or anyone who can edit the YAML, or inject into `order` fields) can run arbitrary Python. A field value like `"} or __import__('os').system('...')"` is game over. The home-grown expression engine reimplemented the unsafe 1% of a language and skipped the safe 99%.
2. **Substitution is textual and lossy.** `expr.replace("${" + k + "}", repr(v))` substitutes *every* matching key into *every* expression with no scoping or typing. A string field containing `${...}` gets re-substituted; numeric vs string comparison is whatever `eval` guesses.
3. **The malformed-rule bug:** the `branch` step assumes both `then` *and* `else` exist. A perfectly reasonable workflow with only a `then` raises **`KeyError` at runtime**, deep inside the interpreter, with a stack trace that means nothing to the analyst who wrote the YAML.
4. **The loop variable leaks.** `scope["item"] = it` is never removed, so after the loop, `${item}` still resolves to the *last* item — any later step referencing `item` (by mistake or by stale copy-paste) silently uses leftover state. A scoping bug the host language would never have allowed.

**Fix:** stop building a language. Two legitimate routes:

- **Express workflows in real code.** Each "step" becomes a function; branching and loops are `if`/`for`. You get the type checker, the debugger, real scoping, no `eval`, and tests — for free.
- **If non-engineers genuinely must author logic,** adopt a *real*, sandboxed, maintained engine (a proper workflow product, or a safe embedded expression language like CEL/JSONLogic that **cannot** execute arbitrary code) and define a **plugin boundary** (`fn:` names map to vetted, registered functions) rather than an open `eval`.

```python
# the "real code" route — the workflow is just a function
def process_order(order):
    shipping = 0 if order.total > 100 else 9.99
    if order.total > 100:
        notify_premium(order)
    for item in order.items:        # 'item' is properly scoped to the loop
        reserve_stock(item.sku)
    return shipping
```

The tell for Inner-Platform Effect: you find yourself implementing variables, control flow, and an expression evaluator in config. The platform you're standing on already has all three.

</details>

---

## Snippet 7 — The collection that is read-only sometimes

```java
// Java — a domain collection wrapper used across the order module
public interface OrderLines extends List<OrderLine> {
    BigDecimal total();
}

// the concrete type returned by a *finalized* (immutable) order:
public final class FinalizedOrderLines extends AbstractList<OrderLine>
        implements OrderLines {
    private final List<OrderLine> lines;
    FinalizedOrderLines(List<OrderLine> lines) { this.lines = List.copyOf(lines); }

    public OrderLine get(int i) { return lines.get(i); }
    public int size()           { return lines.size(); }
    public BigDecimal total()   { return lines.stream().map(OrderLine::amount)
                                              .reduce(ZERO, BigDecimal::add); }

    @Override public boolean add(OrderLine l) {
        throw new UnsupportedOperationException("order is finalized");
    }
    @Override public OrderLine set(int i, OrderLine l) {
        throw new UnsupportedOperationException("order is finalized");
    }
    @Override public OrderLine remove(int i) {
        throw new UnsupportedOperationException("order is finalized");
    }
}

// a generic discount routine, written against List, reused for finalized orders:
void applyLineDiscount(List<OrderLine> lines, BigDecimal pct) {
    for (int i = 0; i < lines.size(); i++) {
        lines.set(i, lines.get(i).discounted(pct));   // <-- mutates in place
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Interface Bloat** — specifically the classic *Refused Bequest / fat `List` interface* version of it — *with a real runtime failure.*

`OrderLines extends List<OrderLine>` inherits **all of `List`'s mutators** (`add`, `set`, `remove`, `clear`, `addAll`, `sort`, `replaceAll`, …). A *finalized* order is immutable, so `FinalizedOrderLines` can only honor the read methods and is forced to **throw `UnsupportedOperationException`** for every mutator — the unmistakable sign that the interface promises more than the implementer can deliver. (This is exactly why `java.util.List.add` is documented as an *optional operation* — a design wart the JDK itself regrets.)

**The concrete bug:** `applyLineDiscount` is written against `List<OrderLine>` — a totally reasonable, reusable signature — and calls `lines.set(...)`. Passed a `FinalizedOrderLines`, it **throws `UnsupportedOperationException` at runtime**. The type system actively *encouraged* the bug: `FinalizedOrderLines` *is-a* `List`, so the compiler happily allows passing it to anything expecting a `List`, including code that mutates. The interface advertises a capability (mutation) the object refuses.

**Fix:** don't bequeath the fat `List` interface. Expose only the operations the type actually supports — read access plus the domain method — and keep mutability out of the published type entirely.

```java
public interface OrderLines extends Iterable<OrderLine> {   // no mutators inherited
    OrderLine get(int i);
    int size();
    BigDecimal total();
}

// discount becomes a pure transformation, not an in-place mutation:
List<OrderLine> discounted(OrderLines lines, BigDecimal pct) {
    var out = new ArrayList<OrderLine>(lines.size());
    for (OrderLine l : lines) out.add(l.discounted(pct));
    return out;                       // caller decides what to do with a new list
}
```

Now there is no `set` to call on a finalized order, so the runtime failure is impossible — and "this collection is immutable" is expressed in the *type*, not as a landmine behind every inherited mutator.

</details>

---

## Snippet 8 — The recursive directory sizer

```go
// Go — "compute total size of a directory tree". The author loves recursion.
func DirSize(path string) (int64, error) {
    entries, err := os.ReadDir(path)
    if err != nil {
        return 0, err
    }
    var total int64
    for _, e := range entries {
        full := filepath.Join(path, e.Name())
        if e.IsDir() {
            sub, err := DirSize(full)        // recurse per subdirectory
            if err != nil {
                return 0, err
            }
            total += sub
        } else {
            info, _ := e.Info()
            total += info.Size()
        }
    }
    return total, nil
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Golden Hammer** (recursion reached for reflexively on a tree-shaped problem) — *with two real, production-grade bugs that the recursive framing makes easy to miss.*

Recursion is elegant for trees and is the author's go-to, so a directory walk "obviously" recurses. The shape is right; the *details* the recursive framing glosses over are where it breaks:

1. **Unbounded recursion → stack overflow / file-descriptor exhaustion.** On a deeply nested tree (a pathological `node_modules`, a symlink loop, a maliciously crafted archive extracted to disk), the recursion depth tracks directory depth. A **symlink that points to an ancestor** creates an *infinite* recursion — `DirSize` follows it forever and the program crashes or hangs. `os.ReadDir` does not resolve symlinks for you, and `e.IsDir()` on a symlink-to-dir can still send you down the loop. The Go runtime *can* grow the stack, but the real ceiling here is **leaked open directory handles** at every recursion level and eventual `too many open files`.
2. **Swallowed `Info()` error → silently wrong total.** `info, _ := e.Info()` discards the error. If a file is deleted mid-walk or permission is denied, `info` is `nil`, `info.Size()` **panics** — or, in a defensive variant returning 0, the total is silently *understated*. Either way the "size" is wrong and nobody knows.

The deeper point: this isn't "recursion is bad." It's that recursion was chosen because it's the author's hammer, so the *operational* questions a directory walk demands — depth bounds, symlink cycles, partial failures, handle limits — were never asked. The standard library already solved all of them.

**Fix:** use the platform's purpose-built walker, which is iterative, handles errors per-entry, and doesn't follow symlinks by default.

```go
func DirSize(root string) (int64, error) {
    var total int64
    err := filepath.WalkDir(root, func(_ string, d os.DirEntry, err error) error {
        if err != nil {
            return err                       // surface every error; don't swallow
        }
        if !d.IsDir() {
            info, err := d.Info()
            if err != nil {
                return err
            }
            total += info.Size()
        }
        return nil
    })
    return total, err
}
```

`filepath.WalkDir` doesn't follow symlinks (no infinite loop), is iterative (no stack blowup), and threads errors through explicitly. The Golden-Hammer tell: choosing the *control structure* (recursion) before asking what the *problem* (filesystem traversal) actually requires.

</details>

---

## Snippet 9 — The pluggable notifier with one knob

```python
# Python — written when the only notifier was email; "made flexible for the future"
from abc import ABC, abstractmethod

class NotificationChannel(ABC):
    @abstractmethod
    def build_payload(self, user, message): ...
    @abstractmethod
    def transport(self): ...
    @abstractmethod
    def retry_policy(self): ...
    @abstractmethod
    def rate_limit(self): ...
    @abstractmethod
    def serialize(self, payload): ...
    @abstractmethod
    def template_engine(self): ...

class EmailChannel(NotificationChannel):
    def build_payload(self, user, message):
        return {"to": user.email, "subject": "Notice", "body": message}
    def transport(self):       return self._smtp
    def retry_policy(self):    return ExponentialBackoff(max=3)
    def rate_limit(self):      return None
    def serialize(self, p):    return mime_encode(p)
    def template_engine(self): return self._jinja

# six months later, the second channel arrives: SMS.
class SmsChannel(NotificationChannel):
    def build_payload(self, user, message):
        return {"to": user.phone, "text": message[:160]}   # SMS truncates at 160
    def transport(self):       return self._twilio
    def retry_policy(self):    return ExponentialBackoff(max=3)   # copied from email
    def rate_limit(self):      return None
    def serialize(self, p):    return p                    # no MIME for SMS
    def template_engine(self): return None                 # SMS has no templates!
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Premature Abstraction + Interface Bloat** (multi-pattern). The interface was extracted from *one* implementation (email) and over-specified with six methods, several of which exist only because *email* needs them.

When email was the only channel, the author "designed for the future" and invented a six-method `NotificationChannel` interface — `serialize`, `template_engine`, `rate_limit`, `retry_policy`, etc. — all reverse-engineered from how email works. This is **Premature Abstraction**: the interface shape is a *guess* projected from a single case, and the guess encodes email's accidental details as if they were universal.

**Why it's also Interface Bloat — and the concrete consequences:** when SMS arrives, it can't fill the shape honestly:

- `template_engine()` returns `None` — SMS has no templates, so the method is **meaningless** for this implementer. Any orchestration code that does `channel.template_engine().render(...)` will hit `AttributeError: 'NoneType'` for SMS — a runtime crash born of an interface method that should never have been universal.
- `serialize()` is a no-op pass-through for SMS; it existed only because email needs MIME encoding.
- `rate_limit()` returns `None` for both — a guessed knob nobody has ever used (speculative generality).
- `retry_policy()` was **copy-pasted** from email into SMS (`max=3`), even though SMS providers have very different retry/idempotency semantics — the guessed abstraction *encouraged* a careless copy rather than a real decision.

**The latent bug:** the `build_payload` contract returns an untyped dict whose *shape differs per channel* (`{to, subject, body}` vs `{to, text}`), and the interface says nothing about which keys are required. Generic code consuming the payload (a logger, an audit trail, a retry queue) that reads `payload["body"]` will `KeyError` on SMS payloads — the abstraction unified the *method signatures* while leaving the *data contract* incoherent.

**Fix:** wait for the rule of three; until then, abstract only the **one operation that's genuinely shared** — "send a message to a user" — and let each channel keep its own details private.

```python
class NotificationChannel(Protocol):
    def send(self, user, message: str) -> None: ...   # the only real commonality

class EmailChannel:
    def send(self, user, message):
        payload = {"to": user.email, "subject": "Notice", "body": message}
        self._smtp.send(self._jinja.render(payload))   # templating is email's detail

class SmsChannel:
    def send(self, user, message):
        self._twilio.send(user.phone, message[:160])   # truncation is SMS's detail
```

The six speculative methods vanish; each channel owns its accidents; there is no `None`-returning method to crash on. If a third channel later reveals a *real* shared sub-operation, extract it *then* — guided by three concrete cases, not one.

</details>

---

## Snippet 10 — The clock interface

```go
// Go — a tiny interface in a billing package; reviewer flags it as "over-abstraction"
type Clock interface {
    Now() time.Time
}

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

// production wiring:
func NewBillingService() *BillingService {
    return &BillingService{clock: realClock{}}
}

type BillingService struct{ clock Clock }

func (s *BillingService) IsOverdue(inv Invoice) bool {
    return s.clock.Now().After(inv.DueDate)
}

// in tests:
type fixedClock struct{ t time.Time }
func (c fixedClock) Now() time.Time { return c.t }

func TestIsOverdue(t *testing.T) {
    svc := &BillingService{clock: fixedClock{t: parse("2024-01-15")}}
    if !svc.IsOverdue(Invoice{DueDate: parse("2024-01-10")}) {
        t.Fatal("expected overdue")
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: this is NOT an abstraction failure — it's a justified abstraction, and the reviewer who flagged it is wrong.**

At a glance this trips every alarm: a one-method interface, a single production implementation, "abstracting" something as fundamental as the wall clock. That *pattern-matches* to Premature Abstraction and Golden-Hammer-style ceremony. But abstractions are judged by **whether they do work today**, not by their shape — and this one earns its keep right now:

- **`time.Now()` is the canonical non-deterministic dependency.** Code that calls it directly is *untestable* for any time-relative behavior — you cannot test "is this invoice overdue?" against a hard-coded `time.Now()` without sleeping or monkey-patching the global clock (which Go doesn't cleanly allow).
- The interface has a **real second implementation today**: `fixedClock` in the tests. That is a genuine *test seam*, exactly the justified case — not a hypothetical future impl.
- It is **minimal and stable**: one method, `Now()`, with no speculative `Sleep`, `Timer`, `Tick`, or timezone knobs bolted on "for the future." That restraint is what keeps it from sliding into Interface Bloat or Premature Abstraction. The abstraction is sized exactly to the need.

**Contrast with a real failure:** it *would* become Premature Abstraction if it grew speculative methods (`Sleep`, `After`, `NewTicker`, `Location`) before anything used them, or Golden Hammer if the author then "clocked" everything in sight reflexively. The diagnostic question is always **"does this abstraction do work today?"** Here: yes — it makes time-dependent billing logic deterministically testable, with the narrowest possible surface.

**The lesson for critical reading:** don't reflex-reject "small interface + one production impl." A minimal, stable interface introduced to break a hard dependency (time, randomness, the network, the filesystem) for testing is *good design*, not an abstraction failure. Count the real consumers — including tests — and check the surface for speculative width before crying "over-abstraction."

</details>

---

## Snippet 11 — The in-database expression language

```sql
-- A "calculated columns" feature. Users define formulas in a web UI; the app stores
-- them and evaluates them inside a stored procedure that walks a custom AST table.

CREATE TABLE formula_node (
    id          INT PRIMARY KEY,
    formula_id  INT,
    node_type   VARCHAR(16),   -- 'const' | 'col' | 'add' | 'mul' | 'div' | 'if'
    value       VARCHAR(64),   -- meaning depends on node_type
    left_id     INT,           -- child node ids
    right_id    INT,
    cond_id     INT
);
```

```python
# the evaluator the app runs for every row of every report:
def eval_node(node_id, row):
    node = fetch_node(node_id)               # one DB round-trip per node
    t = node["node_type"]
    if t == "const":
        return float(node["value"])
    if t == "col":
        return row[node["value"]]
    if t == "add":
        return eval_node(node["left_id"], row) + eval_node(node["right_id"], row)
    if t == "mul":
        return eval_node(node["left_id"], row) * eval_node(node["right_id"], row)
    if t == "div":
        return eval_node(node["left_id"], row) / eval_node(node["right_id"], row)
    if t == "if":
        if eval_node(node["cond_id"], row):
            return eval_node(node["left_id"], row)
        return eval_node(node["right_id"], row)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Inner-Platform Effect** in its purest form — *with a real correctness bug and a severe performance bug.*

The team has built an **arithmetic-and-conditional expression language**, complete with a custom AST stored in a relational table and a tree-walking interpreter — a worse, slower, less-safe copy of the expression evaluation the database *and* the host language already provide. Storing an AST as rows (`left_id`, `right_id`, `cond_id`) is the unmistakable Inner-Platform tell: a generic, self-referential schema reimplementing a parser/evaluator the platform ships for free.

**The performance bug (caused directly by the architecture):** `eval_node` does **one DB round-trip per AST node** (`fetch_node`), recursively, **for every row of every report**. A modest formula of 10 nodes over a 100,000-row report is **one million queries**. This is an N+1 explosion baked into the design — the "expression language" turned a one-line arithmetic expression into a database-saturating workload.

**The correctness bug:** the `div` branch has **no guard against division by zero** and no typing. Because `value` is `VARCHAR` and `col` values come from arbitrary report rows, a single row with a zero denominator throws (or, worse, in a "tolerant" variant returns `inf`/`NaN`) **mid-report**, and there's no way for the formula author — who typed `a / b` in a web UI — to discover why. The home-grown language reimplemented arithmetic but skipped the error semantics a real language would force you to handle. (`if`-node short-circuiting is also unenforced: both branches' subtrees may be fetched depending on how `fetch_node`/caching is written, compounding the N+1.)

**Fix:** stop building a language inside the database.

- If formulas are **author-time and finite**, compile each formula **once** into a host-language closure (or a single parameterized SQL expression) and evaluate it in-process over the already-fetched rows — no per-node, per-row queries.
- If users must author logic, use a **real, sandboxed expression library** (CEL, a vetted parser) that gives you typing, division/zero semantics, and short-circuiting — not a hand-rolled AST-in-a-table.

```python
import ast, operator

# compile the formula text ONCE into a safe callable, then apply to every row in-process
_OPS = {ast.Add: operator.add, ast.Mult: operator.mul, ast.Div: operator.truediv}

def compile_formula(expr_text):
    tree = ast.parse(expr_text, mode="eval")      # parse once
    def run(row):
        return _eval(tree.body, row)              # no DB round-trips per node
    return run
# (_eval validates node types, rejects unknown ops, and guards division)
```

One parse, zero per-node queries, real error handling — the platform's own parser doing what the in-DB AST tried and failed to do.

</details>

---

## Snippet 12 — The shape hierarchy that guessed wrong

```java
// Java — a geometry module. The abstraction was designed up front from one example (Circle).
public abstract class Shape {
    protected double radius;                  // <-- assumed every shape has a radius

    public Shape(double radius) { this.radius = radius; }

    public abstract double area();

    public double diameter() { return 2 * radius; }      // "every shape has one", apparently
    public void scale(double f) { this.radius *= f; }    // scaling = grow the radius
}

public class Circle extends Shape {
    public Circle(double r) { super(r); }
    public double area() { return Math.PI * radius * radius; }
}

// added later — the second shape reveals the abstraction was guessed:
public class Rectangle extends Shape {
    private double width, height;
    public Rectangle(double w, double h) {
        super(w / 2);                         // <-- fake a "radius" to satisfy super()
        this.width = w; this.height = h;
    }
    public double area() { return width * height; }
    // inherits diameter() and scale() from Shape...
}

// generic code that resizes any shape, written against Shape:
void resize(Shape s, double factor) { s.scale(factor); }
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Premature Abstraction** — the `Shape` base class was designed *up front* from a single example (`Circle`), so it baked **`Circle`'s accidental properties** (`radius`, `diameter`, "scale by changing the radius") into the universal contract. The second concrete case, `Rectangle`, exposes the guess.

**How the guessed abstraction forces invalid states:**

- `Rectangle` must call `super(w / 2)` to **fake a radius it doesn't have**, just to satisfy the base constructor. The `radius` field is now meaningless for rectangles but still present and mutable.
- `Rectangle` inherits `diameter()`, which returns `2 * (w/2) == w` — a **nonsense value** silently returned as if it were a real "diameter." Any generic code calling `shape.diameter()` gets garbage for rectangles with no error.
- **The concrete bug — `resize` reaches an invalid state.** `resize(rect, 2.0)` calls the inherited `scale`, which does `this.radius *= 2` — it scales the *phantom* `radius` field and **never touches `width`/`height`**. So `rect.area()` is **unchanged** after `resize`. A reviewer reading `resize` (one line) or `scale` (one line) in isolation sees nothing wrong; the bug lives in the mismatch between the guessed base and the real subtype. The abstraction *invited* a state where a `Rectangle`'s `radius` and its `width/height` disagree about how big it is.

This is the rule-of-three lesson stated sharply: with **one** concrete shape you cannot know which properties are essential (`area`) versus accidental (`radius`, `diameter`). Designing the hierarchy before the second case guarantees the contract encodes accidents.

**Fix:** the base should contain only what is *genuinely common to all shapes* — which, after seeing the second case, is just `area()` (and maybe `scale` defined per-shape). Drop the speculative `radius`/`diameter`.

```java
public interface Shape {
    double area();
    Shape scaled(double factor);     // each shape knows how to scale itself, immutably
}

public final class Circle implements Shape {
    private final double radius;
    public Circle(double r) { this.radius = r; }
    public double area() { return Math.PI * radius * radius; }
    public Shape scaled(double f) { return new Circle(radius * f); }
}

public final class Rectangle implements Shape {
    private final double width, height;
    public Rectangle(double w, double h) { this.width = w; this.height = h; }
    public double area() { return width * height; }
    public Shape scaled(double f) { return new Rectangle(width * f, height * f); }
}
```

No phantom `radius`, no nonsense `diameter`, and `scaled` actually resizes each shape correctly because the operation lives where the real dimensions do. The abstraction now holds only the *proven* commonality.

</details>

---

## Snippet 13 — The JSON store built on a relational table

```python
# Python — "we need flexible, schemaless storage", built on top of PostgreSQL
# by storing every entity as key/value rows in one EAV table.

# table: attribute(entity_id, entity_type, key, value TEXT)

def save_entity(entity_type, entity_id, obj: dict):
    for k, v in obj.items():
        db.execute(
            "INSERT INTO attribute(entity_id, entity_type, key, value) VALUES (%s,%s,%s,%s) "
            "ON CONFLICT (entity_id, key) DO UPDATE SET value = EXCLUDED.value",
            (entity_id, entity_type, k, str(v)),     # everything stringified
        )

def load_entity(entity_type, entity_id):
    rows = db.query(
        "SELECT key, value FROM attribute WHERE entity_id=%s AND entity_type=%s",
        (entity_id, entity_type),
    )
    return {r["key"]: r["value"] for r in rows}      # everything comes back as str

# usage:
save_entity("order", 42, {"total": 100.0, "paid": True, "items": 3})
order = load_entity("order", 42)
if order["paid"]:                                    # <-- always truthy!
    ship(order)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Inner-Platform Effect** — the **Entity-Attribute-Value (EAV)** anti-pattern is the canonical database example. The team built a "flexible, schemaless" key/value store **on top of** a relational database, reimplementing — worse and slower — the schema, typing, and indexing the database already provides. They turned PostgreSQL into a poorly-typed document store inside a single `attribute` table.

**The concrete bug — type erasure causes a false-positive ship:**

- `save_entity` stringifies *every* value: `str(True)` → `"True"`, `str(100.0)` → `"100.0"`, `str(3)` → `"3"`.
- `load_entity` returns every value as a **string**.
- So `order["paid"]` is the **string `"True"`**, not the boolean `True`. In Python, **any non-empty string is truthy** — and `"False"` is *also* truthy! The check `if order["paid"]:` is `True` regardless of whether the order was actually paid. An **unpaid order ships.** This is a direct, money-losing functional bug caused by the home-grown store discarding types the platform would have preserved.
- `order["total"]` is the string `"100.0"`; any arithmetic on it raises `TypeError` or, with `+`, silently concatenates. Sorting, range queries, and aggregation on `value TEXT` are all broken or require casting every row.

**The platform features this reinvented (badly):** typed columns, `NOT NULL`/`CHECK` constraints, indexes (you can't usefully index `value TEXT` across heterogeneous keys), foreign keys, and query planning. EAV defeats all of them — every "query" becomes a self-join soup, and the database can't optimize what it can't see.

**Fix:** use the platform. Give `order` a **real table with typed columns**; if you genuinely need some schemaless flexibility, use the database's *native* typed document support (`JSONB` in PostgreSQL), which preserves types and is indexable — instead of stringifying everything into an EAV table.

```sql
CREATE TABLE orders (
    id     BIGINT PRIMARY KEY,
    total  NUMERIC(12,2) NOT NULL,
    paid   BOOLEAN       NOT NULL DEFAULT FALSE,   -- real boolean, no "True"/"False" strings
    items  INT           NOT NULL
);
-- need flexible extra fields? use a typed JSONB column, not an EAV table:
ALTER TABLE orders ADD COLUMN meta JSONB;
```

```python
order = load_order(42)        # paid comes back as a real bool
if order.paid:                # correct: False is falsy, True is truthy
    ship(order)
```

The boolean stays a boolean, `total` stays numeric, and the database can index and constrain it. The Inner-Platform tell: building a generic `(key, value)` store on top of a system that already *is* a typed, indexed store.

</details>

---

## Snippet 14 — The animal interface every implementer dreads

```java
// Java — an interface in a zoo-simulation engine, "so all animals are uniform"
public interface Animal {
    void walk();
    void run();
    void swim();
    void fly();
    void climb();
    void burrow();
    String sound();
    void eat(Food f);
}

public class Penguin implements Animal {
    public void walk() { /* waddle */ }
    public void run()  { /* ... */ }
    public void swim() { /* ... */ }
    public void fly()  { throw new UnsupportedOperationException("penguins can't fly"); }
    public void climb(){ throw new UnsupportedOperationException(); }
    public void burrow(){ throw new UnsupportedOperationException(); }
    public String sound() { return "squawk"; }
    public void eat(Food f) { /* ... */ }
}

// the migration scheduler moves every animal to its winter habitat:
void migrate(List<Animal> animals) {
    for (Animal a : animals) {
        a.fly();                        // "all migrating animals fly south"
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Interface Bloat** (Interface Segregation violation) — the canonical teaching example, here wired to a **real runtime crash.**

`Animal` lumps **eight** capabilities — `walk`, `run`, `swim`, `fly`, `climb`, `burrow`, plus `sound`/`eat` — into one interface, on the assumption that "all animals are uniform." No real animal has all eight locomotion modes, so every implementer is forced to throw `UnsupportedOperationException` for the ones it lacks. `Penguin` can't fly, climb, or burrow, so three of its eight methods are landmines.

**The concrete bug:** `migrate` is written against `Animal` and calls `a.fly()` on every element ("all migrating animals fly south"). The moment a `Penguin` (or any flightless animal) is in the list, `migrate` **throws `UnsupportedOperationException` at runtime** — mid-loop, possibly after partially migrating other animals, leaving the simulation in an inconsistent state. The type system *guaranteed* this was possible: `Penguin is-a Animal`, so the compiler happily admits it into a `List<Animal>` that `migrate` consumes, even though `Penguin` cannot honor `fly`. The interface advertises a capability the object refuses to provide.

**Fix — Interface Segregation: split the fat interface into small role interfaces** that each animal composes from. Capabilities an animal lacks simply aren't implemented, so misuse becomes a *compile error*, not a runtime exception.

```java
interface Animal   { String sound(); void eat(Food f); }   // truly universal
interface Walker   { void walk(); void run(); }
interface Swimmer  { void swim(); }
interface Flyer    { void fly(); }
interface Climber  { void climb(); }
interface Burrower { void burrow(); }

class Penguin implements Animal, Walker, Swimmer {          // only what it can do
    public void walk() {}  public void run() {}  public void swim() {}
    public String sound() { return "squawk"; }  public void eat(Food f) {}
}

// migrate now states its real requirement in the type — and can't be handed a Penguin:
void migrate(List<Flyer> flyers) {
    for (Flyer f : flyers) f.fly();
}
```

Now `migrate(List<Flyer>)` *cannot* receive a `Penguin` — the bug is caught at compile time. Each implementer declares exactly the capabilities it has; no method is ever a lie.

</details>

---

## Summary — patterns of spotting

Abstraction failures don't announce themselves with a crash on line one. They look *clean*, *configurable*, or *clever*, and the damage surfaces later — often as a silent functional bug. The repeatable diagnostic moves from these fourteen snippets:

- **Watch for the platform being rebuilt inside the platform.** If you find variables, control flow, an expression evaluator, an AST-in-a-table, or a key/value store implemented on top of a language or database that already provides all of those — that's the **Inner-Platform Effect** (Snippets 1, 6, 11, 13). The tell is a *generic, configurable* mechanism reimplementing something the host gives you for free, and the recurring bug is **silent mis-evaluation of a malformed or edge-case input** (a misspelled rule, a missing `else`, division by zero, a stringified boolean that ships an unpaid order).
- **Ask whether the tool fits the problem, not the author's habits.** A graph library used for the wrong graph algorithm, regex used to parse a non-regular format, recursion chosen before the operational questions are asked — these are **Golden Hammers** (Snippets 2, 5, 8). The wrong tool doesn't just under-perform; it produces *wrong answers* on the edge cases it was never suited for (dropped tasks, mis-routed mail, symlink loops, swallowed errors).
- **Count `UnsupportedOperationException` / `raise NotImplementedError` / `return None` stubs.** Every method an implementer is forced to *refuse* is a sign the interface promised more than it can deliver — **Interface Bloat** (Snippets 3, 7, 9, 14). The bug pattern is identical every time: code written against the wide interface calls the refused method and **crashes at runtime**, because the type system advertised a capability the object doesn't have. The cure is always Interface Segregation — split into role interfaces so misuse becomes a *compile* error.
- **Find abstractions extracted from a single example, then check the second case.** A base class, strategy, or interface designed *up front* or from *one* implementation bakes that case's accidents into the universal contract — **Premature Abstraction** (Snippets 4, 9, 12). The second concrete case can't fit the guessed shape, so it fakes fields (`super(w/2)`), returns `None` for meaningless methods, or hides a lifecycle invariant that lets a caller **reach an invalid state** (an unscaled rectangle, an unset `_auth_id`). Honor the **rule of three**.
- **Resist false positives.** A *small, stable, minimal* interface introduced to break a hard dependency for testing — a `Clock`, a fake repository — is **good design**, not over-abstraction (Snippet 10). Abstractions are judged by whether they **do work today**, not by their shape. Count the real consumers (including tests) and check the surface for *speculative width* before crying "premature."

The meta-lesson: **the wrong abstraction is more dangerous than no abstraction**, because it *looks* like a decision was made well. A custom rule engine silently denied eligibility; a Golden-Hammer regex mis-routed real users' mail; a bloated interface threw at 2 a.m.; a guessed strategy let a payment reach an unset state; an EAV store shipped an unpaid order. When an abstraction feels elegant, ask the hard question anyway: *does this shape fit the problem, or just the tool I reached for?*

---

## Related Topics

- [`tasks.md`](tasks.md) — design exercises that build the same muscles from the writing side.
- [`../01-oo-misuse/find-bug.md`](../01-oo-misuse/find-bug.md) — sibling find-bug file (Anemic Model, Magic Container, Flag Arguments, …).
- [`../02-coupling-and-state/find-bug.md`](../02-coupling-and-state/find-bug.md) — sibling find-bug file (Singletonitis, Hidden Dependencies, …).
- [Clean Code → Classes (SOLID, ISP)](../../../clean-code/09-classes/README.md) — the Interface Segregation cure for bloated interfaces.
- [Design Patterns → Structural](../../../design-patterns/02-structural/README.md) — Adapter, Facade, and composition as alternatives to fat interfaces.
- [Design Patterns → Behavioral](../../../design-patterns/03-behavioral/README.md) — Strategy done right, *after* the rule of three.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — Speculative Generality and Refused Bequest, the smell-level view.
- [Algorithms → Graphs](../../../../../Data/datastructures-and-algorithms/11-graphs/01-representation/junior.md) — which graph algorithm fits which problem (the Golden-Hammer antidote).
