# Functions — Optimize

> 12 exercises. Show before/after in **all 3 languages** with complexity comparison.

---

## Exercise 1: Recursive Fibonacci → Iterative

### Before — O(2^n) time, O(n) stack

#### Go

```go
func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}
// fib(40) takes several seconds
```

#### Java

```java
public static int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}
```

#### Python

```python
def fib(n):
    if n <= 1: return n
    return fib(n - 1) + fib(n - 2)
```

### After — O(n) time, O(1) space

#### Go

```go
func fib(n int) int {
    if n <= 1 { return n }
    a, b := 0, 1
    for i := 2; i <= n; i++ {
        a, b = b, a+b
    }
    return b
}
```

#### Java

```java
public static int fib(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int temp = b;
        b = a + b;
        a = temp;
    }
    return b;
}
```

#### Python

```python
def fib(n):
    if n <= 1: return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

**Impact:** O(2^n) → O(n) time. O(n) → O(1) space. `fib(40)` goes from seconds to microseconds.

---

## Exercise 2: Repeated Computation → Memoization

### Before — O(2^n) time, redundant computation

#### Go

```go
func uniquePaths(m, n int) int {
    if m == 1 || n == 1 { return 1 }
    return uniquePaths(m-1, n) + uniquePaths(m, n-1)
}
// uniquePaths(20, 20) is extremely slow
```

#### Java

```java
public static int uniquePaths(int m, int n) {
    if (m == 1 || n == 1) return 1;
    return uniquePaths(m - 1, n) + uniquePaths(m, n - 1);
}
```

#### Python

```python
def unique_paths(m, n):
    if m == 1 or n == 1: return 1
    return unique_paths(m - 1, n) + unique_paths(m, n - 1)
```

### After — O(m*n) time, O(m*n) space with memoization

#### Go

```go
func uniquePaths(m, n int) int {
    memo := make(map[[2]int]int)
    var dp func(int, int) int
    dp = func(r, c int) int {
        if r == 1 || c == 1 { return 1 }
        key := [2]int{r, c}
        if val, ok := memo[key]; ok { return val }
        memo[key] = dp(r-1, c) + dp(r, c-1)
        return memo[key]
    }
    return dp(m, n)
}
```

#### Java

```java
public static int uniquePaths(int m, int n) {
    int[][] memo = new int[m + 1][n + 1];
    return dp(m, n, memo);
}

private static int dp(int m, int n, int[][] memo) {
    if (m == 1 || n == 1) return 1;
    if (memo[m][n] != 0) return memo[m][n];
    memo[m][n] = dp(m - 1, n, memo) + dp(m, n - 1, memo);
    return memo[m][n];
}
```

#### Python

```python
from functools import lru_cache

@lru_cache(maxsize=None)
def unique_paths(m, n):
    if m == 1 or n == 1: return 1
    return unique_paths(m - 1, n) + unique_paths(m, n - 1)
```

**Impact:** Exponential → O(m*n). `uniquePaths(20, 20)` finishes instantly.

---

## Exercise 3: Callback Hell → Function Composition

### Before — deeply nested callbacks

#### Go

```go
func processOrder(orderID string) {
    fetchOrder(orderID, func(order Order, err error) {
        if err != nil { log.Fatal(err) }
        validateOrder(order, func(valid bool, err error) {
            if err != nil { log.Fatal(err) }
            if !valid { log.Fatal("invalid") }
            calculateTax(order, func(tax float64, err error) {
                if err != nil { log.Fatal(err) }
                saveOrder(order, tax, func(err error) {
                    if err != nil { log.Fatal(err) }
                    sendEmail(order.Email, func(err error) {
                        if err != nil { log.Fatal(err) }
                        fmt.Println("Done!")
                    })
                })
            })
        })
    })
}
```

### After — flat pipeline with error handling

#### Go

```go
func processOrder(orderID string) error {
    order, err := fetchOrder(orderID)
    if err != nil { return fmt.Errorf("fetch: %w", err) }

    if err := validateOrder(order); err != nil {
        return fmt.Errorf("validate: %w", err)
    }

    tax, err := calculateTax(order)
    if err != nil { return fmt.Errorf("tax: %w", err) }

    if err := saveOrder(order, tax); err != nil {
        return fmt.Errorf("save: %w", err)
    }

    return sendEmail(order.Email)
}
```

#### Java

```java
// Before: nested CompletableFuture callbacks
CompletableFuture.supplyAsync(() -> fetchOrder(id))
    .thenCompose(order -> CompletableFuture.supplyAsync(() -> validateOrder(order))
        .thenCompose(valid -> CompletableFuture.supplyAsync(() -> calculateTax(order))
            .thenCompose(tax -> CompletableFuture.supplyAsync(() -> saveOrder(order, tax))
                .thenCompose(v -> CompletableFuture.supplyAsync(() -> sendEmail(order.email))))));

// After: flat chain
CompletableFuture.supplyAsync(() -> fetchOrder(id))
    .thenApply(this::validateOrder)
    .thenApply(this::calculateTax)
    .thenApply(this::saveOrder)
    .thenApply(order -> sendEmail(order.getEmail()))
    .exceptionally(ex -> handleError(ex));
```

#### Python

```python
# Before: nested callbacks
def process_order(order_id):
    fetch_order(order_id, lambda order, err:
        None if err else
        validate_order(order, lambda valid, err:
            None if err else
            calculate_tax(order, lambda tax, err:
                None if err else
                save_order(order, tax, lambda err:
                    None if err else
                    send_email(order.email, lambda err:
                        print("Done!") if not err else None
                    )))))

# After: flat pipeline
def process_order(order_id):
    order = fetch_order(order_id)
    validate_order(order)
    tax = calculate_tax(order)
    save_order(order, tax)
    send_email(order.email)

# Or with pipe/compose
process = pipe(
    fetch_order,
    validate_order,
    calculate_tax,
    save_order,
    send_notification,
)
```

**Impact:** Same complexity, but readability goes from unmaintainable to clear.

---

## Exercise 4: Global State → Pure Functions

### Before — impure functions using global state

#### Go

```go
var taxRate = 0.08
var discount = 0.10
var currency = "USD"

func calculateTotal(price float64, quantity int) string {
    subtotal := price * float64(quantity)
    taxAmount := subtotal * taxRate
    discountAmount := subtotal * discount
    total := subtotal + taxAmount - discountAmount
    return fmt.Sprintf("%s %.2f", currency, total)
}
// Untestable: result depends on global variables
// Concurrent access is unsafe
```

### After — pure function with explicit inputs

#### Go

```go
type PricingConfig struct {
    TaxRate    float64
    Discount   float64
    Currency   string
}

func calculateTotal(price float64, quantity int, config PricingConfig) (float64, string) {
    subtotal := price * float64(quantity)
    taxAmount := subtotal * config.TaxRate
    discountAmount := subtotal * config.Discount
    total := subtotal + taxAmount - discountAmount
    return total, fmt.Sprintf("%s %.2f", config.Currency, total)
}
// Testable, thread-safe, no hidden dependencies
```

#### Java

```java
// Before
static double taxRate = 0.08;
static double discount = 0.10;

public static double calculateTotal(double price, int qty) {
    double subtotal = price * qty;
    return subtotal + subtotal * taxRate - subtotal * discount;
}

// After
public record PricingConfig(double taxRate, double discount, String currency) {}

public static double calculateTotal(double price, int qty, PricingConfig config) {
    double subtotal = price * qty;
    return subtotal * (1 + config.taxRate() - config.discount());
}
```

#### Python

```python
# Before
tax_rate = 0.08
discount = 0.10

def calculate_total(price, quantity):
    subtotal = price * quantity
    return subtotal + subtotal * tax_rate - subtotal * discount

# After
from dataclasses import dataclass

@dataclass(frozen=True)
class PricingConfig:
    tax_rate: float
    discount: float
    currency: str

def calculate_total(price, quantity, config):
    subtotal = price * quantity
    tax = subtotal * config.tax_rate
    disc = subtotal * config.discount
    return subtotal + tax - disc
```

**Impact:** Same O(1) complexity, but now testable, thread-safe, and free of hidden dependencies.

---

## Exercise 5: Repeated Function Calls → Compute Once

### Before — O(n * m) where m is cost of repeated call

#### Go

```go
func processItems(items []Item) []string {
    var results []string
    for _, item := range items {
        config := loadConfig()  // BUG: called N times, but config never changes
        result := transform(item, config)
        results = append(results, result)
    }
    return results
}
```

### After — O(n + m)

#### Go

```go
func processItems(items []Item) []string {
    config := loadConfig()  // called once
    results := make([]string, 0, len(items))
    for _, item := range items {
        results = append(results, transform(item, config))
    }
    return results
}
```

#### Java

```java
// Before
public static List<String> processItems(List<Item> items) {
    return items.stream()
        .map(item -> transform(item, loadConfig()))  // loadConfig() called N times
        .collect(Collectors.toList());
}

// After
public static List<String> processItems(List<Item> items) {
    Config config = loadConfig();  // called once
    return items.stream()
        .map(item -> transform(item, config))
        .collect(Collectors.toList());
}
```

#### Python

```python
# Before
def process_items(items):
    return [transform(item, load_config()) for item in items]  # load_config() called N times

# After
def process_items(items):
    config = load_config()  # called once
    return [transform(item, config) for item in items]
```

**Impact:** If `loadConfig()` takes 100ms and there are 1000 items: 100s → 0.1s.

---

## Exercise 6: Large Function → Decomposed Pipeline

### Before — monolith function, hard to test

#### Go

```go
func processCSV(filename string) error {
    file, err := os.Open(filename)
    if err != nil { return err }
    defer file.Close()

    reader := csv.NewReader(file)
    records, err := reader.ReadAll()
    if err != nil { return err }

    var results []Result
    for _, record := range records[1:] { // skip header
        name := strings.TrimSpace(record[0])
        age, err := strconv.Atoi(strings.TrimSpace(record[1]))
        if err != nil { continue }
        if age < 0 || age > 150 { continue }
        score, err := strconv.ParseFloat(strings.TrimSpace(record[2]), 64)
        if err != nil { continue }
        if score < 0 { score = 0 }
        results = append(results, Result{Name: name, Age: age, Score: score})
    }

    sort.Slice(results, func(i, j int) bool {
        return results[i].Score > results[j].Score
    })

    output, err := os.Create("output.json")
    if err != nil { return err }
    defer output.Close()
    return json.NewEncoder(output).Encode(results)
}
```

### After — decomposed, testable

#### Go

```go
func readCSV(filename string) ([][]string, error) {
    file, err := os.Open(filename)
    if err != nil { return nil, err }
    defer file.Close()
    return csv.NewReader(file).ReadAll()
}

func parseRecord(record []string) (Result, error) {
    name := strings.TrimSpace(record[0])
    age, err := strconv.Atoi(strings.TrimSpace(record[1]))
    if err != nil { return Result{}, err }
    score, err := strconv.ParseFloat(strings.TrimSpace(record[2]), 64)
    if err != nil { return Result{}, err }
    return Result{Name: name, Age: age, Score: score}, nil
}

func validateResult(r Result) bool {
    return r.Age >= 0 && r.Age <= 150 && r.Score >= 0
}

func normalizeResult(r Result) Result {
    if r.Score < 0 { r.Score = 0 }
    return r
}

func sortByScore(results []Result) {
    sort.Slice(results, func(i, j int) bool {
        return results[i].Score > results[j].Score
    })
}

func writeJSON(filename string, data interface{}) error {
    file, err := os.Create(filename)
    if err != nil { return err }
    defer file.Close()
    return json.NewEncoder(file).Encode(data)
}

// Orchestrator — easy to read, each step is testable
func processCSV(input, output string) error {
    records, err := readCSV(input)
    if err != nil { return fmt.Errorf("read: %w", err) }

    var results []Result
    for _, rec := range records[1:] {
        r, err := parseRecord(rec)
        if err != nil { continue }
        r = normalizeResult(r)
        if validateResult(r) {
            results = append(results, r)
        }
    }

    sortByScore(results)
    return writeJSON(output, results)
}
```

**Impact:** Same complexity, but each function is independently testable and reusable.

---

## Exercise 7: String Concatenation in Loop → Builder

### Before — O(n^2) in Java (string immutability)

#### Go

```go
// Go strings are immutable, but + creates new string each time
func joinWords(words []string) string {
    result := ""
    for _, w := range words {
        result += w + " "  // O(n) per concatenation → O(n²) total
    }
    return result
}
```

#### Java

```java
public static String joinWords(String[] words) {
    String result = "";
    for (String w : words) {
        result += w + " ";  // O(n) per concatenation → O(n²) total
    }
    return result;
}
```

#### Python

```python
def join_words(words):
    result = ""
    for w in words:
        result += w + " "  # O(n) per concatenation in worst case
    return result
```

### After — O(n) with builder/join

#### Go

```go
func joinWords(words []string) string {
    var sb strings.Builder
    for i, w := range words {
        if i > 0 { sb.WriteByte(' ') }
        sb.WriteString(w)
    }
    return sb.String()
}
// Or simply: strings.Join(words, " ")
```

#### Java

```java
public static String joinWords(String[] words) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < words.length; i++) {
        if (i > 0) sb.append(' ');
        sb.append(words[i]);
    }
    return sb.toString();
}
// Or: String.join(" ", words)
```

#### Python

```python
def join_words(words):
    return " ".join(words)
```

**Impact:** O(n^2) → O(n). For 100,000 words: seconds → milliseconds.

---

## Exercise 8: Multiple Passes → Single Pass

### Before — O(3n) = three passes over data

#### Go

```go
func stats(nums []float64) (float64, float64, float64) {
    // Pass 1: find min
    min := nums[0]
    for _, v := range nums {
        if v < min { min = v }
    }
    // Pass 2: find max
    max := nums[0]
    for _, v := range nums {
        if v > max { max = v }
    }
    // Pass 3: find average
    sum := 0.0
    for _, v := range nums {
        sum += v
    }
    return min, max, sum / float64(len(nums))
}
```

### After — O(n) single pass

#### Go

```go
func stats(nums []float64) (float64, float64, float64) {
    min, max, sum := nums[0], nums[0], 0.0
    for _, v := range nums {
        if v < min { min = v }
        if v > max { max = v }
        sum += v
    }
    return min, max, sum / float64(len(nums))
}
```

#### Java

```java
// Before: 3 passes with streams
double min = nums.stream().mapToDouble(Double::doubleValue).min().orElse(0);
double max = nums.stream().mapToDouble(Double::doubleValue).max().orElse(0);
double avg = nums.stream().mapToDouble(Double::doubleValue).average().orElse(0);

// After: single pass
DoubleSummaryStatistics stats = nums.stream()
    .mapToDouble(Double::doubleValue)
    .summaryStatistics();
double min = stats.getMin();
double max = stats.getMax();
double avg = stats.getAverage();
```

#### Python

```python
# Before: 3 passes
minimum = min(nums)
maximum = max(nums)
average = sum(nums) / len(nums)

# After: single pass
def stats(nums):
    lo = hi = nums[0]
    total = 0
    for v in nums:
        if v < lo: lo = v
        if v > hi: hi = v
        total += v
    return lo, hi, total / len(nums)
```

**Impact:** 3n → n iterations. Better cache locality. Matters for very large datasets.

---

## Exercise 9: Nested Function Calls → Flat with Early Return

### Before — deeply nested validation

#### Go

```go
func validateUser(u User) error {
    if u.Name != "" {
        if len(u.Name) >= 2 {
            if u.Email != "" {
                if strings.Contains(u.Email, "@") {
                    if u.Age > 0 {
                        if u.Age < 150 {
                            return nil
                        } else { return errors.New("age too high") }
                    } else { return errors.New("age must be positive") }
                } else { return errors.New("invalid email") }
            } else { return errors.New("email required") }
        } else { return errors.New("name too short") }
    } else { return errors.New("name required") }
}
```

### After — flat guard clauses

#### Go

```go
func validateUser(u User) error {
    if u.Name == "" { return errors.New("name required") }
    if len(u.Name) < 2 { return errors.New("name too short") }
    if u.Email == "" { return errors.New("email required") }
    if !strings.Contains(u.Email, "@") { return errors.New("invalid email") }
    if u.Age <= 0 { return errors.New("age must be positive") }
    if u.Age >= 150 { return errors.New("age too high") }
    return nil
}
```

#### Java

```java
// Before — nested
public static String validate(User u) {
    if (u.name != null && !u.name.isEmpty()) {
        if (u.name.length() >= 2) {
            if (u.email != null && u.email.contains("@")) {
                if (u.age > 0 && u.age < 150) {
                    return "valid";
                }
            }
        }
    }
    return "invalid";
}

// After — guard clauses
public static void validate(User u) {
    if (u.name == null || u.name.isEmpty()) throw new ValidationException("name required");
    if (u.name.length() < 2) throw new ValidationException("name too short");
    if (u.email == null || !u.email.contains("@")) throw new ValidationException("invalid email");
    if (u.age <= 0 || u.age >= 150) throw new ValidationException("invalid age");
}
```

#### Python

```python
# Before
def validate(user):
    if user.name:
        if len(user.name) >= 2:
            if user.email:
                if "@" in user.email:
                    if 0 < user.age < 150:
                        return True
    return False

# After
def validate(user):
    if not user.name: raise ValueError("name required")
    if len(user.name) < 2: raise ValueError("name too short")
    if not user.email: raise ValueError("email required")
    if "@" not in user.email: raise ValueError("invalid email")
    if not (0 < user.age < 150): raise ValueError("invalid age")
    return True
```

**Impact:** Same O(1) complexity, but cyclomatic complexity drops from 7 to 1 per check. Much easier to read and maintain.

---

## Exercise 10: Creating Functions in Loop → Create Once

### Before — function created N times

#### Go

```go
func processList(items []string) []string {
    var results []string
    for _, item := range items {
        // Function created fresh each iteration — unnecessary allocation
        transform := func(s string) string {
            return strings.ToUpper(strings.TrimSpace(s))
        }
        results = append(results, transform(item))
    }
    return results
}
```

### After — function created once

#### Go

```go
func processList(items []string) []string {
    transform := func(s string) string {
        return strings.ToUpper(strings.TrimSpace(s))
    }

    results := make([]string, len(items))
    for i, item := range items {
        results[i] = transform(item)
    }
    return results
}
```

#### Java

```java
// Before — lambda recreated (though JVM may optimize)
List<String> results = new ArrayList<>();
for (String item : items) {
    Function<String, String> transform = s -> s.trim().toUpperCase();
    results.add(transform.apply(item));
}

// After — single lambda
Function<String, String> transform = s -> s.trim().toUpperCase();
List<String> results = items.stream()
    .map(transform)
    .collect(Collectors.toList());
```

#### Python

```python
# Before
results = []
for item in items:
    transform = lambda s: s.strip().upper()  # created each iteration
    results.append(transform(item))

# After
transform = lambda s: s.strip().upper()  # created once
results = [transform(item) for item in items]

# Or even simpler
results = [item.strip().upper() for item in items]
```

**Impact:** Avoids N function object allocations. In Go and Python, this reduces GC pressure.

---

## Exercise 11: Synchronous Sequential → Concurrent Execution

### Before — sequential, O(n * latency)

#### Go

```go
func fetchAll(urls []string) []string {
    var results []string
    for _, url := range urls {
        body, err := fetch(url)  // each takes ~200ms
        if err != nil { continue }
        results = append(results, body)
    }
    return results // 10 URLs = 2000ms total
}
```

### After — concurrent, O(latency)

#### Go

```go
func fetchAll(urls []string) []string {
    results := make([]string, len(urls))
    var wg sync.WaitGroup

    for i, url := range urls {
        wg.Add(1)
        go func(idx int, u string) {
            defer wg.Done()
            body, err := fetch(u)
            if err != nil { return }
            results[idx] = body
        }(i, url)
    }

    wg.Wait()
    return results // 10 URLs = ~200ms total
}
```

#### Java

```java
// Before
List<String> results = urls.stream()
    .map(this::fetch)
    .collect(Collectors.toList());  // sequential

// After
List<CompletableFuture<String>> futures = urls.stream()
    .map(url -> CompletableFuture.supplyAsync(() -> fetch(url)))
    .collect(Collectors.toList());

List<String> results = futures.stream()
    .map(CompletableFuture::join)
    .collect(Collectors.toList());  // concurrent
```

#### Python

```python
# Before
results = [fetch(url) for url in urls]  # sequential

# After
import asyncio

async def fetch_all(urls):
    tasks = [fetch_async(url) for url in urls]
    return await asyncio.gather(*tasks)

# Or with ThreadPoolExecutor for sync functions
from concurrent.futures import ThreadPoolExecutor

def fetch_all(urls):
    with ThreadPoolExecutor(max_workers=10) as executor:
        return list(executor.map(fetch, urls))
```

**Impact:** 10 URLs at 200ms each: 2000ms → ~200ms. Latency becomes O(max single request) instead of O(sum of all).

---

## Exercise 12: Allocating in Hot Path → Pre-allocate

### Before — allocations inside tight loop

#### Go

```go
func processRecords(records []Record) []string {
    var results []string  // grows dynamically, reallocating multiple times
    for _, r := range records {
        result := fmt.Sprintf("%s: %d", r.Name, r.Value)  // allocates each time
        results = append(results, result)
    }
    return results
}
```

### After — pre-allocated, reduced allocations

#### Go

```go
func processRecords(records []Record) []string {
    results := make([]string, 0, len(records))  // pre-allocate capacity
    var buf strings.Builder
    for _, r := range records {
        buf.Reset()
        buf.WriteString(r.Name)
        buf.WriteString(": ")
        buf.WriteString(strconv.Itoa(r.Value))
        results = append(results, buf.String())
    }
    return results
}
```

#### Java

```java
// Before
List<String> results = new ArrayList<>();  // resizes multiple times
for (Record r : records) {
    results.add(r.name + ": " + r.value);
}

// After
List<String> results = new ArrayList<>(records.size());  // pre-sized
StringBuilder sb = new StringBuilder();
for (Record r : records) {
    sb.setLength(0);
    sb.append(r.name).append(": ").append(r.value);
    results.add(sb.toString());
}
```

#### Python

```python
# Before
results = []
for r in records:
    results.append(f"{r.name}: {r.value}")

# After — list comprehension (slightly faster due to internal optimization)
results = [f"{r.name}: {r.value}" for r in records]
```

**Impact:** Fewer memory allocations, less GC pressure. For 1M records: measurable improvement (typically 20-40% faster in Go/Java).

---

## Complexity Summary Table

| Exercise | Before | After | Speedup |
|----------|--------|-------|---------|
| 1. Fibonacci | O(2^n) | O(n) | Exponential |
| 2. Grid paths (memoize) | O(2^(m+n)) | O(m*n) | Exponential |
| 3. Callback → pipeline | Same O | Same O | Readability |
| 4. Global → pure | Same O | Same O | Testability |
| 5. Repeated call | O(n*m) | O(n+m) | Linear |
| 6. Monolith → decomposed | Same O | Same O | Maintainability |
| 7. String concat | O(n^2) | O(n) | Quadratic |
| 8. Multi-pass → single | O(3n) | O(n) | 3x constant |
| 9. Nested → guard | Same O | Same O | Readability |
| 10. Func in loop | O(n allocs) | O(1 alloc) | Constant |
| 11. Sequential → concurrent | O(n*latency) | O(latency) | n-fold |
| 12. Dynamic → pre-alloc | O(n) + reallocs | O(n) | 20-40% |
