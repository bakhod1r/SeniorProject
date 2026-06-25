# Questioning Assumptions — Interview

> These questions probe whether you *habitually* surface and test assumptions, or just react to them after they break. Strong answers are concrete: they name a load-bearing assumption, a cheap validation, and the cost asymmetry of being wrong. Weak answers stay abstract ("I always think carefully"). Use real examples — time, names, IDs, scale — because that's where assumptions actually bite.

---

## Q1. What's the difference between an explicit and an implicit assumption?

An **explicit** assumption is written down — a comment, a doc, an `assert`, a precondition — so reviewers can see and challenge it. An **implicit** assumption lives in your head, in a default value, in a type, or in "everyone knows." The danger is entirely in the implicit ones: nobody examines them because nobody sees them.

The core skill of this topic is **moving assumptions from the implicit column to the explicit column** so they can be tested. `int userId` is an implicit assumption that IDs fit in 32 bits; writing it down as "assumes < 2.1B IDs ever" makes it challengeable.

**Follow-up trap:** "Isn't writing every assumption down just noise?" — No; you only make load-bearing ones explicit. Incidental assumptions can stay implicit.

---

## Q2. How do you tell a *load-bearing* assumption from an *incidental* one?

Apply one test: **if this turned out false, would I have to redesign, or just tweak?**

- Redesign → load-bearing → validate *before* building. ("The whole dataset fits in memory.")
- Tweak → incidental → defer. ("Usernames are at most 30 chars" — change one constant.)

You have finite validation budget, so you spend it on load-bearing assumptions with a non-trivial chance of being wrong. The mistake juniors make is validating the cheap, comforting assumptions and skipping the expensive, scary ones — exactly backward.

---

## Q3. Walk me through how you'd surface the hidden assumptions in this requirement: "Email users a daily summary at 9am."

Out loud, I'd list:

1. **9am in whose timezone?** (load-bearing — wrong answer = every user emailed at the wrong time)
2. Every user has an email / wants this email.
3. "Daily" — even on signup day? Once per 24h exactly?
4. The send job finishes before the next day's run.
5. Blasting all users at 9am won't overwhelm the mail provider.

Then I check #1 first: *do we even store per-user timezones?* If we only have UTC, I've found a missing requirement before writing a line. That's the whole move — turn one sentence into a checklist, then validate the load-bearing item cheapest-first.

---

## Q4. Name some techniques for surfacing assumptions and when each fits.

- **Five Whys** (Ohno/Toyota) — walk *down* from a symptom; best for incidents/bugs. Caveat: linear, misses multi-causal failures.
- **"What would have to be true?"** — walk *up* from a plan to its preconditions; best for designs/proposals.
- **Inversion** — ask "what would make this *fail*?" instead of "will it work?"; flips you from confirmation to falsification.
- **Pre-mortem** (Gary Klein) — "it's six months out, this failed badly, why?"; best group technique, because it gives people permission to voice doubts.
- **Assumption-listing before estimation** — state what the estimate assumes; half of blown estimates are one false load-bearing assumption.

**Follow-up:** "Why is a pre-mortem better than a go/no-go meeting?" — Prospective hindsight. People who won't object in a go/no-go will happily explain a failure that already (hypothetically) happened.

---

## Q5. Give a concrete example of a "falsehood programmers believe" and a bug it causes.

**Names:** "every name has a first and last part." `first, last = name.split(" ")` crashes on "Cher" (no space), mishandles "Mary Jane Watson" (three parts), and is culturally wrong where the family name comes first. Patrick McKenzie's "Falsehoods Programmers Believe About Names" catalogs dozens.

**Time:** "the clock only moves forward." NTP can step it backward, so `time.time() - start` can be *negative*, firing timeouts instantly. Fix: use a **monotonic** clock for durations.

The meta-lesson: the categories that *feel* simplest — a name, a moment, an address — hide the most false assumptions.

---

## Q6. Your colleague says "we can't run that report in real time, it takes 40 minutes." How do you respond?

I treat "can't" as an assumption to decompose, not a fact. Inside it are hidden "musts":

1. It *must* be recomputed from scratch — could it be incrementally maintained / a materialized view?
2. It *must* scan all rows — is there a pre-aggregate?
3. It *must* be exact — does the business need exact, or is a 1% approximation fine?
4. It *must* run on the primary — could it use a read replica or column store?

Often two or three of those "musts" are false, and the impossible becomes a materialized view refreshing in seconds. **Inverting** — "suppose we *had* to make it real-time, what would have to be true?" — turns a dead end into a design problem.

---

## Q7. How do you validate an assumption *cheaply* before betting the architecture on it?

Match the cheapest probe to the assumption:

- "Fits in memory / table is small" → a `COUNT(*)` / size query against prod (seconds).
- "New library is fast enough" → a throwaway **spike** benchmark on representative data (~1 hour).
- "Users rarely hit this path" → add a counter, wait a day.
- "IDs fit in int64" → `SELECT MAX(id)` plus growth rate.

The anti-pattern is **validating by building** — spending a sprint on the real implementation to learn the assumption was false. A spike is throwaway *on purpose*; if you're polishing it, you've stopped validating.

**Follow-up trap:** "You tested the migration on 1,000 rows and it worked." — That validates 1,000 clean rows, not 14M dirty ones. Validate on *representative* data including the nasty tail.

---

## Q8. Explain the cost asymmetry that justifies all this effort.

Cost to fix a wrong assumption grows roughly by stage: 1× at design, ~5× in implementation, ~10× in QA, ~100× in a production incident, and effectively unbounded for silent data corruption (the Boehm defect-cost curve, sharper for assumptions). A false *load-bearing* assumption isn't a local bug — it's a wrong premise propagated through everything built on it, so you don't fix it, you unwind it. That asymmetry means even a 10-minute check pays off for a load-bearing assumption with any real chance of being wrong.

---

## Q9. What's Hyrum's Law and how does it relate to assumptions?

> "With a sufficient number of users of an API, all observable behaviors of your system will be depended on by somebody."

It's the assumption problem from the API *provider's* side. You assume your contract is "what I documented"; users have actually built on observable behavior you never promised — map iteration order, error-message text, the incidental fact that results came back sorted. Before changing internals, ask "who assumes the old behavior?" One defense: destroy the false assumption deliberately — e.g., Go randomizes map iteration order so nobody can depend on it.

---

## Q10. Some assumptions can't be cheaply validated up front. What then?

You stop trying to validate and instead **reduce the cost of being wrong**:

- Hide the bet behind an interface so swapping it is a code change, not a rewrite.
- Classify the decision: **two-way door** (reversible) → decide fast; **one-way door** (irreversible) → validate hard.
- **Strangler-fig / canary** it to 1% of traffic — production becomes the validation with a 99% smaller blast radius.
- **Instrument the assumption** with an alert (`alert if max(event_count) > 1M`) so you're told the moment it flips.

For assumptions that are a function of *time or scale*, the deliverable is an **alert, not a one-time check** — because "the table is small" is a snapshot, not a property.

---

## Q11. Describe a real bug you've seen that came down to an unexamined assumption.

*(Have a real story ready.)* Strong structure: **the assumption** ("we assumed event timestamps were monotonic, so we sorted by them"), **how it was hidden** (it was implicit in the sort, never written down), **what made it false** (NTP correction produced out-of-order timestamps), **the cost** (feed showed events in the wrong order, hard to reproduce), and **the fix + lesson** (sort by a monotonic sequence; *added an invariant check* so the assumption is now monitored). Interviewers want the *reconstruction of the buried belief*, not just "there was a sorting bug."

---

## Q12. How would you build a culture where assumptions get surfaced, not hidden?

The blocker is that questioning an assumption feels like criticizing a person. Levers:

- **Blameless postmortems** — name the *assumption* ("we assumed failover was tested"), never the human. Blame teaches people to hide doubts.
- **Require an Assumptions section** in design docs (load-bearing? confidence? monitor?) so doubt is a structured, depersonalized artifact.
- **Pre-mortems** as a gate for big projects.
- **Leaders model it** by questioning their *own* proposals, and **reward the catch** publicly.

What gets celebrated gets repeated; if surfacing a dangerous assumption is rewarded rather than punished, people do it before it bites.

---

## Q13. (Curveball) What assumptions does `for (int i = 0; i < list.size(); i++)` make?

At least: `list` is non-null; it's finite; `size()` fits in `int` (assumes < ~2.1B elements); `size()` is cheap/O(1) (false for some lazy or linked structures — makes the loop O(n²)); the list isn't mutated concurrently during iteration; and that index access is O(1) (false for a linked list — also O(n²)). The interesting answers are the **performance** assumptions (`size()` cost, indexed access cost) and the **concurrency** one, not just null-safety.

---

## Q14. The 2038 problem — what assumption is it, and why does it matter for code written today?

A signed 32-bit Unix timestamp overflows on **2038-01-19 03:14:07 UTC**. The buried assumption is "this representation is wide enough; this code won't run past 2038." For long-lived systems that's *already* false — a 30-year mortgage or bond modeled today matures after the rollover, and embedded devices shipping now will still be running. It's the same family as Y2K: an assumption about *representation* with a quiet expiry date. The general lesson: any fixed-width counter, ID, or timestamp carries an "it'll never get that big" assumption, and the dangerous ones don't come with a known date the way 2038 does.

**Follow-up:** "How would you find these in a codebase?" — Grep for 32-bit time/ID types in schemas, wire formats, and stored data; the migration cost is highest wherever the width is baked into *persisted* data or external contracts.

---

## Q15. How do you allocate a *finite* validation budget across many assumptions?

Rank by `probability-wrong × cost-if-wrong`, then choose a response per item, not a binary check/skip:

- **Load-bearing + cheap →** validate now (and validate against the *tail*, not the mean).
- **Load-bearing + expensive + reversible →** decide fast, but put it behind a seam so swapping is cheap.
- **Load-bearing + expensive + irreversible →** reduce blast radius: canary, alert, contract; validate as hard as the one-way door deserves.
- **Incidental →** note and defer.

The senior signal is talking about *responses* (validate / design-around / monitor / accept) rather than treating every assumption as something to either prove or ignore.

---

## Q16. When is questioning assumptions *not* worth it — can you over-do it?

Yes. Validating *incidental* assumptions, or analysis-paralysis on **two-way-door** decisions, is pure tax — you could have just decided and walked back if wrong. The discipline is *selective*: spend the budget where `probability-wrong × cost-if-wrong` is high and the door is one-way; for everything else, note it and move. Questioning assumptions is a risk-allocation tool, not a mandate to doubt everything equally. The mature failure mode isn't "questioned too few" — it's questioning everything equally and shipping nothing.
