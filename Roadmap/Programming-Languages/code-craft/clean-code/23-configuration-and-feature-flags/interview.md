# Configuration, Constants & Feature Flags — Interview Questions

> 50+ questions across all tiers (Junior → Staff). Configuration is where logic meets the outside world: the value that lives outside the code, the constant that names a magic number, the flag that decouples deploy from release. Most production outages with a single root cause trace back to a *config* change, not a code change. Use this as self-review or interview prep.

## Table of Contents

- [Junior (14 questions)](#junior-14-questions)
- [Mid (15 questions)](#mid-15-questions)
- [Senior (14 questions)](#senior-14-questions)
- [Staff (10 questions)](#staff-10-questions)
- [Rapid-Fire](#rapid-fire)
- [Summary](#summary)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Junior (14 questions)

### J1. What is a magic number?

<details><summary>Answer</summary>

A bare literal in code whose meaning isn't obvious — `if (retries > 3)`, `sleep(86400)`, `total * 0.15`. The reader has to guess what `3`, `86400`, or `0.15` *mean*. Replace with a named constant: `MAX_RETRIES`, `SECONDS_PER_DAY`, `VAT_RATE`. The name documents intent, and the single declaration becomes the one place to change the value.

</details>

### J2. Are `0`, `1`, and `-1` magic numbers?

<details><summary>Answer</summary>

Usually not. They're idiomatic structural values: `i = 0`, `len - 1`, `count + 1`, `return -1` for "not found." Naming them (`const ZERO = 0`) adds noise without intent. The test is *semantic*: does the literal carry **domain** meaning a name would clarify? `0.15` (a tax rate) does; `0` (a loop start index) doesn't.

</details>

### J3. What's wrong with copy-pasting the same constant value into three files?

<details><summary>Answer</summary>

It violates single source of truth. When the value changes you must find and update every copy — and you *will* miss one. The copies silently drift apart, and the system behaves inconsistently depending on which file's value executes. Declare the constant once and import it everywhere.

</details>

### J4. What is a feature flag?

<details><summary>Answer</summary>

A runtime switch that turns a code path on or off without redeploying. `if (flags.enabled("new-checkout")) { newCheckout() } else { oldCheckout() }`. It decouples **deploy** (shipping code) from **release** (exposing behavior to users), enabling gradual rollout, instant rollback without a redeploy, and A/B testing.

</details>

### J5. What is configuration?

<details><summary>Answer</summary>

Any value that governs behavior but lives *outside* the compiled logic: database URLs, timeouts, port numbers, API keys, feature toggles, log levels. The discriminator is that it varies between environments or over time without changing the program's meaning. Configuration is *data the program reads*, not logic the program executes.

</details>

### J6. Why should the database URL be configuration rather than hard-coded?

<details><summary>Answer</summary>

Because it differs per environment — `localhost` in dev, a private endpoint in staging, a clustered host in prod. Hard-coding it forces a code change and redeploy to point at a different database, and (worse) tempts developers to commit a production host into source. Configuration lets the same artifact run anywhere.

</details>

### J7. What does "fail fast" mean for configuration?

<details><summary>Answer</summary>

Validate all required config at **startup** and crash immediately with a clear message if anything is missing or malformed — *before* serving a single request. The alternative ("fail late") is a `NullPointerException` at 3 a.m. on the first request that happens to read a missing setting. Fail fast turns a runtime mystery into a deterministic boot-time error.

</details>

### J8. Where should secrets like API keys live?

<details><summary>Answer</summary>

**Never in version control.** Inject them at runtime from the environment or a secrets manager (Vault, AWS Secrets Manager, Kubernetes Secrets). Source files (and `.env` files) get cloned, forked, and leaked. A key committed to Git is compromised forever — Git history is permanent, so you must *rotate* the key, not just delete the line.

</details>

### J9. What is a `.env` file and what's the catch?

<details><summary>Answer</summary>

A local file of `KEY=value` pairs loaded into the environment for development convenience. The catch: it tends to drift toward holding real secrets, and someone always commits it by accident. Always `.gitignore` it, commit a `.env.example` with dummy values, and never use it in production — prod reads from the real environment or a secrets store.

</details>

### J10. What's the difference between a constant and configuration?

<details><summary>Answer</summary>

A **constant** is a fixed value baked into the build that never varies at runtime (`PI`, `MAX_UPLOAD_SIZE`, an HTTP status code). **Configuration** varies between environments or deployments without recompiling. Rule of thumb: if it changes per environment, it's config; if it's a universal truth of the program, it's a constant.

</details>

### J11. What is "stringly-typed" configuration?

<details><summary>Answer</summary>

Treating every config value as a raw `String` and parsing it ad hoc at the point of use: `Integer.parseInt(config.get("timeout"))` scattered across the code. It pushes type errors (`"thirty"` instead of `30`) to runtime, far from the source. The cure is *typed* config: parse and validate once into a struct with real types.

</details>

### J12. Should a feature flag's name say what it does?

<details><summary>Answer</summary>

Yes — and it should also encode *intent and ownership*. `new-checkout` is vague; `release-2024q3-checkout-v2` or `ops-disable-recommendations` tells you the flag's purpose, era, and type. A good name makes the flag's eventual *retirement* obvious: nobody can tell when `flag_x` is safe to delete.

</details>

### J13. What's a boolean-trap flag?

<details><summary>Answer</summary>

A boolean argument that toggles behavior, making the call site opaque: `createUser(true, false)`. What do `true` and `false` mean? You can't tell without checking the signature. The same trap applies to flags wired straight into a parameter. Cure: named options/enums, or separate methods. Self-documenting call sites beat positional booleans.

</details>

### J14. Why not just read environment variables directly wherever you need them?

<details><summary>Answer</summary>

Because `os.getenv("TIMEOUT")` sprinkled across the codebase has no central validation, no defaults, no types, and no single place to see what the app needs to run. Read the environment **once** at startup into a typed config object, validate it, then pass that object around. The rest of the code never touches the environment directly.

</details>

---

## Mid (15 questions)

### M1. Explain the 12-factor app's "config in the environment."

<details><summary>Answer</summary>

Factor III of the 12-factor methodology: store config that varies between deploys (credentials, hostnames, resource handles) in **environment variables**, not in code or committed config files. Benefits: a strict separation between code and config, language-agnostic access, no risk of committing a prod config file, and the same build artifact promoted unchanged from staging to prod. The litmus test: *could you open-source the repo right now without leaking credentials?*

</details>

### M2. What's the criticism of pure environment-variable config?

<details><summary>Answer</summary>

Env vars are a flat, untyped, string-only namespace with no structure, no comments, no nesting, and a low limit on practical size. For large config (dozens of nested settings, lists, per-tenant maps) they get unwieldy and error-prone. Many teams use a hybrid: structured config files (YAML/TOML) for the *shape*, env vars (or a secrets store) for *secrets and per-environment overrides*. 12-factor's "everything in env" is a guideline, not dogma.

</details>

### M3. Describe a sane config precedence order.

<details><summary>Answer</summary>

From lowest to highest priority: **built-in defaults → config file → environment variables → command-line flags**. More specific and more operationally immediate sources override more general ones. The key requirements: the order is *documented*, *deterministic*, and the effective merged config can be *dumped/logged* (with secrets redacted) so an operator can answer "what value is actually in effect, and where did it come from?"

</details>

### M4. What does typed config look like, and why prefer it?

<details><summary>Answer</summary>

Parse the raw key-value soup *once* into a struct with real types, then pass that struct around:

```go
type Config struct {
    Port      int           `env:"PORT" default:"8080"`
    Timeout   time.Duration `env:"TIMEOUT" default:"30s"`
    DBURL     string        `env:"DATABASE_URL,required"`
    Debug     bool          `env:"DEBUG" default:"false"`
}
```

A parse failure (`PORT=abc`) is caught at load time, in one place, with a clear error — not at the call site, in production, on the unlucky request. The rest of the code consumes `cfg.Timeout` as a real `Duration` with no parsing.

</details>

### M5. What's the difference between release flags and ops flags?

<details><summary>Answer</summary>

A **release flag** (a.k.a. release toggle) hides in-progress work and enables gradual rollout of a new feature; it is *short-lived* and should be removed once the feature is fully shipped. An **ops flag** (operational toggle / kill switch) lets operators degrade or disable a subsystem under load or during an incident; it may live *for the lifetime of the subsystem*. They have opposite lifetimes, which is why conflating "all flags" into one bucket leads to flag debt.

</details>

### M6. Name the four canonical feature-flag types and their lifetimes.

<details><summary>Answer</summary>

From Pete Hodgson's taxonomy:

| Type | Purpose | Lifetime | Dynamism |
|---|---|---|---|
| **Release** | hide in-progress features, gradual rollout | days–weeks (delete after launch) | static per deploy |
| **Experiment** | A/B test, multivariate | days–weeks (delete after decision) | per-request (per user) |
| **Ops** | kill switch, degrade under load | months–years (lives with the system) | runtime, by operators |
| **Permission** | gate features by user/plan/region | long-lived / permanent | per-request (per user) |

The mistake is treating a release flag like a permanent one — it should die, not graduate to permanent.

</details>

### M7. What is flag debt and how do you control it?

<details><summary>Answer</summary>

Flag debt is the accumulation of flags that have outlived their purpose: each adds a branch, doubles the logical test matrix, and rots into dead-but-scary code nobody dares delete. Control it by treating every release/experiment flag as *temporary by construction*: give it an owner and an expiry date at creation, file a retirement ticket the moment it's launched, alert on flags older than N days, and make removing the flag part of the feature's "definition of done."

</details>

### M8. How do you retire a feature flag safely?

<details><summary>Answer</summary>

1. Confirm the flag is fully rolled out (100% on) and stable for a soak period.
2. Delete the *losing* branch and the conditional, keeping only the winning path.
3. Remove the flag's definition from the flag system.
4. Delete any config, tests, and dashboards referencing it.

Do it as a dedicated PR, not bundled with new work, so it's trivially reviewable and revertible. The hardest part is organizational: someone must own the deletion, or it never happens.

</details>

### M9. Knight Capital lost $440M in 45 minutes. What's the config lesson?

<details><summary>Answer</summary>

In 2012 Knight deployed new code to 7 of 8 servers. The 8th still ran code that *reused an old, repurposed feature flag* — a flag whose meaning had silently changed. On the un-updated server the flag activated dead, eight-year-old "Power Peg" order-routing logic, which fired millions of erroneous trades. Lessons: (1) **never reuse a flag for a new meaning** — retire the old one and create a new name; (2) deploys must be all-or-nothing and verified per node; (3) dead code behind a flag is a loaded gun. A config/flag discrepancy across nodes bankrupted a company in under an hour.

</details>

### M10. What is the "configuration complexity clock"?

<details><summary>Answer</summary>

Mike Hadlow's observation that configurability moves in a circle. You start with **hard-coded values** (simplest). Requirements grow, so you move to a **config file**. Then you need conditional logic in config, so you build a **rules engine**. Then non-developers need to author rules, so you build a **DSL**. The DSL grows until it's a badly-designed programming language — at which point the simplest thing would be... **hard-coded values in real code** again. The lesson: every step toward configurability has a cost; don't make things configurable speculatively.

</details>

### M11. Should everything be configurable? (trick)

<details><summary>Answer</summary>

No. Every config knob is a surface for misconfiguration, a branch to test, and a decision deferred to whoever sets it (often at 3 a.m. during an incident, with no context). Configurability has real cost — see the complexity clock. Make something configurable only when there's a *concrete, demonstrated* need for it to vary (per environment, per customer, by operators in an incident). A hard-coded sensible default beats an unused, untested knob. "We might need to change it someday" is not a need.

</details>

### M12. Is a feature flag free? (trick)

<details><summary>Answer</summary>

No. Each flag adds a code branch, doubles the test combinations for that path (2 flags = 4 paths, 10 flags = 1024), adds a lookup at runtime, and creates debt that must be actively retired. Flags are a powerful tool with a *carrying cost* — the cost is paid over the flag's whole life, not just at creation. The free-feeling part (adding the `if`) is the cheapest moment; deleting it later is the expensive part everyone forgets to budget for.

</details>

### M13. Config file or environment variable? (trick)

<details><summary>Answer</summary>

It depends on the value's nature, and the honest answer is "usually both." **Env vars** for per-deploy secrets and environment-specific handles (12-factor) — they're injectable and never committed. **Config files** for structured, non-secret, version-controllable settings (feature defaults, route tables, log formats) where you want comments, nesting, and a reviewable diff. The anti-pattern is forcing all config into one mechanism: secrets in a committed YAML file, or a 40-field nested structure flattened into 40 env vars.

</details>

### M14. When does a constant belong inline rather than extracted? (trick)

<details><summary>Answer</summary>

When the literal is *self-explanatory in context* and naming it would add indirection without clarity. `for (i = 0; i < n; i++)`, `array[len - 1]`, `x / 2`, `status == 200` in an HTTP client — extracting `LOOP_START`, `HALF_DIVISOR`, or `HTTP_OK` (when used once, locally, obviously) can hurt readability. Extract when the value (a) recurs, (b) carries non-obvious domain meaning, or (c) is likely to change. A single, obvious, locally-scoped literal can stay inline.

</details>

### M15. What's the danger of mutable global config read at arbitrary times?

<details><summary>Answer</summary>

Non-determinism. If config is a mutable global that any code can read at any moment — and something can mutate it mid-flight — two requests in the same process can see different values, and behavior depends on *when* the read happened relative to the write. This produces Heisenbugs that vanish on retry. Cure: load config into an **immutable** object at startup; if it must change at runtime (e.g., flags), make updates atomic and snapshot the value at the start of a request so one request sees one consistent view.

</details>

---

## Senior (14 questions)

### S1. How do you design config validation that fails fast *and* helpfully?

<details><summary>Answer</summary>

Validate the entire config at startup and **aggregate** errors rather than dying on the first one:

```go
var errs []string
if cfg.Port < 1 || cfg.Port > 65535 { errs = append(errs, "PORT must be 1–65535") }
if cfg.DBURL == "" { errs = append(errs, "DATABASE_URL is required") }
if cfg.Timeout <= 0 { errs = append(errs, "TIMEOUT must be positive") }
if len(errs) > 0 { log.Fatalf("invalid config:\n  - %s", strings.Join(errs, "\n  - ")) }
```

> **What the interviewer is really checking:** do you understand that operator experience is part of reliability? Dying with "PORT must be 1–65535; DATABASE_URL is required" in one shot lets an operator fix everything in one edit. Dying on the first error forces N restart cycles. Validation is a UX surface for whoever boots the service.

</details>

### S2. How do you keep a single source of truth across services that share config?

<details><summary>Answer</summary>

Options, roughly in order of scale: (1) a **shared library/package** of constants imported by each service (works in a monorepo, same language); (2) a **generated artifact** — define values once in a schema (protobuf, JSON Schema) and code-gen typed constants per language; (3) a **central config service** (Consul, etcd, AppConfig) services fetch at startup, with the schema versioned. The trap to avoid is duplication-by-copy across repos. Whatever the mechanism, exactly one place is authoritative and the rest *derive* from it.

</details>

### S3. How do you do percentage-based / canary rollout with a flag?

<parameter name="old_string">