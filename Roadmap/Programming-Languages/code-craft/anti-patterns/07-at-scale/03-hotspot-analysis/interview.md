# Hotspot Analysis — Interview Questions

> **Category:** [Anti-Patterns at Scale](../README.md) → **Hotspot Analysis**
> **Covers (collectively):** Churn × complexity · Code-as-a-crime-scene · Change / temporal coupling · Knowledge maps & bus factor · Defect-density prioritization

A bank of 30+ interview questions and answers on mining git history to prioritize refactoring — Adam Tornhill's *Your Code as a Crime Scene* and *Software Design X-Rays*. Each answer models the reasoning a strong candidate gives, including the failure modes and trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals — What a Hotspot Is](#fundamentals--what-a-hotspot-is)
2. [Mining Churn from Git](#mining-churn-from-git)
3. [Change Coupling & Defect Coupling](#change-coupling--defect-coupling)
4. [Pitfalls & Data Hygiene](#pitfalls--data-hygiene)
5. [Driving a Refactoring Backlog](#driving-a-refactoring-backlog)
6. [Relation to Fitness Functions & Ratchets](#relation-to-fitness-functions--ratchets)
7. [Curveballs](#curveballs)
8. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
9. [How to Talk About Hotspots in Interviews](#how-to-talk-about-hotspots-in-interviews)
10. [Summary](#summary)
11. [Related Topics](#related-topics)

---

## Fundamentals — What a Hotspot Is

> Definitions, the two axes, and why intuition loses to the data.

**Q1. Define a hotspot in one sentence, naming both axes.**

<details><summary>Answer</summary>

A **hotspot** is a unit of code — usually a file, ideally a function — that is **both complex (hard to change)** and **high-churn (frequently changed)**; it sits in the top-right corner where the two axes multiply, which is where refactoring effort returns the most. Neither axis alone qualifies: complexity without churn is dormant debt; churn without complexity is a config file doing its job.
</details>

**Q2. Why churn *times* complexity rather than either alone?**

<details><summary>Answer</summary>

Because the cost of bad code is paid **per change**, so total cost ≈ complexity × frequency-of-change. Complexity is the *price per edit*; churn is the *number of edits*. A 3,000-line tangle nobody touches has a high price but zero quantity, so the bill is zero. A flag file you edit daily has high quantity but ~zero price. Only the **product** — high on both — produces a large, recurring bill. The multiplication is the whole insight: it ranks files by *expense*, not by *ugliness*.
</details>

**Q3. Why isn't the biggest file in the repo the right thing to refactor first?**

<details><summary>Answer</summary>

Size measures neither change-cost nor change-frequency. The biggest files are overwhelmingly **generated code, vendored libraries, lockfiles, or fat constant tables** — huge but never hand-edited, so refactoring them spends effort on code that was never going to bite you. Line count is at best a crude complexity *proxy* and carries **zero churn signal**. Sorting by size optimizes for the wrong variable; you'd "pay down debt" on the one part of the codebase that wasn't charging interest.
</details>

**Q4. The team agrees `billing.py` is "our worst file." Should you just refactor it?**

<details><summary>Answer</summary>

Not on that basis alone. "Worst file" is **intuition, and intuition is biased toward the loud and the recent** — people remember the file that paged them last week, not the quietly-expensive one six people touch a little every sprint. Before committing a sprint, confirm with data: `git log --oneline -- billing.py | wc -l` for raw churn, how recent the commits are, and how many are `fix:` commits. If it's genuinely complex *and* hot *and* defect-prone, agree. If it's memorably ugly but rarely touched, it's dormant debt — defer it and spend the budget where churn is high.
</details>

**Q5. Why does Tornhill call it "your code as a crime scene"?**

<details><summary>Answer</summary>

It's an investigative metaphor: a detective doesn't search the whole city, they follow the evidence to where the crime concentrated. Likewise you don't audit all 5,000 files — you let the **evidence (the commit history)** point you at the few places where change and complexity collide. The version-control log is the forensic record: every commit is a witness statement about which files keep causing trouble. The technique turns "where's the bad code?" from an opinion into a query over evidence everyone can see.
</details>

**Q6. What's a good *cheap* complexity proxy, and why does Tornhill often use indentation?**

<details><summary>Answer</summary>

The cheapest is **lines of code** — trivial to compute, language-agnostic, and surprisingly well-correlated with "hard to change." A better proxy that's still language-agnostic is **indentation depth** (mean/max leading whitespace): deeply nested code tends to have high cyclomatic complexity and is harder to read, and you can measure it without parsing the language. Tornhill favors indentation precisely because it generalizes across every language in a polyglot repo without per-language tooling. Real cyclomatic complexity is more accurate but needs a parser per language; for *ranking* hotspots, the cheap proxies are usually enough — you only need the ordering, not an exact score.
</details>

**Q7. Is high churn always bad?**

<details><summary>Answer</summary>

No — high churn on **simple** code is usually healthy. A routing table, a feature-flag list, an i18n strings file, or a config map changes constantly *by design* and is trivial to change safely. That's the bottom-right quadrant: busy but simple, leave it alone. Churn only signals trouble when it coincides with **complexity**, because then each of those frequent edits is expensive and error-prone. Flagging churn alone would bury you in false positives from exactly the files that are *supposed* to change often.
</details>

**Q8. At what granularity should you compute hotspots — file or function — and why does it matter?**

<details><summary>Answer</summary>

Start at **file** level because it's trivial from `git log` and good enough to find the ~10 files worth attention. But file-level hotspots are coarse: a 2,000-line file might be 95% stable with one churning 80-line function. Tornhill's *X-Rays* technique drops to **function/method level** by diffing the git history *within* a file and attributing changes to enclosing functions, so you can target the specific method to extract rather than "the whole file." Function-level matters because it tells you *what* to refactor, not just *which file to open* — it makes the backlog item concrete and small.
</details>

---

## Mining Churn from Git

> The commands, and what each measures.

**Q9. Write the command that counts how many commits ever touched `src/auth/session.go`.**

<details><summary>Answer</summary>

```bash
git log --oneline --follow -- src/auth/session.go | wc -l
```

`git log -- <path>` restricts to commits that changed that path; `| wc -l` counts them. `--oneline` makes each commit exactly one line so the count is correct. Add `--follow` so a file that was *renamed* keeps its history instead of resetting to zero at the rename (a common churn-undercount trap). For a time-boxed view add `--since='1 year ago'`.
</details>

**Q10. Commit-count vs lines-changed (added+deleted) as a churn metric — when does each mislead?**

<details><summary>Answer</summary>

- **Commit count** treats every commit equally, so a one-character typo fix counts the same as a 400-line rewrite. It over-weights files that get many tiny touches and under-weights big infrequent rewrites. But it's robust to a single huge reformat.
- **Lines changed (added+deleted from `--numstat`)** captures the *volume* of change, so it distinguishes a real rewrite from a typo — but it's wildly skewed by a single bulk reformat (`prettier`/`gofmt`) commit that rewrites thousands of lines with no semantic change, and by generated files.

Best practice: report **both**, and clean the data (exclude formatting commits, generated paths) before trusting either. Many teams primarily rank by **number of commits** because it best approximates "how often a developer had to engage with this file," which is the cost you actually pay.
</details>

**Q11. Write a one-liner that produces a top-20 churn ranking for the whole repo.**

<details><summary>Answer</summary>

```bash
git log --since='1 year ago' --name-only --pretty=format: \
  | grep -v '^$' \
  | sort | uniq -c | sort -rn | head -20
```

`--name-only --pretty=format:` emits just the changed file paths (the empty `--pretty` suppresses commit headers); `grep -v '^$'` drops the blank lines between commits; `sort | uniq -c | sort -rn` tallies each path and ranks by frequency. The result is "files ranked by number of commits that touched them in the last year" — the churn axis for the whole repo in one pipe, no special tools.
</details>

**Q12. Why restrict the analysis to a time window instead of all history?**

<details><summary>Answer</summary>

Because **relevance decays**. A file that churned heavily three years ago during a rewrite but has been stable since is not a *current* hotspot — refactoring it now buys nothing. A trailing window (6–12 months) measures where the cost is being paid **today and likely next quarter**, which is what prioritization needs. All-history churn also dilutes recent signal with ancient noise and is dominated by the founding mega-commits. Choose the window to match your planning horizon; recompute periodically because hotspots move.
</details>

**Q13. How do you get the complexity axis cheaply, and how do you join it to churn?**

<details><summary>Answer</summary>

Complexity proxy = current `wc -l` (or indentation depth) of each file *as it exists now* — you only care about complexity of code that still exists. Join on the file path: churn comes from `git log` aggregation, complexity from walking the working tree, and you inner-join the two by path into a table with columns `path, commits, loc`. Files present in churn but missing from the tree are deleted — drop them. Then rank by `commits * loc` (or plot the two axes and read the top-right). A ~30-line Python script does the whole join; the `tasks.md` for this topic builds it.
</details>

---

## Change Coupling & Defect Coupling

> Temporal coupling, logical coupling, and bug-density signals.

**Q14. What is change coupling (a.k.a. temporal / logical coupling)?**

<details><summary>Answer</summary>

**Change coupling** is when two files keep changing **together in the same commits**, even though there's no explicit code dependency between them — no import, no call. It's a *behavioral* coupling discovered from history, not a *structural* one you'd find by reading the code. The classic example: every time someone edits `OrderService`, they also have to edit `OrderServiceTest` and `order_schema.sql` — three files joined by an invisible contract. High change coupling between files that *shouldn't* be related is a design smell: a leaky abstraction, a shotgun-surgery pattern, or a copy-paste pair drifting in lockstep.
</details>

**Q15. How do you compute the change coupling between two specific files from git?**

<details><summary>Answer</summary>

Coupling is the conditional: *of the commits that touched A, what fraction also touched B?* Operationally:

```bash
# commits that touched A
git log --pretty=%H -- src/order/service.go | sort > /tmp/A
# commits that touched B
git log --pretty=%H -- src/order/repository.go | sort > /tmp/B
# how many commits touched BOTH
comm -12 /tmp/A /tmp/B | wc -l
```

Then `degree(A→B) = |A∩B| / |A|` and `degree(B→A) = |A∩B| / |B|`. The two directions differ when one file changes far more often than the other, which is itself informative (B almost never changes without A, but A often changes alone). Report both directions plus the absolute count of shared commits, so a 100%-coupling pair that shares only *two* commits isn't mistaken for a strong signal.
</details>

**Q16. Why report the coupling *degree* (a ratio) and not just the raw count of shared commits?**

<details><summary>Answer</summary>

A raw shared-commit count conflates "strongly coupled" with "frequently changed." Two files that each appear in 500 commits and share 50 look the same, by raw count, as two niche files that appear in 50 commits each and share 50 — but the first pair is coupled 10% of the time and the second 100% of the time. The **ratio normalizes for base churn**, so it expresses "when one changes, how often must the other change too." You still keep the absolute support count as a confidence guard: a 100% degree over 3 commits is noise; a 70% degree over 80 commits is a real architectural fact.
</details>

**Q17. What is defect coupling / defect density, and how is it different from churn?**

<details><summary>Answer</summary>

**Defect density** prioritizes files by how many *bug-fixing* commits touch them, not all commits. You filter the log to fixes — typically by commit-message convention (`git log --grep='^fix' -i`) or by linked issue type — and count those per file. **Churn** counts *every* change (features, refactors, fixes); **defect density** isolates the change that signals **error-proneness**. A file with 80 commits of which 60 are `fix:` is qualitatively worse than one with 80 commits that are mostly features — both are hot, but the first keeps *going wrong*. Defect-coupling extends this: pairs of files that keep being fixed *together* often share a hidden bug-prone contract. Caveat: it's only as good as your commit hygiene — sloppy or untyped messages make the filter lossy.
</details>

**Q18. A file has high complexity, high churn, *and* most of its commits are `fix:` commits. What does that tell you, and what's the move?**

<details><summary>Answer</summary>

That's the worst quadrant and the strongest possible signal: complex **and** constantly changed **and** the changes keep being corrections. This file is actively manufacturing bugs and burning the team's time on every release. It's almost certainly your **#1 refactoring target**. The move: pin its behavior with characterization tests (the high fix-rate means latent bugs you must *not* silently re-break), drop to function-level to find the specific churning method, extract it into cohesive units, and — critically — put a **fitness function / ratchet** around it afterward so the complexity can't creep back. Lead the proposal with the cost number ("60 fix commits in 6 months in this one file"), not the aesthetics.
</details>

**Q19. How does change coupling reveal a problem that complexity metrics alone can't?**

<details><summary>Answer</summary>

Complexity and churn are **per-file** metrics — they describe each file in isolation. Change coupling is a **relational** metric: it surfaces *distributed* problems where no single file looks bad but the *pair* does. Shotgun surgery (one logical change forces edits across many files), leaky layering (a UI file that always changes with a DB file), and copy-paste twins drifting together are invisible to LOC and cyclomatic complexity but jump out of the co-change matrix. It's the difference between "this file is messy" and "this *boundary* is wrong" — and the second is often the more expensive, more architectural problem.
</details>

---

## Pitfalls & Data Hygiene

> The ways the analysis lies if you don't clean the inputs.

**Q20. A single `prettier`/`gofmt` reformat commit reformatted 1,200 files. How does that corrupt your churn ranking, and how do you fix it?**

<details><summary>Answer</summary>

If you rank by **lines changed**, that one commit adds enormous line-churn to 1,200 files with **zero semantic change**, vaulting otherwise-stable files into the top of the ranking. If you rank by **commit count**, it adds exactly one commit to each of those files — much less distorting, which is one reason commit-count is the more robust default. The fix: **exclude formatting commits from the analysis.** Best practice is to record such commits' SHAs in a `.git-blame-ignore-revs` file and filter them out (`git log --invert-grep --grep='style: reformat'`, or explicitly exclude the SHA range). Mature teams isolate pure-format changes into their own labeled commits *precisely so* they can be filtered from history-mining and `git blame`.
</details>

**Q21. A file was renamed from `gateway.py` to `payment_gateway.py`. Why might your churn numbers be wrong, and what's the fix?**

<details><summary>Answer</summary>

By default `git log -- payment_gateway.py` only shows history *after* the rename, so a file with 200 commits of accumulated churn appears to be a brand-new file with 3 — its history "resets" and you under-count its churn, possibly dropping a real hotspot off the list. The fix for a single file is `git log --follow -- payment_gateway.py`, which traces through the rename. For a whole-repo aggregation, `--follow` doesn't apply (it's single-path only); instead you either post-process to merge old and new paths, or accept that `--name-only` already attributes pre-rename commits to the *old* path — so you must **reconcile renamed paths** rather than treat the new name as fresh. Renames are the single most common silent churn-undercount.
</details>

**Q22. Why must you handle merge commits carefully, and how?**

<details><summary>Answer</summary>

A merge commit can **double-count** changes: the same line edits appear both in the original feature commits *and* (in some log configurations) attributed to the merge commit itself, inflating churn for everything in the merged branch. Conversely, with default first-parent-style logging you might *miss* changes that only appear on the merged side. The fix: be explicit. Use `--no-merges` to exclude merge commits entirely (the usual choice — the real edits live in the underlying commits), or, if your workflow squash-merges, the squash commit already is the single source of truth. The principle: **decide whether a logical change is counted once**, and configure the log so each edit is attributed exactly one time.
</details>

**Q23. One commit touched 500 files (a dependency bump / license-header insertion). How does counting "commits per file" misrepresent reality?**

<details><summary>Answer</summary>

It inflates the churn of 500 files by +1 each for a change that wasn't real engineering on any of them — a bot bumped a version string or stamped a license header. Those files didn't get *worked on*; they got *touched*. The symmetric trap is **commit-count for the file** vs **files-per-commit**: a sprawling commit is a weak signal *per file* even though it's a big diff overall. Fixes: filter out mechanical/bot commits (by author, e.g. `dependabot`, or by message), and treat very-wide commits skeptically — optionally cap or down-weight a commit's contribution by how many files it spans, so a focused 1-file fix counts more per-file than a 500-file sweep.
</details>

**Q24. Why is ranking by LOC (file size) alone a flawed hotspot analysis even as a complexity proxy?**

<details><summary>Answer</summary>

Because it's **half the analysis with the wrong half emphasized**. LOC is only the *complexity* axis (and a crude one — a long flat lookup table is large but simple), and it carries **no churn information at all**. Ranking by LOC alone reproduces exactly the "refactor the biggest file" mistake: the top of the list fills with generated code, vendored libs, and dormant giants. LOC earns its place *only* multiplied by churn. As a standalone ranking it's actively misleading — it points confidently at the cheapest code to ignore.
</details>

**Q25. Your commit messages are inconsistent (`fix`, `Fix`, `bugfix`, `hotfix`, untyped). What does that do to defect-density analysis, and what do you do?**

<details><summary>Answer</summary>

It makes the `--grep` filter **lossy and biased**: you under-count fixes that don't match your pattern, and the under-counting isn't random — teams or eras with looser conventions look artificially healthy. Mitigations: broaden and case-insensitive the pattern (`-iE 'fix|bug|hotfix|patch'`), but recognize the ceiling — message-mining is a heuristic. The more reliable signal is **linked issue tracker data**: join commits to tickets and count commits whose ticket is typed *Bug*. Long-term, adopt Conventional Commits so the signal becomes trustworthy. Always caveat defect-density results with "as good as our commit hygiene," and corroborate with revert-rate or post-incident links.
</details>

---

## Driving a Refactoring Backlog

> From a ranked list to actual prioritized work.

**Q26. You've produced a ranked hotspot list. How does it become a refactoring backlog?**

<details><summary>Answer</summary>

The list is the *input*, not the answer. Turn it into a backlog by: (1) taking the **top N hotspots** (not all — the list has a long, low-value tail); (2) for each, dropping to **function level** to find the specific churning, complex method so the work item is concrete and small; (3) writing each as a ticket framed by **cost** ("this method took 22 commits and 9 fixes in 6 months") and **payoff** ("on the roadmap path for Q3 billing work"); (4) sequencing by **expected savings × alignment with upcoming features** — refactor what you're about to build on, not what's merely ugly; and (5) attaching a **fitness function** so each cleaned hotspot stays clean. Each item should be a small, shippable, behavior-preserving change, not a "rewrite the module" epic.
</details>

**Q27. Two files tie on churn × complexity. What tiebreakers decide which to fix first?**

<details><summary>Answer</summary>

In rough order: (1) **defect density** — the one with more `fix:` commits is actively hurting you; (2) **roadmap alignment** — the one on the path of upcoming features pays off immediately as you build there; (3) **bus factor** — if one author wrote 95% of a hotspot and they're leaving, fixing/spreading knowledge there is urgent risk reduction; (4) **change coupling** — a hotspot that drags several other files with it on every edit has a larger blast radius, so untangling it saves more; (5) **safety** — which one can you wrap in characterization tests cheaply. Ugliness is *not* a tiebreaker. Let cost, risk, and upcoming work decide.
</details>

**Q28. What is the bus factor and how do you read it from git?**

<details><summary>Answer</summary>

Bus factor is **how many people would have to be "hit by a bus" before a piece of code has no one who understands it** — effectively, how concentrated the knowledge is. You approximate it from authorship: `git log --pretty='%an' -- path | sort | uniq -c | sort -rn` shows each author's share of commits to a file (or, more precisely, `git blame` line-ownership for *current* knowledge). A hotspot where **one author owns 90%+** is doubly dangerous: it's already complex and churning, *and* the knowledge to change it safely lives in a single head. Hotspot + low bus factor = top-priority risk, because losing that person freezes a file the team can't afford to freeze.
</details>

**Q29. How do you justify the #1 target to a skeptical product manager who wants features, not refactoring?**

<details><summary>Answer</summary>

Speak in **cost and delivery risk**, never in aesthetics. "This one file absorbed 22% of all engineering touches and 9 of our last 14 production bug-fixes in the last two quarters. The Q3 billing features all route through it. At its current change-cost, those features will each take ~1.5× longer and carry the same defect risk. A two-sprint cleanup, gated so it can't regress, pays for itself across the three features that follow." You're not asking to "clean code" — you're proposing to **lower the cost and risk of the work product wants next**, backed by numbers from their own history. That reframing is the entire pitch.
</details>

**Q30. When should you *not* refactor a top-ranked hotspot?**

<details><summary>Answer</summary>

When the cost outweighs the payoff despite the ranking: (1) the file is **slated for deletion or replacement** soon — don't polish what's about to disappear; (2) you **can't establish a safety net** (no tests, no characterization possible) and the file is on a critical path — refactoring blind trades known cost for unknown breakage; (3) the churn is **legitimate and irreducible** (a genuinely volatile business rule that *will* keep changing — restructure for changeability, but don't expect the churn to stop); (4) there's **no upcoming work** near it, so the refactor is a speculative investment with no near-term return. The ranking finds candidates; judgment decides whether *now* is the time.
</details>

**Q31. How often should hotspot analysis be re-run, and why not "once"?**

<details><summary>Answer</summary>

Continuously — hotspots **move**. Code you refactor cools; new features create new hot files; a fixed bug stops being a defect-density signal. A one-time analysis is a snapshot that's stale within a quarter. Practical cadence: recompute each sprint or each release on a trailing window, ideally automated in CI so the ranking is always current. Tools like CodeScene do this continuously and even trend hotspots over time (warming vs. cooling). The value compounds when it's a **live dashboard** the team steers by, not a one-off audit slide deck.
</details>

---

## Relation to Fitness Functions & Ratchets

> Closing the loop so cleaned hotspots stay clean.

**Q32. How do hotspot analysis and architecture fitness functions complement each other?**

<details><summary>Answer</summary>

They're the two halves of a control loop. **Hotspot analysis is diagnostic** — it looks *backward* over history to find where complexity and churn already collided, telling you *what to fix*. **Fitness functions are preventive** — they run *forward* in CI as automated checks that fail the build if a chosen property (max complexity, max file size, forbidden dependency) degrades, telling you *what not to let happen again*. You use the hotspot to *find* the problem, refactor it, then write a fitness function so that exact regression is caught automatically. One without the other is incomplete: diagnosis without prevention means the hotspot re-forms; prevention without diagnosis means you guard arbitrary thresholds instead of your actual pain points.
</details>

**Q33. What is a ratchet, and how does it apply to a just-refactored hotspot?**

<details><summary>Answer</summary>

A **ratchet** is a fitness function that only allows a metric to move in the good direction: it records the current value as the new ceiling and fails the build if any change makes it worse, but happily accepts improvements. After you refactor a hotspot from, say, cyclomatic complexity 45 down to 18, you set a ratchet at 18 (or 20 with slack). Now the file *cannot* climb back to 45 without a deliberate, visible decision — every PR that would worsen it goes red. The ratchet **locks in the gain** so the expensive cleanup isn't quietly undone by the next six "just one more `if`" commits. It turns a point-in-time refactor into a durable floor.
</details>

**Q34. Could you build a fitness function that uses churn directly, not just static complexity?**

<details><summary>Answer</summary>

Yes, and it's powerful. Static fitness functions check the code *as it is*; a **history-aware** one checks the *trend*. Examples: fail CI (or open a tracking issue) when a file crosses a churn threshold in a trailing window *and* exceeds a complexity threshold — i.e. when it becomes a hotspot by definition; or alert when **change coupling** between two files that *shouldn't* be coupled rises above a degree threshold, catching architectural erosion as it happens. This is harder to implement (the check needs git history, not just the working tree) and noisier, so it's often run as a **periodic report** rather than a hard build gate — but conceptually it closes the loop tightest: the very signal that *defines* a hotspot becomes the guardrail that prevents one.
</details>

---

## Curveballs

> Questions designed to catch glib answers.

**Q35. "Our hotspot is `schema.sql` and our test file. Should we refactor them?"**

<details><summary>Answer</summary>

Probably not in the usual sense — this is a **change-coupling** finding, not a single-file-complexity one. A schema file and its migrations *should* change when the model changes; a test file *should* change when the code under test changes. High churn there is often legitimate coupling, not a defect. The real question is whether the coupling is **expected** (test ↔ code: fine) or **surprising** (a UI file always co-changing with a low-level DB file: a leaky boundary worth fixing). Don't refactor the symptom; investigate *why* they co-change. If it's a healthy contract, leave it; if it's a missing abstraction forcing shotgun surgery, fix the boundary.
</details>

**Q36. "We rewrote the module last month, so its churn is huge — it must be a hotspot."**

<details><summary>Answer</summary>

That's a **window artifact**, not a true hotspot. A one-time rewrite spikes churn over the last month but says nothing about *ongoing* change-cost; the file may now be clean and stable. Hotspot analysis measures *sustained* collision of churn and complexity, so look at a window that isn't dominated by the rewrite event, or trend the churn — is it *staying* hot or was it a one-off burst? A freshly-rewritten file that's now simple and quiet is the opposite of a hotspot. Always ask whether recent churn is *structural and recurring* or a *single event* the window happened to catch.
</details>

**Q37. "Hotspot analysis just tells us what we already know — the senior dev could've named those files."**

<details><summary>Answer</summary>

Sometimes the top file confirms a hunch — and that's a *feature*: it validates the method cheaply. But the value isn't in the obvious #1; it's in (a) the **ranking** — intuition can name *a* bad file, not reliably order ten by cost; (b) the **non-obvious entries** — the quietly-expensive file everyone touches a little, which intuition systematically forgets; (c) **transferability** — a new hire or a 5,000-file monolith nobody fully knows has no intuition to consult, but the history is the same for everyone; and (d) **objectivity** — "the data says this file caused 9 of 14 recent bugs" defuses the politics that "I think this file is bad" invites. It augments the senior's judgment and democratizes it; it doesn't replace it.
</details>

**Q38. "Let's just buy CodeScene and skip the homemade scripts."**

<details><summary>Answer</summary>

CodeScene (Tornhill's commercial tool) is excellent — it does function-level hotspots, change-coupling maps, knowledge/bus-factor visualizations, and trend tracking, productionized. But you don't need it to **start**, and you shouldn't treat it as a prerequisite: `git log`, `wc -l`, `sort`, `uniq`, and a 30-line Python script deliver ~80% of the value and, more importantly, *teach the team what the numbers mean* so they trust and act on them. Buy the tool when you've outgrown the scripts — when you want continuous, function-level, multi-repo analysis with nice visualizations and want to stop maintaining your own pipeline. The methodology, not the license, is what creates value.
</details>

**Q39. "Should the file with the single highest churn always be #1 on the backlog?"**

<details><summary>Answer</summary>

No — highest *churn* isn't highest *priority*. The top-churn file is frequently a config, routing, or strings file that's simple and *should* change a lot; refactoring it is pointless. Priority is **churn × complexity**, then weighted by defect density, roadmap alignment, and bus factor. The #1 *backlog* item is the file highest on the *combined* signal, which is often **not** the file highest on either single axis. Anyone who sorts by churn alone and starts at the top will spend their first sprint "refactoring" a feature-flag list.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in a sentence or two.

**Q40. Hotspot in five words?**

<details><summary>Answer</summary>

Complex *and* frequently-changed code.
</details>

**Q41. The single formula?**

<details><summary>Answer</summary>

Refactoring priority ≈ churn × complexity (then weight by defect density, roadmap, bus factor).
</details>

**Q42. One command for repo-wide churn?**

<details><summary>Answer</summary>

`git log --name-only --pretty=format: | sort | uniq -c | sort -rn | head` — files ranked by number of commits.
</details>

**Q43. Change coupling in one sentence?**

<details><summary>Answer</summary>

Two files that keep changing in the same commits despite no code dependency — a coupling found in history, not in the source.
</details>

**Q44. Defect density vs churn?**

<details><summary>Answer</summary>

Churn counts *all* commits; defect density counts only *bug-fix* commits — error-proneness, not just activity.
</details>

**Q45. The most common data-hygiene trap?**

<details><summary>Answer</summary>

A bulk reformat (`prettier`/`gofmt`) commit inflating line-churn; exclude it, and prefer commit-count over lines-changed.
</details>

**Q46. Hotspot's relationship to fitness functions?**

<details><summary>Answer</summary>

Hotspot = backward-looking diagnosis (what to fix); fitness function/ratchet = forward-looking guard (keep it fixed). Diagnose, refactor, then ratchet.
</details>

**Q47. Why not refactor the biggest file?**

<details><summary>Answer</summary>

Size has zero churn signal; the biggest files are usually generated or dormant — huge but never edited.
</details>

---

## How to Talk About Hotspots in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the formula and the *why* behind the multiplication.** "Cost is paid per change, so it's complexity × churn" shows you understand the mechanism, not just the buzzword.
- **Always name the data-hygiene caveats unprompted.** Reformat commits, renames, merge double-counting, and 500-file sweeps. Mentioning these is the senior tell — it proves you've actually run the analysis, not just read about it.
- **Distinguish the three signals:** churn (activity), defect density (error-proneness), change coupling (relational). Knowing when to reach for each beats "I'd look at git history."
- **Frame the output as prioritization, not diagnosis.** Hotspot analysis says *which file to read first*, not *what's wrong with it* — you still apply refactoring judgment once it points you there.
- **Connect it to the control loop.** Diagnose with hotspots → refactor → lock in with a ratcheting fitness function. Showing the *closed loop* signals system-level thinking.
- **Sell it in cost terms.** Demonstrate you'd pitch the #1 target to product with numbers and roadmap alignment, not aesthetics.
- **Avoid purism.** "Highest churn = top priority," "always refactor the worst file," "you need CodeScene to start" are all juniorisms. Calibrate: churn × complexity, weighted by context, scripts before tools.

---

## Summary

- A **hotspot** is code that is **both complex and high-churn**; priority ≈ **churn × complexity**, because the cost of bad code is paid *per change*. Neither axis alone qualifies — complexity without churn is dormant; churn without complexity is healthy config.
- **Churn comes from `git log`** (commit-count is the robust default; lines-changed is more granular but skewed by reformats). Restrict to a **trailing window** because relevance decays and hotspots move.
- **Change coupling** (co-change in history despite no code link) and **defect density** (bug-fix commits per file) are the relational and error-proneness signals that complexity-alone misses.
- The analysis lies if you don't clean inputs: **reformat commits, renames, merge double-counting, 500-file sweeps, and LOC-alone ranking** are the canonical traps. Filter, `--follow`, `--no-merges`, and prefer commit-count.
- A ranked list becomes a **backlog** by taking the top N, dropping to function level, framing each in **cost + roadmap** terms, and weighting ties by defect density, bus factor, and coupling.
- Close the loop: hotspots **diagnose** (backward); **fitness functions and ratchets** prevent regression (forward). Diagnose → refactor → ratchet.

---

## Related Topics

- [`junior.md`](junior.md) — what a hotspot is and why the biggest/ugliest file is the wrong first target.
- [`senior.md`](senior.md) — change coupling, defect density, and bus factor at scale.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the mining, the flawed analyses, and the efficient pipeline.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) — gate a refactored hotspot so it can't regress.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/senior.md) — fix a hotspot that spans many files.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/senior.md) — incrementally replace a hot, complex module without a big-bang rewrite.
- [Bad Structure → Senior](../../01-development/01-bad-structure/senior.md) — the shapes (God Object, spaghetti) hotspots usually contain.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the organizational view of the same costs.
