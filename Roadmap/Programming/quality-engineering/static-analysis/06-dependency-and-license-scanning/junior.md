# Dependency & License Scanning — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Dependency & License Scanning

*The code you ship is mostly code you didn't write. Scanning it for known holes and risky licenses is your first line of defense.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — SCA vs SAST: scanning the code you didn't write](#core-concept-1--sca-vs-sast-scanning-the-code-you-didnt-write)
5. [Core Concept 2 — Direct vs transitive dependencies](#core-concept-2--direct-vs-transitive-dependencies)
6. [Core Concept 3 — Your first vulnerability scan](#core-concept-3--your-first-vulnerability-scan)
7. [Core Concept 4 — Lockfiles: the thing being scanned](#core-concept-4--lockfiles-the-thing-being-scanned)
8. [Core Concept 5 — Licenses 101: why "free" code still has rules](#core-concept-5--licenses-101-why-free-code-still-has-rules)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **what software composition analysis (SCA) is, how to run your first vulnerability and license scan, and why lockfiles are the thing being scanned.**

When you build an app today, you write maybe 10% of the code that actually runs. The other 90% comes from packages you installed — and *their* packages, and *their* packages' packages. Express pulls in dozens of libraries. A fresh React app installs over a thousand. Every one of those is code running in your process, with your permissions, that you never read.

**Software Composition Analysis (SCA)** is the practice of looking at that pile of third-party code and asking two questions:

1. **Is any of it known to be broken or dangerous?** (vulnerability scanning)
2. **Are we legally allowed to use it the way we're using it?** (license scanning)

Both are *static* — they read your dependency list and lockfile and compare against databases. They don't need to run your app. This is a junior-friendly superpower: you can find real, serious problems in minutes with one command.

---

## Prerequisites

- You can install dependencies in at least one ecosystem (`npm install`, `go get`, `pip install`, `cargo add`).
- You know what a **package** and a **package manager** are.
- You've seen a `package.json`, `go.mod`, `requirements.txt`, or `Cargo.toml`.
- Basic command line: running a tool, reading its output.
- Helpful: skim [SAST Security Scanners](../04-sast-security-scanners/) — SCA is its sibling.

---

## Glossary

| Term | Meaning |
|------|---------|
| **SCA** | Software Composition Analysis — scanning your dependencies for vulns and license risk. |
| **SAST** | Static Application Security Testing — scanning *your own* source code for bugs. |
| **Dependency** | A package your project relies on. |
| **Direct dependency** | One you explicitly installed (it's in your manifest). |
| **Transitive dependency** | A dependency of a dependency — you never asked for it directly. |
| **CVE** | Common Vulnerabilities and Exposures — a public ID for a known flaw, e.g. `CVE-2021-44228`. |
| **Advisory** | A security report describing a vuln, affected versions, and fixes. |
| **Lockfile** | A file recording the *exact* version of every dependency (e.g. `package-lock.json`). |
| **Manifest** | The file where you declare dependencies (e.g. `package.json`, `go.mod`). |
| **License** | The legal terms under which you may use a package (MIT, Apache-2.0, GPL…). |
| **Permissive license** | Few restrictions — MIT, BSD, Apache. Generally safe to use. |
| **Copyleft license** | Requires you to share *your* source under the same terms — GPL, AGPL. |

---

## Core Concept 1 — SCA vs SAST: scanning the code you didn't write

These two get confused constantly. The one-line distinction:

- **SAST** scans **your code** — the files in your `src/` folder. It looks for *your* bugs: SQL injection you wrote, a hard-coded password, an unchecked input.
- **SCA** scans **the code you didn't write** — your dependencies. It looks for *known* problems in *other people's* code that you've pulled in.

```
┌─────────────────────────────────────────────┐
│  Your application                            │
│                                              │
│  ┌────────────────┐   ← SAST looks here      │
│  │  Your source    │     (your own bugs)     │
│  │  (~10%)         │                          │
│  └────────────────┘                          │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  Dependencies (~90%)   ← SCA looks here │ │
│  │  express, lodash, log4j, ...           │ │
│  │   └─ their dependencies                │ │
│  │       └─ and theirs (transitive)       │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Why does SCA matter so much? Because **most of your attack surface is third-party**. You can write perfect code and still ship a critical vulnerability — because it lives in a library five levels deep that you've never heard of. SAST will never find it; it's not your code. You need SCA.

Both are part of static analysis, and both belong in CI (see [Static Analysis in CI](../09-static-analysis-in-ci/)).

---

## Core Concept 2 — Direct vs transitive dependencies

When you run `npm install express`, you get Express — but Express needs other packages, which need other packages. The result is a **dependency tree**.

```
your-app
└─ express          ← direct (you installed it)
   ├─ body-parser   ← transitive
   │  └─ qs         ← transitive
   ├─ cookie        ← transitive
   └─ ...
```

- **Direct dependencies** are the ones *you* chose — they're listed in your manifest.
- **Transitive dependencies** are everything pulled in underneath. You never picked them and usually don't know they exist.

Here's the uncomfortable truth: **most vulnerabilities live in transitive dependencies.** You audit the five packages you installed, but those five drag in 200 more, and one of *those* has the hole. The Log4Shell disaster (Core Concept further down and in Real-World Examples) hit thousands of apps that never directly installed Log4j — it came in transitively through other libraries.

Count your tree:

```bash
$ npm ls --all | wc -l        # total packages in the tree
1043
$ npm ls --depth=0 | wc -l    # just direct deps
27
```

27 you chose, ~1000 you didn't. SCA scans **all** of them.

---

## Core Concept 3 — Your first vulnerability scan

Let's actually find vulnerabilities. Every ecosystem has a built-in tool.

**Node.js — `npm audit`:**

```bash
$ npm audit
# npm audit report

minimist  <1.2.6
Severity: critical
Prototype Pollution in minimist - https://github.com/advisories/GHSA-xvch-5gv4-984h
fix available via `npm audit fix`
node_modules/minimist

1 critical severity vulnerability
```

**Python — `pip-audit`:**

```bash
$ pip-audit
Found 1 known vulnerability in 1 package
Name  Version ID             Fix Versions
----- ------- -------------- ------------
jinja2 2.11.2 GHSA-g3rq-g295  2.11.3
```

**A cross-ecosystem tool — `osv-scanner`** (from Google, queries the OSV database):

```bash
$ osv-scanner scan source --lockfile=package-lock.json
╭─────────────────────────────────────┬──────┬───────────┬─────────┬──────────╮
│ OSV URL                             │ CVSS │ ECOSYSTEM │ PACKAGE │ VERSION  │
├─────────────────────────────────────┼──────┼───────────┼─────────┼──────────┤
│ https://osv.dev/GHSA-xvch-5gv4-984h │ 9.8  │ npm       │ minimist│ 1.2.5    │
╰─────────────────────────────────────┴──────┴───────────┴─────────┴──────────╯
```

What just happened: the tool read your lockfile, extracted every package + exact version, and looked each one up in a vulnerability database. A **match** means "this exact version is known to be vulnerable." The fix is almost always **upgrade to the patched version**.

The most useful columns: **severity/CVSS** (how bad), **package** (what), **version** (which one you have), and the **advisory URL** (the details and the fix).

---

## Core Concept 4 — Lockfiles: the thing being scanned

A scanner can only tell you "you have a vulnerable version" if it knows your *exact* versions. That's what a **lockfile** is for.

| Ecosystem | Manifest (ranges) | Lockfile (exact) |
|-----------|-------------------|------------------|
| npm | `package.json` | `package-lock.json` |
| Go | `go.mod` | `go.sum` |
| Rust | `Cargo.toml` | `Cargo.lock` |
| Python (Poetry) | `pyproject.toml` | `poetry.lock` |

Your manifest usually says something *fuzzy*:

```json
"dependencies": {
  "lodash": "^4.17.0"   // "4.17.0 or any compatible newer 4.x"
}
```

`^4.17.0` is a **range** — it could resolve to `4.17.0`, `4.17.21`, or anything in between, depending on when you installed. A scanner can't tell if you're safe from "somewhere in the 4.x range."

The lockfile pins it down:

```json
"node_modules/lodash": {
  "version": "4.17.21"   // exactly this, every time
}
```

Now the scanner knows precisely what you're running. **Always commit your lockfile**, and **always scan the lockfile, not the manifest.** This also means everyone on your team — and your CI, and production — installs the identical tree.

---

## Core Concept 5 — Licenses 101: why "free" code still has rules

Open source is free as in *you don't pay money* — not free as in *no rules*. Every package has a **license** that says what you can and can't do. Ignoring this is a real legal risk for your employer.

Three broad buckets:

| Bucket | Examples | What it means for you |
|--------|----------|------------------------|
| **Permissive** | MIT, Apache-2.0, BSD, ISC | Use it almost any way you like. Usually just keep the copyright notice. **Safe default.** |
| **Copyleft** | GPL, LGPL, **AGPL** | If you distribute software using it, you may have to **release your source code too**. Risky for commercial/closed products. |
| **Unknown / proprietary** | (no license file) | Legally you have **no permission to use it at all**. Treat as a red flag. |

The scariest one for a startup is **AGPL**: if you use AGPL code in a web service (SaaS), you may be required to give your users your *entire* source code — even though you never "distributed" a binary. Companies routinely **ban AGPL** for this reason.

List your licenses (Node example):

```bash
$ npx license-checker --summary
├─ MIT: 412
├─ ISC: 38
├─ Apache-2.0: 22
├─ BSD-3-Clause: 11
└─ GPL-3.0: 1     ← worth a closer look
```

Go has `go-licenses`:

```bash
$ go-licenses report ./... 2>/dev/null
github.com/spf13/cobra,https://github.com/...,Apache-2.0
github.com/some/pkg,https://github.com/...,GPL-3.0    ← flag this
```

As a junior, your job isn't to make the legal call — it's to **notice** GPL/AGPL/unknown licenses and raise them with someone senior.

---

## Real-World Examples

**Log4Shell (CVE-2021-44228), December 2021 — the canonical SCA case.** A critical remote-code-execution flaw was found in Log4j, a Java logging library. Severity: **10.0 (the maximum)**. The catastrophe wasn't the bug itself — it was that *nobody knew where Log4j was*. It was buried as a transitive dependency in thousands of products. Teams spent frantic days running SCA scans just to answer one question: **"are we even using this?"** Companies with good dependency scanning answered in minutes. Companies without it spent weeks. This single event made "know your dependencies" a board-level concern.

**event-stream, 2018.** A popular npm package was handed to a new maintainer who quietly added a transitive dependency containing malware that stole Bitcoin wallets. Millions of downloads. Most victims had never heard of the malicious sub-package — it came in transitively. SCA tools flagged it once it was disclosed.

**The accidental GPL import.** A small SaaS team `go get`s a handy utility library. Months later, during due diligence for an acquisition, lawyers find it's **GPL-3.0**, which is incompatible with their closed-source product. Now they must rip it out and re-implement it under deadline. A `go-licenses` check in CI would have caught it on day one.

---

## Mental Models

- **"You ship a city, not a house."** Your code is one building; your dependencies are the whole city around it. SCA is the city's safety inspection.
- **"Present is not the same as exploited."** A scanner finding a vuln means the *code* is there. Whether it's actually reachable/exploitable is a deeper question (you'll learn it at the middle tier). But as a junior, treat every critical as "fix or escalate."
- **"The lockfile is the truth."** The manifest is your wish list; the lockfile is what you actually got. Scan the truth.
- **"Free code, not free of rules."** Open source has a license. Read the bucket it falls in.

---

## Common Mistakes

- **Only auditing direct deps.** The hole is almost always transitive. Always scan the full tree.
- **Not committing the lockfile.** Without it, your teammates and CI install different versions, and your scan reflects a tree that doesn't match production.
- **Scanning the manifest instead of the lockfile.** Ranges are ambiguous; the scanner can't pin your exposure.
- **Running `npm audit fix --force` blindly.** `--force` will happily upgrade to a *new major version* with breaking changes. Read what it's doing first.
- **Ignoring license output.** "It compiled, so it's fine" is not a legal opinion. A single GPL/AGPL package can poison a commercial product.
- **Treating CVSS 9.8 and 4.0 the same.** Severity tells you what to prioritize. Don't drop a critical to fix three lows.

---

## Test Yourself

1. In one sentence, what's the difference between SAST and SCA?
2. Why do most vulnerabilities live in *transitive* rather than direct dependencies?
3. What file does a scanner actually read to know your exact versions, and why not the manifest?
4. Name the three broad license buckets and give one example of each.
5. Why do many companies ban **AGPL** specifically for SaaS products?
6. You run `npm audit` and see one critical. What are your first two actions?

---

## Cheat Sheet

```bash
# Vulnerability scanning
npm audit                                  # Node, built in
pip-audit                                  # Python
osv-scanner scan source --lockfile=...     # cross-ecosystem (OSV)
govulncheck ./...                          # Go (reachability-aware)
trivy fs .                                  # filesystem / repo scan

# License scanning
npx license-checker --summary              # Node
go-licenses report ./...                   # Go

# Count your tree
npm ls --all | wc -l                       # total (incl. transitive)
npm ls --depth=0                           # direct only
```

| If you see... | Do this |
|---------------|---------|
| A critical CVE | Upgrade to the patched version; if you can't, escalate. |
| A vuln in a transitive dep | Upgrade the *direct* parent, or override the version. |
| A GPL / AGPL / unknown license | Stop and ask someone senior — legal risk. |
| A range in the manifest | Make sure the lockfile is committed; scan the lockfile. |

---

## Summary

- **SCA scans the code you didn't write** (your dependencies); SAST scans your own source. Most of your app — and most of your risk — is third-party.
- Dependencies form a **tree**; **transitive** deps dominate, and that's where most vulns hide.
- A vuln scan **matches your exact versions** against advisory databases (`npm audit`, `pip-audit`, `osv-scanner`). Always scan the **lockfile**.
- **Lockfiles** pin exact versions; manifests use ranges. Commit the lockfile and scan it.
- **License scanning** classifies deps as permissive / copyleft / unknown. **AGPL in a SaaS** is the classic trap. Notice and escalate.
- **Log4Shell** is the canonical lesson: the hard part isn't fixing the bug, it's *knowing where you're affected*.

---

## Further Reading

- OSV.dev — the open-source vulnerability database (`osv.dev`)
- GitHub Advisory Database (`github.com/advisories`)
- `npm audit` docs; `pip-audit`, `osv-scanner`, `govulncheck` READMEs
- choosealicense.com — plain-English license explanations
- SPDX license list — canonical license identifiers

---

## Related Topics

- [SAST Security Scanners](../04-sast-security-scanners/) — the sibling that scans *your* code
- [Static Analysis in CI](../09-static-analysis-in-ci/) — wiring scans into the pipeline
- [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOMs and the bigger picture
- [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/) — trusting what you ship
- Middle tier: transitive vulns, the reachability problem, and auto-update PRs
