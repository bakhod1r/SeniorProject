# When to Introduce a New Language — Professional

> **What?** The organizational machinery that turns "should we add a language?" from a hallway argument into a governed decision: a written adoption process (RFC), a tiered supported-languages list, paved-road incentives, exception handling, sunset processes, and the politics of telling an excited senior engineer "no" without losing them. This is the topic where language restraint stops being a personal discipline and becomes culture and policy.
> **How?** You are the person — staff engineer, principal, head of platform, or the language-strategy working group — who owns the *count*. Your job isn't to make every call yourself; it's to build a process that makes good calls without you, and to defend the cultural signal that discipline, not sprawl, is how this org operates.

---

## 1. The org-level reframe: language count is a platform-team budget

At the individual level, a new language is a personal preference. At the org level, it's a **standing claim on the platform team's budget**, forever. Every blessed language is a road the platform/infra team must build and maintain: base images, CI templates, the internal auth/config/metrics/RPC SDKs, security scanning, observability integrations, upgrade automation, and the on-call runbooks.

So the governing question is never "is this language good?" It's **"are we willing to fund a paved road for this language in perpetuity?"** That reframing does most of the work, because it moves the decision from the realm of taste (where the loudest engineer wins) to the realm of budget (where someone has to actually own the recurring cost). A language with no funded paved road isn't "allowed unofficially" — it's a liability with no owner, which is the worst possible state.

---

## 2. The supported-languages list and its tiers

The single most effective governance artifact is a **published, tiered list** of languages with explicit support levels. Tiers, because "supported vs banned" is too blunt — reality has a middle.

| Tier | Meaning | Platform commitment | Who can use it |
|---|---|---|---|
| **Tier 1 — Paved road** | Fully supported, recommended default | Base images, CI templates, all internal SDKs, security scanning, on-call runbooks, upgrade automation | Anyone, no approval needed |
| **Tier 2 — Allowed** | Supported for specific domains | Partial SDK coverage, CI exists, security scanning; fewer guarantees | Allowed for the domain it's blessed for (e.g. Python for ML, Swift for iOS) |
| **Tier 3 — Experimental** | Approved pilot, time-boxed | Minimal; the team using it carries most of the cost | Only the approved team, only for the approved scope, with an expiry date |
| **Tier 4 — Deprecated / sunset** | On the way out | Maintenance-only, no new services | No new use; migration required |
| **Unlisted** | Not approved | None | Not permitted in production |

The tiers do real work. They let you say "yes, but contained" (Tier 2/3) instead of a binary yes/no, and they make the **paved road's gravity** explicit: Tier 1 is the path of least resistance — pick it and everything is done for you; pick anything else and you're signing up to carry weight. That gradient is the whole incentive system. Publish the list, date it, and put a named owner on each language.

> Real precedent: Google's internal blessed-languages set (C++, Java, Go, Python, plus JS/TS, Kotlin/Swift for mobile) is exactly this — a deliberately small Tier-1 with a hard gate to add to it. Meta, Amazon, and others run analogous lists. The signal: even at near-unlimited headcount, the list stays short *on purpose*.

---

## 3. The adoption RFC: making the case in writing

A new language enters via a written proposal — an **RFC** (Request for Comments) or design doc — never a Slack thread that wins by exhaustion. Writing forces rigor and creates a durable, reviewable record. A good template:

```markdown
# RFC: Adopt <Language> for <scope>

## 1. Problem & trigger
What can the current stack genuinely NOT do well? Which trigger is this —
hard platform / domain ecosystem / measured performance / fundamental safety?
(If none of these, stop here.)

## 2. Why not a library or architecture change? (REQUIRED)
What library, tuning, or architectural fix was tried or considered, and why
does it not close the gap? Include measurements.

## 3. The N+1 cost
Itemize what the platform team must build/maintain forever: CI, base images,
internal SDK ports, security scanning, observability, on-call runbooks.
Who funds this? Name the owning team.

## 4. Scope requested
Tier 2 (domain-blessed) or Tier 3 (time-boxed pilot)? Which services? Who maintains?

## 5. Exit criteria & revert plan
Numeric, dated success/failure criteria. The revert plan, designed now.
Default outcome of a pilot is REVERT unless criteria are met.

## 6. Blast radius & reversibility
Is it behind a clean boundary? What depends on it? How hard to remove later?

## 7. Decision
Approver(s), date, tier granted, review date.
```

Section 2 — "why not a library?" — is the most important and the most skipped, so make it mandatory and reject any RFC that hand-waves it. Section 3 forces the proposer to confront the recurring cost and *name who pays it*; "the platform team will figure it out" is not an answer.

---

## 4. Who approves, and why it shouldn't be one person

Adoption should require sign-off from the people who carry the cost, not just the people who want the language:

- **The platform/infra lead** — because they own the perpetual paved-road cost. They have effective veto on Tier 1/2; nobody can vote *their* team's budget.
- **A staff/principal engineer or architecture group** — for the precedent-setting, count-level view ("do we want to be an N+1 org?").
- **The proposing team's lead** — committing their team to maintain the pilot.

The structure matters because it prevents the two classic failures: a lone enthusiast adding a language by force of will, and a manager approving it to keep a star engineer happy without the platform team's buy-in. Make Tier-3 pilots **easy to approve** (low blast radius, time-boxed, revertible — you *want* cheap experiments) and Tier-1/2 promotions **hard** (they create perpetual cost). The gate should be steep exactly where the commitment is permanent.

---

## 5. Paved-road incentives: make the right thing the easy thing

Governance by *prohibition* breeds resentment and shadow IT — teams sneak the language in anyway. Governance by *incentive* works better: make the supported languages so much easier to use that going off-road is obviously not worth it.

- **A Tier-1 service is `scaffold new-service` and you're done** — CI, deploy, auth, metrics, logging, dashboards, on-call hooks all wired. An off-road language means building all of that yourself.
- **Internal SDKs exist first-class** for Tier-1, partially for Tier-2, and not at all for unlisted languages. The friction of re-implementing auth in an unblessed language is the deterrent — you don't have to *forbid* it; you just don't *subsidize* it.
- **Security, compliance, and upgrade automation** ride the paved road. Off-road, the team owns CVE response and runtime upgrades themselves, which is a real, felt cost.

The goal: an engineer choosing a Tier-1 language should feel like they got a gift, and an engineer choosing an unlisted one should feel the full weight of what they took on. That gradient does more to control sprawl than any policy document. **Make discipline the lazy choice.**

---

## 6. The politics of telling an excited senior "no"

This is the human core of the job. A respected senior engineer is genuinely excited about Rust/Elixir/Zig and has built a real prototype. Saying "no" badly costs you the engineer; saying "yes" badly costs the org a decade of sprawl. Do it well:

**Separate the language from the person.** "This isn't about whether Rust is good — it obviously is. It's about whether *we* can fund a third paved road." You're rejecting a *cost*, not their judgment.

**Show the cost sheet, don't assert authority.** "Here's what adopting this commits the platform team to, forever — eight recurring lines, ~1.5 FTE of carry. For a 1.6× win on a non-critical path, I can't justify it." A visible cost sheet beats "because I said so" and respects them as an engineer.

**Offer the contained yes when you can.** "I won't bless it org-wide, but I'll approve a time-boxed Tier-3 pilot on the analytics service with these exit criteria." A scoped yes channels the energy into a safe experiment instead of crushing it. Often the pilot itself reveals the answer, and you didn't have to be the bad guy.

**Redirect the energy.** "The thing you actually want — better concurrency ergonomics — let's see if we can get 80% of it in our existing stack, and you lead that." Excited engineers want to solve the problem; sometimes the language was just the first tool they grabbed.

**Be honest about RDD without accusing.** If it smells like résumé-driven development, don't say "you just want it on your CV." Say "let's make sure the *system* benefits, not just our skills — what does this buy the company specifically?" Let the question do the work.

The engineer you say "no" to today is one you need to *keep*. A respectful, reasoned, cost-grounded no — paired with a contained yes or a redirect — keeps them. A dismissive no loses them, and now you have an attrition problem on top of a language problem.

---

## 7. Sunsetting a language: the part everyone skips

Adoption processes are common; **removal** processes are rare, which is exactly why orgs accumulate dead languages. A language reaches Tier 4 when: the team that owned it left, the trigger that justified it is gone, the ecosystem is dying ([`08-language-longevity-and-lock-in-risk`](../08-language-longevity-and-lock-in-risk/)), or the carry cost stopped being worth it.

A real sunset process:

1. **Declare it deprecated, with a date.** Move it to Tier 4 publicly. No new services in it, effective immediately.
2. **Inventory the existing code.** What's written in it, who owns it, what depends on it. You usually find more than you expected.
3. **Fund the migration explicitly.** Sunsetting is a project with headcount, not a hope. (Use the patterns in [`06-migrating-between-languages`](../06-migrating-between-languages/) — strangler fig, not big-bang rewrite.)
4. **Set a hard end-of-support date** and enforce it — after it, the platform team stops patching the runtime, which makes the remaining holdouts a security problem they can no longer ignore.
5. **Remove it from the list** once the last service is gone.

Without a funded sunset process, "deprecated" is a sticker, not a state — the language lives on in the one service nobody dares touch, and your supported-list is a fiction. **A language you can't remove is a language you didn't really govern.**

---

## 8. The cultural signal: discipline vs sprawl

Beyond the mechanics, the language count sends a *cultural* message that shapes hiring and engineering identity:

- **A short, well-maintained list says:** "We optimize for the long-term health of the system. We're not chasing fashion. Mastery and operational excellence matter here more than novelty." This attracts engineers who want to build durable systems and tends to produce stable, debuggable production environments.
- **A sprawling, ungoverned list says:** "Anyone can add anything." It can read as freedom, but it usually reads — to the engineers who carry the pager — as chaos: four half-maintained roads, no one who understands the whole system, and an on-call rotation that's a lottery.

Neither is purely good. Too much restraint calcifies into "we still use the 2009 stack because change is scary" — which is its own dysfunction and drives away strong engineers who see stagnation. The professional's job is to make the list **deliberately short *and* genuinely alive**: a small set that the org actively invests in, refreshes when a real trigger appears, and prunes when one disappears. The signal you want is *intentionality* — every language on the list is there for a reason someone can articulate, and that reason is reviewed.

---

## 9. Anti-patterns at the org level

**The ungoverned list.** No process, so every team picks freely and the org wakes up polyglot-by-accident. The fix isn't a ban; it's introducing tiers and a paved road retroactively, then sunsetting the worst offenders.

**The frozen list.** A process so hostile that no language is *ever* added, and the org is stranded on dying tech a decade later. Restraint became stagnation. Adoption must be *hard*, not *impossible* — the door has to open for a real trigger.

**Approval theater.** An RFC process that always says yes because no one wants the political cost of a no. The process exists but governs nothing. If your last ten RFCs were all approved, you don't have a gate.

**Pilots with no expiry.** Tier-3 grants that never sunset and quietly become Tier-1 by usage. Every experimental grant needs a hard expiry date that triggers a real "promote, extend, or revert" decision.

**Bypass via acquisition.** You acquire a company and inherit their stack. Suddenly you're a Scala shop without ever deciding to be. Acquisitions need an explicit "adopt, migrate, or wall-off" decision, run through the same governance, not a default of "keep whatever they had."

---

## 10. Professional checklist

- [ ] Reframe each request as **"will we fund a paved road for this, forever?"** — a budget question, not a taste question.
- [ ] Maintain a **published, tiered supported-languages list** with a named owner per language.
- [ ] Require an **adoption RFC** with a mandatory "why not a library?" section and a named cost-owner.
- [ ] Make approval require the **platform lead** (carries the cost) plus an **architecture/staff** view (carries the precedent).
- [ ] Govern by **paved-road incentive**, not prohibition — make the supported choice the lazy choice.
- [ ] When you say **no**, separate language from person, show the cost sheet, and offer a **contained yes** or a redirect.
- [ ] Fund a real **sunset process** — deprecation with dates and migration headcount, not stickers.
- [ ] Keep the list **short but alive** — intentional, not frozen.

---

## 11. What's next

| Topic | File |
|---|---|
| The individual decision framework underneath the governance | `senior.md` |
| Practice — design an adoption RFC, a tiered list, a sunset plan, handle the "no" conversation | `tasks.md` |
| Interview questions including "design your org's adoption process" | `interview.md` |
| Executing the migrations a sunset process requires | [`06-migrating-between-languages`](../06-migrating-between-languages/) |
| The TCO and team-skills math behind the paved-road budget | [`07-total-cost-of-ownership-and-team-skills`](../07-total-cost-of-ownership-and-team-skills/) |

---

**Memorize this:** at org scale, a language is a perpetual claim on the platform team's budget, so govern it like one — a tiered list, an RFC that demands the "why not a library?" answer, approval from whoever carries the cost, paved-road incentives that make discipline the lazy choice, and a funded sunset process so "deprecated" means *gone*. Say no by showing the cost sheet and offering a contained yes, never by pulling rank. Keep the list deliberately short — and deliberately alive.
