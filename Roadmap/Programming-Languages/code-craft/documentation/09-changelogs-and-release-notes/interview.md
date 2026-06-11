# Changelogs & Release Notes — Interview Questions

> **Category:** [Documentation](../README.md) — communicating *what changed* between versions to the humans who must decide whether and how to upgrade.

Conceptual and applied questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Applied Tasks](#applied-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What's the difference between a changelog, release notes, and a git log?

**Answer:** A **git log** is the raw, complete commit history — for machines/maintainers. A **changelog** is a *curated* list of *notable* changes per version, for developers/technical users deciding whether and how to upgrade. **Release notes** are the audience-facing narrative for a *specific* release, often friendlier/marketing-flavored for end users. Same underlying changes, different audiences and curation levels.

### J2. What is "Keep a Changelog" and what are its categories?

**Answer:** A canonical changelog format (keepachangelog.com, Olivier Lacan) whose guiding rule is "changelogs are for humans, not machines." Format: newest version first, an `[Unreleased]` section at the top, ISO dates, linked versions, and six categories — **Added, Changed, Deprecated, Removed, Fixed, Security.**

### J3. Explain semantic versioning.

**Answer:** `MAJOR.MINOR.PATCH`. Bump **MAJOR** for an incompatible/breaking change, **MINOR** for a backward-compatible new feature, **PATCH** for a backward-compatible bug fix. Pre-releases use a hyphen (`2.0.0-rc.1`), build metadata uses a plus (`2.0.0+build.7`). `0.x.y` makes *no* compatibility promises — anything can change.

### J4. How does the changelog category relate to the semver bump?

**Answer:** They tell one story. **Removed** or a breaking **Changed** → MAJOR. **Added** → MINOR (also **Deprecated**, since nothing broke yet). **Fixed**/**Security** (backward-compatible) → PATCH. Deciding a change is "Removed" *is* deciding the next release is a MAJOR.

### J5. Why ISO dates (`2026-06-11`)?

**Answer:** They're unambiguous worldwide and sort lexicographically. `06/11/2026` could mean June 11 or November 6 depending on locale.

### J6. What is the `[Unreleased]` section for?

**Answer:** It collects changes that are merged but not yet shipped in a tagged version. You add an entry when you make the change, then rename the section to the version and date at release — so the changelog stays accurate instead of being reconstructed from memory.

### J7. Why is "various bug fixes" a bad entry?

**Answer:** It tells the reader nothing about *what* changed or *whether it affects them* — which is the entire purpose of an entry. A good entry says what changed, who's affected, and (if breaking) what to do.

### J8. What does `0.x` signify?

**Answer:** Initial development; the API is unstable and *anything may change at any time*. The semver compatibility promises only begin at `1.0.0`. So a `0.5 → 0.6` upgrade can break you, by spec.

---

## Middle Questions

### M1. What are Conventional Commits and why do they exist?

**Answer:** A commit-message convention — `type(scope)!: description` plus optional body/footers (`feat`, `fix`, `BREAKING CHANGE:`, etc.). They give commit messages a structure a *machine* can parse while staying human-readable, which enables tools to derive the version bump, generate the changelog, and tag releases automatically.

### M2. How does a commit type map to a semver bump?

**Answer:** `feat` → MINOR, `fix`/`perf` → PATCH, and any commit with `!` in the header or a `BREAKING CHANGE:` footer → MAJOR. `docs`/`chore`/`refactor`/`test`/`ci` usually produce no release. The release bump is the **highest-priority** bump across all commits since the last tag.

### M3. Describe the conventional-commits → release pipeline.

**Answer:** Developers write conventional commits → on merge, a CI tool reads commits since the last tag → derives the version bump from the types → generates/appends `CHANGELOG.md` entries grouped by type → bumps the version, commits, and creates a git tag + GitHub Release → optionally publishes the package. The version and changelog become *derived artifacts*.

### M4. Name some tools and what distinguishes them.

**Answer:** **semantic-release** (fully automated, ships on every merge, no human gate), **release-please** (maintains a standing release PR you merge when ready — keeps a human decision point), **changesets** (intent-files per PR; ideal for JS monorepos with independently-versioned packages), **git-cliff** (configurable changelog generator), **commitlint/commitizen** (enforce/author conventional commits).

### M5. Two ways to signal a breaking change in a conventional commit?

**Answer:** A `!` in the header (`feat!:` or `feat(scope)!:`) **or** a `BREAKING CHANGE:` footer. Either is sufficient; the footer also doubles as the migration prompt.

### M6. What's the trade-off between automated and hand-curated changelogs?

**Answer:** Automation gives consistency (version always matches commits) and near-zero effort, but entries are only as good as the commit messages — often terse and mechanical. Hand-curation gives a readable narrative but at real ongoing cost and variable discipline. The common hybrid: let the tool do the bookkeeping (bump, draft changelog, tag) and have a human edit user-facing notes before publishing.

### M7. Why is deprecation a MINOR bump but removal a MAJOR bump?

**Answer:** Deprecation doesn't break anything — the feature still works, just with a warning, so it's backward-compatible (MINOR). Removal actually breaks consumers still using the feature — incompatible (MAJOR). The professional pattern is deprecate first (with a stated removal version and a runtime warning), remove later.

### M8. What's the most valuable artifact in a MAJOR release?

**Answer:** The **migration guide**, not the list of what broke. Per breaking change it should give what changed, *why*, exact before/after code, and ideally a codemod/script for mechanical updates. The changelog links to it; it does the heavy lifting.

---

## Senior Questions

### S1. In what sense is a version number a contract?

**Answer:** Downstream dependency resolvers act on it *without a human*. A consumer pinning `^2.1.0` means ">=2.1.0 <3.0.0" — their CI auto-installs any MINOR/PATCH overnight, *trusting* semver's promise of no breaking change. Range operators only make sense because the version is a machine-readable compatibility promise. Ship a break as a MINOR and you break every auto-upgrading consumer silently, at ecosystem scale.

### S2. What actually counts as "breaking" — and why is it subtle?

**Answer:** It's defined against the *observable* contract, not just signatures. Tightening validation, changing a default, altering an error type/message, changing timing/ordering, or even fixing a bug consumers relied on can all be breaking with no signature change. **Hyrum's Law:** with enough consumers, every observable behavior gets depended on by someone. Senior judgment: define your public contract explicitly (mark internals), and when in doubt, treat it as breaking — under-calling a break is far costlier than an extra MAJOR.

### S3. How do you handle changelogs in a monorepo?

**Answer:** Packages are versioned independently, a commit may touch several packages, and breaking changes cascade across internal dependencies. Pure commit-message inference mis-attributes changes and misses cascades. Use **explicit intent per PR** (changesets): the author declares affected packages and bump levels; the tool aggregates them, propagates dependency bumps, and writes a *per-package* changelog. Enforce "every PR has a changeset (or marks itself no-release)" in CI.

### S4. How should security fixes differ from normal changelog entries?

**Answer:** Coordinated disclosure (fix before/at disclosure), **CVE/GHSA linkage** so scanners (Dependabot/Snyk/OSV) match it to consumers' lockfiles and auto-alert, and **out-of-band, backported** releases to every supported version line. Wiring into the machine-readable advisory ecosystem matters more than the prose, because you can't assume anyone read your Security section.

### S5. SemVer vs CalVer — when each?

**Answer:** They answer different questions. SemVer (`MAJOR.MINOR.PATCH`) answers "is this safe to upgrade?" — right for libraries/APIs whose consumers need compatibility promises. CalVer (`2026.06`) answers "how old is this?" — right for end-user products where recency matters more than API stability (Ubuntu, pip). Choosing CalVer for a library throws away the compatibility signal consumers need.

### S6. How does release cadence interact with the changelog?

**Answer:** Continuous/on-merge releases *force* automation (no human can write per-release notes) so the changelog is mechanical. Release trains (scheduled) batch changes, opening a window for a curation pass and a coherent narrative. Milestone releases (occasional, large) justify hand-written notes plus a full migration guide because the effort amortizes over a big audience. Cadence determines whether hand-curation is even feasible.

### S7. Why design release notes "for the angry reader"?

**Answer:** Most consumers ignore release notes until an upgrade breaks them — then the notes are all that stands between them and a support ticket. So optimize for the *failure* moment: make breaking changes and migration steps the most prominent and findable thing, emit runtime deprecation warnings (reaching people who never read docs), and make removed features fail with errors that name the migration guide. Don't rely on anyone reading to stay safe.

---

## Professional Questions

### P1. How do you guarantee the changelog stays accurate across many contributors?

**Answer:** Make it definition-of-done: a change isn't done until its impact is declared *in the same PR* (a conventional commit or a changeset), gated in CI so a release can't ship without it. The author declares the impact at the moment they know the most — not a release engineer reconstructing intent weeks later. Then fully script the release so the version is computed, not typed.

### P2. How do you review a PR for release impact?

**Answer:** Check the **bump first** — is it correct? Judge "breaking" against the *observable* contract (a changed default/error/validation is breaking even with the same signature). Reject empty entries ("various bug fixes"). Verify the category, that breaking changes link a migration guide, that removals had a deprecation window, that security fixes link a CVE, and that user-facing notes are reframed for non-engineers.

### P3. How do you retrofit this discipline onto a messy legacy repo?

**Answer:** Announce semver explicitly (consumers can't trust an unstated promise) → add the commit/changeset CI gate for *new* changes → draw a line in `CHANGELOG.md` rather than backfilling history → run the release tool in `--dry-run` first to verify its bumps match human judgment → define the public API surface (mark internals). Don't re-tag published versions, don't boil the ocean reconstructing old entries, and don't adopt semver then immediately violate it.

### P4. Conventional Commits are enforced but the changelog is still bad. Why?

**Answer:** Conventional Commits disciplines *structure*, not *content*. `fix: stuff` and `fix: wip` parse perfectly and read terribly — and with full automation they ship to customers verbatim. Automation amplifies whatever discipline you have. The fix is a commit-content review step plus a human editing pass on the generated user-facing notes.

### P5. A teammate wants to ship a behavior change as a patch to keep CI green / avoid a MAJOR. How do you respond?

**Answer:** Frame the version as a *contract* downstream automation acts on: consumers pinning `^x` will auto-install this overnight, trusting it's non-breaking, and break in production simultaneously. A correct MAJOR is cheap; a broken ecosystem contract is an outage and a trust loss. If the concern is user fragmentation, that's a real cost — handle it with a deprecation window and migration guide, not by mislabeling the version.

### P6. How do you handle a marketing demand for a specific version number?

**Answer:** Separate the *technical* version (which consumers depend on and which must obey semver) from the *marketing* name. Many products do this — "the 2026 release" that is technically `4.3.0`. Never corrupt the semver number for marketing; it breaks the contract consumers' tooling relies on.

---

## Applied Tasks

### C1. Turn these commits into the next version and changelog.

Last release `1.4.0`. Commits since:

```
fix(api): return 404 instead of 500 for unknown IDs
feat(cli): add --json output
docs: fix typo
```

**Answer:** Highest bump is `feat` (no breaking) → **MINOR** → `1.5.0`.

```markdown
## [1.5.0] - 2026-06-11

### Added
- **cli:** `--json` output format (#…).

### Fixed
- **api:** return 404 instead of 500 for unknown IDs (#…).
```

The `docs:` commit is omitted — not notable to a consumer. *(State the catch: returning 404 where it used to 500 could be a breaking change if consumers branch on the status code — if so, it's `fix!` and MAJOR.)*

### C2. Write a conventional commit for a breaking rename.

**Answer:**

```
feat(client)!: rename `connect()` to `open()`

BREAKING CHANGE: `connect()` is removed. Replace calls with `open()`,
which takes the same arguments. Run `npx acme-codemod rename-open`.
```

The `!` and the footer both flag the break; the footer is the migration prompt.

### C3. Is this a breaking change? `fix: trim whitespace from usernames before lookup`

**Answer:** **Potentially yes.** If a user `"alice "` (with a trailing space) previously matched a distinct record and now collides with `"alice"`, observable behavior changed for someone relying on it (Hyrum's Law). Judge against the observable contract; if any consumer could rely on the old behavior, mark it `fix!` / MAJOR or gate it behind a flag. When in doubt, treat as breaking.

### C4. Rewrite this useless entry.

Given: `### Fixed — bug fixes and improvements`

**Answer:**

```markdown
### Fixed
- Login rejected valid emails containing `+` (#812).
- Export no longer truncates rows past 10,000 (#820).

### Changed
- Default request timeout lowered from 30s to 10s.
  **Note:** long-running calls may now time out; override with `timeout=`.
```

Each entry says what changed and who's affected; the timeout change flags its behavior impact.

### C5. Write a migration-guide entry for a removed sync API.

**Answer:**

```markdown
## `fetch()` removed — use `async fetch()`

**Why:** the blocking client caused thread-pool exhaustion under load.

**Before (v2):**  data = client.fetch(url)
**After (v3):**   data = await client.fetch(url)

All call sites must become `async`. Run `acme-codemod v3-async` to convert them.
```

---

## Trick Questions

### T1. "Just generate the changelog from `git log` — it's the same thing." Right?

**No.** A git log is raw, complete, and noisy (typo fixes, "wip", merge commits), written for the author. A changelog is *curated* notable changes written *for the human deciding whether to upgrade*. You *can* derive a changelog from history — but only if commits are disciplined (Conventional Commits), and even then it's filtered and reframed, not a raw dump.

### T2. "A bug fix is always a PATCH." True?

**False.** If the fix changes observable behavior that consumers relied on, it's breaking (MAJOR), regardless of being "just a fix" — semver's contract is about compatibility, not intent. Conventional Commits expresses this as `fix!:` with a `BREAKING CHANGE:` footer.

### T3. "We bumped MAJOR, so we don't need a deprecation window." Agree?

**No.** A correct MAJOR bump and a deprecation runway are different obligations. The bump satisfies the *contract*; the deprecation window (runtime warning + stated removal version + migration guide, across ≥1 minor) satisfies *consideration for consumers*. Removing something with no prior warning erodes trust even with a perfect version number.

### T4. "Conventional Commits guarantees a good changelog." Correct?

**No.** It guarantees *parseable structure*, not *content quality*. `fix: stuff` is valid and useless. Full automation publishes whatever your commit messages say — so without content discipline and a human editing pass, you ship "feat: wip" to customers.

### T5. "Semver and CalVer are interchangeable; pick whichever you like." True?

**False.** They communicate different things. SemVer signals *compatibility* ("safe to upgrade?"); CalVer signals *recency* ("how old?"). A library needs the compatibility promise (semver); an end-user product may prefer recency (CalVer). Choosing CalVer for a library throws away the signal consumers' dependency resolvers depend on.

### T6. "Release notes and the changelog should be identical." Right?

**No.** They're derived from the same facts but for different readers: the changelog is a precise, technical, per-version record for developers; release notes are an audience-tuned narrative (often for end users) per channel — blog, in-app, email. Same facts, different register and detail. Publishing the raw changelog to a user-facing channel is the anti-pattern.

---

## Behavioral Questions

### B1. Tell me about a time a version/release-notes mistake caused an incident.

**Sample:** "We shipped a case-sensitivity 'fix' as a PATCH. Consumers on `^4.2.0` auto-upgraded overnight and broke en masse — it changed observable behavior they depended on, so it was actually breaking. We yanked the release, re-shipped it as a MAJOR with a migration note, and made it opt-in for one minor first. Since then I judge 'breaking' by what consumers *observe*, not by what we *intended* — Hyrum's Law made that concrete for me."

### B2. How do you push back when someone wants to ship a breaking change as a minor?

**Sample:** "I frame the version as a contract that downstream resolvers act on without a human — pinning `^x` means they auto-install this trusting it's safe, and break in production simultaneously. A correct MAJOR is cheap; a broken contract is an ecosystem outage. If the real worry is user fragmentation, I propose a deprecation window and migration guide instead of mislabeling the version — citing our versioning policy so it's a standard, not my opinion."

### B3. How do you keep a changelog alive across a big team over years?

**Sample:** "Make it definition-of-done and gate it in CI — a PR can't merge without a conventional commit or a changeset declaring impact, and the release is fully scripted so the version is computed, not typed. The author declares impact when they know the most. Then a human edits the user-facing notes before publishing. Changelogs die when they depend on memory; they live when they're a build gate."

### B4. Describe handling a security release.

**Sample:** "We coordinated disclosure — patched first, then released to all supported lines out-of-band with the fix backported. The changelog Security entry linked the CVE and GHSA so Dependabot/OSV could match it to consumers' lockfiles and open upgrade PRs automatically, and we sent an advisory email. The lesson I apply: a security fix that scanners can't discover only protects the people who happen to read your changelog."

### B5. When did you decide *against* automating release notes fully?

**Sample:** "Our library had a developer audience, so we automated the version bump and draft changelog. But we ship a user-facing product on top, and the generated 'feat: wip'-style notes were unreadable for users. We kept automation for the contract bookkeeping and added a required human editing pass on the GitHub Release body and any blog post. Automate the contract; curate the relationship."

---

## Tips for Answering

1. **Lead with the three-way distinction** (git log vs changelog vs release notes) by *audience* — it's the most common confusion and signals clarity.
2. **State semver bumps precisely** (breaking/feature/fix) and tie them to the changelog categories (Removed/Changed-breaking → MAJOR).
3. **Nail the conventional-commits → semver → changelog → release pipeline** end to end, and name the tools.
4. **Frame the version as a contract** that downstream automation trusts — this is the senior signal.
5. **Judge "breaking" by observable behavior** (Hyrum's Law), not signatures — mention defaults, validation, error types.
6. **Say automation enforces structure, not quality** — and propose the hybrid (automate bookkeeping, curate user-facing notes).
7. **Emphasize the migration guide** as the most valuable MAJOR-release artifact, and "deprecate before remove."

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md)
