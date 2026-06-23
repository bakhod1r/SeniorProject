---
layout: default
title: Golden Files — Find the Bug
parent: Golden File Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/find-bug/
---

# Golden Files — Find the Bug

[← Back](../)

Each snippet below contains at least one defect. Look before reading the diagnosis.

## Bug 1 — Silent baseline

```go
func assertGolden(t *testing.T, got []byte) {
    path := filepath.Join("testdata", t.Name()+".golden")
    want, err := os.ReadFile(path)
    if err != nil {
        os.WriteFile(path, got, 0o644) // create on first run
        return
    }
    if !bytes.Equal(got, want) {
        t.Fatalf("mismatch")
    }
}
```

**Diagnosis.** The "create on first run" branch silently bakes the current output as the baseline. A buggy first run becomes the canonical answer forever. There must be no implicit creation — require an explicit `-update` flag. Also: `t.Helper()` is missing; the failure message has no diff.

## Bug 2 — Forgotten flag.Parse

```go
var update = flag.Bool("update", false, "")

func TestRender(t *testing.T) {
    flag.Parse() // wrong place
    got := Render()
    assertGolden(t, got)
}
```

**Diagnosis.** `flag.Parse` runs implicitly in `testing.Main` before any test function. Calling it in `TestRender` is at best redundant; if you write `flag.Parse()` inside a subtest after another subtest already consumed argv it can cause confusing flag-redefinition errors. Just declare the flag at package scope and let the test framework parse.

## Bug 3 — Race under parallel

```go
var goldenBuf bytes.Buffer

func assertGolden(t *testing.T, got []byte) {
    goldenBuf.Reset()
    goldenBuf.Write(got)
    // ... read golden, compare with goldenBuf.Bytes()
}

func TestParallel(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            assertGolden(t, render(tc))
        })
    }
}
```

**Diagnosis.** The package-level `goldenBuf` is shared mutable state. Under `t.Parallel()` two subtests race on `Reset` / `Write`. `go test -race` catches it. Fix: make the buffer local to the helper or remove it entirely — `got` is already a `[]byte`.

## Bug 4 — Path collision

```go
g := goldie.New(t)
for _, tc := range cases {
    g.Assert(t, "render", render(tc)) // every case uses "render"
}
```

**Diagnosis.** Every case writes to `testdata/render.golden`. The last case wins under `-update`; non-last cases fail comparison. Use `tc.name` as the fixture key:

```go
g.Assert(t, tc.name, render(tc))
```

## Bug 5 — Trailing newline mismatch

```go
got := strings.TrimSpace(Render(input))
assertGolden(t, []byte(got))
```

The golden file (created by an editor that adds a final newline) is `Hello\n`. The SUT output is `Hello`. The test fails on a one-byte difference.

**Diagnosis.** Either trim consistently or do not trim at all. Most editors append a final newline; `os.WriteFile` does not. Pick a rule, document it, and apply it both ways: trim both, or trim neither. Mixing is the cause of countless flaky golden tests.

## Bug 6 — Map iteration order

```go
func ToText(m map[string]int) []byte {
    var b strings.Builder
    for k, v := range m {
        fmt.Fprintf(&b, "%s=%d\n", k, v)
    }
    return []byte(b.String())
}
```

The first test run produces:

```
a=1
b=2
c=3
```

The second run produces:

```
c=3
a=1
b=2
```

**Diagnosis.** Go randomizes map iteration order intentionally. Extract keys, sort, then range:

```go
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys)
for _, k := range keys {
    fmt.Fprintf(&b, "%s=%d\n", k, m[k])
}
```

## Bug 7 — Time leak

```go
func Render(p Profile) string {
    return fmt.Sprintf("%s, generated at %s", p.Name, time.Now().Format(time.RFC3339))
}
```

The test passes once at `-update` and fails forever after.

**Diagnosis.** `time.Now()` is non-deterministic. Inject a clock:

```go
func Render(p Profile, now func() time.Time) string {
    return fmt.Sprintf("%s, generated at %s", p.Name, now().Format(time.RFC3339))
}
```

Pass a fixed clock in tests.

## Bug 8 — Windows line endings

A Windows developer runs `-update`. Their editor (or `git`'s `core.autocrlf`) writes `\r\n`. CI on Linux fails:

```
--- want
+++ got
@@ -1,3 +1,3 @@
-Hello,\r\nworld\r\n
+Hello,\nworld\n
```

**Diagnosis.** Two fixes are needed. (1) Configure the repo with `.gitattributes`:

```
testdata/*.golden text eol=lf
```

(2) Normalize CRLF -> LF in the helper:

```go
got = bytes.ReplaceAll(got, []byte("\r\n"), []byte("\n"))
```

## Bug 9 — Diff on the wrong slice

```go
if !bytes.Equal(got, want) {
    t.Fatalf("diff:\n%s", cmp.Diff(got, want)) // arg order wrong
}
```

**Diagnosis.** `cmp.Diff(want, got)` is the convention. Many teams use `cmp.Diff(want, got)` so the diff prints `-want +got`. Reversing it produces `-got +want`, which is the same content but reads backwards and confuses reviewers. Either is internally consistent — pick one and stick to it. Document the choice.

## Bug 10 — `testdata/` writable bit

```go
if err := os.WriteFile(path, got, 0o444); err != nil {
    t.Fatal(err)
}
```

A previous test run wrote `0o444` (read-only). Now `-update` cannot overwrite the file: `permission denied`.

**Diagnosis.** Always write goldens with `0o644`. Read-only mode does not protect against bad updates — only review does. And it actively breaks `-update`.

## Bug 11 — JSON whitespace drift

The SUT uses `json.Marshal`. The golden was created by `json.MarshalIndent` two years ago. Today's SUT produces a single line; the golden has indented blocks. Test fails.

**Diagnosis.** Either the SUT changed silently (someone removed `Indent`) or the golden was generated incorrectly. Read the SUT, decide what the canonical form is, regenerate the golden once with `-update`, review the diff, commit.

## Bug 12 — Hidden non-determinism in dependency

A pretty-printer dependency `github.com/example/pretty` bumped a minor version. Whitespace changed. CI fails on every golden test.

**Diagnosis.** This is not a bug in your code; it is unpinned versioning. Pin the dependency in `go.mod`. Regenerate goldens deliberately when you choose to upgrade — never let an unattended `go get -u` rewrite your snapshots.

## Bug 13 — Missing helper marker

```go
func assertGolden(t *testing.T, got []byte) {
    want, _ := os.ReadFile("testdata/" + t.Name() + ".golden")
    if !bytes.Equal(got, want) {
        t.Fatalf("mismatch")
    }
}
```

Every failure reports the line `t.Fatalf("mismatch")` instead of the line in the test where `assertGolden` was called. Three tests fail with identical line numbers and no context.

**Diagnosis.** Missing `t.Helper()` at the top of the function. Add it. The failure messages now point at the test that called the helper, not at the helper itself.

## Bug 14 — Swallowed error

```go
want, _ := os.ReadFile(path)
if !bytes.Equal(got, want) {
    t.Fatalf("mismatch")
}
```

The golden file is missing. `os.ReadFile` returns an error and an empty `want`. The comparison still runs, fails because `got` is non-empty, and reports "mismatch" — but the real problem is that the golden does not exist. The developer wastes time looking for an output bug.

**Diagnosis.** Check the error. Tell the developer the golden is missing and suggest `-update`.

```go
want, err := os.ReadFile(path)
if err != nil {
    t.Fatalf("read golden %s: %v (run -update)", path, err)
}
```

## Bug 15 — Subtest name with slash

```go
t.Run("api/v1/users", func(t *testing.T) {
    // ...
    assertGolden(t, got) // uses t.Name() => "TestX/api/v1/users"
})
```

The helper joins `t.Name()` with `testdata/` and `.golden`, producing path `testdata/TestX/api/v1/users.golden`. The directories may not exist; `os.WriteFile` under `-update` fails. Or, on Windows, `/` is not a path separator and the file is created with literal slashes in the name.

**Diagnosis.** Replace `/` (and other unsafe characters) with `_` before using `t.Name()` as a path component. Or use `filepath.FromSlash` consistently and create directories with `MkdirAll`.

## Bug 16 — Reading bytes vs string mismatch

```go
want := []byte(string(rawWant)) // somewhere a string conversion happens
if !bytes.Equal(got, want) {
    t.Fatalf("...")
}
```

If `rawWant` contains invalid UTF-8 bytes, the round-trip through `string` does not modify them (Go strings are byte sequences), but if some normalizer assumes UTF-8 and operates on `string(rawWant)`, the bytes may shift. The test fails on non-UTF-8 fixtures.

**Diagnosis.** Avoid implicit `string` conversions in the comparison path. Operate on `[]byte` throughout. Only convert to `string` for diff output.

## Bug 17 — Update flag scope

```go
func TestRender(t *testing.T) {
    update := flag.Bool("update", false, "rewrite goldens") // local!
    flag.Parse()
    // ...
}
```

The flag is declared inside the test function. The first time `go test -update` runs, this works. The second time `flag.Bool` panics because the flag is already registered.

**Diagnosis.** Move the flag declaration to package scope. Test functions consume the flag value (`*update`), not declare it.

## Bug 18 — Concatenation without separator

```go
path := "testdata/" + t.Name() + ".golden"
```

Works on Unix. Fails on Windows where the path separator is `\`. The file is created with a literal `/` in the path component on some filesystems.

**Diagnosis.** Use `filepath.Join`:

```go
path := filepath.Join("testdata", t.Name()+".golden")
```

## Bug 19 — Skipping in update mode

```go
if *update {
    write(path, got)
    return
}
// compare
```

Looks fine. But under `-update`, the test exits with `return` rather than calling any further assertions. If the test had additional checks after `assertGolden`, they are skipped under `-update`. The developer regenerates a golden and a subsequent assertion (e.g. "exit code must be 0") is silently bypassed.

**Diagnosis.** The early return is appropriate for the helper itself but not as a general pattern. Make sure the helper only short-circuits its own golden assertion, not the entire test. Better: do not put critical assertions after `assertGolden`; either inline them earlier or in a separate test.

[← Back](../)
