# The Mikado Method — Interview

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

Model answers. Aim to explain the *why*, not just recite steps — interviewers probe the revert discipline and the "when not to" hardest.

---

### Q1. What problem does the Mikado Method solve?

**A.** Large, *deep* refactorings where the dependency graph is unknown up front. You want one change; making it breaks things, fixing those breaks more, and you sink into a half-broken "swamp" with no working baseline and no idea what's left. Mikado is a disciplined way to make such changes while keeping the system compiling-and-passing at every committed step, by *discovering* the dependency tree experimentally instead of guessing it.

---

### Q2. Walk me through the core loop.

**A.** (1) Set a concrete, checkable **goal** at the root of an empty graph; start from green. (2) **Attempt the change naively**, as if nothing blocked it. (3) **Observe** what the compiler/tests break. (4) For each break, **note a prerequisite** as a child node. (5) **Revert** to green — throw the attempt away, keep the graph. (6) **Recurse into a leaf** (a prerequisite with no children): attempt *it* naively, and so on. (7) When a leaf change is **non-breaking**, *don't* revert it — **commit it**, cross it off, and walk back up. Repeat until the goal itself is a non-breaking change.

---

### Q3. Why on earth do you revert work that "almost compiles"? Isn't that wasteful?

**A.** Three reasons. **Shippability:** between commits the code always works, so you can stop, hand off, or be interrupted with zero stranded breakage. **Swamp prevention:** fixing-as-you-go spawns a growing front of broken code you can't reason about; reverting caps the blast radius to one small experiment. **Truth:** observing each break against a *clean* baseline reveals the real dependency tree — fixing-as-you-go blurs all dependencies into one mess. And it's not wasteful, because the valuable output of an attempt isn't the code — it's the *knowledge* of what broke, which is saved in the graph. The code is cheap to re-type.

---

### Q4. Explain the graph: root, children, leaves, and execution order.

**A.** The **goal** is the root. **Prerequisites** are children: "to do the parent, first do me." A **leaf** is a prerequisite with no children. Execution is **leaf-first, root-last** — the opposite of a to-do list; the deepest node is done soonest. You may only *attempt* a leaf, because anything with unmet children isn't yet doable. The graph **grows** as attempts reveal prerequisites and **shrinks** as you commit non-breaking leaves, collapsing toward the root.

---

### Q5. What makes a good Mikado goal? Give a good and a bad one.

**A.** It must be a **concrete, observable, binary end-state** — you can look and say done/not-done. Good: *"`OrderService` receives `Config` via its constructor and nothing reads `Config.INSTANCE`."* Bad: *"clean up the config code"* — unmeasurable, so you can't tell when to commit and the graph has no root. The goal states the *what*, never the *how*; the *how* is the graph you discover.

---

### Q6. How does Mikado relate to Branch by Abstraction and Parallel Change?

**A.** They're tactics; Mikado is the strategy that sequences them. **Branch by Abstraction** (introduce a stable interface, swap implementations behind it) frequently appears *as a node* in the graph — often the leaf that breaks a cycle. **Parallel Change / expand–contract** is how you make each node non-breaking: add the new constructor/method (expand), migrate callers, delete the old (contract). Mikado decides the *order* of nodes; those patterns make each node shippable.

---

### Q7. How do characterization tests fit in?

**A.** Mikado's whole signal is "green build = behavior preserved." That's only trustworthy if you have tests pinning current behavior. In legacy code with no tests, you first add **characterization tests** (the *working-with-legacy-code* discipline — Feathers) to establish the red/green signal, *then* run the Mikado loop on top of it. Without a reliable green/red, "revert on red" has nothing meaningful to react to.

---

### Q8. When should you NOT use the Mikado Method?

**A.** (1) **Small, known-scope refactors** — if the whole change fits in your head and finishes in one green step, just do it with normal TDD/IDE refactorings; a graph is ceremony. (2) **When reverting is more expensive than learning once** — slow builds/heavy fixtures; do a throwaway *spike* to draw the graph, then execute cleanly. (3) **When behavior is changing**, not just structure — green no longer means "behavior preserved," so the signal breaks; separate the behavior change first. (4) **No test net and can't get one cheaply** — no reliable red/green to drive the loop.

---

### Q9. You attempt the goal and the build breaks in five places. Exactly what do you do?

**A.** I do *not* start fixing. I add five prerequisite nodes (one per distinct break) under the goal, then **revert to green** (`git checkout .`). Now I pick one leaf and attempt *that* naively. The only legal moves after a red naive attempt are "record the prerequisite" and "revert."

---

### Q10. Your graph has been growing for two days and never starts shrinking. Diagnose.

**A.** Usually one of: **goal too big** — slice it into independently-shippable goals; **an architectural blocker** — a pervasive dependency (global/god-object) appearing under every branch, or a **cycle** that leaf-first can't resolve (you must break it with an abstraction/dependency inversion first); or **too-coarse reverts** causing you to re-discover the same prerequisites. The growth itself is valuable information — it's measuring the coupling. Stop executing and re-scope or change strategy.

---

### Q11. How do you parallelize a Mikado refactor across a team?

**A.** The graph *is* the dependency analysis. Assign **whole independent subtrees** to different engineers (not random leaves) so they don't share files/conflicts. **Shared leaves** (DAG joins, e.g. "extract the `Config` interface") are serialization barriers — one person does them first, everyone rebases, then fan out. Every cleared leaf still commits green to trunk, so branches integrate continuously instead of in one terrifying merge. You can't parallelize a swamp — there's no clean baseline and no map of what's independent.

---

### Q12. How do you estimate and report progress on a Mikado refactor?

**A.** The **partial graph is the estimate**: known remaining leaves × average leaf cost gives a lower bound; the *discovery rate* (new prerequisites per attempt) tells you whether it's converging or expanding — report a **range plus trend**, never a fake point number. Progress reporting is the shrinking graph and the green leaf-commit log: "8 of ~20 prerequisites cleared, all shipped to trunk, can pause anytime." The method makes it impossible to honestly call a swamp "almost done" — a leaf is committed-green or it isn't done.

---

### Q13. What's the hardest part of the method in practice, and how do you handle it?

**A.** The **psychology of revert** — deleting code that almost works, repeatedly, under deadline pressure, fights every sunk-cost instinct. I handle it by reframing the asset (the *graph/knowledge* is the value, not the code), making revert a **rule** not a judgment call (red naive attempt → record + revert, no exceptions), and making revert frictionless (clean baseline, one keystroke) so willpower isn't required. Under deadline the discipline matters *more*, because that's exactly when a stranded swamp is most catastrophic.

---

### Q14. Why must you actually run the tests before committing a leaf you "know" is safe?

**A.** Because the *only* way to know a leaf is non-breaking is to compile and run the relevant tests — "I'm pretty sure" isn't a verified baseline. If you commit an unverified leaf that's actually red, your next revert returns you to *broken* code, and the clean-baseline guarantee — the foundation of the whole method — is gone. Green-or-it-didn't-happen.

---

### Q15. When does the graph stop being a refactoring tool and become an architecture diagnosis?

**A.** When its *shape* reveals structure: a node appearing under almost every branch is a **pervasive coupling point** (global/god-object) worth its own initiative; a **cycle** is a circular dependency that no leaf-first order can resolve and must be broken with a seam; explosive width means a **missing abstraction** everything reaches across. At that point the right move is to capture the finding (it's measured, quantified evidence) and feed it into architecture planning — possibly pivoting to a Strangler around the whole module rather than untangling in place.
