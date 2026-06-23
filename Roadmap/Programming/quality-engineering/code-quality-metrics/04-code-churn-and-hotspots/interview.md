# Code Churn & Hotspots — Interview Questions

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Churn & Hotspots
> *A churn interview rarely asks "what is git log." It asks "you join a 1M-line codebase tomorrow — where do you start cleaning up, and how do you know?" and then watches whether you reach for a static linter and a gut feeling, or for the version-control history as evidence. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Churn Basics](#theme-1--churn-basics)
3. [Theme 2 — Hotspots](#theme-2--hotspots)
4. [Theme 3 — Change Coupling](#theme-3--change-coupling)
5. [Theme 4 — The Evidence](#theme-4--the-evidence)
6. [Theme 5 — Doing It Right](#theme-5--doing-it-right)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Org Signals and Cautions](#theme-7--org-signals-and-cautions)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **static snapshot vs behavioral history** (what the code *is* right now vs how it has *behaved* over time)
- **churn alone vs churn × complexity** (motion vs dangerous motion)
- **absolute vs relative churn** (raw lines changed vs change normalized to size or activity)
- **measuring code vs measuring people** (a map of risk vs a stick to beat authors with)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a metric.

---

## Theme 1 — Churn Basics

### Q1.1 — What is code churn, and what are the common ways to measure it?

> **Testing:** Do you know churn is a *family* of history-derived measures, not one number?

**A.** Code churn is how much a piece of code *changes over time*, read from version-control history rather than the current snapshot. There isn't one measure — there's a family, and they answer different questions:
- **Revisions / change frequency** — how many commits have touched this file. The single most useful churn measure, because it counts *editing events* independent of edit size.
- **Lines churned** — lines added plus deleted (or modified) over a window. This is the classic "churn" number, sensitive to magnitude.
- **Number of distinct authors** — how many people have edited the file. A diffusion measure: code touched by many hands tends to lack a clear owner.
- **Code age / time since last change** — how recently it moved; stable old code behaves very differently from code edited last week.

The reason any of this is a quality signal: a static snapshot tells you the code's *current shape*, but history tells you its *behavior* — and behavior is where defects concentrate. Files that keep getting changed are files developers keep needing to fix or extend, and every change is a chance to introduce a bug. History is the cheapest defect-proneness signal you already own, sitting unused in `git`.

### Q1.2 — Why is change *frequency* (revision count) often more useful than lines churned?

> **Testing:** Whether you understand that edit *events* matter more than edit *size*.

**A.** Lines churned conflates two very different files: one giant mechanical rename (10,000 lines changed in a single, safe commit) and one tiny method edited in panic forty separate times. The line count rewards the first and hides the second — but it's the *second* that's the quality problem. **Revision count** captures the thing that actually correlates with defects: how often humans had to come back and touch this code. Each return visit is an opportunity for a mistake and a signal that the code isn't settled. Lines churned is still useful as a magnitude check, but for *finding* trouble, the count of changes is the sharper instrument because it measures recurring attention, not bulk.

### Q1.3 — Why is version-control history a quality signal at all? Isn't the current code what matters?

> **Testing:** The core thesis of the whole topic — behavior over snapshot.

**A.** The current code is what *runs*, but it can't tell you where the *risk* is. Two files can look equally clean in a static review, yet one has been rewritten thirty times in six months and the other hasn't been touched since it was written. Those are not equally risky. History encodes things a snapshot structurally cannot: which code keeps breaking, which keeps changing, where the team's effort actually goes, and which files move *together*. Static analysis sees a photograph; history is the security-camera footage. For deciding where to invest limited refactoring and review effort, the footage wins — it's evidence of how the code has actually behaved under real maintenance pressure, not a guess from its current shape.

### Q1.4 — Where does churn data come from, and why is it almost free to collect?

> **Testing:** Whether you know this is a query over data you already have, not new instrumentation.

**A.** It comes from the version-control log — `git log` with per-file numstat, blame, and commit metadata. That's the point: unlike most quality signals, churn needs *no instrumentation, no agents, no runtime, no new tooling in the build*. Every commit any team has ever made is already a timestamped, authored, per-file record of change. You're not collecting new data; you're *querying data that already exists* and that most teams never look at. That's why churn analysis has such a high return — the corpus is already there, accurate, and going back years. The only real cost is interpreting it correctly.

---

## Theme 2 — Hotspots

### Q2.1 — What is a hotspot, and why combine churn with complexity instead of using either alone?

> **Testing:** The central concept — the product, not either factor.

**A.** A **hotspot** is a file (or function) that is both **complex** *and* **frequently changed** — high on the static complexity axis *and* high on the behavioral churn axis. The reason to combine them is that each axis alone over-fires:
- **Complexity alone** flags every gnarly file. But a complex file nobody ever touches is *inert* — it's hard to read, yes, but it's not costing you, because no one pays the comprehension tax and no one risks breaking it. Refactoring it is effort spent where there's no recurring pain.
- **Churn alone** flags every busy file. But a simple file that changes constantly — a config map, a registration list, a feature-flag table — is *cheap* to change. High churn, low risk.

The danger is in the **product**: code that is *hard to understand* **and** *that you keep having to touch*. There, every change is expensive and risky, and you pay the cost *repeatedly*. That intersection is where maintenance cost and defects concentrate, which is why ranking by churn × complexity finds the files worth fixing far better than either metric on its own. It turns "this code is ugly" into "this code is ugly *and* it's actively costing us."

### Q2.2 — A file has cyclomatic complexity of 300 but hasn't been changed in two years. Is it a problem you should fix now?

> **Testing:** Whether you genuinely believe the "complex-but-stable is OK" half of the model.

**A.** Probably not now — and saying so is the whole point of hotspot thinking. A complexity of 300 is alarming in isolation, but two years of stability tells you something the complexity number can't: nobody is paying the comprehension tax, nobody is risking a regression in it, and it evidently does its job. It's *latent* risk, not *active* cost. Spending a sprint refactoring it is effort with no recurring payoff, and the refactor itself risks breaking working code. You'd note it, maybe add a test characterization harness if you ever *do* need to touch it, but you wouldn't prioritize it over a file with complexity 80 that changes every week — that one is bleeding continuously. The honest senior answer resists the reflex to "fix the scariest number" and asks "where is the cost actually being paid?"

### Q2.3 — Why are hotspots usually a small fraction of the codebase, and why does that matter practically?

> **Testing:** Whether you grasp the Pareto shape and its operational consequence.

**A.** Change is extremely unevenly distributed. In almost every real codebase, a small minority of files absorb a large majority of the changes — the distribution is heavily skewed, not uniform. So when you intersect "frequently changed" with "complex," you're intersecting two skewed distributions, and the result is a *tiny* set: typically a handful of files carrying disproportionate maintenance cost. That matters because it converts an intractable problem ("improve quality across a million lines") into a tractable one ("there are eleven files that account for most of the pain — start there"). The practical consequence is *prioritization*: hotspot analysis tells you the 1% of files where refactoring effort has the highest return, instead of spreading attention uniformly over code that mostly doesn't need it.

### Q2.4 — How would you measure the "complexity" axis of a hotspot, and does the exact metric matter much?

> **Testing:** Whether you over-index on metric precision or understand it's a coarse proxy.

**A.** You can use cyclomatic or cognitive complexity, but a striking, well-known result is that **lines of code per file works almost as well as a complexity proxy** for hotspot ranking. The reason is that file size and structural complexity correlate strongly in practice, and you only need a *rough* ordering on the complexity axis — you're ranking, not certifying. So I'd start with something cheap and language-agnostic (indentation-based complexity, or even LOC) precisely because it lets me analyze a polyglot repo uniformly without per-language parsers. The exact complexity metric matters far less than people expect; what carries the signal is the *combination* with churn. Chasing a perfect complexity number is optimizing the wrong half.

---

## Theme 3 — Change Coupling

### Q3.1 — What is change coupling (temporal coupling), and what does it reveal that static analysis can't?

> **Testing:** The distinction between structural dependency and behavioral co-change.

**A.** **Change coupling** (also temporal or logical coupling) is the degree to which two files *change together in the same commits*, regardless of whether they reference each other in code. You compute it from history: of the commits that touched file A, what fraction also touched file B? A high value means "you can't change one without changing the other."

What it reveals that static analysis *cannot*: static tools only see dependencies expressed in the code — imports, calls, type references. But change coupling catches **hidden, implicit dependencies that leave no trace in the source**: a parser and a serializer that must stay in lockstep but never import each other; a piece of code and its test that always move together; two services with a shared, undocumented data-format contract; a copy-paste relationship where the same logic lives in two files and both must be edited for every change. None of those appear in an import graph. The version history sees them anyway, because the *humans* revealed the coupling every time they edited both files in one commit. That's the unique value: it surfaces the architectural dependencies your code doesn't admit to.

### Q3.2 — Two files change together 90% of the time but have no code dependency between them. What are the likely explanations, and which are bad?

> **Testing:** Whether you can interpret a coupling signal rather than just compute it.

**A.** Several explanations, with very different verdicts:
- **Copy-paste / duplicated logic** — the same rule lives in both files, so every change must be applied twice. *Bad.* It's a DRY violation the import graph can't see, and a classic source of bugs when someone updates one and forgets the other.
- **An implicit contract** — e.g., a client encoder and a server decoder that must agree on a wire format. *Bad-ish / risky.* The coupling is real and necessary, but the fact that it's *implicit* (no shared schema, no enforced contract) is the smell. The fix is to make the contract explicit, not to delete the coupling.
- **Shared cross-cutting concern** — both touch a config or a constants file. *Often benign,* if that file is genuinely the shared point of change.
- **Code and its test** — moving together is *expected and healthy.* You'd filter this case out before it pollutes the analysis.

The skill the question tests isn't computing the percentage — it's reading it. A high coupling between modules that *shouldn't* know about each other is an architectural problem; the same number between a file and its own test is noise. Senior answers separate "surprising coupling" (investigate) from "expected coupling" (ignore).

### Q3.3 — Why is "surprising" change coupling more interesting than expected coupling?

> **Testing:** Whether you can prioritize the signal, not just detect it.

**A.** Because expected coupling — a file and its test, a module and its own header — is just the system working as designed; it carries no new information. **Surprising** coupling is where the value is: two modules that, by the architecture, should be independent, yet the history shows they always change together. That gap between "how we *think* the system is decoupled" and "how it *actually* changes" is exactly where hidden complexity and future bugs live. It often reveals a leaky abstraction, a missing shared module that should own the common logic, or an architectural boundary that exists on the diagram but not in reality. So in practice I rank coupling pairs by how *unexpected* they are given the module structure, because the surprising ones are where intervention pays off — they point at the seams the architecture is lying about.

### Q3.4 — How does change coupling help you evaluate a system's modularity?

> **Testing:** Connecting coupling to architecture, not just file pairs.

**A.** Modularity's whole promise is that you can change one module without disturbing others — that boundaries *contain* change. Change coupling measures whether that promise holds *in practice* rather than on the architecture diagram. If commits routinely cut across module boundaries — a change to the "orders" module almost always drags in "billing" and "inventory" — then those modules aren't actually decoupled, whatever the package structure claims. Aggregated to the module level, change coupling becomes a behavioral modularity metric: low cross-module co-change means the boundaries are real; high cross-module co-change means you have a distributed monolith wearing a microservices costume. That's a measurement of architecture you can't get from static structure alone, because structure shows *allowed* dependencies while coupling shows *exercised* ones.

---

## Theme 4 — The Evidence

### Q4.1 — What did Nagappan and Ball actually find about churn and defects?

> **Testing:** Whether you can cite the foundational study accurately, not as folklore.

**A.** Nagappan and Ball's 2005 study, *"Use of Relative Code Churn Measures to Predict System Defect Density"* (done on Windows Server 2003), found that a set of **relative** code-churn measures is a strong, statistically significant predictor of a binary's **defect density** — to the point that they could discriminate fault-prone from non-fault-prone modules with high accuracy. The careful, load-bearing word is **relative**: they didn't just count raw churned lines. They normalized churn — churned lines relative to total lines, churned files relative to total files, churn relative to the number of changes, and so on. Those *relative* measures predicted defects well; the *absolute* counts on their own were far weaker. The headline isn't "more changes means more bugs" (too crude); it's "*churn normalized to size and activity* predicts where the bugs are." That nuance is what separates someone who read the paper from someone who absorbed a slogan.

### Q4.2 — Why does *relative* churn predict defects better than *absolute* churn? Give the intuition.

> **Testing:** Whether you understand the normalization, not just that it exists.

**A.** Because absolute churn is confounded by size and activity. A 5,000-line file will naturally accumulate more churned lines than a 50-line file simply by being bigger, and a file in a fast-moving area changes more just because that area is busy — neither necessarily means it's *defect-prone*. Raw counts therefore largely re-measure "this file is large / this area is active," which you already knew. Normalizing — churn *as a fraction of* the file's size, or *per change* — strips out the size and activity confounds and isolates the part of churn that actually tracks instability: a file that's being *substantially rewritten relative to itself*, repeatedly. That residual is what correlates with defects. The intuition: it's not how many lines moved, it's how much of *this* file is in flux relative to what it is. Nagappan and Ball's contribution was demonstrating exactly that the relative framing is the predictive one.

### Q4.3 — Why is "behavior beats a static snapshot" the deeper lesson of this research, and is it the only finding of its kind?

> **Testing:** Whether you can generalize the result and place it among related work.

**A.** The deeper lesson is that *process* metrics — how code was developed and changed — often **out-predict product metrics** — properties of the code as it currently sits. The history of *how* a file got to its current state carries more defect signal than a measurement of the state itself. Nagappan and Ball is the canonical churn result, but it's part of a consistent body of evidence: studies repeatedly find that change metrics (churn, number of changes, number of authors) predict defects as well as or better than complexity metrics, and that the *combination* is best. Adam Tornhill's later *Your Code as a Crime Scene* / *Software Design X-Rays* work operationalized the same insight into hotspots and change coupling for practitioners. The throughline across all of it: the version-control log is an underused, high-signal data source, and behavior beats the snapshot. That generalization — not the single Windows number — is what a senior engineer takes from the literature.

### Q4.4 — A skeptic says "correlation isn't causation — churn doesn't *cause* bugs." How do you respond?

> **Testing:** Intellectual honesty about what the evidence does and doesn't claim.

**A.** The skeptic is right that churn doesn't mechanically *cause* defects, and the research doesn't claim it does — it claims churn is a strong *predictor* of defect density, which is a different and weaker statement that's still extremely useful. For *prioritization*, prediction is all I need: I'm not asserting that editing a file injects bugs by magic; I'm asserting that files which keep changing are where bugs empirically concentrate, so that's where to focus review, tests, and refactoring. There's also a plausible causal *story* — every change is an opportunity for error, and code that keeps needing changes is often code that's hard to get right — but I'd hold that loosely and lean on the predictive claim, which is what the data actually supports. The honest framing is "churn tells me where to *look*," not "churn is the *cause*." Treating a predictive signal as a prioritization tool, while not over-claiming causation, is exactly the senior stance.

---

## Theme 5 — Doing It Right

### Q5.1 — Sketch the git pipeline you'd use to compute per-file churn over the last year.

> **Testing:** Whether you can actually extract this, not just describe it abstractly.

**A.** The backbone is `git log` with numstat over a bounded window:
1. `git log --since="1 year ago" --numstat --pretty=format:'%H%x09%an%x09%ad'` to get, per commit, the author/date and the per-file added/deleted line counts.
2. Aggregate by path: sum of commits touching it (revision count), sum of added+deleted lines (lines churned), and the set of distinct authors.
3. Join that against a complexity-or-size measure per file (even `wc -l`, or a complexity tool) to get the two hotspot axes.
4. Rank by the combination (e.g., revisions × complexity) and by relative churn (churned lines ÷ current size) for the defect-prediction view.

The window matters — "last year" or "last release" — because *recent* behavior predicts *near-future* risk; ancient churn from a long-settled module is mostly noise. In practice I'd reach for an existing tool (`code-maat`, Tornhill's CodeScene, or a small script) rather than reinventing the aggregation, but I'd want to know exactly what it's counting under the hood, because the pitfalls below all live in that counting.

### Q5.2 — Naively counting churn double-counts renames and moves. How do you handle that?

> **Testing:** A real, classic data-quality pitfall that separates the careful from the naive.

**A.** A rename or a large directory move looks, to a naive line counter, like *deleting* an entire file and *adding* an entire new one — a huge spike of churn that represents *no behavioral change whatsoever*. If you don't handle it, your top "hotspot" is often just a file that got moved or a project that did a big reorg. The fix is to make git's rename detection do the work: use `git log --follow` to track a file across renames, and rely on `-M` (and `-C` for copies) so git reports a rename as a rename instead of an add/delete pair. At the analysis level, you also de-duplicate history across the rename so a file's churn before and after the move is attributed to the same logical entity. Getting rename handling wrong is the single most common way churn analysis produces garbage rankings, so it's the first thing I sanity-check.

### Q5.3 — Why must you exclude reformatting, mechanical, and generated-file commits — and how?

> **Testing:** Whether you understand that not all line changes carry signal.

**A.** Churn is a proxy for *meaningful* change — the editing pressure that correlates with risk. But several kinds of commits move enormous numbers of lines while carrying *zero* risk signal, and if you count them they drown out the real hotspots:
- **Reformatting / style runs** — a repo-wide `prettier`/`gofmt`/clang-format pass rewrites thousands of lines and means nothing about defect-proneness.
- **Generated and vendored files** — lockfiles, `node_modules`, generated protobuf/gRPC stubs, minified bundles. Huge churn, not human-maintained, not where bugs you can fix live.
- **License-header or bulk find-and-replace commits** — same story.

How: exclude generated/vendored paths up front (a `.gitattributes linguist-generated` convention, or a path denylist); identify and drop known bulk-reformat commits (often a single commit hash or `.git-blame-ignore-revs`); and prefer counting *commits that touched a file* over *lines* so a one-commit mass-reformat counts once, not ten-thousand-fold. The principle: clean the input so churn measures human editing pressure, not mechanical noise. Skipping this step is how you get a "hotspot" that's really just your formatter.

### Q5.4 — When do you use relative churn versus absolute churn, concretely?

> **Testing:** Operationalizing the Nagappan-and-Ball nuance.

**A.** Use **absolute** churn (raw revisions, raw lines) when you want a *human-readable activity view* — "which files are busiest," a starting point for a conversation, or the input to the churn × complexity hotspot ranking, where the complexity axis already normalizes somewhat. Use **relative** churn — churned lines ÷ file size, churn ÷ number of changes, churned files ÷ total files — when you're doing *defect prediction* or comparing files of very different sizes, because that's the framing Nagappan and Ball showed actually predicts defect density, and because it stops big files from automatically topping the list just for being big. A concrete rule: for "where do we focus refactoring," churn × complexity (largely absolute) is fine and intuitive; for "which modules are statistically most fault-prone," switch to relative measures. Knowing *which* question you're answering tells you which churn to use — using absolute churn for a fault-prediction claim is precisely the mistake the research warns against.

### Q5.5 — What time window and granularity do you analyze at, and why does it matter?

> **Testing:** Whether you think about the analysis parameters, not just run a default.

**A.** **Window:** recent and bounded — typically the last 6–12 months, or the current major release. Recent behavior predicts near-future risk; including five years of history lets long-since-stabilized code dominate and dilutes the signal about what's volatile *now*. I'd also look at *trend* — is a file's churn rising or falling? — which a single all-time number hides. **Granularity:** start at the file level because it's robust and cheap, but for big files drop to the **function/method** level, because a 3,000-line file can be a stable 2,900 lines plus one churning method, and file-level analysis would wrongly condemn the whole thing. Function-level hotspots (and the function-level churn that tools like CodeScene compute) localize the actual pain. Choosing the window and granularity deliberately is part of getting a *true* ranking rather than an artifact of defaults.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — You join a one-million-line codebase tomorrow. How do you figure out where to focus?

> **Testing:** The flagship scenario — do you reach for history as a map?

**A.** I'd let the codebase's *history* tell me where it hurts, because reading a million lines is impossible and a static linter would just flag everything. Concretely:
1. **Run a hotspot analysis first** — churn (revision count over the last 6–12 months) × complexity (or size) per file, ranked. That produces a short list of the handful of files carrying most of the maintenance cost. Those are where I focus learning, testing, and eventually refactoring — and conveniently, where the team spends most of *its* time too, so understanding them pays off fastest.
2. **Run change-coupling analysis** — find the surprising co-change pairs to learn the system's *real* architecture, including the implicit dependencies the diagrams omit. This tells me which "boundaries" are fictional before I trust them.
3. **Cross-reference with the team** — show the hotspot list to the engineers and ask "does this match where the pain is?" It almost always does, which both validates the analysis and builds trust.

The whole move is to treat version history as a heat-map of risk and effort, so a newcomer spends their limited attention on the 1% of files that actually matter instead of wandering. That's the difference between "I read the README" and "I let three years of commits show me the crime scene."

### Q6.2 — A file has enormous churn. Is that bad? What do you ask next?

> **Testing:** Whether you resist a reflexive verdict and reason from the model.

**A.** Not necessarily — high churn alone is *activity*, not *risk*, and jumping to "that's bad" fails the whole hotspot thesis. The questions I'd ask, in order:
- **Is it also complex?** Simple-but-churny (a config file, a feature-flag registry, a routes table) is *fine* — cheap to change, low risk. Churny *and* complex is the actual hotspot and the real concern.
- **Is the churn real or mechanical?** Is this file genuinely being re-edited, or is it generated, reformatted repeatedly, or a victim of rename double-counting? Garbage in the input fakes churn.
- **Is the churn rising or falling?** A file that churned hard during a feature and is now settling is improving; one whose churn is *accelerating* is a fire.
- **What kind of file is it?** Some files are *supposed* to change often (a public API surface, a DI wiring file). Expected churn isn't a smell.

Only after those do I render a verdict. "Huge churn — is that bad?" is a trap that's really testing whether you've internalized that churn is one axis of two and that context decides. The senior answer is "it depends, and here's exactly what I'd check."

### Q6.3 — You refactored a hotspot last quarter. How do you tell whether the refactor actually helped?

> **Testing:** Whether you can use churn as a *before/after measurement*, not just a finder.

**A.** I'd measure the *behavior* after the change, because the goal of refactoring a hotspot isn't prettier code — it's *cheaper, safer future change*, and behavior is what proves that. Specifically:
- **Did churn/complexity drop and, more importantly, did the file leave the hotspot ranking?** If after the refactor the file is still being frantically edited, the refactor addressed the symptom, not the cause.
- **Did defect density in that file fall** in the months after — fewer bug-fix commits, fewer reverts touching it? Bug-fix-commit frequency is a concrete, history-derived outcome metric.
- **Did change coupling loosen** — is the file no longer dragging three others along every time it changes? Reduced coupling is direct evidence the boundaries got cleaner.

The key idea is that the same version-control signals that *found* the hotspot are also the *outcome measures* for whether you fixed it. That closes the loop: hotspots aren't just a to-do list, they're an A/B baseline. Answering with "the code looks nicer now" instead of "its churn and defect rate fell" is exactly the gap this question probes — refactoring success is measured in *future behavior*, and churn is how you read it.

### Q6.4 — Leadership wants to "reduce technical debt." How do you turn churn data into a concrete, defensible plan?

> **Testing:** Translating the metric into prioritization and a business case.

**A.** I'd use hotspots to make debt *visible and ranked* so the work is targeted instead of a vague crusade. The plan: (1) produce the churn × complexity hotspot list — the small set of files where complexity and change frequency intersect, i.e., where debt is *actively* costing money rather than sitting latent; (2) for the top few, quantify the cost in terms leadership understands — these files account for X% of recent changes and Y% of recent bug fixes, so they're a tax on every feature in their area; (3) propose refactoring *only* those, with churn/defect-rate as the success metric; (4) explicitly *de*prioritize complex-but-stable code, because spending effort there has no payoff and burns credibility. The defensibility comes from the data: I'm not saying "this code is ugly," I'm saying "*here* is where the team's effort and bugs concentrate, *here* is the predicted return on fixing it, and *here's* how we'll know it worked." That reframes debt from an aesthetic complaint into a prioritized, measurable investment.

---

## Theme 7 — Org Signals and Cautions

### Q7.1 — How can churn/authorship data map knowledge and bus-factor risk?

> **Testing:** The legitimate organizational use of the same data.

**A.** The author dimension of history maps *who knows what*. By looking at which authors have made the substantive changes to each file (a knowledge-weighted view of `git blame`, not just the last toucher), you can build a knowledge map: which parts of the system have healthy shared ownership, and which are **single-author** — known to exactly one person. Those single-author files are your **bus-factor risk**: if that person leaves or is unavailable, the team has an orphaned, poorly-understood region. Crossed with hotspots, it gets sharper — a file that is *complex, high-churn, and single-author* is the worst case: critical, actively changing, and understood by one human. That's where I'd deliberately invest in knowledge-sharing, pairing, or documentation *before* it becomes a crisis. This is a genuinely valuable, defensible use of authorship data: managing organizational risk, surfacing where the team is fragile.

### Q7.2 — Why should you *never* weaponize author-level churn metrics, e.g., to rank developer productivity?

> **Testing:** The single most important ethical/cultural caution in the topic.

**A.** Because the moment churn becomes a measure of *people* rather than *code*, it stops measuring anything real and starts actively harming the system. Concretely: lines-changed or commit-count as a productivity metric is trivially gameable and rewards exactly the wrong behavior — verbose code over concise, churning over getting it right the first time, many tiny commits over thoughtful ones. Goodhart's law applies hard: the metric becomes a target and ceases to be a good measure. Worse, it poisons the data source — if engineers know commits are being scored, they game their commit behavior, and the churn signal you rely on for *hotspots* gets corrupted too. And it's culturally toxic: it punishes people for working in the legacy hotspots that *most* need help, discourages the cleanup and deletion you want to encourage (deleting code is negative "productivity"), and destroys the trust you need for people to be honest in version control. The hard rule: churn analysis is a flashlight for finding risky *code*, never a stick for ranking *engineers*. The instant it's pointed at people, both the ethics and the data integrity collapse.

### Q7.3 — What are the main ways churn analysis can mislead, and how do you guard against them?

> **Testing:** Whether you hold the metric with appropriate skepticism.

**A.** Several failure modes, each with a guard:
- **Mechanical churn masquerading as real** — reformatting, generated files, rename double-counting. *Guard:* clean the input (ignore generated paths, blame-ignore reformat commits, enable rename detection) before trusting any ranking.
- **Confusing activity with risk** — flagging high-churn-but-simple files. *Guard:* always pair churn with complexity; never act on churn alone.
- **Absolute-vs-relative confusion** — using raw line counts for a fault-prediction claim. *Guard:* normalize when the question is about defect-proneness.
- **Stale windows** — letting long-settled code dominate. *Guard:* bound to recent history and look at trend.
- **Over-trusting the number** — treating a hotspot list as ground truth. *Guard:* validate against the team's lived experience; the data should *start* the conversation, not end it.

The meta-point: churn is a *high-signal heuristic*, not an oracle. It points you at things worth a human look; the human still has to look. Someone who can list these failure modes is someone who's used churn analysis for real and gotten burned by each one.

### Q7.4 — Is churn analysis fair to legacy code and the people who maintain it?

> **Testing:** Whether you see the human/cultural dimension, not just the math.

**A.** Only if you frame it carefully — and getting this wrong is how a good tool becomes a morale problem. Legacy hotspots are, by definition, where the hard, unglamorous maintenance happens, and the engineers working there are often the team's most valuable, doing the most difficult work. If churn data is used to imply *those people* are producing low-quality code, it punishes exactly the right people for being assigned the worst code, which is both unjust and corrosive. The correct framing is system-level and blameless: "*this code* needs investment," never "*this person* writes buggy code." Used that way, hotspot analysis actually *helps* the legacy maintainers — it gives them objective evidence to justify the refactoring and knowledge-sharing they've probably been begging for. So it's fair *if and only if* it stays pointed at the code and is paired with action that helps the maintainers, not a scoreboard that blames them. The fairness is entirely in the framing, and protecting that framing is part of the job.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Define a hotspot in one line.** A: A file that is both complex *and* frequently changed — high on both the static and the behavioral axis.
- **Q: Why not just use complexity?** A: A complex file nobody touches costs nothing; complexity only bites when paired with change.
- **Q: Why not just use churn?** A: A simple file that changes constantly (config, flags) is cheap and low-risk; churn alone over-fires.
- **Q: What's the most useful single churn measure?** A: Revision count — number of commits touching the file — because it counts editing *events*, not edit size.
- **Q: What did Nagappan and Ball show?** A: *Relative* code-churn measures strongly predict defect density; absolute counts alone are much weaker.
- **Q: Why *relative*, in one line?** A: It removes the size/activity confound, isolating the churn that actually tracks defects.
- **Q: What is change coupling?** A: How often two files change in the same commit — behavioral co-change, independent of code dependency.
- **Q: What does coupling catch that static analysis can't?** A: Hidden, implicit dependencies (copy-paste, wire-format contracts) that leave no trace in imports.
- **Q: Biggest data pitfall in churn analysis?** A: Renames/moves counted as add+delete, faking massive churn for zero behavioral change.
- **Q: Two commit types you must exclude?** A: Repo-wide reformatting runs and generated/vendored files — huge churn, no risk signal.
- **Q: Why count commits, not lines, for a reformat-heavy repo?** A: A one-commit mass reformat counts once, not ten-thousand lines, so it can't fake a hotspot.
- **Q: One legitimate org use of authorship churn?** A: Bus-factor / knowledge maps — finding single-author files before the author leaves.
- **Q: One use you must never make of it?** A: Ranking developer productivity — gameable, toxic, and it corrupts the very data you rely on.
- **Q: Does churn *cause* bugs?** A: No — it *predicts* defect density, which is all you need for prioritization; don't over-claim causation.
- **Q: Why is history "almost free" as a signal?** A: It's a query over commit data you already have — no instrumentation, no runtime, no new tooling.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating churn as a single number instead of a family of measures.
- Acting on churn alone — flagging a busy config file as a problem.
- Wanting to refactor the scariest *complexity* number regardless of whether it ever changes.
- Citing Nagappan and Ball as "more changes means more bugs," missing the *relative* nuance.
- Ignoring renames, reformatting, and generated files — trusting a raw ranking.
- Reaching for author-level churn to rank or compare developers.
- Confusing change coupling (co-change) with static dependency (imports).

**Green flags:**
- Naming the *distinction* (snapshot vs behavior, churn alone vs churn × complexity) before reaching for a metric.
- Defending "complex-but-stable is fine" without flinching.
- Saying "relative churn" and explaining *why* normalization predicts defects.
- Reaching for change coupling to find the *implicit* architecture, and prioritizing the *surprising* couplings.
- Cleaning the input (renames, reformat commits, generated paths) before trusting any number.
- Insisting churn is a flashlight for *code*, never a stick for *people* — and protecting the data integrity that depends on it.
- Closing the loop: using the same churn signals to *measure* whether a refactor helped.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **static snapshot vs behavioral history**, **churn alone vs churn × complexity**, **absolute vs relative churn**, **measuring code vs measuring people**. Name the distinction first; the metric follows.
- **Churn basics:** churn is a *family* of history-derived measures (revisions, lines, authors, age); revision count is usually the sharpest because it counts editing *events*. History is an almost-free, high-signal data source — behavior beats the snapshot.
- **Hotspots:** the value is in the *product* — code that is hard to understand *and* keeps changing. Complex-but-stable is inert; simple-but-churny is cheap. The intersection is a tiny set of files carrying most of the cost, which makes prioritization tractable.
- **Change coupling** finds *implicit* dependencies static analysis can't see — copy-paste, wire-format contracts — by detecting files that change together; the *surprising* couplings reveal where the architecture is lying.
- **The evidence:** Nagappan and Ball (2005) showed *relative* code churn predicts defect density; the deeper lesson is that *process* metrics often out-predict *product* metrics. It's prediction, not causation — which is exactly enough for prioritization.
- **Doing it right:** a `git log --numstat` pipeline over a bounded recent window; handle renames (`--follow`, `-M`), exclude reformatting and generated files, prefer commit counts over raw lines, and pick relative vs absolute by the question you're answering.
- **Org signals and cautions:** authorship churn legitimately maps bus-factor/knowledge risk, but must *never* be weaponized against developers — doing so is gameable, toxic, and corrupts the signal itself. Keep it pointed at code, blamelessly.

---

## Further Reading

- Nagappan & Ball, *"Use of Relative Code Churn Measures to Predict System Defect Density"* (ICSE 2005) — the foundational study; note the emphasis on *relative* measures.
- Adam Tornhill, *Your Code as a Crime Scene* and *Software Design X-Rays* — the practitioner's operationalization of hotspots and change coupling from version-control data.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- `git log --numstat`, `git log --follow -M -C`, and tools like `code-maat` / CodeScene — primary sources for the extraction the answers reference.

---

## Related Topics

- [01 — Cyclomatic and Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/interview.md) — the complexity axis that churn is multiplied against to find hotspots.
- [03 — Coupling and Cohesion Metrics](../03-coupling-and-cohesion-metrics/interview.md) — *static* coupling, the counterpart to the *temporal* coupling covered here.
- [Code Quality Metrics README](../README.md) — where churn and hotspots sit in the broader metrics landscape.
- [Quality Engineering README](../../README.md) — how behavioral code analysis fits the wider quality picture.
