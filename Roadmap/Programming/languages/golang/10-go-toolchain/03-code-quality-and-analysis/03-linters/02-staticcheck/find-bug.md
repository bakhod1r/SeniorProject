# staticcheck — Find the Bug

Each scenario shows code or a setup that staticcheck flags (or that misuses staticcheck itself). Find the defect, explain it, and fix it.

---

## Bug 1 — `SA1006`: Printf verb mismatch

```go
name := "Ada"
fmt.Printf("%d\n", name)
```

**Bug:** `%d` expects an integer; `name` is a `string`. At run time you get `%!d(string=Ada)` instead of the name.
**Fix:** use the right verb: `fmt.Printf("%s\n", name)` or `fmt.Println(name)`.

---

## Bug 2 — `SA4006`: assigned value never used

```go
func price(items []Item) int {
    total := 0
    total = sum(items)        // first total := 0 was pointless
    return total
}
```

**Bug:** the initial assignment `total := 0` is overwritten before it is read. staticcheck reports `SA4006: this value of total is never used`.
**Fix:** declare and assign in one step, removing the dead store: `total := sum(items); return total` (or just `return sum(items)`).

---

## Bug 3 — `SA1019`: deprecated API use

```go
import "io/ioutil"

data, err := ioutil.ReadFile("config.yaml")
```

**Bug:** `ioutil.ReadFile` is deprecated since Go 1.16. The package documentation says so, and `SA1019` flags every call site.
**Fix:** use the modern equivalent in `os`: `os.ReadFile("config.yaml")`. Same signature, no deprecation.

---

## Bug 4 — `SA9003`: empty branch

```go
if user.Admin {
    // TODO: handle admin
}
log.Println("done")
```

**Bug:** an empty `if` body is almost always either an unfinished feature or a typo (someone meant to negate the condition). `SA9003` catches it.
**Fix:** either implement the branch or invert the condition and put the real logic on the other side. Do not leave empty branches in committed code; add a real action or remove the conditional.

---

## Bug 5 — `SA5007`: infinite recursive call

```go
func (n *Node) String() string {
    return fmt.Sprintf("Node(%s)", n) // calls String on n again via %s
}
```

**Bug:** `fmt.Sprintf("%s", n)` invokes `n.String()`, which calls itself with no termination — a stack overflow at run time. staticcheck's `SA5007`/related infinite-recursion analyzers flag it.
**Fix:** print a primitive field instead of the receiver: `return fmt.Sprintf("Node(%s)", n.Name)` (assuming `Name` is the relevant field).

---

## Bug 6 — `S1005`: redundant blank in range

```go
for _, _ = range items {
    count++
}
```

**Bug:** the second blank is unnecessary; `for _ = range items` (or simply `for range items`) is idiomatic.
**Fix:** drop the second variable: `for range items { count++ }`. `S1005` suggests exactly this simplification.

---

## Bug 7 — `ST1005`: capitalized error string

```go
return errors.New("Failed to open file")
```

**Bug:** Go convention is lowercase, no trailing punctuation, because errors are often wrapped (`fmt.Errorf("read config: %w", err)`) and a capital letter mid-sentence looks wrong. `ST1005` enforces this.
**Fix:** lowercase and trim punctuation: `return errors.New("failed to open file")`.

---

## Bug 8 — `U1000`: unused unexported function

```go
package billing

func computeTax(amount int) int { ... } // never called
func ComputeTotal(items []Item) int { ... }
```

**Bug:** `computeTax` is unexported and never referenced; `U1000` reports it as unused dead code.
**Fix:** delete it. Dead code rots — it is not tested and slowly drifts from the rest of the package. If you genuinely need it later, restore from git history. (Note: `unused` can only flag *unexported* symbols; exported ones may have callers outside the analyzed set.)

---

## Bug 9 — `//lint:ignore` without a reason

```go
//lint:ignore SA1019
client := oldpkg.NewClient()
```

**Bug:** the ignore directive has no justification. Future readers cannot tell whether the deprecation was acknowledged on purpose or whether someone silenced the linter to land a PR. Bare ignores accumulate and become permanent.
**Fix:** include a reason: `//lint:ignore SA1019 v2 API does not yet support TLS resumption; migrate after #1234`. Reject PRs in review that add bare ignores.

---

## Bug 10 — Version drift from `@latest` in CI

```yaml
- name: staticcheck
  run: |
    go install honnef.co/go/tools/cmd/staticcheck@latest
    staticcheck -set_exit_status ./...
```

**Bug:** `@latest` resolves to whatever release is newest *at the moment CI runs*. A new staticcheck release (added check or refined analyzer) can suddenly break the build on a PR that did not touch any flagged code.
**Fix:** pin a version and upgrade deliberately in its own PR:

```yaml
- run: go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
- run: staticcheck -set_exit_status ./...
```

Treat the version like a dependency: review diffs in findings when bumping it.

---

## How to approach these
1. Read the ID first — the family (`SA`, `S`, `ST`, `U`) tells you whether to fix urgently, refactor, or debate style.
2. If unsure, `staticcheck -explain SAXXXX` in the terminal before silencing.
3. A `//lint:ignore` without a reason is a smell — every ignore needs justification.
4. CI flakes after no code change? Check whether staticcheck (or any tool) is pinned.
5. `unused` flags exported symbols? It cannot — anything it flags is genuinely unreachable from the analyzed roots.
