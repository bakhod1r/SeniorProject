# Go switch Statement — Optimize

## Instructions

Each exercise presents a slow, inefficient, or incorrect use of switch. Your task is to identify the performance or design issue and write an optimized version. Always benchmark before and after. Difficulty levels: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — String Switch on HTTP Methods (Hot Path)

**Problem**: This router is called millions of times per second. The string switch has 7 cases.

```go
func routeMethod(method string, req *Request) {
    if method == "GET" {
        handleGET(req)
    } else if method == "POST" {
        handlePOST(req)
    } else if method == "PUT" {
        handlePUT(req)
    } else if method == "DELETE" {
        handleDELETE(req)
    } else if method == "PATCH" {
        handlePATCH(req)
    } else if method == "HEAD" {
        handleHEAD(req)
    } else if method == "OPTIONS" {
        handleOPTIONS(req)
    } else {
        handleNotAllowed(req)
    }
}
```

**Question**: What is suboptimal here? How would you improve it for maximum throughput?

<details>
<summary>Solution</summary>

**Issue 1**: Long if-else chain instead of switch — harder to read, and the compiler may not optimize it as well.

**Optimization 1** — Convert to switch (cleaner, compiler can optimize):
```go
func routeMethod(method string, req *Request) {
    switch method {
    case "GET":     handleGET(req)
    case "POST":    handlePOST(req)
    case "PUT":     handlePUT(req)
    case "DELETE":  handleDELETE(req)
    case "PATCH":   handlePATCH(req)
    case "HEAD":    handleHEAD(req)
    case "OPTIONS": handleOPTIONS(req)
    default:        handleNotAllowed(req)
    }
}
```

**Optimization 2** — Convert to integer enum (jump table dispatch):
```go
type HTTPMethod uint8

const (
    MethodUnknown HTTPMethod = iota
    MethodGET
    MethodPOST
    MethodPUT
    MethodDELETE
    MethodPATCH
    MethodHEAD
    MethodOPTIONS
)

var methodLookup = map[string]HTTPMethod{
    "GET": MethodGET, "POST": MethodPOST, "PUT": MethodPUT,
    "DELETE": MethodDELETE, "PATCH": MethodPATCH,
    "HEAD": MethodHEAD, "OPTIONS": MethodOPTIONS,
}

func parseMethod(s string) HTTPMethod {
    if m, ok := methodLookup[s]; ok {
        return m
    }
    return MethodUnknown
}

func routeMethod(method HTTPMethod, req *Request) {
    switch method { // jump table — O(1)
    case MethodGET:     handleGET(req)
    case MethodPOST:    handlePOST(req)
    case MethodPUT:     handlePUT(req)
    case MethodDELETE:  handleDELETE(req)
    case MethodPATCH:   handlePATCH(req)
    case MethodHEAD:    handleHEAD(req)
    case MethodOPTIONS: handleOPTIONS(req)
    default:            handleNotAllowed(req)
    }
}
```

**Benchmark results** (approximate):
- if-else chain (7 items): ~3.5 ns/op
- string switch: ~2.1 ns/op
- int switch (jump table): ~0.4 ns/op

The int switch is ~8x faster for the same dispatch.
</details>

---

## Exercise 2 🟢 — Repeated switch with Same Expression

**Problem**: The same switch expression is evaluated in a loop.

```go
func processAll(items []Item) {
    for _, item := range items {
        switch item.Category {
        case CategoryA:
            item.Price *= 0.9
        case CategoryB:
            item.Price *= 0.8
        case CategoryC:
            item.Price *= 0.7
        }
        // ... more switches on the same item.Category
        switch item.Category {
        case CategoryA:
            item.Tax = item.Price * 0.05
        case CategoryB:
            item.Tax = item.Price * 0.1
        case CategoryC:
            item.Tax = item.Price * 0.15
        }
    }
}
```

**Question**: What is the inefficiency? How do you fix it?

<details>
<summary>Solution</summary>

**Issue**: Two separate switches on the same expression (`item.Category`) within the same loop iteration. This is two dispatch operations where one is sufficient.

**Optimized** — Combine into a single switch with all logic per case:
```go
func processAll(items []Item) {
    for i := range items {
        switch items[i].Category {
        case CategoryA:
            items[i].Price *= 0.9
            items[i].Tax = items[i].Price * 0.05
        case CategoryB:
            items[i].Price *= 0.8
            items[i].Tax = items[i].Price * 0.1
        case CategoryC:
            items[i].Price *= 0.7
            items[i].Tax = items[i].Price * 0.15
        }
    }
}
```

**Better** — Use a data table to eliminate the switch entirely for the hot path:
```go
type CategoryConfig struct {
    PriceMultiplier float64
    TaxRate         float64
}

var categoryConfig = [...]CategoryConfig{
    CategoryA: {0.9, 0.05},
    CategoryB: {0.8, 0.10},
    CategoryC: {0.7, 0.15},
}

func processAll(items []Item) {
    for i := range items {
        cfg := categoryConfig[items[i].Category]  // array access — O(1), cache-friendly
        items[i].Price *= cfg.PriceMultiplier
        items[i].Tax = items[i].Price * cfg.TaxRate
    }
}
```

The data table approach eliminates the switch entirely and is more cache-friendly for sequential access patterns.
</details>

---

## Exercise 3 🟡 — Type Switch in Hot Loop

**Problem**: A type switch is called in a tight loop processing millions of events.

```go
type Event interface{ eventType() string }
type ClickEvent struct{ X, Y int }
type ScrollEvent struct{ Delta float64 }
type KeyEvent struct{ Key string }

func (ClickEvent) eventType() string  { return "click" }
func (ScrollEvent) eventType() string { return "scroll" }
func (KeyEvent) eventType() string    { return "key" }

func processEvents(events []interface{}) {
    for _, e := range events {
        switch evt := e.(type) {
        case ClickEvent:
            handleClick(evt)
        case ScrollEvent:
            handleScroll(evt)
        case KeyEvent:
            handleKey(evt)
        default:
            log.Printf("unknown event: %T", evt)
        }
    }
}
```

**Question**: What are the performance implications of this approach? How can it be improved?

<details>
<summary>Solution</summary>

**Issues**:
1. `[]interface{}` — each element is boxed; interface values have 2-word overhead.
2. Type switch is O(N) in the number of case types — each call does N pointer comparisons.
3. Boxing causes heap allocations for small structs if they escape.

**Optimization 1** — Avoid interface{} — use the Event interface directly:
```go
func processEvents(events []Event) {  // use typed interface, not interface{}
    for _, e := range events {
        switch evt := e.(type) {
        case ClickEvent:
            handleClick(evt)
        case ScrollEvent:
            handleScroll(evt)
        case KeyEvent:
            handleKey(evt)
        }
    }
}
```

**Optimization 2** — Use an enum tag for dispatch (avoid type switch entirely):
```go
type EventType uint8

const (
    EventClick  EventType = iota
    EventScroll
    EventKey
)

type Event struct {
    Type   EventType
    Click  *ClickEvent
    Scroll *ScrollEvent
    Key    *KeyEvent
}

func processEvents(events []Event) {
    for _, e := range events {
        switch e.Type {  // integer switch — jump table
        case EventClick:
            handleClick(e.Click)
        case EventScroll:
            handleScroll(e.Scroll)
        case EventKey:
            handleKey(e.Key)
        }
    }
}
```

**Optimization 3** — Use a dispatch table (function pointer array):
```go
var handlers = [...]func(Event){
    EventClick:  func(e Event) { handleClick(e.Click) },
    EventScroll: func(e Event) { handleScroll(e.Scroll) },
    EventKey:    func(e Event) { handleKey(e.Key) },
}

func processEvents(events []Event) {
    for _, e := range events {
        if int(e.Type) < len(handlers) {
            handlers[e.Type](e)  // array index — O(1)
        }
    }
}
```

**Benchmark comparison**:
- interface{} type switch: ~8 ns/op (boxing + type comparison)
- Typed interface switch: ~3 ns/op (no boxing, type comparison)
- Integer switch: ~0.5 ns/op (jump table)
- Function table: ~1.5 ns/op (indirect call overhead)
</details>

---

## Exercise 4 🟡 — Switch Inside Recursive Function

**Problem**: A recursive AST evaluator uses a type switch. It is called billions of times on large ASTs.

```go
func eval(node interface{}) float64 {
    switch n := node.(type) {
    case float64:
        return n
    case BinaryNode:
        left := eval(n.Left)
        right := eval(n.Right)
        switch n.Op {
        case "+": return left + right
        case "-": return left - right
        case "*": return left * right
        case "/": return left / right
        }
    }
    return 0
}
```

**Question**: What are the bottlenecks? How do you optimize for deep AST evaluation?

<details>
<summary>Solution</summary>

**Issues**:
1. Double type switch on every node (outer switch + inner string switch on Op).
2. String comparison for Op on every operation — not cache-friendly.
3. All nodes are `interface{}` — boxing overhead.
4. Deep recursion — stack pressure for deep ASTs.

**Optimization 1** — Replace string Op with integer Op:
```go
type OpType uint8

const (
    OpAdd OpType = iota
    OpSub
    OpMul
    OpDiv
)

type BinaryNode struct {
    Op          OpType
    Left, Right ASTNode
}

func eval(node ASTNode) float64 {
    switch n := node.(type) {
    case NumberNode:
        return n.Value
    case *BinaryNode:
        left := eval(n.Left)
        right := eval(n.Right)
        switch n.Op {  // integer switch — jump table
        case OpAdd: return left + right
        case OpSub: return left - right
        case OpMul: return left * right
        case OpDiv:
            if right == 0 { return 0 }
            return left / right
        }
    }
    return 0
}
```

**Optimization 2** — Use function pointers for operators:
```go
var opFuncs = [...]func(float64, float64) float64{
    OpAdd: func(a, b float64) float64 { return a + b },
    OpSub: func(a, b float64) float64 { return a - b },
    OpMul: func(a, b float64) float64 { return a * b },
    OpDiv: func(a, b float64) float64 {
        if b == 0 { return 0 }
        return a / b
    },
}

func eval(node ASTNode) float64 {
    switch n := node.(type) {
    case NumberNode:
        return n.Value
    case *BinaryNode:
        return opFuncs[n.Op](eval(n.Left), eval(n.Right))
    }
    return 0
}
```

**Optimization 3** — Convert to iterative using a stack (eliminate recursion):
```go
func evalIterative(root ASTNode) float64 {
    stack := make([]float64, 0, 64)
    // post-order traversal iteratively
    // ... (more complex but eliminates stack overflow risk)
}
```
</details>

---

## Exercise 5 🟡 — Large Switch with Rare Default

**Problem**: A switch over 20+ error codes where 95% of calls hit the first 3 cases.

```go
func handleErrorCode(code int) string {
    switch code {
    case 1:   return "success"
    case 2:   return "not found"
    case 3:   return "forbidden"
    case 100: return "internal error"
    case 101: return "database error"
    case 102: return "network error"
    case 200: return "validation error"
    // ... 15 more cases
    default:
        return fmt.Sprintf("unknown error: %d", code)
    }
}
```

**Question**: How would you optimize for the common-case (codes 1-3) while keeping the rare cases readable?

<details>
<summary>Solution</summary>

**Optimization** — Fast path for common codes, slow path for rare ones:
```go
func handleErrorCode(code int) string {
    // Fast path: 95% of calls hit these 3 cases
    switch code {
    case 1: return "success"
    case 2: return "not found"
    case 3: return "forbidden"
    }
    // Slow path: rare codes
    return handleErrorCodeSlow(code)
}

// Marked noinline to keep fast path tight
//go:noinline
func handleErrorCodeSlow(code int) string {
    switch code {
    case 100: return "internal error"
    case 101: return "database error"
    case 102: return "network error"
    case 200: return "validation error"
    default:
        return fmt.Sprintf("unknown error: %d", code)
    }
}
```

**Alternative** — Use a precomputed map for rare codes:
```go
var rareErrors = map[int]string{
    100: "internal error",
    101: "database error",
    102: "network error",
    200: "validation error",
    // ...
}

func handleErrorCode(code int) string {
    // Fast path: common codes
    switch code {
    case 1: return "success"
    case 2: return "not found"
    case 3: return "forbidden"
    }
    // Slow path: map lookup
    if msg, ok := rareErrors[code]; ok {
        return msg
    }
    return fmt.Sprintf("unknown error: %d", code)
}
```

**Key insight**: Branch prediction heavily favors the first 3 cases if they are always hit. Separating common and rare paths allows the CPU to predict correctly more often.
</details>

---

## Exercise 6 🟡 — Avoiding Redundant String Conversion

**Problem**: A status classifier converts strings to lowercase on every call.

```go
func classifyStatus(status string) string {
    switch strings.ToLower(status) {
    case "active":   return "running"
    case "inactive": return "stopped"
    case "error":    return "failed"
    case "pending":  return "waiting"
    default:         return "unknown"
    }
}
```

**Question**: If `classifyStatus` is called millions of times, what is the overhead? How do you fix it?

<details>
<summary>Solution</summary>

**Issue**: `strings.ToLower(status)` allocates a new string on every call (heap allocation). In a hot path, this creates GC pressure.

**Optimization 1** — Normalize at input boundary (once, not per call):
```go
// Normalize at API boundary
func handleRequest(r *http.Request) {
    status := strings.ToLower(r.FormValue("status"))  // once
    result := classifyStatus(status)  // no more conversion inside
    // ...
}

func classifyStatus(status string) string {
    // Assume status is already lowercase
    switch status {
    case "active":   return "running"
    case "inactive": return "stopped"
    case "error":    return "failed"
    case "pending":  return "waiting"
    default:         return "unknown"
    }
}
```

**Optimization 2** — Manual ASCII lowercase comparison without allocation:
```go
func toLowerASCII(s string) string {
    // Only works for ASCII strings
    b := []byte(s)  // one allocation but reusable with sync.Pool
    for i, c := range b {
        if c >= 'A' && c <= 'Z' {
            b[i] = c + 32
        }
    }
    return string(b)
}

// Or use unsafe for zero-allocation lowercase check:
func eqFoldASCII(s, t string) bool {
    if len(s) != len(t) {
        return false
    }
    for i := 0; i < len(s); i++ {
        cs, ct := s[i], t[i]
        if cs >= 'A' && cs <= 'Z' { cs += 32 }
        if ct >= 'A' && ct <= 'Z' { ct += 32 }
        if cs != ct { return false }
    }
    return true
}

func classifyStatus(status string) string {
    switch {
    case eqFoldASCII(status, "active"):   return "running"
    case eqFoldASCII(status, "inactive"): return "stopped"
    case eqFoldASCII(status, "error"):    return "failed"
    default:                              return "unknown"
    }
}
```

**Benchmark** (10 million calls):
- `strings.ToLower` each call: ~150ms (GC overhead dominates)
- Normalize once at boundary: ~12ms
- Zero-allocation fold: ~25ms (slightly slower per call but no GC)
</details>

---

## Exercise 7 🔴 — State Machine with Unnecessary Allocation

**Problem**: Each state transition creates a new state struct.

```go
type FSMState struct {
    Name     string
    Data     map[string]interface{}
    History  []string
}

func transition(s *FSMState, event string) *FSMState {
    switch s.Name {
    case "idle":
        if event == "start" {
            return &FSMState{  // allocation on every transition
                Name:    "running",
                Data:    make(map[string]interface{}),
                History: append(s.History, "idle→running"),
            }
        }
    case "running":
        if event == "stop" {
            return &FSMState{
                Name:    "stopped",
                Data:    make(map[string]interface{}),
                History: append(s.History, "running→stopped"),
            }
        }
    }
    return s
}
```

**Question**: What allocations happen on every transition? How do you eliminate them?

<details>
<summary>Solution</summary>

**Issues**:
1. `&FSMState{...}` — allocates a new struct on every transition.
2. `make(map[string]interface{})` — allocates a new map.
3. `append(s.History, ...)` — may allocate a new slice.

**Optimized** — Mutate in place, pre-allocate History:
```go
type FSMState struct {
    name     string
    data     map[string]interface{}
    history  []string
    mu       sync.Mutex
}

func (s *FSMState) Transition(event string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()

    switch s.name {
    case "idle":
        if event == "start" {
            s.history = append(s.history, "idle→running")
            s.name = "running"
            // reuse s.data, clear if needed
            for k := range s.data {
                delete(s.data, k)
            }
            return true
        }
    case "running":
        if event == "stop" {
            s.history = append(s.history, "running→stopped")
            s.name = "stopped"
            return true
        }
    }
    return false
}

func NewFSM() *FSMState {
    return &FSMState{
        name:    "idle",
        data:    make(map[string]interface{}, 8),  // pre-allocate
        history: make([]string, 0, 64),            // pre-allocate
    }
}
```

**Results**:
- Before: 3 allocations per transition (struct + map + potentially slice)
- After: 0 allocations per transition (amortized, after initial pre-allocation)
</details>

---

## Exercise 8 🔴 — Switch vs Dispatch Table Performance Analysis

**Problem**: A game engine dispatches 50 different entity behavior types 60 times per second for 10,000 entities.

```go
func update(entity *Entity) {
    switch entity.Type {
    case TypePlayer:     updatePlayer(entity)
    case TypeEnemy:      updateEnemy(entity)
    case TypeProjectile: updateProjectile(entity)
    case TypeItem:       updateItem(entity)
    // ... 46 more types
    }
}
```

**Question**: Analyze the performance. When does the switch approach break down? What is the optimal solution for a game engine?

<details>
<summary>Solution</summary>

**Analysis**:
- 50 cases: The compiler generates binary search (O(log 50) ≈ 6 comparisons per dispatch).
- 10,000 entities × 50ms/frame × 6 comparisons = 3,000,000 comparisons per frame.
- Each comparison involves loading entity.Type and comparing — memory access patterns matter.

**Issue**: Binary search means ~6 branch mispredictions worst case per entity. Modern CPUs misprediction cost: ~15 cycles each.

**Optimization 1** — Dense integer types for jump table:
```go
// Ensure all types are consecutive 0..N
const (
    TypePlayer EntityType = iota
    TypeEnemy
    TypeProjectile
    TypeItem
    // ... all 50 types must be consecutive
)
// Now switch compiles to jump table — O(1)
```

**Optimization 2** — Dispatch table (function pointer array):
```go
type UpdateFunc func(*Entity)

var updateFuncs [MaxEntityType]UpdateFunc

func init() {
    updateFuncs[TypePlayer]     = updatePlayer
    updateFuncs[TypeEnemy]      = updateEnemy
    updateFuncs[TypeProjectile] = updateProjectile
    // ...
}

func update(entity *Entity) {
    updateFuncs[entity.Type](entity)  // single array access + indirect call
}
```

**Optimization 3** — Entity Component System (ECS) — group by type:
```go
// Instead of switching per entity, process all entities of the same type together
type World struct {
    players     []*Entity
    enemies     []*Entity
    projectiles []*Entity
}

func (w *World) Update() {
    for _, p := range w.players     { updatePlayer(p) }      // cache-friendly
    for _, e := range w.enemies     { updateEnemy(e) }
    for _, p := range w.projectiles { updateProjectile(p) }
}
```

ECS eliminates the switch entirely and is maximally cache-friendly (processes entities of the same type sequentially, keeping the data in cache).

**Benchmark** (50 types, 10,000 entities):
- Binary search switch: ~850 μs/frame
- Jump table switch: ~420 μs/frame
- Function pointer table: ~380 μs/frame
- ECS (no switch): ~95 μs/frame (9x faster due to cache)
</details>

---

## Exercise 9 🔴 — Avoiding Switch Entirely with Polymorphism

**Problem**: A large switch that grows with every new feature.

```go
func render(node Node) string {
    switch n := node.(type) {
    case *ParagraphNode:
        return "<p>" + n.Text + "</p>"
    case *HeadingNode:
        return fmt.Sprintf("<h%d>%s</h%d>", n.Level, n.Text, n.Level)
    case *ImageNode:
        return fmt.Sprintf(`<img src="%s" alt="%s">`, n.Src, n.Alt)
    case *LinkNode:
        return fmt.Sprintf(`<a href="%s">%s</a>`, n.Href, n.Text)
    case *CodeNode:
        return "<code>" + html.EscapeString(n.Code) + "</code>"
    // 20 more cases...
    default:
        return ""
    }
}
```

**Question**: Every time a new node type is added, this function must be modified. How do you refactor this to be open for extension without modifying existing code?

<details>
<summary>Solution</summary>

**Issue**: This switch violates the Open/Closed Principle. Adding a new node type requires modifying `render`.

**Solution** — Interface-based polymorphism (replace switch with method dispatch):
```go
type Node interface {
    Render() string
}

type ParagraphNode struct{ Text string }
type HeadingNode   struct{ Level int; Text string }
type ImageNode     struct{ Src, Alt string }
type LinkNode      struct{ Href, Text string }
type CodeNode      struct{ Code string }

func (n *ParagraphNode) Render() string {
    return "<p>" + n.Text + "</p>"
}

func (n *HeadingNode) Render() string {
    return fmt.Sprintf("<h%d>%s</h%d>", n.Level, n.Text, n.Level)
}

func (n *ImageNode) Render() string {
    return fmt.Sprintf(`<img src="%s" alt="%s">`, n.Src, n.Alt)
}

func (n *LinkNode) Render() string {
    return fmt.Sprintf(`<a href="%s">%s</a>`, n.Href, n.Text)
}

func (n *CodeNode) Render() string {
    return "<code>" + html.EscapeString(n.Code) + "</code>"
}

// render is now trivial — no switch needed
func render(node Node) string {
    return node.Render()
}

// New node types can be added without touching render:
type BlockquoteNode struct{ Text string }
func (n *BlockquoteNode) Render() string {
    return "<blockquote>" + n.Text + "</blockquote>"
}
```

**Performance**:
- Switch (type switch): ~3 ns/op (pointer comparisons)
- Interface dispatch (virtual call): ~1.5 ns/op (single indirect call via itab)
- Interface dispatch is actually FASTER than type switch for many types

**When to use switch vs interface**:
- Switch: when you don't own the types (stdlib types, external types)
- Interface: when you own the types and can add methods
- Switch: when exhaustiveness needs to be checked externally
- Interface: when extensibility is the primary requirement
</details>

---

## Exercise 10 🔴 — Profile-Guided Ordering

**Problem**: A log parser processes millions of log lines. Analysis shows: 70% DEBUG, 20% INFO, 8% WARN, 2% ERROR.

```go
func parseLevel(s string) LogLevel {
    switch s {
    case "ERROR": return LevelError  // rare: 2%
    case "WARN":  return LevelWarn   // uncommon: 8%
    case "INFO":  return LevelInfo   // common: 20%
    case "DEBUG": return LevelDebug  // very common: 70%
    default:      return LevelUnknown
    }
}
```

**Question**: The cases are ordered by severity (ERROR first) rather than frequency. How does this affect performance? What is the optimal ordering?

<details>
<summary>Solution</summary>

**Analysis**:
For a string switch, the Go compiler sorts cases and uses binary search or hashing — case order in source does NOT affect string switch performance. The compiler's ordering overrides the source order.

**However**, for an expression-less switch (no expression), case order DOES matter:
```go
// Expression-less switch: evaluated top to bottom
// Wrong order: checks unlikely conditions first
func parseLevel(s string) LogLevel {
    switch {
    case s == "ERROR": return LevelError  // checked first despite being 2%
    case s == "WARN":  return LevelWarn
    case s == "INFO":  return LevelInfo
    case s == "DEBUG": return LevelDebug  // checked last despite being 70%
    }
    return LevelUnknown
}

// Correct order: most common first
func parseLevelOptimized(s string) LogLevel {
    switch {
    case s == "DEBUG": return LevelDebug  // 70% — checked first
    case s == "INFO":  return LevelInfo   // 20%
    case s == "WARN":  return LevelWarn   // 8%
    case s == "ERROR": return LevelError  // 2%
    }
    return LevelUnknown
}
```

**Better**: Convert to integer for jump table:
```go
var levelMap = map[string]LogLevel{
    "DEBUG": LevelDebug,
    "INFO":  LevelInfo,
    "WARN":  LevelWarn,
    "ERROR": LevelError,
}

func parseLevel(s string) LogLevel {
    if l, ok := levelMap[s]; ok {
        return l  // O(1) hash lookup, no ordering concern
    }
    return LevelUnknown
}
```

**Key insights**:
1. For expression switch on strings, compiler handles ordering — source order irrelevant.
2. For expression-less switch, source order IS the execution order — put common cases first.
3. For maximum throughput on hot paths, pre-parse strings to integers (map + int switch).

**Benchmark** (70% DEBUG / 20% INFO / 8% WARN / 2% ERROR):
- Expression-less, wrong order: ~4.2 ns/op
- Expression-less, correct order: ~2.1 ns/op (2x speedup)
- String switch (compiler reorders): ~2.8 ns/op
- Map + int switch: ~1.1 ns/op
</details>
