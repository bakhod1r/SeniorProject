# TinyGo for Wasm & Embedded — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Compatibility Decision: First Principles](#the-compatibility-decision-first-principles)
3. [The Standard-Library Subset](#the-standard-library-subset)
4. [`reflect` Limitations and the Serialization Cliff](#reflect-limitations-and-the-serialization-cliff)
5. [The Scheduler and the Concurrency Model](#the-scheduler-and-the-concurrency-model)
6. [Garbage Collection Strategy](#garbage-collection-strategy)
7. [Failure Modes Teams Actually Hit](#failure-modes-teams-actually-hit)
8. [Testing Strategy for Embedded and Edge](#testing-strategy-for-embedded-and-edge)
9. [Architecture for IoT Fleets and Edge Functions](#architecture-for-iot-fleets-and-edge-functions)
10. [Binary Size vs Maintainability](#binary-size-vs-maintainability)
11. [Team and Organizational Considerations](#team-and-organizational-considerations)
12. [TinyGo vs `gc` vs C/Rust](#tinygo-vs-gc-vs-crust)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with TinyGo is not "can it compile my Go" but "which subset of Go am I willing to commit to, for how long, and what does it cost the team when I find the edge." TinyGo is an LLVM-based alternative compiler for the Go *language*, not a drop-in replacement for the official `gc` toolchain. It produces kilobyte-scale WebAssembly and bare-metal microcontroller firmware that the standard toolchain cannot. In exchange it implements a *subset* of the language and standard library, with a different runtime, a different scheduler, and a different garbage collector.

The decision to adopt TinyGo is a compatibility-and-risk decision, not a performance tuning exercise. The mechanics of installing TinyGo, flashing a board, and building a `wasm` module are in [junior.md](junior.md) and [middle.md](middle.md). This file is about *when the tradeoffs are acceptable, when they are not, and how to keep a team out of trouble*.

After reading this you will:
- Decide whether TinyGo's subset is acceptable for a given workload, or whether to stay on `gc` (or drop to C/Rust)
- Recognize the concrete failure modes — `reflect`-dependent libraries, unsupported packages, goroutine assumptions, GC behaviour — before they reach production
- Design a testing strategy that does not depend on having hardware in every CI run
- Make fleet and edge-function architecture decisions that survive a TinyGo limitation discovered late
- Avoid the anti-patterns that turn TinyGo from an enabling technology into a maintenance liability

This sits alongside [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/), [02-wasi-and-wasip1](../02-wasi-and-wasip1/), [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/), and [05-wasm-in-production](../05-wasm-in-production/). TinyGo is the compiler that makes the *small* and *bare-metal* ends of those topics reachable.

---

## The Compatibility Decision: First Principles

TinyGo is a tool with a specific shape. The decision is downstream of two questions: *can my code (and its dependency tree) run on the TinyGo subset?* and *do I actually need what TinyGo uniquely provides?*

### What TinyGo uniquely buys you

Neither of these is achievable with the official `gc` toolchain:

1. **Kilobyte-scale binaries.** A `gc`-compiled `wasm` module starts in the megabytes because it ships the full Go runtime and GC. TinyGo produces modules measured in tens of kilobytes. For edge runtimes with cold-start and size limits, this is the difference between viable and not.
2. **Bare-metal targets.** TinyGo can target microcontrollers directly through its `machine` package — GPIO, I2C, SPI, ADC, PWM on hundreds of boards — with no operating system. The `gc` toolchain has no concept of this.

### What TinyGo costs you

- **A standard-library subset.** Many packages are unsupported or partial. Code that compiles under `gc` may not compile under TinyGo, and the failure can be deep in a transitive dependency.
- **Limited `reflect`.** This breaks `encoding/json` on non-trivial types and a large class of serializers, ORMs, and validation libraries that lean on reflection.
- **A different concurrency model.** The scheduler is cooperative; there is no true parallelism and no meaningful `GOMAXPROCS`. Code that assumes preemptive scheduling or multi-core can deadlock or starve.
- **A different GC.** Conservative by default, with `leaking` and `precise` alternatives, each with its own correctness and memory implications.
- **Slower compiles and weaker tooling.** LLVM-based builds are slower than `gc`; the debugging and profiling story is thinner.
- **Not 100% spec-compliant in corner cases.** Subtle behavioural differences exist. You are programming a dialect, not the language.

### When the answer is yes

- You target a microcontroller and there is no realistic alternative in Go.
- You target an edge runtime (Fastly Compute, some Cloudflare Workers Go-via-`wasm` paths) where module size and cold-start dominate.
- Your code is computational and self-contained: parsing, transformation, signal processing, control loops — work that does not lean on the reflective, networked, multi-core parts of the standard library.
- You can constrain the dependency tree to packages known to work under TinyGo, and you are willing to vendor or fork the ones that do not.

### When the answer is no

- Your service is a conventional server: it benefits from `gc`'s mature runtime, true parallelism, the full standard library, and the broad library ecosystem. There is no size or bare-metal constraint forcing TinyGo.
- Your code depends on reflection-heavy libraries you do not control (most JSON-over-the-wire stacks, gRPC, many database drivers, validation frameworks).
- You need preemptive scheduling guarantees or multi-core throughput.
- The team cannot absorb the debugging and tooling cost (see [Team Considerations](#team-and-organizational-considerations)).

### When the answer is "yes, for this module only"

The most defensible adoption pattern: isolate the TinyGo target behind a narrow, well-tested boundary — a single `wasm` module or a single firmware image with a small, audited dependency set — while the rest of the system stays on `gc`. The blast radius of a TinyGo limitation is then one component, not the architecture.

---

## The Standard-Library Subset

TinyGo implements a subset of the Go standard library. The subset is large enough to be useful and incomplete enough to surprise you.

### How the subset bites

The compatibility failure is rarely in *your* code. It is in a transitive dependency that imports a package TinyGo does not support, or supports only partially. The build fails — or worse, links and then misbehaves — far from where you wrote anything.

Common trouble spots:
- `net` and `net/http` are partial-to-unsupported depending on target. A library that "just makes an HTTP call" can pull in unsupported code.
- `os`, `os/exec`, `syscall` have target-specific gaps — what works on `wasip1` differs from what works on a bare-metal target.
- `reflect` is limited (its own section below), which cascades into `encoding/json`, `encoding/xml`, `text/template`, and anything reflective.
- `crypto/*` support is uneven and target-dependent.

### The senior discipline: audit the dependency closure

Before committing to TinyGo for a component, build the *entire* dependency closure under TinyGo, not just your top-level code. A dependency that compiles today can break when it bumps a transitive version that newly imports an unsupported package. Treat "compiles under TinyGo" as a CI invariant, not a one-time check.

### The escape hatches

- **Pin and vendor.** Lock the dependency tree so an upstream change cannot silently introduce an unsupported import. (See the vendoring treatment in the sibling code-organization topics.)
- **Fork-and-shim.** Replace a reflection-heavy dependency with a TinyGo-compatible alternative, or fork it to strip the unsupported path.
- **Build tags.** Use `//go:build tinygo` to provide a TinyGo-specific implementation of a package boundary, with the `gc` implementation behind the inverse tag. This keeps host-side tests on `gc` while the deployed artefact uses the constrained path.

---

## `reflect` Limitations and the Serialization Cliff

The single most common reason teams abandon TinyGo mid-project is reflection.

### Why it matters

TinyGo's `reflect` is limited. It does not implement the full reflection surface that `gc` provides. The most visible casualty is `encoding/json`: it works for simple, statically-shaped types and fails or misbehaves on complex types — interfaces, deeply nested structures, custom marshalers exercised through reflection, maps with interesting value types.

This is not a JSON problem; it is a reflection problem with JSON as its most popular victim. The same cliff catches:
- gRPC and protobuf runtimes that use reflection.
- ORMs and query builders that map structs to rows reflectively.
- Validation libraries driven by struct tags.
- Generic serialization, config binding, and dependency-injection frameworks.

### The senior response

- **Prefer code generation over reflection.** Generate marshal/unmarshal code (e.g. `easyjson`-style or protobuf with generated, non-reflective code paths) so serialization does not touch the limited `reflect`. Code generation produces static code TinyGo can compile.
- **Hand-write the hot serialization path.** For a constrained set of message types — common in firmware and edge functions — a hand-written encoder is small, fast, and reflection-free.
- **Choose binary formats designed for constrained environments.** Length-prefixed binary, CBOR with a non-reflective codec, or a fixed wire layout avoids the reflective machinery entirely.
- **Test serialization round-trips on-target.** A type that round-trips correctly under `gc` may fail under TinyGo's `reflect`. The round-trip test must run on the TinyGo build, not just the host build.

### The hard truth

If your component's reason for existing is "talk JSON to a reflection-heavy ecosystem," TinyGo is the wrong tool. Do not fight the reflection limitation by piling shims onto an unsuitable workload; that is how a small `wasm` module becomes an unmaintainable one.

---

## The Scheduler and the Concurrency Model

TinyGo's runtime does not behave like `gc`'s. Code written under `gc` assumptions can break.

### The scheduler options

TinyGo offers selectable schedulers via `-scheduler=`:
- **`asyncify`** — the default for `wasm`. Enables goroutines and channels by transforming the code so the single-threaded `wasm` runtime can yield and resume. It costs binary size and some performance, but goroutines work.
- **`tasks`** — used for embedded targets. A cooperative scheduler with stack-based tasks.
- **`none`** — no scheduler. No goroutines. The smallest, simplest runtime; appropriate for a single control loop on a microcontroller.

### What is fundamentally different

- **No true parallelism.** TinyGo scheduling is cooperative and single-threaded. `GOMAXPROCS` has no meaningful effect. Two goroutines never run on two cores; one yields, the other runs.
- **Cooperative scheduling.** A goroutine that does not yield — a tight CPU loop with no channel ops, no `time.Sleep`, no I/O — can starve every other goroutine. Under `gc`'s preemptive scheduler this self-corrects; under TinyGo it can hang the program.
- **`-scheduler=none` means no goroutines at all.** Code that spawns even one goroutine will not work. This is a deliberate choice for the smallest firmware.

### The senior implications

- **Do not assume `gc` concurrency semantics.** Code ported from a server — worker pools, fan-out/fan-in, background goroutines spinning on work — must be re-examined. A pattern that relies on preemption or parallelism is a latent bug under TinyGo.
- **Design for explicit yield points.** On a cooperative scheduler, long-running work must yield deliberately. An event loop or state machine is often a better fit for firmware than a goroutine soup.
- **Match the scheduler to the workload.** A control loop wants `none` or `tasks`; a `wasm` module that genuinely needs concurrency wants `asyncify` and pays its size cost knowingly. Choosing the scheduler is an architecture decision, not a default to accept blindly.

---

## Garbage Collection Strategy

TinyGo's GC choice is a correctness-and-resource decision with no equivalent on the `gc` toolchain.

### The options

Selectable via `-gc=`:
- **`conservative`** — the default. A conservative collector that scans memory without precise type information. It can hold objects alive longer than necessary (false retention) but is simple and broadly correct.
- **`leaking`** — never frees. Allocations accumulate until the program exits. For a short-lived program — an edge function invocation that runs once and tears down, or a firmware routine that resets — this is *faster and smaller* and entirely appropriate. For a long-running process it is a guaranteed out-of-memory.
- **`precise`** — a precise collector with accurate type information, reclaiming memory more effectively at some cost.

### The senior framing

- **`leaking` is a feature, not a bug — in the right context.** An edge function that handles one request and is destroyed never needs to collect. A firmware routine bounded by a watchdog reset can leak intentionally. Knowing *when leaking is correct* is senior judgement; using it on a long-lived daemon is a memory leak by another name.
- **GC pauses matter on constrained hardware.** A microcontroller with kilobytes of RAM and hard real-time deadlines cannot tolerate an unbounded collection pause in the middle of a control loop. Either minimise allocation on the hot path (pre-allocate, reuse buffers, avoid per-iteration garbage) or use `leaking` with a bounded run.
- **Allocation pressure is the real lever.** Whatever GC you pick, the cheapest collection is the one that never runs. Design hot paths to be allocation-free: stack-allocated values, reused buffers, no hidden allocations from interface conversions or slice growth.

---

## Failure Modes Teams Actually Hit

These are the concrete ways TinyGo projects go wrong in the field.

### The reflection cliff, discovered late

A team builds happily, then adds a feature that pulls in a JSON-over-the-wire dependency. It compiles, links, and then produces wrong output or panics at runtime because `reflect` cannot do what the library assumes. The cost is highest when discovered after the architecture has committed to TinyGo. *Mitigation:* audit reflection use before committing; round-trip-test serialization on-target.

### The unsupported transitive import

A dependency bump introduces a transitive import of an unsupported package. The build that passed yesterday fails today, far from any code the team wrote. *Mitigation:* pin and vendor; make "builds under TinyGo" a CI gate that runs on every dependency change.

### The goroutine that never yields

Ported server code spins a goroutine in a tight loop. Under `gc` it shares the core; under TinyGo's cooperative scheduler it starves everything else and the program hangs. *Mitigation:* re-examine every goroutine; insert explicit yield points; prefer event loops on firmware.

### The slow leak that is not the intended leak

`-gc=leaking` is chosen for a function expected to be short-lived, then the function is reused in a long-running host. Memory climbs until OOM. *Mitigation:* tie the GC choice to the lifecycle contract and document it; test under sustained load on-target.

### The "it works on `gc`" trap

The team develops and tests on the `gc` toolchain because it is faster and better-tooled, then builds the TinyGo artefact only at release. Behavioural differences — reflection, scheduling, corner-case spec deviations — surface in production. *Mitigation:* run the TinyGo build and its tests in CI continuously, not just at release.

### Debugging in the dark

A bug reproduces only on-target, where the debugging story is thin. The team burns days adding print statements to firmware. *Mitigation:* invest in a host-side simulation layer and hardware-in-the-loop early, before the first hard bug (see next section).

---

## Testing Strategy for Embedded and Edge

The defining constraint: the environment where the code runs is hostile to testing. You cannot attach a normal debugger to a microcontroller as easily, and you cannot spin up an edge runtime as a unit-test fixture.

### The layered approach

1. **Host-side unit tests on `gc`.** The bulk of logic — parsing, state machines, business rules — should be written to compile and test under the *normal* `gc` toolchain. This gives you fast, well-tooled tests with full coverage. Use build tags to keep target-specific code out of these tests.
2. **TinyGo build-and-test in CI.** Compile the actual TinyGo artefact and run whatever tests TinyGo can run, every commit. This catches the subset, reflection, and scheduler differences that host-side `gc` tests miss. The discrepancy between (1) and (2) is exactly the TinyGo risk surface.
3. **Emulation.** For `wasm`, run the module in the target runtime or a compatible `wasm` runtime. For embedded, use an emulator where the target is supported. Emulation catches a class of bugs without physical hardware.
4. **Hardware-in-the-loop (HIL).** For firmware, the only way to validate timing, peripherals, and the `machine` package is on real hardware. A HIL rig — a board wired to a test harness that drives inputs and reads outputs — is the embedded equivalent of integration tests. It is expensive to build and worth it for anything shipped at scale.

### The senior principle

Push as much logic as possible *above* the target boundary so it can be tested on `gc`, and keep the TinyGo-specific surface — peripheral access, the constrained runtime behaviour — as thin and as exhaustively HIL-tested as you can afford. The goal is to make the irreducible on-target risk small, not to test everything on-target.

### What you cannot skip

The differences that only appear under TinyGo — reflection behaviour, scheduler starvation, GC pauses, peripheral timing — *must* be exercised on the TinyGo build or on hardware. Host-side `gc` tests will lie to you about exactly the things TinyGo changes. A green `gc` test suite is necessary but not sufficient.

---

## Architecture for IoT Fleets and Edge Functions

The runtime constraints push specific architecture decisions.

### IoT fleets

- **Design for the cooperative scheduler and tiny GC from the start.** Retrofitting a server-style concurrency model onto firmware is painful. Choose an event-loop or state-machine architecture, minimise allocation, and pick the scheduler/GC deliberately.
- **Make the device updatable, and assume you will need to.** TinyGo limitations are discovered in the field. A fleet you cannot update is a fleet you cannot fix when you hit a subset edge in production. Over-the-air update is a first-class requirement, not a nice-to-have.
- **Keep the on-device code minimal; push complexity to the backend.** The less reflective, networked, allocation-heavy logic on the device, the less TinyGo risk. Devices report; the backend (on a normal `gc` server) does the heavy, reflective, ecosystem-dependent work.
- **Pin the toolchain across the fleet.** A TinyGo version bump can change codegen, runtime behaviour, or supported packages. Reproducible firmware builds require a pinned TinyGo version, pinned dependencies, and a pinned target definition.

### Edge functions

- **Exploit short lifecycles.** Edge invocations are often single-shot. `-gc=leaking` and a minimal scheduler can be correct and optimal here precisely because the function does not live long enough to need collection.
- **Budget for cold start and size.** The reason to use TinyGo at the edge is size and startup. Measure both; a TinyGo module that has bloated past the size budget (often via `asyncify` or an unexpected dependency) has lost its reason to exist.
- **Mind vendor and runtime lock-in.** Targeting Fastly Compute or a specific Workers-via-`wasm` path couples you to that runtime's `wasm` capabilities and ABI expectations. Keep the runtime-specific glue thin and the core logic portable so a runtime change is a boundary change, not a rewrite.

---

## Binary Size vs Maintainability

Size is TinyGo's headline benefit and a frequent source of bad tradeoffs.

### The tension

Every technique that shrinks the binary — `-gc=leaking`, `-scheduler=none`, stripping the standard library, hand-rolling serialization, avoiding interfaces and reflection — also removes a convenience that `gc` programmers take for granted. Pushed too far, the code becomes a write-once artefact that only its author understands.

### The senior calculus

- **Size is a budget, not a goal.** There is a threshold below which the module fits and starts fast enough; below that, further shrinking buys nothing and costs maintainability. Find the budget (the runtime's limit, the cold-start target) and stop optimising once you are comfortably under it.
- **Prefer readable code that meets the budget over minimal code that exceeds maintainability.** A 60 KB module a team can change beats a 40 KB module nobody dares touch.
- **Measure, do not guess.** TinyGo size depends heavily on scheduler, GC, and which standard-library corners get linked. Measure the artefact, then choose flags based on the measurement, not folklore.
- **Document the size-driven choices.** When you pick `leaking` GC or `none` scheduler or a hand-written codec, record *why* in the code and the ADR. The next engineer needs to know these are deliberate constraints, not omissions to "fix."

---

## Team and Organizational Considerations

TinyGo is an organizational commitment, not just a build flag.

### Hiring and ramp

Go engineers are common; TinyGo engineers are rare. A team adopting TinyGo is committing to teach the subset, the scheduler model, the GC choices, and the embedded/edge toolchain to engineers who know `gc` Go. Budget for the ramp. The mental model "it's just Go" is the dangerous one — it is a dialect with a different runtime.

### Debugging difficulty

On-target debugging is materially harder than debugging a `gc` server. There is no rich `pprof`, the runtime introspection is thinner, and reproducing a hardware bug requires hardware. This raises the cost of every production incident. Factor it into on-call and staffing.

### Vendor and runtime lock-in

- TinyGo itself is the dependency: its release cadence, its supported-package list, and its target definitions gate what you can do. A package you need that TinyGo does not support is a blocker you cannot route around without forking.
- Edge runtimes add a second lock-in layer (Fastly Compute, specific Workers paths). The `wasm` ABI and capability surface are the runtime's, not a standard you control.
- Mitigate by keeping the portable logic free of both TinyGo-specific and runtime-specific assumptions, isolated behind build tags and thin glue.

### When to escalate the decision

Adopting TinyGo for a core, long-lived component is an architecture decision that deserves an ADR and senior sign-off, not a developer's local choice. The reversal cost is high: code shaped around the subset, the scheduler, and the GC does not trivially move back to `gc` or forward to C/Rust.

---

## TinyGo vs `gc` vs C/Rust

The honest comparison a senior owes the team.

### Stay on `gc` when

The workload is a conventional service with no size or bare-metal constraint. You want the full standard library, true parallelism, mature tooling, and the entire Go ecosystem. This is the default and the right answer for most backend Go.

### Choose TinyGo when

You need kilobyte-scale `wasm` or bare-metal firmware *and* your logic fits the subset — computational, allocation-conscious, not reflection-bound, with a concurrency model that suits cooperative scheduling. TinyGo lets a Go team reach targets `gc` cannot, while keeping (most of) the language they know.

### Drop to C/Rust when

- You need the absolute smallest footprint, hard real-time guarantees, or the broadest embedded ecosystem and vendor SDK support — C remains the lingua franca of embedded.
- You need memory safety with no GC at all and fine-grained control — Rust's ownership model and its mature embedded/`wasm` story (`no_std`, established HALs) outclass TinyGo for serious, long-lived embedded work.
- Your team already has the C/Rust expertise and the embedded toolchain investment.

### The framing

TinyGo's sweet spot is "a Go team that needs to reach `wasm`/embedded for a bounded component and values keeping the Go language over squeezing out the last byte or the last microsecond." Outside that sweet spot, `gc` is more capable for servers and C/Rust is more capable for demanding embedded. Picking TinyGo because the team likes Go, when the workload truly wants C or Rust, is a decision that pays interest for the life of the product.

---

## Anti-Patterns

- **Porting a `gc` server to TinyGo wholesale.** The standard-library subset, reflection limits, and cooperative scheduler will break it in ways scattered across the dependency tree. Isolate a component; do not lift-and-shift a service.
- **Assuming `encoding/json` works.** It works on simple types and falls off the reflection cliff on complex ones. Prefer code generation or hand-written codecs for anything non-trivial.
- **Testing only on `gc` and building TinyGo at release.** The differences TinyGo introduces are exactly what `gc` tests cannot see. Build and test the TinyGo artefact in CI continuously.
- **Spawning goroutines as on a server.** Cooperative scheduling means a non-yielding goroutine starves the program. Re-examine every goroutine; prefer event loops on firmware.
- **Using `-gc=leaking` on a long-lived process.** Correct for single-shot edge functions; an OOM waiting to happen on a daemon. Tie the GC choice to the lifecycle.
- **Letting the dependency tree drift unpinned.** An unsupported transitive import can break the build on any dependency bump. Pin and vendor; gate on a TinyGo build.
- **Optimising binary size past the budget into unmaintainability.** Meet the size target, then stop. A module nobody can change is a liability, not an achievement.
- **Adopting TinyGo for a core component without an ADR.** The reversal cost is high. Long-lived, central use of the subset deserves explicit, senior-level sign-off.
- **Treating TinyGo as "just Go."** It is a dialect with a different runtime, scheduler, GC, and standard-library subset. The teams that get burned are the ones who never internalised the difference.
- **Ignoring on-target debugging cost in staffing.** Production incidents on constrained hardware are slow to diagnose. Plan for it.

---

## Senior-Level Checklist

- [ ] Decide TinyGo-or-not on size/bare-metal need *and* subset fit, not on language preference
- [ ] Audit the full dependency closure for unsupported packages before committing
- [ ] Identify reflection use up front; plan code-gen or hand-written codecs for serialization
- [ ] Choose the scheduler (`asyncify`/`tasks`/`none`) deliberately, matched to the concurrency model
- [ ] Choose the GC (`conservative`/`leaking`/`precise`) tied to the component's lifecycle
- [ ] Re-examine every goroutine for cooperative-scheduler starvation
- [ ] Keep logic above the target boundary and test it on `gc`; keep the TinyGo surface thin
- [ ] Build and test the TinyGo artefact in CI on every commit, not just at release
- [ ] Round-trip-test serialization on the TinyGo build, not only on the host
- [ ] Invest in emulation and hardware-in-the-loop before the first hard on-target bug
- [ ] Pin the TinyGo version, dependencies, and target definition for reproducible builds
- [ ] Make fleet devices remotely updatable; assume field-discovered limitations
- [ ] Measure binary size against a budget; stop optimising once comfortably under it
- [ ] Record size/scheduler/GC choices in an ADR so they read as deliberate, not as gaps
- [ ] Budget for the ramp, the on-target debugging cost, and the TinyGo/runtime lock-in

---

## Summary

TinyGo is an LLVM-based alternative Go compiler that reaches targets the official `gc` toolchain cannot: kilobyte-scale WebAssembly and bare-metal microcontroller firmware. The senior responsibility is to decide whether the workload fits TinyGo's *subset* of the language and standard library — and to design the system so that the inevitable encounter with a limitation costs one component, not the architecture.

The tradeoffs are concrete and recurring: a standard-library subset that breaks deep in the dependency tree, a limited `reflect` that pushes most JSON-and-serialization stacks off a cliff, a cooperative single-threaded scheduler with no true parallelism, and a choice of garbage collectors each correct only in the right context. The failure modes — the late-discovered reflection cliff, the unsupported transitive import, the starving goroutine, the misplaced `leaking` GC, and the "works on `gc`" trap — are all preventable with discipline: audit the closure, build and test the TinyGo artefact continuously, keep logic above the target boundary, and invest in emulation and hardware-in-the-loop.

For most backend Go, stay on `gc`. For demanding embedded with hard real-time needs or the smallest footprint, C or Rust is more capable. TinyGo's sweet spot is narrow and real: a Go team reaching `wasm` or embedded for a bounded component, valuing the language over the last byte. Adopt it there, isolate it behind a thin boundary, pin everything, and write down why — and TinyGo gives you targets Go otherwise cannot reach without becoming the thing the team is afraid to touch.

## Further Reading

- TinyGo documentation — https://tinygo.org/docs/
- Sibling topics: [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/), [02-wasi-and-wasip1](../02-wasi-and-wasip1/), [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/), [05-wasm-in-production](../05-wasm-in-production/)
