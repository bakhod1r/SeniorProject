# Ecosystem & Tooling Maturity — Practice Tasks

Six reasoning exercises. **None require writing code** — they require *judgment*: weighing library metadata, auditing a dependency tree for risk, scoring an ecosystem, and designing the checklists and scorecards a real team would use. Work them on paper or in a doc. The point is a *defensible written rationale*, not a "right answer."

---

## Task 1 — Pick one of three competing libraries, and justify it

Your service needs a **message-queue client library**. Three candidates exist. Here's the metadata you gathered:

| Signal | **Lib A — `swiftmq`** | **Lib B — `steadyqueue`** | **Lib C — `quantumq`** |
|---|---|---|---|
| Last release | 19 months ago | 6 weeks ago | 4 days ago |
| First released | 2019 | 2016 | 2025 |
| Maintainers / contributors | 1 / 3 | 12 / 140 | 2 / 5 |
| Open issues (and triage) | 180, last reply 8 mo ago | 60, triaged weekly | 22, replied same-day |
| Stars / downloads trend | high stars, downloads flat | dominant, downloads stable | downloads spiking 5×/mo |
| Direct + transitive deps | 4 | 9 | 61 |
| Past CVEs | 1 (still open, 11 mo) | 3 (all patched < 1 week) | 0 (too new) |
| License | MIT | Apache-2.0 | MIT |
| Docs / examples | excellent | good | thin, mostly a blog post |
| Benchmark (msgs/sec) | **fastest (1.0×)** | 0.7× | 0.85× |

**Your job.**
1. Pick one library for a *production payments-adjacent service* and write a 4-6 sentence justification.
2. State explicitly what would have to change for your answer to flip.
3. Name the single most disqualifying fact about each library you *didn't* pick.

**Things a strong answer addresses.**
- [ ] Does not pick on benchmark alone (Lib A is fastest *and* the worst production risk).
- [ ] Flags Lib A's **open CVE (11 months)** and **bus factor 1** as disqualifying for payments.
- [ ] Flags Lib C's **61-package transitive tree** and **zero production track record** despite the exciting download spike (hype ≠ maturity).
- [ ] Lands on Lib B and names *why*: alive, multi-maintained, fast CVE patching, dominant (most eyes + Stack Overflow answers), shallow-enough tree.
- [ ] Names a flip condition (e.g., "if this were a throwaway internal tool, Lib C's speed-of-iteration might win" or "if Lib B were the one with the open CVE…").

> **Lesson:** the fastest library lost. At production stakes, *maintainability and security history* dominate raw throughput — you live with a dependency far longer than you benchmark it.

---

## Task 2 — Audit a dependency tree for risk

A teammate is about to merge this addition. They ran `npm ls` and pasted the (abridged) tree for a single new dependency, `pdf-wizard`:

```
pdf-wizard@0.4.2                          (last publish: 2 years ago, 1 maintainer)
├── left-pad-clone@1.0.0                  (11 lines, 1 maintainer, 3 downloads/wk)
├── img-magick-bindings@0.1.7             (native bindings, 0.x, last publish 3 yrs)
├── crypto-utils-lite@2.1.0               (rolls its own AES, 1 maintainer)
├── color@4.x                             (also required by 3 other deps, at 3.x)   ← version conflict
├── request@2.88.2                        (DEPRECATED since 2020, known CVEs)
└── happy-licensing@1.0.0                 (license: AGPL-3.0)
```

The product is a **closed-source commercial SaaS**.

**Your job.** Write a risk audit. For each line, state the risk class and a verdict (accept / mitigate / block). Then give an overall recommendation.

**Things a strong audit catches.**
- [ ] `pdf-wizard` itself: **0.x** (unstable API by SemVer), **2 years stale**, **bus factor 1** — the whole subtree inherits its fragility.
- [ ] `left-pad-clone`: a trivial single-maintainer dep is pure supply-chain surface for ~zero value (the left-pad lesson). **Block or inline it.**
- [ ] `crypto-utils-lite`: **rolling its own AES** is a giant red flag — never trust hand-rolled crypto from a solo maintainer. **Block.**
- [ ] `color@4.x` vs `3.x` elsewhere: a **diamond/version conflict** that risks dependency hell. **Mitigate** (pin/dedupe).
- [ ] `request`: **deprecated since 2020 with known CVEs** — unmaintained, do not ship. **Block.**
- [ ] `happy-licensing` **AGPL-3.0** in a *closed-source SaaS*: AGPL's network-use copyleft can obligate you to open-source your server. **Block — legal blocker.**
- [ ] Overall: this tree is unshippable as-is. Recommendation: reject `pdf-wizard`, find a maintained PDF library with a clean tree, or isolate the requirement behind a vetted alternative.

> **Lesson:** the cost of a dependency is the *whole tree*, not the README. One innocent `npm install` here drags in a hand-rolled-crypto risk, a deprecated CVE-ridden HTTP client, an AGPL legal landmine, and a version conflict — none visible from `pdf-wizard`'s own page.

---

## Task 3 — Build an ecosystem-maturity scorecard: young vs mature

You're advising on a green-field service. Two candidate languages: **"Maturelang"** (15 years old, foundation-backed, huge registry) and **"Freshlang"** (3 years old, single-company-backed, small but fast-growing registry, exciting performance).

**Your job.** Design a reusable **ecosystem-maturity scorecard** — a weighted table of criteria — then fill it in for both candidates with 1-5 scores and a one-line rationale per cell. Produce a weighted total *and* a written verdict that goes beyond the number.

**Minimum criteria your scorecard must include** (add more):

| Criterion | Why it's on the scorecard |
|---|---|
| Registry breadth (do the libs I need exist?) | The easy 80% |
| **Long-tail coverage** (my specific DB driver, cloud SDK, observability) | The silent killers |
| First-party vendor SDKs (AWS/GCP/Stripe ship official clients?) | Off-the-list languages get community ports |
| Library health norms (maintained, multi-maintainer culture?) | Bus-factor risk at ecosystem scale |
| Supply-chain posture (deep fragmented trees vs lean stdlib?) | Structural risk |
| Tooling quality (formatter, linter, LSP, debugger) | Velocity multiplier |
| Build/compile at scale (caching, incremental, speed) | Reveals itself only at scale |
| API/version stability (1.0? compatibility promise? LTS?) | Churn vs durability |
| Governance & funding | Decade-bet durability |
| Talent supply trajectory | Hiring over the system's life |

**Things a strong answer addresses.**
- [ ] The **weights change with context** — a 6-month internal tool weights long-tail/stability *low*; a 10-year regulated platform weights them *high*. State the context you're scoring *for*.
- [ ] Freshlang likely *loses* on long-tail, first-party SDKs, stability, and governance — *wins* on excitement/performance and maybe tooling unification.
- [ ] The verdict names the bet explicitly: "choosing Freshlang = we personally own the gaps" vs "Maturelang = boring, durable, judged on worst-case fit."
- [ ] Includes a **sensitivity note**: which weight, if changed, flips the result?

> **Lesson:** a scorecard makes the decision *honest*, not automatic. The same two languages can correctly score differently for a throwaway tool versus a decade-long platform — because the *weights* encode the stakes, exactly as in [`01-language-selection-criteria`](../01-language-selection-criteria/)'s weighted matrix.

---

## Task 4 — Design a library-adoption checklist for your team

Your team keeps getting burned: someone adds a dependency, and months later it's abandoned, or has an incompatible license, or drags in a CVE. Leadership asks you to write the **library-adoption checklist** that every new third-party dependency must pass before merge.

**Your job.** Write the checklist — the gates a dependency must clear — plus the *process* (who reviews, what's automated, what's manual, what the escape hatch is).

**A strong checklist includes gates for:**
- [ ] **Maintenance:** released within N months; active issue/PR triage.
- [ ] **Bus factor:** more than one maintainer, or a documented mitigation (vendor/fund/fork) if not.
- [ ] **License:** on the allowlist (MIT/Apache/BSD); AGPL/SSPL/no-license blocked or escalated to legal.
- [ ] **Transitive weight:** the *whole tree* reviewed (`npm ls` / `cargo tree`), not just the direct dep; a soft cap with justification for exceeding it.
- [ ] **Security:** clean `audit`/Snyk/OSV scan; past-CVE patch speed acceptable.
- [ ] **Necessity:** is this trivial enough to inline instead? (the left-pad gate)
- [ ] **First-party preference:** prefer the vendor's official SDK over a community port.
- [ ] **Record:** the *why* written down (a one-line rationale or mini-ADR) so trust is re-checkable.

**And a process that specifies:**
- [ ] What's **automated in CI** (license gate, vuln scan, SBOM generation) vs **human-reviewed** (necessity, bus factor).
- [ ] **Who** approves (a reviewer, a platform team, a security sign-off for sensitive deps).
- [ ] The **escape hatch** — how a team adopts something off-checklist when there's a real need (and who owns the added risk).

> **Lesson:** the goal is to make the *good* path the *easy* path. A checklist that's pure friction gets routed around; one that automates the boring gates (license, scan, SBOM) and reserves human judgment for the real questions (necessity, bus factor) actually gets used.

---

## Task 5 — Triage a post-incident: a critical dependency went bad

It's 9 a.m. A CVE just dropped: a remote-code-execution flaw in **`fastlog`**, a logging library. It's the next log4shell. Your CTO asks you, the on-call lead, three questions.

**Your job.** Answer each, and identify what *infrastructure* you wish you'd built *before* today that would make the answer fast.

1. **"Are we affected, and exactly which services?"** — How do you answer in minutes, not days?
2. **"`fastlog` is maintained by one volunteer who's asleep in another timezone. How do we get a patch?"**
3. **"How do we stop the *next* one from being this painful?"**

**Things a strong answer addresses.**
- [ ] Q1: the fast answer comes from **SBOMs** (an inventory of every component, direct and transitive, per service). If you have them, you *query*; if not, every team greps lockfiles for a week. Name the infrastructure gap explicitly.
- [ ] Q1 also: a **private registry/proxy** lets you confirm exactly which versions entered the org.
- [ ] Q2: mitigations while waiting — pin/roll back, apply a config workaround (log4shell's was disabling JNDI lookups), **fork and patch** since it's open source, or block the exploit at the WAF/network layer. The bus-factor-1 maintainer is *why* this is painful — connects to funding/forking strategy.
- [ ] Q3: standing investments — SBOMs on every build, automated scanning (Dependabot/Snyk/OSV) wired to alerts, a golden path that concentrates the blast radius into fewer vetted libs, and *sponsoring/contributing to* critical dependencies so bus factor 1 isn't your problem alone.
- [ ] Recognizes the meta-lesson: **ubiquity is a blast-radius multiplier** — the very popularity that made `fastlog` feel "safe to adopt" is what makes today catastrophic.

> **Lesson:** incident *response time* is bought *before* the incident, with SBOMs, scanning, and a curated supply chain. The org that answers "are we affected?" in 20 minutes built that capability on a calm day; the one that takes a week didn't.

---

## Task 6 — Make the economic case for tooling investment

Your org of **200 engineers** has slow, uncached builds. A proposed remote-build-cache + incremental-compilation system would save an estimated **6 minutes per build**, with engineers running **~8 builds/day**. Building and running it needs a **3-person platform team** (loaded cost ~$200k/engineer/year) plus ~$60k/year infrastructure.

**Your job.**
1. Do the back-of-envelope math: how much engineer time does the system recover per year?
2. Convert that to money (assume loaded engineer cost ~$200k/year ≈ ~$100/hour at ~2,000 hrs/year).
3. Compare against the cost. State the ROI and the payback intuition.
4. Then argue the *non-obvious* benefits the raw number misses — and any *risks/caveats* to the estimate.

**Worked check (your numbers should land near this):**
- Time saved/day: 200 × 8 × 6 min = 9,600 min/day = **160 engineer-hours/day**.
- Per year (~250 working days): 160 × 250 = **40,000 engineer-hours/year**.
- In money: 40,000 × $100 ≈ **$4,000,000/year recovered**.
- Cost: 3 × $200k + $60k = **$660k/year**.
- ROI ≈ **6×**; the system pays for itself in roughly **2 months**.

**Things a strong answer addresses.**
- [ ] Gets the order of magnitude right (millions recovered vs hundreds of thousands spent).
- [ ] Names the **non-obvious wins**: less context-switching while waiting (the real productivity killer, not just the literal minutes), faster CI feedback, better morale/retention, and that the benefit **compounds with every new hire**.
- [ ] Names **caveats honestly**: saved minutes aren't 1:1 converted to feature work (some is slack); the estimate assumes adoption; maintenance cost is ongoing, not one-time.
- [ ] Lands the framing: **tooling is leverage with measurable ROI, not overhead** — this is the highest-leverage way to make every other engineer faster.

> **Lesson:** "it doesn't ship features" is the wrong test for tooling. A good build system makes *every* feature ship faster, forever — the return compounds with headcount, which is exactly why large orgs staff platform teams.

---

## Closing summary

| Skill these tasks build | The judgment behind it |
|---|---|
| Reading library metadata (Tasks 1, 2) | "Exists" ≠ "production-grade"; cost = the whole tree |
| Scoring an ecosystem (Task 3) | Weights encode stakes; the long tail is the silent killer |
| Designing gates & process (Task 4) | Make the good path the easy path |
| Incident triage (Task 5) | Response time is bought *before* the incident, via SBOMs + curation |
| Economic reasoning (Task 6) | Tooling is leverage with ROI, not overhead |

**Memorize this:** every one of these exercises rewards the same instinct — *the cheap, loud variable (benchmark, star count, syntax) is rarely the one that matters; the expensive, quiet ones (maintenance, bus factor, license, transitive weight, response time, compounding tooling ROI) are.* A senior's scrutiny goes where the money and the risk actually live.
