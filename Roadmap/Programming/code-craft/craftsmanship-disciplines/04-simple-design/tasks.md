# Simple Design — Practice Tasks

> **Category:** [Craftsmanship Disciplines](../README.md) — Kent Beck's four rules for writing code that is no more complicated than it needs to be, in strict priority order.

10 graded hands-on tasks with full Python, Java, and Go solutions. Try each before expanding the solution. Each task names the rule(s) it exercises.

---

## Table of Contents

1. [Task 1: Reveal Intent via Naming](#task-1-reveal-intent-via-naming)
2. [Task 2: Remove Real Duplication](#task-2-remove-real-duplication)
3. [Task 3: Don't DRY Coincidental Similarity](#task-3-dont-dry-coincidental-similarity)
4. [Task 4: Delete a Needless Abstraction](#task-4-delete-a-needless-abstraction)
5. [Task 5: Evolve a Design Through All Four Rules](#task-5-evolve-a-design-through-all-four-rules)
6. [Task 6: Apply the Rule of Three](#task-6-apply-the-rule-of-three)
7. [Task 7: Remove Speculative Generality](#task-7-remove-speculative-generality)
8. [Task 8: Resolve a Clarity-vs-DRY Conflict](#task-8-resolve-a-clarity-vs-dry-conflict)
9. [Task 9: Escape the Wrong Abstraction](#task-9-escape-the-wrong-abstraction)
10. [Task 10: Decide Emergent vs. Up-Front](#task-10-decide-emergent-vs-up-front)
11. [Practice Tips](#practice-tips)

---

## Task 1: Reveal Intent via Naming

**Rule:** 2 (reveals intention). **Goal:** Rename cryptic identifiers and extract magic numbers so the code's purpose is obvious. Behavior must not change (Rule 1).

**Given (Python):**

```python
def calc(d, n):
    return d - (d * n * 0.05)
```

<details><summary>Solution</summary>

### Python
```python
DISCOUNT_PER_UNIT = 0.05

def discounted_price(base_price, units):
    return base_price - (base_price * units * DISCOUNT_PER_UNIT)
```

### Java
```java
static final double DISCOUNT_PER_UNIT = 0.05;

double discountedPrice(double basePrice, int units) {
    return basePrice - (basePrice * units * DISCOUNT_PER_UNIT);
}
```

### Go
```go
const discountPerUnit = 0.05

func discountedPrice(basePrice float64, units int) float64 {
    return basePrice - (basePrice * float64(units) * discountPerUnit)
}
```

**Why:** `d`, `n`, and `0.05` hid the *what* and *why*. Names and a named constant reveal intent — the highest-leverage refactor and the second rule. No behavior changed, so Rule 1 stays satisfied.
</details>

---

## Task 2: Remove Real Duplication

**Rule:** 3 (no duplication). **Goal:** The same knowledge (line total = price × quantity) is stated three times. Give it one home.

**Given (Java):**

```java
double subtotal(List<Item> items) {
    double s = 0;
    for (Item i : items) s += i.price() * i.qty();
    return s;
}
double tax(List<Item> items) {
    double s = 0;
    for (Item i : items) s += i.price() * i.qty() * 0.2;   // line total duplicated
    return s;
}
```

<details><summary>Solution</summary>

### Java
```java
double lineTotal(Item i) { return i.price() * i.qty(); }      // ONE home

double subtotal(List<Item> items) {
    return items.stream().mapToDouble(this::lineTotal).sum();
}
double tax(List<Item> items) {
    return subtotal(items) * TAX_RATE;                        // tax built on subtotal
}
```

### Python
```python
def line_total(item): return item.price * item.qty

def subtotal(items): return sum(line_total(i) for i in items)
def tax(items):      return subtotal(items) * TAX_RATE
```

### Go
```go
func lineTotal(i Item) float64 { return i.Price * float64(i.Qty) }

func subtotal(items []Item) (s float64) {
    for _, i := range items { s += lineTotal(i) }
    return
}
func tax(items []Item) float64 { return subtotal(items) * taxRate }
```

**Why:** `price * qty` was the *same knowledge* in two places; if the line-total rule changes (e.g., add per-item fees), you'd have to remember both. Now it has one home, and `tax` is expressed in terms of `subtotal` — duplication removed *and* intent clarified (rules 2 and 3 reinforce each other).
</details>

---

## Task 3: Don't DRY Coincidental Similarity

**Rule:** 3 (no duplication — correctly). **Goal:** Two functions look identical but encode *different* rules. Recognize the coincidence and keep them separate.

**Given (Python):**

```python
def shipping_fee(weight):  return weight * 1.5
def handling_fee(weight):  return weight * 1.5   # looks identical — merge?
```

<details><summary>Solution</summary>

### Python
```python
SHIPPING_RATE_PER_KG = 1.5
HANDLING_RATE_PER_KG = 1.5    # SAME value today, DIFFERENT rule — keep separate

def shipping_fee(weight): return weight * SHIPPING_RATE_PER_KG
def handling_fee(weight): return weight * HANDLING_RATE_PER_KG
```

### Java
```java
static final double SHIPPING_RATE_PER_KG = 1.5;
static final double HANDLING_RATE_PER_KG = 1.5;

double shippingFee(double weight) { return weight * SHIPPING_RATE_PER_KG; }
double handlingFee(double weight) { return weight * HANDLING_RATE_PER_KG; }
```

### Go
```go
const shippingRatePerKg = 1.5
const handlingRatePerKg = 1.5

func shippingFee(w float64) float64 { return w * shippingRatePerKg }
func handlingFee(w float64) float64 { return w * handlingRatePerKg }
```

**Why:** The test is *would a change to one force the same change to the other?* No — shipping and handling are independent business decisions that happen to share a rate today. Merging into one `fee(weight)` would couple them, so the day handling changes you'd break shipping (or add a flag). Coincidental similarity is **not** duplication. Naming the two rates separately is the simple design.
</details>

---

## Task 4: Delete a Needless Abstraction

**Rule:** 4 (fewest elements). **Goal:** Remove a one-implementation interface and its indirection. Behavior unchanged.

**Given (Go):**

```go
type Clock interface{ Now() time.Time }
type SystemClock struct{}
func (SystemClock) Now() time.Time { return time.Now() }

func timestamp(c Clock) string { return c.Now().Format(time.RFC3339) }
// SystemClock is the only implementation, and timestamp is called once with it.
```

<details><summary>Solution</summary>

### Go
```go
func timestamp() string { return time.Now().Format(time.RFC3339) }
```

### Java
```java
String timestamp() { return Instant.now().toString(); }
```

### Python
```python
def timestamp(): return datetime.now(timezone.utc).isoformat()
```

**Why:** The interface, the struct, and the parameter were speculative — added "in case we need a fake clock for tests." If a test seam is *actually* needed now, that's a present requirement and the interface is justified. If it isn't, Rule 4 says delete the indirection; reintroduce it the day a second clock (real or test fake) is real. *(Note: a test-time clock is a common, legitimate reason to keep this seam — judge by whether the need exists today.)*
</details>

---

## Task 5: Evolve a Design Through All Four Rules

**Rules:** 1 → 2 → 3 → 4. **Goal:** Take a broken first draft and walk it through every rule in order. State which rule each step satisfies.

**Given (Python) — buggy and crude:**

```python
def fare(km, t):
    if t == 1:
        c = km * 2
    # missing branches; returns None for other types
    return c
```

<details><summary>Solution</summary>

**Step 1 — pass the tests (Rule 1):**
```python
def fare(km, t):
    if t == 1: return km * 2     # standard
    if t == 2: return km * 3     # express
    return km * 1                # economy (default)
```

**Step 2 — reveal intention (Rule 2):**
```python
RATE_PER_KM = {"economy": 1, "standard": 2, "express": 3}

def fare(distance_km, service_class):
    rate = RATE_PER_KM[service_class]
    return distance_km * rate
```

**Step 3 — no duplication (Rule 3):** the rate table holds each rate once; the formula appears once. Nothing to remove.

**Step 4 — fewest elements (Rule 4):** no dead branch, no unused parameter, no class wrapping one function. The design is one table and a two-line function. **Stop.**

### Java (final form)
```java
static final Map<String,Integer> RATE_PER_KM =
    Map.of("economy", 1, "standard", 2, "express", 3);

int fare(int distanceKm, String serviceClass) {
    return distanceKm * RATE_PER_KM.get(serviceClass);
}
```

### Go (final form)
```go
var ratePerKm = map[string]int{"economy": 1, "standard": 2, "express": 3}

func fare(distanceKm int, serviceClass string) int {
    return distanceKm * ratePerKm[serviceClass]
}
```

**Why:** Correct first, clear second, DRY checked third, minimal last — *in that order*, never breaking a higher rule to satisfy a lower one. And we resisted adding a `FareCalculator` class or `ServiceClass` strategy hierarchy that no present requirement needs.
</details>

---

## Task 6: Apply the Rule of Three

**Rule:** 3 + rule of three. **Goal:** You have two similar blocks. Decide whether to extract now — and when a third appears, do the extraction shaped by all three.

**Given (Python) — two occurrences:**

```python
# occurrence 1
total_a = sum(x.amount for x in cart_a)
print(f"Cart A total: ${total_a:.2f}")

# occurrence 2
total_b = sum(x.amount for x in cart_b)
print(f"Cart B total: ${total_b:.2f}")
```

<details><summary>Solution</summary>

**At two occurrences:** *don't extract yet.* You can't see the abstraction's real shape — is the label always `"Cart X total"`? Always dollars? Always 2 decimals? Tolerate the duplication.

**When a third appears (now you can see the invariants):**

### Python
```python
def print_cart_total(label, cart):
    total = sum(x.amount for x in cart)
    print(f"{label} total: ${total:.2f}")

print_cart_total("Cart A", cart_a)
print_cart_total("Cart B", cart_b)
print_cart_total("Cart C", cart_c)
```

### Java
```java
void printCartTotal(String label, List<LineItem> cart) {
    double total = cart.stream().mapToDouble(LineItem::amount).sum();
    System.out.printf("%s total: $%.2f%n", label, total);
}
```

### Go
```go
func printCartTotal(label string, cart []LineItem) {
    var total float64
    for _, x := range cart { total += x.Amount }
    fmt.Printf("%s total: $%.2f\n", label, total)
}
```

**Why:** Two points fit infinitely many abstractions; the third reveals which parts are truly invariant (sum of amounts, dollar formatting) vs. incidental (the label varies). Extracting at three minimizes the risk of building the *wrong* abstraction. *(Exception: if the two blocks were provably the same regulated rule, you'd DRY immediately — the rule of three guards against guessing, and there's nothing to guess there.)*
</details>

---

## Task 7: Remove Speculative Generality

**Rule:** 4 + YAGNI. **Goal:** Strip out flexibility added for an imagined future — unused parameters, config nobody sets, a hook nobody uses.

**Given (Java):**

```java
String greet(String name, String locale, boolean formal,
             Map<String,Object> extensions, GreetingHook hook) {
    String g = formal ? "Good day, " : "Hi ";   // locale, extensions, hook unused
    return g + name;
}
// Every caller: greet(name, "en", false, Map.of(), null)
```

<details><summary>Solution</summary>

### Java
```java
String greet(String name, boolean formal) {
    return (formal ? "Good day, " : "Hi ") + name;
}
```

### Python
```python
def greet(name, formal=False):
    return ("Good day, " if formal else "Hi ") + name
```

### Go
```go
func greet(name string, formal bool) string {
    if formal { return "Good day, " + name }
    return "Hi " + name
}
```

**Why:** `locale`, `extensions`, and `hook` were never used — pure speculative generality. Every caller passed the same dead values. YAGNI says remove them; when localization or extension is a *real* requirement, add exactly what it needs (and shaped by the real need, not a guess). The signature shrinks to the two parameters that actually vary.
</details>

---

## Task 8: Resolve a Clarity-vs-DRY Conflict

**Rules:** 2 vs 3 (clarity wins). **Goal:** Removing duplication here would create a confusing multi-flag helper. Choose clarity.

**Given (Python) — two methods share ~70% of code, but differ in meaningful ways:**

```python
# A "DRY" attempt someone proposed:
def render(self, mode, compact, redact, totals):
    out = []
    if mode == "summary":
        out.append(self.title)
        if not compact: out.append(self.subtitle)
    elif mode == "detail":
        for row in self.rows:
            out.append(self._fmt(row, redact))
    if totals: out.append(self._totals())
    return "\n".join(out)   # 4 params, 2 modes, hard to follow
```

<details><summary>Solution</summary>

### Python
```python
def render_summary(self, compact=False):
    out = [self.title]
    if not compact:
        out.append(self.subtitle)
    out.append(self._totals())
    return "\n".join(out)

def render_detail(self, redact=False):
    out = [self._fmt(row, redact) for row in self.rows]
    out.append(self._totals())
    return "\n".join(out)
# _totals() is the genuinely shared knowledge — it stays DRY.
```

### Java
```java
String renderSummary(boolean compact) {
    var out = new ArrayList<String>(List.of(title));
    if (!compact) out.add(subtitle);
    out.add(totals());
    return String.join("\n", out);
}
String renderDetail(boolean redact) {
    var out = rows.stream().map(r -> fmt(r, redact)).collect(toList());
    out.add(totals());
    return String.join("\n", out);
}
```

### Go
```go
func (d Doc) RenderSummary(compact bool) string {
    out := []string{d.Title}
    if !compact { out = append(out, d.Subtitle) }
    out = append(out, d.totals())
    return strings.Join(out, "\n")
}
func (d Doc) RenderDetail(redact bool) string {
    out := make([]string, 0, len(d.Rows))
    for _, r := range d.Rows { out = append(out, d.fmt(r, redact)) }
    out = append(out, d.totals())
    return strings.Join(out, "\n")
}
```

**Why:** The "DRY" `render(mode, ...)` had fewer duplicated lines but was harder to read and change (every edit risked both modes). Two clear, self-contained methods satisfy the **higher** rule (reveals intention) at the cost of a little duplication — the correct trade per the priority order. The *genuinely* shared piece (`totals()`) is still extracted, so we keep DRY where it doesn't fight clarity.
</details>

---

## Task 9: Escape the Wrong Abstraction

**Rules:** 2, 3, 4 (re-introduce duplication, then re-extract). **Goal:** A shared abstraction has accreted flags serving divergent callers. Inline it, simplify each caller, re-extract only what's truly shared.

**Given (Python) — the wrong abstraction:**

```python
def notify(user, kind, urgent=False, digest=False, channel="email"):
    if kind == "welcome":
        subject = "Welcome!"
    elif kind == "receipt":
        subject = "Your receipt"
    elif kind == "alert":
        subject = ("URGENT: " if urgent else "") + "Account alert"
    body = render(kind, user, digest)
    send(channel, user, subject, body)
```

<details><summary>Solution</summary>

### Python
```python
def send_welcome(user):
    send("email", user, "Welcome!", render_welcome(user))

def send_receipt(user, order):
    send("email", user, "Your receipt", render_receipt(user, order))

def send_alert(user, urgent=False):
    subject = ("URGENT: " if urgent else "") + "Account alert"
    send("email", user, subject, render_alert(user))
# `send(...)` is the genuinely shared knowledge (transport) — it stays.
# The kind-switch, the unused `digest`, and the `channel` flag are gone.
```

**Why:** The flag-driven `notify` coupled three messages that share almost nothing but the transport. Inlining into three clear functions (temporarily duplicating the `send(...)` call) made each readable and independent; then `send(...)` — the *real* shared knowledge — remains extracted. The intermediate duplication was intentional and correct: **the wrong abstraction is more expensive than duplication.**

*(In Java/Go the same pattern holds: replace the switchboard method with named methods/functions, keeping only the genuinely shared transport helper.)*
</details>

---

## Task 10: Decide Emergent vs. Up-Front

**Concept:** reversibility / one-way doors. **Goal:** For each decision, say whether to defer (YAGNI/emergent) or design up-front, and why.

**Decisions:**
1. The internal structure of an order-pricing module.
2. The JSON shape of a public webhook payload third parties consume.
3. Whether to put a repository interface between domain and SQL.
4. The on-disk format for a new event-log file.
5. The names and signatures of private helper methods.

<details><summary>Solution</summary>

| Decision | Verdict | Reasoning |
|---|---|---|
| 1. Internal pricing structure | **Emergent** | Reversible — refactor freely behind tests. Apply the four rules; don't over-design. |
| 2. Public webhook payload | **Up-front** | One-way door — third parties depend on it; changing it breaks them. Design deliberately, version it. |
| 3. Repository interface | **Mostly emergent, but watch reversibility** | If persistence might migrate (often a one-way door), the seam is cheap insurance. If you have a *present* need (a test fake or two stores), it's justified now; otherwise defer — but note storage migrations are costly. |
| 4. On-disk event-log format | **Up-front** | One-way door — existing files must stay readable; a format change means a migration. Decide carefully, include a version field. |
| 5. Private helper names/signatures | **Emergent** | Fully reversible (no external caller). Let them emerge and rename freely. |

**Why:** The dividing line is *cost to change later*. Cheap-to-reverse decisions (1, 5) get YAGNI and emergent design. Expensive/irreversible decisions (2, 4) get deliberate up-front design. Decision 3 is the judgement call: weigh the *present* need against the irreversibility of the storage boundary. Applying YAGNI to a one-way door is the costliest mistake in simple design; applying up-front design to reversible internals is speculative generality.
</details>

---

## Practice Tips

1. **Always run the rules in order** — correct, then clear, then DRY, then minimal. Never break a higher rule for a lower one.
2. **Before DRYing, ask:** *would a change to one force the same change to the other?* If no, it's coincidence — keep them apart.
3. **Default to the rule of three** for extraction; extract immediately only when the knowledge is provably identical.
4. **For every abstraction you add, name the present requirement** that forces it. "Might need it later" → don't.
5. **To fix a wrong abstraction, inline first** (re-introduce duplication), then re-extract only the genuinely shared knowledge.
6. **Check reversibility before invoking YAGNI:** reversible → defer; one-way door → design up-front.
7. **Keep tests green throughout** — they're what let you pursue clarity, DRY, and minimalism fearlessly.

---

[← Interview](interview.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
