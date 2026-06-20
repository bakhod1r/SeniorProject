# Metrics Anti-Patterns & Goodhart — Interview Questions

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Metrics Anti-Patterns & Goodhart
> *This interview almost never asks "what is Goodhart's law" as a definition-recall question. It asks "the CEO wants one number for engineering productivity — what do you tell them," and then watches whether you can hold the line on outcomes-over-outputs without sounding like you're refusing to measure anything. The trap is symmetric: candidates who worship metrics fail, and candidates who reject all measurement fail too. The senior answer lives in the narrow band between.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Goodhart and the Law Family](#theme-1--goodhart-and-the-law-family)
3. [Theme 2 — Bad Productivity Metrics](#theme-2--bad-productivity-metrics)
4. [Theme 3 — The Cardinal Sins](#theme-3--the-cardinal-sins)
5. [Theme 4 — Designing Safe Metrics](#theme-4--designing-safe-metrics)
6. [Theme 5 — Why Software Productivity Is Hard to Measure](#theme-5--why-software-productivity-is-hard-to-measure)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Detecting and Recovering](#theme-7--detecting-and-recovering)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **output vs outcome** (lines/commits/points shipped vs problems solved for users and the business)
- **signal vs target** (a metric you watch to ask better questions vs a metric you reward, which corrupts it)
- **measure vs incentivize** (looking at a number vs paying people for it — the second is where Goodhart fires)
- **team vs individual** (system behavior, which is real, vs ranking people, which is destructive and statistically illiterate)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* — and name the failure mechanism, Goodhart or surrogation — before reaching for a dashboard.

---

## Theme 1 — Goodhart and the Law Family

### Q1.1 — State Goodhart's law and explain the *mechanism*, not just the slogan.

> **Testing:** Whether you understand *why* metrics rot under pressure, or just know the bumper sticker.

**A.** The popular phrasing is Marilyn Strathern's: **"When a measure becomes a target, it ceases to be a good measure."** Goodhart's own economics version was narrower — once a policymaker leans on a statistical regularity for control, the regularity collapses.

The mechanism is the part that matters. A metric starts as a **proxy** for something you actually care about but can't measure directly — you watch deployment frequency because you care about *delivering value fast*, not because you intrinsically value the number of deploys. The proxy correlates with the goal *as long as nobody is optimizing the proxy*. The moment you attach reward or threat to the proxy, rational people optimize **the proxy itself**, and the cheapest way to move the proxy is almost never the way you intended. The correlation between proxy and goal breaks precisely *because* you started steering by it. So the failure isn't people being dishonest — it's people being rational about a number you made consequential. That's why "we'll just measure it carefully" doesn't save you: the corruption is driven by the incentive, not the measurement.

### Q1.2 — Goodhart, Campbell, surrogation — distinguish them. They're not the same failure.

> **Testing:** Senior-level precision. Many people collapse all three into "Goodhart."

**A.** They're three related but distinct failures:

- **Goodhart's law** — *a measure used as a target stops being a good measure.* The focus is on the **proxy decaying** once it's optimized.
- **Campbell's law** (Donald Campbell, 1979) — *the more a quantitative indicator is used for social decision-making, the more it will be corrupted and the more it will distort the process it's meant to monitor.* It's the same phenomenon but with an explicit second clause: high-stakes use doesn't just corrupt the *number*, it **corrupts the underlying process**. Teaching-to-the-test degrades the number *and* degrades actual education. That second clause is why it's quoted for high-stakes settings.
- **Surrogation** — a cognitive/behavioral failure studied in management accounting: people **lose sight of the real goal and start treating the metric as if it *were* the goal.** Surrogation is psychological substitution — the strategy was "delight customers," the metric was NPS, and six months later everyone is managing NPS and nobody remembers it was ever a proxy. Goodhart is about gaming under incentive; surrogation is about *forgetting the metric is a stand-in at all*, which happens even with honest people and no explicit reward.

The clean summary: **Goodhart** = the proxy decays when targeted; **Campbell** = the process behind the proxy also decays under stakes; **surrogation** = humans confuse the proxy *for* the goal. A complete senior answer names all three because they call for different defenses.

### Q1.3 — Give a non-software example that makes the mechanism unforgettable.

> **Testing:** Whether the concept is genuinely internalized or only memorized in a software context.

**A.** The **"cobra effect"** is the canonical one: a colonial government offered a bounty per dead cobra to reduce the cobra population; people began *breeding* cobras to collect bounties; when the program was cancelled, the breeders released their now-worthless snakes, leaving more cobras than before. The proxy (dead cobras submitted) was a fine proxy for "fewer cobras" until it became a target with a payout — then the cheapest way to move the proxy was to manufacture cobras, the opposite of the goal.

The software translation is exact: pay for "bugs fixed" and you'll get bugs *introduced* so they can be fixed; reward "tickets closed" and you'll get one problem split into ten tickets. The cobra story is useful in an interview because it forecloses the "but our engineers wouldn't game it" objection — the failure is structural, not a character flaw.

### Q1.4 — If Goodhart is real, isn't *all* measurement futile? Why isn't that the conclusion?

> **Testing:** The single most important nuance. The naive takeaway from Goodhart is nihilism, and that's wrong.

**A.** No — the conclusion is narrower and more useful: **don't turn measures into targets, and especially don't attach individual incentives to them.** Goodhart fires when a metric becomes a *consequential target*, not when it's *observed*. There is a vast, legitimate space for metrics used as **signals** — instruments you watch to notice change, form hypotheses, and ask better questions — and that space is unharmed by Goodhart precisely because nobody is being rewarded for moving the number.

The distinction is **measure vs incentivize**. A doctor weighs you to inform a conversation about your health; that's measurement and it's fine. If your insurance premium were set by your weight, you'd find ways to weigh less on the day that didn't make you healthier; that's incentivization and Goodhart eats it. DORA metrics, SPACE — these are valuable *as long as you treat them as a thermometer, not a thermostat you let HR control*. So the mature position rejects both metric-worship and metric-nihilism: measure plenty, target almost nothing, never reward individuals for a proxy.

---

## Theme 2 — Bad Productivity Metrics

### Q2.1 — Why is lines of code a bad productivity metric? Be specific about the gaming.

> **Testing:** Whether you can articulate *why* a famously-bad metric is bad, beyond "everyone knows it's bad."

**A.** LOC measures **output, not outcome** — and worse, it rewards the *wrong* output. The best engineering frequently *removes* code: deleting a dead module, replacing 400 lines with a 20-line library call, collapsing duplication. Under LOC, all of that scores negative or zero while the worst work — copy-paste, verbose boilerplate, reinventing the standard library — scores high. So it's not merely uncorrelated with value; it's often **anti-correlated** with it.

The gaming is trivial and corrosive: people stop deleting code (deletions hurt the metric), avoid refactoring, write verbosely, and decline to pull in libraries. Bill Gates's line is the standard citation — *"measuring programming progress by lines of code is like measuring aircraft building progress by weight."* A heavier plane is usually a *worse* plane. The deeper point for the interviewer: LOC fails the output/outcome test *and* it actively degrades the codebase the moment it's incentivized — Campbell's second clause in action.

### Q2.2 — What about commit count or PR count? It feels more "activity-based" — is it better?

> **Testing:** Whether you see that finer-grained activity metrics share the same disease.

**A.** It's the same disease in finer granularity. Commits and PRs are **activity, not value**, and activity is cheap to manufacture: split one logical change into fifteen commits, break a feature into many tiny PRs, rebase to inflate the count. The unit is arbitrary — a "commit" can be one character or a thousand lines — so counting them measures *how someone chooses to slice their work*, which is a stylistic and process artifact, not productivity.

The subtler harm is that it punishes good collaboration. The engineer who spends a day pairing to unblock three others, reviewing critical PRs, or debugging a production incident produces *few or zero commits* and looks unproductive, while the value they created is enormous and invisible to the counter. So commit/PR counts both **overcount busywork** and **undercount leverage** — exactly inverted from what you want. They're fine as a *background signal* (a team's commits dropping to zero for a week is worth a question) and toxic as a target.

### Q2.3 — Velocity. Teams live and die by it. What's wrong with using it as a productivity metric?

> **Testing:** A nuanced one — velocity has a legitimate use, and the failure is specifically in *misusing* it.

**A.** Velocity (story points completed per sprint) has exactly **one legitimate use: a team's own short-term capacity-planning input** — "last few sprints we landed ~30 points, so let's not commit to 60." It is a **relative, team-local, self-calibrated** number. Every failure comes from using it as something it isn't:

1. **It's not a productivity metric.** Points measure *estimated effort*, not delivered value. Finishing 40 points of low-value work is worse than finishing 10 points that move a key outcome.
2. **It's trivially gamed by inflation.** Tell a team to "raise velocity" and they'll quietly inflate estimates — yesterday's 3-point story is today's 5-pointer. Velocity rises; nothing ships faster. The number is denominated in a currency the team itself mints.
3. **It's meaningless across teams.** Points are calibrated per-team, so Team A's 50 and Team B's 50 are different units. Comparing or summing them is a category error, yet it's the most common abuse.

So the senior answer isn't "velocity is bad" — it's "velocity is a *planning aid for one team* that becomes poison the instant it's used for comparison, targets, or as a stand-in for output."

### Q2.4 — Story points specifically — why are they a uniquely seductive trap for executives?

> **Testing:** Whether you understand that the *appearance of precision* is itself the danger.

**A.** Story points are seductive because they *look* like a unit of production — a number that goes up and can be summed into a dashboard — while being **a deliberately fuzzy, relative estimate of effort with no anchor to value or even to time.** That combination is the trap: leadership sees a quantity that increments and treats it as throughput, when it's a team's internal, uncalibrated guess about *difficulty*.

The moment points become a target, three things happen, all bad: estimates inflate (so the number rises without more work), engineers pad estimates defensively (gaming the planning process they exist to serve, the surrogation failure where the estimate becomes the goal), and the team optimizes for *closing point-bearing tickets* over doing valuable but unticketed work — fixing flaky tests, mentoring, hardening. The honest framing for the interview: story points were invented to be **bad at being a target on purpose** — relativity and fuzziness are features for planning conversations and bugs for measurement. Anyone summing points across teams into a "productivity" figure has misunderstood what they are.

---

## Theme 3 — The Cardinal Sins

### Q3.1 — Why is measuring *individual* developer productivity the cardinal sin? It feels like the obvious thing to do.

> **Testing:** The most important single belief in this topic. Get this wrong and seniority is in doubt.

**A.** Three independent reasons, each sufficient:

1. **Software is a team sport, so individual attribution is mostly fiction.** Value emerges from collaboration — design discussions, reviews, pairing, unblocking, incident response. Attributing a shipped outcome to one person requires ignoring the system that produced it. The work that *can* be cleanly attributed to an individual (raw commits) is exactly the work that matters least.
2. **It destroys the collaboration that produces the value.** The instant individuals are measured (and compared), the rational move is to **stop helping each other** — reviewing a teammate's PR, mentoring a junior, and pairing all become "time not spent on *my* numbers." You optimize the parts and degrade the whole. This is the system-thinking objection Deming made his life's work: *most variation comes from the system, not the individual*, so ranking individuals optimizes noise while damaging the system.
3. **It poisons psychological safety.** People hide problems, avoid hard/unglamorous work, and stop taking risks — all corrosive to the very outcomes you wanted.

The clean line: **you can measure the team's *outcomes*; you cannot fairly measure an individual's *productivity*, and trying does active harm.** The right unit of analysis is the team, because the team is the smallest unit that actually delivers value.

### Q3.2 — Ranking engineers — stack ranking, forced distribution. Why is this fatal, statistically and culturally?

> **Testing:** Whether you can attack ranking on *both* statistical and human grounds.

**A.** **Statistically**, ranking treats *noise as signal*. Deming's red-bead experiment is the canonical demonstration: workers draw beads from a fixed-ratio bin, some get more red (defective) beads by pure chance, and management rewards the "good" workers and disciplines the "bad" ones — but the differences are *entirely* random, produced by a system nobody controls. Ranking engineers does the same: it manufactures a total order out of a sample dominated by system variation and luck (which project, which teammates, which production fire landed on you), then attaches consequences to that order. You are rewarding randomness and calling it performance management.

**Culturally**, **forced distribution** (a fixed quota must be rated "below expectations") guarantees you punish people on strong teams and turns colleagues into competitors for a fixed pot — directly attacking collaboration. Microsoft's stack ranking is the widely-studied cautionary tale: employees reportedly avoided working with strong peers (to not look weak by comparison) and optimized for visibility over impact; the company abandoned it. So ranking is fatal twice over — it's **statistically invalid** (ordering noise) and **culturally corrosive** (incentivizing the opposite of teamwork).

### Q3.3 — Why specifically should engineering metrics stay out of *performance reviews*?

> **Testing:** Whether you can connect "metrics in perf reviews" to the Goodhart mechanism cleanly.

**A.** Because performance reviews are the **highest-stakes incentive in someone's working life** — they drive pay, promotion, and job security — so routing any metric through them is the *maximal* version of "making a measure a target." That's the exact precondition for Goodhart and Campbell: the moment a number affects someone's livelihood, they will optimize the number, and the underlying behavior the number was supposed to reflect *and the process behind it* both corrupt.

Concretely: tie reviews to PRs merged and you get PR-splitting and rubber-stamp reviews; tie them to deploy frequency and you get trivial deploys and risk-hiding; tie them to "bugs closed" and you get bugs manufactured. The metric stops reflecting reality the day it enters the review. The healthy posture: engineering metrics are **diagnostic instruments for the team to improve its system**, owned by the team; performance evaluation is a **separate human judgment** about impact, collaboration, growth, and behavior, informed by evidence and context, *not* by a leaderboard. Mixing them destroys the metric and produces unjust reviews simultaneously. DORA's own guidance is explicit on this: the four key metrics are for understanding and improving *the system*, never for evaluating individuals.

### Q3.4 — Someone says "but if I can't measure individuals, how do I manage low performers?" Answer them.

> **Testing:** Whether you can defend the position under the most common real-world pushback, not just recite it.

**A.** You manage performance the way good managers always have — through **direct observation, context, and judgment**, not a dashboard. A manager who is engaged knows who is struggling: they see it in code reviews, in design discussions, in whether commitments are met, in peer feedback, in the quality of thinking. That's a *qualitative, evidence-informed human assessment* of a specific person in a specific context — which is legitimate and necessary. What you don't do is reach for a *productivity metric* and pretend it's an objective measure of the individual, because (a) it isn't objective — it's noise plus system variation, and (b) the act of using it for evaluation corrupts it for everyone else on the team.

The reframe to give the interviewer: "measure the team, manage the individual." Metrics tell you about the *system*; managing a low performer is a *coaching and judgment* problem about a *person*, and conflating the two gives you bad metrics *and* bad people-management. If a manager genuinely cannot tell who is struggling without a productivity score, the problem is an absent manager, not a missing metric.

---

## Theme 4 — Designing Safe Metrics

### Q4.1 — What are the design principles for a metrics program that *won't* blow up in your face?

> **Testing:** Whether you have a coherent, principled framework rather than a list of "good metrics."

**A.** Five principles, each a direct defense against a failure mode above:

1. **Outcomes, not outputs.** Measure problems solved for users and the business (lead time to deliver value, change failure rate, customer-facing reliability) — not activity (LOC, commits, points). Outputs are easy to count and easy to game; outcomes are what you actually want.
2. **Team-level, not individual.** The team is the smallest honest unit of value delivery; individual attribution is fiction and destroys collaboration. Aggregate at the team and watch *trends*, not people.
3. **Paired / balanced metrics.** Never optimize a single dimension in isolation — pair every speed metric with a quality/stability metric so you can't win one by sacrificing the other. This is the structural defense against gaming.
4. **Signals, not targets.** Use metrics to *ask questions and notice change*, not as goals to hit. A signal that moves prompts "huh, why?"; a target that moves prompts gaming. Never set a hard numeric target tied to reward.
5. **Team-owned, not imposed.** The team that owns a metric to improve its own work will protect its integrity; a metric imposed from above to judge them will be gamed. Self-improvement and surveillance produce opposite behaviors from the same number.

The throughline: each principle removes one of the conditions Goodhart, Campbell, or surrogation needs to fire.

### Q4.2 — Explain *paired metrics* concretely. Why does pairing defend against gaming?

> **Testing:** The single most practical anti-gaming technique. Whether you can show the mechanism.

**A.** A paired (or "balanced") metric couples two measures that **pull in opposite directions**, so you cannot improve one by quietly sacrificing the other — the cheating shows up immediately in the partner metric. DORA is the textbook example: it pairs **throughput** (deployment frequency, lead time for changes) with **stability** (change failure rate, time to restore). If you try to game deployment frequency by shipping reckless changes, your change failure rate spikes and the gain is exposed as fake. The pair makes the only winning move the legitimate one — ship *more often* **and** keep it *stable*, which is genuine improvement.

Other classic pairs: velocity *with* defect rate or rework rate (so you can't fake throughput by lowering quality); code review speed *with* defect-escape rate (so you can't speed reviews by rubber-stamping); "tickets closed" *with* reopen rate and customer satisfaction. The principle is that **a single metric has a cheap exploit; a well-chosen pair closes the exploit** because the cheap path to one number is the expensive path on the other. Pairing doesn't make a metric un-gameable, but it makes gaming *visible*, which is most of the battle.

### Q4.3 — "Signals not targets." What does that actually look like day to day?

> **Testing:** Whether the abstraction has operational meaning to you.

**A.** As a **signal**, a metric is a thermometer you read to *generate questions*: lead time crept up over the last month — *why?* Is review latency up, is the test suite flaky, did a dependency team slow down? The number's job is to direct attention; the value is in the *investigation it triggers*, and the metric itself is never the thing you reward or punish. Crucially, you let the team interpret it in context, because the same movement can be healthy (we're investing in a migration) or unhealthy (we're drowning in incidents).

As a **target**, the same metric becomes a goal handed down with consequences — "get lead time under 24 hours by Q3 or it's reflected in reviews" — and now the rational response is to game the *definition* (start the clock later, reclassify changes, split work to look faster) rather than improve the system. The operational tell: with signals, when a number moves you ask *"what is this telling us about our system?"*; with targets, when a number moves you ask *"how do we make this number look right?"* The first improves the system; the second corrupts the metric. So "signals not targets" means metrics feed *retrospectives and curiosity*, never *quotas and incentives*.

### Q4.4 — Why does *who owns* the metric change whether it gets gamed?

> **Testing:** The cultural/ownership dimension that purely-technical answers miss.

**A.** Because gaming is a *response to threat*, and ownership determines whether a metric feels like a tool or a weapon. When a **team owns its own metrics** to improve its own work, the metric is *theirs* — gaming it would only be lying to themselves, defeating the purpose, so they protect its integrity and even argue to fix it when it's misleading. When a metric is **imposed from above as a measure of the team**, it becomes a surveillance instrument, and the rational response to surveillance is to manage appearances — game the number, hide the bad news, optimize the metric over the mission.

This is why the *same* metric (say, lead time) is healthy in a team retro and toxic on an executive ranking dashboard — the number is identical; the **ownership and stakes** invert the behavior. The design implication: push metrics *down* to the teams that can act on them, let teams choose and contextualize their own, and resist the executive instinct to centralize them into a comparison dashboard. Centralized, comparative, top-down metrics manufacture exactly the threat that drives gaming. Locally-owned, improvement-oriented metrics don't.

---

## Theme 5 — Why Software Productivity Is Hard to Measure

### Q5.1 — Martin Fowler argues you fundamentally *cannot* measure developer productivity. Why?

> **Testing:** Whether you know the deeper epistemic argument, not just "metrics get gamed."

**A.** Fowler's argument (his "CannotMeasure​Productivity" piece) is that productivity is **output per input**, and in software we **cannot measure output** in any meaningful way. We can measure *activity* — lines, commits, function points — but activity isn't output, because output is *value delivered*, and value is the thing we can't quantify: a one-line change can be worth millions, a thousand-line feature can be worth nothing or be net-negative. Worse, the value often isn't knowable until much later (did this architecture choice pay off? did this feature retain users?), and it's entangled with market timing, design, and luck that have nothing to do with the engineering.

So the obstacle isn't that our metrics are *imperfect* — it's that the numerator of the productivity fraction (output = value) is **not measurable in principle** with current understanding. Fowler's practical conclusion is important and often missed: *because* you can't measure productivity directly, don't try — instead measure things you *can* (like the DORA metrics, which measure delivery *performance*, not productivity) and rely on the qualitative judgment of skilled people. The senior framing: "productivity" and "delivery performance" are different things; we can measure the latter, and pretending it's the former is the mistake.

### Q5.2 — What is the McNamara fallacy, and how does it show up in engineering metrics?

> **Testing:** Whether you can name the meta-failure that makes leaders over-trust numbers.

**A.** The **McNamara fallacy** (named for Robert McNamara's Vietnam-era management by body-count) is the error of making decisions purely on quantitative metrics while **disregarding what can't be measured**. Daniel Yankelovich formalized its four steps: (1) measure what's easily measured — fine; (2) disregard what can't be measured, or give it an arbitrary number — questionable; (3) presume what can't be measured *isn't important* — blindness; (4) say what can't be measured *doesn't exist* — suicide. The trap is the slide from "hard to measure" to "doesn't matter."

In engineering it shows up constantly: leadership steers by the numbers on the dashboard (deploys, points, ticket counts) and *systematically discounts the unmeasured* — code health, team morale, architectural runway, mentoring, the load-bearing senior who keeps everything from falling over. Those are precisely the things that determine long-term outcomes, and they're invisible to the dashboard, so a McNamara-style operation optimizes the measurable and quietly destroys the unmeasured. The defense is to *explicitly hold space* for qualitative judgment and to treat "we can't measure this" as a reason for *care*, not for ignoring it.

### Q5.3 — Tom DeMarco co-wrote *Controlling Software Projects* and the "you can't control what you can't measure" idea — then publicly recanted. What's the lesson?

> **Testing:** Intellectual honesty and whether you know the field's own canon evolved.

**A.** DeMarco's 1982 book is the source of the famous "**you can't control what you can't measure**" line that launched a thousand metrics programs. In a 2009 IEEE Software essay he **walked it back**, writing that the line is "*absolute nonsense*" as commonly applied. His revised view: metrics have a real cost (they consume effort and invite gaming), software projects are fundamentally about *transformation and discovery* more than tight control, and the projects that matter most — the high-value, high-uncertainty ones — are exactly the ones where rigid measurement and control help *least*. He reframed the goal from *control* to *value*: for a project worth doing, small efficiency differences are noise against whether you build the right thing at all.

The lesson for the interview is twofold. First, **substantively**: even the people who founded software measurement concluded that measurement-as-control is overrated and that *value and judgment* matter more than tight metric control. Second, **about you**: citing DeMarco's recantation signals you know the field's thinking matured beyond "measure everything," and that the sophisticated position is humility about what numbers can do — not a junior reflex to instrument and target everything that moves.

### Q5.4 — If productivity can't be measured, what *can* you legitimately measure — and how is that different?

> **Testing:** Whether you can convert the critique into a constructive, defensible program.

**A.** You can measure **delivery performance** and **system health**, which are different from "productivity" in a way that matters. DORA's four keys measure how well your *delivery system* performs — how fast and how safely changes flow to production — which is a property of the **team-and-system**, observable, and (when paired) hard to game without genuine improvement. SPACE broadens this to a *multi-dimensional* picture (Satisfaction, Performance, Activity, Communication, Efficiency) precisely to resist any single number, insisting you never reduce developer experience to one metric. You can also measure **outcomes** — reliability your users feel, lead time to deliver value, defect-escape rate — and gather *qualitative* signal through developer-experience surveys.

The crucial difference: these measure the **system's delivery capability and the outcomes it produces**, not an individual's "productivity" and not raw output. They're honest about being *signals about a system to be improved by the team that owns them*, not scores to rank people. So the constructive answer is: stop trying to measure "productivity" (impossible and corrupting), and instead measure *delivery performance, outcomes, and developer experience*, at the team level, as signals. That's the legitimate program the critique points toward — see [DORA](../01-dora-four-key-metrics/interview.md) and [SPACE](../03-space-framework/interview.md).

---

## Theme 6 — Scenario and Judgment

### Q6.1 — The CEO wants a single number for engineering productivity to put on the board deck. What do you say?

> **Testing:** The flagship question. Whether you can refuse the bad ask *constructively* and give leadership something real instead of a flat "no."

**A.** I'd start by **agreeing with the underlying need** — leadership legitimately wants to know whether engineering is healthy and delivering — and then explain why a single productivity number can't serve that need and what will. The honest message: a single productivity figure is *unmeasurable in principle* (Fowler: we can't measure output/value) and *actively dangerous* (Goodhart: the moment it's on the board deck it becomes a target and gets gamed, and Campbell: the process behind it corrupts too). A single number invites comparison and ranking, the two most destructive uses, and triggers the McNamara fallacy where everything unmeasured gets ignored.

Then I'd offer the substitute — and this is the part that turns a "no" into leadership: a **small balanced set of outcome and delivery metrics**, presented at the org/team level as trends, not a single score. Concretely, the four DORA metrics (paired throughput and stability) plus a couple of *business outcome* measures the board actually cares about (feature adoption, reliability customers feel, time-to-market), and a qualitative developer-experience signal. I'd frame them as a *dashboard for asking good questions*, explicitly *not* for ranking teams or people. The close: "I can't give you one honest number for productivity — anyone who offers you one is selling a number that will be gamed within a quarter — but I can give you a small, balanced view that tells us whether we're delivering value safely, and I can stand behind it." That answer respects the CEO, demonstrates the failure modes, and lands on a defensible program.

### Q6.2 — A team's velocity doubled quarter-over-quarter, but nothing is actually shipping faster. What happened?

> **Testing:** Whether you instantly reach for the Goodhart/inflation explanation instead of celebrating.

**A.** Almost certainly **estimate inflation** — Goodhart in its purest form. Velocity is denominated in story points, a currency the team itself mints, so if velocity became a target (someone asked them to "improve velocity," or it started appearing in reviews), the cheapest way to move it is to **estimate the same work as more points**. Yesterday's 3-pointer is today's 5-pointer; the number rises while throughput is flat. No dishonesty required — it's a rational response to a metric being made consequential, often even unconscious (surrogation: the team starts optimizing "points" without noticing they've forgotten it was a proxy).

How I'd confirm and respond: I would *not* praise the velocity jump. I'd look at **outcome metrics that points can't inflate** — actual lead time for changes, deployment frequency, cycle time, features delivered to users. If those are flat while velocity doubled, that's the signature of inflation, full stop. The fix isn't to police estimates harder (that just moves the gaming); it's to **stop treating velocity as anything but a private planning input** and to measure delivery by outcomes instead. The meta-point I'd make: this is *exactly why* velocity must never be a target — the divergence between "velocity" and "things actually shipping" is the tell that a proxy has been corrupted.

### Q6.3 — You're asked to design a way to measure a team safely. Walk me through your approach end to end.

> **Testing:** Whether you can synthesize the whole topic into a coherent design under the constraint "safely."

**A.** I'd build it from the five safe-design principles, made concrete:

1. **Start from outcomes, work backward.** Define what *value* this team is supposed to produce (user-facing reliability, time-to-market for their domain, a key business metric they influence). Those outcomes are the real target — even if imperfectly attributable.
2. **Choose team-level delivery metrics as the operational layer.** The four DORA metrics are the proven, *balanced* set — throughput paired with stability — so they're hard to game without genuine improvement. Add a quality pair (defect-escape or rework rate) if relevant.
3. **Add a developer-experience signal, qualitative.** A periodic survey or SPACE-style multi-dimensional read, so the human and unmeasurable dimensions (satisfaction, friction, flow) aren't ignored — defending against the McNamara fallacy.
4. **Lock in the guardrails.** Explicitly: **team-level only** (no individual breakdowns), **signals not targets** (no numeric quotas tied to reward), **team-owned** (the team reviews these in *its own* retros to improve, not a manager's dashboard to judge), and **kept out of performance reviews** entirely.
5. **Review the metrics themselves periodically** for surrogation and gaming — are we still steering by the goal, or have we started worshipping the proxy? Be willing to retire a metric that's decaying.

The framing I'd give: "safe" means the metrics serve *the team's own improvement of its system*, are *balanced* so gaming is visible, and are *insulated* from the high-stakes individual incentives that trigger Goodhart. If leadership wants to use them to rank people or set quotas, I'd push back hard, because that single change converts the whole design from a thermometer into a weapon.

### Q6.4 — A VP wants to compare two teams' velocities to decide where to cut headcount. How do you respond?

> **Testing:** Whether you can shut down a category error *and* the surveillance use in one move, diplomatically.

**A.** I'd flag two distinct problems. First, the **category error**: story points are calibrated *per team* — they're a relative, self-minted currency — so Team A's velocity and Team B's velocity are denominated in different units and **cannot be compared**, any more than you can compare prices quoted in two currencies without an exchange rate that doesn't exist here. A team with conservative estimates will look "slower" than an identical team with generous ones. So the comparison is meaningless on its face, and a headcount decision built on it would be built on noise.

Second, the **incentive damage**: the instant teams learn velocity drives headcount, every team inflates estimates to protect itself (Goodhart), the numbers become fiction across the board, and you've also incinerated trust. What I'd offer instead: if the real question is "where should we invest or cut," answer it with *outcomes and business context* — which teams own the highest-leverage work, what's the demand and roadmap, where are the actual delivery bottlenecks (which DORA *can* illuminate at the team level as a signal) — combined with managerial judgment. The one-liner: "Velocity can't answer this question; it's not a cross-team unit and using it this way would corrupt it everywhere. Let's look at outcomes and the actual business need instead."

---

## Theme 7 — Detecting and Recovering

### Q7.1 — How do you *detect* that a metric is being gamed or has been surrogated?

> **Testing:** Whether you can spot corruption in flight, not just warn about it in theory.

**A.** The master tell is **divergence between the proxy and the goal it was supposed to track.** If the metric is climbing but the *outcome* it stands for isn't — velocity up but nothing shipping faster, "bugs fixed" up but customer-reported defects flat, PR count up but lead time unchanged — the proxy has decoupled from reality, which is the signature of gaming or inflation. This is exactly why paired metrics matter: the partner metric makes the divergence visible (throughput up, stability down = the speed was fake).

Other concrete signals: **suspiciously smooth or suddenly-improved numbers** right after the metric became consequential; **behavior changes around the metric's definition** (work being re-sliced, reclassified, or timed to flatter the number); the metric **improving while qualitative signal worsens** (survey morale dropping, attrition rising, engineers privately saying "we're just gaming the dashboard"). For **surrogation** specifically, the tell is *conversational*: people start talking about the metric *as the goal* — "we need to raise our NPS" rather than "we need happier customers" — a sign they've forgotten it was ever a proxy. The discipline is to keep an *un-incentivized outcome measure* alongside any operational metric precisely so you can see when they part ways.

### Q7.2 — You inherit an org with a broken metrics regime — individual dashboards, velocity targets, metrics in reviews. How do you walk it back?

> **Testing:** Change management under political constraints. Whether you can fix a cultural mess, not just diagnose it.

**A.** Carefully and in order, because these systems are load-bearing and politically charged. My sequence:

1. **Understand before changing.** Map what's measured, what's incentivized, and *what behavior it's producing* — find the gaming and the fear so I can articulate the concrete harm (gamed numbers, hidden problems, killed collaboration) in terms leadership cares about.
2. **Decouple metrics from individual stakes first — that's the highest-harm linkage.** Get engineering metrics *out of performance reviews* and stop individual ranking. This is the change that immediately reduces gaming pressure, because it removes the high-stakes incentive driving it. Replace with manager judgment for evaluation.
3. **Reframe surviving metrics as team-owned signals.** Move dashboards from "management ranks teams/people" to "teams review their own delivery health in retros." Same numbers, inverted ownership and stakes.
4. **Introduce balanced outcome metrics** (DORA paired, plus real outcomes) to replace single-dimension output targets, so any remaining measurement is gaming-resistant by construction.
5. **Bring leadership along with the *why*.** This fails if it looks like engineering dodging accountability. I'd frame it as *more* accountability for what matters (outcomes, delivery performance) and less theater around numbers that were being gamed anyway — and cite the canon (Goodhart, DORA's explicit "don't evaluate individuals" guidance, Fowler) so it's clearly industry practice, not my preference.

The throughline: **remove the incentive linkage first** (that stops the bleeding), then **rebuild metrics as balanced, team-owned signals**, then **win the narrative** so it sticks. Trying to swap metrics without first removing the individual stakes just gives people new numbers to game.

### Q7.3 — A well-meaning manager says "we'll measure individuals but promise never to use it punitively — just for coaching." Is that safe?

> **Testing:** Whether you understand that the *promise* doesn't neutralize the mechanism, and the subtler surrogation/observer risks.

**A.** No, and it's a common, sincere mistake. Two problems. First, **the promise is fragile and the incentive is structural.** Even if *this* manager never uses it punitively, the data exists, the next reorg/manager/leadership change inherits it, and "just for coaching" quietly becomes "an input to calibration" and then "a factor in the stack rank." Goodhart doesn't care about intentions; it fires on *consequential use*, and individual data has a strong tendency to *become* consequential. Second, **surrogation and the observer effect bite even with pure intentions:** once individuals see they're measured, they optimize the metric (stop helping teammates, avoid unglamorous work) regardless of the stated purpose, because being measured *at all* changes behavior — and the manager may unconsciously start treating the metric as the definition of the person's value.

The safer alternative that gets the *actual* goal (coaching) without the trap: coach from **direct observation and qualitative signal** — code reviews, design discussions, peer feedback, 1:1s — which is richer for coaching anyway, and keep *measurement* at the team level. The reframe: "if the goal is coaching, you don't need a productivity metric for it — you need to be a present manager. And building individual measurement 'just for coaching' creates an asset that will be misused later and changes behavior now." Good intentions don't disarm Goodhart; not building the weapon does.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: State Goodhart's law in one line.** A: When a measure becomes a target, it ceases to be a good measure — because people optimize the proxy, not the goal.
- **Q: Goodhart vs Campbell in a phrase?** A: Goodhart = the *measure* decays under targeting; Campbell = the *process behind it* also decays under high-stakes use.
- **Q: What is surrogation?** A: Forgetting the metric is a proxy and treating it *as* the goal — psychological substitution, even without any incentive to game.
- **Q: Worst single productivity metric and why?** A: Lines of code — it's anti-correlated with value (good work deletes code) and trivially gamed by verbosity.
- **Q: One legitimate use of velocity?** A: A single team's short-term capacity planning input — never a target, never cross-team, never productivity.
- **Q: Why can't you sum story points across teams?** A: Points are calibrated per-team; they're different units, so summing or comparing them is a category error.
- **Q: The cardinal sin of engineering metrics?** A: Measuring/ranking *individuals* — fiction (it's a team sport), destroys collaboration, and statistically ranks noise.
- **Q: What does pairing metrics defend against?** A: Gaming — the cheap exploit for one metric is the expensive path on its paired opposite, so cheating becomes visible.
- **Q: Signal vs target in one line?** A: A signal you watch to ask better questions; a target you reward, which corrupts it (Goodhart).
- **Q: Fowler's core claim about productivity?** A: You can't measure it because you can't measure output (value); measure delivery performance instead.
- **Q: The McNamara fallacy?** A: Deciding only by what's measurable and presuming the unmeasurable is unimportant — then nonexistent.
- **Q: What did Tom DeMarco recant?** A: "You can't control what you can't measure" — he called it nonsense and shifted emphasis from control to value.
- **Q: Should DORA metrics go in performance reviews?** A: No — DORA explicitly says they're for improving the *system*, never for evaluating individuals.
- **Q: The cobra effect, in one line?** A: A bounty on dead cobras led to cobra *breeding* — paying for a proxy manufactures the opposite of the goal.
- **Q: Best first move when walking back a broken metrics regime?** A: Remove the individual stakes — get metrics out of reviews and ranking — *before* swapping metrics.
- **Q: "Measure the team, ___ the individual"?** A: *Manage* — metrics describe the system; managing a person is judgment, not a dashboard.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Proposing a **single productivity number**, or accepting the CEO's ask uncritically.
- Wanting to **measure or rank individuals** — and not flinching at "stack ranking."
- Treating **velocity / points / LOC / commits as productivity** or summing points across teams.
- Concluding from Goodhart that **all measurement is futile** (metric-nihilism) — the equal-and-opposite error to metric-worship.
- Putting **engineering metrics in performance reviews** and seeing no problem.
- "We'll measure individuals but promise not to misuse it" — not seeing why the promise fails.
- Citing Goodhart as a *slogan* with no grasp of the underlying mechanism.

**Green flags:**

- Naming the **distinction** (output/outcome, signal/target, measure/incentivize, team/individual) *and* the **mechanism** (Goodhart / Campbell / surrogation) before reaching for a dashboard.
- Holding the **narrow middle**: measure plenty, target almost nothing, never reward individuals for a proxy.
- Reaching for **paired/balanced metrics** as the structural anti-gaming defense, unprompted.
- Distinguishing **"productivity" (unmeasurable) from "delivery performance" (measurable)** cleanly.
- Citing the canon accurately — **Fowler, McNamara fallacy, DeMarco's recantation, Deming/red-bead, DORA's own guidance.**
- Turning the bad ask into **leadership**: refusing the single number *and* offering a defensible balanced alternative.
- Spotting gaming by **proxy/goal divergence** and removing **incentive linkage first** when recovering.

---

## Summary

- The bank reduces to four distinctions in costumes: **output vs outcome**, **signal vs target**, **measure vs incentivize**, **team vs individual.** Name the distinction *and* the failure mechanism before reaching for a metric.
- **The law family:** *Goodhart* — a measure used as a target stops being good (the proxy decays because people optimize it). *Campbell* — high-stakes use also corrupts the *process* behind the proxy. *Surrogation* — people forget the metric is a proxy and treat it as the goal. The mechanism is rational optimization of a consequential number, not dishonesty.
- **Bad productivity metrics** all fail the output/outcome test and are trivially gamed: LOC (anti-correlated with value; punishes deletion), commits/PRs (manufacture activity; undercount leverage), velocity (a *team-local planning input* miscast as productivity; inflates under pressure), story points (deliberately fuzzy estimates that *look* like throughput).
- **The cardinal sins** are fatal: measuring **individuals** (attribution is fiction, kills collaboration), **ranking** (statistically orders noise — Deming's red beads — and culturally corrosive), and **metrics in performance reviews** (the maximal target, guaranteeing Goodhart). *Measure the team, manage the individual.*
- **Safe design:** outcomes not outputs; team not individual; **paired/balanced** metrics (gaming becomes visible); **signals not targets** (feed curiosity, not quotas); **team-owned** (improvement, not surveillance). Each principle removes a precondition the failures need.
- **Why it's hard:** Fowler — productivity is unmeasurable because *output (value) is unmeasurable*; measure delivery performance instead. The **McNamara fallacy** — sliding from "unmeasurable" to "unimportant" to "nonexistent." **DeMarco recanted** "you can't control what you can't measure," shifting from control to value.
- **Detect** corruption by **proxy/goal divergence** (and let paired metrics expose it); **recover** by removing **individual stakes first**, then rebuilding metrics as **balanced, team-owned signals**, then winning the narrative with the canon.

---

## Further Reading

- Martin Fowler, *"CannotMeasureProductivity"* (martinfowler.com) — the definitive argument that developer productivity is unmeasurable, and what to do instead.
- Tom DeMarco, *"Software Engineering: An Idea Whose Time Has Come and Gone?"* (IEEE Software, 2009) — the recantation of "you can't control what you can't measure."
- W. Edwards Deming, *Out of the Crisis* — system thinking, the red-bead experiment, and why ranking individuals is statistically invalid.
- Forsgren, Storey, et al., *"The SPACE of Developer Productivity"* (ACM Queue, 2021) — the multi-dimensional answer that explicitly refuses any single metric.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- Original sources: Charles Goodhart (1975), Donald T. Campbell, *"Assessing the Impact of Planned Social Change"* (1979), and Daniel Yankelovich's formulation of the McNamara fallacy.

---

## Related Topics

- [01 — DORA Four Key Metrics](../01-dora-four-key-metrics/interview.md) — the balanced, team-level delivery metrics that *survive* this critique, and why DORA forbids individual evaluation.
- [03 — SPACE Framework](../03-space-framework/interview.md) — the multi-dimensional model built specifically to resist single-number reductionism and the failures cataloged here.
- [Engineering Metrics & DORA README](../README.md) — where anti-patterns sit in the broader metrics landscape.
- [Quality Engineering README](../../README.md) — the wider quality and measurement context.
