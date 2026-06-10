# The Craftsman's Ethics & Oath — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — the professional and ethical commitments that separate a software craftsman from someone who merely types code that compiles.

Conceptual questions graded junior → professional, plus ethical-scenario, trick, and behavioral questions. Ethics interviews test *judgment under pressure*, not memorization — so most answers below include the reasoning, not just the conclusion.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Ethical-Scenario Questions](#ethical-scenario-questions)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What does professional ethics mean for a software developer?

**Answer:** The standards governing *how* you do the work — safely, honestly, and maintainably — beyond just whether the feature ships. It answers questions the compiler never asks: is this safe, is it understandable to the next person, was I honest about the cost, could it hurt someone?

### J2. Why isn't "it compiles" (or "the tests pass") enough?

**Answer:** A green build verifies syntax and a subset of behavior. It says nothing about whether the code is *correct* for untested inputs, *safe* (data leaks, money bugs), *readable/changeable* by the next person, or whether you were *honest* about the cost and risk. Those are human commitments. The professional bar is "would I sign my name to this after it fails?"

### J3. What is the Programmer's Oath?

**Answer:** Robert C. Martin's 2015 set of about nine promises a professional programmer makes — modeled on the Hippocratic Oath. Roughly: do no harm, always do your best work, prove every element works each release, make small frequent releases, fearlessly improve, keep productivity high, ensure others can cover for you, estimate honestly, and never stop learning.

### J4. What is the Software Craftsmanship Manifesto, in one sentence?

**Answer:** A 2009 extension of the Agile Manifesto that raises the bar by valuing "not only working software but also **well-crafted** software," plus steadily adding value, a community of professionals, and productive partnerships.

### J5. Does the Craftsmanship Manifesto reject Agile?

**Answer:** No. Its form is "**not only** X **but also** Y" — purely additive. It keeps every Agile value (working software still matters enormously) and adds a quality dimension on top. Working software is the floor, not the ceiling.

### J6. Name one Oath promise that maps directly to a practice you already use.

**Answer:** "Provide a quick, sure, repeatable proof that every element works" → automated testing / TDD. Or "fearlessly improve" → refactoring. Or "frequent small releases" → continuous integration.

### J7. What is the Boy Scout Rule?

**Answer:** Leave the code a little better than you found it — make one small improvement every time you touch a file. It's Oath promise 5 (relentless improvement) in miniature, and it keeps a codebase from rotting incrementally.

---

## Middle Questions

### M1. Walk through what each Oath promise obligates you to do concretely.

**Answer:** (Abbreviated.) 1 — don't ship code that harms users/society/other programmers. 2 — don't *knowingly* let behavioral or structural defects accumulate. 3 — automated, fast, reliable proof on every release. 4 — small batches so failures are cheap to reverse. 5 — refactor fearlessly (needs the tests from #3), never degrade. 6 — don't speed yourself up at the team's expense. 7 — share knowledge; no bus-factor-of-one. 8 — honest estimates in magnitude *and* precision. 9 — keep learning as the field changes.

### M2. How do the two halves of the Oath differ?

**Answer:** Promises 1–5 are about the **code** (do no harm, best work, prove it, ship small, improve). Promises 6–9 are about **you and your team** (productivity, replaceability, honest estimates, learning). Many mid-career engineers are strong on the first half and weak on the second.

### M3. What's the structural difference between "over" (Agile) and "not only … but also" (Craftsmanship)?

**Answer:** Agile's "A over B" *prefers* A while keeping B's value — a choice between two things. Craftsmanship's "not only B but also A" is **additive** — it keeps B *and* adds A. Craftsmanship doesn't replace working software; it adds "well-crafted" on top.

### M4. Define "well-crafted software."

**Answer:** Software that is correct *and also* tested, readable, changeable, simple, and honest — the litmus test being that a stranger can safely modify it six months after you've left. "Working" is a claim about today; "well-crafted" is a claim about every tomorrow.

### M5. Promise 8 says estimates must be honest in "magnitude and precision." What does precision-honesty mean?

**Answer:** Communicating your *uncertainty*: a range, a three-point (best/likely/worst) estimate, or "I need a spike first" — instead of a confident single number you have no basis to believe. Faking precision is a form of lying.

### M6. Give two honest criticisms of the Programmer's Oath.

**Answer:** Any two of: it's not officially/legally adopted (moral weight only); it reads as absolutist and clashes with real deadlines; it centers individual virtue while many failures are organizational; "do no harm" is hard to operationalize for diffuse harm. The mature view: it's a compass, not a contract.

---

## Senior Questions

### S1. What's the central tension in software ethics, and what's wrong with framing it as "quality vs speed"?

**Answer:** The tension is short-term pressure (deadline, cost, unhappy stakeholder) vs long-term integrity (safety, honesty, maintainability). "Quality vs speed" is misleading because over a sustained period they don't trade off linearly — clean, well-tested code is what *lets* you go fast, since you're not fighting past shortcuts. "The only way to go fast is to go well."

### S2. When is cutting a corner an acceptable professional decision?

**Answer:** When it is **conscious** (you know you're doing it), **temporary** (there's a plan to repay), and **disclosed** (accountable owners know). That's a legitimate business trade-off. Lose any one — unconscious, permanent, or hidden — and it becomes the first step of a disaster.

### S3. Why is "I'll try" dangerous?

**Answer:** It takes on the *obligation* of "yes" while dodging the *commitment* of "yes" — committing you to a result you don't believe in and skipping the honest negotiation of scope/date/risk. A professional either commits and means it, or declines and offers real alternatives.

### S4. Does "I was just following orders" clear you?

**Answer:** Not for safety or legality — you hold specialized knowledge the order-giver lacks, so your duty is to make the consequence visible and refuse genuinely harmful or illegal work regardless of approval. For quality/schedule trade-offs, an *informed* manager accepting a *disclosed* risk does shift the decision to the business, where it belongs.

### S5. Pick one of the famous engineering disasters and explain its ethical lesson.

**Answer (example — 737 MAX):** MCAS could push the nose down from a *single* non-redundant sensor; it was hidden from pilots and downplayed to regulators to avoid pilot-retraining cost; internal engineers were overruled. Lesson: business pressure overrode engineering judgment, defense-in-depth (sensor redundancy) was stripped to save money, and honest disclosure (promise 8 / public-interest duty) failed — killing 346 people. Saying no internally happened and was ignored, which is why external oversight exists.

### S6. What is the "normalization of deviance"?

**Answer:** Diane Vaughan's term (from Challenger): each small deviation from the safe standard goes unpunished, becomes the new normal, and lowers the bar for the next one — until the last safeguard is gone. It's the shared DNA of Therac-25, Dieselgate, the 737 MAX, and Knight Capital. The craftsman's ethic is the discipline of stopping at the *first* normalized deviation.

### S7. When does technical debt become an ethical issue?

**Answer:** When it's **hidden or denied** — taken in the organization's name without informing accountable owners, so they decide on a false picture of risk and the bill lands on someone who never consented (the on-call engineer, the user). Disclosed, deliberate, repayable debt is a legitimate tool; concealed debt is the failure.

---

## Professional Questions

### P1. How do you make an ethic survive at scale, not just in yourself?

**Answer:** Build it into the *system*: quality gates in CI, a definition of done that includes tests/review, blameless postmortems, hiring and promoting for craft, and leadership that defends the standard under pressure. Ethics built on exceptional individuals fails because they're finite and they leave; ethics built into the pipeline and the incentives survives turnover.

### P2. What do the ACM / IEEE codes add that the Programmer's Oath doesn't?

**Answer:** They're *formally adopted* by professional bodies (not one person's proposal), and they explicitly rank duties — in the IEEE/ACM Software Engineering Code, **the public interest (Principle 1) is paramount and overrides the employer (Principle 2)**. That's the institutional answer to Dieselgate/MAX: when your employer conflicts with public safety, the public wins.

### P3. Distinguish estimate, target, and commitment.

**Answer:** Estimate = your honest assessment of likely effort (engineering output). Target = what the business wants. Commitment = what you promise. Dishonesty enters when "estimate lower" really means "make the estimate match the target." The fix: hold the estimate honest and negotiate *scope* or *date* instead.

### P4. What is a blameless culture, and what does it optimize for?

**Answer:** A culture that assumes people acted reasonably given what they knew and asks "how did the *system* allow this?" rather than "who screwed up?" It optimizes for **disclosure and learning** (people surface mistakes, so the system gets safer). Blame culture optimizes for **concealment** (people hide mistakes), which is how Therac-25's reports and the MAX's concerns got buried. Blameless ≠ no accountability — you're still accountable for honesty and follow-through.

### P5. How do you mentor a junior into the ethic?

**Answer:** Mostly by *modeling under pressure* — let them see you say no, disclose your own debt in a PR, own a mistake in a postmortem. Teach the "why" with the real disasters (engineers went to prison for Dieselgate). Make quality the easy path via pairing and pipelines. Protect their right to raise concerns even when wrong. The test: if you left, would they still refuse a dangerous shortcut?

### P6. As a lead, the business hands you an impossible deadline. What's your duty?

**Answer:** Absorb the pressure rather than transmit it amplified. Negotiate scope or date with honest estimates upward (don't shave the team's estimate to look good). Protect the team's ability to do quality work, and make the trade-off explicit to the business in their terms. Owning the failure publicly if overruled, sharing credit for success.

---

## Ethical-Scenario Questions

These are the heart of an ethics interview. There is rarely one "right" answer — interviewers are watching your *reasoning* and whether you reach for escalation, disclosure, and alternatives rather than silent compliance or self-righteous refusal.

### E1. The PM says: "Ship it Friday without writing tests — we'll add them later." What do you do?

**Strong answer:** Don't silently comply, and don't just refuse. First, make the *cost of yes* concrete and in their terms: *"Shipping the payment path untested means if it has a bug we won't catch it before customers' cards are charged wrong — that's a refund storm and a trust hit."* Then offer real alternatives: ship Friday with a *smaller* tested scope, or ship the full feature tested by Tuesday. If the area is low-risk and the PM, fully informed, accepts a disclosed, *temporary* gap with a tracked ticket to add tests — that's a legitimate business decision; document it and proceed. If it's a safety/money path and they want the gap *hidden* or *permanent*, that's where you escalate. Note "we'll add them later" almost never happens without a ticket and commitment, so insist on those.

**What they're testing:** Do you reach for disclosure + alternatives, or do you either cave or grandstand?

### E2. You discover your company's code is doing something you think is unethical (e.g., quietly logging more user data than the policy admits). What's your sequence of actions?

**Strong answer:** Walk the escalation ladder: (1) confirm the facts — am I sure this is what it does and that it's actually wrong, not a misunderstanding? (2) raise it to my lead/manager with specifics and the concrete risk (legal exposure, user trust, regulatory breach). (3) if ignored, escalate in writing up the chain and to relevant internal authorities (legal, privacy/DPO, ethics). (4) only if the harm is serious, evidence is solid, and internal channels have genuinely failed, consider external (regulator). Whistleblowing is a costly last resort, not a first move. Throughout, document.

**What they're testing:** Do you have a calibrated escalation model, or do you jump straight to either "say nothing" or "go to the press"?

### E3. Your manager asks you to write code that you realize is a "defeat device" — it behaves differently when it detects it's being audited. What do you do?

**Strong answer:** This is the Dieselgate scenario, and the answer is a hard no. Code whose purpose is to deceive a regulator or auditor is fraud; "I just implemented the spec" failed as a defense in court and put an engineer in prison. I'd refuse to build it, state plainly why (it's illegal deception, and I won't participate), escalate above the manager, and if the company insists, this is exactly the situation where leaving and/or reporting is warranted. There's no "informed acceptance" that clears me here, because the public/legal interest is paramount.

**What they're testing:** Do you recognize that *intent to deceive* moves this out of the negotiable zone entirely?

### E4. You're 80% sure a feature has a security flaw, but you can't prove it, and the launch is tomorrow. What do you do?

**Strong answer:** Make the uncertainty and the stakes explicit to the decision-maker — "I have an unproven but credible concern that X could leak data; I can't confirm it before tomorrow." Propose the cheapest risk-reduction: a timeboxed spike tonight, a feature flag so we can ship dark and kill it instantly, or a delayed launch of *just* that surface. Don't bury the concern to avoid being the person who delayed the launch (that's how the MAX concerns got buried), and don't unilaterally block a launch on a hunch without giving the owner the informed choice. If they accept the risk fully informed *and* it's not a catastrophic harm, that's their call to make; document it.

**What they're testing:** Calibration — making risk visible and offering mitigations, rather than either crying wolf or staying silent.

### E5. A teammate is cutting corners (skipping tests, leaving messes) and it's dragging the team down. How do you handle it?

**Strong answer:** Start with the assumption of good faith — maybe they're under pressure I don't see. Talk to them directly and privately first, framed around the team impact (Oath promise 6) not personal criticism. Offer to pair so the right way is the easy way. Use *systemic* fixes too — strengthen the definition of done and CI gates so the corner can't be cut silently regardless of who's writing the code (depersonalizes it). Escalate to a lead only if it continues and is genuinely harming the product. The systemic fix is more durable than the conversation.

**What they're testing:** Do you reach for empathy + systemic guardrails, or straight to blame/escalation?

---

## Trick Questions

### T1. "A good developer should be able to write any feature the business asks for." True?

**Misleading.** *Capability* isn't the issue; *judgment* is. A professional's value includes the ability to say no to features that are unsafe, deceptive, or illegal — the defeat device is something a "good developer" is precisely the person who *refuses* to build. Skill is morally neutral; choosing what to build with it is not.

### T2. Does the Software Craftsmanship Manifesto value clean code *over* working software?

**No — a common misread.** It's "not only working software but **also** well-crafted software." It keeps working software as essential (a beautiful codebase that doesn't solve the user's problem is still a failure) and adds quality on top. It never says "instead of."

### T3. If my manager signs off on shipping the risky thing, am I off the hook?

**It depends on what kind of risk.** For a *quality/schedule* trade-off that you disclosed and they accepted while informed — yes, the call moved to the business. For *safety or legality* — no. You cannot help build something that injures people or breaks the law because a boss approved it; the public-interest duty is paramount over the employer.

### T4. Is the Programmer's Oath an enforceable professional standard like a doctor's license?

**No.** It's one influential person's articulation of professional duty, with moral weight but no licensing body, no enforcement, and no revocation. The ACM/IEEE codes are *formally adopted* but still aren't licenses for most developers. The field has consensus articulations of duty, not (yet) a regulated license.

### T5. "We'll add the tests later" — is agreeing to that ever ethical?

**Sometimes — but only conditionally.** It's ethical only if the debt is conscious, *disclosed*, tracked as a real commitment (ticket + owner + date), temporary, and not on a safety/money-critical path. The phrase is usually a red flag because "later" rarely comes without that structure. Agreeing to *hidden* or *open-ended* "later" is the ethical failure.

### T6. Isn't holding the ethic just being slow and difficult?

**No.** Every disaster in this topic came from teams that were "fast" by cutting corners and then paid catastrophically. Sustained speed *comes from* quality. And "saying no" isn't being difficult — it's the profession functioning correctly, exactly like an engineer refusing to sign off on an unsafe bridge.

---

## Behavioral Questions

### B1. Tell me about a time you had to say no to a stakeholder.

**Sample:** "A PM wanted a payments change shipped before a holiday freeze, untested. I didn't just refuse — I made the cost concrete ('an untested charge path means we could double-bill customers over the holiday with no one on call to fix it'), then offered two real options: a smaller tested scope before the freeze, or the full feature right after. We took the smaller scope. The key was saying no to the *date and scope* while staying committed to the *goal*, and giving them an informed choice rather than a flat wall."

### B2. Describe a mistake you made in production and how you handled it.

**Sample:** "I shipped a migration that locked a hot table and caused a 20-minute outage. I owned it immediately in the channel, rolled back, and then wrote a blameless postmortem focused on *why the system let it happen* — we had no staging test for migration lock behavior. The fix was a CI check, not 'be more careful.' What I'd want a hiring manager to hear: I disclosed fast, fixed the systemic gap, and didn't hide it — that's the accountability that matters."

### B3. Have you ever disagreed with cutting a corner that the team decided to cut anyway?

**Sample:** "Yes — I argued against shipping without an audit log on a financial feature. I lost the argument, but I made sure the decision was *documented* as a conscious, disclosed trade-off with a ticket to add it next sprint, and I named the specific risk in writing. It got added the following sprint. My takeaway: when you're overruled on a disclosed trade-off, your job shifts to making it *conscious and tracked* rather than letting it quietly become permanent."

### B4. How do you keep learning given how fast the field moves?

**Sample:** "I treat it as part of the job, not a hobby — Oath promise 9. I do deliberate practice through katas, I review code specifically to learn from others' approaches, and I pick one substantial new area per year to go deep on. I also see it as an *obligation that grows with seniority*: the more juniors trust my advice, the more harmful it is if that advice goes stale."

### B5. Tell me about building or strengthening quality culture on a team.

**Sample:** "I introduced blameless postmortems and a CI gate requiring tests for changed code. The postmortems were the bigger win — once people saw that disclosing a mistake led to a systemic fix instead of a scolding, they started surfacing near-misses we'd never have heard about. The point was to make the *system* hold the standard so it didn't depend on me being in every review."

---

## Tips for Answering

1. **Reach for the escalation ladder, not the extremes.** In any scenario, the worst answers are silent compliance and self-righteous refusal. The strong answer is: make the cost visible → offer alternatives → escalate with data → document → (rarely) external.
2. **Separate the negotiable from the non-negotiable.** Quality/schedule trade-offs are the business's call once informed; safety and legality are never cleared by approval.
3. **Use "conscious, temporary, disclosed"** as your test for whether a shortcut is ethical.
4. **Cite a real disaster** when asked *why* a promise matters — Therac-25 for testing/safety, Dieselgate for deception, 737 MAX for business pressure overriding judgment, Knight Capital for process/dead-code.
5. **Frame trade-offs in the stakeholder's terms** (outage, liability, churn), never as a lecture on clean code.
6. **Show humility.** The ethic is about *your* conduct, applied with the assumption that others are acting in good faith — not a stick to beat colleagues with.
7. **Remember the systemic answer.** At senior+ levels, the best response to a recurring ethical problem is a guardrail (CI gate, blameless postmortem, definition of done), not a heroic individual stand.

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Test Design & Fixtures](../02-test-design-and-fixtures/junior.md)
