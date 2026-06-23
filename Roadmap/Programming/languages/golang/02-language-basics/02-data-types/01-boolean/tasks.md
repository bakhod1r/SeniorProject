# Boolean — Tasks

## Overview
10 hands-on tasks covering boolean fundamentals, patterns, and real-world applications in Go.

---

## Task 1: Boolean Zero Values

**Type:** Exploration
**Goal:** Understand zero values and variable initialization for `bool`

```go
package main

import "fmt"

type UserProfile struct {
    Name      string
    IsActive  bool
    IsPremium bool
    IsAdmin   bool
}

func main() {
    // TODO 1: Declare a bool variable without initializing it and print its value
    // Expected: false

    // TODO 2: Create a UserProfile with only Name set, print all bool fields
    // Expected: IsActive=false, IsPremium=false, IsAdmin=false

    // TODO 3: Print the zero value of a bool in a slice of 3 booleans
    // Expected: [false false false]

    // TODO 4: Initialize a bool map and print the value of a missing key
    // Expected: false
}
```

**Expected Output:**
```
false
{Alice false false false}
[false false false]
false
```

**Evaluation Checklist:**
- [ ] Uses `var b bool` for zero value demonstration
- [ ] Creates struct without bool initialization
- [ ] Creates `[]bool` with make or literal
- [ ] Accesses missing map key and observes zero value

---

## Task 2: Logical Operators

**Type:** Practice
**Goal:** Use `&&`, `||`, `!` correctly and understand truth tables

```go
package main

import "fmt"

func main() {
    a := true
    b := false
    c := true

    // TODO 1: Print the result of a AND b
    // TODO 2: Print the result of a OR b
    // TODO 3: Print the result of NOT a
    // TODO 4: Print the result of (a AND b) OR c
    // TODO 5: Print the result of NOT (a OR b)
    // TODO 6: Print the result of a AND (b OR c)

    // TODO 7: Verify De Morgan's Law:
    // Show that !(a && b) equals (!a || !b)
    _ = fmt.Println
}
```

**Expected Output:**
```
a && b = false
a || b = true
!a = false
(a && b) || c = true
!(a || b) = false
a && (b || c) = true
DeMorgan verified: !(a&&b) == (!a||!b): true
```

**Evaluation Checklist:**
- [ ] All 6 expressions computed correctly
- [ ] De Morgan's law verified programmatically
- [ ] No `== true` or `== false` comparisons

---

## Task 3: Short-Circuit Evaluation

**Type:** Debug/Understand
**Goal:** Demonstrate and verify short-circuit evaluation behavior

```go
package main

import "fmt"

var callCount int

func expensiveCheck(name string) bool {
    callCount++
    fmt.Printf("  [called: %s]\n", name)
    return true
}

func main() {
    // TODO 1: Show that expensiveCheck is NOT called when first condition is false
    // Expression: false && expensiveCheck("A")
    callCount = 0
    // YOUR CODE HERE
    fmt.Println("Times called (should be 0):", callCount)

    // TODO 2: Show that expensiveCheck IS called when first condition is true
    // Expression: true && expensiveCheck("B")
    callCount = 0
    // YOUR CODE HERE
    fmt.Println("Times called (should be 1):", callCount)

    // TODO 3: Show that expensiveCheck is NOT called when first OR is true
    // Expression: true || expensiveCheck("C")
    callCount = 0
    // YOUR CODE HERE
    fmt.Println("Times called (should be 0):", callCount)

    // TODO 4: Write a safe nil-pointer check using short-circuit
    type Node struct{ Value int }
    var ptr *Node // nil pointer

    // TODO: check ptr != nil AND ptr.Value > 0 safely (no panic)
    if false {
        fmt.Println("This should not print")
    }
    fmt.Println("Nil check passed safely")
}
```

**Expected Output:**
```
Times called (should be 0): 0
  [called: B]
Times called (should be 1): 1
Times called (should be 0): 0
Nil check passed safely
```

**Evaluation Checklist:**
- [ ] Uses `&&` with short-circuit to prevent unnecessary function call
- [ ] Uses `||` with short-circuit correctly
- [ ] Nil pointer check places nil check before dereference
- [ ] Counter correctly reflects call behavior

---

## Task 4: Predicate Functions

**Type:** Implementation
**Goal:** Write clean boolean-returning (predicate) functions

```go
package main

import (
    "fmt"
    "strings"
)

// TODO 1: Implement isEven(n int) bool
// Returns true if n is even

// TODO 2: Implement isPrime(n int) bool
// Returns true if n is a prime number

// TODO 3: Implement isValidEmail(email string) bool
// Returns true if email contains "@" and has at least 5 characters

// TODO 4: Implement isPalindrome(s string) bool
// Returns true if s reads the same forwards and backwards

func main() {
    // Test isEven
    fmt.Println(isEven(4))  // true
    fmt.Println(isEven(7))  // false

    // Test isPrime
    fmt.Println(isPrime(7))  // true
    fmt.Println(isPrime(9))  // false
    fmt.Println(isPrime(2))  // true

    // Test isValidEmail
    fmt.Println(isValidEmail("alice@example.com")) // true
    fmt.Println(isValidEmail("notanemail"))         // false

    // Test isPalindrome
    fmt.Println(isPalindrome("racecar")) // true
    fmt.Println(isPalindrome("hello"))   // false

    _ = strings.Contains
}
```

**Expected Output:**
```
true
false
true
false
true
true
false
true
false
```

**Evaluation Checklist:**
- [ ] `isEven` uses modulo operator
- [ ] `isPrime` handles edge cases (n < 2)
- [ ] `isValidEmail` checks both length and `@` presence
- [ ] `isPalindrome` compares string with its reverse

---

## Task 5: Boolean in Structs — Feature Flags

**Type:** Implementation
**Goal:** Use boolean struct fields to implement a feature flag system

```go
package main

import "fmt"

type Feature struct {
    Name    string
    Enabled bool
}

type FeatureRegistry struct {
    // TODO: add a field to store features
    // Hint: map[string]bool or []Feature
}

// TODO: implement NewFeatureRegistry() *FeatureRegistry

// TODO: implement (r *FeatureRegistry) Enable(name string)

// TODO: implement (r *FeatureRegistry) Disable(name string)

// TODO: implement (r *FeatureRegistry) IsEnabled(name string) bool
// Returns false for unknown flags (safe default)

// TODO: implement (r *FeatureRegistry) Toggle(name string)
// Flips the current value

func main() {
    registry := NewFeatureRegistry()

    registry.Enable("dark_mode")
    registry.Enable("new_checkout")

    fmt.Println(registry.IsEnabled("dark_mode"))     // true
    fmt.Println(registry.IsEnabled("new_checkout"))  // true
    fmt.Println(registry.IsEnabled("unknown_flag"))  // false

    registry.Disable("dark_mode")
    fmt.Println(registry.IsEnabled("dark_mode"))     // false

    registry.Toggle("new_checkout")
    fmt.Println(registry.IsEnabled("new_checkout"))  // false

    registry.Toggle("new_checkout")
    fmt.Println(registry.IsEnabled("new_checkout"))  // true
}
```

**Expected Output:**
```
true
true
false
false
false
true
```

**Evaluation Checklist:**
- [ ] Registry uses a map internally
- [ ] `IsEnabled` returns `false` for unknown flags (zero value safety)
- [ ] `Toggle` correctly inverts the current value
- [ ] Methods have pointer receivers
- [ ] No `== true` comparisons

---

## Task 6: Guard Clauses

**Type:** Refactoring
**Goal:** Rewrite deeply nested boolean logic using guard clauses

```go
package main

import (
    "fmt"
    "errors"
)

type User struct {
    ID       int
    Name     string
    IsActive bool
    IsAdmin  bool
    Age      int
}

// TODO: Rewrite this function using guard clauses to reduce nesting
func processAdminAction_Original(user *User, action string) error {
    if user != nil {
        if user.IsActive {
            if user.IsAdmin {
                if user.Age >= 18 {
                    if action != "" {
                        fmt.Printf("Admin %s executing: %s\n", user.Name, action)
                        return nil
                    } else {
                        return errors.New("action cannot be empty")
                    }
                } else {
                    return errors.New("user must be 18 or older")
                }
            } else {
                return errors.New("user is not an admin")
            }
        } else {
            return errors.New("user is not active")
        }
    } else {
        return errors.New("user cannot be nil")
    }
}

// TODO: Implement processAdminAction using guard clauses
func processAdminAction(user *User, action string) error {
    // Guard 1: user != nil
    // Guard 2: user.IsActive
    // Guard 3: user.IsAdmin
    // Guard 4: user.Age >= 18
    // Guard 5: action != ""
    // Main logic: print and return nil
    return nil // placeholder
}

func main() {
    u := &User{ID: 1, Name: "Alice", IsActive: true, IsAdmin: true, Age: 25}

    fmt.Println(processAdminAction(u, "delete_user"))        // nil
    fmt.Println(processAdminAction(nil, "action"))            // user cannot be nil
    fmt.Println(processAdminAction(u, ""))                    // action cannot be empty
    fmt.Println(processAdminAction(&User{IsAdmin: true}, "x")) // user is not active
}
```

**Expected Output:**
```
Admin Alice executing: delete_user
<nil>
user cannot be nil
action cannot be empty
user is not active
```

**Evaluation Checklist:**
- [ ] Nesting level is max 1 (all guards at top level)
- [ ] Each guard returns early with an error
- [ ] Main logic is at the end with minimal nesting
- [ ] All error messages match expected output

---

## Task 7: Boolean as Set (map[string]bool)

**Type:** Implementation
**Goal:** Use `map[string]bool` to implement set operations

```go
package main

import "fmt"

// TODO: implement union(a, b map[string]bool) map[string]bool
// Returns a set with all elements from both a and b

// TODO: implement intersection(a, b map[string]bool) map[string]bool
// Returns a set with only elements in BOTH a and b

// TODO: implement difference(a, b map[string]bool) map[string]bool
// Returns a set with elements in a but NOT in b

// TODO: implement contains(set map[string]bool, elem string) bool
// Returns true if elem is in the set

func main() {
    fruits := map[string]bool{
        "apple": true, "banana": true, "cherry": true,
    }
    tropical := map[string]bool{
        "banana": true, "mango": true, "papaya": true,
    }

    fmt.Println("Contains apple:", contains(fruits, "apple"))    // true
    fmt.Println("Contains mango:", contains(fruits, "mango"))    // false

    u := union(fruits, tropical)
    fmt.Println("Union size:", len(u))         // 5

    i := intersection(fruits, tropical)
    fmt.Println("Intersection:", i["banana"])  // true
    fmt.Println("Intersection size:", len(i))  // 1

    d := difference(fruits, tropical)
    fmt.Println("Difference size:", len(d))    // 2 (apple, cherry)
    fmt.Println("Difference has apple:", d["apple"])  // true
    fmt.Println("Difference has banana:", d["banana"]) // false
}
```

**Expected Output:**
```
Contains apple: true
Contains mango: false
Union size: 5
Intersection: true
Intersection size: 1
Difference size: 2
Difference has apple: true
Difference has banana: false
```

**Evaluation Checklist:**
- [ ] `union` includes all elements from both sets
- [ ] `intersection` includes only common elements
- [ ] `difference` includes elements in a but not b
- [ ] `contains` returns false for missing keys
- [ ] No duplicate entries in union

---

## Task 8: Boolean Accumulation with Validation

**Type:** Implementation
**Goal:** Build a multi-rule validator that accumulates boolean results

```go
package main

import (
    "fmt"
    "strings"
)

type ValidationResult struct {
    Valid    bool
    Errors   []string
}

type Password struct {
    Value string
}

// TODO: Implement validatePassword(p Password) ValidationResult
// Rules:
// 1. Length >= 8: "password too short"
// 2. Contains at least one uppercase letter: "must contain uppercase"
// 3. Contains at least one digit: "must contain a digit"
// 4. Contains at least one special char (!@#$%): "must contain special character"
// 5. Valid.true only if ALL rules pass

func main() {
    tests := []Password{
        {"StrongP@ss1"},
        {"short"},
        {"alllowercase1!"},
        {"ALLUPPERCASE1!"},
        {"NoDigitsHere!"},
        {"ValidPassword1!"},
    }

    for _, p := range tests {
        result := validatePassword(p)
        if result.Valid {
            fmt.Printf("'%s': VALID\n", p.Value)
        } else {
            fmt.Printf("'%s': INVALID - %s\n", p.Value, strings.Join(result.Errors, ", "))
        }
    }
}
```

**Expected Output:**
```
'StrongP@ss1': VALID
'short': INVALID - password too short, must contain uppercase, must contain a digit, must contain special character
'alllowercase1!': INVALID - must contain uppercase
'ALLUPPERCASE1!': INVALID - must contain a digit
'NoDigitsHere!': INVALID - must contain a digit
'ValidPassword1!': VALID
```

**Evaluation Checklist:**
- [ ] All 4 rules implemented correctly
- [ ] `ValidationResult.Valid` is false when any rule fails
- [ ] Multiple errors collected (not early exit)
- [ ] Uses `strings.ContainsAny` or similar for character checks

---

## Task 9: Boolean in Concurrent Code

**Type:** Implementation
**Goal:** Safely use a boolean flag across multiple goroutines

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

// TODO: Implement a SafeFlag that can be read/written from multiple goroutines

type SafeFlag struct {
    // TODO: choose appropriate synchronization mechanism
}

// TODO: implement (f *SafeFlag) Set(value bool)
// TODO: implement (f *SafeFlag) Get() bool
// TODO: implement (f *SafeFlag) Toggle() bool
// Returns the NEW value after toggling

func main() {
    flag := &SafeFlag{}

    var wg sync.WaitGroup

    // 10 goroutines set the flag to true
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            flag.Set(true)
        }()
    }

    // 5 goroutines read the flag
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = flag.Get()
        }()
    }

    wg.Wait()
    fmt.Println("After sets:", flag.Get()) // true

    flag.Set(false)
    fmt.Println("After reset:", flag.Get()) // false

    old := flag.Toggle()
    fmt.Println("After toggle:", flag.Get(), "old was:", old) // true, false

    _ = atomic.LoadInt32
    _ = time.Now
}
```

**Expected Output:**
```
After sets: true
After reset: false
After toggle: true old was: false
```

**Evaluation Checklist:**
- [ ] No data race (run with `go test -race`)
- [ ] Uses atomic or mutex for synchronization
- [ ] `Toggle` returns old value or new value (document which)
- [ ] All goroutines complete before reading final value

---

## Task 10: Boolean in JSON Marshaling/Unmarshaling

**Type:** Implementation
**Goal:** Work with booleans in JSON serialization

```go
package main

import (
    "encoding/json"
    "fmt"
)

type AppSettings struct {
    DarkMode      bool `json:"dark_mode"`
    Notifications bool `json:"notifications"`
    AutoSave      bool `json:"auto_save"`
    Language      string `json:"language"`
}

func main() {
    // TODO 1: Marshal the following settings to JSON
    settings := AppSettings{
        DarkMode:      true,
        Notifications: false,
        AutoSave:      true,
        Language:      "en",
    }
    // YOUR CODE: marshal settings to JSON and print
    // Expected: {"dark_mode":true,"notifications":false,"auto_save":true,"language":"en"}

    // TODO 2: Unmarshal this JSON back to AppSettings
    jsonStr := `{"dark_mode":false,"notifications":true,"auto_save":false,"language":"uz"}`
    // YOUR CODE: unmarshal jsonStr to AppSettings and print each field

    // TODO 3: What happens when you unmarshal JSON with a missing bool field?
    partialJSON := `{"language":"fr"}`
    var partial AppSettings
    // YOUR CODE: unmarshal partialJSON to partial
    // Print: DarkMode should be false (zero value)
    fmt.Println("Missing bool field:", partial.DarkMode)

    // TODO 4: Handle the case where boolean JSON value is invalid
    invalidJSON := `{"dark_mode":"yes"}`
    var invalid AppSettings
    err := json.Unmarshal([]byte(invalidJSON), &invalid)
    if err != nil {
        fmt.Println("Error parsing invalid bool:", err != nil) // true
    }
}
```

**Expected Output:**
```
{"dark_mode":true,"notifications":false,"auto_save":true,"language":"en"}
DarkMode: false, Notifications: true, AutoSave: false, Language: uz
Missing bool field: false
Error parsing invalid bool: true
```

**Evaluation Checklist:**
- [ ] JSON tags are correct
- [ ] Marshal produces compact JSON
- [ ] Unmarshal correctly reads boolean values
- [ ] Missing field defaults to false (zero value)
- [ ] Error handling for invalid JSON bool value

---

## Bonus Task: Implement `All`, `Any`, `None` Boolean Reducers

**Type:** Functional Programming
**Goal:** Practice functional boolean patterns

```go
package main

import "fmt"

// TODO: implement All(fns ...func() bool) bool
// Returns true if ALL functions return true (lazy evaluation)

// TODO: implement Any(fns ...func() bool) bool
// Returns true if ANY function returns true (lazy evaluation)

// TODO: implement None(fns ...func() bool) bool
// Returns true if NO function returns true

func main() {
    isPositive := func(x int) func() bool {
        return func() bool { return x > 0 }
    }

    fmt.Println(All(isPositive(1), isPositive(2), isPositive(3)))   // true
    fmt.Println(All(isPositive(1), isPositive(-1), isPositive(3)))  // false

    fmt.Println(Any(isPositive(-1), isPositive(-2), isPositive(3))) // true
    fmt.Println(Any(isPositive(-1), isPositive(-2), isPositive(-3))) // false

    fmt.Println(None(isPositive(-1), isPositive(-2))) // true
    fmt.Println(None(isPositive(1), isPositive(-2)))  // false
}
```

**Expected Output:**
```
true
false
true
false
true
false
```

**Evaluation Checklist:**
- [ ] `All` stops at first false (short-circuit)
- [ ] `Any` stops at first true (short-circuit)
- [ ] `None` returns true only if all return false
- [ ] All use lazy evaluation (functions, not pre-evaluated booleans)
