# Dependency & License Scanning — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Dependency & License Scanning

*What interviewers probe: do you understand that most of your risk is code you didn't write, and can you separate "a CVE is present" from "we are actually exploitable"?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Reachability & Prioritization](#reachability--prioritization)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **a question bank covering SCA vs SAST, transitive vulns, lockfiles, reachability, EPSS/KEV prioritization, license risk (AGPL trap), and the "are we affected and where" capability.**

Dependency scanning questions separate candidates who *ran a tool once* from those who *operated a program*. The tell is whether you can distinguish **present / reachable / exploitable**, whether you reach for **EPSS/KEV** when asked to prioritize, and whether you understand the **AGPL/SaaS** legal trap. Each question below gives the model answer plus *what's really being tested*.

---

## Prerequisites

- Junior–senior tiers of this topic.
- Semantic versioning, lockfiles, CVSS basics.
- Comfort discussing CI gating and incident response at a high level.

---

## Fundamentals

**Q1. What is the difference between SAST and SCA?**
*What's being tested: do you know what each scans, and why both are needed.*
**A:** SAST (Static Application Security Testing) scans **your own source code** for vulnerabilities you wrote — injection, hard-coded secrets, unsafe APIs. SCA (Software Composition Analysis) scans **the code you didn't write** — your third-party dependencies, including transitive ones — matching their versions against vulnerability databases and checking their licenses. They're complementary: in a modern app most code (and thus most attack surface) is third-party, so SAST alone leaves the majority of your risk unscanned. You need both.

**Q2. Why do most vulnerabilities live in transitive dependencies?**
*What's being tested: do you understand the dependency tree, not just direct installs.*
**A:** You explicitly choose a handful of direct dependencies, but each drags in its own dependencies recursively, so the *transitive* set is often 10–50x larger than the direct set. More packages = more surface, and you didn't vet (often don't even know about) the transitive ones. Log4Shell is the canonical proof: thousands of apps were vulnerable through Log4j arriving transitively, never directly installed.

**Q3. What is a lockfile and why must you scan it rather than the manifest?**
*What's being tested: understanding of version resolution.*
**A:** A manifest (`package.json`, `go.mod`) usually declares *ranges* (`^4.17.0`), which can resolve to many versions. A lockfile (`package-lock.json`, `go.sum`, `Cargo.lock`, `poetry.lock`) records the **exact** version of every package in the resolved tree. A scanner can only tell you precisely whether you're vulnerable if it knows your exact versions — so you scan the lockfile. Always commit it; it also guarantees teammates, CI, and production install the identical tree.

**Q4. Name the major vulnerability data sources and how they relate.**
*What's being tested: knowing scanners are only as good as their feeds.*
**A:** **CVE** is the global ID scheme. **NVD** enriches CVEs with CVSS scores (authoritative but often laggy). **GHSA** (GitHub) is frequently faster and ecosystem-aware. **OSV** (osv.dev) aggregates GHSA, ecosystem advisories (RustSec, PyPA, Go), etc. into one machine-readable, version-precise feed. Tools wrap different feeds (osv-scanner→OSV, npm audit→npm advisories, govulncheck→Go DB), which is why two scanners can disagree on the same repo.

---

## Technique

**Q5. A high-severity CVE is in a transitive dependency, but its parent hasn't released a fix. What do you do?**
*What's being tested: practical remediation, not just "upgrade".*
**A:** Options in order: (1) **upgrade the direct parent** if a newer version pulls in the fixed transitive — cleanest. (2) **Override/pin the transitive version directly** — npm `overrides`, pnpm overrides, Go `require`/`replace` to force the fixed version — then **re-run the full test suite**, since you've forced an untested combination. (3) If no fix exists, **file a time-boxed exception** documenting why (e.g. not reachable), add a mitigation (WAF rule), and track it. The key signal: you re-test after overriding, and you don't just block forever on un-fixable transitive noise.

**Q6. How would you gate dependency vulnerabilities in CI without the gate getting disabled?**
*What's being tested: pragmatism — strict gates that survive contact with developers.*
**A:** Gate on the **diff, not the world**: block a PR only if it *introduces* a new critical/KEV vuln or a forbidden license (e.g. GitHub's `dependency-review-action`, osv-scanner `--diff-base`). Pre-existing findings go to a backlog with an SLA via *scheduled* full-tree scans — they don't block unrelated feature work. Hard-fail on forbidden licenses and new criticals; warn on the rest. Make the gate fast and deterministic, and put the fix (patched version, override snippet) in the failure message. A binary "fail on any vuln" gate blocks un-fixable transitive noise and gets disabled within a month.

**Q7. How do auto-update bots (Dependabot/Renovate) relate to test coverage?**
*What's being tested: the test-coverage dependency.*
**A:** These bots open PRs bumping dependencies; the only way to handle the volume at scale is to **auto-merge** safe patch/minor bumps that pass CI. That's only sound if your test suite would catch a regression — so **update automation is only as trustworthy as your test coverage**. Strong tests let the bot do the boring work and keep you current (which is itself a security control); weak tests force manual review of everything and you fall behind, turning the next emergency patch into a multi-major breaking jump.

---

**Q7b. How do you fix a vulnerable transitive dependency in three different ecosystems?**
*What's being tested: hands-on breadth, not just npm.*
**A:** The pattern is the same — force the sub-dependency to a fixed version — but the mechanism differs:
```jsonc
// npm (package.json, npm 8.3+)        // pnpm (package.json)
"overrides": { "qs": "6.5.3" }         "pnpm": { "overrides": { "qs": "6.5.3" } }
```
```
// Go (go.mod) — pull the fixed version up so the resolver picks it
require golang.org/x/text v0.3.8
// or, if upstream is the problem:
replace golang.org/x/text => golang.org/x/text v0.3.8
```
Python/Poetry: constrain the transitive in `pyproject.toml` and `poetry lock`. In every case: re-run the full test suite afterward, because you've forced a combination the parent wasn't tested against.

**Q7c. What's the difference between `trivy fs` and `govulncheck`, and when do you use each?**
*What's being tested: knowing tools by capability, not name-dropping.*
**A:** `trivy fs .` (and Grype) do **version-diff** scanning across many ecosystems — broad coverage, including container images and OS packages, but they report *presence*, not reachability, so more noise. `govulncheck` is Go-only and **reachability-aware** (symbol-level call graph), so far less noise but narrower scope. Use `trivy`/Grype for breadth and container/image scanning; use `govulncheck` for Go services where you want to fix only what you actually call. Mature programs run both: broad presence scanning feeds the backlog, reachability reranks the queue.

## Reachability & Prioritization

**Q8. Explain the difference between a vulnerability being "present" and "exploitable."**
*What's being tested: THE core concept of modern SCA.*
**A:** "Present" means the vulnerable code is physically in your dependency tree. "Exploitable" means you actually *call* the vulnerable function (reachability) **and** an attacker can reach it with controlled input in your deployment. A CVE in `parseXml()` of a library you only use for `formatDate()` is present but, if you never call `parseXml`, not exploitable — your real exposure is zero. Naive scanners report presence and produce alert fatigue; reachability-aware tools report what you can actually be hit by.

**Q9. How does `govulncheck` reduce false positives, and what are its limits?**
*What's being tested: concrete reachability knowledge.*
**A:** `govulncheck` builds a **call graph** of your code and checks whether any *vulnerable symbol* (specific function) is reachable. It distinguishes "this vuln is in your module graph but you don't call the vulnerable function — no action needed" from "you call it — here's the trace (`handleUpload → html.Parse`)." That turns "37 modules have advisories" into "3 you actually call." Limits: reachability analysis struggles with reflection, dynamic dispatch, `eval`, plugin loading, and config-driven paths (Log4Shell's trigger was exactly such a path). So reachability is a strong *prioritization* signal, not an absolute safety guarantee.

**Q10. CVSS vs EPSS vs KEV — when do you use each to prioritize?**
*What's being tested: do you prioritize by real risk, not raw severity.*
**A:** **CVSS** is the abstract severity of the vuln (0–10), independent of your context — a bad sort key alone. **EPSS** is the *probability* a CVE will be exploited in the next 30 days, from real-world telemetry — it lets you defensibly deprioritize a scary CVSS 9 nobody is exploiting. **KEV** (CISA) lists CVEs *confirmed exploited in the wild* — proof, not prediction; it should **override CVSS** (any KEV finding = critical). Prioritize on severity × reachability × EPSS/KEV × exposure (internet-facing? attacker-controlled input?). A CVSS 7.5 that's reachable, KEV-listed, and internet-facing outranks a CVSS 9.8 that's unreachable.

**Q11. How do you decide what to fix first when a scan returns 200 findings?**
*What's being tested: prioritization at scale.*
**A:** Don't sort by CVSS. Enrich each finding with reachability (govulncheck/Snyk), EPSS (probability), KEV (proven exploitation), and business context (internet-facing? handles PII/PCI? blast radius?), then rank into one queue. Fix KEV + reachable + internet-facing first; batch unreachable/low-EPSS items into routine update PRs. SCA is a *prioritization* problem, not a detection problem — tools already find everything.

---

## Scenarios

**Q12. A critical CVE just dropped in a popular logging library. Walk me through your response.** (The Log4Shell scenario.)
*What's being tested: incident response and whether you've built the capability beforehand.*
**A:**
1. **Am I affected, and where?** Query the central SBOM inventory: which deployed services contain the component, at which versions, who owns them, what's their exposure. If this takes minutes, you built the capability in peacetime; if it takes days, that's the post-incident action item.
2. **Triage:** check KEV (Log4Shell entered immediately) and EPSS (~0.94). Maximum-severity + actively exploited + easily weaponized → patch everything regardless of reachability nuance.
3. **Remediate** against an SLA/KEV deadline: bump to the fixed version; for services that can't patch instantly, apply mitigations (config flags, WAF rules).
4. **Track** % patched within SLA on a live dashboard; communicate to stakeholders/customers (a VEX statement where applicable).
5. **Retro:** if step 1 was slow, build the signed-SBOM inventory so the next one is minutes.

**Q13. Your lawyer says an acquisition is blocked over a license issue. What likely happened, and how is it prevented?**
*What's being tested: license risk, especially copyleft.*
**A:** Likely a **GPL or AGPL** (or SSPL) dependency in a closed-source/commercial product. GPL's copyleft can require releasing your source if you distribute; **AGPL's network clause** triggers even for SaaS — interacting with users over a network can obligate you to publish your entire service's source. Prevention: a license policy enforced in CI (allow MIT/Apache/BSD/ISC; **deny GPL/AGPL/SSPL/unknown**), deep license *detection* (FOSSA/ScanCode catches "declared MIT, bundled GPL"), alerts on relicensing between versions, automated NOTICE/attribution generation, and a governed SBOM — owned jointly with legal/OSPO. A clean SBOM is a valuation asset; a tainted core is a deal risk.

**Q14. A team wants to use an AGPL library in your SaaS backend. What's your answer?**
*What's being tested: the AGPL/SaaS trap specifically.*
**A:** Default **no**. AGPL Section 13 says if users interact with the software over a network, you must offer them the complete corresponding source — so an AGPL package in a backend can obligate open-sourcing the whole service, even though you never "distribute" a binary (which is GPL's trigger). The only path is a legal-approved, documented, time-boxed exception. Suggest a permissively-licensed alternative or self-hosting it as a separate, properly-isolated service if legal blesses it.

**Q15. How do you keep hundreds of services current without burning out teams?**
*What's being tested: the treadmill at scale.*
**A:** Centrally-managed Renovate/Dependabot preset; **auto-merge** passing patch/minor bumps fleet-wide; group and schedule (batch dev/minor, isolate majors for humans); cap concurrent PRs. Track **median dependency age** as a leading indicator — currency is a security control, since a fleet two weeks behind absorbs the next emergency in hours while one a year behind faces breaking-change archaeology mid-incident. Make routine updates a standing small budget (rotating dependency duty), not a heroic quarterly purge. All of it rests on trustworthy tests.

---

**Q15b. What metrics prove an SCA program is actually working?**
*What's being tested: outcomes vs activity, and Goodhart awareness.*
**A:** Outcome metrics, not scan counts: **MTTR for criticals** (disclosure→fix deployed), **% of criticals patched within SLA**, **open critical/KEV count over time**, **% of dependencies current** and **median dependency age** (leading indicators of future patch-ability), **open vs expired exceptions** (risk-acceptance hygiene), and **mean time to "affected-and-where."** Guard against Goodhart's law: if "zero open criticals" is the only target, teams reclassify or suppress to hit it — so pair exposure metrics with MTTR and exception hygiene, where gaming one surfaces in another. "10,000 scans run" is vanity; "95% patched within SLA and any component locatable in 2 minutes" is the program working.

**Q15c. What is VEX and why does it matter at scale?**
*What's being tested: awareness of modern supply-chain tooling.*
**A:** VEX (Vulnerability Exploitability eXchange) is a machine-readable statement that a given product *is* or *is not* affected by a CVE — and why (e.g. "we ship the component but the vulnerable code is unreachable"). It lets you suppress false-positive noise with an auditable justification instead of a spreadsheet, and lets you communicate status to customers without one-off emails. Combined with signed SBOMs, it turns "are you affected by X?" into a queryable, verifiable claim rather than a fire drill.

## Rapid-Fire

**Q16. What does a lockfile pin?** Exact resolved version of every package (direct + transitive).
**Q17. One reason osv-scanner and npm audit disagree?** Different underlying feeds / ingestion timing.
**Q18. KEV vs EPSS in one line?** KEV = proven exploited (fact); EPSS = probability of exploitation (prediction).
**Q19. Which license is the SaaS trap?** AGPL — network-use clause can force source disclosure.
**Q20. "Present but not reachable" — fix urgency?** Low; deprioritize, batch with routine updates.
**Q21. Three safe-default permissive licenses?** MIT, Apache-2.0, BSD.
**Q22. Why scan the lockfile not the manifest?** Manifest has ambiguous ranges; lockfile has exact versions.
**Q23. What does govulncheck add over version-diff scanners?** Symbol-level call-graph reachability.
**Q24. Fastest way to fix a transitive vuln with no parent fix?** Override/pin the transitive version, re-test.
**Q25. The capability that defines a mature program?** "Are we affected, and where, in minutes" via an SBOM inventory.
**Q26. A no-license package — use it?** No; no license = no permission. Treat as forbidden.
**Q27. What makes auto-merge safe?** A trustworthy test suite (the test-coverage dependency).

---

## Red Flags / Green Flags

**Red flags (in a candidate):**
- Thinks SCA and SAST are the same, or that SAST covers dependencies.
- Sorts remediation purely by CVSS; never mentions reachability, EPSS, or KEV.
- "Just `npm audit fix --force`" with no awareness of breaking changes or transitive nuance.
- Doesn't know what a lockfile is or scans the manifest.
- Unaware that AGPL is dangerous for SaaS; thinks "open source = free to use however."
- "Fail CI on every vuln" with no concept of why that gate gets disabled.
- Can't describe how they'd find which services are affected by a new CVE.

**Green flags:**
- Crisply separates **present / reachable / exploitable**.
- Reaches for **EPSS + KEV + reachability + exposure** to prioritize, not raw CVSS.
- Distinguishes direct vs transitive and knows most risk is transitive.
- Treats license scanning as legal risk; names the AGPL/SaaS trap unprompted.
- Designs gates on the **diff**, backlogs the rest with SLAs and an exception process.
- Talks about the **"affected-and-where" capability** and SBOM inventory before being asked.
- Connects auto-update automation to test coverage and "currency as a security control."

---

## Cheat Sheet

```
SCA vs SAST:   SCA = code you didn't write (deps);  SAST = your code.
Tree:          direct (you chose) ⊂ transitive (everything under) — risk is mostly transitive.
Substrate:     scan the LOCKFILE (exact), not the manifest (ranges).
Feeds:         CVE → NVD/GHSA/ecosystem → OSV;  tools wrap different feeds (they disagree).
Triage:        present ⊃ reachable ⊃ exploitable.   Fix from the inside out.
Prioritize:    KEV overrides CVSS;  EPSS reranks;  × reachability × exposure.
Reachability:  govulncheck = symbol-level call graph; weak under reflection/dynamic.
License:       MIT/Apache/BSD allow · GPL/AGPL/SSPL deny · unknown deny.
AGPL trap:     network-use clause → SaaS may owe full source. Deny by default.
Treadmill:     auto-merge safe bumps (needs tests); currency = security control.
Capability:    "affected, and where, in minutes" via signed SBOM inventory.
```

---

## Summary

- The interview core: **SCA scans the code you didn't write**, most risk is **transitive**, and you must separate **present / reachable / exploitable**.
- Scan the **lockfile**; know the **CVE→NVD/GHSA→OSV** feed lineage and why scanners disagree.
- **Prioritize by real risk** — KEV (proven) overrides CVSS, EPSS (probability) reranks, weighted by reachability and exposure — not raw CVSS.
- Fix **transitive** vulns by upgrading the parent or **overriding** (then re-test); **gate the diff, backlog the rest**, with an exception process.
- **License = legal risk**; name the **AGPL/SaaS trap**; deny copyleft/unknown by default.
- The mature deliverable is the **"affected, and where, in minutes" capability** on an SBOM inventory — and **auto-update automation gated by test coverage**, because **currency is a security control**.

---

## Further Reading

- OSV.dev; GitHub Advisory Database; NVD CVSS spec
- FIRST.org EPSS; CISA KEV catalog and BOD 22-01
- `govulncheck` docs and the Go vulnerability-management blog
- choosealicense.com (esp. AGPL); SPDX identifiers
- GitHub `dependency-review-action`; Renovate/Dependabot configuration

---

## Related Topics

- [SAST Security Scanners](../04-sast-security-scanners/) — the first-party counterpart
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating and policy-as-code
- [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOMs and the "where" capability
- [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/) — trusting and locating what you ship
- Junior → Professional tiers above for the full depth ladder
