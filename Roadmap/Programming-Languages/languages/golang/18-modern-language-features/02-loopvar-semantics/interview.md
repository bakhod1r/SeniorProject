# Loop Variable Semantics (Go 1.22) — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What was the classic Go loop variable bug, and what does Go 1.22 do about it?

**Model answer.** Before Go 1.22, a `for` loop declared its variables once and reused them across all iterations. If you captured the loop variable in a closure or goroutine, all captures referenced the *same* variable, which held its final value after the loop. So `for i := 0; i < 3; i++ { go func(){ print(i) }() }` printed `3 3 3`. Go 1.22 makes each iteration get a *fresh* instance of the loop variable, so the same code prints `0 1 2`. The fix applies to both the `range` form and the three-clause form.

**Common wrong answers.**
- "Go 1.22 made closures capture by value." (No — closures still capture by reference; the captured variable is now per-iteration.)
- "It only affects `range` loops." (No — three-clause `for i := 0; ...` loops too.)
- "Installing Go 1.22 fixes all my loops." (No — it's gated on the `go` directive in `go.mod`.)

**Follow-up.** *Predict the output of that loop under `go 1.21`.* — `3 3 3`, because that module still uses shared-variable semantics.

---

### Q2. What turns the new behavior on?

**Model answer.** The `go` directive in `go.mod`. If it says `go 1.22` or higher, that module's packages use per-iteration loop variables. If it says `go 1.21` or lower, they use the old shared-variable behavior — even when compiled by a Go 1.22+ toolchain. The toolchain version does not decide; the directive does.

**Common wrong answers.**
- "Whatever Go version is installed." (No.)
- "A compiler flag you pass." (No — it's the module's declared language version.)

**Follow-up.** *Why gate it on the directive instead of making it global?* — To honor the compatibility promise: old modules keep old behavior until their authors opt in by bumping the directive.

---

### Q3. Why did this loop print `30 30 30`?

```go
nums := []int{10, 20, 30}
var ptrs []*int
for _, v := range nums {
    ptrs = append(ptrs, &v)
}
```

**Model answer.** Under pre-1.22 semantics, `v` was a single reused variable, so every `&v` was the address of the *same* variable, which ended at 30. Dereferencing all the pointers gives `30 30 30`. Under Go 1.22, each iteration's `v` is distinct, so the pointers point to different variables and you get `10 20 30`.

**Follow-up.** *If you wanted the addresses of the actual slice elements instead, what would you write?* — `&nums[i]`, using the index. That addresses the slice element, not the loop copy.

---

### Q4. Is the `v := v` workaround still needed?

**Model answer.** Not in a `go 1.22+` module — the compiler now does it for you, so `v := v` is redundant (harmless, but unnecessary). You still need it, or the equivalent, in code that must compile under a `go 1.21` or lower directive.

**Common wrong answer.** "It's always required for safety." (Outdated — true only under old directives.)

**Follow-up.** *Does removing `v := v` after a 1.22 bump change performance?* — No. The implicit per-iteration variable has the same allocation profile as the manual shadow.

---

### Q5. After Go 1.22, will my read-only numeric loop run slower?

**Model answer.** No. If the loop variable doesn't escape — you just read it and use it within the iteration — the compiler keeps it in a reused register or stack slot, and the generated code is identical to before. There's only a per-iteration allocation when the variable is *captured* and escapes, which is exactly the cost the old `v := v` workaround had.

**Follow-up.** *How would you confirm whether a loop variable escapes?* — `go build -gcflags=-m` reports `moved to heap` for escaping variables.

---

## Middle

### Q6. Explain the gating in a mixed-module build.

**Model answer.** Each module is compiled under its own `go` directive. So in one binary, your main module (`go 1.22`) gets per-iteration loops, while a dependency still on `go 1.21` keeps shared-variable loops. The gate is per module, applied via the `-lang=go1.NN` flag the `go` tool passes to the compiler per package. Consequences: bumping *your* directive doesn't fix a dependency's internal loops, and a dependency bumping *its* directive is a semantically meaningful change.

**Follow-up.** *Why is this per-module gating considered safe rather than confusing?* — It lets the ecosystem migrate independently with no flag day; each module's behavior is a deterministic function of its own source plus its directive.

---

### Q7. How does the three-clause loop preserve the `i++` post statement under per-iteration semantics?

**Model answer.** The compiler keeps a controlling variable and, each iteration, copies it into the body's fresh per-iteration variable, runs the body, then syncs the (possibly mutated) value back to the controlling variable before running the post statement and re-checking the condition. So captures bind to the per-iteration copy, but the loop's progression and any body mutations of `i` still work exactly as before.

**Common wrong answer.** "It scopes `i` to the body, so `i++` increments a fresh `i` and the loop never advances." (No — the sync-back to a controlling variable is what makes it work.)

**Follow-up.** *So does `for i := 0; i < n; i++ { i++ }` still skip every other iteration?* — Yes; body mutations sync back, preserving the old control behavior.

---

### Q8. How did `go vet`'s `loopclosure` analyzer change?

**Model answer.** It became language-version-aware. In a `go 1.22+` package, the previously-flagged pattern (loop variable captured in a `go`/`defer` closure) is no longer reported, because it's now correct. In a `go 1.21` or lower package, it still warns. So a `loopclosure` warning in modern code is a strong hint that the package's directive is below 1.22.

**Follow-up.** *What does that mean for third-party loop-capture linters?* — Ones that aren't directive-aware now produce false positives on 1.22 code; audit and remove them after migration.

---

### Q9. Does the change affect `for i := range 10` and range-over-func?

**Model answer.** Yes. Range-over-integer (`for i := range 10`, added in 1.22) declares a loop variable `i` that is per-iteration, so capturing it is safe. Range-over-func (`for v := range seq`, stable in 1.23) also produces a per-iteration `v`; the loop body becomes a `yield` closure, and each yielded value gets its own variable. Any variable a `for ... range` declares is per-iteration under a 1.22+ module, regardless of what's being ranged.

**Follow-up.** *Why does the per-iteration rule matter especially for iterators?* — Consumers naturally capture yielded values in closures; the rule makes that correct without workarounds.

---

### Q10. A loop that captures its variable now allocates once per iteration after you bumped to 1.22. Is that a regression?

**Model answer.** No — it's correctness surfacing a real cost. Before 1.22, either the loop was buggy (all closures saw the final value) or you used `v := v`, which incurred the same allocation. The per-iteration semantics just made the necessary allocation automatic. If it's in a hot path and matters, the fix is the same as always: avoid capturing — pass the value as a goroutine argument or restructure.

**Follow-up.** *How do you see these allocations?* — A heap profile in `pprof` attributes them to the loop's source line; `-gcflags=-m` shows the escape.

---

### Q11. How would you preview the change before Go 1.22 shipped, and how do you find affected loops?

**Model answer.** On Go 1.21 you could build with `GOEXPERIMENT=loopvar go build ./...` to force the new semantics regardless of directive and run your tests. To enumerate the loops whose behavior actually changes, compile with `-gcflags=all=-d=loopvar=2`, which prints the file:line of every loop whose captured-variable behavior differs under the new rule. That output is a precise migration checklist.

**Follow-up.** *Why is `-d=loopvar=2` better than auditing every loop?* — It reports only loops where the change is observable (the variable is captured), so you review the handful that matter instead of all of them.

---

### Q12. When is `go func(x){...}(v)` still the right pattern?

**Model answer.** When the code must compile correctly under *any* `go` directive, including pre-1.22. Passing the loop value as an argument copies it at call time, so it's correct regardless of loop semantics. It's the version-independent style — good for shared libraries that target old consumers and for teaching a habit that never breaks.

**Follow-up.** *In a guaranteed-1.22 codebase, is it still useful?* — It's optional for correctness but some teams keep it for explicitness; capturing directly is now equally correct.

---

## Senior

### Q13. How was changing loop semantics compatible with Go's Go 1 compatibility promise?

**Model answer.** Three arguments. First, intent: the promise protects *working* programs, and the overwhelming majority of affected programs were already buggy — they wanted the new behavior and got the wrong old one. Second, gating: the change is opt-in per module via the `go` directive, so a program's behavior only changes when its author deliberately bumps the directive; behavior is a deterministic function of (source, directive). Third, precedent: Go had already established the `go` directive as a language-version selector that can gate semantics, not just enable syntax. The promise was refined to "a program at a given language version behaves consistently across toolchains," and changing behavior across directive bumps is permitted.

**Follow-up.** *What evidence justified shipping it?* — Large-scale runs across Google's and the public corpus showed the change is a no-op for most loops, fixes far more than it breaks, and the breakage is shallow; a preview experiment let the community validate first.

---

### Q14. Walk me through migrating a large multi-module codebase to per-iteration semantics.

**Model answer.**
1. **Inventory** modules and their `go` directives.
2. **Preview** per module: build with a bumped directive (or `GOEXPERIMENT=loopvar` on 1.21) and run the full test suite, especially concurrency and table-driven tests; capture result diffs. Use `-d=loopvar=2` to list affected loops.
3. **Triage** failures into three buckets: tests that now pass correctly (masked bugs — keep), tests that relied on old behavior (fix the test), and production code that genuinely relied on the shared variable (fix the code explicitly).
4. **Bump the directive** in its own isolated PR per module so the behavior change is reviewable and bisectable.
5. **Clean up separately**: remove redundant `v := v`, retire loop-capture linters — in follow-up cosmetic PRs.
6. **Guardrails**: set a minimum-directive policy and a CI check; update onboarding docs.

**Follow-up.** *Why isolate the bump from the cleanup?* — So a regression can be bisected to the behavior change alone, and the cleanup diff is obviously behavior-preserving.

---

### Q15. What kinds of programs genuinely broke, and how do you fix them?

**Model answer.** Three shapes. (1) Code that *intended* all closures to observe the final value by exploiting the shared variable — fix by hoisting an explicit outer variable and assigning to it. (2) Code relying on `&v` being the *same* address each iteration — fix with an explicit single variable if a stable address is truly needed. (3) Goroutines using the captured loop variable as a racy "latest value" signal — fix with a real synchronization primitive. The common thread: they exploited an accident; the fix is to make the intent explicit with a variable whose scope and identity you control.

**Follow-up.** *How common are these?* — Rare and shallow; the data showed they're a tiny fraction, and usually easy to spot once you know the shapes.

---

### Q16. After migration, what should happen to `v := v` shadows and loop-capture linters?

**Model answer.** Both should be retired in fully-1.22 code. `v := v` is redundant — remove it in a dedicated cosmetic pass, but *not* in files that might still build under a 1.21 directive (e.g. a shared lib targeting old consumers), where it's load-bearing. Loop-capture linters like `exportloopref`/`scopelint` are obsolete; if they aren't directive-aware they'll produce false positives on 1.22 code, and even if they are, they waste CI time. Audit the linter config and drop them. Keep general suites like `staticcheck` but disable the now-redundant checks.

**Follow-up.** *Why is leaving `v := v` in place a real cost, not just noise?* — It confuses new contributors ("why is this here?") and propagates obsolete habits; a language fix should retire its workarounds.

---

### Q17. Explain the performance contract and why it didn't force restructuring of hot loops.

**Model answer.** The contract is: non-capturing loops pay nothing (escape analysis keeps the per-iteration variable in reused stack/register storage; identical codegen to pre-1.22), and capturing loops pay exactly what `v := v` paid (one per-iteration allocation when the variable escapes). Because the cost is *only* incurred on capture, a loop that was allocation-free before stays allocation-free after — unless it captures, in which case it was already paying or already buggy. So the pre-1.22 advice for hot paths (don't capture, don't allocate per iteration) is unchanged, and no defensive restructuring is needed.

**Follow-up.** *How is the cost erased for non-capturing loops?* — The semantics live in a front-end rewrite; escape analysis, a later pass, proves the variable doesn't escape and reuses storage.

---

### Q18. Your `go vet` suddenly flags a loop-capture warning in code you thought was modern. What's going on?

**Model answer.** The package's *effective* language version is below 1.22 — the `loopclosure` analyzer is directive-aware and only warns under old semantics. Likely causes: the module's `go.mod` directive is `go 1.21` (or lower), or the package is in a dependency/submodule with an old directive, or a per-file `//go:build` constraint pins an older version. Fix by raising the directive to ≥ 1.22 (after the usual migration checks). The warning isn't a false positive; it's correct *for that directive*.

**Follow-up.** *How do you check the effective version a file compiles under?* — Inspect `go.mod`'s directive plus any per-file `//go:build go1.NN` constraint; `go build -x` shows the `-lang=go1.NN` flag passed to the compiler.

---

## Staff / Architect

### Q19. Design an organization-wide policy and CI for adopting Go 1.22 loop semantics across many repos.

**Model answer.**
- **Policy:** all new modules target `go 1.22`+; existing modules migrate on a deadline, isolating the directive bump from cleanup.
- **CI drift gate:** a check that fails any module whose `go` directive is below the policy floor (with a temporary allowlist during rollout).
- **Migration audit job:** run `-gcflags=all=-d=loopvar=2` to enumerate affected loops per repo and require test coverage on those lines before the bump.
- **Test rigor:** mandate re-running concurrency and table-driven tests on the bump PR; treat newly-passing previously-masked tests as a signal, not a surprise.
- **Linter hygiene:** after a repo is fully 1.22, a CI step removes/ disables loop-capture linters and flags redundant `v := v`.
- **Rollout sequencing:** leaf services first (no downstream consumers), then shared libraries (which raise consumers' minimum toolchain), coordinating the latter with consumer teams.
- **Observability:** track per-repo directive versions in a dashboard so the migration's progress and the long tail are visible.

**Follow-up.** *How do you handle a shared library whose consumers can't move off 1.21 yet?* — Keep its directive low (preserving `v := v` where load-bearing) or maintain version-independent code (argument-passing); bump only when consumers are ready, since the bump raises their minimum toolchain.

---

### Q20. How does the loopvar change interact with the broader "language version gating" strategy (GODEBUG, forward compatibility, range-over-func)?

**Model answer.** Loopvar is the flagship of a deliberate strategy: use the `go` directive as a true language-version selector so the language can evolve behavior without a flag day. It composes with: forward compatibility (Go 1.21 hardened the toolchain to *not* silently apply newer semantics to old-directive code, and to let a newer toolchain run old code at its declared version); GODEBUG settings (for runtime/library behavior changes gated similarly, though loopvar is a pure compile-time gate, not a GODEBUG); and the new range forms (range-over-integer in 1.22 and range-over-func in 1.23, both inheriting per-iteration semantics). Architecturally, the `go` directive becomes the unit of compatibility and the lever for incremental, per-module evolution. Loopvar proved the mechanism works for a behavior change at scale.

**Follow-up.** *Is loopvar gated by GODEBUG?* — No; it's a compile-time decision tied to the language version (`-lang`), not a runtime GODEBUG knob. GODEBUG gates runtime/library behavior; loopvar is purely front-end.

---

### Q21. A team proposes pinning a critical module to `go 1.21` to keep relying on the old shared-variable behavior. How do you respond?

**Model answer.** Push back. Relying on the shared variable is exploiting an accident; it's fragile, surprising to every future reader, and blocks the module from ever adopting 1.22+ features and security/toolchain improvements. The right move is to make the intent explicit: if they need "the final value," hoist an outer variable and assign to it; if they need a stable address, use a single explicit variable; if they need a "latest" signal across goroutines, use a channel or atomic. Pinning the directive to preserve a bug-shaped behavior is technical debt that compounds. I'd require the explicit rewrite and let the module move forward.

**Follow-up.** *Is there ever a legitimate reason to stay on an old directive?* — Yes, but for *support-window* reasons (consumers stuck on an old toolchain), not to exploit shared-variable semantics. Even then, the code inside should be written version-independently.

---

### Q22. How would you build a custom analyzer that's correct in a mixed 1.21/1.22 codebase?

**Model answer.** Make it language-version-aware, exactly like `loopclosure`. Use the analysis framework's access to the package's effective `go` version (via the `golang.org/x/tools/.../versions` helper, which accounts for the module directive and per-file `//go:build go1.NN` constraints). Gate diagnostics on that version: only report the loop-capture pattern when the effective version is < 1.22. Never assume a single global version for the whole build, because different packages compile under different directives. Test the analyzer against fixtures at both 1.21 and 1.22 to confirm it flags the former and stays silent on the latter.

**Follow-up.** *What's the failure mode if you ignore the version?* — False positives on 1.22 code (flagging now-correct loops) or false negatives on 1.21 code, depending on your default — both erode trust in the analyzer.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| What gates the change? | The `go` directive in `go.mod`. |
| Does the toolchain version decide? | No. |
| Affected loop forms? | Both `range` and three-clause. |
| `for {}` affected? | No — no declared variable. |
| Is `v := v` still needed in 1.22+? | No, it's redundant. |
| Version-independent safe pattern? | `go func(x){...}(v)`. |
| Cost for non-capturing loops? | Zero — identical codegen. |
| Cost for capturing loops? | Same as old `v := v` (per-iteration alloc). |
| `for i := range 10` per-iteration? | Yes. |
| Range-over-func variable per-iteration? | Yes. |
| Preview flag on Go 1.21? | `GOEXPERIMENT=loopvar`. |
| Enumerate affected loops? | `-gcflags=all=-d=loopvar=2`. |
| `loopclosure` after 1.22? | Directive-aware; silent on 1.22+ packages. |

---

## Mock Interview Pacing

A 30-minute interview on the Go 1.22 loopvar change might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q9, Q10.
- 15–25 min: a senior scenario — Q13, Q14, or Q17.
- 25–30 min: a curveball — Q19 or Q21.

If the candidate claims hands-on migration experience, drive to Q11 (preview/`-d=loopvar=2`) and Q15 (what actually broke) — both are field-test questions. If they've only read about the change, stay in middle territory and probe whether they understand the gating (Q2, Q6) and the performance contract (Q5, Q10). A staff candidate should reach the gating-strategy question (Q20) within fifteen minutes.
