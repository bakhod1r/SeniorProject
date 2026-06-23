# Anthropomorphism — Practice Tasks

Seven exercises that force you to talk about your objects out loud, then turn the sentences into Java. The grammar is doing the design work; your job is to listen to it.

Rules for every task in this file:

- Write the role-play paragraph *before* you touch the IDE. Paste it into a comment at the top of the class.
- A method name must be pronounceable as a first-person verb the object could say about itself.
- If the only verb you can think of is `process`, `handle`, `manage`, or `execute`, stop and re-read your paragraph — you have the wrong subject.
- No `*Service`, `*Processor`, `*Manager`, `*Helper`, or `*Util` classes are allowed in your solution unless the task explicitly asks for one.

---

## Task 1 — Role-play an anemic invoice

Starting point:

```java
public class Invoice {
    public String customerId;
    public List<LineItem> lines;
    public LocalDate issuedOn;
    public LocalDate dueOn;
    public BigDecimal amountPaid;
}

class InvoiceCalculator {
    BigDecimal totalOf(Invoice i) { /* sums lines */ }
    boolean    isOverdueAsOf(Invoice i, LocalDate when) { /* compares dates */ }
    void       applyPayment(Invoice i, BigDecimal amt) { i.amountPaid = i.amountPaid.add(amt); }
}
```

**Verb list to consider:** total, mark paid, accept payment, declare overdue, refuse over-payment, void.

**Objective.** Produce two deliverables:

1. A 4-6 sentence role-play paragraph spoken in first person as the invoice ("Hi, I am an Invoice. I know who owes me..."). Plain English, no Java.
2. A refactored `Invoice` class whose public methods correspond, one-to-one, with the verbs in your paragraph. `InvoiceCalculator` must not exist in the final code.

**Constraints.**

- Fields become private.
- The method that records a payment must refuse a payment larger than the unpaid balance (your paragraph must mention this refusal).
- `isOverdueAsOf` must read as "am I overdue as of…" — pick a name that sounds like the invoice answering the question itself.

**Acceptance.** Read the public method list aloud, prefixed by "I ". Every sentence must be grammatical English and describe something an invoice plausibly does. If any method requires "the system" or "the processor" to be the implicit subject, it is misplaced.

---

## Task 2 — Spot and dismantle the fake agents

Starting snippet (intentionally bad):

```java
public class Document {
    public String title;
    public String body;
    public DocumentStatus status;
    public Instant lastEditedAt;
}

public class DocumentLockManager {
    public void lock(Document d, User u)   { /* sets status, records owner */ }
    public void unlock(Document d, User u) { /* releases */ }
}

public class DocumentPublisher {
    public void publish(Document d) { /* validates and flips status */ }
}

public class DocumentRevisionTracker {
    public void recordEdit(Document d, User u, String newBody) { /* mutates */ }
}
```

**Objective.** List every class whose name ends in `Manager`, `Publisher`, or `Tracker`, and for each one:

1. Identify the verb it claims to perform (`lock`, `publish`, `recordEdit`).
2. Reassign that verb to the most natural domain subject. In all three cases here, the natural subject is the document itself.
3. Produce the new `Document` class with the verbs as methods.

**Constraints.**

- The three "fake agent" classes must vanish from your final code.
- A document may still depend on collaborators (e.g. a `RevisionLog` it owns), but those collaborators are part of the document's identity, not external processors.
- The verbs read in first person: `document.lockFor(user)`, `document.publish()`, `document.editBy(user, newBody)` (or similar — choose names that pass the read-aloud test).

**Acceptance.** Search your final source for the strings `Manager`, `Publisher`, `Tracker`, `Processor`, `Service`. Zero hits. The document API now answers every verb the snippet's old helpers used to handle.

---

## Task 3 — First-person rename

Each line below is a method signature from a real codebase. The method bodies are fine; only the names betray data-first thinking. Rename each one so it reads as a first-person sentence the receiver could say.

```java
// Receiver — current call site                        // Your renamed call site
reservation.setCancelled(true);
ticket.setStatus(TicketStatus.RESOLVED);
package.setDelivered(true, LocalDateTime.now());
poll.setClosed(true);
loan.setApprovedBy(officer);
subscription.setRenewedThrough(nextDate);
draft.setSubmitted(true);
sensor.setAlarmTriggered(true);
session.setExpired(true);
post.setFlaggedBy(user, reason);
```

**Objective.** Replace every `setX(true/false/value)` with a verb the receiver could plausibly utter. Write the resulting call expression and, beside each, the first-person sentence it now reads as.

**Constraints.**

- No method may begin with `set`.
- No method may take a boolean whose only purpose is to choose between two opposite verbs (`setClosed(true)` and `setClosed(false)` should become two methods, e.g. `poll.close()` and `poll.reopen()`).
- Where the old method took a "true" value alongside extra context (`setDelivered(true, time)`), the new name absorbs the boolean into the verb (`package.markDeliveredAt(time)`).

**Acceptance.** Read your ten replacements aloud, each preceded by "I ". They must all be grammatical, none generic.

---

## Task 4 — Design a toll booth from scratch using only the linguistic test

You are designing the software inside a highway toll booth. The booth is unattended. A car drives up; the booth identifies the vehicle class (motorcycle, car, truck), reads the transponder, charges the linked account, raises the gate, and logs the crossing. If the transponder is unknown or the account is empty, it photographs the license plate and queues an invoice.

**Objective.** Submit a design as text only — no implementation. For each object you propose:

- Its name.
- Three lines of first-person prose ("I am a TollBooth. I…").
- Method signatures (parameter types, return types). No bodies.

**Constraints.**

- Minimum three objects, maximum six.
- No object may have a name ending in `Service`, `Manager`, `Controller`, `Processor`, or `Handler`.
- Every method must pass the read-aloud test: speak it as a first-person sentence and it must sound natural.
- Where you are tempted to write a coordinator (e.g. `TollCollectionService.handleCrossing`), instead pick the real subject (the booth, the lane, the gate, the transponder, the account) and give the verb to whichever one would naturally own it.

**Hints (not prescriptive).** Plausible verbs the booth might say: "I greet a vehicle", "I read its transponder", "I charge the linked account", "I raise my gate", "I photograph an offender", "I queue a postal invoice". Plausible verbs the gate might say: "I raise myself", "I lower myself", "I am stuck".

**Acceptance.** A peer reads your three-line paragraphs aloud and cannot, from the prose alone, tell whether the object is "a person doing this job" or "a Java class". If they can, your prose is too data-first.

---

## Task 5 — The trap: do not anthropomorphize a CSV import

A junior on your team has produced this:

```java
public class CsvImporter {
    public void importFile(Path path) { /* opens, parses, dispatches rows */ }
}
```

They have read about anthropomorphism and now want to refactor it into:

```java
public class CsvFile {
    public void readMyself()       { /* opens self */ }
    public void parseMyself()      { /* tokenises */ }
    public void dispatchMyRows()   { /* sends rows to repositories */ }
}
```

**Objective.** Write a 150-200 word explanation of why this refactor is *worse* than the original. Cover specifically:

1. Why "CsvFile" is not a domain agent — what is it actually?
2. Which of the verbs (`readMyself`, `parseMyself`, `dispatchMyRows`) belong to entirely different responsibilities (parser, dispatcher, infrastructure adapter).
3. What the correct shape is: name the *real* domain agents that the rows turn into, and explain that the CSV pipeline is infrastructure that produces them.

Then propose a corrected design where the import code stays procedural (a small, named function or a thin reader class is fine) and the *outputs* — the domain objects parsed from the rows — are the things that get anthropomorphized.

**Constraints.**

- Do not propose a `Row` class with first-person methods. A row is a tuple, not an agent.
- Your explanation must explicitly state the rule: anthropomorphism is for domain objects with invariants and identity, not for pipelines, parsers, or transport.

**Acceptance.** Your write-up makes it impossible for the junior to ever inflict `readMyself` on another class. The corrected design has a plain `CsvOrderReader` (or similar) returning `Stream<Order>`, and `Order` is the anthropomorphized agent — not the file.

---

## Task 6 — Refactor a type-code switch into polymorphic agents

```java
public enum NotificationKind { EMAIL, SMS, PUSH, WEBHOOK }

public record Notification(NotificationKind kind, String recipient, String payload) {}

public class NotificationSender {
    public void send(Notification n) {
        switch (n.kind()) {
            case EMAIL   -> {
                if (!n.recipient().contains("@"))
                    throw new IllegalArgumentException("bad email");
                // SMTP send...
            }
            case SMS     -> {
                if (!n.recipient().matches("\\+?\\d{7,15}"))
                    throw new IllegalArgumentException("bad phone");
                // SMS gateway...
            }
            case PUSH    -> {
                if (n.recipient().length() != 64)
                    throw new IllegalArgumentException("bad device token");
                // push provider...
            }
            case WEBHOOK -> {
                if (!n.recipient().startsWith("https://"))
                    throw new IllegalArgumentException("bad URL");
                // POST...
            }
        }
    }
}
```

**Objective.** Replace the switch with a small hierarchy of objects, each of which "speaks for itself" about how it validates its recipient and delivers its payload.

**Constraints.**

- Use a `sealed interface Notification` with four `record` permits (`EmailNotification`, `SmsNotification`, `PushNotification`, `WebhookNotification`).
- Each record validates its own recipient in a compact constructor.
- Each record exposes a `deliver()` method that does its own send. The interface declares it; the records implement it.
- After refactoring, `NotificationSender` must not switch on a kind, and the `NotificationKind` enum must be deleted.
- Adding a fifth notification type later must require zero modifications to existing types — only adding a new `permits` entry and a new record.

**Acceptance.** Open the refactored code; the word `switch` does not appear in connection with notification kinds. Each record's role-play paragraph fits in two sentences ("I am a PushNotification. I know how to validate a 64-character device token and post myself to the push provider.").

---

## Task 7 — Vending machine: paragraph first, code second

You are designing the controller software for a vending machine. The machine accepts coins and bills, accepts a slot code (e.g. `B4`), checks stock, dispenses the item, returns change, refunds on cancel, and refuses sale on empty slots. It also tracks per-slot inventory so an operator can refill.

**Objective.**

- **Step A (prose).** Write three first-person paragraphs, one per object you intend to model. Suggested objects: `VendingMachine`, `Slot`, `CashDrawer`. You may use different names if your prose is more natural with them. Each paragraph is 3-5 sentences.
- **Step B (signatures).** Translate each paragraph into method signatures only. No bodies. Field declarations are fine.
- **Step C (one method body).** Implement exactly one method end-to-end: `VendingMachine.buy(String slotCode, Money inserted)`. It should orchestrate by *delegating* to the slot and the cash drawer rather than reaching into them.

**Constraints.**

- The `VendingMachine` does not directly mutate a slot's stock count. It asks the slot ("dispense one of yourself") and the slot decides.
- The `CashDrawer` decides whether it can produce the required change; it is not a passive `Map<Coin, Integer>`.
- Every method name must survive the read-aloud test.
- No class named `VendingMachineService`. No class named `Inventory*Manager`. No public setters.

**Acceptance.** A reader who sees only your three prose paragraphs and your signature list (without bodies) can predict roughly what `buy` does. The single implemented method is short (< 20 lines) because most of the logic was pushed down into slots and the cash drawer.

---

## Worked solution sketch — Task 1

**Role-play paragraph.**

> Hi, I am an Invoice. I know who owes me, what each line costs, when I was issued, and when I am due. If you ask me my total, I add up my own lines and tell you. If you offer me a payment, I check whether it exceeds my unpaid balance — if it does, I refuse; if it doesn't, I record it against myself. If you ask me whether I am overdue as of some date, I compare the date to my due date and to how much remains unpaid, and I answer yes or no. I never let anyone set my fields directly.

**Resulting class.**

```java
public final class Invoice {

    private final String customerId;
    private final List<LineItem> lines;
    private final LocalDate issuedOn;
    private final LocalDate dueOn;
    private BigDecimal amountPaid;

    public Invoice(String customerId, List<LineItem> lines,
                   LocalDate issuedOn, LocalDate dueOn) {
        this.customerId = customerId;
        this.lines      = List.copyOf(lines);
        this.issuedOn   = issuedOn;
        this.dueOn      = dueOn;
        this.amountPaid = BigDecimal.ZERO;
    }

    public BigDecimal total() {
        return lines.stream()
                    .map(LineItem::amount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public BigDecimal balance() {
        return total().subtract(amountPaid);
    }

    public void accept(Payment payment) {
        if (payment.amount().compareTo(balance()) > 0) {
            throw new IllegalArgumentException(
                "I will not accept a payment larger than my balance");
        }
        this.amountPaid = this.amountPaid.add(payment.amount());
    }

    public boolean isOverdueAsOf(LocalDate when) {
        return balance().signum() > 0 && when.isAfter(dueOn);
    }
}
```

**Read-aloud check.** "I total myself", "I tell you my balance", "I accept a payment (and refuse if it is too large)", "I tell you whether I am overdue as of a date." Every sentence is grammatical and describes a real invoice behavior. The old `InvoiceCalculator` has vanished.

---

## Validation

| Task | How to verify                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 1    | `InvoiceCalculator` does not exist. All five verbs are methods on `Invoice`.                               |
| 2    | `grep -E "Manager\|Publisher\|Tracker\|Processor\|Service"` against your sources returns zero.            |
| 3    | No method begins with `set`. Each of your ten renames passes the "I ___" read-aloud test.                  |
| 4    | A peer reviews your prose; they cannot distinguish object descriptions from job descriptions.              |
| 5    | The 150-200 word essay states the rule explicitly. `CsvFile.readMyself` is dead in your sketch.            |
| 6    | The token `switch` does not appear in any `Notification`-related file. Adding a 5th type is additive only. |
| 7    | `VendingMachine.buy` is under 20 lines. Stock count is mutated only inside `Slot`.                         |

---

## Anti-patterns to watch for while you work

- **The wrapped procedure.** You rename `processOrder` to `order.process()`. The method still contains five hundred lines of orchestration. Anthropomorphism is in the *responsibility allocation*, not the method name. If your "first-person" method reads someone else's repository, calls a payment gateway, and emits an email, it is still a procedure wearing a costume.
- **The biological reach.** You name methods `breathe`, `sleep`, `awaken` because the prose felt natural in role-play. The point is to name methods after what the domain actually does. If the domain has no equivalent of "sleeping", neither should the API.
- **The pronoun trap.** You write `account.itself()` or `order.me()`. The first-person framing belongs in the *paragraph* you write in English, not in the method names. Method names are still imperative verbs: `account.deposit(...)`, not `account.depositToMyself(...)`.
- **The chatty god.** You give the toll booth thirty methods because, in role-play, you described its whole working day. Anthropomorphism is per responsibility: each verb the booth says aloud either belongs to it, to the gate, or to the lane. Split until the paragraphs are short.

---

**Memorize this**: write the paragraph before the class. Read every method signature aloud preceded by "I ". If the sentence sounds like a person describing their job, the method lives in the right place; if it sounds like a system manual, you have a fake agent and a real agent has gone missing.
