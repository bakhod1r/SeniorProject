# What Is Technical Debt — Interview Questions

> **Roadmap:** [Technical Debt Management](../README.md) → What Is Technical Debt
> *A debt interview rarely asks "define technical debt." It asks "a PM says 'just put it on the tech-debt backlog' — what do you say?", and then watches whether you can separate debt from bugs, principal from interest, and a deliberate trade-off from an accident. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — The Metaphor](#theme-1--the-metaphor)
3. [Theme 2 — Debt vs Not-Debt](#theme-2--debt-vs-not-debt)
4. [Theme 3 — Types of Debt](#theme-3--types-of-debt)
5. [Theme 4 — When Debt Is Rational](#theme-4--when-debt-is-rational)
6. [Theme 5 — Compounding and Danger](#theme-5--compounding-and-danger)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Communicating Debt](#theme-7--communicating-debt)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **principal vs interest** (the original shortcut vs what it costs you forever after)
- **deliberate vs accidental** (a chosen trade-off vs a mess you stumbled into)
- **debt vs defect** (correct-but-costly-to-change vs simply wrong)
- **the work vs the cost** (the messy code itself vs the drag it puts on every future change)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who treat technical debt as a *financial-cost concept* — a measurable drag on the speed of future change — and not as a synonym for "code I'd write differently." The single fastest way to fail this topic is to use "technical debt" as a label for any code you dislike.

---

## Theme 1 — The Metaphor

### Q1.1 — What is technical debt, in one sentence, and why is "debt" the right word?

> **Testing:** Whether you reach for the *financial* mechanics of the metaphor or just say "messy code."

**A.** Technical debt is the implied future cost of choosing an easier or faster solution now instead of a better one that would take longer. "Debt" is the right word because it has the two properties that make financial debt distinctive: you get something *now* (speed, an earlier ship date) in exchange for a *recurring* future cost, and that cost *compounds* — the longer it's outstanding, the more you pay. It's not just "bad code"; it's a deliberate or inadvertent trade of long-term carrying cost for short-term velocity. The metaphor earns its keep precisely because it makes an engineering decision legible as a financial one: you can take it on, service it, or pay it down.

### Q1.2 — What did Ward Cunningham *actually* mean by the metaphor? Most people get it wrong.

> **Testing:** Whether you know the original framing, which is subtly different from common usage.

**A.** Cunningham coined it in 1992 to explain to non-technical stakeholders why his team kept refactoring. His original meaning was about *understanding*, not sloppiness: you ship code that reflects your *current, partial* understanding of the problem, which is fine and even necessary — but as you learn more, you must fold that new understanding *back into the code*. The "debt" is shipping with an immature understanding; the "interest" is the slowdown you feel working in code that no longer matches what you now know; "repayment" is refactoring to reflect the better understanding. Crucially, **Cunningham's debt was about good code written with incomplete knowledge, not bad code written carelessly.** He later explicitly objected to the metaphor being used to excuse writing junk — "you don't deliberately write bad code as a way of going fast." That distinction is the whole point of the question: the people who only know the pop-culture "messy code = debt" version miss that the canonical definition is about the gap between your code and your evolving understanding.

### Q1.3 — Break down principal, interest, and interest *rate*. Why does separating them matter?

> **Testing:** Whether you can operationalize the metaphor instead of just gesturing at it.

**A.** Three distinct quantities:
- **Principal** — the one-time cost to actually *fix* the shortcut: the engineering effort to refactor the module, untangle the coupling, add the missing tests. It's what you'd pay to make the debt go away.
- **Interest** — the *recurring* tax the debt levies on every piece of work that touches it: features take longer, bugs are more frequent, onboarding is slower, every change carries extra risk. You pay this whether or not you ever fix the principal.
- **Interest rate** — *how fast* the interest accrues, i.e. how much drag per unit of work and how often that code is touched. This is the variable most people omit, and it's the one that decides what to pay down.

Separating them matters because **you prioritize by interest rate, not principal.** A large pile of ugly code in a module nobody touches has a high principal but a near-zero interest rate — leave it. A small, awkward abstraction at the center of the system that every feature must route through has a modest principal but a brutal interest rate — pay it first. The mistake is ranking debt by how *bad* it looks (principal) rather than by how much it *costs you per sprint* (interest rate). The right question is never "how ugly is this?" but "how much is this slowing us down, and how often do we pay?"

### Q1.4 — Where does the metaphor break down? Don't oversell it.

> **Testing:** Intellectual honesty — strong candidates know the model's limits.

**A.** It's a model, and models leak. Three places it breaks: (1) **Financial debt has a known principal and a contractual rate; technical debt's are both estimates** — you often can't quantify either precisely, which is why some teams distrust the term. (2) **Some technical debt has no fixed principal at all** — architectural debt can be effectively unpayable without a rewrite, more like a structural defect in a building than a loan. (3) **Interest on technical debt can be paid in defects, outages, and attrition, not just slower features** — costs the financial metaphor doesn't capture, and that land on people, not a balance sheet. So I use the metaphor as a *communication and prioritization* tool, but I don't pretend it's a precise accounting instrument. Overselling it ("we have $40,000 of technical debt") usually erodes trust faster than it builds it.

---

## Theme 2 — Debt vs Not-Debt

### Q2.1 — Distinguish technical debt from a bug. Aren't both "things wrong with the code"?

> **Testing:** The single most common category error in the whole topic.

**A.** No — they're different categories. A **bug** is code that produces *incorrect behavior*: it does the wrong thing relative to its spec. **Technical debt is code that behaves correctly but is costly to change** — it works, ships value, and passes its tests, yet its structure imposes a tax on future work. The clean test: *if the code does the wrong thing, it's a defect; if it does the right thing in a way that slows you down, it's debt.* They can coexist (debt makes bugs more likely, which is one form the interest takes), and the response differs: a bug needs a *fix* against a behavior spec, debt needs a *refactor* against a maintainability goal. Conflating them leads to two failures — logging genuine defects as "tech debt" to dodge urgency, and treating ordinary refactoring as if it were broken functionality.

### Q2.2 — What's the difference between technical debt and "cruft"?

> **Testing:** Whether you reserve "debt" for things with a trade-off, vs entropy.

**A.** **Cruft** is the low-quality residue that accumulates from entropy, carelessness, and neglect — dead code, copy-paste, inconsistent style, the slow rot of a codebase nobody is tending. **Debt**, in the disciplined sense, implies a *trade-off*: something was gained (speed, an earlier ship) in exchange for the carrying cost. The reason the distinction matters is that it changes the *response and the conversation*. Real deliberate debt was a decision, so it can be discussed as a decision — "we chose speed, here's the bill." Cruft was no decision at all; it's just decay, and calling it "debt" dignifies negligence with the language of strategy. Fowler's quadrant captures this: most cruft is "inadvertent" debt, and pretending all of it was a savvy trade-off is how teams excuse never having quality standards in the first place.

### Q2.3 — Is gold-plating technical debt? Why or why not?

> **Testing:** Whether you understand debt is about *under*-investment, and can spot its opposite.

**A.** Gold-plating is essentially the *opposite* of debt, and it's worth naming as its own failure. Debt is *under*-investing in quality/structure to go faster now. Gold-plating is *over*-investing — building flexibility, abstraction, or features nobody asked for, "just in case." Both are costs, but they have opposite signs and opposite cures. Debt's cure is to *add* engineering rigor (pay it down); gold-plating's cure is to *remove* speculative complexity (YAGNI). Importantly, **gold-plating frequently *creates* debt**: a speculative abstraction built for a future that never arrives becomes dead weight that every future change must navigate — over-engineering today is maintenance debt tomorrow. So calling gold-plating "debt" muddles the prescription: you'd respond by building *more*, when the right move is to build *less*.

### Q2.4 — Your teammate says "this whole module is technical debt — I'd never write it this way." Is it?

> **Testing:** Whether you can challenge the most pervasive *misuse* of the term.

**A.** Not necessarily, and I'd push back gently. "I'd write it differently" is an aesthetic or stylistic judgment, not a debt claim. Code that's unfamiliar, dated, or simply not to your taste is not automatically debt — debt is defined by *cost imposed on future change*, not by deviation from your preferences. The disciplined question is: "Is this code actually slowing us down — making changes slower, riskier, or buggier — *and* do we touch it enough for that to matter?" If a module is "ugly" but stable, rarely changed, and well-tested, its interest rate is near zero and rewriting it to taste would be *creating* risk to satisfy preference. The reason this matters beyond pedantry: when "tech debt" becomes a synonym for "code I don't like," the term loses all power to prioritize, every backlog fills with subjective rewrites, and leadership stops believing engineers when they raise *real* debt. Protecting the precision of the word is part of using it.

### Q2.5 — Why has "technical debt" become almost meaningless on some teams, and why should you care?

> **Testing:** Senior awareness that the term is routinely abused, and the cost of that abuse.

**A.** Because it became the catch-all bucket for everything engineers want to do but can't justify in product terms: refactors, rewrites, upgrades, pet projects, "code I dislike," even genuine bugs. Once it means everything, it means nothing — a "tech-debt backlog" with 400 undifferentiated items is just a graveyard, and a number like "we're 30% tech debt" is unfalsifiable. I care because the dilution has two concrete costs. First, **prioritization dies**: if everything is debt, you can't rank by interest rate, so the truly dangerous debt sits next to someone's naming preference. Second, **credibility dies**: leadership learns that "tech debt" is engineer-speak for "trust me," tunes it out, and then ignores the *legitimate* warning when the architecture is genuinely about to buckle. The senior move is to *narrow* the term — insist on naming the specific cost ("this coupling makes every checkout change a two-week regression cycle"), so the word keeps its teeth.

---

## Theme 3 — Types of Debt

### Q3.1 — Name the major *types* of technical debt and give a one-line example of each.

> **Testing:** Breadth — whether you know debt is more than "messy code."

**A.** Debt lives at every layer of the stack and the lifecycle:
- **Code debt** — duplication, long methods, poor naming, missing error handling. *Example:* the same validation logic copy-pasted across six handlers.
- **Design debt** — bad abstractions, leaky boundaries, violated principles within a component. *Example:* a "manager" class that knows about every other class.
- **Architectural debt** — the wrong large-scale structure: a distributed monolith, a missing seam between subsystems, the wrong database. *Example:* billing and auth share one schema, so neither can be deployed independently.
- **Test debt** — missing, flaky, or shallow tests; no safety net for change. *Example:* 12% coverage on the payments path, so nobody dares refactor it.
- **Documentation debt** — stale, missing, or misleading docs; knowledge trapped in one person's head. *Example:* the only deployment runbook is in a departed engineer's memory.
- **Infrastructure / build debt** — manual deploys, un-pinned toolchains, snowflake servers, slow CI. *Example:* a 45-minute build that everyone works around.
- **Dependency debt** — outdated, unmaintained, or vulnerable libraries; an old language/runtime. *Example:* pinned to a framework version that's two majors behind and EOL.

The point of enumerating them is that the *response* differs per type, and several are invisible in code review — test, dependency, and infra debt don't show up when you read a diff.

### Q3.2 — Which type of debt is the most expensive, and why?

> **Testing:** Whether you understand that cost scales with the *scope* and *reversibility* of the decision.

**A.** **Architectural debt**, almost always — for two compounding reasons. First, **scope**: architectural decisions (service boundaries, data ownership, the core domain model, sync vs async) sit *underneath* everything else, so their interest is paid by every team and every feature, not just the code that touches one module. Second, **reversibility**: code and design debt are local and refactorable in hours or days with a good test suite; architectural debt is woven through many components and often *cannot be paid down incrementally* — fixing it means coordinated change across teams, data migrations, and sometimes a rewrite. That's why it resists paydown (Theme 5) and why it's the debt most likely to become effectively permanent. The rule of thumb: **the higher up the decision and the harder it is to reverse, the more expensive the debt** — which is also why architectural debt should attract the most scrutiny *before* you take it on, since it's the kind you can't cheaply walk back.

### Q3.3 — Why is test debt especially dangerous, even though it's "just" missing tests?

> **Testing:** Whether you see test debt as a *multiplier* on all other debt.

**A.** Because test debt is the debt that *blocks the repayment of every other debt*. Refactoring — the act of paying down code, design, and architectural debt — is only safe when a test suite catches the regressions you'd otherwise introduce. Without that net, every refactor is a gamble, so the team stops refactoring, and all the *other* debt is now frozen in place and free to compound. Test debt thus has a uniquely high effective interest rate: it doesn't just cost you directly (more escaped bugs), it raises the interest rate on the entire rest of the portfolio by making it unsafe to pay anything down. This is why "we'll add tests later" is one of the most expensive shortcuts available — it quietly converts all your other debt from *serviceable* to *stuck*.

### Q3.4 — Where does security/dependency debt fit, and why do teams systematically under-weight it?

> **Testing:** Whether you connect debt to risk that's invisible until it detonates.

**A.** Dependency and security debt is the carrying cost of running outdated, unmaintained, or vulnerable components — an old framework, an EOL runtime, a library with known CVEs. Teams under-weight it for a specific reason: its interest is paid *non-linearly and externally*. Most debt charges you a steady, visible tax (features feel slower). Dependency debt charges *nothing* for months — the old library works fine — and then bills you catastrophically all at once when a CVE drops, the version goes EOL, or an upgrade you can no longer defer turns into a multi-week forced migration because you skipped ten smaller ones. The interest is real but *latent*, so it loses every prioritization fight against debt whose pain is felt today. The senior framing is that this is less "slow velocity" debt and more *uninsured risk*: you're not paying interest, you're holding a position that's fine until it isn't, and the xz/log4shell-class events are the reminder that the bill, when it comes, is an incident, not a sprint.

---

## Theme 4 — When Debt Is Rational

### Q4.1 — Is taking on technical debt always bad? Make the case for it.

> **Testing:** Whether you see debt as a *tool*, not a moral failing.

**A.** No — *deliberate, prudent* debt is often the correct engineering decision, exactly as a business taking a loan to seize an opportunity can be correct. The case: shipping has time value. Being first to market, validating an idea before over-building it, hitting a contractual deadline, or unblocking revenue can be worth far more than the interest you'll pay on a deliberate shortcut. The canonical example is a startup racing to product-market fit — perfectly architecting a product that no one wants is a far more expensive mistake than shipping a serviceable one fast and refactoring after you know it works. Cunningham's own framing supports this: you *ship to learn*, then fold the learning back in. The discipline isn't "never take debt"; it's **take it deliberately, name it, and have a plan to service it** — the failure mode isn't borrowing, it's borrowing unconsciously and never looking at the balance.

### Q4.2 — How does "cost of delay" change the calculus?

> **Testing:** Whether you can weigh debt against the *opportunity cost of being slow*.

**A.** Cost of delay is the value you forfeit for every unit of time you're *not* shipped — lost revenue, a competitor capturing the market, a missed regulatory deadline, a sales deal that needs the feature *now*. It's the other side of the ledger from interest. The debt decision is a comparison: *expected interest on the shortcut* versus *cost of delay of doing it "right."* When cost of delay is high and steep (a deal closes Friday or it's gone), accepting debt to ship is rational even if the interest is significant, because the alternative — being late — costs more. When cost of delay is low and flat (an internal tool with no deadline), there's little reason to incur debt; pay for quality now. The senior insight is that **most debt arguments are really cost-of-delay arguments in disguise**, and making both numbers explicit — even roughly — turns a vibes-based fight ("we don't have time" vs "we need to do it right") into a decision two reasonable people can actually make.

### Q4.3 — Should you write a prototype to production standards? Where does debt fit?

> **Testing:** Whether you understand *intentional, disposable* debt and the trap around it.

**A.** No — a true prototype's job is to *learn* (is this feasible, does the user want it?), and gold-plating throwaway code is waste. The right move is to take *maximal* deliberate debt: cut every corner, because the code is meant to be discarded. The fit is clean *as long as the prototype actually gets discarded.* The real danger isn't the prototype debt — it's the **"prototype goes to production" anti-pattern**: the demo works, the deadline looms, and the disposable code quietly becomes the foundation of the real system, dragging all its intentional shortcuts into permanence. So my answer has a condition: build the prototype cheap and dirty *on purpose*, but be ruthlessly explicit that it's disposable, and if there's any real chance it ships, that changes the decision — now it's not a prototype, it's an under-built product, and it deserves a deliberate-but-prudent quality bar instead.

### Q4.4 — What does "real options" / "options thinking" add to how you reason about debt?

> **Testing:** Senior depth — debt as a decision under uncertainty, not just a cost.

**A.** Options thinking reframes debt as managing *uncertainty*, and it cuts both ways. The first insight: **deferring a decision can be worth paying for.** When you don't yet know the right design — which is most of the time early on — committing to a "proper" abstraction now is buying something you can't price yet. Taking deliberate debt (a simple, even crude implementation) keeps your options open until you've learned enough to choose well; the interest you pay is the premium on that option. The second, sharper insight: **debt that removes future options is far more dangerous than debt that's merely costly.** Some shortcuts are reversible — you can refactor later. Others quietly close doors: a data model that can't be migrated, a vendor lock-in, a public API you can never change. The reversible kind is a cheap option; the irreversible kind is a sold option you can't buy back. So beyond "what's the interest?", I ask "**does this debt keep my options open or foreclose them?**" — because the foreclosing kind deserves resistance even when its near-term interest looks low.

---

## Theme 5 — Compounding and Danger

### Q5.1 — Explain *how* technical debt compounds. Why isn't it a fixed, one-time cost?

> **Testing:** Whether you understand the mechanism, not just the word "compounds."

**A.** It compounds because **new work builds on top of the debt, inheriting and amplifying it.** A shortcut in a core abstraction doesn't just cost you once; every feature added on top is shaped around the flaw, every workaround spawns a workaround, and duplication breeds more duplication because copying the existing (bad) pattern is the path of least resistance. So the principal itself *grows over time* — the longer the debt is outstanding, the more code depends on it and the more expensive it becomes to fix, exactly like unpaid interest being capitalized into the principal of a loan. There's also a cultural compounding: the broken-windows effect means a messy codebase signals that mess is acceptable, so quality erodes faster. The practical consequence is that debt is *cheapest to pay down early*, when little depends on it, and gets more expensive every sprint you defer — which is why "we'll deal with it later" is usually the most expensive option, not the cheapest.

### Q5.2 — What is the "death spiral" of technical debt? Walk me through the mechanism.

> **Testing:** Whether you can connect debt to its terminal, organization-killing failure mode.

**A.** The death spiral is the self-reinforcing loop where debt's interest crowds out the very capacity needed to pay it down:
1. Debt accumulates; the interest rate climbs (changes get slower and riskier).
2. To hit deadlines under that drag, the team takes *more* shortcuts — borrowing to pay the interest.
3. Velocity drops further; more time goes to fighting fires and fewer features ship per sprint.
4. Leadership, seeing slowing output, applies *more* schedule pressure, which forces *more* shortcuts.
5. The best engineers — who feel the drag most acutely — leave, taking system knowledge with them, which *raises* the interest rate again.
6. Repeat, accelerating, until the team can barely ship anything and a rewrite looks like the only escape.

The mechanism that makes it a *spiral* rather than a steady cost is the feedback loop: the symptom (slowness) triggers a response (more pressure, more shortcuts) that worsens the cause. Breaking it requires the counterintuitive move of *slowing down to speed up* — deliberately reallocating capacity to paydown — which is hardest to justify at exactly the moment it's most needed, because output is already low.

### Q5.3 — You said architectural debt "resists paydown." Why specifically?

> **Testing:** Whether you understand *why* the most expensive debt is also the stickiest.

**A.** For reasons that are structural, not motivational. (1) **It's non-local.** Code debt is contained in a function or file; you can fix it in isolation. Architectural debt — wrong boundaries, shared ownership, a central data model — is *woven through* dozens of components, so there's no small, safe, independently-shippable refactor. (2) **There's often no incremental path.** Many architectural fixes require getting from state A to state B with no working intermediate, which is the hardest kind of change to land in a live system; you can't half-migrate a database schema that two services depend on. (3) **It needs cross-team coordination**, which is organizationally expensive and easy to deprioritize when every team has its own roadmap. (4) **Conway's law fights you** — the architecture often mirrors the org chart, so "fixing the architecture" really means reorganizing teams, which is far beyond an engineering refactor. The combined effect is that architectural debt accretes into something the team learns to *route around* rather than fix, and the longer that goes on, the more the routing-around itself becomes load-bearing. That's why architectural debt is the debt to scrutinize hardest *before* taking it on — its near-irreversibility is the whole danger.

### Q5.4 — Can technical debt be a leading indicator of organizational failure? Defend it.

> **Testing:** Whether you see debt as a *systems and incentives* signal, not just a code property.

**A.** Yes — runaway debt is usually a *symptom* of a broken system, and reading it that way is more useful than treating it as a code-cleanliness problem. Sustained, accelerating debt almost always points to incentives that reward shipping and punish maintenance: deadlines set without slack, no budget for paydown, promotion criteria that count features and ignore stewardship, leadership that treats "it works in the demo" as "done." The debt is the *measurable residue* of those incentives. That's why I treat a spiraling debt trend as a leading indicator: declining velocity, rising defect rates, and lengthening change lead times predict missed roadmaps, attrition, and incidents *before* those show up in business metrics. The corollary is that you can't fix chronic debt purely with engineering effort — if the incentive system that produced it is intact, paydown gets re-borrowed within a quarter. Durable fixes are organizational: making maintenance a first-class, budgeted activity and giving teams the authority to protect quality.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — A PM says "just put it on the tech-debt backlog." What do you say?

> **Testing:** Whether you can resist the graveyard pattern and reframe debt in business terms.

**A.** I'd treat "the tech-debt backlog" as a smell, not a destination, and respond with three moves. First, **refuse the abstraction**: "Let's not file it as generic 'tech debt' — let's name the actual cost. This coupling means every checkout change needs a full regression pass, which is adding about a week to each of those features." Once it has a concrete, business-legible cost, it can be prioritized against features instead of exiled to a list nobody grooms. Second, **decide deliberately if we're taking it on**: if we're shortcutting now to hit a date, fine — but let's record *why*, what it'll cost, and a trigger for paying it back, not just drop it in a bucket. Third, **challenge the backlog itself**: a "tech-debt backlog" tends to become a write-only graveyard precisely because it's separated from the work; I'd rather attach paydown to the features that touch the affected code (you touch it, you improve it) and reserve a standing capacity allocation for the rest. The thing I would *not* do is accept "put it on the backlog" as a way to make the conversation end — that's how real debt gets laundered into invisibility.

### Q6.2 — Is rewriting from scratch ever the right answer? When, and when not?

> **Testing:** Judgment around the most seductive and most dangerous response to debt.

**A.** Rarely, and almost never for the reason people want it. The default answer is **no** — the famous failure mode (the "second-system" / big-bang rewrite) is that you throw away years of embedded bug fixes and edge-case knowledge, the rewrite takes 3x longer than estimated, the business freezes feature work during it, and you often arrive at a *new* mess having lost the old system's hard-won correctness. Incremental refactoring (e.g. strangler-fig, paying down debt behind a stable interface) is the right tool for the vast majority of debt. A rewrite is justified only in narrow cases: the technology is genuinely dead (unsupportable runtime, no hireable expertise), the architecture *cannot* support a now-essential requirement and there's no incremental path to one that can, or the cost of incremental change has provably exceeded the cost of replacement. Even then, the right shape is usually *incremental replacement* (strangle it module by module behind a façade), not a parallel big-bang build. So my answer is: rewrite is a last resort with a high burden of proof, the question behind the question is usually "can we refactor incrementally instead?", and the honest follow-up is that wanting a rewrite is often a sign the team has lost the *ability* to refactor — which a rewrite won't fix if the incentives that caused it persist.

### Q6.3 — Your manager says "we have no time for tech debt right now." How do you respond?

> **Testing:** Whether you can advocate for paydown *in the business's language* without being adversarial.

**A.** I wouldn't argue "quality matters" in the abstract — that loses to a deadline every time. I'd reframe it as the manager's own goal being at risk: "We're aligned that the priority is shipping the roadmap. The reason I'm raising this is that *this specific debt is what's making us slow* — the auth coupling is adding roughly a week to every feature in that area, so 'no time for debt' is actually costing us time on the very features we're prioritizing. I'm not asking to stop and refactor everything; I'm proposing we fix this one thing *as part of* the next feature that touches it, which makes that feature ~30% faster and every one after it cheaper." Three things make that work: I quantify the interest in time/risk the manager already cares about, I tie paydown to delivery rather than positioning it as a competing activity, and I offer a *small, scoped* ask instead of an open-ended "we need a refactoring sprint." If the answer is still no, I document the decision and the projected cost — not to be passive-aggressive, but so that when the interest comes due, the trade-off was a *recorded shared decision*, not a surprise I'm blamed for. The senior posture is: make the cost visible and the choice the business's, then respect the business's call.

### Q6.4 — A junior engineer wants to refactor a "horrible" 800-line function that hasn't changed in two years. Approve it?

> **Testing:** Whether you apply *interest rate* to a real prioritization call, against the temptation to clean.

**A.** Probably not, and the conversation is more valuable than the verdict. The key facts are buried in the prompt: *hasn't changed in two years* and *horrible* are pulling in opposite directions. "Horrible" speaks to high principal; "unchanged in two years" means a near-zero interest rate — we are paying almost nothing to carry it. Refactoring it is pure *cost and risk* (you can introduce bugs into stable, working code) for a benefit (easier future changes) we have two years of evidence we won't collect. So I'd ask the junior the interest-rate questions: how often do we touch this, is it slowing any actual work, is there a feature coming that needs it changed? If the honest answers are "never / no / no," then this is "code I don't like," not debt worth paying — and rewriting it to taste is *creating* risk to satisfy aesthetics. The exception that flips it: if it's about to become a hotspot (a roadmap item needs to change it heavily), refactoring it *first, behind tests* is exactly right — pay the debt when you're about to start paying the interest. The teachable point is that "ugly" and "expensive" are different axes, and we spend our refactoring budget on the *expensive*, not the ugly.

### Q6.5 — You're asked to add one small feature and discover the area is a minefield of debt. How do you proceed?

> **Testing:** The day-to-day judgment of refactoring *around* debt without boiling the ocean.

**A.** I scope my refactoring to the *blast radius of my change*, not to the whole minefield — the discipline is "leave it cleaner than you found it," not "fix everything you can see." Concretely: I do enough refactoring to make *my* feature safe and clean (the "make the change easy, then make the easy change" sequence — first reshape the local code so the feature drops in cleanly, then add it), I cover the area I'm touching with tests so the change is safe, and I stop at the edges of what my feature actually requires. The debt outside that radius I *document* — a ticket with the concrete cost and a note that this area is a hotspot — rather than silently absorbing an unbounded refactor into a small feature, which would blow my estimate, balloon the review, and mix risky cleanup with the change in a way that's hard to review or revert. If the minefield is bad enough that I *can't* land the small feature safely without a larger investment, that's a signal to surface explicitly to my lead with the cost, not a thing to quietly heroically swallow. The balance is real: under-refactoring leaves the boy-scout rule unhonored and the area rots; over-refactoring turns every small feature into an unbounded, high-risk rewrite. Scope to the change.

---

## Theme 7 — Communicating Debt

### Q7.1 — Explain technical debt to a non-technical executive in a way that drives a decision.

> **Testing:** Whether you can translate an engineering concept into the language of money, risk, and time.

**A.** I lean *into* the financial metaphor because it's already in their language, and I keep it concrete: "We made some deliberate shortcuts to hit the launch — that was the right call. Like a loan, those shortcuts came with interest: right now we're paying about 20% of every engineering week working *around* them instead of building new things. The interest is also compounding — it's a little worse each quarter. We can keep paying it indefinitely, or we can spend roughly three weeks now to pay down the principal and get most of that 20% back permanently." The moves that make this land: I express interest as a *percentage of capacity or a delivery slowdown* (a number they feel in roadmap terms), I frame paydown as an *investment with a return* (3 weeks now buys back ongoing capacity), and I present a *choice with consequences* rather than a complaint. What I avoid is jargon ("the abstraction is leaky"), moralizing ("the code is bad"), and fake precision ("we have $40K of debt") — executives decide on risk and ROI, so I give them risk and ROI.

### Q7.2 — How do you make technical debt *visible* and *measurable* so it's not just "trust me"?

> **Testing:** Whether you can ground the abstraction in evidence rather than feeling.

**A.** The goal is to convert "the code is bad" into trends a non-engineer can track, while being honest that no single metric *is* debt. I'd point at a few corroborating signals: **change lead time and deployment frequency trending the wrong way** (debt's interest showing up as slowing delivery — the DORA metrics), **defect/escape rate and time-in-rework rising** (interest paid in bugs), **change failure rate** on debt-heavy areas, and **code-level hotspot analysis** — overlaying churn (how often a file changes) with complexity to find the files that are both complex *and* frequently touched, which is a direct proxy for high interest rate. I'd also keep a lightweight, *named* debt register — not a 400-item graveyard, but a short list of significant items each with its concrete cost and affected area. The framing I'm careful about: these are *indicators*, not a ledger; I present a *pattern* across several of them ("lead time up 40%, hotspots concentrated in checkout, escape rate doubled there") rather than claiming a single number measures debt, because overclaiming precision is how engineers lose credibility on this topic.

### Q7.3 — How do you talk about debt *you and your team created* without it becoming blame?

> **Testing:** Maturity — debt as a normal engineering reality, not a confession.

**A.** I normalize it as the expected outcome of shipping under uncertainty, not a failure to apologize for. The framing is forward-looking and systemic: "Every system that ships and survives accumulates debt — it's a sign we've been delivering, not that someone messed up. Some of this was a deliberate trade we'd make again; some we'd do differently knowing what we know now. Either way the question isn't *whose fault* — it's *what's the interest now and what's worth paying down.*" Two things keep it blame-free: I separate the *decision* from the *outcome* (a shortcut taken with good reasons under the information available was a reasonable bet, even if it aged poorly), and I focus the conversation entirely on the *current cost and the path forward* rather than the history. Blame is not just unpleasant, it's *counterproductive* — it makes engineers hide debt instead of surfacing it, which is the opposite of what I want. The culture I'm trying to build is one where flagging "this is getting expensive" is rewarded, because debt you can see is debt you can manage.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Technical debt in one line?** A: The implied future cost of choosing a faster, easier solution now over a better one — a recurring, compounding tax on the speed of future change.
- **Q: Principal vs interest?** A: Principal is the one-time cost to fix the shortcut; interest is the recurring drag you pay on every change while it's outstanding.
- **Q: What do you prioritize debt by?** A: Interest *rate* — drag per change × how often the code is touched — not by how ugly it looks (principal).
- **Q: Debt vs bug?** A: A bug does the wrong thing (needs a fix); debt does the right thing in a costly-to-change way (needs a refactor).
- **Q: Is "code I'd write differently" debt?** A: No — that's preference; debt is defined by *cost imposed on future change*, not deviation from your taste.
- **Q: Who coined it and what did he really mean?** A: Ward Cunningham (1992) — shipping code that reflects your *current, incomplete understanding*, then folding new learning back in; not "bad code."
- **Q: Most expensive type and why?** A: Architectural — it's underneath everything (broad interest) and hard to reverse (resists incremental paydown).
- **Q: Why is test debt special?** A: It blocks paydown of *all other debt* by making refactoring unsafe — a multiplier on the whole portfolio's interest rate.
- **Q: Is all debt bad?** A: No — deliberate, prudent debt to ship faster is often correct; the failure is *unconscious* debt with no plan to service it.
- **Q: Gold-plating — is it debt?** A: It's the opposite (over-investment), and it often *creates* debt; cure is YAGNI, not more engineering.
- **Q: What's the "death spiral"?** A: Interest crowds out paydown capacity → more shortcuts → slower → more pressure → attrition → faster, until only a rewrite seems possible.
- **Q: Is a rewrite the answer?** A: Almost never; incremental refactoring (strangler-fig) wins, except for dead tech or a truly unsupportable architecture — and even then, incremental replacement.
- **Q: Best way to explain debt to an exec?** A: As money/time — interest as a % of lost capacity, paydown as an investment with a return, framed as a choice not a complaint.
- **Q: One metric that proves debt?** A: None — present a *pattern* (lead time, defect/change-failure rate, churn×complexity hotspots); a single number overclaims.
- **Q: Cheapest time to pay debt?** A: Early — before much code depends on it, since principal grows as it compounds.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Defining technical debt as "messy code" or "code I don't like" — missing the financial, cost-of-change core.
- Conflating debt with bugs (or laundering real defects as "tech debt" to dodge urgency).
- Prioritizing debt by how *ugly* it is (principal) rather than how much it *costs per change* (interest rate).
- Treating all debt as bad / a moral failing — no notion of deliberate, prudent debt.
- Reaching for a rewrite as the default cure.
- "Just put it on the tech-debt backlog" with no instinct that the bucket is a graveyard.
- Claiming a single number ("we're 30% tech debt", "$40K of debt") *is* the debt.
- Wanting to refactor stable, never-touched code because it offends them.

**Green flags:**
- Separating **principal / interest / interest rate** and prioritizing by *rate*.
- Knowing Cunningham's *original* meaning (incomplete understanding) and that he objected to the "excuse for junk" reading.
- Distinguishing debt from bugs, cruft, and gold-plating *crisply* and explaining why the distinction changes the response.
- Framing debt decisions as **cost of delay vs interest**, and naming the *deliberate-vs-accidental* axis.
- Treating debt as a *prioritization and communication* tool — translating it into money/time/risk for non-engineers.
- Recognizing architectural and test debt as the dangerous, high-leverage kinds and explaining *why*.
- Caveating tradeoffs ("a rewrite is a last resort *and* often a sign we've lost the ability to refactor, which it won't fix").
- Reading runaway debt as a *systems/incentives* signal, not just a code property.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **principal vs interest (rate)**, **deliberate vs accidental**, **debt vs defect**, **the work vs the cost**. Treat debt as a *financial-cost* concept — a drag on the speed of future change — not a synonym for code you dislike.
- **The metaphor:** debt buys speed now for a recurring, *compounding* cost later. Cunningham's original meaning was shipping with incomplete understanding and folding learning back in — not careless code. Prioritize by **interest rate** (drag × frequency-of-touch), not principal.
- **Debt vs not-debt:** a bug does the wrong thing; debt does the right thing at a cost. Cruft is entropy without a trade-off; gold-plating is *over*-investment (and a debt *source*). "Code I'd write differently" is preference, and diluting "debt" into a catch-all kills both prioritization and credibility.
- **Types:** code / design / architectural / test / doc / infra / dependency. **Architectural** is most expensive (broad scope, poor reversibility); **test debt** is a multiplier that freezes all other paydown; **dependency/security** debt is latent risk that bills as an incident.
- **When rational:** deliberate, prudent debt to capture time-value is often correct — weigh *cost of delay* against *interest*, take prototype debt only if it stays disposable, and watch whether debt *keeps options open or forecloses them*.
- **Compounding/danger:** debt grows as new work builds on it; the **death spiral** is interest crowding out paydown capacity in a feedback loop; **architectural debt resists paydown** because it's non-local, often non-incremental, and tangled with the org chart. Runaway debt is a leading indicator of broken incentives.
- **Scenario/communication:** refuse the "tech-debt backlog" abstraction and name the concrete cost; rewrites are a last resort behind incremental refactoring; advocate paydown in the *business's* language (interest as % of capacity, paydown as ROI); make it measurable via *patterns* (DORA metrics, churn×complexity hotspots), not a single number; and keep the conversation blame-free so debt gets surfaced, not hidden.

---

## Further Reading

- Ward Cunningham, "The WyCash Portfolio Management System" (OOPSLA '92) and his later "Debt Metaphor" video — the primary source; read it to see how far pop usage has drifted from the original.
- Martin Fowler, "Technical Debt" and "Technical Debt Quadrant" (martinfowler.com) — the deliberate/inadvertent × prudent/reckless framing behind much of Theme 2 and Theme 4.
- *Managing Technical Debt* (Kruchten, Nord, Ozkaya / SEI) — the rigorous, research-grounded treatment of types, measurement, and paydown.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [03 — The Debt Quadrant](../03-the-debt-quadrant/interview.md) — the deliberate/inadvertent × prudent/reckless model that sharpens "when is debt rational."
- [05 — Paying Down Debt](../05-paying-down-debt/interview.md) — strategies, prioritization, and the boy-scout-rule-vs-rewrite questions that follow from this foundation.
- [Quality Engineering README](../../README.md) — where technical-debt management sits in the broader interview landscape.
