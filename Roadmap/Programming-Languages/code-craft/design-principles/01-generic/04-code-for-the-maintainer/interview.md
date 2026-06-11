# Code For The Maintainer — Interview Questions

> **Category:** [Design Principles](../../README.md) — write code for the human who will have to read, debug, and change it later — often a future you, at 3 a.m., during an incident, with none of the context you have right now.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What does "code for the maintainer" mean?

**Answer:** Write code primarily for the human who will read, debug, and change it later — usually future-you, often the on-call engineer at 3 a.m. with none of your current context — not for the compiler and not to show off. Optimize for readability and debuggability.

### J2. Who is "the maintainer," and what context do they have?

**Answer:** Whoever reads, debugs, and changes the code later. Crucially, they have **none** of the context you have now — they get only the code on the screen (and a stack trace, if lucky), often under incident pressure. The maintainer is frequently future-you, who has forgotten everything.

### J3. Why optimize for reading over writing?

**Answer:** Code is read far more often than it's written — during reviews, debugging, feature work, and incidents. A trick that saves a minute writing but costs a minute on every read loses after the second read. This is the reader-to-writer ratio.

### J4. Quote a famous framing of this principle.

**Answer:** Knuth: "Programs are meant to be read by humans and only incidentally for computers to execute." Or the humorous one (John Woods): "Always code as if the person who ends up maintaining your code is a violent psychopath who knows where you live."

### J5. What's the difference between a WHY comment and a WHAT comment?

**Answer:** A WHAT comment restates what the code literally does (`// increment i`) — redundant and rots. A WHY comment records a *reason* the reader couldn't guess: a trade-off, a gotcha, a workaround ("cap at 99999 because Stripe rejects larger amounts"). Keep WHY; delete WHAT and improve the code instead.

### J6. What makes an error message debuggable?

**Answer:** It names *what* failed, includes the *offending data* (which order, which user), and ideally suggests the *likely cause or next step* — and uses a specific error type, not a bare `Exception`. `raise Exception("error")` teaches the maintainer nothing.

### J7. Why is silently swallowing an exception harmful?

**Answer:** It hides the failure and moves the symptom far from the cause — the bug surfaces elsewhere, later, with no log or stack trace at the real source. It turns a five-minute fix into a multi-day mystery. Fail loudly with context, or degrade *visibly* (logged + alerted).

### J8. What is the Principle of Least Astonishment?

**Answer:** Code should behave the way a competent reader expects; surprises are latent bugs. Example: a `getNextId()` that secretly mutates the counter — a "get" the reader trusts to be read-only but isn't. Fix it by naming it for what it does (`allocateNextId`).

### J9. Give three concrete practices that serve the maintainer.

**Answer:** (Any three) Clear intention-revealing names; obvious over clever code; explicit over implicit; small functions; WHY-comments; debuggable error messages; logs with identifiers; fail loudly with context; follow Least Astonishment.

### J10. Is "code for the maintainer" the same as "comment everything"?

**Answer:** No. Over-commenting is a liability — comments rot and start to lie. The best clarity comes from names and structure; reserve comments for the WHY the code can't express.

---

## Middle Questions

### M1. Express the lifetime cost of a line of code, and say what dominates.

**Answer:** `total ≈ write_cost + read_cost × number_of_reads`. The `read_cost × number_of_reads` term dominates because code is read many times and written once. So lowering write cost by raising read cost is almost always a net loss.

### M2. Roughly what share of software cost is maintenance, and how should you cite it?

**Answer:** Commonly estimated at ~60–80% of total lifecycle cost — but cite it as a rough *industry estimate*, not a precise law (it varies by system and study). The robust, uncontroversial point is the *direction*: most cost is spent after first ship, on reading and changing the code.

### M3. Distinguish "complex" code from "clever" code. Which does the principle target?

**Answer:** *Complex* code is hard because the **problem** is hard (essential difficulty). *Clever* code is hard because the **author** chose to make it hard — a trick where plain code would do (accidental difficulty). The principle targets *clever* code; complex code you make maintainable (clear name, docstring, invariants), you don't pretend away.

### M4. Why is clever code a liability, per Kernighan?

**Answer:** "Debugging is twice as hard as writing the program. So if you're as clever as you can be when you write it, how will you ever debug it?" Clever code you can barely write, you cannot debug — and neither can your maintainer, especially under incident pressure.

### M5. What is debuggability, and what are its pillars at code scale?

**Answer:** The property that a maintainer can answer "what happened and why?" quickly from existing evidence. Pillars: good stack traces (preserve the cause via exception chaining), structured logs (with identifiers to correlate), and invariant checks/assertions (fail at the source, not downstream).

### M6. Why is an invariant check a debuggability tool?

**Answer:** It makes a violation fail *at the moment it happens*, with the offending value in hand — so the stack trace points at the real cause instead of some distant module where the corrupt state finally exploded. It converts a far-away mystery into a local, obvious failure.

### M7. When is terse code clearer than verbose code, and when worse?

**Answer:** Terse is clearer when it uses an idiom a competent reader **recognizes instantly** (a list comprehension, a `reduce`) — recognition. It's worse when the reader must **mentally execute** it line by line to understand it — simulation. The dividing line is recognition vs. simulation. The target is the *competent* reader, not a novice.

### M8. How do you keep a clever, fast hot path maintainable?

**Answer:** (1) Write the clear version first and ship it unless measured slow; (2) optimize only the *measured* hot path; (3) *heavily comment* the trick — the measurement, what it does, the invariant callers must keep; (4) *isolate* it behind a clear function so call sites stay readable. Cleverness is earned by measurement and paid for by comments.

---

## Senior Questions

### S1. How do you reason about maintainability at the architecture level?

**Answer:** Treat it as a first-class *quality attribute* (like performance or availability) and decompose it into things you can design for: **analyzability** (observability, errors, invariants), **modifiability** (low coupling, stable interfaces), **testability** (seams, DI), **understandability** (naming, consistency, docs). It's not "is this function clear" but "can a team operate, debug, and change this system over years?"

### S2. Why is observability a design-time, not incident-time, concern?

**Answer:** During an outage you can only use the observability you built *before* it — you can't retroactively add logs to past requests. So debuggability becomes an architectural requirement: correlation IDs propagated across every hop, structured logs, symptom-based alerts, preserved causal chains. Designing for the incident *is* coding for the maintainer at system scale.

### S3. What does a correlation ID do for the maintainer?

**Answer:** It's a single identifier threaded from the edge through every service, log line, and trace span, so the on-call engineer can reconstruct *one request's* journey across a fleet of services from evidence alone — `grep R8841` and watch it flow to the failing hop. Without it, distributed logs are the equivalent of an error that just says "error."

### S4. When does maintainability legitimately lose to another concern?

**Answer:** A *measured* hot path (performance), a throwaway spike (time-to-market), a backward-compatibility shim (one-way door), a constant-time crypto comparison (security), or a hard domain constraint (real-time/embedded). The discipline is **containment**: lose it in a small, marked, isolated, commented place — never as diffuse erosion across the codebase.

### S5. How does low coupling relate to "code for the maintainer"?

**Answer:** Maintainability is mostly about *local reasoning* — understanding and changing one part without loading the whole system into your head. Low coupling, high cohesion, stable interfaces, and deletability enable that. No amount of clear naming rescues a tightly-coupled tangle; the lever is structural. (See Minimise Coupling and Optimize for Deletion.)

### S6. How does this principle relate to KISS, PoLA, and naming?

**Answer:** KISS is the *method*, "code for the maintainer" is the *motive* (you keep it simple so the maintainer can understand it). PoLA is the principle applied to *behavior* (astonishing behavior is unmaintainable). Naming is its highest-leverage technique. Most code-level principles are "code for the maintainer" wearing different hats — they all serve one reader.

### S7. Why is "easy to delete" a sign of "easy to maintain"?

**Answer:** Code you can delete without tracing a hundred hidden dependents has a small blast radius — which means low coupling and local reasoning, exactly what lets a maintainer change it confidently. Deletability and maintainability are the same structural property seen from two sides.

---

## Professional Questions

### P1. How do you enforce "code for the maintainer" in code review?

**Answer:** The reviewer *is* the future maintainer — reading without the author's context — so review difficulty directly measures maintainability ("I read this three times" = the maintainer will too). Check names, obvious-over-clever, debuggable errors, no swallowed exceptions, logs with identifiers, WHY-comments, preserved causes, PoLA. Top question: *"Could on-call diagnose this at 3 a.m. from the message, logs, and trace alone?"*

### P2. What metrics actually track maintainability?

**Answer:** Cognitive complexity (SonarQube), **MTTR** (debuggable code is fixed fast — the real production signal), DORA change-failure rate / lead time, error-path quality (are failures logged with context or swallowed?), and bus factor. **Not** cyclomatic-alone (blind to clarity) and **not** coverage that never exercises error paths.

### P3. Why is reporting "cyclomatic complexity dropped" after a clarity refactor a mistake?

**Answer:** A clarity/de-cleverness refactor often leaves branch count unchanged, so cyclomatic doesn't move — quoting it makes the whole report suspect. Report cognitive complexity, MTTR trend, and error-path quality, which actually track the maintainer's experience.

### P4. How do you improve maintainability in a legacy system safely?

**Answer:** (1) Add observability first where it's blind (correlation IDs, structured logs, error context) — immediate payoff, de-risks everything; (2) characterization tests to pin behavior; (3) improve as you touch files (Boy Scout Rule), not a doomed "readability initiative"; (4) quarantine clever code you can't yet remove behind a clear function. Never clean up without tests; never gold-plate the cleanup.

### P5. What debuggability standards do you set for production?

**Answer:** Correlation IDs generated at the edge and propagated through every hop; structured logs (no secrets/PII); symptom-based alerts (page on user-facing error rate / latency SLO, not raw CPU); runbooks linked from alerts; SLOs/error budgets to define "broken"; preserved causal chains. Test: could a *new* on-call engineer diagnose a recent incident from this alone?

### P6. How do you fight the culture that admires cleverness?

**Answer:** Flip the incentive — celebrate the boring, obvious, debuggable PR and the readability cleanup/deletion as senior work; treat the reviewer's difficulty as real data, not an insult; use blameless postmortems that trace long outages to swallowed exceptions or "failed" messages — they convert the team faster than any style guide. Senior engineers must *model* obvious code and good errors.

---

## Coding Tasks

### C1. Rewrite clever code for the maintainer (Python).

**Before** — clever, opaque:

```python
def g(s):
    return [*map(lambda p: (p[0], int(p[1]) * 60 + int(p[2])),
            (x.split(":") for x in s.split(",")))]
```

**After** — obvious, same result:

```python
def parse_lap_times(raw):
    """'alice:1:30,bob:2:05' -> [('alice', 90), ('bob', 125)] (seconds)."""
    laps = []
    for entry in raw.split(","):
        name, minutes, seconds = entry.split(":")
        laps.append((name, int(minutes) * 60 + int(seconds)))
    return laps
```

State the reasoning: cleverness saved the author nothing and taxes every reader; the named, stepwise version is read once and forgotten.

### C2. Make this error message debuggable (Python).

**Before:**

```python
if not order.address:
    raise Exception("Error")
```

**After:**

```python
if not order.address:
    raise MissingShippingAddressError(
        f"Cannot charge order {order.id}: no shipping address. "
        f"Customer {order.customer_id} — likely an incomplete checkout."
    )
```

The fix names *what* failed, *which* order/customer, and the *likely cause* — turning a 30-minute investigation into a 30-second fix. Use a typed exception, not bare `Exception`.

### C3. Fix the swallowed exception (TypeScript).

**Before:**

```typescript
async function getRecs(userId: string) {
  try {
    return await recService.fetch(userId);
  } catch {
    return [];          // silent — hides outages, looks healthy while broken
  }
}
```

**After:**

```typescript
async function getRecs(userId: string, log: Logger): Promise<Rec[]> {
  try {
    return await recService.fetch(userId);
  } catch (cause) {
    log.error("recs fetch failed", { userId, cause });   // visible
    metrics.increment("recs.fallback");                  // alertable
    return [];                                           // degrade DELIBERATELY
  }
}
```

State it: silent fallback hides failures and moves the symptom far from the cause. If you must degrade, do it *visibly* — log with context and emit a metric an alert can fire on.

### C4. Replace a WHAT comment with the right move (Python).

**Before:**

```python
# wait 30 seconds
client.connect(timeout=30)
```

**After:**

```python
# 30s, not the default 5s: this gateway cold-starts and the first call after
# idle can take ~20s. Lowering it caused the 2023-11 timeout storm.
GATEWAY_COLD_START_TIMEOUT = 30
client.connect(timeout=GATEWAY_COLD_START_TIMEOUT)
```

The WHAT comment restated the code and would rot; the named constant carries the value, and the comment now records the *reason* the maintainer needs and couldn't guess.

### C5. Preserve the cause (Python).

**Before** — destroys the root cause:

```python
try:
    rows = db.query(sql)
except DatabaseError:
    raise DataError("query failed")
```

**After** — chains it:

```python
try:
    rows = db.query(sql)
except DatabaseError as e:
    raise DataError(f"loading orders for {customer_id} failed") from e
```

`from e` keeps the original error and stack attached, so the maintainer follows the chain to the real cause instead of seeing a "cleaner" but evidence-free `DataError`.

---

## Trick Questions

### T1. "Code for the maintainer means always write the most verbose, explicit version." True?

**False.** The target is the *competent* reader, not a novice. Idiomatic terseness a competent reader recognizes instantly (a comprehension, a `reduce`) is *clearer* than ceremony-laden verbose code. The enemy is code that requires mental *simulation*, not code that's short.

### T2. "Code for the maintainer means never optimize for performance." Right?

**No.** It means clear-*first*, and optimize only the *measured* hot path — heavily commented and isolated. It never says ignore real, measured performance problems. Maintainability and performance are both quality attributes; trading them *blindly in either direction* is the error.

### T3. "More comments = more maintainable." Agree?

**No.** Comments are a liability by default — they rot, they lie, they add reading load. A *stale* comment is worse than none because the maintainer trusts it and is misled. Hold comments to a high bar (WHY only) and prefer self-explaining code (names, small functions).

### T4. A clarity refactor — will it lower cyclomatic complexity?

**Usually not.** Renaming, flattening, and de-cleverness leave branch count largely unchanged. It lowers *cognitive* complexity and improves MTTR. Quoting cyclomatic complexity to "prove" a readability win is a classic mistake.

### T5. "Returning `[]` (or `null`/`-1`) on error keeps the code clean and safe." Correct?

**Dangerously wrong.** It's a *silent failure* — it hides outages, looks healthy while broken, and moves the symptom far from the cause (the worst thing for a maintainer). Fail loudly with context, or degrade *visibly* (log + metric + alert), never invisibly.

### T6. "I wrote it, so I'm the best judge of whether it's readable." True?

**No** — you're the *worst* judge, because you have all the context and it looks obvious *to you*. The reviewer (or future maintainer) reading without that context is the real signal. "I found this hard to follow" is data, not an insult.

---

## Behavioral Questions

### B1. Tell me about a time a bad error message or log slowed down an incident.

**Sample:** "Our payment service logged just `ERROR: charge failed` — no order id, no gateway code. During a card-network partial outage, on-call spent four hours correlating logs by timestamp. I added structured logging with order/customer/gateway/error-code and correlation IDs from the edge. The next similar outage was diagnosed in eight minutes. The lesson I quote now: the error surface is the maintainer's only tool during an incident."

### B2. Describe code you made clearer and why it mattered.

**Sample:** "A core pricing calc was a dense functional one-liner the author was proud of. A tax-law change came in and three of us spent two days reverse-engineering it before daring to change it — and introduced a regression because we misread it. I rewrote it as named, stepwise code with a WHY-comment on the tax rule. The next change took an hour. Clever code's cost is paid by every future maintainer, under pressure."

### B3. How do you push back on clever code in review?

**Sample:** "Non-confrontationally, about the future reader: 'I had to run this in my head to understand it — could we make the steps explicit?' and 'if this fires at 3 a.m., what does on-call learn from this error?' I frame it around our conventions (no bare errors, cleverness needs a measured-justification comment), so it's a standard, not my taste."

### B4. When did you decide *not* to make code more readable?

**Sample:** "A match-engine inner loop did 50M lookups/sec; the clear `HashSet` version GC-thrashed. I replaced it with a primitive bitset — uglier — but I *contained* it: isolated behind a clear `isMember()` method, commented with the measurement, the invariant it relies on, and an exit condition (revert to HashSet if the data goes sparse). Maintainability lost there deliberately, in a small marked place — not diffusely."

### B5. How do you keep a large codebase debuggable over years?

**Sample:** "Make the maintainer-friendly path the default: ban bare errors and swallowed exceptions in review, thread correlation IDs through every service via middleware, gate on cognitive complexity, and treat stale comments as defects. Culturally, celebrate the boring obvious PR and tie MTTR to maintainability in postmortems — so 'hard to debug' becomes a tracked, owned problem, not an accepted fact of life."

---

## Tips for Answering

1. **Lead with the audience:** code is written for the human maintainer (often future-you, at 3 a.m., no context), not the compiler.
2. **Quote the framings:** Knuth ("read by humans, only incidentally executed") and the "violent psychopath" maxim land well.
3. **Use the economics:** reader-to-writer ratio; maintenance is the majority of cost (cite ~60–80% as an *estimate*).
4. **Nail the comment nuance:** WHY not WHAT; stale comments are worse than none.
5. **Show debuggability depth:** good errors (what + which data + cause), structured logs with identifiers, invariant checks, preserved causes, correlation IDs at system scale.
6. **Distinguish complex from clever** and **recognition from simulation** — these are the senior signals.
7. **Handle the trade-off maturely:** clear-first, optimize only the *measured* hot path, contain the loss; never silent-fail.
8. **For metrics, name cognitive complexity and MTTR**, not cyclomatic-alone.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)
