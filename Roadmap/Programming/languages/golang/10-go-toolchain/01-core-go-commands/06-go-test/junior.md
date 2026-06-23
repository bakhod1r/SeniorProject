# go test — Junior

## 1. What does `go test` do?

`go test` **builds and runs the tests** in your packages and reports pass/fail. It finds functions named `TestXxx` in `_test.go` files, runs them, and tells you what passed.

```bash
go test ./...
```

This runs every test in your module and prints `ok` or `FAIL` per package.

Testing is built into the Go toolchain — no external test runner needed.

---

## 2. Prerequisites
- Go 1.21+.
- A package with some code to test.
- Familiarity with the `testing` package basics.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **`_test.go`** | A file holding tests; not compiled into your normal build |
| **`TestXxx`** | A test function: `func TestX(t *testing.T)` |
| **`t.Error` / `t.Fatal`** | Report a failure (Fatal stops the test) |
| **Table test** | One test function looping over many cases |
| **`-run`** | Run only tests matching a pattern |
| **`-v`** | Verbose output (per-test results) |
| **Test cache** | Stored results so unchanged tests are not re-run |

---

## 4. A minimal worked example

`math.go`:

```go
package math

func Add(a, b int) int { return a + b }
```

`math_test.go`:

```go
package math

import "testing"

func TestAdd(t *testing.T) {
	got := Add(2, 3)
	if got != 5 {
		t.Errorf("Add(2,3) = %d; want 5", got)
	}
}
```

Run it:

```bash
go test            # ok   example.com/math   0.001s
go test -v         # === RUN TestAdd / --- PASS: TestAdd / PASS
```

---

## 5. The most common invocations

```bash
go test                 # test the current package
go test ./...           # test every package in the module
go test -v ./...        # verbose (show each test)
go test -run TestAdd    # run only tests matching "TestAdd"
go test ./pkg/...       # test a subtree
```

`go test ./...` is the everyday command; `-v` and `-run` are the flags you reach for most.

---

## 6. Reading the output

```
--- FAIL: TestAdd (0.00s)
    math_test.go:8: Add(2,3) = 6; want 5
FAIL
exit status 1
FAIL    example.com/math    0.002s
```

- `--- FAIL: TestAdd` names the failing test.
- The line `math_test.go:8: ...` is your `t.Errorf` message and location.
- The package line shows the overall result. A non-zero exit means failure (used by CI).

---

## 7. Running specific tests with `-run`

`-run` takes a regular expression matched against test names:

```bash
go test -run TestAdd          # tests whose name contains "TestAdd"
go test -run '^TestAdd$'      # exactly TestAdd
go test -run 'Add|Sub'        # tests matching Add OR Sub
go test -v -run TestAdd/case1 # a subtest named case1
```

This is how you iterate on one failing test without running the whole suite.

---

## 8. Table-driven tests (the Go idiom)

```go
func TestAdd(t *testing.T) {
	cases := []struct {
		name string
		a, b, want int
	}{
		{"positives", 2, 3, 5},
		{"with zero", 0, 7, 7},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Add(c.a, c.b); got != c.want {
				t.Errorf("Add(%d,%d) = %d; want %d", c.a, c.b, got, c.want)
			}
		})
	}
}
```

`t.Run` creates **subtests** you can target with `-run TestAdd/positives`.

---

## 9. Common beginner mistakes

- **Wrong file name.** Tests must be in files ending `_test.go`.
- **Wrong function signature.** It must be `func TestXxx(t *testing.T)` with a capital after `Test`.
- **Using `fmt.Println` to "check".** Use `t.Error`/`t.Fatalf` so failures are real failures.
- **Surprised tests do not re-run.** Go caches passing test results; unchanged code shows `(cached)`.

---

## 10. Summary

`go test` builds and runs your `TestXxx` functions and reports pass/fail with a non-zero exit on failure. Use `go test ./...` to run everything, `-v` for detail, and `-run <regex>` to focus on specific tests or subtests. Write table-driven tests with `t.Run` for clean, targeted cases. Testing is part of the toolchain — there is nothing extra to install.

---

## Further reading
- `go help test`, `go help testflag`
- `testing` package: https://pkg.go.dev/testing
- Add a test (tutorial): https://go.dev/doc/tutorial/add-a-test
