# Tell, Don't Ask — Interview

> Common questions, traps, and follow-ups for Tell-Don't-Ask. Each answer is short on purpose — interview answers are about precision, not length. The Java snippets use realistic domains (orders, loans, refunds, claims) so they map to what you would actually argue about on a team.

---

## Q1. What is Tell-Don't-Ask, and why is it useful?

Tell-Don't-Ask is the rule that you should send an object a message describing **what you want done**, rather than pulling out its data, making the decision in the caller, and writing the answer back.
The value of doing this is that the rule lives in exactly one place — next to the data it operates on — so when policy changes you have one file to edit instead of every caller.
It also closes the gap where two callers implement the same "if-balance-then-deduct" sequence slightly differently and quietly diverge over months.
In Java specifically, it lets you make state `private` for real, because the only legal way to mutate it is through methods that already enforce invariants.
Finally, it makes concurrency tractable: an `account.withdraw(amount)` method can synchronize internally or version-check optimistically; an external read-modify-write cannot.

**Trap:** candidates often pitch Tell-Don't-Ask as "no getters" — it is not; it is "no *deciding* from getters".

---

## Q2. Critique this snippet: `if (loan.getStatus() == APPROVED) loan.setStatus(DISBURSED);`

That code has externalized a state transition that the `Loan` should own.
The caller has to know that "APPROVED to DISBURSED" is even a legal move, that no other precondition matters (KYC complete? funds reserved? grace period elapsed?), and that the transition is just a status field flip.
If business adds a new rule — say, disbursement requires a signed mandate — every caller breaks silently, or worse, lets through illegal transitions.
The right call site is `loan.disburse()`; inside, the loan validates its current status, checks every precondition, records a `LoanDisbursed` domain event, and updates the field.
The setter becomes private (or disappears entirely from the public surface), so nobody can short-circuit the rule next sprint.

```java
public void disburse() {
    if (status != APPROVED) throw new IllegalStateException("not approved");
    if (!mandate.isSigned()) throw new MandateMissing();
    this.status = DISBURSED;
    this.disbursedAt = clock.instant();
    events.record(new LoanDisbursed(id, principal));
}
```

**Follow-up:** what stops a second caller from disbursing the same loan twice? (Answer: the `status != APPROVED` guard plus, in a distributed setting, optimistic locking on the row version.)

---

## Q3. Is Tell-Don't-Ask the same as the Law of Demeter?

They are siblings, not twins.
Law of Demeter restricts **who an object may talk to** — only its own fields, its parameters, and objects it just created — and so it bans chains like `order.getCustomer().getAddress().getZip()`.
Tell-Don't-Ask restricts **what shape those calls should have** — verbs that do work, not getters that leak state for outside decisions.
You can violate one without the other: a single-hop `order.getStatus()` followed by an external `if` is a Tell-Don't-Ask violation but not a Demeter violation, because there is no chain.
Conversely, `customer.getAccount().freeze()` chains through an intermediate getter and breaks Demeter, but the final call is still a verb so Tell-Don't-Ask is mostly satisfied.
In practice the worst smells violate both at once, which is why people conflate them — but in a code review you want the vocabulary to point at the actual axis that's wrong.

**Trap:** saying "they're the same thing" loses you points; the interviewer wants to see you can separate axes of design.

---

## Q4. How does Tell-Don't-Ask overlap with Command-Query Separation?

CQS says a method either changes state (command) or returns a value (query), never both.
Tell-Don't-Ask says decisions live inside the object whose state they operate on.
They reinforce each other: a Tell-style API naturally splits into commands (`order.cancel()`, `loan.disburse()`) and queries (`order.total()`, `loan.outstandingPrincipal()`), and each method has one job.
Where they differ: CQS is happy with `cart.getItems()` as long as it has no side effects; Tell-Don't-Ask is unhappy with it because the caller will use those items to *decide* something the cart should decide.
So CQS is a structural rule about return types and side effects, while Tell-Don't-Ask is a semantic rule about where decisions live — they cut the same code at different angles.

**Follow-up:** name a method that violates both — `boolean tryWithdraw(BigDecimal amt)` that mutates state and returns success is a command-with-return (CQS violation) and forces the caller to handle the decision branch externally (Tell-Don't-Ask violation).

---

## Q5. When is "asking" legitimate?

Three places, and only three.
**Read models and view DTOs**: a refund-history page needs to display amounts, dates, and statuses — that's reading for showing, not for deciding, so getters are fine.
**Telemetry and logging**: a metrics exporter asks for `order.id()` and `order.totalCents()` to publish, with no decision attached to the value — the value just flows out to a sink.
**Coordination at the application-service layer**: a saga or use-case orchestrator may legitimately query one aggregate to know which other aggregate to message — though even then the orchestrator should call domain verbs on each aggregate, not flip fields.
The unifying test is: does the caller use the value to *decide* something the queried object could decide itself? If yes, refactor. If no, the getter is fine.

**Trap:** newcomers refactor view-layer code into "telling" style and end up with `report.renderToHtml(writer)` methods on domain entities — that's worse, not better, because rendering now lives in the domain.

---

## Q6. Walk me through refactoring `a.getB().getC().doSomething(x)`.

First, name the intent at the top of the chain — not "set C's field" but the business verb, e.g. `a.applyDiscount(x)`.
Second, push the call one hop in: give `A` a method `applyDiscount` that forwards to `b.applyDiscount(x)`; give `B` a method that forwards to its `C` if appropriate.
Third, look for whether any of those hops can collapse — sometimes `C` was a value object that didn't deserve its own indirection, and the logic merges into `B`.
Fourth, make the intermediate getters package-private or private now that nobody outside the chain needs them, and lock the door behind you.
Finally, write a test that calls only `a.applyDiscount(x)` and asserts the resulting observable behavior — if you find yourself reaching into `a.getB().getC()` in the test, the refactor isn't done.

```java
// before
order.getInvoice().getLineItems().get(0).setDiscount(percent);
// after
order.applyLineDiscount(lineId, percent);
```

**Follow-up:** what if `B` and `C` come from a third-party library you can't change? (Answer: wrap them in your own type and put the verb on the wrapper.)

---

## Q7. How does Tell-Don't-Ask change how you write tests?

Tests get smaller and more behavioral.
With ask-style code, tests look like "set up object with field X=5, call procedure, assert field Y=7" — you're testing the procedure, not the object.
With tell-style code, tests look like "create order, call `order.cancel()`, assert `order.status() == CANCELLED` and that a `RefundIssued` event was recorded" — you're testing a verb against its observable outcomes.
You stop needing to mock the object under test (because you stopped pulling pieces out of it) and you mock collaborators only at real boundaries (a `PaymentGateway`, a `ClaimRegistry`, a clock).
The classic symptom of ask-style tests is mocks that return getters which feed into more mocks; tell-style tests usually use real domain objects and stub only ports.

**Trap:** if your test asserts on values pulled through several getters, the production code probably also pulls through several getters — the test is a mirror of the smell.

---

## Q8. What are the trade-offs against functional or data-oriented styles?

Functional programming separates data from behavior on purpose: immutable records flow through pure functions, and there is no shared mutable state to protect.
In that world, "tell don't ask" is moot — you don't mutate anything, so there is no "ask the balance and write it back" temptation in the first place.
Data-oriented design takes that further for performance: keep data dumb (structs/records), put logic in stateless services, and you win cache locality and serialization simplicity at the cost of scattered behavior.
Tell-Don't-Ask is most valuable in classical OOP with mutable aggregates where invariants are non-trivial — loans, orders, claims, accounts — because the invariants are exactly what would otherwise leak into callers.
It is least valuable for pure-data layers like DTOs, configuration objects, and wire protocols, where adding methods clutters the contract; the honest answer is "apply Tell-Don't-Ask to domain objects, not to data objects, and don't apologize for the distinction".

**Follow-up:** would you put behavior on a Java `record`? (Answer: yes for small invariants like `Money.add(Money)`, no for cross-aggregate orchestration.)

---

## Q9. Critique this "telling" method.

```java
public void processClaim(Adjuster a, Policy p, Payout pay, Notifier n, Audit aud) {
    if (this.status != FILED) throw new IllegalStateException();
    a.assign(this); p.validate(this); pay.issue(this); n.notify(this); aud.log(this);
    this.status = CLOSED;
}
```

This looks Tell-style but is actually a god method.
It tells one thing (`processClaim`) but internally choreographs five collaborators in a fixed order — the claim has become an orchestrator that pretends to be an aggregate.
The smells: too many parameters, all of them ports; a fixed sequence with no clear ownership of failure semantics; and `status = CLOSED` even if `pay.issue` threw asynchronously or `n.notify` silently failed.
The right shape is a use-case service (`ProcessClaimUseCase`) that calls a few small domain verbs: `claim.markUnderReview()`, `policy.validateAgainst(claim)`, `payout.issueFor(claim)`.
The aggregate owns *its own* state transitions and only those; the use-case owns *cross-aggregate* sequencing and failure handling.

**Trap:** "Tell don't ask" does not mean "every workflow becomes a fat method on one entity". Coherence of responsibility matters more than verb count.

---

## Q10. How does Tell-Don't-Ask interact with JPA / Hibernate?

Awkwardly, because JPA wants public getters and setters for proxying, dirty-checking, and serialization, while Tell-Don't-Ask wants them gone.
Three practical adjustments work in real codebases.
First, keep setters package-private or `protected` — JPA's reflection can still see them, but external callers in other packages cannot, so the public surface stays verb-only.
Second, write your domain verbs (`order.ship()`, `loan.disburse()`) as the only public mutators, and let them call the protected setters internally if they must.
Third, beware of lazy-loaded associations: a chain like `order.getCustomer().getAddress().getCountry()` may issue three SQL queries you didn't expect — this is both a Demeter and a Tell-Don't-Ask smell with a database bill attached.
Some teams use a separate persistence model (entities the ORM maps to) from a domain model (rich aggregates), but that's heavyweight; most teams just discipline access via package boundaries and lint rules.

**Follow-up:** how do you stop a colleague from adding a public setter "just for this one mapper"? (Answer: code review plus ArchUnit rules forbidding public setters on `@Entity` classes.)

---

## Q11. How can Tell-Don't-Ask discipline help you avoid N+1 queries?

The N+1 problem usually arrives wearing an "ask" costume: a caller loops over orders, asks each one for its customer, asks each customer for an address, and triggers a SQL per hop.
When you push the decision inside — say, `orderRepository.findOrdersWithCustomerAndAddress()` returns a fully fetched aggregate, and the caller just says `orders.forEach(o -> o.notifyCustomer())` — the lazy-loading trap disappears because there is no external traversal at all.
Telling style forces you to declare upfront *what work you want done* and *which data is needed*, so the repository and the entity can plan one efficient fetch instead of being trickled requests through getters.
It doesn't fix N+1 by itself — you still need the right fetch plan — but it removes the structural shape that causes it and makes the bug findable in code review rather than in a Datadog flamegraph.
A useful heuristic: if a service method's body is mostly getter chains, you have ask-style code and probably an N+1 hiding in it.

**Trap:** the symptom is slow endpoints, but the root cause is "ask-style" data traversal in a service layer — fixing query plans without fixing the access pattern only buys time.

---

## Q12. Design a `LoanApplication.disburse(...)` flow in telling style.

The application service receives a `DisburseLoanCommand`, loads the `LoanApplication` aggregate from its repository, and calls `application.disburse(disbursementAccount, clock)`.
Inside that method the aggregate checks status (`APPROVED`), confirms KYC, confirms the mandate matches the target IBAN, computes the disbursement amount, records a `LoanDisbursed` domain event, and flips its status to `DISBURSED` — all atomically, all under the aggregate's own invariants.
The repository persists the new state and the recorded events in the same transaction; an event handler outside the aggregate listens to `LoanDisbursed` and tells the ledger to post the transfer.
The aggregate knows nothing about ledger plumbing, retry policies, or downstream notifications — it only knows what it means for a loan to be disbursed in domain terms.
This is the canonical telling shape for a domain transaction: thin use-case, fat aggregate verb, side effects via events.

```java
public void disburse(BankAccount target, Clock clock) {
    if (status != APPROVED) throw new IllegalStateException("not approved");
    if (!kyc.isComplete()) throw new KycIncomplete();
    if (!mandate.isSignedFor(target)) throw new MandateMismatch();
    this.disbursedAt = clock.instant();
    this.status = DISBURSED;
    events.record(new LoanDisbursed(id, principal, target.iban(), disbursedAt));
}
```

**Follow-up:** where does the actual money movement happen? (Answer: in a listener for `LoanDisbursed`, calling a `LedgerPort.transfer(...)` — not inside the aggregate, which knows nothing about ledger plumbing.)

---

## Q13. "Should I just delete every getter in my codebase?"

No, and that's the wrong frame.
Getters that expose **identity, computed answers, or display values** are fine: `order.id()`, `order.total()`, `loan.outstandingPrincipal()`, `claim.summary()`.
Getters that expose **raw internal state to a caller who will then decide** are the smell: `order.getInternalLines()`, `loan.getStatusField()`, `claim.getRawHistory()`.
The honest rule is "make state private; expose verbs and computed answers; if you must expose raw state, do it through a method named for the consumer (`order.toReceiptView()`) so abuse stands out in review".
You can quantify progress with ArchUnit or a custom check that flags `public set...` on `@Entity` classes — but don't fetishize the count, because what matters is whether decisions live in the right place, not whether a particular keyword appears.

**Trap:** zealously stripping getters often breaks Jackson serialization, JPA, MapStruct, and IDE inspections; pick the boundary (domain layer) where the rule actually matters and leave DTOs alone.

---

## Q14. Pattern matching on sealed types vs asking — when is each appropriate?

Both inspect "what kind of thing is this?" but for different ends.
Asking inside the caller (`if (order.getStatus() == PAID) ...`) is wrong when the next step is to mutate the order, because that decision belongs to the order itself and there will eventually be a second precondition the caller forgets.
Pattern matching is appropriate when the decision belongs to **the consumer**, not the value — e.g., a UI router rendering different cards per `RefundOutcome` subtype, or a serializer choosing a JSON shape per `Event` variant at the API boundary.
Sealed types give you exhaustive `switch` so the compiler enforces all cases, which is a real win for *external* dispatch where adding a variant should force every adapter to update.
Inside the domain, prefer polymorphism (`refundOutcome.apply()`) so the variant carries its own behavior; outside the domain, prefer pattern matching when the caller's job is to fan out across known kinds.

```java
return switch (outcome) {
    case Approved a -> Response.ok(a.amount());
    case Declined d -> Response.unprocessable(d.reason());
    case Pending  p -> Response.accepted(p.estimatedAt());
};
```

**Follow-up:** wouldn't `outcome.toResponse()` be better? (Answer: only if `Response` belongs in the domain; if it's an HTTP detail, keep the `switch` at the adapter boundary so the domain doesn't depend on Jakarta types.)

---

## Q15. What's the single best heuristic for spotting an "ask" smell during code review?

Look for the shape `x.getY()` appearing inside an `if`, a loop condition, or a ternary, where the same `x` is mutated in the body of that block.
That shape — read state of object, branch on it, write state of same object — is almost always a missed verb on `x`, and folding it into one method is usually a five-minute refactor with a unit test for free.
Other strong signals: chained getters before a setter, identical `if (...)` blocks scattered across several callers (a flagrant violation that policy lives outside), and tests that assert on three or more getters of the same object after one procedure call.
None of these are absolute proofs on their own — sometimes the `if` is genuinely a view-layer guard — but together they're a reliable smell that earns a comment in review.
The faster you spot the shape, the cheaper the fix.

**Trap:** don't conflate this with discouraging *all* `if (x.something())` — pure rendering, routing, or telemetry checks are fine; the smell is `read-then-write-same-object`.

---

## Q16. How would you sell Tell-Don't-Ask to a team that pushed back on it as "ceremony"?

Lead with the bug, not the principle.
Show one production incident where a rule lived in three callers and one of them forgot to update — a refund that processed twice, an order that shipped without payment, a loan that disbursed before mandate signing — and walk through the post-mortem.
Then show the same logic consolidated as a single verb on the aggregate, with a unit test that pins the rule, and demonstrate that the bug would have been impossible.
The argument isn't aesthetic ("cleaner code"); it's economic ("one place to change, one place to test, fewer bugs of this shape, smaller blast radius when policy changes").
If the team still resists, propose it as a *boundary rule* — apply it to the domain package only, leave DTOs and adapters alone — and measure incident frequency over a quarter; principles that pay for themselves in fewer pages get adopted, while principles defended on taste don't.

**Follow-up:** what if profiling shows the extra method calls are a hot path? (Answer: hot-path code can break the rule deliberately; the JIT usually inlines anyway, but measure before claiming.)

---

## Q17. When does Tell-Don't-Ask conflict with serialization frameworks?

Frequently, and the friction is real.
Jackson, MapStruct, Gson, and most JSON binders work by reflecting over getters or by invoking a no-arg constructor and then calling setters — both of which assume the very access pattern Tell-Don't-Ask is trying to remove.
The pragmatic answer is to separate two concerns: a rich domain aggregate with verbs and private state, and a flat DTO (or a Java `record`) used purely for wire format.
A mapper translates between them at the adapter boundary, so the domain never has a public setter to satisfy a framework.
This costs a little code but pays back the first time a malicious or malformed payload tries to put your order into an impossible state via `setStatus` — the DTO has no `setStatus` to call, and the mapper invokes a verb that validates.

**Trap:** sharing one class between "domain" and "wire" usually starts cheap and becomes the source of every "how did this enter that state?" bug a year later.

---

## Q18. Closing question — what's the limit of Tell-Don't-Ask?

It's a heuristic, not a law, and it has two clear limits.
First, it presumes objects that own non-trivial invariants; for pure data carriers (DTOs, configuration, wire envelopes) there are no invariants to protect, so adding verbs is pure ceremony and you should leave them as `record`s with getters.
Second, it presumes a mostly-mutable OO style; in a functional or persistent-data-structure codebase, you express the same idea differently — pure functions over immutable values — and arguing about "tell vs ask" misses the model entirely.
Inside its sweet spot — classical OOP domain models with state transitions, business rules, and audit needs — Tell-Don't-Ask is one of the highest-leverage rules you can apply, because it consolidates rules next to data and shrinks the surface area for bugs.
The mature stance is to apply it where it pays, name it when you violate it deliberately, and not turn it into a religion.

**Follow-up:** can you name a case where you intentionally broke Tell-Don't-Ask and were right to do so? (Honest answers: read models, performance-critical hot paths, framework integration boundaries, and exploratory prototypes.)

---

## Q19. How do you reconcile Tell-Don't-Ask with builder patterns?

Builders are construction-time tools, not run-time tools, and that distinction defuses most of the apparent conflict.
A builder like `Order.builder().customer(c).line(l1).line(l2).build()` accumulates fields and then hands you a fully constructed, invariant-satisfying object — at that point, the object exposes verbs (`order.place()`, `order.cancel()`), not setters.
Tell-Don't-Ask is about run-time behavior, so a builder's chained setters are fine because they're not deciding anything; they're describing the inputs.
The smell would be a builder method like `.statusIfPaid(PAID)` that branches on inputs — that's a decision sneaking back into the assembly step.
A clean rule: builders are allowed to take inputs, never to make policy decisions; once `build()` returns, the only public surface is verbs and queries.

**Trap:** "fluent" mutator chains like `order.withStatus(PAID).withTotal(...)` masquerading as builders re-introduce ask-style mutation at run time — that's not a builder, that's a setter convoy.

---

## Q20. How would you teach Tell-Don't-Ask to a junior on your team in five minutes?

Skip the principle name and start with one painful snippet from their own code — something like `if (account.getBalance() >= amount) account.setBalance(account.getBalance() - amount);` — and walk through three concrete consequences they can verify themselves.
First: ask them what happens if a second caller forgets the `if` (overdraft); show that the rule lives outside the account so duplication is inevitable.
Second: ask what happens if business adds a `<= dailyLimit` rule next month (every caller has to be updated, some will be missed).
Third: ask what happens if two threads run the snippet at once (lost update — they can write a 10-line `ExecutorService` test that demonstrates it).
Then show `account.withdraw(amount)` and let them feel the relief: one place to fix, one place to test, one place to lock. They'll remember the lesson because they saw the bug, not because they read a slogan.

**Follow-up:** how do you make sure they actually apply it in their next PR? (Answer: pair on the first refactor, add an ArchUnit rule that flags `public set...` on domain entities, and review for the shape in every PR for a month.)

---

## Quick reference — what interviewers listen for

A short checklist of phrases and ideas that signal you've internalized the rule, not just memorized the slogan:

- "Decisions live where the data lives" — captures the *why* in one sentence.
- "Getters are for showing, not deciding" — captures the *limit* in one sentence.
- "Tell-Don't-Ask and Law of Demeter are siblings, not twins" — shows you can separate axes.
- "Apply it to domain objects, not data objects" — shows pragmatism about scope.
- "Show the bug, not the principle" — shows you can advocate without preaching.
- "Aggregate verbs, use-case orchestration" — shows you know where the rule's seam is.
- "Events for cross-aggregate side effects" — shows you know the escape valve.
- "ArchUnit rules forbid public setters on `@Entity`" — shows mechanical enforcement.

If you can fluently move between these phrases and back them with one realistic Java example each — orders, loans, refunds, claims — you'll come across as someone who has shipped code under the rule, not someone who just read a chapter about it.

**Final trap:** if asked "is Tell-Don't-Ask always right?", the wrong answer is "yes"; the right answer is "no — it's a heuristic for domain objects with invariants, and I deliberately break it for read models, framework boundaries, and hot paths".
