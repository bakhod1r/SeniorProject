# When to Introduce a New Language — Senior

> **What?** The decision framework you actually own as a senior: weighing the one-time *plus recurring* cost of N+1 against a benefit that decays, the slippery slope from one exception to language sprawl, how "temporary" languages become permanent, defining reversibility and exit criteria up front, killing a pilot against sunk-cost pressure, and how language count is bounded by team size.
> **How?** By treating a new language as a long-lived liability on the org's balance sheet, not a line in a sprint; by deciding the exit *before* the entry; and by being the person willing to count to "no" when the team is excited.

---

## 1. The cost is one-time entry plus a perpetual annuity

The middle level itemized the N+1 tax. The senior move is to model it correctly *over time*, because the shape of the cost is what trips up the decision.

A new language has two cost components:

- **One-time entry cost** — porting the few internal libs you need, wiring CI, training the first few people, building the first service. Big, visible, and *finite*. Teams budget for this; it's the number in the proposal.
- **Recurring carry cost** — the perpetual annuity of maintaining a second toolchain, second CI, second observability path, second on-call skill, second security surface, second hiring filter, *forever*. Small per quarter, invisible in any single sprint, and unbounded in total.

The mistake is comparing the *benefit* against the *entry cost* only. The benefit also has a time shape — and it usually **decays**. The performance edge that justified the new language erodes as the old language's runtime improves (the JVM, V8, CPython have all gotten dramatically faster), as your traffic patterns change, as the hot service gets rewritten anyway. Meanwhile the carry cost never decays; it compounds, because every internal-platform improvement now has to be done twice.

> Frame it on the balance sheet: a new language is a small perpetual liability bought with a one-time payment, in exchange for a benefit that is largest on day one and shrinks. The honest question is whether the *net present value* — decaying benefit minus perpetual carry — is positive. Surprisingly often it's negative even when the language is genuinely the better tool.

---

## 2. The slippery slope: one exception becomes sprawl

The most dangerous property of a new-language decision is that it's **precedent-setting**. The instant you approve Go "just for the ingestion service," you've established that the answer *can* be yes, and the next proposal cites yours:

> "We already added Go for ingestion, so adding Rust for the proxy is the same kind of decision."

Each exception is locally defensible. Each one was a real trigger at the time. But there is no natural stopping point — the org slides from "Python shop" to "Python and Go" to "Python, Go, Rust, and a little Scala someone left behind," and now the platform team maintains four paved roads with the headcount for one. Nobody decided to become a four-language org; they got there one defensible exception at a time. This is **death by a thousand reasonable cuts**, and it's the default trajectory unless someone actively resists it.

The senior counter-move is to make the *count* itself a governed quantity, not an emergent one. The question is never just "is this proposal good?" — it's "is this proposal good *enough to push our supported-language count from 2 to 3*, with everything that implies?" The marginal language is almost always harder to justify than the first one, because the fragmentation cost is higher and the road crew is already stretched. (The formal machinery for this — supported-language tiers, an approval process — is the [`professional.md`](./professional.md) topic.)

---

## 3. "Temporary" languages are permanent

Engineers reach for the word "temporary" to lower the bar: *"let's just try Clojure for this one analytics job — it's temporary, we can always remove it."* Treat "temporary" as a red flag, because in practice temporary languages are the most permanent thing in your codebase.

Why they stick:

- **Code outlives intent.** The "temporary" service ships, works, and is forgotten. Nobody schedules its removal because it's not on fire.
- **It accretes dependents.** Other systems start calling it. Now removing it means changing *them* too.
- **The one person who knew the plan leaves.** The "we'll migrate it back next quarter" plan lived in one head. That head is now at another company.
- **Sunk cost protects it.** "We already wrote it, why throw it away?" — the very argument that keeps bad languages alive (more in §5).

The Knight Capital and many "we'll clean it up later" stories share this DNA: temporary became permanent because nothing forced the cleanup. So: **if a language is worth adding, it's worth adding permanently and governing as such. If it's only worth adding "temporarily," it's not worth adding** — because you will not get to remove it on the schedule you imagine. The only genuinely temporary additions are ones with an automatic, enforced expiry (a build flag that fails CI after a date, a service with a scheduled decommission ticket that someone owns).

---

## 4. Reversibility and exit criteria — decided up front, in writing

The single highest-leverage senior discipline here: **define how you'll get out before you go in.** Reversibility is not a property you discover later; it's a property you *design* at entry, and exit criteria you write *before* you've fallen in love with the result.

A real adoption decision ships with an exit clause that answers three things:

```markdown
## Exit criteria for the Go ingestion pilot

### Success — we adopt Go more broadly if, by 2025-04-01, ALL hold:
- [ ] Sustained throughput ≥ 35k events/sec/instance (Python topped out at 8k).
- [ ] Two engineers besides the author can independently ship and debug a change.
- [ ] On-call for this service has not required the author's help for one full rotation.
- [ ] The Go versions of internal-auth and internal-metrics are at parity.

### Failure — we revert to sharded-Python if ANY hold by the same date:
- [ ] Throughput gain < 2× after real optimization (not worth N+1).
- [ ] Bus factor is still 1 (only the author can safely change it).
- [ ] Operational incidents per month exceed the Python baseline.

### Revert plan (designed now, not later):
- The service is behind a network boundary; the Python implementation is kept
  buildable (not deleted) until success criteria are met.
- Reverting means re-pointing the queue consumer; no data migration required.
- Estimated revert effort: 3 engineer-days.
```

Two things make this work. **First, the criteria are numeric and dated** — "it's going well" is not a criterion; "≥ 35k/sec by April 1" is. **Second, the revert plan is designed at entry**, when reversibility is cheap to preserve (keep the old path buildable, use a clean boundary). If you wait until the revert is needed to design it, it's already expensive — the old code rotted, the boundary blurred, dependents accreted.

> The bias-against from the junior level shows up here as: **the pilot's default outcome is revert, not adopt.** Adoption is the thing that has to be *earned* against criteria; reverting is what happens by default if it isn't. Most teams have it backwards — adoption is the default and reverting requires a fight.

---

## 5. Killing a pilot: fighting sunk cost

You will be in this meeting: the pilot didn't clearly clear the bar, but the team spent a quarter on it, the author is invested, and everyone feels the pull to keep it. This is the **sunk-cost trap**, and resisting it is the hardest part of the job.

The discipline: **the money and time already spent on the pilot are gone regardless of what you decide now.** The only question that matters is forward-looking — *from today, is carrying this language worth the perpetual cost, given what we now know?* The quarter you spent is not an asset to protect; it was the price of *information*, and the information might be "no." A pilot that proves a language *doesn't* pay off is a *successful* pilot — it bought you certainty cheaply, before the language metastasized across the org.

What helps you actually pull the trigger:

- **The pre-written exit criteria** (§4). If you agreed in January that "< 2× throughput = revert," and you got 1.6×, the decision was already made by your less-invested past self. Honor it.
- **Separating the person from the work.** The author isn't being told they failed; the *experiment* returned a clear result. Frame it as a win for the rigor, and make sure the author's reputation rises for running a clean experiment, not falls for the outcome.
- **Counting the carry cost out loud.** "Keeping this means a third on-call skill set and a third paved road forever, for a 1.6× win on a non-critical path." Said plainly, the keep decision usually exposes itself.

If you *never* kill a pilot, your exit criteria were theater. A team that can't revert is a team that doesn't really pilot — it just adds languages with extra steps.

---

## 6. Team vs org adoption — two very different decisions

"Should we add this language?" means something completely different depending on the altitude:

| | A **team** adopts it | The **org** adopts it |
|---|---|---|
| Scope | One squad's services | The blessed-language list everyone can use |
| Who carries the tax | That squad, mostly | The central platform/infra team, forever |
| Reversibility | High — one team can revert | Low — once it's org-blessed, services proliferate |
| Right bar | "Worth it for this team's problem" | "Worth it as a paved road for *all* future services" |
| Failure mode | Localized; revertible | Sprawl; near-permanent |

A team adopting a language for an isolated, bounded problem is a reasonably contained bet — the blast radius is one squad, and reversibility can be kept high. The org blessing a language is a *far* heavier decision, because it invites everyone to use it, which means the platform team now owns a second paved road and the language count becomes permanent. **The two must not be conflated.** A common, damaging move is one team's local pilot quietly becoming a de-facto org standard because nobody drew the line — the team's contained bet leaks into an org-wide carry cost without anyone deciding it should. Decide explicitly which one you're approving, and gate org-blessing far more strictly than team-piloting.

---

## 7. Language count is bounded by team size

A hard constraint people wish away: **the number of languages a team can support well is a function of headcount**, because the paved road (build, deploy, internal libs, observability, on-call coverage) needs maintaining *per language*, and that maintenance is a roughly fixed cost the team's size has to absorb.

A rough, deliberately blunt heuristic:

| Team size | Languages it can support *well* |
|---|---|
| 3–5 engineers | 1, maybe 2 if one is forced (e.g. JS for frontend) |
| 10–20 | 2–3 |
| 50+ with a dedicated platform team | 3–4 blessed, with the platform team carrying the roads |
| Google/Meta scale | A *small, deliberately limited* set despite tens of thousands of engineers — *on purpose*, because sprawl scales worse than headcount |

The lesson at the bottom of that table is the loudest: organizations with effectively unlimited engineering headcount *still* limit themselves to a handful of languages. Google's well-known internal policy blesses a small set (C++, Java, Go, Python, plus JS/TS for the web, Kotlin/Swift for mobile) and makes adding to it genuinely hard. If a company with 100,000 engineers concludes that more than a handful of languages is a net loss, your 12-person team certainly can't support four. The constraint isn't talent — it's that **fragmentation costs scale faster than the headcount available to absorb them.** A 5-person team running 4 languages isn't polyglot; it's four half-maintained roads waiting for an outage.

---

## 8. Where the simple "bias against" breaks down

To stay honest, the senior also knows when the restraint dogma is *wrong*:

- **Forced-platform reality.** A web product *is* a multi-language org whether you like it or not — the browser forces JS/TS, so "minimize languages" already lost at the frontend boundary. Don't waste restraint capital fighting physics; spend it on the backend where you actually have a choice.
- **A language genuinely opens a market or capability** you otherwise can't reach — Swift for an iOS app you must ship, CUDA for GPU work that's the whole product. Restraint that blocks a capability the business needs is just obstruction.
- **The "boring monolith of one language" can also be a trap** — forcing ML into your Java backend because "we don't add languages" is the law-of-the-instrument error from [`01-language-selection-criteria`](../01-language-selection-criteria/) wearing a discipline costume. Refusing the obviously-right tool to protect a count is as dumb as adding a needless language.

The senior position is not "never add languages." It's "treat each addition as a perpetual liability, make the count a governed quantity, and require a real trigger plus a real exit plan — while staying honest that sometimes the trigger is real and the answer is a disciplined yes."

---

## 9. Senior checklist

- [ ] Model the cost as **one-time entry + perpetual carry**, and the benefit as **decaying** — compare the net, not entry-vs-benefit.
- [ ] Treat every addition as **precedent-setting**; ask "is this worth pushing the count from N to N+1?", not just "is this good?"
- [ ] Refuse "temporary" framing — **temporary languages are permanent** unless an enforced expiry exists.
- [ ] Write **numeric, dated exit criteria** and a **revert plan** *before* entry, while reversibility is cheap to preserve. The pilot's default outcome is revert.
- [ ] When a pilot underperforms, **ignore sunk cost** and honor the pre-written criteria; a pilot that proves "no" is a success.
- [ ] Distinguish **team adoption** (contained, revertible) from **org blessing** (sprawl, near-permanent); gate the latter far harder.
- [ ] Respect that **language count is bounded by team size** — even infinite-headcount orgs limit themselves on purpose.

---

## 10. What's next

| Topic | File |
|---|---|
| Governance machinery: RFC process, supported-language tiers, paved roads, sunsetting, the politics of "no" | `professional.md` |
| Practice — NPV cost sheets, exit-criteria drafting, killing-a-pilot reasoning | `tasks.md` |
| Interview questions from "teammate wants Rust" to "design an org adoption process" | `interview.md` |
| The mechanics of actually migrating or reverting between languages | [`06-migrating-between-languages`](../06-migrating-between-languages/) |
| Long-term betting and lock-in once a language is in | [`08-language-longevity-and-lock-in-risk`](../08-language-longevity-and-lock-in-risk/) |

---

**Memorize this:** a new language is a one-time payment for a perpetual liability against a decaying benefit — so decide the exit before the entry, keep the pilot's default outcome at *revert*, and ignore sunk cost when the criteria say no. Every addition is precedent-setting and pushes a count that's bounded by your team size; even orgs with unlimited engineers limit themselves on purpose. Sometimes the trigger is real and the answer is a disciplined yes — but it's earned, governed, and reversible, never default.
