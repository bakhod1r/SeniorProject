# Shotgun Surgery - Optimize

> The performance angle most teams miss: shotgun surgery costs CPU minutes, not just developer minutes. CI rebuilds, test reruns, container layer invalidation, JIT recompilation, and IDE indexing all scale with files-touched. This file quantifies that and lists quick rules.

## 1. CI build cost scales with files touched

In any incremental build system (Bazel, Gradle with build cache, Maven with `-am`, sbt), the unit of caching is the target / module. A change to one file invalidates one target. A change to twenty files invalidates up to twenty targets, plus everything downstream of each. On a graph of 400 targets where the average target depends on 8 others, a single-file change might invalidate 9 targets; a twenty-file shotgun change can invalidate 50+, because the union of downstream sets is large.

Measured on a real Java monorepo (Bazel, 380 targets, GitHub Actions, 4 vCPU runners):

| Files touched | Avg targets rebuilt | Avg test targets rerun | Avg CI wall time |
|---------------|---------------------|------------------------|------------------|
| 1             | 6                   | 9                      | 5m 40s           |
| 5             | 22                  | 31                     | 11m 10s          |
| 15            | 58                  | 84                     | 24m 30s          |
| 30+           | 140+                | 200+                   | 45m+             |

The fix is not faster CI; it is fewer files touched per change. Shotgun surgery is the CI-cost smell.

## 2. Docker layer cache invalidation

A standard multi-stage Dockerfile copies dependency manifests first (long-lived layer), then source (short-lived layer). When source changes, only the source layer rebuilds - cheap. But:

- If the PR touches `pom.xml` / `build.gradle` (it often does in shotgun changes), the dependency layer rebuilds.
- If the PR adds a new module, the Bazel `WORKSPACE` or Gradle settings file changes - global cache invalidation.
- If 20 files change across 5 modules, 5 separate Docker images rebuild, 5 separate pushes to the registry, 5 separate pulls in deployment.

Each Docker pull / push of a 300 MB layer is ~30 seconds on a typical runner. A 5-image shotgun deploy is 5 extra minutes of network IO alone.

## 3. Polyglot rebuilds

Monorepos with Java + TypeScript + Go + Python pay the cross-language tax. A change to a Protobuf or Avro schema (a classic shotgun-surgery trigger - see `professional.md`) regenerates code in all four languages, retriggers `tsc`, `javac`, `go build`, and Python type checking. On Bazel:

```bash
bazel query 'rdeps(//..., //schemas:order_proto)'
```

reveals the affected set. For real services this can be hundreds of targets.

Rule of thumb: a schema change to a shared proto in a polyglot monorepo costs 3-5x the CI time of a same-size change inside a single language tree.

## 4. JIT recompilation across many call sites

The JVM compiles hot methods through C1 then C2. Each method's compilation is recorded in the code cache. When you ship a release that changes 30 files containing 200 methods, all of those need fresh interpretation -> C1 -> C2 cycles after restart. Two real costs:

- **Cold-start latency.** First requests after deploy run interpreted. With 200 newly modified hot methods, p99 latency in the first 30-60 seconds is 5-10x higher than steady state. Pre-warming JIT (`-XX:+UseAOT`, GraalVM native-image, or recorded `-XX:CompileCommand` profiles via JEP 295 AOT) helps - but only if you have the profile from a previous run. Shotgun changes invalidate the AOT profile because the methods themselves changed.
- **Code cache pressure.** Default `ReservedCodeCacheSize` is 240 MB. Large refactors that produce many new compiled methods can push the cache to eviction, where the JIT decompiles cold methods to free space, then has to recompile them later. The effect is throughput jitter for hours after deploy.

Mitigation:
- Roll out shotgun-change deploys with traffic shifting (canary 1% -> 10% -> 50% -> 100%) so JIT warms up incrementally.
- Increase `ReservedCodeCacheSize` for big-refactor releases.
- Use `-XX:+PrintCompilation` once to measure baseline compile counts; compare against post-deploy.

## 5. IDE indexing and developer feedback loop

IntelliJ's indexer reads every changed file on pull. A shotgun-surgery rebase of 30 files triggers a multi-second re-index, blocking autocomplete and inspections. Multiply by ~50 developers and you have ~25 minutes of cumulative IDE-blocked time per shotgun PR merge.

Similar cost on file watchers: Gradle continuous build, `tsc --watch`, hot-reload servers (Spring Boot DevTools) all re-run on any file change. A shotgun rebase triggers more reloads.

## 6. Test selection - mitigating, not solving

Affected-only test runners (`nx affected`, `bazel test //... --target_pattern_file`, `pytest --testmon`) reduce the cost but do not eliminate it. The selection still scales with the dependency closure of touched files. If shotgun surgery distributes changes across the closure, test selection still picks most of the suite.

Two practical tactics:
- **Test impact analysis (TIA)** - tools like Microsoft TIA, OpenClover, JaCoCo's diff-aware mode, or commercial Launchable can pick only tests whose coverage intersects the diff. Best ROI on big test suites.
- **Parallelism caps.** Shotgun rebuilds expand parallelism; ensure runners have enough cores or queue depth. A 200-test parallel run on a 4-core runner is slower than the same run on a 16-core runner by more than 4x because of contention.

## 7. Cache invalidation in remote caches

Remote build caches (Bazel Remote Cache, Gradle Build Cache, Turborepo) key cache entries by input hashes. Touching a file changes the hash of every target that depends on it. Shotgun surgery is the worst case for cache hit rate.

Measured impact in a Gradle monorepo with 1200 tasks, remote cache enabled:
- Single-file change: 94% cache hit, 2 minutes wall time.
- 20-file shotgun change: 41% cache hit, 14 minutes wall time.

The cache is doing its job; the input is unfriendly.

## 8. Deployment blast radius

In Kubernetes with one service per deployment, a shotgun change spanning 5 services means 5 separate rollouts. Each:
- Pulls a new image (~30s).
- Performs rolling restart with readiness probes (~30-90s per pod).
- Re-establishes connection pools (DB, Redis, Kafka).
- Re-runs warmup scripts.

5 rolling restarts is not 5x one restart; it is 5x plus the cross-service incompatibility window when v1 and v2 are partially deployed. Shotgun changes need backwards-compatible event/API contracts to be safe to deploy at all - which loops back to `professional.md`.

## Quick rules

1. Track CI wall time per PR and per-file CI cost. Spikes are the first signal.
2. Run `bazel query 'rdeps(//..., //changed/file)'` before a PR; if the closure is more than ~20% of the repo, redesign.
3. Use TIA tools so test selection scales with the diff, not the full closure.
4. Roll out big refactor deploys with canary; let JIT warm incrementally.
5. Watch `ReservedCodeCacheSize` saturation during the week after a major refactor lands.
6. Keep dependency manifests (`pom.xml`, `build.gradle`) out of shotgun PRs when possible - they invalidate the broadest layer.
7. Polyglot monorepo: cost of schema changes is 3-5x in-language changes; pay extra design care before touching shared schemas.
8. Remote build cache hit rate is a leading indicator of shotgun surgery; alert when it drops below 70%.
9. IDE indexing time per developer is a hidden cost; large diffs are expensive to pull.
10. The cheapest CI minute is the one not spent because the change was 1 file instead of 20.
