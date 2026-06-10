# Interop & Polyglot Architectures — Professional

> **What?** Polyglot as an *organizational* phenomenon — the Conway's-law forces that produce it, the governance that keeps it from metastasizing, the platform-team investment that makes it survivable, the hiring and on-call economics that decide whether it's affordable, and the strategic question of when interop overhead has grown large enough to justify *consolidating* back.
> **How?** By treating "how many languages do we allow, and where" as a deliberate, governed decision with an owner — not an emergent accident — and by building the shared infrastructure (schemas, observability, CI templates) that turns a polyglot estate from a liability into a capability.

---

## 1. Polyglot is usually a Conway's-law outcome, not a design

> *"Organizations design systems that mirror their own communication structure."* — Melvin Conway, 1967

Most polyglot estates were never designed. They *grew*, and they grew along the contours of the org chart. The data-science team hires Python people, so the ML services are Python. The infra team likes Go, so the platform is Go. A team acquired in a merger brought a Scala codebase. A frontend team that owns a thin BFF (backend-for-frontend) writes it in Node because that's what they know. **Each language choice was locally rational and globally uncoordinated** — the textbook Conway's-law signature.

This matters for two reasons. First, you can't govern polyglot by arguing about languages in the abstract; you have to engage with the *team structure* that produces them. If the ML team is Python because ML is Python, no policy will (or should) change that. Second, the **inverse Conway maneuver** is a real lever: if you want a monoglot core, you organize the teams that own the core around one language — structure the org to produce the architecture you want, rather than fighting the architecture the current org produces.

The professional's job is not to stamp out polyglot (that's both impossible and often wrong) but to make the *forced* polyglot affordable and stop the *accidental* polyglot from accumulating.

---

## 2. The supported-languages list: governance with exceptions

The single most effective governance tool is a short, explicit, owned **supported-languages list** — a tiered policy, not a ban:

| Tier | Meaning | Example |
|---|---|---|
| **Supported (default)** | First-class: shared libs, CI templates, on-call coverage, hiring pipeline all exist | Go, TypeScript, Python |
| **Allowed with justification** | Permitted for a documented reason; you own the gaps | Rust (for a specific perf-critical component) |
| **Exception / sunset** | Exists for legacy or acquisition reasons; not for new work | Scala (from an acquisition), being migrated out |
| **Not supported** | New work requires an approved exception (an ADR + architecture review) | everything else |

The discipline that makes this *governance* rather than *bureaucracy*:

- **The list has an owner** (a principal engineer, an architecture group) and a written rationale, reviewed periodically.
- **Adding to "supported" is expensive and deliberate** — it commits the platform team to building shared libraries, CI, and observability for that language *forever*. A language isn't "supported" because someone shipped it; it's supported when the org has funded its toolchain tax.
- **Exceptions are allowed but *visible*.** A team that wants Rust for a latency-critical path files an ADR, gets it reviewed, and accepts ownership of the gaps (they maintain their own libs until/unless it graduates to supported). The goal is not to say no — it's to make the *cost* explicit and *owned*, so the decision is honest.

The anti-pattern is the unwritten list, where the "policy" lives in the heads of whoever's been around longest, and every new language is litigated from scratch. Write it down, give it an owner, and the conversation shifts from "is Rust good?" (a religious war) to "is this component's need worth us owning a Rust toolchain?" (an economic question). This is the org-level expression of [`../05-when-to-introduce-a-new-language/`](../05-when-to-introduce-a-new-language/).

---

## 3. The platform team's job: making polyglot survivable

Polyglot is only affordable if a **platform/infrastructure team** absorbs the cross-cutting tax so product teams don't pay it N times. Without this team, each language's tax (from [`senior.md`](senior.md) §8) is paid redundantly by every team that touches it. With it, the tax is paid *once* and amortized. The platform team's polyglot mandate:

| Investment | What it delivers | Why it makes polyglot survivable |
|---|---|---|
| **Shared schema registry** | One protobuf/Avro repo, versioned, with CI-enforced compatibility checks | Every language generates types from the same source; boundaries can't silently break |
| **Shared observability** | Mandated structured-log schema, OpenTelemetry SDK config, trace-context propagation, per-language client libs | A request is traceable across all languages; incidents aren't archaeology |
| **CI/CD templates** | Per-language golden-path pipelines (build, test, lint, SBOM, vuln scan, deploy) | A new service in a supported language ships through a paved road, not a bespoke pipeline |
| **Shared cross-cutting libs** | Auth, retry, rate-limit, feature-flags, metrics — one implementation per supported language, kept in sync | A security fix lands once per language, not once per service |
| **Standard service template** | `create-service --lang=go` scaffolds a conforming service | New polyglot edges start compliant, not as snowflakes |

The strategic point: **the platform team's existence is what converts "supported language" from a slogan into a reality.** A language is genuinely supported only when there's a paved road for it. This is also why the supported list must be *short* — every entry is a standing commitment of platform-team capacity. A list of three supported languages is a real promise; a list of ten is a fiction that will rot.

---

## 4. The hiring and on-call economics

Languages are a *labor-market* decision as much as a technical one, and this is where the polyglot bill is largest over a multi-year horizon (the full treatment is [`../07-total-cost-of-ownership-and-team-skills/`](../07-total-cost-of-ownership-and-team-skills/)).

**Hiring.** Every distinct language narrows or shifts your candidate pool:
- A Go + Python + TypeScript shop hires from large, overlapping pools — most full-stack and backend engineers cover at least two.
- Add Rust or Scala and you're hiring from a smaller, pricier, more specialized pool, *or* training internally (months, not weeks).
- The relevant number isn't "can we hire one Rust engineer" but "can we sustain a *team* that can review, on-call, and bus-factor-survive a Rust service for years." One Rust expert who leaves can strand a service.

**On-call.** This is the sharpest recurring cost. A polyglot on-call rotation has two bad options:
1. **Everyone learns everything** — every on-call engineer is competent in all N languages. Expensive to train, hard to sustain, and unrealistic past ~3 languages.
2. **Specialized escalation** — incidents in the Rust service route to the two people who know Rust. This re-creates a bus factor and slows incident response precisely when speed matters.

Neither is good, and both get worse linearly with language count. This is the most concrete reason "minimize languages, not just services" (from [`senior.md`](senior.md)) is an *operational* imperative, not an aesthetic preference: every language added to the estate is added to the pager.

**The honest framing for leadership:** a new language's cost is not the migration or the initial build — it's the *perpetuity* of hiring, training, on-call coverage, and platform support. A language is a liability that compounds. That framing is what turns "let's use the best tool" into a fundable, defensible decision.

---

## 5. "Monoglot core, polyglot edges" as a strategy

The dominant strategy among orgs that have lived through polyglot pain is **monoglot core, polyglot edges**:

```
              ┌─────────────────────────────────────┐
              │   POLYGLOT EDGES (forced)           │
              │   • Python  — ML/data science       │
              │   • TS/JS   — browser frontend       │
              │   • Rust    — one latency-critical    │
              │              component (exception)    │
              └─────────────────────────────────────┘
                              │  contracts (protobuf)
              ┌─────────────────────────────────────┐
              │   MONOGLOT CORE                      │
              │   • One primary language (e.g. Go)   │
              │   • The bulk of services, the shared │
              │     libs, the paved CI road          │
              └─────────────────────────────────────┘
```

The logic:
- **The core is one language**, so the bulk of the system shares a toolchain, libraries, on-call skill set, and hiring pool. This is where the *volume* of code lives, so this is where minimizing language count pays off most.
- **The edges are polyglot where forced** — ML must be Python, the browser must be JS/TS, and a genuinely latency-critical component might earn a Rust exception. These are *few*, *well-justified*, and *bounded*.
- **Contracts isolate the edges from the core.** The Python ML service talks to the Go core through a protobuf gRPC contract; the core neither knows nor cares that it's Python. The boundary confines the polyglot tax to the edge.

This strategy is essentially the org-level application of the senior insight that boundaries are liabilities: it *concentrates* the boring, high-volume work in one language and *quarantines* the unavoidable polyglot to a small, contract-isolated perimeter. It's not anti-polyglot — it's polyglot *with discipline about where*.

---

## 6. WASM and the future of polyglot

WebAssembly is the most credible candidate to change the polyglot calculus over the next decade, and a professional should track it deliberately.

The thesis: today, cross-language interop forces a choice between the *network* (isolated but slow, with serialization tax) and *FFI* (fast but unsafe, with no isolation). **WASM offers a third point**: sandboxed, near-native-speed, language-agnostic components that interoperate through typed interfaces *without* a network hop *and* without sharing an address space unsafely.

- **The WASM Component Model + WIT** (WASM Interface Types) aim to let a Rust component and a JavaScript host (or a Go component and a Python host) exchange *typed* values across a safe sandbox boundary — interop without serialization-to-the-wire and without segfault risk.
- **Edge and plugin runtimes** (Wasmtime, WasmEdge, Fastly/Cloudflare edge) already run polyglot WASM modules in production, and plugin ecosystems (Envoy filters, Shopify Functions) use WASM precisely so users can write extensions in *any* language that compiles to it.
- **The realistic professional stance:** WASM is production-ready for *constrained* use cases (edge functions, plugins, sandboxed untrusted code) and *not yet* a general replacement for service boundaries or the JVM-style shared runtime. Watch the Component Model's maturation; pilot it for plugin/extension surfaces; don't bet the core on it yet.

The reason it matters strategically: if WASM delivers on the Component Model, "the right tool per component" could finally stop carrying a heavy interop tax — and the math on polyglot would genuinely shift. That's a multi-year horizon, but it's the most important thing to be *literate* about when reasoning about polyglot's future. (See also [`../08-language-longevity-and-lock-in-risk/`](../08-language-longevity-and-lock-in-risk/) for betting on emerging targets.)

---

## 7. When to consolidate: interop overhead as the trigger

Polyglot governance isn't only about *adding* languages — the harder professional call is deciding when the *interop overhead* has grown large enough to justify *removing* one. The signals that a polyglot estate has tipped from capability to liability:

- **Boundary friction dominates feature work.** Shipping a feature routinely requires coordinated changes across three languages and three contracts, and the *coordination* — not the code — is the bottleneck.
- **The shared-library tax is visible in incidents.** A CVE or an auth bug requires N parallel fixes, and one language's fix lags, creating a security gap.
- **On-call can't keep up.** Incident MTTR is dominated by "finding someone who knows language X," and the bus factor on a niche-language service is 1 or 2.
- **A language has lost its justification.** The Scala service from the acquisition now does what a Go service could do; the only thing keeping it is inertia. (This is the *sprawl* diagnosis from [`senior.md`](senior.md) §7.)

When these accumulate, the move is a *deliberate consolidation* — picking the lowest-value, least-justified language and migrating its services into a supported one. This is not a rewrite-everything crusade; it's a targeted retirement of a language whose tax exceeds its value. The *how* — strangler-fig, parallel runs, incremental migration — is [`../06-migrating-between-languages/`](../06-migrating-between-languages/). The *when* is a professional judgment: consolidate when the interop and toolchain tax on a language clearly and durably exceeds the capability it provides, and not before (premature consolidation strands a working system to chase tidiness).

The decision framework, in one line: **add a language when its capability is irreplaceable and worth a forever-tax; remove one when its tax is no longer buying irreplaceable capability.**

---

## 8. Professional checklist

- [ ] Recognize polyglot as a **Conway's-law outcome**; govern the *team structure*, not just the languages, and use the inverse-Conway maneuver to shape the core.
- [ ] Maintain a **written, owned, tiered supported-languages list** — supported / allowed-with-justification / exception / not-supported — reviewed periodically.
- [ ] Make **adding to "supported"** an explicit, funded commitment (shared libs + CI + observability + on-call), which is why the list must stay short.
- [ ] Fund a **platform team** to absorb the cross-cutting tax once: schema registry, observability, CI templates, shared cross-cutting libs, service scaffolding.
- [ ] Frame language cost to leadership as a **perpetuity** — hiring, training, and on-call coverage that compounds — not a one-time build cost.
- [ ] Default to **monoglot core, polyglot edges**: concentrate volume in one language, quarantine forced polyglot behind contracts.
- [ ] Be **literate on WASM** — pilot it for plugins/edge, watch the Component Model, don't bet the core on it yet.
- [ ] Know the **consolidation triggers** — add a language when its capability is irreplaceable; remove one when its tax stops buying irreplaceable capability.

---

## 9. What's next

| Topic | File |
|---|---|
| Interview Q&A from "what is polyglot?" to staff-level interop strategy | [`interview.md`](interview.md) |
| Design exercises: governance, contracts, costing a 4th language, critiquing sprawl | [`tasks.md`](tasks.md) |
| The decision to introduce a new language, and the N+1 tax | [`../05-when-to-introduce-a-new-language/`](../05-when-to-introduce-a-new-language/) |
| Migrating/consolidating languages without a death-march rewrite | [`../06-migrating-between-languages/`](../06-migrating-between-languages/) |
| The full TCO and team-skills economics of a polyglot estate | [`../07-total-cost-of-ownership-and-team-skills/`](../07-total-cost-of-ownership-and-team-skills/) |

---

**Memorize this:** polyglot is a Conway's-law accident until you govern it — with a short, owned, tiered supported-languages list and a platform team that pays the cross-cutting tax once so product teams don't pay it N times. Default to monoglot core, polyglot edges; treat each language as a compounding perpetuity in hiring and on-call; add one only when its capability is irreplaceable, and consolidate one out when its tax stops buying that capability. Watch WASM — it may be the thing that finally makes "right tool per component" cheap.
