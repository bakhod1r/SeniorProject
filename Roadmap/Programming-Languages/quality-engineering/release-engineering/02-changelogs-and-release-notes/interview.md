# Changelogs & Release Notes — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Changelogs & Release Notes

> *Interviewers probe whether you understand change communication as a contract and a system — not whether you've memorized the six Keep a Changelog headings.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Automation & Tooling](#automation--tooling)
6. [Contract, Security & Compliance](#contract-security--compliance)
7. [Scenarios](#scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **a question bank that tests reasoning about audiences, contracts, automation trade-offs, security, and org-scale governance — at every seniority.**

Change-communication questions appear in release-engineering, platform, and senior backend interviews. They reward candidates who distinguish the three artifacts, reason about the automation-vs-curation tension, and treat the changelog as a contract and compliance record. Each question below states *what's really being tested* and gives a model answer.

---

## Prerequisites

- All four tier files for this topic (junior → professional).
- [Versioning & SemVer](../01-versioning-and-semver/).
- Working knowledge of Git, CI, and PR workflows.

---

## Fundamentals

**Q1. What's the difference between a changelog, release notes, and a migration guide?**
*Testing: do you know there are three artifacts with three audiences, not one document.*

**A.** Three distinct artifacts. The **CHANGELOG** is for developers/integrators — a complete, terse, technical record of every notable change per version. **Release notes** are for end users — a curated set of highlights focused on impact and benefit. The **migration guide** is for operators/integrators upgrading across a breaking change — step-by-step remediation. They differ in audience, completeness, and tone. Conflating them fails: a user drowns in the changelog's completeness, and an upgrader can't act on a release note's highlights. A good test: the same change ("renamed config key X to Y") becomes a terse entry in the changelog, a one-line "timeouts are clearer now" in release notes, and a numbered before/after step in the migration guide.

**Q2. Describe the Keep a Changelog format.**
*Testing: baseline format literacy.*

**A.** A `CHANGELOG.md` at the repo root, newest-first, with an `## [Unreleased]` section at the top for in-flight changes. Each release is `## [x.y.z] - YYYY-MM-DD` (ISO date). Within each, changes are grouped under six `###` headings: **Added, Changed, Deprecated, Removed, Fixed, Security.** Compare/diff links at the bottom make version headers clickable. Entries are user-facing sentences with links to the issue/PR. The fixed vocabulary lets a reader scan fast for what matters — did anything break, do I need to patch security.

**Q3. Why ISO dates and newest-first?**
*Testing: attention to reader ergonomics.*

**A.** ISO `YYYY-MM-DD` is unambiguous worldwide and sorts lexicographically — `2026-05-12`, not `May 12` (which is ambiguous and unsortable). Newest-first because readers overwhelmingly want the latest release; making them scroll past history to find it is hostile.

---

## Technique

**Q4. What tense and language should changelog entries use?**
*Testing: writing judgment.*

**A.** Consistency within the file matters more than the specific choice; most projects use imperative/simple-present describing the change from the reader's perspective ("Add CSV export," "Fix crash on empty project"). Critically, write **user-facing language, not internal jargon**: "Reduced dashboard memory by 30%," not "Refactored FooManager to use the DI container." The test for every entry: would someone who's never seen the codebase understand what changed and whether it affects them? If it only makes sense with knowledge of your class names, rewrite it.

**Q5. Where and when should a developer add a changelog entry?**
*Testing: process understanding, not just format.*

**A.** In the same PR that makes the change, under the relevant group in `## [Unreleased]` (or as a per-PR intent file with Changesets, or via a conventional commit / `Release-Note:` trailer). The principle is "diary, not memoir" — write it while the context is fresh, not reconstructed from memory at release time. Writing entries at release time means details are lost and entries get skipped under deadline pressure. Hand-editing one `Unreleased` block in every PR also causes constant merge conflicts, which is a strong argument for per-PR intent files or commit-derived generation.

**Q6. How do you document a breaking change well?**
*Testing: contract thinking.*

**A.** The entry must let a reader fix their code without reading your source: state **what broke, the failure mode if ignored, and the remediation**. E.g. "`Client.connect()` is now async; replace `client.connect()` with `await client.connect()`; sync callers get an unresolved Promise." If the fix is more than one line, the changelog entry links to a **migration-guide section** that carries the full before/after. And it shouldn't be a surprise — a good breaking change was `Deprecated` (with a runtime warning) one or more minor versions earlier.

---

## Automation & Tooling

**Q7. Walk me through how Conventional Commits drives versioning and the changelog.**
*Testing: the type→bump→section mapping.*

**A.** Commits follow `type(scope)!: description` with an optional `BREAKING CHANGE:` footer. The type maps to both a SemVer bump and a changelog section: `fix:` → PATCH / Fixed; `feat:` → MINOR / Added; `feat!:` or `BREAKING CHANGE:` → MAJOR / Changed-Removed; `docs/chore/ci/test` → no bump, usually omitted. A tool reads commits since the last tag, takes the highest-precedence change to pick the bump, and renders grouped entries. So one disciplined input (the commit message) yields both the version and the changelog automatically — at the cost of requiring commitlint enforcement so every commit is parseable.

**Q8. Compare git-cliff, semantic-release, release-please, and Changesets.**
*Testing: tool landscape and trade-offs.*

**A.** They differ in input and how much they automate. **git-cliff** is a configurable generator only — you keep control of versioning/publishing. **semantic-release** is fully automated in CI — analyzes commits, computes the version, generates the changelog, tags, and publishes with no human in the loop (great for hands-off single-package libraries, but the auto-generated notes can be bland). **release-please** uses a "release PR" model — it accumulates changes into a PR you can review and edit before merging cuts the release, inserting a human curation point. **Changesets** is the monorepo favorite — authors write per-PR intent files declaring which packages bump and a human-written summary; at release it writes per-package changelogs and propagates dependency bumps. Pick by need: generator vs hands-off vs reviewable vs monorepo.

**Q9. "We'll auto-generate the changelog from every commit." What's the problem?**
*Testing: the automation-vs-curation tension.*

**A.** "Every commit is noise." A reader gets a wall of `fix: typo`, `refactor: rename`, `chore: bump deps`, and the two changes that actually matter are buried. Pure automation gives completeness and consistency but no narrative and no prioritization. Pure curation gives a readable story but is slow and skipped. The mature answer is layered: **automate the complete CHANGELOG** (the record) and **curate the release notes** (the story) by promoting the few user-impacting entries — flagged at authoring time via a `Release-Note:` trailer or `highlight` label, with noise (chore/refactor/test/deps) excluded by default. If your release notes are just the raw generated changelog, you automated the wrong artifact.

---

## Contract, Security & Compliance

**Q10. In what sense is a changelog an API contract?**
*Testing: senior-level reframing.*

**A.** SemVer makes the compatibility promise in numbers; the changelog makes and *records* it in prose. Downstream maintainers read changelogs to decide whether your release is safe to take. So an undocumented breaking change is a broken contract even with a correct major bump — integrators get a silent landmine. The changelog is also auditable evidence ("when did behavior X change?") that support, security, and legal rely on. Practically: review breaking-change entries with the same rigor as the code change; a correct API change with a vague entry is an incomplete change.

**Q11. How should security fixes appear, and why does it matter?**
*Testing: security-disclosure awareness.*

**A.** Always in a dedicated `Security` group, never buried in `Fixed` — defenders scan for it and burying it delays patching across your users. Link the advisory (CVE / GHSA) with severity (CVSS) and state the **fixed inventory** (which versions got the backported fix — `2.x` users need to know `2.9.5` is safe, not just `3.7.2`). Timing is a control: never publish the changelog entry *before* the patch is available, or you hand attackers a zero-day; embargoed fixes ship binary + advisory + changelog simultaneously. The entry is machine-read by scanners (Dependabot, OSV), so precision automatically protects downstream consumers.

**Q12. Why might "version" be the wrong unit for a SaaS changelog?**
*Testing: library-vs-SaaS distinction.*

**A.** For a library, releases are discrete and opt-in — users pin a version and adopt on their schedule, so a per-tag changelog matches the adoption unit. SaaS deploys continuously; there's often no user-visible version, and users can't opt out — a breaking change hits everyone at next login. So the changelog's unit of change should match the *user's* unit of adoption: a dated rollout stream (CalVer or a "Changelog" page), written when a feature reaches GA (flag-100%), not at merge. Feature flags decouple "merged" from "released," so describing what users can now do tracks rollout, not merge.

**Q13. How is a changelog a compliance artifact?**
*Testing: professional-level governance.*

**A.** Change-management controls (SOC 2 CC8, ISO 27001 A.12.1.2) require that production changes are tracked, reviewed, and approved — the changelog plus release record plus approval trail is the evidence; "what shipped on date X and who approved it" must be answerable. This demands integrity: append-only history (never rewrite shipped entries — that breaks the audit trail), attribution, and timestamps. Security-disclosure timing may carry regulatory weight (e.g. EU CRA). Corrections go in a new entry, never by editing the old one.

---

## Scenarios

**Q14. Your team merges 50 PRs/week. CHANGELOG.md edits cause constant merge conflicts and half the PRs forget the entry. Design a fix.**
*Testing: end-to-end process design.*

**A.** Move from hand-edited single-file to a structured-input pipeline. (1) Enforce **Conventional Commits or per-PR Changesets** with commitlint/PR-title lint in CI — kills both problems (no shared block to conflict on; structure is required). (2) Add a **`requires-changelog` check** failing PRs that change behavior without an entry or a justified `skip-changelog` label. (3) Generate the CHANGELOG via **release-please/changesets** in a release PR (no per-PR file edits → no conflicts). (4) Add a **`Release-Note:` trailer** so authors flag user-facing highlights for the curated release notes. (5) A human curates the release notes from the generated changelog at the release-PR gate. Net: completeness automated, story curated, conflicts gone, omissions blocked.

**Q15. A widely-used library needs to remove a long-standing API. Walk through the change communication.**
*Testing: breaking-change lifecycle.*

**A.** Treat it as a lifecycle, not an event. (1) **Deprecate early** — a `Deprecated` changelog entry plus a runtime warning, one or more minor versions ahead, stating the removal version. (2) **Publish the migration guide at announce-time** (not removal-time) so integrators have runway, ideally with a codemod (`npx @lib/upgrade`). (3) **Track deprecated-API telemetry** to confirm low usage before pulling it. (4) At removal, **major bump**, `Removed`/`Changed` entries linking the migration guide. (5) Release note leads with "most apps upgrade by running one command." The break becomes a non-event because the *program* managed it.

**Q16. A high-severity CVE affects three supported branches. How do you coordinate the disclosure?**
*Testing: embargo and coordinated disclosure.*

**A.** Align Security, RelEng, and Legal on a disclosure time. Prepare patched artifacts for **all three branches** and the advisory (CVSS + full fixed inventory, e.g. `4.2.1 / 3.9.7 / 2.14.3`) under embargo. At T-0, publish **simultaneously**: artifacts, GHSA/CVE advisory, changelog `Security` entries, and customer notifications. Never let the changelog entry leak before the patch (that's a zero-day). The OSV/advisory record then flows to downstream scanners automatically. Coordinate with reporters/CERTs per the agreed timeline.

**Q17. Leadership wants a metric: "100% of releases have release notes." What do you tell them?**
*Testing: Goodhart awareness.*

**A.** Coverage metrics are trivially gamed — autogenerated boilerplate passes "has notes" while telling users nothing, and you'll still get "I didn't know it changed" tickets. Measure **outcomes**, not artifact existence: support tickets citing surprise changes, downstream upgrade time, deprecated-API usage before removal. Audit a random sample of notes qualitatively against the standard. And watch the dangerous dodge — reclassifying security fixes as `fix:` to avoid the disclosure clock. Use coverage as a floor, not the target.

---

## Rapid-Fire

**Q18.** Six Keep a Changelog groups? — **A.** Added, Changed, Deprecated, Removed, Fixed, Security.

**Q19.** Two ways to signal a breaking change in a conventional commit? — **A.** `!` after type/scope (`feat!:`) or a `BREAKING CHANGE:` footer.

**Q20.** What bump does `feat:` cause? — **A.** MINOR.

**Q21.** Why not put security fixes in `Fixed`? — **A.** Defenders scan `Security`; burying delays patching.

**Q22.** Where do entries live before a release is cut? — **A.** The `## [Unreleased]` section (or per-PR intent files).

**Q23.** Best tool for a monorepo? — **A.** Changesets (per-package changelogs + propagation).

**Q24.** Can you edit a shipped changelog entry to fix a typo? — **A.** No — append a correction; shipped history is append-only (audit trail).

**Q25.** Who is the migration guide for? — **A.** Operators/integrators upgrading across a breaking change.

**Q26.** When should a SaaS announce a flagged feature in its public changelog? — **A.** At GA (100% rollout), not at merge.

**Q27.** What does a compare/diff link at the bottom of a changelog give you? — **A.** Clickable version headers linking the full diff between releases.

---

## Red Flags / Green Flags

**Red flags**
- Treats "changelog" as one thing; can't name the three artifacts/audiences.
- Thinks the git log *is* the changelog.
- "Just auto-generate everything from commits" with no curation step.
- Puts security fixes in `Fixed`; no CVE/advisory/fixed-inventory awareness.
- Would publish a security changelog entry before the patch ships.
- Stuffs migration steps into changelog bullets; no separate guide.
- Would rewrite/force-push old changelog history to "clean it up."
- Forces SaaS into per-tag changelogs; no GA-timing awareness.

**Green flags**
- Distinguishes audiences and picks the artifact per audience.
- Maps commit type → SemVer bump → changelog section fluently.
- Frames the changelog as an API contract and an audit/compliance record.
- Resolves automation-vs-curation as a layered pipeline with a promotion step.
- Treats breaking changes as a lifecycle/program (deprecate → migrate → remove, with codemods + telemetry).
- Knows security entries are security controls (timing, advisory, inventory, scanners).
- Proposes outcome metrics and warns about Goodhart gaming.

---

## Cheat Sheet

```
3 ARTIFACTS:  CHANGELOG(devs, complete) · Release Notes(users, highlights)
              · Migration Guide(upgraders, steps)
FORMAT:       Keep a Changelog · newest-first · [Unreleased] · [x.y.z] - ISO date
              groups: Added Changed Deprecated Removed Fixed Security
COMMITS:      type(scope)!: desc + BREAKING CHANGE:
              fix→PATCH/Fixed · feat→MINOR/Added · !|BREAKING→MAJOR/Changed
TOOLS:        git-cliff(gen) · semantic-release(auto) · release-please(reviewable)
              · changesets(monorepo)
TENSION:      automate the RECORD, curate the STORY (promote via Release-Note:)
CONTRACT:     undocumented break = broken contract even with correct major bump
SECURITY:     own group · CVE/GHSA · CVSS · fixed inventory · publish ⇄ patch
SaaS:         dated stream, announce at GA · monorepo: per-package + propagation
COMPLIANCE:   audit evidence · APPEND-ONLY · corrections = new entry
METRICS:      measure outcomes not coverage · watch security-reclassification dodge
```

---

## Summary

- Know the **three artifacts and their audiences** cold — conflating them is the most common failure interviewers probe.
- Be fluent in the **Keep a Changelog format** and the **Conventional Commits → SemVer bump → changelog section** mapping.
- Compare the **tools** by input and automation level, and resolve **automation vs curation** as a layered pipeline with a promotion step.
- Frame the changelog as an **API contract** and a **compliance/audit artifact** (append-only), and treat **security entries as security controls** (advisory, inventory, timing).
- Reason about **SaaS vs library**, **monorepo propagation**, **breaking-change lifecycle/migration programs**, and **outcome metrics with Goodhart awareness**.

---

## Further Reading

- Keep a Changelog (keepachangelog.com) and Conventional Commits (conventionalcommits.org).
- semantic-release, release-please, Changesets, git-cliff — official docs.
- GitHub Security Advisories / OSV — advisory metadata for scanners.
- The code-craft `documentation` material and the `api-versioning` skill.

---

## Related Topics

- [Versioning & SemVer](../01-versioning-and-semver/) — the contract the changelog narrates.
- [Release Automation](../08-release-automation/) — the pipeline behind generated changelogs.
- [Supply-Chain Security](../09-supply-chain-security/) — advisories, SBOMs, disclosure.
- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/) — GA-timed announcements.
- [Quality Gates](../../quality-gates/) — release-notes review as a required gate.
