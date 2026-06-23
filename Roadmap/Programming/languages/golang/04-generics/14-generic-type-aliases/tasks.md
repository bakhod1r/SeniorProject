# Generic Type Aliases — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task highlights **how generic aliases help** — usually by asking you to refactor an existing package or migrate a type.

All tasks assume Go 1.24 or newer.

---

## Easy 🟢

### Task 1 — Convert a verbose map signature to an alias
You have:
```go
func Add(idx map[string][]int, key string, v int) { idx[key] = append(idx[key], v) }
```
Define `type Index[T any] = map[string][]T` and rewrite `Add` to use it.

### Task 2 — Friendly slice alias
Define `type Vec[T any] = []T`. Write a function `func Sum(v Vec[int]) int` that sums the elements.

### Task 3 — Map alias with constraint
Define `type Set[T comparable] = map[T]struct{}`. Write a function `Contains[T comparable](s Set[T], v T) bool`.

### Task 4 — Re-export from a sibling package
Given:
```go
// package container
type List[T any] struct { data []T }
func (l *List[T]) Append(v T) { l.data = append(l.data, v) }
```
Write a sibling package `mypkg` that re-exports `container.List` as `mypkg.List`.

### Task 5 — Rename type parameter
Take `type Pair[A, B any] = struct{ First A; Second B }` and rewrite it using parameter names `K, V` instead. Discuss whether this rename is a good idea.

---

## Medium 🟡

### Task 6 — Migrate a type between packages
You have package `pkg/old` with `type Result[T any] struct { Value T; Err error }`. Move the type to `pkg/new`, leaving an alias in `pkg/old` so callers stay compatible.

### Task 7 — Alias chain
Define three aliases that all resolve to `[]int`:
```go
type A[T any] = []T
type B[T any] = A[T]
type C = B[int]
```
Verify in code that `var x C = []int{1, 2, 3}` works.

### Task 8 — Constraint propagation
Given:
```go
package bar
type Set[T comparable] map[T]struct{}
```
Try:
```go
type Loose[T any] = bar.Set[T]
```
What happens? Fix the alias.

### Task 9 — Embedding through alias
Define `type Base[T any] = container.List[T]` (where `container.List[T]` has methods). Now embed `Base[int]` in a struct `Outer` and call `Outer.Append(1)`.

### Task 10 — Re-export with deprecation
Re-export `newpkg.Cache[K, V]` as `mypkg.Cache[K, V]` with a `Deprecated:` comment. Write a small main package that uses the deprecated alias and observe the warning.

### Task 11 — Alias of generic type to fully specialised
Define `type Bytes = Vec[byte]`. Pass a `[]byte` literal to a function expecting `Bytes` without conversion.

### Task 12 — Migrate a struct
Move `type User struct { ID int; Name string }` from `auth` to `user`. Add a generic alias that wraps a generic container parameterised over `User`:
```go
type UserList = container.List[user.User]
```

### Task 13 — Build a tiny constraints package
In package `constraints`, alias common stdlib constraints:
```go
type Ordered = cmp.Ordered
type Number[T any] = ... // think carefully about how to express "any number"
```
Discuss the limits of using aliases for constraints.

### Task 14 — Rewrite a wrapper as an alias
Given a pre-1.24 wrapper:
```go
type Stack[T any] struct { inner internal.Stack[T] }
func (s *Stack[T]) Push(v T) { s.inner.Push(v) }
func (s *Stack[T]) Pop() (T, bool) { return s.inner.Pop() }
```
Replace it with a generic alias. What changes for callers?

---

## Hard 🔴

### Task 15 — Compare aliases to defined types
Write two declarations:
```go
type AliasVec[T any] = []T
type DefinedVec[T any] []T
```
Demonstrate three differences with code: assignability to `[]int`, declaring methods, identity in a type switch.

### Task 16 — Two-package migration with deprecation window
Imagine your library v1 had `type Result[T any] struct { ... }` exported from `pkg/v1`. In v2 you want `pkg/v2/result` to own the type. Plan a deprecation window using generic aliases: which file changes in v1, which in v2, what comments go where.

### Task 17 — Aliasing for facade design
Design a `package api` that re-exports the public types of `package transport` and `package auth` as a single curated entry point. List the aliases you need. Add `Deprecated:` comments where appropriate.

### Task 18 — Generic alias for a constraint type
Define `type MyOrdered = cmp.Ordered`. Use it to constrain a generic function. What happens if Go later changes `cmp.Ordered`? Discuss stability.

### Task 19 — Refactor a real-world pre-1.24 codebase
Given:
```go
package db
type Cursor[T any] struct { ... }

package legacy
import "example.com/db"
type Cursor[T any] db.Cursor[T] // defined type — loses methods
```
Rewrite `legacy.Cursor` as a generic alias. Show the diff that one-line change produces for downstream callers.

---

## Expert 🟣

### Task 20 — Build a re-exporting "umbrella" package
Suppose your project has eight sub-packages each exporting a generic type. Write a top-level umbrella package that aliases all eight. Discuss: when is this a good idea, when is it not?

### Task 21 — Constraint-aware alias design
Given a generic type `Cache[K comparable, V any]`, write three aliases:
- `IntCache[V any] = Cache[int, V]`
- `StringCache[V any] = Cache[string, V]`
- `IntStringCache = Cache[int, string]`
Use them in tests. Where does inference need help, and where does it just work?

### Task 22 — Migration with `GOEXPERIMENT` history
Suppose your codebase wants to support Go 1.22, 1.23, and 1.24 with a single source. Show two strategies: (a) using build tags to conditionally compile the generic alias, (b) bumping the minimum Go version. Compare costs.

---

## Solutions

### Solution 1
```go
type Index[T any] = map[string][]T

func Add[T any](idx Index[T], key string, v T) {
    idx[key] = append(idx[key], v)
}
```
The body is unchanged because `Index[T]` IS `map[string][]T`.

### Solution 2
```go
type Vec[T any] = []T

func Sum(v Vec[int]) int {
    total := 0
    for _, x := range v { total += x }
    return total
}
```
Callers can pass `[]int` literals directly: `Sum([]int{1, 2, 3})`.

### Solution 3
```go
type Set[T comparable] = map[T]struct{}

func Contains[T comparable](s Set[T], v T) bool {
    _, ok := s[v]
    return ok
}
```

### Solution 4
```go
// package mypkg
package mypkg

import "example.com/container"

type List[T any] = container.List[T]
```
Callers using `mypkg.List[int]` get the same type as `container.List[int]`, including all methods.

### Solution 5
```go
type Pair[K, V any] = struct{ First K; Second V }
```
Renaming is fine, but `K, V` traditionally means key/value. For a generic pair the convention is `A, B` or `T, U`. Mismatched conventions confuse readers.

### Solution 6
```go
// pkg/new
package new
type Result[T any] struct {
    Value T
    Err   error
}

// pkg/old
package old
import "example.com/pkg/new"

// Deprecated: use new.Result.
type Result[T any] = new.Result[T]
```
Existing callers using `old.Result[int]` keep working.

### Solution 7
```go
type A[T any] = []T
type B[T any] = A[T]
type C = B[int]

var x C = []int{1, 2, 3} // OK — C is []int
```
Each link in the chain is identity-preserving.

### Solution 8
```go
type Loose[T any] = bar.Set[T] // ERROR: T does not satisfy comparable
```
Fix by matching the constraint:
```go
type Strict[T comparable] = bar.Set[T]
```

### Solution 9
```go
type Base[T any] = container.List[T]

type Outer struct {
    Base[int]
}

o := Outer{}
o.Append(1) // Method promoted through embedding
```

### Solution 10
```go
package mypkg

import "example.com/newpkg"

// Cache is an alias for newpkg.Cache to preserve backwards compatibility.
//
// Deprecated: use newpkg.Cache.
type Cache[K comparable, V any] = newpkg.Cache[K, V]
```
`gopls` and `staticcheck` will flag uses of `mypkg.Cache` with the deprecation note.

### Solution 11
```go
type Vec[T any] = []T
type Bytes = Vec[byte]

func Print(b Bytes) { fmt.Println(b) }

Print([]byte{'h','i'}) // OK — Bytes is []byte
```

### Solution 12
```go
package user
type User struct { ID int; Name string }

package container
type List[T any] struct { data []T }
func (l *List[T]) Append(v T) { l.data = append(l.data, v) }

package services
import (
    "example.com/container"
    "example.com/user"
)
type UserList = container.List[user.User]
```

### Solution 13
```go
package constraints

import "cmp"

type Ordered = cmp.Ordered

// You cannot directly alias a constraint built from a union; you must
// declare it as an interface. Aliases work for already-named constraint types.
```
Aliases work fine for already-named constraints. For ad-hoc unions, you need a regular `type ... interface { ... }` declaration.

### Solution 14
```go
type Stack[T any] = internal.Stack[T]
```
Three lines deleted. Methods are inherited because the alias preserves identity. Callers see no change.

### Solution 15
```go
type AliasVec[T any]   = []T
type DefinedVec[T any] []T

// 1. Assignability
var a AliasVec[int]   = []int{1}
var d DefinedVec[int] = []int{1}
var s []int = a // OK
// var s2 []int = d // ERROR — needs []int(d)

// 2. Declaring methods
// func (v AliasVec[T]) Len() int { return len(v) } // ERROR
func (v DefinedVec[T]) Len() int { return len(v) } // OK

// 3. Type switch
switch any(s).(type) {
case AliasVec[int]:   // matches []int
}
switch any(s).(type) {
case DefinedVec[int]: // does NOT match []int
}
```

### Solution 16
```go
// pkg/v2/result/result.go
package result
type Result[T any] struct { Value T; Err error }

// pkg/v1/v1.go
package v1
import "example.com/pkg/v2/result"
// Deprecated: use result.Result.
type Result[T any] = result.Result[T]
```
Two file edits, no caller breakage. After two releases, remove the alias and bump v1 to v2 imports.

### Solution 17
```go
package api

import (
    "example.com/transport"
    "example.com/auth"
)

type (
    Request[B any]  = transport.Request[B]
    Response[B any] = transport.Response[B]
    Token           = auth.Token
)
```
Use `Deprecated:` on names you want to phase out, and add comments explaining the curated entry point.

### Solution 18
```go
type MyOrdered = cmp.Ordered

func Min[T MyOrdered](a, b T) T {
    if a < b { return a }
    return b
}
```
If Go ever changes `cmp.Ordered`, your alias automatically follows. This is usually a feature, but it does mean your library inherits stdlib changes.

### Solution 19
Before:
```go
package legacy
import "example.com/db"
type Cursor[T any] db.Cursor[T] // no methods inherited
```
After:
```go
package legacy
import "example.com/db"
type Cursor[T any] = db.Cursor[T]
```
The diff is one line: `=`. Downstream callers using `legacy.Cursor[int]` now get the same type as `db.Cursor[int]`, with all methods available.

### Solution 20
```go
package umbrella

import (
    a "example.com/foo/a"
    b "example.com/foo/b"
    // ...
)

type (
    AType[T any] = a.Type[T]
    BType[T any] = b.Type[T]
    // ...
)
```
Good when: customers want a single import; your sub-packages are stable; the umbrella package is purely re-exports.

Bad when: you tempt yourself to add behaviour to the umbrella; consumers are confused about which is the canonical name; your sub-packages are still moving.

### Solution 21
```go
type IntCache[V any]    = Cache[int, V]
type StringCache[V any] = Cache[string, V]
type IntStringCache     = Cache[int, string]

c1 := IntCache[string]{} // V = string; K is fixed to int
c2 := IntStringCache{}   // both fixed
_ = c1
_ = c2
```
Fully specialised aliases (`IntStringCache`) lose all type-parameter ergonomics. Partially specialised aliases (`IntCache`) preserve one parameter. Inference works on the remaining parameters as expected.

### Solution 22
**Strategy A — Build tags**
```go
//go:build go1.24

package mypkg
type List[T any] = bar.List[T]
```
And a fallback file:
```go
//go:build !go1.24

package mypkg
type List[T any] bar.List[T] // defined type — accepted by older toolchains
```
Cost: two paths to maintain, semantic differences (defined vs alias), risk of subtle bugs.

**Strategy B — Bump the minimum**
Set `go.mod`'s `go` directive to `1.24`. Cost: any consumer on older toolchains is excluded. For most libraries this is the cleaner long-term path.

The right answer depends on your audience. Library authors who serve enterprise customers often pay the build-tag cost; application teams usually just bump.

---

## Final notes

These tasks are deliberately migration-flavoured. The real lesson is **identity**: every solution should preserve the underlying type's identity through the alias. The point is not the new syntax; it is what generic aliases let you stop doing — wrapping, forwarding, and breaking compatibility.
