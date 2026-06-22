# Release Branching & Trains — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Release Branching & Trains

*A question bank for explaining and defending branching models, RC promotion, cherry-pick policy, and release trains under interview pressure.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Strategy Selection](#strategy-selection)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

Interviewers probe release branching to test whether you understand *why* a model exists, not just its commands. The strongest answers connect a branching choice to a constraint (deploy frequency, supported versions, regulation), name the cost you're accepting, and reference real systems (Chrome, Kubernetes, Ubuntu). This file uses **Q** / *what's really being tested* / **A** format. Practice saying the answers out loud — concise, concrete, trade-off-aware.

> Focus: **Every branching answer should name a trade-off and a real-world reference; "it depends" must be followed by "on what, and here's how I'd decide."**

---

## Prerequisites

- The [junior](./junior.md) through [senior](./senior.md) tiers of this topic.
- Working `git` fluency: cherry-pick, tag, merge, branch.
- Awareness of CI/CD promotion and feature flags ([06](../06-feature-flags-and-progressive-delivery/)).

---

## Fundamentals

**Q1. What is a release branch and why would you create one?**
*Testing: do you separate integration from release?*
**A.** A release branch is a branch cut from `main` to stabilize and ship one specific version. It freezes the feature set so testers and users have a stable, controllable target while `main` keeps moving with new work. Merging is integration; the release branch is where a deliberate slice becomes shippable. After the cut, only fixes land on it.

**Q2. Compare GitFlow and trunk-based development.**
*Testing: depth beyond buzzwords.*
**A.** GitFlow uses long-lived branches — a permanent `develop`, plus `release/*`, `hotfix/*`, `feature/*` — and integrates *late*, at merge time. Trunk-based has everyone commit to `main` with very short-lived branches; a release is a tag on `main` or a short release branch, and integration happens *continuously*. GitFlow optimizes isolation but creates merge debt and finds conflicts late; trunk-based optimizes early integration but requires feature flags to hide incomplete work. High-velocity teams (Chrome, most SaaS) moved to trunk-based because they deploy faster than features complete, so they can't gate releases on feature branches merging.

**Q3. What's a release candidate, and what's the rule about promoting it?**
*Testing: the promote-don't-rebuild principle.*
**A.** An RC (`v2.4.0-rc.1`) is a proposed release that gets tested; if clean, it becomes GA. The rule: **promote the exact artifact you tested — don't rebuild it.** You move the same immutable, content-addressed artifact (by digest) through stages — staging soak, canary, GA — never recompiling. Rebuilding could pull a newer dependency, base image, or compiler, shipping something you never verified.

**Q4. What is a release train?**
*Testing: cadence as a forcing function.*
**A.** A release train ships on a fixed schedule regardless of feature readiness. If your feature is ready at branch point, it's on the train; if not, it catches the next one. The calendar — not per-feature negotiation — decides what ships, which removes release-day brinkmanship and makes delivery predictable. Chrome's 4-week and Ubuntu's 6-month cadences are the canonical examples.

**Q5. Feature freeze vs code freeze?**
*Testing: precise vocabulary.*
**A.** Feature freeze stops *new features* into the release — only stabilization continues. Code freeze stops *almost everything* — only critical, approved fixes land while the build is locked for final validation. Feature freeze comes first (around branch point); code freeze comes near GA.

---

## Technique

**Q6. Walk me through cherry-picking a fix onto a release branch correctly.**
*Testing: fix-first discipline and traceability.*
**A.** Fix on `main` first so all future versions get it, then cherry-pick to the release branch with `-x` for traceability:
```bash
git switch main            # fix lands as abc123
git switch release/2.4
git cherry-pick -x abc123  # stamps "(cherry picked from abc123)"
git push
```
The `-x` records the origin SHA so anyone can confirm the fix exists on `main`. Never make the release branch the only home of a fix — that causes a regression in the next version.

**Q7. What is "divergence" between a release branch and `main`, and why is it dangerous?**
*Testing: understanding of merge debt.*
**A.** Divergence is the accumulation of different commits on each side after the cut. It's dangerous because (1) a fix that lands only on the release branch reintroduces the bug on `main` (regression), and (2) the longer a branch lives apart, the larger the conflict surface and the harder/riskier any merge becomes — merge debt, which compounds non-linearly with branch lifetime. Mitigations: fix-on-main-first, `-x` traceability, short branch lifetimes, and a periodic divergence audit.

**Q8. How do feature flags relate to branching?**
*Testing: the modern replacement insight.*
**A.** Feature flags let trunk-based work at scale by replacing long-lived feature branches. Instead of isolating incomplete work on a branch, you merge it to `main` *disabled* and integrate continuously, flipping it on when ready (dark launch). This trades branch-management debt (divergence, merge conflicts) for runtime flag debt (stale flags), generally a better trade because flags are observable and reversible without a redeploy. For invasive changes, branch-by-abstraction does the same thing via an interface on `main`.

**Q9. How do you keep an LTS line patched, and what's the cost?**
*Testing: backport realism.*
**A.** When a security fix lands on `main`, you backport it (cherry-pick `-x`) to every supported line, including LTS. The cost is the **backport burden**: older lines have drifted, so the cherry-pick often conflicts and needs a hand-adapted version, and every advisory multiplies by the number of supported lines. That's why teams limit how many lines they keep and prefer fewer, longer LTS lines — the per-line fixed cost dominates.

**Q10. What does a good promotion pipeline look like?**
*Testing: pipeline architecture and gates.*
**A.** `build (once) → staging soak → canary → GA`, promoting the same immutable digest at every step with a gate between stages. Gates are evidence-based (soak error rate, canary SLO compliance, recorded human sign-off), environments differ only in config not build, and every transition is auditable (digest + evidence + approver). Designed well, GA becomes "flip the pointer to the already-soaked digest" — a near-zero-risk operation.

---

## Strategy Selection

**Q11. How do you choose a branching model for a new team?**
*Testing: constraint-driven reasoning, not dogma.*
**A.** Derive it from constraints, don't import a favorite. The key predictor is deploy frequency relative to feature duration:
- Deploy many times/day, one prod version (SaaS) → trunk-based, release = tag, flags for incomplete work.
- Versioned product installed by customers, multiple supported versions → short release branches + LTS/maintenance lines.
- Strong regulatory/audit needs → explicit release branch + signed artifacts + change records.
- Long hardware/firmware cycle → longer stabilization branches are acceptable.
Then I'd name the cost I'm accepting (flag debt vs backport burden vs process overhead) so it's a deliberate choice.

**Q12. A team is on GitFlow and merges hurt every release. What do you recommend?**
*Testing: diagnosing merge debt and prescribing a path.*
**A.** Their pain is late integration / merge debt from long-lived branches. I'd move toward trunk-based: short-lived branches merged to `main` daily, incomplete work behind feature flags or branch-by-abstraction, and release = tag or a short release branch cut from `main`. Drop the permanent `develop`. I'd do it incrementally — shorten branch lifetimes first, introduce flags, then collapse `develop` — and measure integration latency to confirm it's improving.

**Q13. When is GitFlow (or a heavier model) actually the right call?**
*Testing: that you're not dogmatic about trunk-based.*
**A.** When you genuinely ship infrequently to many fixed installations and must support several versions at once, or when regulation demands a frozen, attributable artifact per release with a heavy change process. There, the isolation and explicit release/maintenance branches earn their keep, and the merge-debt cost is lower because you're not deploying continuously anyway. The model should fit the constraints; trunk-based isn't morally superior, just a better fit for high-velocity single-version SaaS.

**Q14. How many release lines should you support?**
*Testing: costed thinking about support matrices.*
**A.** As few as the business commitment requires, sized to your backport capacity. Publish a support matrix (current = all qualifying fixes; older = security/critical; LTS = security only with a published EOL). Each line is recurring backport burden plus CI and triage cost, and it's a legal/finance commitment because customers buy against it. Prefer fewer, longer LTS lines because per-line fixed cost dominates — Ubuntu's LTS and Kubernetes' latest-3-minors are good templates to size against, not copy blindly.

---

## Scenarios

**Q15. It's GA day and one team's flagship feature isn't done. What do you do?**
*Testing: train discipline under pressure.*
**A.** Hold the date. The train's whole value is that the date is fixed and content flexes. The incomplete feature ships dark behind a flag (or is simply not on this train) and catches the next one. Slipping GA for one feature destroys the train as a forcing function and punishes every other team and downstream function that planned around the date. I'd confirm the feature is safely off, ship the rest, and enable it later when ready.

**Q16. A sev-1 security bug is found during code freeze, in production, on three supported versions. Walk me through it.**
*Testing: hotfix + backport + governance under fire.*
**A.** (1) Fix on `main` first. (2) Cherry-pick `-x` to each supported line; the older lines may conflict and need hand-adapted backports. (3) Cut hotfix releases per line, re-soak briefly (or accept a documented risk for sev-1), and ship. (4) Because it's during freeze, I invoke the **exception/break-glass** path — pre-authorized, but fully logged (who/what/when/why) with a mandatory post-incident review. (5) Verify the fix is on `main` and every in-support line so no version regresses, and update the advisory and changelog.

**Q17. Your RC passed staging but you're tempted to rebuild for GA "to be safe." Why is that wrong?**
*Testing: the exact-artifact principle.*
**A.** Rebuilding discards the verification you just did. The new build could resolve a dependency to a newer version, use a different base image or compiler, or pick up an unrelated `main` change — so you'd ship an *unverified* artifact while believing it's tested. Correct practice is to promote the exact immutable digest that passed soak. If the pipeline *can* rebuild during promotion, that's an architectural defect to fix.

**Q18. How would you coordinate a quarterly release across 30 teams?**
*Testing: org-scale coordination.*
**A.** A single published train calendar (branch point, feature freeze, code freeze, release readiness review, GA) that everyone plans against; a train manifest with per-item status (ready / behind flag / catching next train) by branch point; uniform enforcement of "miss the train, catch the next one" so no team can slip GA; a cross-functional readiness review for the go/no-go; and an accountable release manager (often a rotation) running it from a runbook. Incomplete work ships dark; the date holds.

---

## Rapid-Fire

**Q19. Annotated vs lightweight tag for releases?** Annotated — it carries author, date, message, and can be signed; lightweight is just a pointer.

**Q20. Where should a release branch be cut from?** The last known-green commit on `main`, not blind HEAD.

**Q21. What does `git cherry-pick -x` do?** Appends "(cherry picked from commit <sha>)" so you can trace it back to its origin.

**Q22. Tag or branch for a release in pure trunk-based?** A tag on `main`; optionally a short-lived release branch only if you need to stabilize while `main` moves.

**Q23. What's "dark launching"?** Shipping code to production disabled behind a flag, enabling it later per cohort.

**Q24. Chrome's release cadence?** Roughly 4 weeks per milestone train.

**Q25. Ubuntu's cadence and LTS?** 6-month releases; LTS every 2 years with ~5 years of support.

**Q26. What's branch-by-abstraction?** Hiding incomplete work behind an interface on `main` instead of a long-lived branch, then switching the implementation over.

**Q27. Why does merge debt grow non-linearly?** `main` changes under the branch, so conflict surface and semantic-clash risk compound the longer it diverges.

**Q28. One sentence: why does the date stay fixed on a train?** Because a fixed date is a forcing function that removes per-feature negotiation and lets the whole org plan around it.

---

## Red Flags / Green Flags

**Red flags (weak answers):**
- "Always use GitFlow / always use trunk-based" with no constraints.
- Rebuilding the artifact between RC and GA "to be safe."
- Cherry-picking fixes onto a release branch but not onto `main`.
- Slipping the train's GA date for one unfinished feature.
- Treating feature flags as free with no lifecycle/retirement plan.
- A code freeze with no exception/break-glass path (or a break-glass with no logging).
- Committing to a huge support matrix with no backport-cost reasoning.

**Green flags (strong answers):**
- Derives the model from deploy frequency and supported-version count, names the cost accepted.
- Promotes immutable digests through evidence-based gates; rebuild is impossible by construction.
- Fix-on-main-first with `-x` traceability and a divergence audit.
- Holds the date, flags incomplete work dark, "catch the next train."
- Treats flags as governed infrastructure and the rollback primitive.
- Designs freeze authority proportional to blast radius with logged break-glass.
- References real systems (Chrome, Kubernetes, Ubuntu, Node.js) accurately.

---

## Cheat Sheet

```
Models:     GitFlow (isolate, late integration, merge debt)
            Trunk-based (integrate early, flags hide WIP) ← most high-velocity teams
Choose by:  deploy frequency vs feature duration; supported versions; regulation
RC rule:    promote the EXACT artifact (digest); never rebuild
Cherry-pick: fix on main FIRST, then cherry-pick -x to release branch
Train:      fixed date, flexible content; "miss it, catch the next"
Freezes:    feature freeze (no new feats) → code freeze (critical fixes only)
Freeze valve: exception/break-glass = pre-authorized + logged
LTS:        backport security to all in-support lines; fewer/longer lines
Flags:      replace long-lived branches; also the rollback primitive
References: Chrome 4wk · Ubuntu 6mo/LTS 5yr · K8s ~3/yr, latest-3-minors
```

---

## Summary

Interview success here is connecting branching choices to constraints and trade-offs, then grounding them in real systems. Know cold: release branches freeze a slice for shipping; GitFlow isolates (merge debt) while trunk-based integrates early (needs flags), and high-velocity teams chose the latter; RCs are promoted as the *exact tested artifact*, never rebuilt; cherry-picks go fix-on-main-first with `-x` to avoid divergence and regressions; trains fix the date and flex the content; LTS lines cost recurring backport burden; and feature flags are the modern replacement for long-lived branches and the rollback primitive. End every "it depends" with the dimension it depends on and how you'd decide.

---

## Further Reading

- Paul Hammant, "Trunk Based Development" (trunkbaseddevelopment.com)
- Martin Fowler, "Patterns for Managing Source Code Branches" and "Feature Toggles"
- Vincent Driessen, "A successful Git branching model" (plus the author's later caveats)
- Kubernetes release and cherry-pick documentation
- Forsgren, Humble, Kim, *Accelerate*
- The `ci-cd-pipeline-design` and `git-advanced` skills

---

## Related Topics

- [Versioning & SemVer](../01-versioning-and-semver/)
- [Changelogs & Release Notes](../02-changelogs-and-release-notes/)
- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/)
- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/)
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/)
- [Release Automation](../08-release-automation/)
