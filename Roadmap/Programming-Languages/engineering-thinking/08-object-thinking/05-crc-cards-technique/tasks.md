# CRC Cards — Tasks

> Work these tasks with a pen and a stack of 4x6 index cards (or sticky notes on a whiteboard). For every task, draw the cards by hand first — do not jump to UML or Java until the cards stabilize. Aim for verbs in the responsibilities column; aim for other card names in the collaborators column.

---

## Task 1 — Identify candidate classes from a paragraph

Read the following requirement once, slowly, and underline every noun that *might* deserve a card. Then prune the list: keep only the nouns that have non-trivial behavior. The deliverable is (a) the raw underlined list, (b) the pruned candidate list with a one-line justification per item, and (c) one card per candidate filled in with name only (no responsibilities yet — that comes in Task 2).

> *Requirement:* "A movie theater lets a customer reserve seats for a specific showing of a film. Each auditorium has a fixed grid of seats. Some seats are wheelchair-accessible. A reservation locks the chosen seats for ten minutes while the customer pays. If payment fails or the timer expires, the seats are released back to the showing. A confirmed reservation prints a ticket with the showing, the auditorium, and the seat numbers."

Fill cards using this template (one per candidate):

```
+-------------------------------------------+
| Class:  ________________                  |
+----------------------+--------------------+
| Responsibilities     | Collaborators      |
+----------------------+--------------------+
|                      |                    |
|                      |                    |
+----------------------+--------------------+
```

**Walk-through scenario:** Read the paragraph out loud once and, for every noun you spot, ask "does this noun *do* anything in the story?" If the answer is no (e.g., "ticket" is just a printout), set the card aside in a "passive" pile. If the answer is yes (e.g., "reservation locks the chosen seats", "timer expires"), keep the card in the active pile.

**Acceptance criteria:**
- [ ] At least 8 nouns underlined in the source paragraph.
- [ ] Pruned list has between 5 and 8 active candidates.
- [ ] Each kept card has a one-line justification ("kept because it ...").
- [ ] Each discarded noun has a one-line reason ("dropped because it is a value / a printout / a synonym for ...").
- [ ] No card contains responsibilities or collaborators yet — name only.

---

## Task 2 — Build the first cards (without scenarios)

A coffee shop runs a loyalty program: every drink purchase earns stars; every tenth star becomes a free drink reward; rewards expire 60 days after they are issued. Customers can check their star balance and redeem rewards at the register.

Draft a first pass of CRC cards — names, responsibilities, and collaborators — *without* running any scenario yet. Then notice which cards you are unsure about and mark each one with a question mark in the corner.

Fill at least four cards using the template below (same shape as the Task 1 template, four responsibility rows):

```
+--------------------------------------------------+
| Class:  ________________                         |
+-------------------------+------------------------+
| Responsibilities        | Collaborators          |
+-------------------------+------------------------+
| -                       |                        |
| -                       |                        |
+-------------------------+------------------------+
```

**Walk-through scenario A:** Speak each card out loud in first person. "I am the LoyaltyAccount. I know how many stars I hold. I add a star when told to. I issue a reward every tenth star." If you cannot say the sentence cleanly, the card is wrong.

**Walk-through scenario B:** Ask a colleague (or a rubber duck) to challenge each responsibility with "why is *that* your job?" If you cannot defend the assignment, move the responsibility to a different card.

**Acceptance criteria:**
- [ ] Minimum 4 cards filled in.
- [ ] Every responsibility starts with a verb in the active voice.
- [ ] No card lists a field (e.g., "id", "stars: int") in the responsibilities column.
- [ ] Every collaborator is a card name from this task — not "database", not "service".
- [ ] Cards you doubt are marked with a question mark.

---

## Task 3 — Walk through a scenario; revise cards

You will design an insurance claim filing flow with CRC. The requirement is short on purpose; the design emerges through walk-through, not through reading more text.

> *Requirement:* "A policyholder files a claim against their auto insurance policy after an accident. The claim includes a description, photos, and an incident date. An adjuster reviews the claim and either approves it (issuing a payout to the policyholder), requests more information, or denies it with a reason."

Draft a first set of cards (5 to 7). Then **walk through the happy path** below, picking up each card as it speaks and revising responsibilities live. Cross out anything that turns out to belong elsewhere. Add cards for missing actors.

**Walk-through scenario A — happy path:**

> *(Hold up Policyholder.)* I file a claim against my policy. I attach a description, three photos, and the date.
>
> *(Hold up Claim.)* I am created with status NEW. I know which Policy I belong to. I hold the description, photos, and incident date.
>
> *(Hold up Adjuster.)* I receive a list of NEW claims. I pick one, review the evidence, and decide. Today I approve.
>
> *(Hold up Claim.)* My status moves from NEW to APPROVED. I record the approving adjuster and the decision date.
>
> *(Hold up Payout.)* I am created with an amount and a recipient (the Policyholder). I am sent to the bank.

**Walk-through scenario B — request more info:**

> *(Hold up Adjuster.)* I cannot decide with the photos I have. I move the Claim to NEEDS_INFO with a note: "send a police report".
>
> *(Hold up Policyholder.)* I am notified. I upload the report.
>
> *(Hold up Claim.)* My status returns to NEW. The Adjuster re-reviews.

After both walk-throughs, **rewrite every card** in fresh ink. Compare the two versions side by side and note (in 2-3 sentences) what changed and why.

**Acceptance criteria:**
- [ ] Before and after photos of the cards exist (or two stacks of cards labeled v1 and v2).
- [ ] At least one card changed between v1 and v2 (added, split, merged, or had a responsibility moved).
- [ ] Status transitions (NEW, NEEDS_INFO, APPROVED, DENIED) are owned by exactly one card.
- [ ] No card is responsible for both "decide outcome" and "record outcome" — split if needed.
- [ ] A short revision note (2-3 sentences) is attached.

---

## Task 4 — Spot a god card; split it

A teammate hands you a single CRC card for a food-delivery dispatch system:

```
+-------------------------------------------------------+
| Class:  Dispatcher                                    |
+-------------------------+-----------------------------+
| Responsibilities        | Collaborators               |
+-------------------------+-----------------------------+
| - accept orders         | Customer                    |
| - validate addresses    | AddressService              |
| - find nearby couriers  | Courier                     |
| - rank couriers by ETA  | Map                         |
| - assign order to       | Courier, Order              |
|   the best courier      |                             |
| - track courier         | Courier, GPS                |
|   location              |                             |
| - notify customer of    | Customer, SMS               |
|   status                |                             |
| - calculate delivery    | Money, PricingRules         |
|   fee                   |                             |
| - record payout to      | Courier, Payout             |
|   courier               |                             |
| - handle cancellations  | Order, Refund               |
| - resolve disputes      | Customer, Courier, Support  |
+-------------------------+-----------------------------+
```

Eleven responsibilities and twelve distinct collaborators on a single card. That is a god class on paper. Your job is to **split it into at least three cards** using one or more of the heuristics in `junior.md` section 6 (by stereotype, by lifecycle stage, by collaborator cluster).

Draw the new cards on the blank-card template from Task 1.

**Walk-through scenario:** A new order arrives at 19:42, gets assigned to a courier at 19:43, the courier picks up at 19:55, drops off at 20:08, and the customer disputes the delivery at 20:30. Walk this timeline with your new cards. If one card has to be held up at every phase of the timeline, it is still too greedy — split again.

**Acceptance criteria:**
- [ ] At least 3 cards replace the original Dispatcher card.
- [ ] No new card has more than 5 responsibilities.
- [ ] Each new card has a name that is a noun (or noun phrase), not a verb.
- [ ] The original 11 responsibilities are *all* present in the new set (none silently dropped).
- [ ] Each split is justified in one sentence ("split by lifecycle: assignment vs tracking vs settlement").

---

## Task 5 — Distinguish responsibilities from data

Someone shows you the following CRC draft for a gym membership system:

```
+-------------------------------------------------+
| Class:  Member                                  |
+-------------------------+-----------------------+
| Responsibilities        | Collaborators         |
+-------------------------+-----------------------+
| - id                    | Database              |
| - name                  |                       |
| - email                 |                       |
| - phone                 |                       |
| - joinDate              |                       |
| - membershipType        |                       |
| - status                |                       |
| - lastCheckInDate       |                       |
+-------------------------+-----------------------+
```

This is a database schema in disguise — every line is a field, not a behavior. Rewrite the card in proper CRC form, then add the other cards the system needs (Membership, CheckIn, Plan, ...).

Use the same blank-card template shown in Task 1 (one card per new class).

**Walk-through scenario:** A member badges in at the door. The turnstile asks "is this member's membership active today?" Walk this question through your cards. If `Member` answers it directly, ask yourself whether `Membership` (the contract) is the better owner. The data ("end date") may live on `Membership`; the responsibility "am I valid today?" lives there too.

**Acceptance criteria:**
- [ ] Zero lines in the Responsibilities column read as a field (no bare nouns like "name", "id").
- [ ] Every former field becomes either a responsibility (verb phrase) on the appropriate card, or disappears because it was just storage.
- [ ] At least 3 cards in the revised set (Member is not allowed to hold everything).
- [ ] Collaborators column never names "Database" or "Repository" — those are infrastructure, not domain collaborators.
- [ ] Each responsibility passes the "say it out loud" test ("I, the Membership, know when I expire").

---

## Task 6 — Translate cards to Java packages and class skeletons

You have stabilized the cards for a warehouse picking system. Suppose the final set is:

```
Class: PickList         Class: PickTask         Class: Picker
  - assemble for         - know which item        - claim next task
    one order              and quantity           - report progress
  - know remaining       - mark fulfilled         - know own location
    tasks                 - know bin location
  - mark complete

Class: Bin              Class: Order
  - know its location     - know its line items
  - hold inventory of     - know shipping
    one SKU                 address
  - decrement stock       - mark ready to ship

Class: ShippingLabel
  - know its order
  - know its tracking number
  - print itself
```

Translate this card set into a Java package layout and class skeletons. Decisions to make: which classes are aggregates, which are value objects, what package each lives in, what visibility each class has. Do **not** implement the methods — only signatures and JavaDoc that cites the card responsibility.

Expected skeleton style:

```java
package com.warehouse.picking;

/**
 * A PickList groups the PickTasks needed to fulfill a single Order.
 * Card responsibilities:
 *  - assemble for one order
 *  - know remaining tasks
 *  - mark complete
 */
public final class PickList {
    private final OrderId orderId;
    private final List<PickTask> remaining;

    public PickList(OrderId orderId, List<PickTask> tasks) { /* ... */ }

    public boolean isComplete() { /* ... */ throw new UnsupportedOperationException(); }
    public Optional<PickTask> nextTask() { /* ... */ throw new UnsupportedOperationException(); }
    public void markFulfilled(PickTaskId id) { /* ... */ throw new UnsupportedOperationException(); }
}
```

Produce one such skeleton **per card** in the set above, plus a one-paragraph note explaining your package choices (e.g., `com.warehouse.picking`, `com.warehouse.shipping`, `com.warehouse.inventory`).

**Walk-through scenario:** Trace the responsibility "I know remaining tasks" from card -> JavaDoc line -> method signature (`Optional<PickTask> nextTask()` or `List<PickTask> remainingTasks()`). Every method you declare must trace back to a card responsibility. If a method has no card line, either add it to the card or drop the method.

**Acceptance criteria:**
- [ ] One Java class per card; same name on card and class.
- [ ] At least 2 packages, chosen by cohesion of cards (not by layer).
- [ ] Every public method has JavaDoc citing the card responsibility it implements.
- [ ] No method exists that does not trace to a card line.
- [ ] Value-object cards (e.g., `ShippingLabel` if treated as immutable) are marked `final` with `private final` fields.
- [ ] No JPA, Spring, or framework imports — pure domain skeletons only.

---

## Task 7 — CRC for legacy refactor (AS-IS and TO-BE)

Below is a god class from a legacy billing system. Your job is to **draw two CRC card stacks**: one for the AS-IS state (a single overloaded class) and one for the TO-BE state (a refactored set of cards). Then propose a step-by-step migration order.

```java
public class BillingManager {
    public void chargeCustomer(long customerId, BigDecimal amount, String currency) { /* ... */ }
    public void refundCustomer(long customerId, BigDecimal amount, String reason) { /* ... */ }
    public Invoice generateInvoice(long customerId, List<LineItem> items) { /* ... */ }
    public void sendInvoiceByEmail(Invoice inv, String email) { /* ... */ }
    public void retryFailedCharges() { /* ... */ }
    public BigDecimal calculateTax(BigDecimal subtotal, String region) { /* ... */ }
    public BigDecimal applyDiscount(BigDecimal subtotal, String couponCode) { /* ... */ }
    public List<Invoice> exportMonthlyReport(YearMonth month) { /* ... */ }
    public void markInvoicePaid(long invoiceId) { /* ... */ }
    public void blockCustomerIfOverdue(long customerId) { /* ... */ }
}
```

**Step 1 — AS-IS card.** Draw a single CRC card called `BillingManager` and list every public method as a responsibility (translated to a verb phrase, not a method signature). Note the collaborators implied by each method.

**Step 2 — TO-BE cards.** Draw at least 4 new cards that, together, cover all the AS-IS responsibilities. Candidate splits to consider:

- `Charge` / `Refund` (transactions)
- `Invoice` / `InvoiceRenderer` / `InvoiceMailer` (document + delivery)
- `TaxCalculator`, `DiscountCalculator` (pricing rules)
- `RetryPolicy` (failed-charge retries)
- `CustomerStatus` (overdue / blocked state)
- `MonthlyReport` (export)

Use the blank-card template from Task 1 for every TO-BE card.

**Step 3 — migration order.** List the refactoring steps in order. Each step must be a non-breaking move (extract method, extract class, move method) that compiles and passes tests. Example: "1. Extract `TaxCalculator` from `calculateTax(...)`. 2. Extract `DiscountCalculator` from `applyDiscount(...)`. ..."

**Walk-through scenario:** Walk through "customer is charged on the first of the month, charge fails, retry on day 3 succeeds, monthly report runs on day 31" using the TO-BE cards. Confirm the responsibility chain is shorter and clearer than the AS-IS card.

**Acceptance criteria:**
- [ ] AS-IS card lists all 10 methods as verb phrases (not signatures).
- [ ] TO-BE set has at least 4 cards; no card holds more than 5 responsibilities.
- [ ] Every AS-IS responsibility is reassigned to exactly one TO-BE card.
- [ ] Migration order has at least 4 steps, each described in one sentence and labelled as extract-method / extract-class / move-method.
- [ ] The walk-through is documented and shows shorter responsibility chains in the TO-BE set.

---

## Worked solution — Task 1 (movie theater seat booking)

Underlined nouns (raw): *theater, customer, seat, showing, film, auditorium, grid, wheelchair-accessible seat, reservation, payment, timer, ticket*.

Pruned candidate list (kept):

- `Showing` — has behavior: holds seat state, releases on expiry. Justified.
- `Auditorium` — knows seat grid, reports accessibility. Justified.
- `Seat` — knows accessibility, knows current status (free / locked / sold). Justified.
- `Reservation` — central actor: locks seats, starts timer, transitions on payment. Justified.
- `Customer` — initiates reservation, completes payment. Justified.
- `Payment` — succeeds or fails; triggers reservation transition. Justified.

Discarded:

- `Theater` — too coarse; really just owns `Auditorium`s and `Showing`s. Drop for now; revisit if needed.
- `Film` — passive metadata (title, runtime). Treat as a value attached to `Showing`.
- `Ticket` — a printout, not an actor. Output of confirmed `Reservation`.
- `Grid` — implementation detail of `Auditorium`'s seat layout.
- `Timer` — mechanism, not domain actor. Likely owned by `Reservation`.

Name-only cards (one per kept candidate, responsibilities filled in Task 2 — not here):

```
+-----------------------+   +-----------------------+   +-----------------------+
| Class: Showing        |   | Class: Auditorium     |   | Class: Seat           |
| Resp.    | Collab.    |   | Resp.    | Collab.    |   | Resp.    | Collab.    |
|          |            |   |          |            |   |          |            |
+-----------------------+   +-----------------------+   +-----------------------+

+-----------------------+   +-----------------------+   +-----------------------+
| Class: Reservation    |   | Class: Customer       |   | Class: Payment        |
| Resp.    | Collab.    |   | Resp.    | Collab.    |   | Resp.    | Collab.    |
|          |            |   |          |            |   |          |            |
+-----------------------+   +-----------------------+   +-----------------------+
```

Six active candidates, five passive nouns dropped with reasons. The list is short enough to fit on the table without crowding and rich enough that a walk-through of "book two adjacent seats for tonight's 8pm showing" will exercise every card.

---

## Done when

- [ ] All seven tasks have been attempted with physical cards (or a virtual whiteboard).
- [ ] At least one task ended with cards being torn up or rewritten — that means revision happened.
- [ ] You can explain, in one sentence per card, why each surviving class earned its place.
- [ ] You did not write Java code before Task 6.
