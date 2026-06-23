# const and iota — Tasks

## Overview

This file contains 12 progressively challenging hands-on tasks that build real-world skills with Go's `const` and `iota`. Each task includes:
- A clear objective
- Starter code
- Requirements checklist
- Hints
- Expected output or behavior

Complete each task in order. Tasks 1–4 are beginner, 5–8 are intermediate, 9–12 are advanced.

---

## Task 1 — Basic Constants: Replace Magic Numbers

### Objective
Refactor a function that uses magic numbers by replacing them with named constants.

### Background
The function below works but uses raw numbers that are hard to understand. Replace every magic number with a named constant.

### Starter Code

```go
package main

import "fmt"

func classify(score int) string {
    if score >= 90 {
        return "A"
    } else if score >= 80 {
        return "B"
    } else if score >= 70 {
        return "C"
    } else if score >= 60 {
        return "D"
    }
    return "F"
}

func isValidAge(age int) bool {
    return age >= 0 && age <= 150
}

func httpDescription(code int) string {
    switch code {
    case 200:
        return "OK"
    case 404:
        return "Not Found"
    case 500:
        return "Internal Server Error"
    }
    return "Unknown"
}

func main() {
    fmt.Println(classify(85))
    fmt.Println(isValidAge(25))
    fmt.Println(httpDescription(404))
}
```

### Requirements
- [ ] Define a `const` block for grade thresholds
- [ ] Define constants for age limits
- [ ] Define constants for HTTP status codes
- [ ] All original tests still pass

### Hints
- Group related constants together in one `const ( ... )` block
- Use descriptive names: `GradeAMin`, `GradeBMin`, etc.
- HTTP codes can go in their own block

### Expected Output
```
B
true
Not Found
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

const (
    GradeAMin = 90
    GradeBMin = 80
    GradeCMin = 70
    GradeDMin = 60
)

const (
    MinAge = 0
    MaxAge = 150
)

const (
    StatusOK       = 200
    StatusNotFound = 404
    StatusInternal = 500
)

func classify(score int) string {
    switch {
    case score >= GradeAMin:
        return "A"
    case score >= GradeBMin:
        return "B"
    case score >= GradeCMin:
        return "C"
    case score >= GradeDMin:
        return "D"
    }
    return "F"
}

func isValidAge(age int) bool {
    return age >= MinAge && age <= MaxAge
}

func httpDescription(code int) string {
    switch code {
    case StatusOK:
        return "OK"
    case StatusNotFound:
        return "Not Found"
    case StatusInternal:
        return "Internal Server Error"
    }
    return "Unknown"
}

func main() {
    fmt.Println(classify(85))
    fmt.Println(isValidAge(25))
    fmt.Println(httpDescription(404))
}
```
</details>

---

## Task 2 — Days of the Week Enum

### Objective
Create a type-safe `Weekday` enum using `iota` and add utility methods.

### Starter Code

```go
package main

import "fmt"

// TODO: Define a Weekday type (int)
// TODO: Define constants Sunday through Saturday using iota
// TODO: Add a String() method
// TODO: Add an IsWeekend() method

func main() {
    day := Wednesday // should be 3
    fmt.Println(day)             // should print "Wednesday"
    fmt.Println(day.IsWeekend()) // should print false
    fmt.Println(Saturday.IsWeekend()) // should print true
}
```

### Requirements
- [ ] Define `type Weekday int`
- [ ] Define `Sunday` through `Saturday` using `iota` (Sunday = 0)
- [ ] Implement `func (w Weekday) String() string`
- [ ] Implement `func (w Weekday) IsWeekend() bool` — returns true for Saturday and Sunday
- [ ] `fmt.Println(Wednesday)` must print `Wednesday` (not `3`)

### Hints
- Use `[...]string{"Sunday", "Monday", ...}[w]` for fast lookup
- `IsWeekend()` only needs to check `w == Saturday || w == Sunday`

### Expected Output
```
Wednesday
false
true
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type Weekday int

const (
    Sunday Weekday = iota
    Monday
    Tuesday
    Wednesday
    Thursday
    Friday
    Saturday
)

func (w Weekday) String() string {
    names := [...]string{
        "Sunday", "Monday", "Tuesday", "Wednesday",
        "Thursday", "Friday", "Saturday",
    }
    if w < Sunday || w > Saturday {
        return fmt.Sprintf("Weekday(%d)", int(w))
    }
    return names[w]
}

func (w Weekday) IsWeekend() bool {
    return w == Saturday || w == Sunday
}

func main() {
    day := Wednesday
    fmt.Println(day)
    fmt.Println(day.IsWeekend())
    fmt.Println(Saturday.IsWeekend())
}
```
</details>

---

## Task 3 — File Permission Bit Flags

### Objective
Implement a Unix-inspired file permission system using bit flags and `iota`.

### Starter Code

```go
package main

import "fmt"

// TODO: Define FileMode type (uint)
// TODO: Define ModeRead, ModeWrite, ModeExecute using 1 << iota

// TODO: Implement func (m FileMode) String() string
// Should return a 3-char string like "rw-" or "r-x" or "rwx"

func main() {
    perm := ModeRead | ModeWrite
    fmt.Println(perm)                     // should print "rw-"
    fmt.Println(ModeRead | ModeExecute)   // should print "r-x"
    fmt.Println(ModeRead | ModeWrite | ModeExecute) // should print "rwx"
    fmt.Println(FileMode(0))              // should print "---"
}
```

### Requirements
- [ ] `ModeRead = 1`, `ModeWrite = 2`, `ModeExecute = 4`
- [ ] `String()` returns a 3-character permission string
- [ ] Combining flags with `|` works correctly
- [ ] `FileMode(0)` returns `"---"`

### Hints
- Use conditional: `if m&ModeRead != 0 { s += "r" } else { s += "-" }`
- Build the string character by character

### Expected Output
```
rw-
r-x
rwx
---
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type FileMode uint

const (
    ModeRead    FileMode = 1 << iota // 1
    ModeWrite                        // 2
    ModeExecute                      // 4
)

func (m FileMode) String() string {
    r, w, x := "-", "-", "-"
    if m&ModeRead != 0 {
        r = "r"
    }
    if m&ModeWrite != 0 {
        w = "w"
    }
    if m&ModeExecute != 0 {
        x = "x"
    }
    return r + w + x
}

func main() {
    perm := ModeRead | ModeWrite
    fmt.Println(perm)
    fmt.Println(ModeRead | ModeExecute)
    fmt.Println(ModeRead | ModeWrite | ModeExecute)
    fmt.Println(FileMode(0))
}
```
</details>

---

## Task 4 — Byte Size Constants

### Objective
Implement byte size constants using `iota` expressions and a `ByteSize` type with automatic formatting.

### Starter Code

```go
package main

import "fmt"

type ByteSize float64

// TODO: Define KB, MB, GB, TB using iota (1 << (10 * iota))
// Hint: skip iota=0 with _

// TODO: Implement String() method for ByteSize
// Format: "1.00KB", "2.50MB", "3.14GB", "1.00TB"

func main() {
    fmt.Println(ByteSize(1024))           // 1.00KB
    fmt.Println(ByteSize(1536))           // 1.50KB
    fmt.Println(ByteSize(3 * 1024 * 1024)) // 3.00MB
    fmt.Println(GB)                        // 1.00GB
}
```

### Requirements
- [ ] `KB = 1024.0`, `MB = 1048576.0`, `GB = 1073741824.0`, `TB = 1099511627776.0`
- [ ] `String()` picks the largest unit the value is >= to
- [ ] Output is formatted with 2 decimal places

### Hints
- Use `iota` starting position 1 (`_` at position 0)
- `switch` with cases from largest to smallest

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type ByteSize float64

const (
    _           = iota
    KB ByteSize = 1 << (10 * iota) // 1024
    MB                              // 1048576
    GB                              // 1073741824
    TB                              // 1099511627776
)

func (b ByteSize) String() string {
    switch {
    case b >= TB:
        return fmt.Sprintf("%.2fTB", b/TB)
    case b >= GB:
        return fmt.Sprintf("%.2fGB", b/GB)
    case b >= MB:
        return fmt.Sprintf("%.2fMB", b/MB)
    case b >= KB:
        return fmt.Sprintf("%.2fKB", b/KB)
    }
    return fmt.Sprintf("%.2fB", b)
}

func main() {
    fmt.Println(ByteSize(1024))
    fmt.Println(ByteSize(1536))
    fmt.Println(ByteSize(3 * 1024 * 1024))
    fmt.Println(GB)
}
```
</details>

---

## Task 5 — Priority Queue with Typed Constants

### Objective
Build a priority queue that uses a typed `Priority` constant to order tasks.

### Starter Code

```go
package main

import (
    "fmt"
    "sort"
)

// TODO: Define Priority type and constants
// PriorityLow, PriorityMedium, PriorityHigh, PriorityCritical
// Skip the zero value (use iota + 1 or _ = iota)

type Task struct {
    Name     string
    Priority // TODO: add Priority field
}

// TODO: Implement String() for Priority

func main() {
    tasks := []Task{
        {"Write tests", PriorityMedium},
        {"Fix prod bug", PriorityCritical},
        {"Update docs", PriorityLow},
        {"Deploy feature", PriorityHigh},
    }

    sort.Slice(tasks, func(i, j int) bool {
        return tasks[i].Priority > tasks[j].Priority // highest priority first
    })

    for _, t := range tasks {
        fmt.Printf("[%s] %s\n", t.Priority, t.Name)
    }
}
```

### Requirements
- [ ] `Priority` is a named `int` type
- [ ] Zero value means "unset" (not a valid priority)
- [ ] `PriorityLow < PriorityMedium < PriorityHigh < PriorityCritical`
- [ ] `String()` returns readable names
- [ ] Tasks are sorted highest-priority first

### Expected Output
```
[Critical] Fix prod bug
[High] Deploy feature
[Medium] Write tests
[Low] Update docs
```

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sort"
)

type Priority int

const (
    _                Priority = iota
    PriorityLow                       // 1
    PriorityMedium                    // 2
    PriorityHigh                      // 3
    PriorityCritical                  // 4
)

func (p Priority) String() string {
    switch p {
    case PriorityLow:
        return "Low"
    case PriorityMedium:
        return "Medium"
    case PriorityHigh:
        return "High"
    case PriorityCritical:
        return "Critical"
    }
    return fmt.Sprintf("Priority(%d)", int(p))
}

type Task struct {
    Name     string
    Priority Priority
}

func main() {
    tasks := []Task{
        {"Write tests", PriorityMedium},
        {"Fix prod bug", PriorityCritical},
        {"Update docs", PriorityLow},
        {"Deploy feature", PriorityHigh},
    }

    sort.Slice(tasks, func(i, j int) bool {
        return tasks[i].Priority > tasks[j].Priority
    })

    for _, t := range tasks {
        fmt.Printf("[%s] %s\n", t.Priority, t.Name)
    }
}
```
</details>

---

## Task 6 — HTTP Router with Typed Method Constants

### Objective
Implement a simple HTTP route registry using typed `HTTPMethod` constants.

### Starter Code

```go
package main

import "fmt"

// TODO: Define HTTPMethod type (string)
// TODO: Define GET, POST, PUT, DELETE, PATCH constants

type Route struct {
    // TODO: add Method and Path fields
}

type Router struct {
    routes []Route
}

func (r *Router) Add(method HTTPMethod, path string) {
    // TODO: add a route
}

func (r *Router) List() {
    // TODO: print all routes as "METHOD /path"
}

func main() {
    router := &Router{}
    router.Add(GET, "/users")
    router.Add(POST, "/users")
    router.Add(GET, "/users/:id")
    router.Add(PUT, "/users/:id")
    router.Add(DELETE, "/users/:id")
    router.List()
}
```

### Requirements
- [ ] `HTTPMethod` is a named `string` type
- [ ] Constants are `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- [ ] `Add` accepts only `HTTPMethod`, not raw strings
- [ ] `List()` prints routes in the order they were added

### Expected Output
```
GET /users
POST /users
GET /users/:id
PUT /users/:id
DELETE /users/:id
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type HTTPMethod string

const (
    GET    HTTPMethod = "GET"
    POST   HTTPMethod = "POST"
    PUT    HTTPMethod = "PUT"
    DELETE HTTPMethod = "DELETE"
    PATCH  HTTPMethod = "PATCH"
)

type Route struct {
    Method HTTPMethod
    Path   string
}

type Router struct {
    routes []Route
}

func (r *Router) Add(method HTTPMethod, path string) {
    r.routes = append(r.routes, Route{Method: method, Path: path})
}

func (r *Router) List() {
    for _, route := range r.routes {
        fmt.Printf("%s %s\n", route.Method, route.Path)
    }
}

func main() {
    router := &Router{}
    router.Add(GET, "/users")
    router.Add(POST, "/users")
    router.Add(GET, "/users/:id")
    router.Add(PUT, "/users/:id")
    router.Add(DELETE, "/users/:id")
    router.List()
}
```
</details>

---

## Task 7 — State Machine with Typed States

### Objective
Implement a connection state machine using typed `ConnState` constants with valid transition rules.

### Starter Code

```go
package main

import (
    "errors"
    "fmt"
)

// TODO: Define ConnState type (int)
// States: Disconnected, Connecting, Connected, Closing
// Use iota, skip zero value

// TODO: Add String() for ConnState

type Connection struct {
    state ConnState
}

// TODO: Implement:
// func (c *Connection) Connect() error
// func (c *Connection) Close() error
// func (c *Connection) State() ConnState
// Valid transitions:
//   Disconnected → Connecting
//   Connecting   → Connected
//   Connected    → Closing
//   Closing      → Disconnected

func main() {
    conn := &Connection{}
    fmt.Println(conn.State()) // Disconnected

    if err := conn.Connect(); err != nil {
        fmt.Println("Error:", err)
    }
    fmt.Println(conn.State()) // Connecting

    // Try invalid transition
    if err := conn.Connect(); err != nil {
        fmt.Println("Error:", err) // should print error
    }
}
```

### Requirements
- [ ] Zero value means `Disconnected` (first valid state, or skip zero and use `iota+1`)
- [ ] `Connect()` only works from `Disconnected` state
- [ ] `Close()` only works from `Connected` state
- [ ] Invalid transitions return an error
- [ ] `State()` returns current state

<details>
<summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

type ConnState int

const (
    Disconnected ConnState = iota
    Connecting
    Connected
    Closing
)

func (s ConnState) String() string {
    switch s {
    case Disconnected:
        return "Disconnected"
    case Connecting:
        return "Connecting"
    case Connected:
        return "Connected"
    case Closing:
        return "Closing"
    }
    return fmt.Sprintf("ConnState(%d)", int(s))
}

type Connection struct {
    state ConnState
}

func (c *Connection) Connect() error {
    if c.state != Disconnected {
        return fmt.Errorf("cannot connect from state %s", c.state)
    }
    c.state = Connecting
    return nil
}

func (c *Connection) Establish() error {
    if c.state != Connecting {
        return fmt.Errorf("not in connecting state")
    }
    c.state = Connected
    return nil
}

func (c *Connection) Close() error {
    if c.state != Connected {
        return errors.New("cannot close: not connected")
    }
    c.state = Closing
    return nil
}

func (c *Connection) State() ConnState {
    return c.state
}

func main() {
    conn := &Connection{}
    fmt.Println(conn.State())

    if err := conn.Connect(); err != nil {
        fmt.Println("Error:", err)
    }
    fmt.Println(conn.State())

    if err := conn.Connect(); err != nil {
        fmt.Println("Error:", err)
    }
}
```
</details>

---

## Task 8 — Subscription Tier System

### Objective
Build a subscription tier system where each tier has limits enforced by constants.

### Starter Code

```go
package main

import "fmt"

// TODO: Define Tier type and constants
// TierFree, TierBasic, TierPro, TierEnterprise (using iota)

// TODO: Add String() for Tier

type Limits struct {
    Projects       int
    TeamMembers    int
    StorageGB      int
    APICallsPerDay int
}

// TODO: Implement func (t Tier) Limits() Limits
// Free:       3 projects, 1 member, 1GB, 100 API calls
// Basic:      10 projects, 5 members, 10GB, 1000 API calls
// Pro:        50 projects, 20 members, 100GB, 10000 API calls
// Enterprise: -1 (unlimited) for all

// TODO: Implement func (t Tier) CanAddProject(current int) bool

func main() {
    for _, tier := range []Tier{TierFree, TierBasic, TierPro, TierEnterprise} {
        l := tier.Limits()
        fmt.Printf("%s: %d projects, %dGB storage\n", tier, l.Projects, l.StorageGB)
    }

    fmt.Println(TierFree.CanAddProject(3))        // false — at limit
    fmt.Println(TierPro.CanAddProject(49))         // true
    fmt.Println(TierEnterprise.CanAddProject(9999)) // true — unlimited
}
```

### Requirements
- [ ] Four tiers with meaningful names
- [ ] `Limits()` returns the correct limits per tier
- [ ] `-1` means unlimited
- [ ] `CanAddProject` handles unlimited (`-1`) correctly

### Expected Output
```
Free: 3 projects, 1GB storage
Basic: 10 projects, 10GB storage
Pro: 50 projects, 100GB storage
Enterprise: -1 projects, -1GB storage
false
true
true
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type Tier int

const (
    TierFree Tier = iota
    TierBasic
    TierPro
    TierEnterprise
    tierCount
)

func (t Tier) String() string {
    return [tierCount]string{"Free", "Basic", "Pro", "Enterprise"}[t]
}

type Limits struct {
    Projects       int
    TeamMembers    int
    StorageGB      int
    APICallsPerDay int
}

var tierLimits = [tierCount]Limits{
    {Projects: 3,  TeamMembers: 1,  StorageGB: 1,   APICallsPerDay: 100},
    {Projects: 10, TeamMembers: 5,  StorageGB: 10,  APICallsPerDay: 1000},
    {Projects: 50, TeamMembers: 20, StorageGB: 100, APICallsPerDay: 10000},
    {Projects: -1, TeamMembers: -1, StorageGB: -1,  APICallsPerDay: -1},
}

func (t Tier) Limits() Limits {
    if t < 0 || t >= tierCount {
        return Limits{}
    }
    return tierLimits[t]
}

func (t Tier) CanAddProject(current int) bool {
    limit := t.Limits().Projects
    return limit == -1 || current < limit
}

func main() {
    for _, tier := range []Tier{TierFree, TierBasic, TierPro, TierEnterprise} {
        l := tier.Limits()
        fmt.Printf("%s: %d projects, %dGB storage\n", tier, l.Projects, l.StorageGB)
    }
    fmt.Println(TierFree.CanAddProject(3))
    fmt.Println(TierPro.CanAddProject(49))
    fmt.Println(TierEnterprise.CanAddProject(9999))
}
```
</details>

---

## Task 9 — Log Level Filter System

### Objective
Build a structured logger that filters messages by log level using typed constants.

### Starter Code

```go
package main

import "fmt"

// TODO: Define LogLevel type (int) and constants
// TRACE, DEBUG, INFO, WARN, ERROR, FATAL (using iota)

// TODO: Add String() method

type Logger struct {
    // TODO: minLevel field
}

// TODO: func NewLogger(minLevel LogLevel) *Logger
// TODO: func (l *Logger) Log(level LogLevel, msg string)
// Only log if level >= minLevel

func main() {
    l := NewLogger(WARN)
    l.Log(DEBUG, "debugging something")  // should NOT print
    l.Log(INFO, "server started")        // should NOT print
    l.Log(WARN, "high memory usage")     // SHOULD print
    l.Log(ERROR, "db connection failed") // SHOULD print
    l.Log(FATAL, "out of disk space")    // SHOULD print
}
```

### Requirements
- [ ] `TRACE < DEBUG < INFO < WARN < ERROR < FATAL`
- [ ] Logger only prints messages at or above `minLevel`
- [ ] `String()` returns uppercase level names

### Expected Output
```
[WARN] high memory usage
[ERROR] db connection failed
[FATAL] out of disk space
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type LogLevel int

const (
    TRACE LogLevel = iota
    DEBUG
    INFO
    WARN
    ERROR
    FATAL
    logLevelCount
)

var levelNames = [logLevelCount]string{
    "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL",
}

func (l LogLevel) String() string {
    if l < 0 || l >= logLevelCount {
        return fmt.Sprintf("LogLevel(%d)", int(l))
    }
    return levelNames[l]
}

type Logger struct {
    minLevel LogLevel
}

func NewLogger(minLevel LogLevel) *Logger {
    return &Logger{minLevel: minLevel}
}

func (l *Logger) Log(level LogLevel, msg string) {
    if level >= l.minLevel {
        fmt.Printf("[%s] %s\n", level, msg)
    }
}

func main() {
    l := NewLogger(WARN)
    l.Log(DEBUG, "debugging something")
    l.Log(INFO, "server started")
    l.Log(WARN, "high memory usage")
    l.Log(ERROR, "db connection failed")
    l.Log(FATAL, "out of disk space")
}
```
</details>

---

## Task 10 — Build Options with Bit Flags

### Objective
Implement a build system that accepts configuration options as bit flags.

### Starter Code

```go
package main

import (
    "fmt"
    "strings"
)

// TODO: Define BuildFlag type (uint) and flags:
// FlagOptimize, FlagDebug, FlagStrip, FlagVerbose, FlagTest
// Use 1 << iota

// TODO: func (f BuildFlag) String() string
// Show all active flags separated by "|", e.g., "optimize|verbose"
// If no flags: "none"

// TODO: func ValidateFlags(f BuildFlag) error
// FlagOptimize and FlagDebug cannot be combined

type BuildConfig struct {
    Flags BuildFlag
    Target string
}

func build(cfg BuildConfig) {
    if err := ValidateFlags(cfg.Flags); err != nil {
        fmt.Println("Invalid config:", err)
        return
    }
    fmt.Printf("Building %s [%s]\n", cfg.Target, cfg.Flags)
}

func main() {
    build(BuildConfig{FlagOptimize | FlagStrip | FlagVerbose, "myapp"})
    build(BuildConfig{FlagDebug | FlagVerbose, "myapp-debug"})
    build(BuildConfig{FlagOptimize | FlagDebug, "conflict"}) // should error
    build(BuildConfig{0, "plain"})
}
```

### Requirements
- [ ] Five flags defined with `1 << iota`
- [ ] `String()` lists active flags by name, pipe-separated
- [ ] `ValidateFlags` returns error if Optimize+Debug are both set
- [ ] Zero flags prints `"none"`

### Expected Output
```
Building myapp [optimize|strip|verbose]
Building myapp-debug [debug|verbose]
Invalid config: cannot combine optimize and debug flags
Building plain [none]
```

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "strings"
)

type BuildFlag uint

const (
    FlagOptimize BuildFlag = 1 << iota // 1
    FlagDebug                          // 2
    FlagStrip                          // 4
    FlagVerbose                        // 8
    FlagTest                           // 16
)

var flagDefs = []struct {
    flag BuildFlag
    name string
}{
    {FlagOptimize, "optimize"},
    {FlagDebug, "debug"},
    {FlagStrip, "strip"},
    {FlagVerbose, "verbose"},
    {FlagTest, "test"},
}

func (f BuildFlag) String() string {
    var parts []string
    for _, def := range flagDefs {
        if f&def.flag != 0 {
            parts = append(parts, def.name)
        }
    }
    if len(parts) == 0 {
        return "none"
    }
    return strings.Join(parts, "|")
}

func ValidateFlags(f BuildFlag) error {
    if f&FlagOptimize != 0 && f&FlagDebug != 0 {
        return fmt.Errorf("cannot combine optimize and debug flags")
    }
    return nil
}

type BuildConfig struct {
    Flags  BuildFlag
    Target string
}

func build(cfg BuildConfig) {
    if err := ValidateFlags(cfg.Flags); err != nil {
        fmt.Println("Invalid config:", err)
        return
    }
    fmt.Printf("Building %s [%s]\n", cfg.Target, cfg.Flags)
}

func main() {
    build(BuildConfig{FlagOptimize | FlagStrip | FlagVerbose, "myapp"})
    build(BuildConfig{FlagDebug | FlagVerbose, "myapp-debug"})
    build(BuildConfig{FlagOptimize | FlagDebug, "conflict"})
    build(BuildConfig{0, "plain"})
}
```
</details>

---

## Task 11 — Validated Enum from External Input

### Objective
Build a function that safely converts untrusted integer input (from a JSON API or database) into a typed enum value.

### Starter Code

```go
package main

import (
    "encoding/json"
    "fmt"
)

// TODO: Define UserRole type (int) and constants
// RoleViewer=1, RoleEditor=2, RoleAdmin=3
// Do NOT use iota (roles must be stable for storage)

// TODO: Add String() for UserRole
// TODO: Add func UserRoleFromInt(n int) (UserRole, error)
// TODO: Add func UserRoleFromString(s string) (UserRole, error)

type User struct {
    Name string
    Role UserRole
}

func main() {
    // Simulate JSON input
    data := `{"name": "Alice", "role": 2}`
    var raw struct {
        Name string `json:"name"`
        Role int    `json:"role"`
    }
    json.Unmarshal([]byte(data), &raw)

    role, err := UserRoleFromInt(raw.Role)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    user := User{Name: raw.Name, Role: role}
    fmt.Printf("User: %s, Role: %s\n", user.Name, user.Role)

    // Test invalid
    _, err = UserRoleFromInt(99)
    fmt.Println("Invalid role:", err)

    _, err = UserRoleFromString("superadmin")
    fmt.Println("Invalid string:", err)
}
```

### Requirements
- [ ] Roles use explicit values (not iota) for stability
- [ ] `UserRoleFromInt` validates and returns descriptive error
- [ ] `UserRoleFromString` case-insensitive matching
- [ ] `String()` returns lowercase role names

### Expected Output
```
User: Alice, Role: editor
Invalid role: invalid role: 99
Invalid string: unknown role: "superadmin"
```

<details>
<summary>Solution</summary>

```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"
)

type UserRole int

const (
    RoleViewer UserRole = 1
    RoleEditor UserRole = 2
    RoleAdmin  UserRole = 3
)

var roleNames = map[UserRole]string{
    RoleViewer: "viewer",
    RoleEditor: "editor",
    RoleAdmin:  "admin",
}

func (r UserRole) String() string {
    if name, ok := roleNames[r]; ok {
        return name
    }
    return fmt.Sprintf("Role(%d)", int(r))
}

func UserRoleFromInt(n int) (UserRole, error) {
    r := UserRole(n)
    if _, ok := roleNames[r]; ok {
        return r, nil
    }
    return 0, fmt.Errorf("invalid role: %d", n)
}

func UserRoleFromString(s string) (UserRole, error) {
    lower := strings.ToLower(s)
    for role, name := range roleNames {
        if name == lower {
            return role, nil
        }
    }
    return 0, fmt.Errorf("unknown role: %q", s)
}

type User struct {
    Name string
    Role UserRole
}

func main() {
    data := `{"name": "Alice", "role": 2}`
    var raw struct {
        Name string `json:"name"`
        Role int    `json:"role"`
    }
    json.Unmarshal([]byte(data), &raw)

    role, err := UserRoleFromInt(raw.Role)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    user := User{Name: raw.Name, Role: role}
    fmt.Printf("User: %s, Role: %s\n", user.Name, user.Role)

    _, err = UserRoleFromInt(99)
    fmt.Println("Invalid role:", err)

    _, err = UserRoleFromString("superadmin")
    fmt.Println("Invalid string:", err)
}
```
</details>

---

## Task 12 — Compile-Time Safety with Sentinel and Array

### Objective
Design a `Month` enum with a sentinel constant that enforces compile-time synchronization between the enum and a lookup table.

### Starter Code

```go
package main

import "fmt"

// TODO: Define Month type (int) starting at 1 (January=1)
// Include all 12 months + monthCount sentinel
// Use iota + 1 for months (so January=1, not 0)

// TODO: Create a [monthCount+1]int array for days in each month
// Index 0 unused; index 1=January=31, ..., 12=December=31
// If monthCount changes and the array size doesn't match → compile error

// TODO: Add String() for Month using the array

// TODO: Implement func (m Month) Days(leapYear bool) int
// February has 28 days normally, 29 in leap year

func main() {
    for m := January; m <= December; m++ {
        fmt.Printf("%s: %d days (non-leap), %d days (leap)\n",
            m, m.Days(false), m.Days(true))
    }
}
```

### Requirements
- [ ] January = 1, December = 12
- [ ] `monthCount` is an unexported sentinel = 13 (one past December)
- [ ] Array uses `monthCount` as its size — compile error if out of sync
- [ ] `Days(false)` returns correct non-leap days
- [ ] `Days(true)` returns 29 for February, same as non-leap for others

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type Month int

const (
    January Month = iota + 1
    February
    March
    April
    May
    June
    July
    August
    September
    October
    November
    December
    monthCount // 13
)

var monthNames = [monthCount]string{
    "",          // index 0 unused
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December",
}

// Compile-time check: array must have exactly monthCount entries
var daysInMonth = [monthCount]int{
    0,  // index 0 unused
    31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
}

func (m Month) String() string {
    if m < January || m >= monthCount {
        return fmt.Sprintf("Month(%d)", int(m))
    }
    return monthNames[m]
}

func (m Month) Days(leapYear bool) int {
    if m == February && leapYear {
        return 29
    }
    if m < January || m >= monthCount {
        return 0
    }
    return daysInMonth[m]
}

func main() {
    for m := January; m <= December; m++ {
        fmt.Printf("%s: %d days (non-leap), %d days (leap)\n",
            m, m.Days(false), m.Days(true))
    }
}
```
</details>

---

## Summary Table

| Task | Topic | Level |
|------|-------|-------|
| 1 | Replace magic numbers with named constants | Beginner |
| 2 | Days-of-week enum with iota | Beginner |
| 3 | File permission bit flags | Beginner |
| 4 | Byte size constants with iota expression | Beginner |
| 5 | Priority queue with typed enum | Intermediate |
| 6 | HTTP router with typed string constants | Intermediate |
| 7 | Connection state machine | Intermediate |
| 8 | Subscription tier system | Intermediate |
| 9 | Log level filter logger | Advanced |
| 10 | Build options bit flags with validation | Advanced |
| 11 | Validated enum from external JSON | Advanced |
| 12 | Month enum with compile-time safety | Advanced |
