# Go if-else — Practice Tasks

## Task List
- Task 1: Grade Calculator (Beginner)
- Task 2: FizzBuzz (Beginner)
- Task 3: Login Validator (Beginner)
- Task 4: BMI Calculator (Beginner)
- Task 5: Leap Year Checker (Beginner)
- Task 6: Password Strength Checker (Intermediate)
- Task 7: Triangle Classifier (Intermediate)
- Task 8: Shopping Cart Discount (Intermediate)
- Task 9: Network Packet Router (Intermediate)
- Task 10: Multi-level Access Control (Advanced)
- Task 11: Loan Eligibility Checker (Advanced)
- Task 12: Rate Limiter with Tiers (Advanced)

---

## Task 1: Grade Calculator

**Difficulty:** Beginner
**Goal:** Convert numeric scores to letter grades using if-else

**Requirements:**
- 90-100 → "A"
- 80-89 → "B"
- 70-79 → "C"
- 60-69 → "D"
- Below 60 → "F"
- Score < 0 or > 100 → "Invalid"

**Starter Code:**

```go
package main

import "fmt"

func calculateGrade(score int) string {
    // TODO: implement grade calculation
    // Hint: check invalid range first (guard clause)
    return ""
}

func main() {
    tests := []int{95, 85, 75, 65, 55, -1, 101, 100, 0, 60}
    for _, score := range tests {
        fmt.Printf("Score %3d -> %s\n", score, calculateGrade(score))
    }
}

// Expected output:
// Score  95 -> A
// Score  85 -> B
// Score  75 -> C
// Score  65 -> D
// Score  55 -> F
// Score  -1 -> Invalid
// Score 101 -> Invalid
// Score 100 -> A
// Score   0 -> F
// Score  60 -> D
```

---

## Task 2: FizzBuzz

**Difficulty:** Beginner
**Goal:** Classic FizzBuzz using if-else

**Requirements:**
- Divisible by 3 AND 5 → "FizzBuzz"
- Divisible by 3 → "Fizz"
- Divisible by 5 → "Buzz"
- Otherwise → the number as string

**Starter Code:**

```go
package main

import (
    "fmt"
    "strconv"
)

func fizzBuzz(n int) string {
    // TODO: implement FizzBuzz
    // IMPORTANT: check divisible by BOTH first!
    return strconv.Itoa(n)
}

func main() {
    for i := 1; i <= 20; i++ {
        fmt.Printf("%2d: %s\n", i, fizzBuzz(i))
    }
}

// Expected for 1-20:
// 1: 1, 2: 2, 3: Fizz, 4: 4, 5: Buzz
// 6: Fizz, 7: 7, 8: 8, 9: Fizz, 10: Buzz
// 11: 11, 12: Fizz, 13: 13, 14: 14, 15: FizzBuzz
// 16: 16, 17: 17, 18: Fizz, 19: 19, 20: Buzz
```

---

## Task 3: Login Validator

**Difficulty:** Beginner
**Goal:** Validate login credentials with specific error messages

**Requirements:**
- Username cannot be empty
- Password must be at least 8 characters
- Username must be at least 3 characters
- Return specific error message for each failure
- Return "Login successful" if all valid

**Starter Code:**

```go
package main

import (
    "fmt"
    "strings"
)

func validateLogin(username, password string) string {
    // TODO: implement validation
    // Use strings.TrimSpace to handle whitespace
    return ""
}

func main() {
    tests := []struct {
        user, pass, expected string
    }{
        {"alice", "password123", "Login successful"},
        {"", "password123", "Username cannot be empty"},
        {"ab", "password123", "Username too short"},
        {"alice", "short", "Password too short (min 8 chars)"},
        {"  ", "password123", "Username cannot be empty"},
    }

    for _, tt := range tests {
        result := validateLogin(tt.user, tt.pass)
        status := "PASS"
        if result != tt.expected {
            status = "FAIL"
        }
        fmt.Printf("[%s] user=%q pass=%q\n  got: %q\n  want: %q\n",
            status, tt.user, tt.pass, result, tt.expected)
    }
}
```

---

## Task 4: BMI Calculator

**Difficulty:** Beginner
**Goal:** Calculate BMI and return the category

**Requirements:**
- BMI = weight(kg) / height(m)^2
- < 18.5 → "Underweight"
- 18.5 – 24.9 → "Normal weight"
- 25.0 – 29.9 → "Overweight"
- ≥ 30.0 → "Obese"
- Invalid input (weight ≤ 0 or height ≤ 0) → "Invalid input"

**Starter Code:**

```go
package main

import (
    "fmt"
    "math"
)

func bmiCategory(weightKg, heightM float64) string {
    // TODO: check invalid inputs first
    // TODO: calculate BMI
    // TODO: return category
    return ""
}

func main() {
    cases := []struct {
        weight, height float64
        name           string
    }{
        {50, 1.75, "Underweight"},
        {70, 1.75, "Normal"},
        {85, 1.75, "Overweight"},
        {100, 1.75, "Obese"},
        {0, 1.75, "Invalid"},
        {70, -1, "Invalid"},
    }
    for _, c := range cases {
        result := bmiCategory(c.weight, c.height)
        fmt.Printf("%.0fkg/%.2fm -> %s\n", c.weight, c.height, result)
    }
    _ = math.Pow // hint: use math.Pow(x, 2) or x*x
}
```

---

## Task 5: Leap Year Checker

**Difficulty:** Beginner
**Goal:** Determine if a year is a leap year

**Rules:**
- Divisible by 400 → leap year
- Divisible by 100 but not 400 → NOT a leap year
- Divisible by 4 but not 100 → leap year
- Otherwise → NOT a leap year

**Starter Code:**

```go
package main

import "fmt"

func isLeapYear(year int) bool {
    // TODO: implement the leap year logic
    // Order matters! Check 400 first, then 100, then 4
    return false
}

func main() {
    cases := []struct {
        year int
        want bool
    }{
        {2000, true},  // divisible by 400
        {1900, false}, // divisible by 100 but not 400
        {2024, true},  // divisible by 4 but not 100
        {2023, false}, // not divisible by 4
        {2100, false}, // divisible by 100 but not 400
        {2400, true},  // divisible by 400
    }

    for _, c := range cases {
        result := isLeapYear(c.year)
        status := "✓"
        if result != c.want {
            status = "✗"
        }
        fmt.Printf("%s Year %d: got %v, want %v\n", status, c.year, result, c.want)
    }
}
```

---

## Task 6: Password Strength Checker

**Difficulty:** Intermediate
**Goal:** Rate password strength based on multiple criteria

**Requirements:**
- "Very Weak": length < 6
- "Weak": length 6-7
- "Fair": length ≥ 8 but only one character class
- "Strong": length ≥ 8, has letters AND digits
- "Very Strong": length ≥ 12, has lowercase + uppercase + digits + special chars

**Starter Code:**

```go
package main

import (
    "fmt"
    "unicode"
)

func checkPasswordStrength(password string) string {
    length := len(password)

    // Count character classes
    var hasLower, hasUpper, hasDigit, hasSpecial bool
    for _, ch := range password {
        switch {
        case unicode.IsLower(ch):
            hasLower = true
        case unicode.IsUpper(ch):
            hasUpper = true
        case unicode.IsDigit(ch):
            hasDigit = true
        default:
            hasSpecial = true
        }
    }

    // TODO: implement strength classification
    // Use the variables: length, hasLower, hasUpper, hasDigit, hasSpecial
    _ = hasLower  // remove when used
    _ = hasUpper
    _ = hasDigit
    _ = hasSpecial

    return "Unknown"
}

func main() {
    passwords := []struct {
        password string
        expected string
    }{
        {"abc", "Very Weak"},
        {"abcdef", "Weak"},
        {"abcdefgh", "Fair"},
        {"abcdef12", "Strong"},
        {"Abcdef12!@#", "Very Strong"},
        {"ALLCAPS123!!", "Very Strong"},
        {"short1!", "Weak"},
    }

    for _, p := range passwords {
        result := checkPasswordStrength(p.password)
        status := "PASS"
        if result != p.expected {
            status = "FAIL"
        }
        fmt.Printf("[%s] %q -> %q (expected: %q)\n",
            status, p.password, result, p.expected)
    }
}
```

---

## Task 7: Triangle Classifier

**Difficulty:** Intermediate
**Goal:** Classify a triangle by its sides and angles

**Requirements:**
- Validate the triangle inequality (a + b > c for all permutations)
- If all sides equal → "Equilateral"
- If two sides equal → "Isosceles"
- Otherwise → "Scalene"
- Also determine if right triangle (a² + b² == c²)

**Starter Code:**

```go
package main

import (
    "fmt"
    "math"
)

type Triangle struct {
    A, B, C float64  // side lengths
}

func (t Triangle) IsValid() bool {
    // TODO: check triangle inequality
    return false
}

func (t Triangle) Type() string {
    if !t.IsValid() {
        return "Invalid"
    }
    // TODO: return "Equilateral", "Isosceles", or "Scalene"
    return ""
}

func (t Triangle) IsRight() bool {
    if !t.IsValid() {
        return false
    }
    // TODO: check if it's a right triangle
    // Hint: sort sides and check a² + b² == c²
    // Use math.Abs(x - y) < 1e-9 for float comparison
    _ = math.Abs
    return false
}

func main() {
    triangles := []Triangle{
        {3, 3, 3},   // equilateral
        {3, 3, 4},   // isosceles
        {3, 4, 5},   // scalene + right
        {5, 12, 13}, // scalene + right
        {1, 1, 10},  // invalid
        {6, 8, 10},  // scalene + right
    }

    for _, tri := range triangles {
        fmt.Printf("(%g, %g, %g): valid=%v, type=%s, right=%v\n",
            tri.A, tri.B, tri.C,
            tri.IsValid(), tri.Type(), tri.IsRight())
    }
}
```

---

## Task 8: Shopping Cart Discount

**Difficulty:** Intermediate
**Goal:** Apply discount rules to a shopping cart

**Discount Rules:**
- VIP users always get 20% off
- Orders over $200 get 15% off (unless VIP — VIP gets 20%)
- Orders over $100 get 10% off
- Members with coupon "SAVE10" get 10% off (can stack with VIP)
- Discounts don't stack (take the highest, except VIP+coupon stacks)

**Starter Code:**

```go
package main

import "fmt"

type Cart struct {
    Subtotal float64
    IsVIP    bool
    IsMember bool
    Coupon   string
}

func (c Cart) FinalPrice() float64 {
    discount := 0.0

    // TODO: implement discount logic
    // Remember: VIP + coupon can stack (VIP 20% + coupon 10% = 30%)
    // But other discounts don't stack

    return c.Subtotal * (1 - discount)
}

func main() {
    carts := []Cart{
        {150, false, false, ""},          // 10% off ($135)
        {250, false, false, ""},          // 15% off ($212.50)
        {100, true, false, ""},           // VIP 20% ($80)
        {100, true, false, "SAVE10"},     // VIP+coupon 30% ($70)
        {100, false, true, "SAVE10"},     // coupon 10% ($90)
        {50, false, false, ""},           // no discount ($50)
    }

    for _, c := range carts {
        fmt.Printf("$%.2f (vip=%v, coupon=%q) -> $%.2f\n",
            c.Subtotal, c.IsVIP, c.Coupon, c.FinalPrice())
    }
}
```

---

## Task 9: Network Packet Router

**Difficulty:** Intermediate
**Goal:** Route network packets based on IP ranges and protocols

**Requirements:**
- Private IPs (10.x.x.x, 192.168.x.x, 172.16-31.x.x) → "internal"
- Protocol TCP, port 80/443 → "web"
- Protocol TCP, port 22 → "ssh"
- Protocol UDP, port 53 → "dns"
- Otherwise → "unknown"

**Starter Code:**

```go
package main

import (
    "fmt"
    "strings"
)

type Packet struct {
    SrcIP    string
    DstIP    string
    Protocol string // "TCP" or "UDP"
    Port     int
}

func isPrivateIP(ip string) bool {
    // TODO: check if IP is in private ranges
    // Hint: use strings.HasPrefix
    _ = strings.HasPrefix
    return false
}

func routePacket(p Packet) string {
    // TODO: implement routing logic
    // Order: check destination IP first, then protocol+port
    return "unknown"
}

func main() {
    packets := []Packet{
        {"1.2.3.4", "10.0.0.1", "TCP", 80},
        {"10.0.0.1", "8.8.8.8", "UDP", 53},
        {"192.168.1.1", "10.0.0.2", "TCP", 22},
        {"172.16.1.1", "1.1.1.1", "TCP", 443},
        {"1.2.3.4", "5.6.7.8", "TCP", 8080},
    }

    for _, p := range packets {
        route := routePacket(p)
        fmt.Printf("%s -> %s:%d/%s -> %s\n",
            p.SrcIP, p.DstIP, p.Port, p.Protocol, route)
    }
}
```

---

## Task 10: Multi-level Access Control

**Difficulty:** Advanced
**Goal:** Implement RBAC (Role-Based Access Control) with if-else

**Requirements:**
- Roles: "guest", "user", "moderator", "admin", "superadmin"
- Resources: "public", "profile", "content", "settings", "system"
- Actions: "read", "write", "delete", "admin"
- Return true/false based on permission matrix

**Starter Code:**

```go
package main

import "fmt"

type Permission struct {
    Role     string
    Resource string
    Action   string
}

func hasPermission(p Permission) bool {
    // TODO: implement RBAC logic
    //
    // Rules:
    // superadmin: can do anything
    // admin: can do anything except system delete
    // moderator: can read/write/delete content; read/write profile; read settings
    // user: can read public/content, read/write own profile
    // guest: can only read public

    switch p.Role {
    case "superadmin":
        return true
    case "admin":
        // TODO
    case "moderator":
        // TODO
    case "user":
        // TODO
    case "guest":
        return p.Resource == "public" && p.Action == "read"
    }
    return false
}

func main() {
    tests := []struct {
        p    Permission
        want bool
    }{
        {Permission{"guest", "public", "read"}, true},
        {Permission{"guest", "content", "read"}, false},
        {Permission{"user", "public", "read"}, true},
        {Permission{"user", "profile", "write"}, true},
        {Permission{"user", "settings", "read"}, false},
        {Permission{"moderator", "content", "delete"}, true},
        {Permission{"moderator", "system", "read"}, false},
        {Permission{"admin", "system", "admin"}, true},
        {Permission{"admin", "system", "delete"}, false},
        {Permission{"superadmin", "system", "delete"}, true},
    }

    for _, tt := range tests {
        result := hasPermission(tt.p)
        status := "PASS"
        if result != tt.want {
            status = "FAIL"
        }
        fmt.Printf("[%s] %s can %s %s: got %v, want %v\n",
            status, tt.p.Role, tt.p.Action, tt.p.Resource, result, tt.want)
    }
}
```

---

## Task 11: Loan Eligibility Checker

**Difficulty:** Advanced
**Goal:** Determine loan eligibility and amount based on multiple criteria

**Requirements:**
- Minimum age: 21
- Minimum income: $25,000/year
- Minimum credit score: 620
- No outstanding defaults
- Loan amount = 5x annual income (max $500,000)
- Credit score >= 750: additional 20% bump
- Credit score 700-749: additional 10% bump

**Starter Code:**

```go
package main

import "fmt"

type Applicant struct {
    Age          int
    AnnualIncome float64
    CreditScore  int
    HasDefault   bool
}

type LoanDecision struct {
    Approved    bool
    MaxAmount   float64
    Reason      string
}

func evaluateLoan(a Applicant) LoanDecision {
    // TODO: implement loan eligibility logic
    // Use guard clauses for each rejection reason
    // Calculate loan amount for approved applicants

    return LoanDecision{}
}

func main() {
    applicants := []struct {
        a    Applicant
        name string
    }{
        {Applicant{25, 50000, 720, false}, "Alice"},
        {Applicant{20, 50000, 720, false}, "Bob (too young)"},
        {Applicant{25, 20000, 720, false}, "Carol (low income)"},
        {Applicant{25, 50000, 600, false}, "Dave (low credit)"},
        {Applicant{25, 50000, 720, true}, "Eve (has default)"},
        {Applicant{30, 80000, 760, false}, "Frank (excellent)"},
        {Applicant{40, 200000, 800, false}, "Grace (capped)"},
    }

    for _, item := range applicants {
        d := evaluateLoan(item.a)
        if d.Approved {
            fmt.Printf("%s: APPROVED for $%.0f\n", item.name, d.MaxAmount)
        } else {
            fmt.Printf("%s: DENIED (%s)\n", item.name, d.Reason)
        }
    }
}
```

---

## Task 12: Rate Limiter with Tiers

**Difficulty:** Advanced
**Goal:** Build a tiered rate limiter using if-else logic

**Requirements:**
- Free tier: 10 requests/minute
- Basic tier: 100 requests/minute
- Pro tier: 1000 requests/minute
- Enterprise: unlimited
- Return: whether request is allowed AND current usage info

**Starter Code:**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Tier string

const (
    Free       Tier = "free"
    Basic      Tier = "basic"
    Pro        Tier = "pro"
    Enterprise Tier = "enterprise"
)

type RateLimitResult struct {
    Allowed   bool
    Remaining int
    ResetIn   time.Duration
}

type TieredLimiter struct {
    mu      sync.Mutex
    clients map[string]*clientState
}

type clientState struct {
    tier      Tier
    requests  []time.Time
    windowSz  time.Duration
    limit     int
}

func NewTieredLimiter() *TieredLimiter {
    return &TieredLimiter{clients: make(map[string]*clientState)}
}

func (l *TieredLimiter) limitForTier(tier Tier) int {
    // TODO: return the limit for each tier
    // Enterprise: -1 (unlimited)
    return 0
}

func (l *TieredLimiter) Allow(clientID string, tier Tier) RateLimitResult {
    l.mu.Lock()
    defer l.mu.Unlock()

    // TODO: implement rate limiting logic
    // 1. Get or create client state
    // 2. If enterprise tier, always allow
    // 3. Filter out old requests (outside window)
    // 4. Check if under limit
    // 5. Record this request if allowed
    // 6. Return result with remaining count

    return RateLimitResult{Allowed: true}
}

func main() {
    limiter := NewTieredLimiter()

    // Test free tier
    for i := 0; i < 12; i++ {
        result := limiter.Allow("client-free", Free)
        fmt.Printf("Free request %2d: allowed=%v, remaining=%d\n",
            i+1, result.Allowed, result.Remaining)
    }
}
```
