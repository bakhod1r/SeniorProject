# Reflection — Professional Level

> **Topic:** [Reflection](README.md)
> **Focus:** Reflection in production — the JPMS module system and `--add-opens`, GraalVM native-image's closed-world reflection config, reflection-driven security incidents and CVEs, startup-latency budgets, and governing reflection across a large codebase.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples & Configs](#code-examples--configs)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Operational Patterns](#operational-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Security](#security)
14. [War Stories](#war-stories)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What does reflection cost — and risk — once it's running in production, behind a module system, inside a native image, and on a CVE list?**

The senior level made reflection fast. The professional level makes it *survivable in production*, where reflection stops being a performance footnote and becomes an operational and security concern. Four realities dominate:

1. **The module system fences reflection.** Since Java 9's JPMS, `setAccessible(true)` is no longer a free pass. A module must *open* a package for deep reflection; otherwise you get `InaccessibleObjectException`, and operators reach for `--add-opens` flags that pile up in startup scripts. Getting this wrong breaks Jackson, Hibernate, Lombok-adjacent tooling, and DI containers in subtle ways.
2. **Native-image demands a closed world.** GraalVM native-image (and AOT compilation generally) compiles only what it can prove reachable. Reflection violates that, so you must *declare* every reflectively-accessed type/member in `reflect-config.json` (or via the tracing agent, or `@Reflective`/hints). Miss one and the app throws *only* on the native binary, *only* on the unlucky code path.
3. **Reflection is an attack surface.** Reflection bypasses access control by design, and history is full of CVEs where deserialization + reflection let attackers instantiate and invoke arbitrary methods (the Java "deserialization gadget chains," Log4Shell's reflective lookups, Spring4Shell's `ClassLoader` access). Reflective endpoints that take attacker-controlled class/method names are a top-tier risk.
4. **Reflection taxes startup.** Class scanning, annotation processing, and DI wiring at boot inflate cold-start latency — fatal for serverless and CLIs. The industry's response (Quarkus, Micronaut, Spring AOT, GraalVM) is to *move reflection to build time*.

In one sentence: **the professional level is reflection as a governed production capability — fenced by modules, declared for AOT, hardened against abuse, and budgeted against startup.**

---

## Prerequisites

- **Required:** `senior.md` — the optimizer view, `MethodHandle`/`invokedynamic`, reflect-vs-generate.
- **Required:** Operational familiarity with JVM startup flags and packaging, or an equivalent runtime's deployment model.
- **Required:** Basic threat modeling: trust boundaries, attacker-controlled input.
- **Helpful:** Having debugged a `--add-opens` failure or a native-image `ClassNotFoundException`.
- **Helpful:** Exposure to a CVE postmortem (deserialization, Log4Shell, Spring4Shell).

---

## Glossary

| Term | Definition |
|------|-----------|
| **JPMS** | Java Platform Module System (Java 9+). Modules declare what they `export` (compile + runtime access) and `open` (deep reflective access). |
| **`exports` vs `opens`** | `exports pkg` grants normal access to public types; `opens pkg` additionally grants *reflective* access to all members (incl. private) — what `setAccessible` needs. |
| **`--add-opens`** | A launch flag forcing a package open for reflection at runtime, bypassing the module's own declaration. The operator's escape hatch. |
| **`InaccessibleObjectException`** | Thrown when `setAccessible(true)` is denied because the target package isn't open to your module. |
| **Native-image (GraalVM)** | Ahead-of-time compilation to a standalone binary using a **closed-world** reachability analysis. |
| **`reflect-config.json`** | The file declaring which classes/fields/methods are reflectively accessed, so native-image includes their metadata. |
| **Tracing agent** | GraalVM's `native-image-agent` that records reflective access during a test run and emits config automatically. |
| **Reachability metadata** | The umbrella term for reflection/resource/JNI/proxy config that makes a closed-world build correct. |
| **Deserialization gadget chain** | A sequence of classes whose reflective behavior during deserialization can be chained into arbitrary code execution. |
| **Build-time initialization** | Running initialization (incl. some reflection/DI) during the AOT build so it's not paid at runtime — the Quarkus/Micronaut/Spring-AOT strategy. |
| **Cold start** | The latency to first useful work for a freshly-started process; heavily impacted by boot-time reflection. |
| **Closed-world assumption** | All reachable code/members are known at build time; reflection must be declared to honor it. |

---

## Core Concepts

### 1. JPMS: `opens` is the new `setAccessible`

Before Java 9, `field.setAccessible(true)` always worked. Now, deep reflection into another module's package requires that package to be **open**:

```java
// module-info.java
module com.example.app {
    requires com.fasterxml.jackson.databind;
    opens com.example.app.model;                       // to everyone
    opens com.example.app.secret to com.example.di;    // qualified: only this module
}
```

If `com.example.app.model` is *not* opened, Jackson's `field.setAccessible(true)` throws `InaccessibleObjectException`. Operators then bolt on:

```
--add-opens com.example.app/com.example.app.model=com.fasterxml.jackson.databind
--add-opens java.base/java.lang=ALL-UNNAMED
```

This is why production JVM startup scripts accumulate long `--add-opens` lists. The professional discipline: **prefer declaring `opens` in `module-info.java`** (intentional, reviewable, scoped) over scattering `--add-opens` flags (operational, broad, easy to over-grant). `--add-opens java.base/...=ALL-UNNAMED` in particular re-opens the JDK internals and is a smell — it's frequently a workaround for a library that reflects into `java.base` and should be fixed or replaced.

Note the trajectory: each Java release tightens this. "Strong encapsulation of JDK internals" (JEP 396/403) made `--illegal-access=deny` the default, breaking libraries that reflected into `sun.*`/`java.*`. Future releases restrict `setAccessible` further. Reflective libraries are on borrowed time unless explicitly granted access.

### 2. Native-image: the closed world wants a manifest

GraalVM native-image runs a static reachability analysis and compiles only what it can reach. Reflective access by string is unreachable to that analysis, so you must supply a manifest:

```json
// reflect-config.json
[
  {
    "name": "com.example.app.model.User",
    "allDeclaredFields": true,
    "allDeclaredConstructors": true,
    "methods": [{ "name": "getName", "parameterTypes": [] }]
  }
]
```

Three ways to produce it:

- **The tracing agent.** Run your *full test suite / representative workload* under `-agentlib:native-image-agent=config-output-dir=...`; it records every reflective access and writes the config. The risk: untested paths reflect on types the agent never saw → runtime failure in production.
- **Framework hints.** Spring AOT, Quarkus, Micronaut generate this config at build time from their knowledge of your beans/entities — a major reason these frameworks exist in native-image form.
- **Hand-authored config / `@Reflective`-style annotations** for the cases tools miss.

The failure mode is brutal: the JVM build works, the native binary builds *and starts*, then throws `ClassNotFoundException`/`NoSuchMethodException` *only* when the undeclared reflective path executes — often a rare branch in production. **Test the native binary across real paths, not just that it boots.**

### 3. Startup latency: reflection's hidden production tax

Boot-time reflection — classpath scanning for annotations, building DI graphs, materializing ORM metadata — runs *before* the first request. On a long-lived server it's amortized to nothing; on serverless (Lambda) or a CLI invoked thousands of times, it's paid on every cold start and dominates p99.

The industry pivot is explicit: **move reflection from runtime to build time.**

- **Spring Boot 3 / Spring AOT** processes beans at build, generating code + reflection hints, enabling fast native images.
- **Quarkus** does "build-time metaprogramming": it runs the heavy reflection during the build, bakes the results in, and ships a near-reflection-free runtime.
- **Micronaut** uses annotation processors (compile-time) instead of runtime reflection for DI from day one.

The senior reflect-vs-generate choice becomes, at the professional level, a *deployment-shape* choice: native-image + serverless ⇒ minimize runtime reflection; classic long-lived JVM ⇒ runtime reflection is usually fine.

### 4. Cross-language production posture

- **Go:** no module-system fence and no JIT relinking, but `reflect` is heavily used in production serializers/ORMs. The production concern is mostly *performance* (cache per-type plans) and the fact that `reflect`-based code defeats Go's otherwise excellent dead-code elimination, bloating binaries. Go's static binaries don't have native-image's reflection-config problem because there's no AOT closed-world analysis beyond the normal build — but `unsafe` + `reflect` can still corrupt memory.
- **C#/.NET:** `System.Reflection` is mature; NativeAOT and trimming (`PublishTrimmed`) introduce the *same* closed-world problem as GraalVM — you annotate with `[DynamicallyAccessedMembers]` and `DynamicDependency`, and the linker warns on unanalyzable reflection. Source generators (e.g. `System.Text.Json`) are the codegen escape hatch.
- **Python:** no AOT/module fence, so reflection is unfenced and ubiquitous — which makes it a *security* concern above all (arbitrary `getattr`/`__import__`/`eval`-adjacent vectors).
- **Rust:** by avoiding runtime reflection, Rust sidesteps the entire module/native-image/closed-world headache — its `derive`-based codegen is closed-world by construction. This is a *production* argument for Rust's design, not just an aesthetic one.

---

## Real-World Analogies

**JPMS `opens` = building access badges.** `exports` is letting visitors into the lobby; `opens` is giving them a master key to every locked office (private members). `--add-opens` is security overriding the building's own policy at the front desk for one visitor. Long lists of `--add-opens` mean the building's access policy has been quietly hollowed out at the door instead of fixed in the floor plan.

**Native-image reflection config = customs declaration.** A closed-world build is a country that only admits goods on a manifest. Reflection is smuggling items in by describing them verbally at runtime. The customs form (`reflect-config.json`) is your declaration; the tracing agent is a clerk who watched a dry run and filled it out — but only for the goods that happened to ship that day. Anything you didn't rehearse gets stopped at the border in production.

**Reflective deserialization endpoint = a 'do whatever this letter says' mailbox.** A deserializer that reflectively instantiates and invokes whatever the payload names is a mailbox where any envelope's instructions are executed. Gadget chains are attackers discovering which sequences of "harmless" instructions, combined, unlock the building.

---

## Mental Models

**Model 1: "Reflection is a privilege now, not a right."** Modern platforms treat deep reflection as something that must be *granted* (`opens`, reflection config, `[DynamicallyAccessedMembers]`) rather than assumed. Design as if every reflective access needs a permission slip — because increasingly it does.

**Model 2: "Untested reflective paths are unshipped code in native-image."** Under AOT, a reflective branch your tests never hit effectively doesn't exist in the binary. Coverage of reflective paths becomes a *correctness* requirement, not just a quality nicety.

**Model 3: "Reflection moves trust boundaries."** Any place attacker-controlled data chooses a class name, method name, or field is a boundary crossing. Treat reflective dispatch on external input the way you treat `eval` on a SQL string.

**Model 4: "Boot-time reflection is a cold-start mortgage."** You can keep it (long-lived servers amortize it) or refinance it to build time (AOT frameworks). Choose based on deployment shape; don't pay serverless cold-start interest by accident.

---

## Code Examples & Configs

### Example 1: Diagnosing and fixing an `--add-opens` situation

```text
# Symptom in logs:
java.lang.reflect.InaccessibleObjectException: Unable to make field private
  java.lang.String com.example.app.model.User.name accessible: module
  com.example.app does not "opens com.example.app.model" to module com.fasterxml.jackson.databind
```

Two fixes, in order of preference:

```java
// PREFERRED: declare intent in module-info.java (reviewable, scoped)
opens com.example.app.model to com.fasterxml.jackson.databind;
```

```bash
# FALLBACK: launch flag (operational, broad). Document WHY each one exists.
java --add-opens com.example.app/com.example.app.model=com.fasterxml.jackson.databind -jar app.jar
```

Audit rule: any `--add-opens ...=ALL-UNNAMED` or `java.base/...` entry needs a written justification and a ticket to remove it.

### Example 2: Generating native-image reflection config safely

```bash
# Run the FULL representative workload, not just unit happy paths.
java -agentlib:native-image-agent=config-output-dir=src/main/resources/META-INF/native-image \
     -jar app.jar < representative-traffic-replay

# Merge across multiple runs so rare paths aren't lost:
java -agentlib:native-image-agent=config-merge-dir=... -jar app.jar < other-scenarios
```

Then *gate the native build in CI* and run integration tests against the **native binary**, so an undeclared reflective path fails the pipeline, not production.

### Example 3: .NET trimming-safe reflection

```csharp
// Tell the trimmer which members must survive, or it strips them.
[RequiresUnreferencedCode("Uses reflection over T's properties")]
static string Dump<[DynamicallyAccessedMembers(
        DynamicallyAccessedMemberTypes.PublicProperties)] T>(T value)
{
    var sb = new StringBuilder();
    foreach (var p in typeof(T).GetProperties())
        sb.Append($"{p.Name}={p.GetValue(value)};");
    return sb.ToString();
}
```

The `[DynamicallyAccessedMembers]` attribute is .NET's machine-checkable reflection manifest; the linker warns when it can't prove safety.

### Example 4: Hardening a reflective dispatcher against abuse

```java
// DANGEROUS: attacker controls the class and method.
Object o = Class.forName(req.className).getDeclaredConstructor().newInstance();
o.getClass().getMethod(req.methodName).invoke(o);

// HARDENED: allow-list, no constructor side effects, no arbitrary classes.
private static final Map<String, Handler> ALLOWED = Map.of(
    "refund", new RefundHandler(),
    "notify", new NotifyHandler());

Handler h = ALLOWED.get(req.action);   // string -> known instance, no reflection on input
if (h == null) throw new BadRequest("unknown action");
h.handle(req);
```

The fix isn't "reflect more carefully" — it's "don't reflect on attacker input at all; map to an allow-list."

---

## Pros & Cons

**Pros (production framing)**

- **Reflection still powers the frameworks that run the world** — Spring, Hibernate, Jackson — and that ecosystem maturity is real leverage.
- **Tracing agents / framework hints** automate most native-image config.
- **AOT frameworks** let you keep reflective programming models while shipping fast native binaries.

**Cons**

- **Operational drag:** `--add-opens` sprawl, native-image config maintenance, trimming warnings.
- **Correctness cliffs under AOT:** undeclared paths fail only in the native binary, only sometimes.
- **A persistent security surface** — deserialization gadgets, reflective endpoints, `setAccessible` bypassing controls.
- **Tightening platform stance:** each Java release restricts reflection further; reflective libs need active maintenance.

---

## Use Cases

- **Enterprise frameworks** (DI, ORM, serialization) — the default reflective consumers you must operate.
- **Native-image / serverless deployments** — where you actively suppress runtime reflection.
- **Plugin systems** loading classes by name — legitimate, but a controlled trust boundary.
- **Security review of any reflective endpoint** taking external class/method/field names.
- **Cold-start optimization** initiatives (Lambda, CLIs) that audit and relocate boot-time reflection.

---

## Operational Patterns

**Pattern 1: Declare, don't flag.** Express reflective access via `module-info.java` `opens` / `reflect-config.json` / `[DynamicallyAccessedMembers]` — version-controlled and reviewed — rather than launch flags scattered in deploy scripts.

**Pattern 2: Generate config from real traffic.** Drive the tracing agent with replayed production-shaped traffic and *merge* across scenarios; never trust a single happy-path run.

**Pattern 3: Gate the native/trimmed build in CI.** Run integration tests against the actual AOT artifact so reflection gaps fail the pipeline.

**Pattern 4: Allow-list reflective input.** Never reflect on attacker-controlled names; map strings to known handlers.

**Pattern 5: Budget boot-time reflection.** Measure cold start; if it matters, adopt an AOT framework or codegen to relocate reflection to build time.

**Pattern 6: Track the platform's tightening.** Treat `--add-opens` and `--illegal-access` reliance as tech debt with a removal plan.

---

## Best Practices

- **Inventory your reflection.** Know which libraries reflect (Jackson, Hibernate, Spring) and into which packages; that inventory drives `opens` and config.
- **Minimize the blast radius of `opens`.** Use qualified `opens ... to <module>` rather than opening to everyone.
- **Keep `reflect-config.json` close to the code** (`META-INF/native-image`) and regenerate it in CI, not by hand once.
- **Pin and patch deserialization libraries aggressively** — they're the classic reflective CVE vector.
- **Forbid reflective dispatch on untrusted input in code review** as a hard rule.
- **Prefer codegen/source generators** (`System.Text.Json` SG, Micronaut, Quarkus) for new startup-sensitive services.
- **Document every `--add-opens`** with a justification and an owner.

---

## Edge Cases & Pitfalls

- **`InaccessibleObjectException` only at runtime.** Module access is checked when reflection runs, so an unopened package passes compilation and fails in prod.
- **Native-image works on JVM, breaks as a binary.** The single most common GraalVM surprise — a reflective path not in the config.
- **Tracing agent misses untested branches.** Config is only as complete as your workload coverage.
- **`--add-opens ALL-UNNAMED` masks real problems** and silently re-exposes JDK internals — a security regression hiding as a compatibility fix.
- **Trimming/NativeAOT in .NET strips reflectively-used members** without `[DynamicallyAccessedMembers]`; warnings are easy to ignore until runtime failure.
- **Classloader/module leaks** from reflective caches in app servers and hot-reload setups.
- **Reflection defeats Go/Java/.NET dead-code elimination**, inflating binary/image size — relevant for edge and mobile.
- **Library upgrades change reflective access patterns**, silently requiring new `opens`/config.

---

## Security

Reflection is a force multiplier for attackers because it *bypasses access control by design* and *invokes behavior chosen at runtime*. The canonical incidents:

- **Java deserialization RCE (the "gadget chain" era).** `ObjectInputStream.readObject` reflectively reconstructs arbitrary objects and invokes their methods. Attackers craft payloads chaining library classes (Commons-Collections, etc.) into remote code execution. Mitigation: never deserialize untrusted data with Java native serialization; use allow-list `ObjectInputFilter`; prefer data formats without code semantics.
- **Log4Shell (CVE-2021-44228).** JNDI lookups in log messages reflectively loaded and instantiated attacker-specified classes — reflection + dynamic class loading on untrusted input. Mitigation: patch; disable lookups; never feed untrusted data to reflective loaders.
- **Spring4Shell (CVE-2022-22965).** Data binding reflectively reached `class.module.classLoader` to manipulate the running app. Mitigation: restrict bindable reflective properties; patch.

The through-line: **attacker-controlled string + reflective instantiation/invocation = RCE risk.** Defenses, in order: (1) don't reflect on untrusted input — use allow-lists; (2) deny reflective access to dangerous classes (`ClassLoader`, `Runtime`, JNDI, serialization filters); (3) keep platforms current as they tighten reflective defaults; (4) prefer codegen-based libraries that have no runtime reflective dispatch on input. `setAccessible(true)` itself is a privilege escalation primitive — audit its use, and rely on JPMS `opens` scoping to constrain what it can reach.

---

## War Stories

- **The Friday `--add-opens` cascade.** A Jackson upgrade started reflecting into a newly-private field; prod threw `InaccessibleObjectException` on a rare endpoint. The "fix" was `--add-opens ...=ALL-UNNAMED`, which silently re-opened JDK internals and masked a second latent bug for months. The real fix was a one-line qualified `opens`.
- **The native binary that booted and lied.** A service passed all JVM tests and the GraalVM build; the tracing agent had only seen the login path. A monthly billing job reflected on `Invoice` — undeclared — and the *native* binary threw `NoSuchMethodException` at month-end, in production only. Lesson: drive the agent with full workloads and test the binary.
- **The serverless cold-start that ate the SLA.** A Lambda using classic Spring + Hibernate spent 4–6s per cold start scanning and wiring via reflection; p99 blew the latency budget under bursty traffic. Migrating to Quarkus (build-time reflection) cut cold start to ~0.3s. Reflection hadn't slowed steady state — it slowed *starting*.
- **The reflective admin endpoint.** An internal tool let ops "run any handler by name" via `getMethod(name).invoke(...)`. A reachable path let a crafted name invoke an unintended method with side effects. Replaced with an allow-list map; no reflection on input.

---

## Test Yourself

1. Post-Java-9, what must be true for `setAccessible(true)` on another module's private field to succeed?
2. Why is declaring `opens` in `module-info.java` preferable to `--add-opens` flags?
3. What does GraalVM native-image need for reflective access, and how do you generate it safely?
4. Describe the worst failure mode of missing native-image reflection config.
5. Why does boot-time reflection hurt serverless but not a long-lived server?
6. How do Quarkus/Spring-AOT/Micronaut reduce runtime reflection?
7. Walk through how reflection turns Java deserialization into an RCE vector, and the primary mitigation.
8. What's the .NET equivalent of native-image reflection config, and what tool enforces it?

<details>
<summary>Answers</summary>

1. The target package must be *open* to your module — via `opens` in its `module-info.java` or a runtime `--add-opens` — otherwise `InaccessibleObjectException`.
2. `opens` is intentional, scoped (can be qualified to a specific module), reviewed in version control, and travels with the code; `--add-opens` is broad, operational, easy to over-grant (e.g. `ALL-UNNAMED`), and scattered across deploy scripts.
3. A `reflect-config.json` (reachability metadata) listing reflectively-accessed types/members; generate it by running the *full representative workload* under the `native-image-agent` and merging runs, or via framework hints.
4. The JVM build and even the native binary boot fine, then a rare reflective code path throws `ClassNotFoundException`/`NoSuchMethodException` only in the native binary, only when that path runs — often in production.
5. A long-lived server amortizes boot-time reflection over millions of requests; serverless/CLI pays it on every cold start, where it dominates p99 latency.
6. They move reflection to build time — running annotation processing/DI wiring/metadata generation during the build and baking in code + hints, so the runtime is near-reflection-free and native-image-friendly.
7. `readObject` reflectively reconstructs arbitrary objects and invokes their methods; attackers chain library classes into code execution. Primary mitigation: don't deserialize untrusted data with native serialization; use allow-list `ObjectInputFilter`/safer formats.
8. Trimming/NativeAOT reachability metadata via `[DynamicallyAccessedMembers]`/`DynamicDependency`; the IL trimmer/linker enforces it and emits warnings on unanalyzable reflection.

</details>

---

## Cheat Sheet

| Concern | Java/JVM | .NET | Go | Rust |
|---|---|---|---|---|
| Access fence | JPMS `opens` / `--add-opens` | (none; trimming gates membership) | none | n/a (no runtime reflection) |
| AOT manifest | `reflect-config.json` + agent | `[DynamicallyAccessedMembers]` | n/a | closed-world by construction |
| Codegen escape | Spring AOT/Quarkus/Micronaut | source generators | `easyjson`/protobuf | `derive` macros |
| Cold-start fix | move reflection to build | NativeAOT | cache plans / codegen | already minimal |
| Top security risk | deserialization gadgets, JNDI | binary formatter (deprecated) | `unsafe`+`reflect` | minimal |

**Hard rules:** declare reflective access (don't flag) · test the native/trimmed artifact, not just boot · never reflect on untrusted input (allow-list) · audit every `--add-opens` and `setAccessible`.

---

## Summary

In production, reflection stops being a performance detail and becomes governed infrastructure. The **JPMS module system** fences deep reflection behind `opens`, turning `setAccessible(true)` from a guarantee into a request that throws `InaccessibleObjectException` when denied — and `--add-opens` flags are the operational escape hatch that should be minimized and audited, never sprayed as `ALL-UNNAMED`. **GraalVM native-image** (and .NET trimming/NativeAOT) impose a closed world: every reflective access must be declared in `reflect-config.json` / `[DynamicallyAccessedMembers]`, ideally generated from real traffic via the tracing agent and verified by testing the *actual AOT artifact* — because undeclared paths fail only in the binary, only sometimes.

Reflection is also a first-class **security surface**: deserialization gadget chains, Log4Shell, and Spring4Shell all weaponized reflective instantiation/invocation on attacker-controlled input, so the non-negotiable rule is *never reflect on untrusted names — map to an allow-list*. Finally, boot-time reflection is a **cold-start mortgage** that punishes serverless and CLIs, which is why the modern stack (Quarkus, Spring AOT, Micronaut, source generators, Rust's `derive`) systematically relocates reflection to build time. The professional posture: treat reflection as a privilege to be granted, declared, tested, hardened, and budgeted — and reach for codegen when the deployment shape rewards a closed world.

---

## Further Reading

- JPMS: JEP 261 (modules), JEP 396/403 (strong encapsulation of JDK internals), and the `--add-opens` documentation.
- GraalVM: the native-image reachability-metadata / reflection docs and the tracing-agent guide.
- .NET: trimming and NativeAOT docs, `[DynamicallyAccessedMembers]`, and `System.Text.Json` source generation.
- Security: the Java deserialization "ysoserial" research, CVE-2021-44228 (Log4Shell) and CVE-2022-22965 (Spring4Shell) writeups.
- Frameworks: Quarkus "build-time metaprogramming," Spring AOT, and Micronaut's compile-time DI for the reflection-at-build-time approach.
