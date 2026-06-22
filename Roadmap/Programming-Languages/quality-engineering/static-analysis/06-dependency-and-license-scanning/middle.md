# Dependency & License Scanning — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Dependency & License Scanning

*Knowing a CVE is "present" is easy. Knowing whether it's actually reachable — and keeping a thousand deps current without drowning in noise — is the real skill.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Where the vuln data comes from](#core-concept-1--where-the-vuln-data-comes-from)
5. [Core Concept 2 — Transitive vulns and how to fix them](#core-concept-2--transitive-vulns-and-how-to-fix-them)
6. [Core Concept 3 — The reachability problem: present vs exploitable](#core-concept-3--the-reachability-problem-present-vs-exploitable)
7. [Core Concept 4 — govulncheck and symbol-level reachability](#core-concept-4--govulncheck-and-symbol-level-reachability)
8. [Core Concept 5 — License classes and a real policy](#core-concept-5--license-classes-and-a-real-policy)
9. [Core Concept 6 — Auto-update PRs and the update treadmill](#core-concept-6--auto-update-prs-and-the-update-treadmill)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **vuln data sources, fixing transitive vulns, the reachability problem (present ≠ exploitable), license policy, and the auto-update treadmill.**

At the junior level you ran a scan and fixed criticals. That works until you run the scan on a real production app and it returns **140 findings**. Now what? You can't drop everything for two weeks. Half of them are in code paths you never execute. Some "fixes" don't exist yet. And while you're triaging, three new advisories drop.

The middle-tier skill is **separating signal from noise**: understanding where vuln data comes from, fixing transitive issues you didn't directly cause, distinguishing *present* from *exploitable* (reachability), enforcing a sane license policy, and managing the relentless flow of update PRs without letting them rot.

---

## Prerequisites

- Comfortable with junior content: SCA vs SAST, direct vs transitive, lockfiles, license buckets.
- You've run `npm audit` / `pip-audit` / `osv-scanner` on a real repo.
- You understand semantic versioning ranges (`^`, `~`, `>=`).
- You've opened and merged a pull request and understand CI gating.
- Helpful: basic Go (for the `govulncheck` reachability section).

---

## Glossary

| Term | Meaning |
|------|---------|
| **OSV** | Open Source Vulnerabilities — Google-led, machine-readable vuln DB aggregating many sources. |
| **NVD** | National Vulnerability Database — the U.S. government CVE feed, with CVSS scores. |
| **GHSA** | GitHub Security Advisory — GitHub's advisory IDs, often faster than NVD. |
| **CVSS** | Common Vulnerability Scoring System — a 0–10 severity score (not your real risk). |
| **Reachability** | Whether the vulnerable code is actually called from your app. |
| **False positive** | A reported vuln that doesn't apply to you (wrong context, unreachable code). |
| **Override / resolution** | Forcing a transitive dependency to a fixed version. |
| **Allowlist / denylist** | Explicitly permitted / forbidden licenses (or packages). |
| **Dependabot / Renovate** | Bots that open PRs to update dependencies automatically. |
| **Update treadmill** | The never-ending stream of dependency-update work. |

---

## Core Concept 1 — Where the vuln data comes from

A scanner is only as good as the database behind it. The major sources:

- **CVE** — the global naming scheme. A CVE ID (`CVE-2021-44228`) is just an *identifier*; it doesn't tell you much by itself.
- **NVD (National Vulnerability Database)** — enriches CVEs with CVSS scores and version ranges. Authoritative but often **slow** (days to weeks of lag, and a well-known 2024 backlog).
- **GitHub Advisory Database (GHSA)** — frequently faster, ecosystem-aware, curated by GitHub + maintainers.
- **OSV (osv.dev)** — aggregates GHSA, ecosystem advisories (RustSec, PyPA, Go), and others into one **machine-readable, version-precise** feed. This is what `osv-scanner` queries.
- **Ecosystem advisories** — RustSec (Rust), PyPA (Python), the Go vulnerability database, npm advisories.

Different tools wrap different databases:

| Tool | Primary source | Notes |
|------|----------------|-------|
| `osv-scanner` | OSV | Cross-ecosystem, version-precise |
| `npm audit` | npm advisories | Node only; historically noisy |
| `pip-audit` | PyPA + OSV | Python |
| `govulncheck` | Go vuln DB | **Reachability-aware** (see below) |
| Trivy / Grype | OSV + NVD + more | Also scan container images |
| Snyk / Dependabot | Curated proprietary + GHSA | Often earlier disclosures |

Practical consequence: **two scanners will disagree.** One sees an advisory the other hasn't ingested yet, or scores it differently. That's normal — pick a primary, and understand its feed.

---

## Core Concept 2 — Transitive vulns and how to fix them

Most findings are in transitive deps you didn't choose. You can't just `npm install foo@latest` — `foo` isn't your dependency; it's three levels down.

```bash
$ npm audit
qs  <6.2.4
Severity: high
Prototype Pollution
node_modules/express/node_modules/qs   ← qs comes in via express
```

Your options, in order of preference:

**1. Upgrade the direct parent.** If a newer `express` depends on a fixed `qs`, just bump `express`. Clean and correct.

**2. Force the transitive version with an override.** When the parent hasn't released a fix yet, pin the sub-dependency directly.

```json
// package.json (npm 8.3+)
"overrides": {
  "qs": "6.5.3"
}
```

```yaml
# pnpm — pnpm-workspace.yaml or package.json
"pnpm": { "overrides": { "qs": "6.5.3" } }
```

Go does this with `replace` / by requiring a newer version directly:

```
// go.mod
require golang.org/x/text v0.3.8   // pull the fixed version up
```

**3. If no fix exists**, document an exception (see senior tier) and consider whether you can drop the offending feature/package.

> **Always re-run your tests after an override.** You've just forced a version the parent wasn't tested against. Most of the time it's fine; sometimes it breaks. This is the *test-coverage dependency* — your ability to update safely is bounded by how good your tests are.

---

## Core Concept 3 — The reachability problem: present vs exploitable

Here's the single most important middle-tier idea: **a vulnerability being present in your tree is not the same as it being exploitable.**

Suppose a CVE is in a function `parseXml()` of a library you import only for its `formatDate()` helper. The vulnerable code is *physically in your `node_modules`*, but **you never call it.** A naive scanner reports it as a high. Your actual exposure is **zero**.

```
Library "utils"
├─ formatDate()   ← you call this
└─ parseXml()     ← THE VULN is here; you never call it
                    → present? yes.  exploitable? no.
```

This matters because the alternative is **alert fatigue**. A scanner that reports 140 findings, 120 of which are unreachable, trains your team to ignore the report — including the 20 that matter. The skill is not "fix everything"; it's "find what's actually reachable and fix *that* first."

Two numbers people confuse:

- **CVSS** measures how bad the vuln is *in the abstract* (a property of the vuln).
- **Your exposure** depends on reachability, whether the input is attacker-controlled, and your deployment. A CVSS 9.8 in unreachable code is a lower *real* priority than a CVSS 6.0 in a hot, internet-facing path.

Reachability-aware tools — `govulncheck`, Snyk's reachability, Endor — exist precisely to cut this noise. Tools that only diff versions (`npm audit`, basic `osv-scanner`) report *presence*, not reachability.

---

## Core Concept 4 — govulncheck and symbol-level reachability

Go's `govulncheck` is the clearest example of reachability done right. It doesn't just compare versions — it builds a **call graph** and checks whether any *vulnerable symbol* (function) is actually reachable from your code.

```bash
$ govulncheck ./...
Scanning your code and 248 packages across 12 dependent modules for known vulnerabilities...

Vulnerability #1: GO-2023-1840
    Improper handling of special chars in golang.org/x/net/html
  More info: https://pkg.go.dev/vuln/GO-2023-1840
  Module: golang.org/x/net
    Found in: golang.org/x/net@v0.7.0
    Fixed in: golang.org/x/net@v0.8.0
    Example traces found:
      #1: server.go:42:18: yourapp.handleUpload calls html.Parse

Vulnerability #2: GO-2023-1571
    (vulnerable symbol not called)
  This vulnerability is in your module graph but your code does not
  call any vulnerable functions. No action needed unless code changes.
```

Read that carefully. **Vuln #1** comes with an *example trace* — `handleUpload → html.Parse` — proving the vulnerable function is actually reachable. **Fix this.** **Vuln #2** is present in the module graph but **no vulnerable symbol is called** — `govulncheck` explicitly tells you no action is needed.

That distinction is gold. On a typical Go service, `govulncheck` will turn "37 modules have advisories" into "3 you actually call." You fix three things instead of arguing about thirty-seven.

The trade-off: reachability analysis is *language-specific and hard*. It works well in statically-analyzable languages (Go) and gets murkier with reflection, dynamic dispatch, `eval`, plugin loading, and config-driven code paths (the Log4Shell trigger was exactly such a path). Reachability is a powerful *prioritization* signal, not an absolute "safe" guarantee.

---

## Core Concept 5 — License classes and a real policy

Move beyond "permissive vs copyleft" to a concrete, enforceable policy.

| Class | Licenses | Policy |
|-------|----------|--------|
| **Allow** | MIT, Apache-2.0, BSD-2/3, ISC, Unlicense, 0BSD | Auto-approve. |
| **Allow with notice** | MPL-2.0, Apache-2.0 (NOTICE) | OK; must include attribution in NOTICE. |
| **Review** | LGPL-2.1/3.0 | OK only if dynamically linked / not modified — ask. |
| **Deny** | **GPL-2.0/3.0, AGPL-3.0**, SSPL, CC-BY-NC, "Commons Clause" | Block. Strong copyleft / non-commercial. |
| **Deny** | **UNKNOWN / no license** | Block. No license = no permission. |

**The AGPL-in-a-SaaS trap, concretely.** GPL's copyleft triggers on *distribution* — shipping a binary. For a SaaS you never distribute anything; users hit your server. AGPL closes that "loophole": its Section 13 says if users **interact with the software over a network**, you must offer them the **complete corresponding source**. So an AGPL package in your web backend can legally obligate you to open-source your entire service. That's why AGPL is on nearly every company's denylist.

Enforce it in CI. Example with a license-checker allowlist:

```bash
$ npx license-checker --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC" --excludePrivatePackages
error: package "fancy-lib@2.1.0" has license "GPL-3.0" not in allowlist
```

Generate attribution for permissive licenses that require it:

```bash
$ npx license-checker --customPath ./format.json --out NOTICE.txt
# Produces a NOTICE file listing each package, its license, and copyright.
```

`go-licenses` can both check and emit notices:

```bash
$ go-licenses check ./...               # fails on forbidden licenses
$ go-licenses save ./... --save_path=./third_party_licenses
```

Heavier tools — **FOSSA**, **ScanCode** — do deep license *detection* (scanning file headers, not just declared metadata) for when "the package says MIT but bundled a GPL file."

---

## Core Concept 6 — Auto-update PRs and the update treadmill

Vulns get fixed by upgrading. Upgrading 1000 deps by hand is impossible, so you automate it with **Dependabot** or **Renovate**: bots that open PRs bumping dependencies.

**Dependabot** (GitHub-native), `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      dev-dependencies:           # batch dev deps into one PR
        dependency-type: "development"
```

**Renovate** (more configurable), `renovate.json`:

```json
{
  "extends": ["config:recommended"],
  "schedule": ["before 9am on monday"],
  "packageRules": [
    { "matchUpdateTypes": ["minor", "patch"],
      "matchCurrentVersion": "!/^0/",
      "automerge": true },              // auto-merge safe patches if CI passes
    { "matchUpdateTypes": ["major"],
      "addLabels": ["needs-review"] }   // major bumps need a human
  ],
  "vulnerabilityAlerts": { "labels": ["security"], "schedule": ["at any time"] }
}
```

Two truths about the treadmill:

1. **It never ends.** Dependencies release constantly. The work is continuous, not a project. The goal is to keep it *small and steady*, not to ever "finish."
2. **Automation depends on tests.** Auto-merging a patch is only safe if your test suite would catch a regression. **Update automation is only as trustworthy as your test coverage.** Teams with weak tests can't auto-merge and drown; teams with strong tests let the bot do the boring work.

The failure mode is **bit-rot**: you ignore the bot, PRs pile up, the gap between your versions and current grows, and eventually a security patch requires jumping *five majors* with breaking changes — exactly when you're under time pressure. Small, frequent updates beat rare, giant ones.

---

## Real-World Examples

**Log4Shell, the reachability angle.** When CVE-2021-44228 dropped, the first question was *presence* ("do we have Log4j?"). The second, subtler question was *exploitability* — the bug triggered only when attacker-controlled strings reached a vulnerable lookup. Some apps had Log4j but never logged untrusted input into a vulnerable code path. But because the trigger was config/string-driven (hard to analyze statically) and the severity was 10.0, the correct call was **patch everything regardless** — a case where reachability analysis *informs* but doesn't override a maximum-severity, easily-weaponized bug.

**The npm-audit noise problem.** Teams have famously found `npm audit` reporting dozens of "high" vulns in *dev-only* build tooling (webpack loaders, etc.) that never ship to production and aren't attacker-reachable. Reporting these as "high" alongside genuine runtime vulns is the alert-fatigue trap in action — and why `npm audit --omit=dev` and reachability-aware tools exist.

**Renovate done well.** A team configures Renovate to auto-merge passing patch/minor bumps weekly and only flag majors. Their median dependency age stays under two weeks; when a critical CVE drops, the fix is usually already merged or one click away. Their "update treadmill" is a quiet background hum, not a fire drill.

---

## Mental Models

- **"Present, reachable, exploitable" — three concentric circles.** Everything in your tree is *present*. A subset is *reachable*. A smaller subset is *exploitable* in your deployment. Prioritize from the inside out.
- **"CVSS is the weather; reachability is your forecast."** A 9.8 storm offshore (unreachable) matters less to you than a 6.0 storm overhead (reachable, internet-facing).
- **"The update treadmill: walk daily or sprint to the hospital."** Small steady updates, or rare painful ones under duress.
- **"Your tests are your update budget."** Good tests buy you safe automation. Bad tests mean every update is a manual gamble.
- **"A range is a promise you can't scan."** Pin to the lockfile; scan the lockfile.

---

## Common Mistakes

- **Treating every finding as equally urgent.** Without reachability/severity triage, you either burn out or ignore the report. Both lose.
- **Confusing CVSS with your risk.** A high CVSS in unreachable, dev-only code is not a high *priority*.
- **Overriding a transitive version without re-running tests.** You've forced an untested combination.
- **Ignoring the update bot.** PRs pile up, drift grows, and the eventual jump is brutal.
- **Auto-merging without trustworthy CI.** Automation without tests just merges regressions faster.
- **Only checking *declared* licenses.** A package's metadata says MIT but it bundled GPL code — only deep scanners (ScanCode/FOSSA) catch that.
- **Forgetting AGPL's network clause.** "We don't distribute, so copyleft doesn't apply" is false for AGPL.

---

## Test Yourself

1. Why might `osv-scanner` and `npm audit` report different results for the same repo?
2. A high-severity vuln is in a transitive dep whose parent has no fix yet. What are your options?
3. Explain "present vs exploitable" using a concrete example.
4. How does `govulncheck` decide a vuln needs "no action"? What's the catch with reflection/dynamic code?
5. A team uses an AGPL library in their SaaS backend. What's the legal exposure, and why doesn't "we don't distribute" save them?
6. Why is auto-merging dependency updates only as safe as your test suite?
7. What is the "update treadmill," and why are small frequent updates better than rare big ones?

---

## Cheat Sheet

```bash
# Reachability-aware scanning
govulncheck ./...                          # Go: call-graph reachability
trivy fs --scanners vuln .                 # filesystem vuln scan
osv-scanner scan source -r .               # recursive, all lockfiles

# Fixing transitive vulns
npm ls <pkg>                               # find who pulls it in
# package.json "overrides": { "<pkg>": "<fixed>" }   then re-run tests!

# License enforcement
npx license-checker --onlyAllow "MIT;Apache-2.0;BSD-3-Clause;ISC"
go-licenses check ./...

# Auto-updates: .github/dependabot.yml  or  renovate.json
```

| Signal | Priority bump |
|--------|---------------|
| Reachable (govulncheck trace, hot path) | ↑↑ |
| Attacker-controlled input | ↑↑ |
| Internet-facing service | ↑ |
| Dev-only / build-time dep | ↓ |
| Vulnerable symbol not called | ↓↓ |

---

## Summary

- Vuln data flows from **CVE → NVD/GHSA/ecosystem feeds → OSV**; tools wrap different feeds, so they disagree. Know your primary source.
- Most findings are **transitive**; fix by upgrading the parent, or **override** the sub-dependency — then **re-run tests**.
- **Present ≠ exploitable.** Reachability separates the vulns you can actually be hit by from the noise. `govulncheck`'s symbol-level call graph is the model example.
- **CVSS is abstract severity; your risk depends on reachability + input control + deployment.**
- A real **license policy** has allow/review/deny classes. **AGPL's network clause** is the SaaS trap. Enforce in CI; generate NOTICE files.
- **Dependabot/Renovate** automate the **update treadmill**; automation is only as safe as your **test coverage**. Small, steady updates beat rare, painful jumps.

---

## Further Reading

- `govulncheck` documentation and "Govulncheck v1.0" Go blog post
- OSV.dev schema and `osv-scanner` docs
- Renovate and Dependabot configuration references
- NVD CVSS v3.1 specification
- SPDX license identifiers; choosealicense.com on AGPL
- ScanCode toolkit / FOSSA on deep license detection

---

## Related Topics

- [SAST Security Scanners](../04-sast-security-scanners/) — scanning *your* code for vulns
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating PRs on scans
- [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOMs, "where am I affected" at fleet scale
- [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/) — provenance of what you ship
- Senior tier: building an SCA program, EPSS/KEV prioritization, the treadmill at scale
