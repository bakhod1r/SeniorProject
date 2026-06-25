> Interview questions on logical fallacies in engineering. Interviewers use these to probe whether you can keep a technical debate honest under pressure — naming the flawed move, rebutting it without escalating, and proposing the better-reasoned path. For each: name the fallacy precisely, explain *why* the reasoning fails, and give the constructive counter. Short, sharp answers beat lectures. Watch for the trap where the conclusion is actually *correct* but the *argument* is still fallacious — those are different things.

---

## Q1. "Google uses microservices, so we should adopt them too." Name the fallacy and rebut it.

**Appeal to authority** (a "big company does it" argument). It fails because Google's choice is evidence about *Google's* constraints — thousands of services, thousands of engineers to operate the complexity — not about ours. Rebuttal: "What specific problem does that solve for them, and do we have that problem at our scale?" Valid use of authority always reconstructs the *reasoning* the authority would give; citing the authority alone is cargo-culting.

**Trap / follow-up:** "But isn't learning from leaders smart?" Yes — copy their *reasoning and constraints*, not their *artifacts*. The fallacy is treating the citation as the whole argument.

---

## Q2. A teammate says: "Either we move to Kubernetes or we can't scale." What's wrong, and how do you respond?

**False dichotomy** — two options presented as the only two, hiding the middle. There's a whole spectrum: vertical scaling, read replicas, caching, a modular monolith, managed container services. Response: "Are those really the only two options? What sits between them, and which one matches our actual bottleneck?" The fix is to widen the option set back to reality before choosing.

**Follow-up:** Note that a *real* tradeoff compares all live options on shared criteria; a false dichotomy is a tradeoff with the inconvenient options deleted.

---

## Q3. "We've spent eight months on this migration, we can't abandon it now." Name the fallacy and give the correct decision rule.

**Sunk cost fallacy** — letting already-spent resources drive a forward-looking decision. The eight months are gone regardless of what you choose next. Correct rule: ignore the spend and ask, *"If we were deciding fresh today, with everything we now know, would we start this migration?"* If no, finishing is throwing good money after bad. The only valid inputs are *future* cost and *future* value.

**Trap:** "Doesn't quitting waste the eight months?" They were wasted the moment the path was wrong; continuing only wastes *more*.

---

## Q4. WWII bombers came back with bullet holes on the wings, so they reinforced the wings. What's the fallacy, and what's the right answer?

**Survivorship bias.** The planes analyzed were the ones that *returned* — the sample was filtered by survival. Abraham Wald's insight: reinforce where the returning planes had *no* holes (engines, cockpit), because planes hit there didn't come back to be counted. Engineering parallel: "single Postgres scaled fine for us" comes only from teams that survived; the ones it broke aren't at the conference giving the talk. Always ask what the *failures* would look like and whether you're seeing the full sample.

---

## Q5. "We deployed at 14:00 and the outage started at 14:05, so the deploy caused it." What's the fallacy?

**Post hoc ergo propter hoc** — "after this, therefore because of this." Temporal sequence is the weakest form of causal evidence. The outage could be a traffic spike, an expiring cert, a cron job, or a leak crossing a threshold at 14:05. Counter: demand a *mechanism* ("what in the diff produces this symptom?") and a *control* ("did a similar deploy *not* cause this?"). Rolling back to restore service is fine operationally — but "the deploy caused it" is a causal claim that still needs proof in the review, or you'll fix the wrong thing.

---

## Q6. "Real engineers don't need a debugger — they reason through the code." How do you handle this in a review?

**No true Scotsman.** It defends a generalization by redefining "real engineer" to exclude any counterexample, making the claim unfalsifiable — every debugger user just gets reclassified as "not real." Handle it by fixing the definition first: "Let's define the term before we use it as a test. If it just means 'doesn't use a debugger,' the claim is circular. What's the *evidence* the practice produces better outcomes?" The honest move when a counterexample appears is to *weaken* the rule, not redefine the category.

---

## Q7. Explain motte-and-bailey with an engineering example. Why is it hard to counter?

Coined by Nicholas Shackel. You advance a hard, desirable claim (the **bailey**: "rewrite the platform in Rust"); when challenged, you retreat to an easy, trivially-true claim (the **motte**: "memory safety matters"); once that's granted, you walk back to the bailey as if it were proven. It's hard to counter because the two claims share one conversation — agreement with the small one gets harvested as support for the big one. Counter *structurally*: "There are two claims here — I agree memory safety matters; the rewrite is a separate proposal needing its own justification. Which are we deciding?" You pin which claim is actually on the table.

---

## Q8. "This caching fix isn't perfect under burst load, so it's not worth shipping." Name and rebut.

**Nirvana fallacy** (Demsetz) — rejecting a real, available option by comparing it to an *imagined perfect* one instead of to the real alternatives. The honest comparison is "this fix vs. what we have now" (often nothing), not "this fix vs. perfection," which isn't on the menu. Rebuttal: "Perfect isn't an option we can ship. The real choice is this 90% fix now versus today's 0%. Is 90% an improvement over nothing? Then ship it and iterate; the ideal version is a backlog item, not a blocker."

---

## Q9. State Goodhart's law and give an engineering example. Why can't you fix it by arguing?

**Goodhart's law:** "When a measure becomes a target, it ceases to be a good measure" (Strathern's phrasing of Goodhart's observation). Example: line coverage is a fine *signal* of test quality until you *gate* on it — then you get assertion-free tests covering trivial getters, hitting exactly the threshold. You can't argue your way out because it's an *incentive*, not a mistake; people rationally optimize the proxy. You fix it by *design*: pair the proxy with a counter-metric (coverage + mutation score), prefer signals over hard gates, and name the underlying goal above the proxy so the proxy stays demotable.

---

## Q10. What's the fallacy in "we should rewrite this in the new framework — it's 2026," and how is it different from its opposite?

**Appeal to novelty** — treating *newer* as *better* with no concrete, measurable reason. Its opposite is **appeal to tradition** ("we've always used the old one, keep it"). Both substitute *age* for *merit* and contain zero facts about your actual code. Same fix for both: ask *what specific, measurable property* the age is standing in for (a GC-pause fix? a proven zero-CVE track record?). If nothing concrete comes back, age was the whole argument — and age is not a reason.

---

## Q11. Where does Feynman's "cargo cult" come from, and what's the engineering version?

From Feynman's 1974 Caltech address: Pacific islanders rebuilt the *form* of WWII airfields — wooden towers, runways — and waited for cargo planes, reproducing the rituals without the causal substance that made planes land. Engineering version: adopting another company's practices and artifacts ("Spotify does squads, so we will") without the conditions that made them work — even Spotify dropped the "Spotify model." It fuses authority, bandwagon, and survivorship bias. Antidote: **name the goal, not the ritual** — every practice must justify itself by the outcome it produces and whether the enabling conditions hold for you.

---

## Q12. "If we let people skip review for one-line fixes, soon nobody will review anything." Name it and respond constructively.

**Slippery slope** — asserting one step inevitably cascades to an extreme, without showing the mechanism forcing each link. Constructive response: separate the proposed step from the feared endpoint and ask what *forces* one into the other — then hand back a *bounded* version: "Auto-approve only whitespace/comment-only diffs, enforced by a lint rule." That takes the concern seriously while replacing the free-fall with a guardrail. Not every slope is fallacious (some really do compound) — the fallacy is asserting inevitability instead of demonstrating it.

---

## Q13. In a post-mortem someone writes "root cause: the deploy." As a reviewer, what concerns do you raise?

Two fallacies: (1) **post hoc** — "preceded therefore caused"; demand mechanism and a control. (2) **single-root-cause / hasty generalization** — complex outages are usually a *chain* of contributing factors, and naming one tidy "root cause" hides the others and misdirects the remediation budget. Modern blameless practice (Allspaw) prefers "contributing factors" with confidence levels. I'd ask: what's the confirmed mechanism, what's our confidence, and what *other* conditions had to align? A cause without confirmation is a hypothesis, not a verdict.

---

## Q14. A new engineer says "on my last team we dropped the ORM for raw SQL and performance doubled — let's do it here." Is this wrong?

It's **anecdotal evidence** — a single uncontrolled sample (n=1) standing in for representative data. It silently assumes "there" resembles "here"; their gain may have come from a specific N+1 pattern, a different DB, or a measurement artifact. The story isn't *wrong* — it's just a *hypothesis*, not a conclusion. Right response: "Useful hint — let's profile first. If our latency is dominated by one hot ORM query, your fix transfers; if it's network, it won't." Anecdotes are great idea-generators and terrible decision criteria.

---

## Q15. The conclusion of a fallacious argument can still be true. Why does that matter for how you push back?

Because validity of *reasoning* and truth of the *conclusion* are independent: an appeal to authority can land on the correct architecture, and a rigorous argument can reach a wrong one. It matters tactically — if you attack the *conclusion* ("microservices are wrong") you'll lose when they happen to be right, and you'll look like you're just contrarian. Attack the *reasoning* instead ("that argument doesn't support the conclusion, even if the conclusion turns out right — here's the reason that *would*"). It keeps you correct regardless of how the conclusion shakes out, and it improves the decision instead of just contesting it.

---

## Q16. How do you point out a fallacy in a senior colleague's argument without damaging the relationship?

Attack the *structure*, not the person; "this argument has two different claims in it" lands very differently from "you're using a motte-and-bailey." Grant the true part loudly first ("you're right that X matters — fully agree"), then pin the open question and convert it into a *shared* investigation ("so the question is whether the cost is justified — let's look together"). For slippery-slope and nirvana arguments, hand back a bounded, real proposal. Often the cleanest move is one neutral question to the *room* — "are those the only two options?" — which dissolves the fallacy with nobody losing face. The goal is a better decision, not a won argument.
