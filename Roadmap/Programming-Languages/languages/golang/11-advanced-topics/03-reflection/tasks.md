# Reflection — Hands-on Tasks

Work through these in order. Use Go 1.22+.

---

## Task 1: Print any value

Write a function `dump(v any)` that prints the type and value, working for any input.

**Acceptance criteria**
- [ ] Handles ints, strings, slices, maps, and structs.
- [ ] Recursively prints struct fields with `name=value`.
- [ ] Doesn't panic on `nil` input.

---

## Task 2: Settability practice

```go
type User struct {
    Name string
    Age  int
}

func set(u User, name string, age int) { /* try this */ }
func setPtr(u *User, name string, age int) { /* and this */ }
```

**Acceptance criteria**
- [ ] You demonstrate that `set` cannot modify the struct.
- [ ] `setPtr` uses reflection to mutate `Name` and `Age` through the pointer.
- [ ] You explain in one sentence why one works and the other doesn't.

---

## Task 3: Env loader

Build a function `LoadEnv(target any)` that:

- Takes a pointer to a struct.
- For each exported field, reads the `env:"NAME"` tag.
- Looks up the env var and sets the field if present.
- Supports `string`, `int`, and `bool` field types.

**Acceptance criteria**
- [ ] Works for a struct with at least one field of each supported type.
- [ ] Skips fields without the `env` tag.
- [ ] Returns an error for fields with the tag but a type it can't decode.

---

## Task 4: Struct walker

Build a `Walk(v any, fn func(name string, value any))` that calls `fn` for every (exported) field of a struct, recursing into nested structs.

**Acceptance criteria**
- [ ] Handles a struct with at least one nested struct.
- [ ] Reports the dotted name (`Outer.Inner.Field`).
- [ ] Skips unexported fields.

---

## Task 5: Plan-cached decoder

Build a string→struct decoder. Inputs:

- A pointer to a struct with field tags `key:"foo"`.
- A `map[string]string`.

**Acceptance criteria**
- [ ] On first call for a type, the function reflects and builds a plan.
- [ ] On subsequent calls for the same type, it reuses the cached plan (verify with a counter).
- [ ] Bench shows the second call is ≥5× faster than the first.

---

## Task 6: Method dispatch table

Given an interface with three methods (`Create`, `Read`, `Delete`) implemented by a struct, dispatch based on a string name read at runtime.

**Acceptance criteria**
- [ ] Uses `MethodByName` to find the right method.
- [ ] Returns an error if the name doesn't match.
- [ ] You then rewrite using a `map[string]func(...)` and bench the difference.

---

## Task 7: DeepEqual vs go-cmp

```go
a := []int{}
b := []int(nil)
```

**Acceptance criteria**
- [ ] You confirm `reflect.DeepEqual(a, b)` is false.
- [ ] You confirm `cmp.Equal(a, b, cmpopts.EquateEmpty())` is true.
- [ ] You write a one-paragraph note for the team explaining when to use which.

---

## Task 8: Tag parser

Build a parser for a complex tag string: `name,omitempty,default=X,validate=email`.

**Acceptance criteria**
- [ ] Parses the comma-separated parts into a struct.
- [ ] Handles `key=value` correctly (e.g., `default=X`).
- [ ] Has at least 5 unit tests including edge cases.

---

## Task 9: MakeFunc wrapper

Wrap any function with logging:

```go
func Wrap(orig any) any { /* ... */ }
```

**Acceptance criteria**
- [ ] Returned function has the same signature as the original.
- [ ] Logs "calling" and "returned" around each call.
- [ ] Works for at least two different function signatures.

---

## Task 10: Implement a sub-`Stringer`

Write a function `String(v any) string` that:

- If `v` implements `fmt.Stringer`, calls `String()`.
- Else, uses reflection to render the value generically.

**Acceptance criteria**
- [ ] Type assertion path runs first (fast).
- [ ] Reflection path runs only when needed.
- [ ] Bench shows the assertion path is much faster.

---

## Task 11: Build an offset table

Given a struct type, build a slice of (`name`, `offset`, `kind`) for every exported field.

**Acceptance criteria**
- [ ] Output includes offsets in bytes.
- [ ] You verify offsets by allocating a struct and pointing at a field via `unsafe.Add`.
- [ ] You explain how this enables zero-reflection field access at runtime.

---

## Task 12: Replace reflection with generics

Pick a small helper that uses reflection (e.g., `Map(s []any, fn func(any) any) []any`). Rewrite it using generics.

**Acceptance criteria**
- [ ] Type-safe at compile time.
- [ ] No reflection.
- [ ] Bench shows zero allocations.

---

## Stretch — Task 13: A toy JSON encoder

Write `encode(v any) ([]byte, error)` that supports:

- Booleans, numbers, strings.
- Slices and maps (top-level only is fine).
- Structs with exported fields.

**Acceptance criteria**
- [ ] Produces valid JSON for the supported types.
- [ ] Plans per type are cached.
- [ ] Bench against `encoding/json` and report the ratio.
- [ ] Honors `json:"name,omitempty"` tags.

---

## Submission

For each task: code, the test or bench output, and 2–3 lines explaining the design choice. These artifacts demonstrate not just understanding but the ability to apply reflection responsibly.
