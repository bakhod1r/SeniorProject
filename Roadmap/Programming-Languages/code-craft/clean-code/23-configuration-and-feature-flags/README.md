# Configuration, Constants & Feature Flags

Status: ⏳ PENDING

The clean handling of everything that *isn't logic but governs it* — named constants, environment configuration, and feature flags. Distinct from [Meaningful Names](../01-meaningful-names/README.md) (mechanical naming of code symbols): this chapter is about the **lifecycle of a setting** — where a value lives, who may change it, when it is read, and when a flag must die.

The positive rules will cover: naming constants at the right scope, a single source of truth for config, validating configuration at startup (fail-fast), typed config over stringly-typed maps, and the discipline of *retiring* a feature flag once it has served its purpose.

## Anti-Patterns to Cover

- **Magic numbers and strings** scattered inline instead of named, single-source constants
- **Configuration sprawl** — the same setting duplicated across env files, code defaults, and CI
- **Boolean-trap flags** — `doThing(true, false, true)` whose meaning is invisible at the call site
- **Immortal feature flags** — flags that outlive their rollout and become permanent dead branches
- **Hard-coded environment checks** — `if env == "prod"` behavior smeared through the codebase
- **Secrets in config files** committed to version control
- **Mutable global config** read at arbitrary times, producing non-deterministic behavior
- **Stringly-typed config** — every value a string, validated nowhere, blowing up at runtime
- **Silent defaults** — a missing required setting that fails closed quietly instead of failing fast and loud

See the [chapter README](../README.md) for the positive rules.
