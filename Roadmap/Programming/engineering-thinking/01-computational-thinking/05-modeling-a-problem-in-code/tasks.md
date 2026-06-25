> Hands-on exercises for **modeling a problem in code**. The goal is *representation*, not algorithms — for each task, the deliverable is the data model (types, schema, relationships) and a short justification, not a finished feature. Global constraints: (1) state the dominant operations before choosing a structure; (2) for every model, try to *write down a nonsense value* — if you can, tighten it; (3) prefer making illegal states unrepresentable over runtime validation; (4) name things in the domain's language; (5) for each choice, note one operation it makes easy and one it makes hard. Language is your choice; use whatever expresses sum types and value objects cleanly.

---

## Task 1 — Two models of the same problem, contrasted

Pick a traffic light and model it two ways: (a) a single struct with a `color: str` field and booleans like `is_red`, `is_green`; (b) a sum type `Red | Yellow | Green` where each state carries its own data (e.g. `Red{seconds_remaining}`).

**Deliverable:** both models in code, plus a table listing two illegal values that model (a) permits and model (b) forbids by construction. State which model you'd ship and why.

---

## Task 2 — Pick the representation from the operation set

You're told the dominant operation, and must choose a structure. For each row, name the structure and justify in one line.

| Dominant operation | Your structure |
|---|---|
| "Is user X following user Y?" and "who follows X?" | ? |
| "Give me the next task to run by priority" | ? |
| "What is the org chart under this manager?" | ? |
| "What's the value of cell (row, col), millions of cells, dense?" | ? |
| "Replay everything that happened to this account" | ? |

**Deliverable:** the filled table, plus one operation each choice makes *hard* (the cost of the choice).

---

## Task 3 — Model a permission system

Requirements: subjects (users, and groups that contain users) can perform actions (`read`, `write`, `delete`, `share`) on resources (documents, folders). Folders contain documents and inherit permissions downward. You must answer: "can subject S do action A on resource R?" and "who can write resource R?"

**Deliverable:** a data model (entities + relationships). Explicitly reject the boolean-flags-per-user approach and explain what query it makes impossible. Decide whether this is fundamentally a graph and defend it.

---

## Task 4 — Make illegal states unrepresentable: a payment

Requirements: a payment is either **pending** (has an amount and a created time), **succeeded** (amount, created time, a settlement time, a transaction id), or **failed** (amount, created time, a failure reason code). A succeeded payment always has a transaction id; a failed one never does.

**Deliverable:** a model where it is *impossible* to construct a succeeded payment without a transaction id, or a failed payment with one. Show the type definitions. Then write the signature of a `refund` function that *only accepts a succeeded payment* — so "refunding a pending payment" can't be expressed.

---

## Task 5 — Spot the wrong model

Here is a real-shaped model. Find every modeling defect.

```python
class Booking:
    id: int
    room_name: str          # rooms identified by name
    start: str              # "2026-06-25 14:00"
    end: str
    status: str             # "confirmed" | "cancelled" | "cancelld"
    is_cancelled: bool
    guest_email: str        # the booking is "owned" by this email
```

**Deliverable:** a list of defects (at least five), each with the bug it enables and the fix. Then a corrected model. Hints to check: redundant fact storage, mutable natural keys, string-typed dates, open-vs-closed sets, identity vs. value.

---

## Task 6 — Model a calendar with recurrence

Requirements: events have a title, a start, a duration. Some recur ("every weekday at 09:00", "first Monday monthly"). A single occurrence of a recurring series can be cancelled or moved without affecting the rest. You must answer "what's on my calendar between date A and date B?"

**Deliverable:** a model that separates the **recurrence rule** from its **materialized occurrences**, and represents per-occurrence exceptions. Explain why storing every future occurrence as a row is the wrong model (give the operation that becomes expensive). Sketch how a date-range query expands the rule lazily.

---

## Task 7 — Two indexes for one structure (chess or similar)

Model a chess board so that *both* "what piece is on square (r,c)?" and "where are all the white knights?" are cheap.

**Deliverable:** a model maintaining a primary representation plus a synchronized secondary index, with the `move(from, to)` operation shown updating *both* consistently. Note explicitly what invariant must hold between the two structures and where it's enforced. State the bookkeeping cost you accepted.

---

## Task 8 — Entity or value? Classify and justify

For each concept, decide entity vs. value object and give the one-line test result. Then implement two of them — one entity, one value — with the value object made immutable and equal-by-fields.

`Money` · `BankAccount` · `Color` (RGB) · `Customer` · `Address` · `EmailAddress` · `Order` · `DateRange` · `Coordinate`

**Deliverable:** the classification table plus the two implementations. For one item, argue why it could *legitimately* be either depending on context.

---

## Task 9 — Impedance mismatch round-trip

Take your sum-type payment model from Task 4. Now define how it maps to (a) a single SQL table and (b) a JSON wire format, both of which are flat and can't express a tagged union directly.

**Deliverable:** the SQL `CREATE TABLE` (note which columns are nullable and why), the JSON shape, and the rule for reconstructing the sum type from a flat row. Identify the one place the flat shape re-admits an illegal state, and say where your loading code re-establishes the invariant.

---

## Task 10 — Open vs. closed set

You must model `notification_channel`. Today the channels are email, SMS, push. Tomorrow, marketing wants WhatsApp, then Slack, then a partner webhook.

**Deliverable:** decide whether this set is open or closed, and model it accordingly. Show what a new channel costs in your model (schema migration + deploy? or a row insert?). Contrast with `day_of_week`, which you should model as the *opposite* kind — explain why adding a day should be a loud, schema-level event but adding a channel should not.

---

## Task 11 — Plan an expand/contract migration

You inherited the broken `Booking` model from Task 5 (string dates, mutable email key, redundant cancel fields), live in production with ten million rows and three consuming services.

**Deliverable:** a five-step expand/contract migration plan (expand → dual-write → backfill → migrate reads with shadow comparison → contract) for moving `room_name` → stable `room_id` and the date strings → proper timestamps. For each step note what could break and how you'd verify before proceeding. State why you can't "just change the schema."

---

## Task 12 — State vs. event model, with a decision

Model a bank account balance two ways: (a) state-oriented — a single `balance` you update in place; (b) event-oriented — an append-only log of `Deposited`/`Withdrew` events folded into a balance.

**Deliverable:** both models, plus a decision table comparing them on: "current balance?", "full transaction history?", "audit/dispute a charge", "add a new monthly-statement view later", operational complexity, and cost of a wrong schema. State which you'd choose for a regulated bank vs. a hobby expense tracker, and why event schemas deserve extra scrutiny.

---

**See also:** [Modeling — junior](./junior.md) · [Modeling — middle](./middle.md) · [Modeling — senior](./senior.md) · [Algorithmic thinking](../04-algorithmic-thinking/) · [Domain modeling from requirements](../../08-object-thinking/06-domain-modeling-from-requirements/) · [Roadmap home](../../README.md)
