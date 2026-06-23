# Supply-Chain Integrity — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is the "software supply chain" in the context of a Go program?

**Model answer.** Everything that ends up in your binary that you did not write yourself: your direct dependencies, their transitive dependencies, and the toolchain and build tools that produce the binary. A small `go.mod` can expand to dozens of modules in the full build list (`go list -m all`), and every one of them runs in your process with your permissions. Importing a package is, security-wise, equivalent to copying its source into your repo.

**Common wrong answers.**
- "Just the libraries I import directly." (No — transitive dependencies are the larger part of the surface.)
- "The CI/CD system." (That is *part* of it, but the dependency tree is the core.)

**Follow-up.** *How do you see your full supply chain?* — `go list -m all` for the module build list; `go version -m <binary>` for what actually shipped.

---

### Q2. What does `go.sum` guarantee, and what does it *not* guarantee?

**Model answer.** `go.sum` records cryptographic hashes of each dependency version's content and `go.mod`. Every build re-verifies the downloaded bytes against it, so it guarantees the dependencies are **unchanged** from what was first recorded — tamper detection. It does **not** guarantee the dependencies are **safe**: malicious-but-stable code passes `go.sum` perfectly, because it never changes. Integrity (unchanged) and safety (not malicious) are different properties.

**Common wrong answers.**
- "It checks that my dependencies have no vulnerabilities." (That is `govulncheck`, not `go.sum`.)
- "It encrypts my dependencies." (No — it hashes them; `go.sum` is meant to be public and committed.)

**Follow-up.** *Should `go.sum` be committed?* — Always. It is your tamper-evidence record; `.gitignore`-ing it is a bug.

---

### Q3. What is the checksum database, and what does it add over `go.sum`?

**Model answer.** The checksum database (`sum.golang.org`, via `GOSUMDB`) is a global, public, append-only transparency log of module hashes. `go.sum` only protects you *after* the first download. The checksum database verifies the *first* download against what every other Go user recorded, so an attacker cannot serve you uniquely-tampered bytes without it being globally visible. It is Certificate-Transparency-for-modules.

**Follow-up.** *When is it consulted?* — Only on first encounter of a version; after that, `go.sum` handles verification offline.

---

### Q4. What is `govulncheck`, and what makes its output high-signal?

**Model answer.** It is Go's official vulnerability scanner. It queries the Go vulnerability database (`vuln.go.dev`) and reports vulnerabilities affecting your dependencies. What makes it high-signal is **symbol-level call-graph analysis**: it does not just flag "you depend on a vulnerable version," it flags "you depend on a vulnerable version *and your code actually calls the vulnerable function*," with a trace to the call site. Vulnerabilities present but not reached go in a separate "Informational" section.

**Common wrong answer.** "It scans every line of every dependency for bugs." (No — it cross-references catalogued vulnerabilities against your reachable call graph.)

**Follow-up.** *Why is that distinction useful?* — It cuts noise: you fix what you are actually exposed to, not every CVE that exists somewhere in your tree.

---

### Q5. Name three categories of supply-chain attack.

**Model answer.**
- **Typosquatting** — a package named one keystroke from a popular one, hoping for a typo.
- **Dependency confusion** — a public package impersonating your private/internal one.
- **Malicious update** — a trusted package ships a poisoned new version (the most common shape; `xz`, `event-stream`).

Plus compromised maintainers and build-time attacks (SolarWinds).

**Follow-up.** *Which is most common in practice?* — Malicious updates, because they exploit the automatic trust we grant version bumps.

---

## Middle

### Q6. How do you set up a private module so it does not fail or leak to the public proxy?

**Model answer.** Set `GOPRIVATE` to the private namespace: `go env -w GOPRIVATE='git.acme.internal,*.acme.internal'`. This implies `GONOPROXY` (fetch directly, skip the public proxy) and `GONOSUMDB` (skip the public checksum database) for those patterns. Without it, Go tries to verify the private module against `sum.golang.org`, which cannot see it, and fails with a `410 Gone`. The critical rule: scope it to your namespace only — never `GOPRIVATE=*`, which disables checksum verification for *everything*.

**Common wrong answer.** "Set `GOSUMDB=off`." (That disables verification globally to fix one private module — a major downgrade.)

**Follow-up.** *Does `go.sum` still apply to private modules?* — Yes, locally. `GONOSUMDB` only skips the *public database* lookup, not local `go.sum` checking.

---

### Q7. How does `govulncheck` decide a finding is "actionable" versus "informational"?

**Model answer.** It builds your program's call graph (via SSA + a type-aware call-graph algorithm) and computes which functions are reachable from `main`/tests. For each vulnerability, the Go vuln database records the affected *symbols*. If a reachable function is an affected symbol, the finding is **actionable** and comes with a trace. If the affected symbol is in your dependency tree but no reachable function touches it, it is **informational**. So the same vulnerable dependency can be actionable in one project and informational in another.

**Follow-up.** *What are its blind spots?* — Calls made via reflection, cgo, or assembly may not appear in the static call graph, so it can under-report there.

---

### Q8. Why run `govulncheck` on a schedule, not just on push?

**Model answer.** Vulnerabilities are disclosed continuously against versions you already shipped and have not touched. A push-only scan only re-examines code when you change it, so a CVE disclosed against a stable, deployed dependency goes unnoticed until something happens to trigger a build. A scheduled (e.g. weekly) scan re-checks the current code against the latest database, catching newly-disclosed issues in already-shipped code.

**Follow-up.** *Where else can you scan continuously?* — Against stored SBOMs of deployed artifacts using `osv-scanner`, so you do not even need to rebuild.

---

### Q9. What does vendoring add to supply-chain security, and what does it *not* add?

**Model answer.** Vendoring copies dependency source into a committed `vendor/` directory. It adds: (1) **auditability** — every dependency byte is in your repo, reviewable in PRs, and a dependency *update* shows up as a concrete diff a human can inspect; (2) **build isolation** — with `GOPROXY=off`, builds are hermetic and do not depend on the proxy. It does **not** add vulnerability protection (vendored code is still vulnerable; you still run `govulncheck`) and it does **not** replace `go.sum` (still committed and verified). A stale vendor tree is actually *worse* than none, because it freezes you on unpatched versions while looking diligent.

**Follow-up.** *Cost?* — Repo size and PR-diff noise; see the `go mod vendor` topic.

---

### Q10. How do you use `go version -m`, and why does it matter for supply chain?

**Model answer.** `go version -m ./app` reads the module build info embedded in a compiled binary: every dependency module, its version and hash, and build settings (`-trimpath`, VCS revision/time). It matters because it is the **ground truth** of what actually shipped — independent of any `go.mod` that might have drifted. It is what `govulncheck -mode=binary`, `cyclonedx-gomod bin`, and `syft` read to analyze and inventory a binary you did not build from source.

**Follow-up.** *When would you scan a binary instead of source?* — When you only have the artifact (a vendor-supplied binary), or to verify what a release actually contains.

---

### Q11. How do Dependabot/Renovate fit into a secure supply chain?

**Model answer.** They keep dependencies continuously updated by opening one reviewable PR per outdated dependency, so security patches do not rot unapplied. The supply-chain value is not "auto-merge everything" — it is that each bump is isolated, has a clear diff and changelog, and runs through your full CI (including `govulncheck`) *before* merge, so a malicious or vulnerable update is caught at PR time. You can auto-merge the low-risk class (patch updates passing all checks) and require human review for the rest.

**Common wrong answer.** "Turn on auto-merge for all updates." (That optimizes for the exact malicious-update vector you most need to catch — only safe if the full check suite gates the merge.)

**Follow-up.** *What second check would you add?* — GitHub dependency review, which flags PRs that introduce known-vulnerable or badly-licensed dependencies.

---

### Q12. A `go get` fails with a checksum mismatch. What do you do?

**Model answer.** Treat it as a security signal, not an annoyance. A mismatch means the bytes you got differ from what `go.sum` recorded — possible causes are an upstream force-push to a tag, a proxy/cache serving wrong content, or genuine tampering. Investigate the cause first. Do **not** reflexively delete `go.sum` — that accepts the new, possibly malicious bytes. If the change is legitimate and intended, regenerate `go.sum` deliberately (`go mod tidy`) and review the diff before committing.

**Follow-up.** *How does the checksum database help here?* — It would catch a *first-time* tampered download by comparing against the global record; `go.sum` catches subsequent divergence.

---

## Senior

### Q13. Walk me through a threat model for a Go service's supply chain. Where do you invest?

**Model answer.** Map the chain — maintainer → VCS → release → proxy → checksum DB → `go.sum` → cache → toolchain → build-time codegen → binary → distribution → deployment — and for each link ask: who controls it, what verifies it, and what is the blast radius if compromised. Two findings dominate: the highest-*leverage* attacks target shared infrastructure (proxy, build system, toolchain — one compromise hits every build, the SolarWinds insight), and the most-*likely* attack is a malicious update to a trusted dependency (one account, exploiting automatic trust). So I invest heaviest where likelihood meets blast radius: build-system integrity (hermetic, attested builds) and update review (pinning, scanning, capability diffs). I spend lightly on exotic, low-probability scenarios. The goal is proportional allocation of a finite verification budget, not treating every link as equally dangerous.

**Follow-up.** *What are your trust anchors?* — The Go checksum database, the proxy, dependency maintainers, the build platform. Senior work is making each explicit and deciding whether it is acceptable (e.g. replacing the public proxy with a private one or vendoring in regulated environments).

---

### Q14. What is the difference between reproducible and hermetic builds, and why do both matter?

**Model answer.** A **reproducible** build produces a bit-for-bit identical binary from the same source and toolchain, every time — verifiable, so independent rebuilds matching is evidence of no build-time tampering. A **hermetic** build depends only on pinned, declared inputs — no surprise network, no ambient state, no unpinned tools. Hermeticity is a *precondition* for trustworthy reproducibility (a build that fetches from the network mid-run can pull different bytes). In Go: `-trimpath`, pinned `toolchain`, `GOTOOLCHAIN=local`, `GOPROXY=off` with vendored/verified deps, then a CI gate that builds twice with `go clean -cache` between and `cmp`s the outputs. Both matter because together they make build-time tampering *detectable* — which signing alone does not (SolarWinds shipped correctly-signed, tampered binaries).

**Follow-up.** *What does vendoring/`go.sum` *not* pin?* — The toolchain. Freezing dependencies but not the compiler leaves a build-time hole; pin the Go version and the builder image by digest.

---

### Q15. Explain SLSA and how you would reach a meaningful level for a Go project.

**Model answer.** SLSA (Supply-chain Levels for Software Artifacts) is a framework of build-integrity guarantees. Build L1: provenance exists (describes how the artifact was built). L2: the provenance is generated and *signed* by a hosted build platform, so a developer cannot forge it locally. L3: the build runs in an isolated, hardened environment and provenance is generated by the platform in a way the build's own steps cannot influence — the level that actually resists a SolarWinds-style build-step compromise. For Go on GitHub, I would use the official SLSA GitHub generator (a reusable workflow that builds in isolation and emits signed L3 provenance), combined with reproducible builds so the provenance's claims are independently verifiable, and publish the provenance with releases for consumers to verify via `slsa-verifier`. Most orgs target L2 as a baseline and L3 for sensitive artifacts.

**Common wrong answer.** "SLSA is a tool you install." (No — it is a framework; you assemble Go's primitives plus a build platform plus signing to meet a level.)

**Follow-up.** *Why isn't signing enough?* — A signature proves *who* built it, not that *what* they built is clean. SolarWinds was correctly signed. Provenance from an isolated builder is what closes that gap.

---

### Q16. `go.sum` and `govulncheck` both pass. Can a malicious package still get in? How would you catch it?

**Model answer.** Yes. A novel malicious package is internally consistent (so `go.sum` sees it as "unchanged") and not yet catalogued (so `govulncheck` sees it as "not known bad"). Both tools verify; neither vets intent. To catch it I add a **behavioral** layer: capability analysis with **capslock**, which determines what each dependency actually *does* — network, filesystem, exec, unsafe. The technique is differential: baseline each dependency's capabilities, then diff after an update. A logging library that suddenly gains network or exec capability after a version bump is a glaring red flag and exactly the signature of an `xz`-style backdoor that version-number review misses. Beyond that: minimize dependencies, review new-dependency adoption as a deliberate event, and quarantine brand-new versions at a private proxy.

**Follow-up.** *What can capslock not catch?* — A backdoor that only uses capabilities the package legitimately already had.

---

### Q17. How would you generate, sign, and use SBOMs for a Go service?

**Model answer.** Generate the SBOM from the *binary* (not `go.mod`) so it reflects exactly what shipped — `cyclonedx-gomod bin -json -output sbom.json ./app` (CycloneDX) or `syft ./app -o spdx-json` (SPDX) — because the binary's embedded build info is ground truth, immune to `go.mod`/build drift. Then *sign* it as an attestation bound to the artifact digest (`cosign attest --predicate sbom.json --type cyclonedx app`), so it cannot be swapped for another component's bill of materials. Attach it to the release. Finally, *continuously scan* the stored SBOMs against the vuln database (`osv-scanner --sbom sbom.json`) on a schedule, so a CVE newly disclosed against an already-shipped version raises an alert without rebuilding. An SBOM that is generated and filed but never re-scanned is a snapshot, not a control.

**Follow-up.** *CycloneDX vs SPDX?* — CycloneDX is security-focused (rich vuln modeling); SPDX is license/compliance-focused and an ISO standard. Many pipelines emit both.

---

### Q18. You inherit a service that has never had any supply-chain controls. What is your rollout order?

**Model answer.** Cheapest, highest-value first, defense in depth:
1. **Commit and verify `go.sum`; add `go mod verify` + a tidy check to CI.** Catches tampering and stowaway deps; near-zero cost.
2. **Add `govulncheck ./...` to CI, on push and on a schedule.** Immediate visibility into known, called CVEs.
3. **Scope `GOPRIVATE` correctly** if there are private modules; audit `go env` for any dangerous overrides (`GONOSUMDB=*`, `-insecure`).
4. **Adopt Dependabot/Renovate** so updates stop rotting, with CI gating each bump.
5. **Build with `-trimpath`; pin the toolchain.** Reproducibility groundwork.
6. **Generate an SBOM at release; start continuous fleet scanning.**
7. **Add signing + SLSA provenance** for releases once the basics hold.
8. **Layer in capability-diff review and a private proxy** as the org matures.

Each step is independently valuable, so progress is never blocked on the next.

**Follow-up.** *What would you resist doing first?* — Vendoring or full SLSA L3, which are higher-effort and lower marginal value until the cheap layers are in place.

---

## Staff / Architect

### Q19. Design org-wide supply-chain governance for 200 Go services.

**Model answer.** Centralize policy, distribute enforcement, make the secure path the default.
- **Private proxy as the org GOPROXY** — a controllable trust anchor, an audit log of every fetched version, an org-wide *kill-switch* (block a malicious version at the proxy and every build stops using it instantly), availability against public outages, and quarantine of brand-new versions.
- **Shared CI templates** (reusable workflows) that already include `go mod verify`, the tidy check, `govulncheck`, the reproducibility gate, and SBOM/provenance generation — teams *inherit* controls rather than reimplementing and forgetting them.
- **Policy as code at admission** — a policy engine (cosign policy-controller / OPA / Kyverno) that refuses to deploy an image lacking a valid signature, verified SLSA provenance, and a clean SBOM scan. The cluster enforces.
- **Centralized SBOM inventory + continuous scanning** — when a CVE drops, query the inventory ("which services ship the affected module?") instead of auditing manually.
- **Dependency-adoption review** — adding a *new* module to the org trust boundary is a reviewed event (CODEOWNERS on `require`/`vendor`), not a silent `go get` side effect.

The throughline: security that depends on every engineer remembering will fail at the first deadline; encode it as the default.

**Follow-up.** *How do you handle a fleet-wide CVE?* — SBOM inventory query → identify affected services → scripted bulk version bumps → CI-gated PRs → re-scan to confirm.

---

### Q20. Compare the checksum database and cosign/sigstore signing. Why might you want both?

**Model answer.** They secure different links with different mechanisms. The **checksum database** is a Merkle transparency log that guarantees *integrity*: the module bytes you fetched are the same bytes everyone else recorded; substitution is globally visible and unforgeable. It says nothing about *who built your artifact* or *how*. **cosign/sigstore** secures the *output* side: keyless signing (Fulcio ephemeral certs bound to an OIDC build identity, logged in Rekor) plus in-toto SLSA provenance attestations prove *who* produced an artifact and *how it was built*, with no long-lived keys to leak. You want both because the supply chain has multiple trust boundaries: the checksum DB protects the *inputs* (dependencies entering your build), while signing and provenance protect the *outputs* (the artifact leaving your build and what consumers verify). Neither subsumes the other — and SolarWinds shows signing without build integrity is insufficient, while integrity of inputs says nothing about the build environment.

**Follow-up.** *What is the residual risk after both?* — Social/intent: someone still decided to trust a maintainer, a project, a build platform. Tooling relocates and monitors trust; it never removes it.

---

### Q21. How do you make trust decisions explicit and proportionate rather than chasing zero-trust?

**Model answer.** Accept that every defense reduces to a *trust anchor* you decide not to verify further — the Go team's checksum DB, the proxy, dependency maintainers, the build platform. Zero-trust is impossible; the goal is *explicit, proportionate* trust. Concretely: (1) document each anchor and its blast radius in the threat model; (2) for each, decide consciously whether it is acceptable for *this* artifact's risk tier — a throwaway internal tool and an internet-facing privileged service should not carry the same SLSA level or review burden; (3) make violations *detectable* even where you cannot prevent them (transparency logs, reproducibility gates, capability diffs, continuous scanning); (4) review trust *changes* as events (a new dependency, a maintainer handoff, a build-platform migration). The senior failure mode is uniform policy — either gold-plating everything (wasting budget) or under-protecting the crown jewels. Proportionality is the whole skill.

**Follow-up.** *Give an example of detect-not-prevent.* — You cannot prevent a maintainer from publishing malice, but the checksum DB makes substitution visible, `govulncheck` flags it once catalogued, and capslock flags the new capability it exercises — turning an invisible compromise into a detectable one.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| What does `go.sum` prove? | Dependencies are *unchanged*, not *safe*. |
| What adds first-download verification? | The checksum database (`sum.golang.org`). |
| What does `govulncheck` filter on? | Call-graph reachability of affected symbols. |
| Configure a private module? | Scope `GOPRIVATE` to its namespace. |
| Disable sumdb globally to fix one private dep? | No — scope, never global. |
| Inspect what shipped in a binary? | `go version -m ./app`. |
| Most common attack shape? | Malicious update to a trusted package. |
| What is SLSA L3's key property? | Provenance from an isolated builder the build can't forge. |
| Catch a *novel* malicious update? | Capability analysis (capslock), differential. |
| SBOM from `go.mod` or binary? | Binary — ground truth of what shipped. |
| Signing proves what? | *Who* built it, not that it's *clean* (SolarWinds). |

---

## Mock Interview Pacing

A 30-minute interview on Go supply-chain integrity might cover:

- 0–5 min: warm-up — Q1, Q2, Q4.
- 5–15 min: middle topics — Q6, Q7, Q9, Q12.
- 15–25 min: a senior scenario — Q13, Q14, or Q16.
- 25–30 min: a curveball — Q19 or Q20.

If the candidate claims hands-on security experience, drive straight to Q12 (checksum mismatch handling) and Q16 (catching novel malice past `go.sum`/`govulncheck`) — both separate people who *run* the tools from people who *understand their limits*. If they have only read about it, stay in middle territory and probe whether they distinguish integrity from vulnerability (Q2/Q4) and scope `GOPRIVATE` safely (Q6). A staff candidate should reach Q19's governance design and articulate the "detect, don't pretend to prevent" framing (Q21) within fifteen minutes.
