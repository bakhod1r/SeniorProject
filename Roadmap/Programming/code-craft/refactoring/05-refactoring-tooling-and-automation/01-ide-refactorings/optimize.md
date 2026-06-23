# IDE & Automated Refactorings — Optimize

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

Each snippet has a structural problem. Your job: name the **exact automated refactoring sequence** (in order, with keystrokes) that cleans it up — or identify the point where the tool *can't* help and say what to do instead. This is the "read code, dispatch the right mechanical move" drill that makes refactoring fast.

---

## 1. Opaque nested expression

```java
return ((order.basePrice() * order.quantity()) - order.discount()) * (1 + taxRate);
```

**Refactoring sequence:**

1. **Extract Variable** (`⌘⌥V`) on `order.basePrice() * order.quantity()` → `subtotal`.
2. **Extract Variable** on `subtotal - order.discount()` → `taxableBase`.
3. (optional) **Extract Variable** on `1 + taxRate` → `taxMultiplier`.

```java
double subtotal      = order.basePrice() * order.quantity();
double taxableBase   = subtotal - order.discount();
double taxMultiplier = 1 + taxRate;
return taxableBase * taxMultiplier;
```
Each name documents intent and each sub-result is now inspectable in a debugger. Zero behavior change — pure Extract Variable.

---

## 2. The same literal in six places

```java
double a = price * 0.0825;   // ... and five more sites with 0.0825
```

**Refactoring sequence:**

1. **Extract Constant** (`⌘⌥C`) on `0.0825` → `private static final double SALES_TAX_RATE = 0.0825;`
2. Accept the **"replace all occurrences"** option — but *review* the preview: confirm all six `0.0825` literals genuinely mean the sales-tax rate and not some unrelated coincidence.

```java
private static final double SALES_TAX_RATE = 0.0825;
double a = price * SALES_TAX_RATE;
```
**Tool limit:** if one of the six `0.0825`s was actually a discount that *happens* to equal the tax rate, "replace all" wrongly couples them. Deselect it in the preview.

---

## 3. A long method that's really four steps

```java
void onboard(User u) {
    // create account... (12 lines)
    // provision mailbox... (9 lines)
    // assign default role... (7 lines)
    // send welcome email... (6 lines)
}
```

**Refactoring sequence:**

Four **Extract Method** (`⌘⌥M`) operations, one per comment-delimited block, naming each (`createAccount`, `provisionMailbox`, `assignDefaultRole`, `sendWelcomeEmail`). Run tests after each. The result is a readable "composed method" whose body reads like a table of contents.

```java
void onboard(User u) {
    createAccount(u);
    provisionMailbox(u);
    assignDefaultRole(u);
    sendWelcomeEmail(u);
}
```
**Tool limit:** if a block writes two locals both used by a later block, that extraction won't have a single return — introduce a small result record first, or adjust the seam. See [`../../02-refactoring-techniques/01-composing-methods/optimize.md`](../../02-refactoring-techniques/01-composing-methods/optimize.md).

---

## 4. Feature Envy — math on another object's data

```java
class Invoice {
    double lineTotal(Item item) {
        return item.unitPrice() * item.qty() * (1 - item.discountPct());
    }
}
```

**Refactoring sequence:**

1. **Move Method** (`F6`) `lineTotal` to `Item`, dropping the now-redundant `Item item` parameter (it becomes `this`).
2. **Rename** (`⇧F6`) to `total()`.

```java
class Item {
    double total() { return unitPrice() * qty() * (1 - discountPct()); }
}
```
This removes the Feature Envy smell ([`../../01-code-smells/05-couplers/optimize.md`](../../01-code-smells/05-couplers/optimize.md)); the call site auto-updates to `item.total()`.

---

## 5. Public mutable fields

```java
public class Config {
    public int retries;
    public long timeoutMs;
}
// scattered:  cfg.retries = 3;   if (cfg.timeoutMs > 0) ...
```

**Refactoring sequence:**

**Encapsulate Field** on both fields (via Refactor This `⌃T`). The engine privatizes them, generates accessors, and rewrites every read/write across the codebase. You now have a single choke point to add validation (`setRetries` can reject negatives) later.

```java
public class Config {
    private int retries;  private long timeoutMs;
    public int getRetries() { return retries; }
    public void setRetries(int v) { retries = v; }
    public long getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(long v) { timeoutMs = v; }
}
```
**Tool limit:** if `Config` is deserialized by field-name reflection, encapsulation can shift the wire mapping — pin names with serialization annotations first (see [find-bug.md](find-bug.md) §5).

---

## 6. A helper that hides more than it reveals

```java
boolean eligible(Account a) { return active(a) && a.balance() > 0; }
boolean active(Account a)   { return a.status() == Status.ACTIVE; }
```
`active` is trivial and the indirection obscures the eligibility rule.

**Refactoring sequence:**

**Inline Method** (`⌘⌥N`) `active` (assuming it's not used elsewhere or overridden):

```java
boolean eligible(Account a) { return a.status() == Status.ACTIVE && a.balance() > 0; }
```
**Tool limit:** if `active` is called from many sites or is part of a subclass override, inlining duplicates/changes behavior — the IDE warns; respect the warning. See [`../../02-refactoring-techniques/01-composing-methods/optimize.md`](../../02-refactoring-techniques/01-composing-methods/optimize.md).

---

## 7. The one where the IDE runs out of road

```java
// You want to rename the column/property `usr_id` -> `userId` everywhere.
@Column(name = "usr_id")
private long usrId;
// plus: native SQL "SELECT usr_id FROM accounts" in three DAOs
// plus: a CSV export header literally "usr_id"
// plus: a JS frontend reading row.usr_id
```

**What the tool can do:** **Rename** (`⇧F6`) the Java field `usrId` → `userId` — and that's *all* it can safely do. The `@Column(name="usr_id")` stays (correctly — it's the DB name), and the SQL strings, CSV header, and JS property are outside the Java binding.

**Where it can't help / what to do instead:**

- The **native SQL** strings, **CSV header**, and **JS** `row.usr_id` are string/cross-language references the IDE can't track.
- This is a **codemod + manual-with-tests** job, not an IDE refactoring: write a targeted transform for the SQL/JS occurrences ([`../02-codemods-and-ast-transforms/optimize.md`](../02-codemods-and-ast-transforms/optimize.md)), and guard the whole change with contract/characterization tests ([`../03-automated-safety-nets/optimize.md`](../03-automated-safety-nets/optimize.md)).
- If the rename actually spans many repos and the column itself, escalate to a planned migration ([`../04-large-scale-automated-migrations/optimize.md`](../04-large-scale-automated-migrations/optimize.md)).

**Lesson:** recognizing *where the AST guarantee ends* is itself an optimization — it stops you from "renaming" with a green build and shipping a broken contract.
