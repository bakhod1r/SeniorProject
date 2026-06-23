# Wasm in Production — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Decision: When Wasm Earns Its Weight (and When It Does Not)](#the-decision-when-wasm-earns-its-weight-and-when-it-does-not)
3. [Browser Wasm as a Page-Weight Budget Line](#browser-wasm-as-a-page-weight-budget-line)
4. [Server-Side Wasm as an Isolation Boundary, Not a Plugin Convenience](#server-side-wasm-as-an-isolation-boundary-not-a-plugin-convenience)
5. [Architecting a Plugin System Around wazero](#architecting-a-plugin-system-around-wazero)
6. [Multi-Tenancy: Fairness, Noisy Neighbours, and Pooling](#multi-tenancy-fairness-noisy-neighbours-and-pooling)
7. [The Capability Threat Model](#the-capability-threat-model)
8. [Edge / Serverless Economics: Cold Start vs Containers](#edge--serverless-economics-cold-start-vs-containers)
9. [Observability Across the Host/Guest Boundary](#observability-across-the-hostguest-boundary)
10. [Rollout and Rollback of a Wasm Artefact](#rollout-and-rollback-of-a-wasm-artefact)
11. [Supply Chain for Wasm Modules](#supply-chain-for-wasm-modules)
12. [Honest Limitations You Must Design Around](#honest-limitations-you-must-design-around)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer's question is never "can we ship Wasm" — the junior and middle files answered that. It is "what does Wasm buy us that the boring alternative does not, and what does it cost the team over the next two years." Wasm in production is a *systems* decision: a page-weight commitment in the browser, an isolation boundary on the server, an operability surface in both.

This file is about judgement and architecture. The mechanics live in [middle.md](middle.md); the toolchain internals in [professional.md](professional.md).

After reading this you will:
- Decide between Wasm and its alternatives from first principles, per use case
- Architect a wazero-based plugin/policy system with a defensible isolation model
- Reason about multi-tenant fairness, the capability threat model, and supply chain
- Size up edge cold-start economics honestly against containers
- Make Wasm observable, versioned, and rollback-able like any other artefact

---

## The Decision: When Wasm Earns Its Weight (and When It Does Not)

Wasm is justified by exactly two properties that are otherwise hard to get: **portable near-native compute in a host you do not control** (the browser), and **in-process isolation of code you do not trust** (the server). Map every proposal onto one of those, or reject it.

| Use case | Wasm earns it? | The alternative it must beat |
|----------|----------------|------------------------------|
| Client-side image/video processing | Yes | Server round-trips (latency, privacy, cost), or hand-tuned JS/WebGPU |
| In-browser data tool (CSV/Parquet, query engine) | Yes | Shipping data to a server; a slower pure-JS engine |
| Sharing one validation/parsing lib client+server | Often | Re-implementing the logic twice and watching it drift |
| Untrusted/customer plugins on the server | Yes | Containers/VMs per plugin (slow, heavy), or a bespoke interpreter |
| Policy engine (OPA-style) | Yes | A custom rule DSL + evaluator you now maintain |
| Sandboxed user-code execution (coding platform) | Yes | gVisor/Firecracker microVMs (heavier, slower cold start) |
| Ordinary CRUD, forms, server-rendered pages | **No** | Plain HTML/JS — the runtime weight buys nothing |
| A little interactivity | **No** | A few KB of JavaScript |
| Server logic *you* wrote and trust | **No** | A normal Go package — no sandbox needed |

The discriminating question for the server side: **do you need to run code you did not write?** If yes, Wasm's in-process sandbox is uniquely cheap. If no, you are paying the boundary's cost (serialization, limited interface, debugging friction) for isolation you do not need — use a plain function call.

For the browser, the discriminating question is: **is there real compute, and is keeping data on-device valuable?** "Faster than JS" is rarely true once you amortize a multi-megabyte download over a session; the durable wins are CPU-bound work and privacy.

---

## Browser Wasm as a Page-Weight Budget Line

Treat the `.wasm` as a first-class entry in the performance budget, alongside the JS bundle and images. A ~1.5 MB compressed module is a large allocation; it must be justified against Core Web Vitals and the project's performance budget.

Senior framing:

- **Amortize over the session, not the page.** A 1.5 MB download that powers a 10-minute editing session is cheap per-interaction; the same download for a feature touched once is not. Lazy-load (middle.md) so only engaged users pay.
- **Keep Wasm off the critical rendering path.** It must never block first paint or interactivity. Render the shell, then load the module on interaction, with prefetch during idle for likely-needed routes.
- **Budget the runtime floor explicitly.** Standard Go cannot go below ~2 MB raw. If the budget cannot absorb that, the decision is TinyGo (sibling [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/senior.md)) or not-Wasm — decide before building, not after.
- **One module, many features, beats many modules.** Each module re-pays the runtime floor. Consolidate client-side Wasm features into one binary where they share a session.

The frontend-performance discipline (LCP/INP/CLS, prefetch, code-splitting) applies unchanged; Wasm is just a heavy split point.

---

## Server-Side Wasm as an Isolation Boundary, Not a Plugin Convenience

The common mistake is treating wazero as "a plugin loader." Its real value is the **isolation boundary**: a guest cannot read host memory, files, sockets, env, or clock unless the host hands it that capability. That is a security property, and you should architect *toward* it, not merely tolerate it.

This reframes design:

- The host/guest interface is a **trust boundary**, so treat everything crossing it as untrusted input — validate guest outputs, bound guest resource use, never `panic` the host on a guest trap.
- The set of host functions you export *is your attack surface*. Every capability you grant is a thing a malicious guest can attempt to abuse. Minimise it; review additions like you review new API endpoints.
- Per-request instance isolation (fresh linear memory per call) is what makes multi-tenancy safe. State that bleeds across instances is a tenant-isolation bug, not a performance optimization.

The alternative isolation technologies — containers, gVisor, Firecracker microVMs, separate processes — all impose process/OS boundaries with their own cold-start and memory cost. Wasm's selling point is isolation *in the same process, at function-call latency*. That is the thing to defend in design review.

---

## Architecting a Plugin System Around wazero

A production plugin/policy system on [wazero](https://wazero.io) has these layers:

1. **The interface contract.** Define the host functions the guest may import and the functions the guest must export, as a documented, versioned ABI. For Go-built guests this is `//go:wasmexport` (Go 1.24+) for guest exports and `//go:wasmimport` for the host functions it calls. Treat this like a wire protocol.

2. **The loader / registry.** Compile each guest module *once* at registration (CompileModule), store the compiled artefact keyed by a content digest, and record metadata (version, source, owner). Validate at load: compile must succeed, exports must match the contract, a smoke invocation must pass.

3. **The execution layer.** Per invocation, instantiate a fresh module from the compiled artefact, with a per-call memory cap and context deadline. Marshal input into guest memory, call the exported entry point, read output back, close the instance.

4. **The capability layer.** Inject host functions scoped to *this* tenant/invocation — a logger tagged with the tenant ID, a key-value reader bounded to that tenant's namespace, a clock the host controls. Never hand the guest an ambient capability.

5. **The policy/limits layer.** Per-tenant quotas: max memory pages, max wall-clock per call, max calls per second (rate limiting), and ideally an instruction budget for finer fairness (professional.md).

```go
type Plugin struct {
	Digest   string                 // content address; the version
	Compiled wazero.CompiledModule   // compiled ONCE at registration
	Limits   Limits                  // mem pages, deadline, rate
}

func (p *Plugin) Invoke(ctx context.Context, tenant string, in []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, p.Limits.Deadline)
	defer cancel()
	mod, err := rt.InstantiateModule(ctx, p.Compiled,
		moduleConfigFor(tenant, p.Limits)) // scoped host fns + mem cap
	if err != nil { return nil, err }
	defer mod.Close(ctx)
	return callGuest(ctx, mod, in)         // marshal in, call, marshal out
}
```

The OPA / policy-engine case is this exact shape: a policy compiles to Wasm, the host evaluates it against an input document, the host trusts nothing the policy returns beyond a decision.

---

## Multi-Tenancy: Fairness, Noisy Neighbours, and Pooling

Running many tenants' guests in one host raises the classic noisy-neighbour problems, now inside a single process.

- **CPU fairness.** A guest's tight loop steals a host OS thread until its deadline trips. With many tenants, set short per-call deadlines and cap concurrency per tenant (a semaphore), so one tenant cannot monopolise the worker pool. Instruction-budget metering gives finer fairness than wall-clock alone.
- **Memory pressure.** Each live instance holds its linear memory. `instances × max-pages` is your worst-case host memory; size the instance concurrency limit so that product stays within the host's headroom. A per-tenant memory cap is both a security and a capacity control.
- **Compilation cost.** Compiling is expensive; instantiation is cheap. Compile-once-per-module amortizes it. Do **not** pool *instances* across tenants — a pooled instance carries residual memory state and breaks isolation. Pool the *compiled module* (shared, immutable, safe); create instances fresh.
- **Cold vs warm.** wazero's optimizing compiler has higher first-compile cost but faster execution; for short-lived, rarely-called guests the interpreter may be cheaper overall. Choose per workload and measure.

The mental model: **share the immutable compiled artefact; isolate the mutable instance.**

---

## The Capability Threat Model

Build an explicit threat model for untrusted modules. The guest is the adversary; enumerate what it can attempt and what stops it.

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Read host memory / other tenants' data | Out-of-bounds memory access | Wasm's bounds-checked linear memory; fresh instance per call |
| Exhaust CPU (DoS) | Infinite/heavy loop | Context deadline + `WithCloseOnContextDone`; instruction budget; per-tenant concurrency cap |
| Exhaust memory (DoS) | `memory.grow` to gigabytes | `WithMemoryLimitPages`; worst-case `instances × cap` sized to host |
| Exfiltrate data | Calling a host function to send data out | Grant no network/IO capability by default; scope every host fn to the tenant |
| Escape the sandbox | Exploit a runtime bug | Keep wazero current; defense-in-depth (run the host itself with least privilege, seccomp, a separate process for highest-risk tenants) |
| Supply-chain compromise | Malicious/trojaned module accepted | Sign + verify modules; pin digests; review the source for first-party guests |
| Resource amplification | Many cheap calls | Rate-limit per tenant; bill/quota guest invocations |

Two senior principles. First, **deny by default is the design, not a setting**: an empty capability set is the baseline; every grant is a deliberate, reviewed widening of attack surface. Second, **the sandbox is one layer, not the whole defense**: combine it with OS-level least privilege on the host process so a hypothetical runtime escape lands in a constrained environment.

(Browser Wasm has a *different* threat model — it lives in the browser's existing sandbox, same-origin policy, no raw sockets — the user is protected from the page, not the page from the user. Do not conflate the two boundaries.)

---

## Edge / Serverless Economics: Cold Start vs Containers

The edge pitch is cold start. A container cold start is hundreds of milliseconds to seconds (image pull, namespace setup, runtime boot). A Wasm module instantiates in microseconds-to-low-milliseconds from a pre-compiled artefact. For spiky, per-request, globally-distributed workloads that is a real economic difference: no warm-pool overprovisioning, dense packing of many tenants per node, fast scale-to-zero.

Honest counterweights:

- **Compilation is the hidden cold start.** First *compile* of a module is expensive; platforms cache compiled artefacts to keep instantiation fast. Your cold-start win assumes that cache is warm.
- **`wasip1` has no sockets.** Edge network IO goes through platform host functions (HTTP via a provided API), not `net.Dial`. Architect around a constrained IO model. (See [02-wasi-and-wasip1](../02-wasi-and-wasip1/senior.md).)
- **Standard Go vs TinyGo.** Fastly Compute and Spin run `wasip1` (standard Go works); component-model platforms (wasmCloud) and size-tight ones lean TinyGo today. Confirm before committing.
- **Binary size still matters at the edge.** A multi-MB module replicated across hundreds of POPs has distribution cost; this is another point in TinyGo's favour for edge.

Use Wasm at the edge when cold start and density dominate your cost; stay on containers when you need full POSIX, sockets, or a large dependency surface.

---

## Observability Across the Host/Guest Boundary

The boundary is opaque by default — a guest trap surfaces to the host as one Go `error`. Build observability deliberately.

- **Logging from the guest** goes through a host function (the guest cannot write stdout meaningfully in a sandbox). Tag every guest log line with the module digest and tenant so logs are attributable.
- **Propagate structured errors, not just traps.** Define an error channel in the ABI (a return code + an error buffer the host reads) so the guest can report *why* it failed, distinct from a hard trap. Map guest traps (OOB, unreachable, deadline) to typed host errors.
- **Metrics per module/tenant:** invocation count, p50/p99 latency, deadline-trip rate, memory-cap-hit rate, error rate. These are your fairness and health signals; alert on deadline-trip and cap-hit spikes (a sign of a hostile or buggy guest).
- **Tracing across the boundary:** start a span at host invocation, annotate it with module version and outcome; the guest is a black box span unless you instrument host functions it calls.
- **Always record which artefact handled the request** (digest/version) so you can correlate an incident to a specific rollout.

---

## Rollout and Rollback of a Wasm Artefact

A `.wasm` is a versioned, content-addressed artefact — give it a deployment lifecycle.

- **Browser:** the content hash is the version; rollback re-points the manifest at the previous hash (still cached/CDN-resident) — instant, no rebuild.
- **Server guest:** register by digest, gate promotion behind validation (compile + contract check + smoke call), and roll out gradually — canary the new module to a fraction of invocations, watch the per-module metrics, promote or roll back by flipping the active digest. Keep N previous versions loadable.
- **ABI versioning:** the host-function contract and guest-export contract form an interface. A breaking change to either requires a coordinated rollout (host supports both old and new ABI during transition) or you strand guests. Treat ABI changes like API versioning.

---

## Supply Chain for Wasm Modules

A `.wasm` you load is code you execute — apply full supply-chain discipline.

- **Provenance.** Know who built each module and from what source. For first-party guests, build them in your pipeline and record the source commit. For third-party/customer modules, you cannot trust the source — that is *why* you sandbox.
- **Integrity.** Address modules by content digest; verify the digest before loading. Sign artefacts and verify signatures where the supply chain warrants it.
- **The guest's own dependencies.** A Go-built guest has its own `go.mod` graph — it inherits all the usual module supply-chain concerns (govulncheck, pinned versions, SBOM) *before* it becomes a `.wasm`.
- **Defense even for "trusted" modules.** Sandbox and limit first-party guests too; a compromised build pipeline should not get ambient host capabilities.

---

## Honest Limitations You Must Design Around

- **Binary size (standard Go).** ~2 MB floor; multi-MB real apps. Mitigate with compression and lazy-load; escape only via TinyGo.
- **No threads in the browser.** Goroutines run cooperatively on one thread under `GOOS=js`; no parallelism. CPU-bound parallel work needs Web Workers (multiple instances) or WebGPU.
- **`wasip1` networking.** No sockets; IO via host functions. Not a drop-in for a networked Go service.
- **Debugging.** Stack traces, source maps, and profilers are less mature than native. Budget extra debugging time; invest in host-side observability to compensate.
- **GC and memory model.** Each instance carries the Go runtime + GC; many concurrent instances multiply that cost. The component model and WASI GC are evolving but not yet a free lunch for standard Go.
- **Ecosystem churn.** The component model, WASI preview 2, and platform support move fast. Pin versions and revisit decisions; do not build on a preview you cannot afford to migrate off.

---

## Anti-Patterns

- **Wasm as a résumé line.** Adopting it for a CRUD app with no compute and no untrusted code. Reject in design review.
- **Recompiling the guest per request.** Throws away the whole server-side performance story.
- **Pooling guest *instances* across tenants.** Breaks isolation; residual memory leaks data.
- **Unbounded guests.** No memory cap or no enforceable deadline = a DoS you shipped on purpose.
- **Growing the host-function surface casually.** Every export is attack surface; treat additions like new public API.
- **Unhashed `main.wasm` with long cache.** Strands users on stale code.
- **Treating the boundary as trusted.** Failing to validate guest output or letting a guest trap crash the host.
- **Ignoring the runtime floor until after build.** Discovering the 2 MB floor blows your budget post-implementation.

---

## Senior-Level Checklist

You can move on to [professional.md](professional.md) when you can:

- [ ] Justify (or reject) Wasm per use case against the boring alternative
- [ ] Treat browser Wasm as a budgeted, lazy-loaded, off-critical-path split point
- [ ] Frame server-side wazero as an isolation boundary and architect toward it
- [ ] Design a 5-layer wazero plugin system (contract, registry, execution, capability, limits)
- [ ] Reason about multi-tenant fairness, pooling the compiled module but not instances
- [ ] Write an explicit capability threat model with mitigations
- [ ] Size edge cold-start economics honestly against containers, including the compile-cache caveat
- [ ] Make the host/guest boundary observable (logs, structured errors, per-tenant metrics)
- [ ] Roll out and roll back both browser and server Wasm artefacts, including ABI versioning
- [ ] Apply supply-chain discipline (provenance, digest pinning, signing) to modules

---

## Summary

At senior level, Wasm in production is a systems decision with exactly two justifications: portable near-native compute in a host you don't control (the browser) and in-process isolation of code you don't trust (the server). In the browser it is a budgeted, lazy-loaded page-weight line that must amortize its multi-megabyte runtime floor over a session and stay off the critical path. On the server, [wazero](https://wazero.io) is an *isolation boundary*, not a plugin convenience: architect a layered plugin/policy system that compiles each module once, instantiates a fresh isolated instance per call, scopes every capability through host functions, and enforces memory + deadline + concurrency limits per tenant. Multi-tenancy means sharing the immutable compiled artefact while isolating the mutable instance, governed by an explicit capability threat model and supply-chain controls. Edge Wasm wins on cold start and density where `wasip1`'s socket-less IO model fits, with TinyGo filling the size-and-component-model gaps. Throughout, make the opaque host/guest boundary observable, version the artefact by content digest, and remember the honest limits — size, no browser threads, no `wasip1` sockets, immature debugging — and that most applications need none of this.
