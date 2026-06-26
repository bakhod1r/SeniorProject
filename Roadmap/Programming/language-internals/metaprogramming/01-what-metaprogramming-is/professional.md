# What Metaprogramming Is — Professional Level

> **Topic:** [What Metaprogramming Is](README.md)
> **Focus:** Metaprogramming at production scale — governance, supply-chain and security implications, the build/runtime cost model in real systems, the reflection-to-AOT migration that is reshaping mainstream ecosystems, and how to set organization-wide policy on what magic is allowed.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **At production scale, metaprogramming is no longer a coding technique — it's an operational, security, and governance concern.** Who is allowed to generate code? What runs build-time vs runtime, and what does each cost you in latency, startup, binary size, and attack surface? How do you migrate a reflection-heavy platform to AOT without breaking it?

By the time you operate metaprogramming at scale — across many teams, many services, a shared build platform, and a security boundary — the questions change shape entirely. The interesting problems are no longer "how does a macro work" but: *A proc-macro your team didn't write executes arbitrary code on every developer's machine and in CI — is that an acceptable supply-chain risk? Your platform's 12-second JVM startup is dominated by Spring's reflective classpath scan — do you migrate the whole fleet to AOT, and what breaks? A code generator emits 400k lines that nobody reviews but everybody ships — how do you govern that? `eval` shows up in a dependency that processes user input — is that a vulnerability or a feature?*

These are the concerns of someone who owns a platform, a build system, or a security posture. This page treats metaprogramming as a **production system property** with three dominant lenses:

1. **Cost model** — the concrete, measurable price of each stage: build time, CI minutes, binary size, cold-start latency, per-request overhead, memory.
2. **Security & supply chain** — metaprogramming is *arbitrary code execution by design*. Macros run at build; `eval` runs at runtime; generated code ships unreviewed. Each is an attack surface.
3. **Governance** — at scale, "what metaprogramming is allowed, by whom, audited how" is a policy you write and enforce, not a per-PR judgment.

The defining industry movement of the current era — **the migration from runtime reflection to build-time generation** (GraalVM native-image, Spring-AOT, Quarkus, Micronaut, Dagger over Guice) — sits squarely in this material. It is driven not by elegance but by operations: serverless cold starts, container density, memory budgets, and security. Understanding *why* that migration is happening, and how to execute it, is the professional-grade skill.

> 🏭 **Why this matters at the professional level:** Your decisions about metaprogramming now have a P&L. Reflection-heavy startup costs real money in serverless invocations and container memory. An unaudited proc-macro is a real supply-chain CVE waiting to happen. A 500k-line generated artifact is a real review and audit gap. You're not choosing a coding style; you're setting policy that the whole organization inherits.

---

## Prerequisites

- **Required:** Senior-level fluency: staging, closed/open-world, the power/comprehensibility budget, reflection-vs-AOT tension, provenance.
- **Required:** Operational experience — you've owned a service's startup time, binary size, build pipeline, or security posture.
- **Required:** Familiarity with at least one production metaprogramming-heavy stack and its operational profile (Spring/JVM startup, serde build times, Go codegen pipelines, Python import-time framework cost).
- **Helpful:** Exposure to AOT/native-image migration, supply-chain security (SLSA, dependency review), or a shared build platform at scale.

You do **not** need:

- To have authored a compiler, native-image substitution, or a macro hygiene algorithm — those are implementation topics elsewhere in this section.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cost model** | The measurable resource price of a technique across build and runtime: CI minutes, binary size, cold-start ms, per-call ns, RSS. |
| **Cold start** | Time from process launch to serving — dominated by reflective scanning, class loading, and JIT warm-up in reflection-heavy stacks. |
| **AOT (ahead-of-time)** | Compiling/closing the world at build time so the runtime does no reflection and starts instantly (GraalVM native-image, Go, Rust). |
| **Closed-world assumption** | The AOT premise that all reachable code is known at build; anything reached only by name must be declared (reflection-config). |
| **Build-time code execution** | Macros, build scripts, and codegen run arbitrary code *during the build* — a supply-chain attack surface. |
| **Supply-chain risk** | Risk from third-party code that executes in your build or runtime, including transitive proc-macros and codegen plugins. |
| **Generated-code governance** | Policies for reviewing, attributing, regenerating, and auditing machine-emitted source. |
| **Provenance / attestation** | Verifiable record of what produced a generated artifact and that it matches its source. |
| **Reflection-config / keep-rules** | Declarations preserving reflectively-reached code under AOT/obfuscation. |
| **Gadget chain** | A deserialization/reflection attack that strings together existing code to achieve RCE (e.g., Java deserialization CVEs). |
| **Build hermeticity** | Whether a build (including codegen) is reproducible and isolated from ambient state. |
| **Policy as code** | Encoding "what metaprogramming is allowed" into lint rules, CI checks, and dependency allowlists. |

---

## Core Concepts

### 1. The Production Cost Model

Every metaprogramming choice has a measurable bill. At scale you must price it, because aggregated over a fleet it dominates real budgets.

| Technique | Build cost | Binary/artifact | Startup | Per-call | Operational note |
|-----------|-----------|-----------------|---------|----------|------------------|
| **Compile-time codegen / derive / templates** | High (build time, CI minutes) | Larger (generated/monomorphized code) | Near-zero | Zero | Pay once in CI; runtime is free. C++ TMP and Rust monomorphization can blow up build time and binary size. |
| **Runtime reflection** | None | Smaller | **High** (scan/load/warm) | **High** | The cold-start tax. Multiplies across serverless invocations and autoscaling. |
| **Dynamic proxies / bytecode-gen** | None–low | Runtime class explosion | Medium | Medium | Generated proxy classes consume metaspace/perm; matters at thousands of beans. |
| **`eval`/`exec`** | None | Smaller | None | High + unsafe | Defeats JIT/AOT; security hole; never in hot paths. |
| **AOT / native-image** | **Very high** | Smaller, static | **Near-zero** | Zero–low | Trades long, complex builds for instant, dense, low-memory runtime. |

The professional insight: **build-time cost is paid once, by CI; runtime cost is paid forever, by every instance, on every request.** At fleet scale this asymmetry almost always favors moving work to build time — which is exactly why the industry is migrating. A 200ms reflective startup is invisible on a long-lived monolith and catastrophic on a 100ms-billed serverless function invoked a billion times a day.

### 2. Metaprogramming Is Arbitrary Code Execution — Treat It as a Security Surface

Metaprogramming is, by definition, code that runs code. That makes every form an attack surface:

- **Build-time:** macros, `build.rs`, annotation processors, codegen plugins, and `setup.py` all **execute arbitrary third-party code on developer machines and in CI**. A malicious transitive proc-macro can exfiltrate secrets from your build environment. This is a *supply-chain* vector, structurally similar to the npm `install` script attacks, and it is under-governed in most organizations.
- **Runtime intercession / reflection:** Java deserialization **gadget chains** are the canonical example — reflection + an open object graph let an attacker assemble existing code into remote code execution (Log4Shell, numerous `readObject` CVEs). Reflection that constructs classes from attacker-controlled strings (`Class.forName(userInput)`) is direct RCE.
- **`eval`/`exec` on untrusted input:** textbook injection. Server-side template engines, expression languages (SpEL, OGNL — the Struts CVEs), and dynamic query builders are repeat offenders.

The professional posture: **metaprogramming capabilities are privileges to be governed, not conveniences to be assumed.** Build-time code execution needs supply-chain controls (pinned, reviewed, allowlisted dependencies; hermetic builds). Runtime reflection over untrusted data needs allowlists and schema validation, never open deserialization.

### 3. The Reflection → AOT Migration (the defining movement)

The single most important production trend in mainstream metaprogramming is the shift from **runtime reflection** to **build-time generation**, driven by operations:

- **Drivers:** serverless cold-start billing, container density (memory per pod), startup-time SLOs, and security (smaller attack surface, no `eval`/open reflection).
- **Manifestations:** GraalVM native-image (close the world, AOT-compile, strip reflection); Spring 6 / Spring Boot 3 **AOT engine** (does at build what classic Spring did via runtime reflection); Quarkus and Micronaut (built from day one to do DI/ORM wiring at compile time); Dagger replacing Guice; Rust/serde and Go codegen as the native-image-free baseline.
- **What it costs to migrate:** every reflective access must become either build-time codegen or a declared keep-rule. Reflection over unknown types must move to closed boundaries. Dynamic proxies become compile-time generated. Libraries that assume a JIT and open world break and must be replaced or patched. The migration is a *whole-dependency-graph* exercise, not a flag flip.

Professionals lead these migrations. The skill is knowing that the migration is fundamentally about **re-closing an open world**: enumerating every place the program reaches code by name and converting it to something a closed-world compiler can see.

### 4. Governing Generated Code at Scale

When a `protoc`/`buf`/`openapi-generator`/macro pipeline emits hundreds of thousands of lines across a monorepo, those lines are *shipped, executed, and security-relevant* — yet rarely reviewed. Governance answers:

- **Review:** is generated code reviewed, or trusted because the generator is trusted? (Usually the latter — so the *generator* and its *inputs* (schemas) become the review boundary.)
- **Reproducibility:** does CI verify that regenerating yields identical output (no drift, no hand-edits to "DO NOT EDIT" files)?
- **Attribution/provenance:** can you trace any generated line to the schema + generator version that produced it? (Critical for CVE response: "which services contain the vulnerable generated stub?")
- **Auditability:** is generated code excluded from human-review metrics but *included* in security scanning (SAST often skips generated files — a blind spot)?

The professional rule: **trust shifts from the output to the input.** You govern the schema, the generator version, and the regeneration check — not 400k lines of output.

### 5. Build Hermeticity and Reproducibility

Metaprogramming that runs at build time can read ambient state (env vars, the clock, the network), making builds non-reproducible and unsafe. Hermetic builds (Bazel-style, pinned toolchains, no network in codegen) are how you make build-time metaprogramming trustworthy and cacheable. A non-hermetic codegen step that hits the network is both a reproducibility bug and a supply-chain risk. At scale, **build-time metaprogramming must be hermetic** or it undermines the entire build platform's guarantees.

### 6. Observability and the Debuggability Tax at Scale

Across a fleet, the debuggability cost of metaprogramming becomes an *operational* cost:

- Stack traces through proxies and generated code must still be triagable by an on-call engineer at 3am who didn't write the framework.
- Provenance (source maps, line tables, checked-in generated code) is the difference between a 10-minute and a 10-hour incident.
- Reflection-heavy frameworks complicate profiling (hot paths hidden in framework reflection) and tracing.

Professionals invest in **provenance and observability as production requirements**, not niceties: error messages that name the annotation/schema, traces that attribute time to the right layer, and the ability to map any runtime failure back to a human-authored, reviewable source.

### 7. Organization-Wide Policy (Policy as Code)

At scale, "should we metaprogram here?" can't be re-litigated per PR. It becomes **policy**:

- An **allowlist** of sanctioned techniques and frameworks (e.g., "compile-time DI only; no runtime classpath scanning in services on the serverless platform").
- **Lint/CI rules** banning `eval`/`exec`, flagging new proc-macro dependencies for security review, requiring regeneration checks, forbidding open deserialization.
- **Dependency review** gates for any dependency that executes at build time.
- **Documented escape hatches** with named owners for the rare justified exception.

Encoding this as enforceable policy-as-code is what keeps metaprogramming's risk bounded across hundreds of engineers who will not all share the senior's judgment.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Build-time vs runtime cost** | Capital expense (build CI: pay once) vs operating expense (runtime: pay every request, forever). At scale, OpEx dominates. |
| **Metaprogramming as code execution** | Giving a contractor a master key to your building: convenient, and exactly why you vet contractors. |
| **Supply-chain risk in macros** | A factory accepting unsealed parts from unaudited suppliers that run on your assembly line. |
| **Reflection → AOT migration** | Replacing a workshop that keeps every tool out "just in case" (slow to start, heavy) with a pre-cut flat-pack (instant, light, but you must decide every cut in advance). |
| **Generated-code governance** | Auditing a printing press: you don't proofread every copy; you certify the plate and verify copies match it. |
| **Build hermeticity** | A clean-room: no contamination from the outside environment, so every run is identical and trustworthy. |
| **Policy as code** | Building codes and inspections: individual judgment doesn't scale to a city, so you codify and enforce. |
| **Provenance at 3am** | A flight recorder: when something fails, you can reconstruct exactly what happened from a verifiable trail. |

---

## Mental Models

### The "CapEx vs OpEx" Model

Price every metaprogramming decision as capital expense (build/CI: paid once) versus operating expense (runtime: paid per instance, per request, forever). On a long-lived monolith, OpEx is amortized and reflection's cost hides. On a serverless or high-density fleet, OpEx is the dominant line item, and the model says: **move work to CapEx (build time).** This is the financial engine behind the whole AOT migration. Run the multiplication — startup ms × invocations × instances — and the answer usually writes itself.

### The "Capability = Privilege" Model

Every metaprogramming mechanism is a *privilege* granted to code: to run at build time, to inspect/rewrite at runtime, to execute strings. Privileges are governed, audited, and minimized — exactly like filesystem or network permissions. A new proc-macro dependency is a new principal with build-machine-level privilege. Model your metaprogramming surface as an access-control problem, and the security posture follows naturally: least privilege, allowlists, audit logs, hermetic sandboxes.

### The "Trust the Input, Verify the Output Matches" Model

You cannot review a million lines of generated code. So move the trust boundary upstream: review the *schema* and the *generator version* (trusted input), and have CI *verify the output deterministically matches* (regeneration check). This is the same model as reproducible builds and container image attestation. It scales; line-by-line review of generated code does not.

### The "Re-Closing the World" Model

An AOT migration is, mentally, the act of *enumerating every door through which the program reaches code by name at runtime* and either bricking it up (codegen) or registering it (keep-rule). Hold the migration as "find all the open-world holes and close them." This makes an otherwise sprawling effort tractable: it's a search-and-close problem over the dependency graph, and tools (native-image's reachability metadata, tracing agents) automate the search.

---

## Code Examples

These reflect *production decisions*: cost, security, migration, governance.

### Java — From Runtime Reflection (slow start) to Build-Time DI (instant)

```java
// CLASSIC: runtime classpath scan + reflection. Open-world, JIT-friendly,
// but pays a startup tax that multiplies across a serverless fleet.
@ComponentScan("com.acme")   // scans, reflects, instantiates AT STARTUP
@Configuration
class AppConfig {}
```

```java
// AOT-ERA: compile-time DI (Dagger/Micronaut/Spring-AOT). The wiring graph
// is GENERATED at build; runtime does zero scanning. Native-image friendly,
// ~ms cold start, smaller attack surface (no open reflection).
@Singleton
class PaymentService {           // wiring resolved by an annotation processor
    @Inject PaymentService(Ledger ledger) { /* ... */ }
}
// Generated DaggerAppComponent wires everything at compile time.
```

The professional point: same DI semantics, two cost models. On a long-lived service, the scan is fine. On a high-invocation serverless platform, the generated graph saves real money — startup ms × billions of invocations. The migration is choosing CapEx over OpEx fleet-wide.

### Rust — The `build.rs` / proc-macro Supply-Chain Surface

```rust
// build.rs runs ARBITRARY CODE on every developer machine and in CI,
// BEFORE your code compiles. A malicious (or compromised) build dependency
// here can read env vars, secrets, the filesystem, the network.
fn main() {
    // legitimate: probe a system library, generate bindings...
    // but this is full code execution with build-environment privileges.
    println!("cargo:rerun-if-changed=schema.json");
}
```

Governance response: pin and review build dependencies; vendor them; run CI builds in a hermetic, network-restricted sandbox; treat *any* new proc-macro or `build.rs`-bearing dependency as a security review trigger. The capability "executes at build time" is a privilege, not a detail.

### Python — `eval` on Untrusted Input Is RCE (and how to refuse it)

```python
# CATASTROPHIC: arbitrary remote code execution.
def compute(expr, ctx):
    return eval(expr, ctx)        # attacker sends "__import__('os').system('...')"

# GOVERNED: a constrained, allow-listed evaluator — no arbitrary code.
import ast, operator
_OPS = {ast.Add: operator.add, ast.Mult: operator.mul, ast.Sub: operator.sub}
def safe_eval(expr):
    def ev(node):
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.BinOp):    return _OPS[type(node.op)](ev(node.left), ev(node.right))
        raise ValueError("unsupported")
    return ev(ast.parse(expr, mode="eval").body)

print(safe_eval("2 * 3 + 4"))   # 10, and nothing else is possible
```

At scale this is policy: a lint rule bans `eval`/`exec`/`compile` outright; the sanctioned pattern is a parsed, allow-listed evaluator. The class of CVE (template/expression injection) is closed by construction, not by vigilance.

### Java — Open Deserialization Gadget Chain (the canonical reflection RCE)

```java
// DANGEROUS: native deserialization reflectively reconstructs an arbitrary
// object graph from bytes. Attacker-crafted bytes assemble existing classes
// ("gadgets") into remote code execution. Root cause of many CVEs.
ObjectInputStream in = new ObjectInputStream(untrustedStream);
Object o = in.readObject();          // reflection + open graph = RCE risk

// GOVERNED: never deserialize untrusted bytes with the native mechanism.
// Use a schema-validated format (JSON/protobuf) with an allow-list of types.
```

The professional knows this isn't an edge case — it's a *class* of vulnerability born directly from runtime reflection over an open object graph, and the policy is categorical: no native deserialization of untrusted input, anywhere in the fleet.

### Go — Governed Codegen With a Regeneration Check

```go
//go:generate buf generate    # emits typed stubs from a schema
// Generated *_pb.go files are checked in AND verified in CI:
//   CI runs `go generate ./...` and fails if `git diff` is non-empty.
// Trust = (reviewed schema) + (pinned generator version) + (drift check).
```

```yaml
# CI step (sketch): the governance, not the generation, is the point.
- run: go generate ./...
- run: git diff --exit-code   # fails if generated code drifted from schema
```

The trust boundary is the schema and the pinned generator, plus a deterministic regeneration check — not human review of the generated stubs. This is generated-code governance in one CI step.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Build-time (CapEx)** | Paid once in CI; zero runtime cost; fast/dense runtime; smaller attack surface; AOT-ready. | Long, complex, sometimes non-hermetic builds; CI minutes; build-time code execution is a supply-chain surface. |
| **Runtime (OpEx)** | Open-world flexibility; minimal build complexity; JIT-friendly. | Cold-start tax × fleet; reflection RCE classes; tooling/observability cost; multiplies across invocations. |
| **Codegen at scale** | Massive boilerplate elimination; deterministic, auditable via input. | Unreviewed shipped lines; SAST blind spots; drift risk; governance overhead. |
| **AOT migration** | Cold-start and memory wins; better security posture. | Whole-dependency-graph effort; breaks reflection-assuming libs; keep-rule maintenance. |
| **`eval`/open reflection** | (rarely justified) ultimate flexibility. | RCE by default; banned in most production policies. |
| **Governance / policy-as-code** | Bounds risk across the org; consistent, auditable. | Upfront investment; friction; needs ownership and escape hatches. |

---

## Use Cases

Production-grade decisions:

- **Serverless / high-density platforms:** mandate build-time DI/ORM/serialization (AOT, codegen, derive). Runtime reflection's cold-start tax is the dominant cost; eliminate it by policy.
- **Long-lived monoliths with rich plugin ecosystems:** runtime reflection is acceptable — startup amortizes and open-world flexibility has real value. Don't over-engineer an AOT migration with no operational payoff.
- **Schema-driven service meshes (gRPC, GraphQL):** codegen pipelines with regeneration checks, pinned generators, and provenance for CVE response.
- **Security-sensitive boundaries (anything touching untrusted input):** categorically ban `eval`/`exec` and native deserialization; allow-list types; validate schemas.
- **Shared build platforms:** enforce hermetic, sandboxed, network-restricted build-time code execution; gate new build-time dependencies through security review.
- **Fleet-wide observability:** require provenance (source maps, line tables, checked-in generated code) so incidents through metaprogrammed layers are triagable on-call.

The meta-use-case: **set policy per platform, calibrated to that platform's cost model and threat model** — not one rule for the whole company, but a deliberate rule per operational context.

---

## Coding Patterns

### Pattern 1: Price it, then place it

Before adopting a technique at scale, compute the cost model: build minutes, binary size, startup ms × fleet invocations, per-call ns, memory. Place the work at the stage the numbers favor — at scale, almost always build time for hot/startup paths.

### Pattern 2: Govern the input, verify the output

For all codegen: review the schema + pin the generator, and enforce a deterministic regeneration check in CI. Don't try to review the output; make divergence impossible to merge.

### Pattern 3: Sandbox build-time code execution

Run macros, `build.rs`, annotation processors, and codegen in hermetic, network-restricted environments. Treat every build-time-executing dependency as a privileged principal requiring review.

### Pattern 4: Ban the RCE classes by policy-as-code

Lint-fail `eval`/`exec`/`compile` and native deserialization of untrusted input. Replace with allow-listed evaluators and schema-validated formats. Close the vulnerability class by construction, not vigilance.

### Pattern 5: Re-close the world incrementally for AOT

Migrate to AOT by tracing reachability, enumerating every name-based reflection site, and converting each to codegen or a registered keep-rule — automated by reachability-metadata tooling. Treat it as search-and-close over the dependency graph.

### Pattern 6: Make provenance an SLO

Require that any metaprogrammed layer (proxy, generated code, reflective framework) preserves a path from runtime failure to human source. Bake it into framework-selection criteria and incident-readiness reviews.

---

## Best Practices

- **Run the CapEx/OpEx multiplication.** Startup ms × invocations × instances. At fleet scale, move hot/startup metaprogramming to build time; let long-lived services keep runtime flexibility where it pays.
- **Treat metaprogramming as a privilege, not a convenience.** Build-time code execution and runtime reflection are capabilities to govern with least-privilege, allowlists, and audit.
- **Categorically ban the RCE classes.** No `eval`/`exec` on untrusted input; no native deserialization of untrusted bytes. Enforce via policy-as-code, not code review.
- **Govern generated code by its input.** Review schemas + pin generators + verify deterministic regeneration in CI. Don't ship drift; don't pretend to review 400k lines.
- **Make build-time metaprogramming hermetic.** No network, pinned toolchains, reproducible output — or it undermines the build platform's trust and caching.
- **Don't let SAST skip generated code.** Generated files are a common scanning blind spot; ensure security tooling covers them.
- **Invest in provenance as a production requirement.** Source maps, line tables, checked-in artifacts, error messages that name the schema/annotation — incident MTTR depends on it.
- **Lead AOT migrations as world-closing exercises.** Enumerate and close every name-based reflection site; replace reflection-assuming dependencies; own the keep-rules.
- **Encode the policy.** Allowlist sanctioned techniques per platform, with lint/CI enforcement, dependency-review gates, and documented, owned escape hatches.

---

## Edge Cases & Pitfalls

- **Cold-start tax invisible in load tests, ruinous in production.** Warm long-lived test instances hide reflective startup cost; serverless prod pays it every invocation. Measure cold, not warm.
- **Transitive proc-macro / build-script compromise.** A deep dependency that executes at build time can exfiltrate CI secrets. Most orgs review runtime deps but not build-time-executing ones — a major gap.
- **Generated code excluded from security scanning.** SAST/secret-scanners frequently skip "generated" paths, so a vulnerable generated stub ships unscanned. Explicitly include generated code in scans.
- **AOT migration breaks reflection-assuming libraries.** A single transitive dependency that does open reflection can block native-image; you discover it late, at link time, with cryptic reachability errors.
- **Reflection-config drift.** Keep-rules hand-maintained against an evolving codebase silently rot; a renamed class reached by an unupdated keep-rule fails only in the AOT artifact, in production.
- **Non-hermetic codegen.** A generator that reads the clock, env, or network produces non-reproducible builds and a supply-chain hole; cache poisoning and irreproducible incidents follow.
- **Proxy/metaspace explosion.** Thousands of runtime-generated proxy classes inflate JVM metaspace and GC; a scaling cliff that doesn't appear until bean count grows.
- **Expression-language injection (SpEL/OGNL/templates).** Frameworks that evaluate expressions on user-influenced strings are repeat CVE sources (Struts, Spring SpEL); treat any runtime expression evaluation over user input as RCE until proven otherwise.
- **"It's just generated, no one edits it" — until someone does.** A hand-edit to a "DO NOT EDIT" file survives because there's no regeneration check; the next regen silently reverts it, or worse, the drift hides a backdoor.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│        METAPROGRAMMING AT PRODUCTION SCALE (professional)             │
├──────────────────────────────────────────────────────────────────────┤
│ COST MODEL — CapEx vs OpEx                                           │
│   build-time = CapEx (paid once in CI)                              │
│   runtime    = OpEx  (paid per instance, per request, FOREVER)      │
│   at fleet scale: startup_ms × invocations × instances → move work  │
│   UPSTREAM to build time. (drives the whole AOT migration.)         │
├──────────────────────────────────────────────────────────────────────┤
│ SECURITY — metaprogramming IS arbitrary code execution              │
│   build-time : macros / build.rs / APT run code in CI → supply chain│
│   runtime    : eval/exec on untrusted input = RCE                   │
│                native deserialization = gadget-chain RCE            │
│                Class.forName(userInput) = RCE                        │
│   → ban RCE classes by POLICY-AS-CODE, not code review.             │
├──────────────────────────────────────────────────────────────────────┤
│ GENERATED-CODE GOVERNANCE                                           │
│   trust the INPUT (schema + pinned generator),                      │
│   VERIFY the output matches (deterministic regen check in CI).      │
│   include generated code in SAST. don't review 400k lines.          │
├──────────────────────────────────────────────────────────────────────┤
│ AOT MIGRATION = RE-CLOSING THE WORLD                                │
│   enumerate every name-based reflection site → codegen or keep-rule │
│   expect reflection-assuming libs to break. own the keep-rules.     │
├──────────────────────────────────────────────────────────────────────┤
│ ALSO: hermetic build-time codegen · provenance as an SLO ·          │
│       per-PLATFORM policy (serverless ≠ monolith).                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- At production scale, metaprogramming is an **operational, security, and governance** property — not a coding technique. Your decisions carry a P&L and a threat model.
- **Cost model — CapEx vs OpEx:** build-time work is paid once by CI; runtime work (reflection, proxies, `eval`) is paid by every instance on every request, forever. At fleet scale this asymmetry drives work upstream — the financial engine behind the **reflection → AOT migration** (native-image, Spring-AOT, Quarkus, Micronaut, Dagger).
- **Metaprogramming is arbitrary code execution.** Build-time (macros, `build.rs`, APT, codegen) is a *supply-chain* surface running on dev/CI machines. Runtime (`eval`, open deserialization, `Class.forName(userInput)`) is a *direct RCE* surface. Govern capabilities as privileges; ban the RCE classes by policy-as-code.
- **Govern generated code by its input:** review the schema, pin the generator, verify deterministic regeneration in CI, and include generated code in security scanning. Trust the input and verify output-match; don't review the output line by line.
- **AOT migration = re-closing an open world:** enumerate every name-based reflection site and convert it to codegen or a declared keep-rule; expect reflection-assuming dependencies to break.
- **Build-time metaprogramming must be hermetic** (no network, pinned, reproducible) or it undermines the build platform's trust.
- **Provenance is a production SLO:** source maps, line tables, checked-in artifacts, and error messages that name the schema/annotation determine incident MTTR through metaprogrammed layers.
- **Encode it as policy per platform:** serverless and monolith have different cost and threat models, so allowlist sanctioned techniques per context with lint/CI enforcement, dependency-review gates, and owned escape hatches.

---

## Diagrams & Visual Aids

### CapEx vs OpEx at Fleet Scale

```text
  BUILD-TIME (CapEx)                 RUNTIME (OpEx)
  ──────────────────                 ──────────────
  paid ONCE in CI                    paid PER instance × PER request × FOREVER
        │                                  │
  codegen, derive,                   reflection scan, proxy gen,
  templates, AOT                     eval, dynamic dispatch
        │                                  │
        ▼                                  ▼
  cost = CI minutes (fixed)          cost = startup_ms × invocations × instances
                                     ───────────────────────────────────────────
                          AT SCALE, OpEx DOMINATES → move work UPSTREAM (to build)
```

### Metaprogramming as Attack Surface

```text
                    metaprogramming = code that runs code
                                 │
              ┌──────────────────┴───────────────────┐
              ▼                                       ▼
        BUILD-TIME                                RUNTIME
        macros / build.rs / APT / codegen         eval / exec, deserialization,
              │                                   Class.forName(userInput)
        runs on DEV + CI machines                       │
        → SUPPLY-CHAIN RCE                        → DIRECT RCE / gadget chains
              │                                         │
        mitigate: pin, review, vendor,            mitigate: ban by policy,
        hermetic sandbox, dep-review gate         allow-list, schema-validate
```

### Generated-Code Governance (trust the input)

```text
   SCHEMA  ──pinned generator──►  GENERATED CODE (400k lines)
     ▲                                   │
   REVIEW THIS                    don't review this line-by-line
     │                                   │
     └──────────── CI: regenerate + `git diff --exit-code` ─────────┘
                   (deterministic match = no drift, no hand-edits)
                   + include generated code in SAST
```

### Reflection → AOT: Re-Closing the World

```text
   OPEN WORLD (reflection, JIT)               CLOSED WORLD (AOT, native-image)
   ───────────────────────────               ─────────────────────────────────
   Class.forName(...)                         enumerate every name-based site
   readObject()                                       │
   @ComponentScan reflection         ──migrate──►  convert → codegen
        │                                            or register → keep-rule
   high cold start, RCE surface                       │
                                              ms cold start, smaller surface
                            (whole-dependency-graph effort; libs may break)
```

### Per-Platform Policy

```text
   SERVERLESS / HIGH-DENSITY            LONG-LIVED MONOLITH
   ─────────────────────────           ───────────────────
   cost model: OpEx dominates          cost model: startup amortized
   threat: cold-start tax, surface     value: open-world plugin flexibility
        │                                   │
   POLICY: build-time DI/codegen,      POLICY: runtime reflection OK,
   ban runtime scanning, AOT           still ban eval/open-deserialization
        └───────────── ONE COMPANY, DIFFERENT POLICIES ──────────────┘
```
