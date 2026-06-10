# The Three Laws of TDD — Practice Tasks

> **Category:** [Craftsmanship Disciplines](../README.md) — write production code only to make a failing test pass, in the tightest possible loop.

10 graded TDD katas. The point is **not** the final code — it's the *sequence of red-green-refactor steps* that gets you there. Each task gives a starter, an ordered test list, and a worked walkthrough showing the steps. Do each one by hand before expanding the solution, and resist reading ahead: write one failing test at a time.

> **How to use these:** open a test file and a source file side by side, run tests on a keystroke, and obey the three laws strictly — even when it feels silly. The discomfort *is* the lesson. For why these specific exercises, see [Kata & Deliberate Practice](../07-kata-and-deliberate-practice/junior.md).

---

## Table of Contents

1. [Task 1: Drive a Stack](#task-1-drive-a-stack)
2. [Task 2: FizzBuzz](#task-2-fizzbuzz)
3. [Task 3: Roman Numerals](#task-3-roman-numerals)
4. [Task 4: Prime Factors](#task-4-prime-factors)
5. [Task 5: String Calculator](#task-5-string-calculator)
6. [Task 6: Fix a Bug Test-First](#task-6-fix-a-bug-test-first)
7. [Task 7: Triangulate an Average](#task-7-triangulate-an-average)
8. [Task 8: Bowling Score](#task-8-bowling-score)
9. [Task 9: Inject a Boundary (Fast Tests)](#task-9-inject-a-boundary)
10. [Task 10: Characterize Then TDD Legacy](#task-10-characterize-then-tdd-legacy)
11. [Practice Tips](#practice-tips)

---

## Task 1: Drive a Stack

**Goal:** Build a `Stack` purely from failing tests. Add exactly one capability per nano-cycle. No method exists until a test demands it.

**Test list (write one at a time, in order):**

```text
[ ] new stack is empty
[ ] after one push, not empty
[ ] push then pop returns the pushed value
[ ] pop on empty raises / errors
[ ] LIFO order: push 1,2 then pop gives 2 then 1
```

<details><summary>Walkthrough + Solution</summary>

### Python — the step sequence

```python
# RED: assert Stack().is_empty()
class Stack:
    def is_empty(self): return True        # GREEN (fake it)

# RED: s.push(1); assert not s.is_empty()
class Stack:
    def __init__(self): self._items = []
    def push(self, x): self._items.append(x)
    def is_empty(self): return len(self._items) == 0   # GREEN (real state forced)

# RED: s.push(1); assert s.pop() == 1
    def pop(self): return self._items.pop()            # GREEN

# RED: pytest.raises(IndexError): Stack().pop()  → already passes (list raises)
# RED: push 1,2 → pop==2, pop==1  → already passes (LIFO via list)
# REFACTOR: nothing to clean; the design emerged minimally.
```

### Go

```go
type Stack[T any] struct{ items []T }
func (s *Stack[T]) IsEmpty() bool { return len(s.items) == 0 }
func (s *Stack[T]) Push(x T)      { s.items = append(s.items, x) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 { return zero, false }
    x := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return x, true
}
```

**Lesson:** each test pulled exactly one capability into existence. You never wrote `pop` before a test asked for it. That's Law 1 in action.
</details>

---

## Task 2: FizzBuzz

**Goal:** The classic warm-up. Print `1..n` but `Fizz` for multiples of 3, `Buzz` for 5, `FizzBuzz` for both. Drive every rule from a test.

**Test list:**

```text
[ ] 1 -> "1"
[ ] 2 -> "2"        (forces str(n), not a constant)
[ ] 3 -> "Fizz"
[ ] 5 -> "Buzz"
[ ] 15 -> "FizzBuzz"
```

<details><summary>Walkthrough + Solution</summary>

### Python — step sequence

```python
# RED: fizzbuzz(1) == "1"   →  return "1"           (fake)
# RED: fizzbuzz(2) == "2"   →  return str(n)         (triangulated)
# RED: fizzbuzz(3) == "Fizz"→  if n%3==0: return "Fizz"; return str(n)
# RED: fizzbuzz(5) == "Buzz"→  add if n%5==0: return "Buzz"
# RED: fizzbuzz(15)=="FizzBuzz" → handle both first

def fizzbuzz(n):
    if n % 15 == 0: return "FizzBuzz"
    if n % 3 == 0:  return "Fizz"
    if n % 5 == 0:  return "Buzz"
    return str(n)

# REFACTOR (green): remove the magic 15 and the duplication
def fizzbuzz(n):
    out = ("Fizz" if n % 3 == 0 else "") + ("Buzz" if n % 5 == 0 else "")
    return out or str(n)
```

**Lesson:** the `15` case is best handled *before* 3 and 5 to reach green fast; the refactor step then collapses it into the cleaner concatenation form — exactly the red-green-*refactor* rhythm. Skipping the refactor leaves you with the ladder.
</details>

---

## Task 3: Roman Numerals

**Goal:** Convert an integer to Roman numerals. A famous kata because the test *order* dramatically changes how easily each step is reached.

**Test list (order matters):**

```text
[ ] 1 -> "I"
[ ] 2 -> "II"        (forces repetition / a loop)
[ ] 3 -> "III"
[ ] 4 -> "IV"        (forces the subtractive pair)
[ ] 5 -> "V"
[ ] 9 -> "IX"
[ ] 58 -> "LVIII"    (forces the value table)
[ ] 1994 -> "MCMXCIV"(general)
```

<details><summary>Walkthrough + Solution</summary>

### Java — the emergent design

```java
// After 1,2,3: you have a loop appending "I".
// 4 ("IV") tempts a special case — RESIST. Instead introduce a value/symbol table.
// 5,9,58,1994 all fall out of the table once "IV","IX","XL","XC","CD","CM" are entries.

String toRoman(int n) {
    int[] values =  {1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1};
    String[] syms = {"M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"};
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < values.length; i++) {
        while (n >= values[i]) {
            out.append(syms[i]);
            n -= values[i];
        }
    }
    return out.toString();
}
```

### Python

```python
PAIRS = [(1000,"M"),(900,"CM"),(500,"D"),(400,"CD"),(100,"C"),(90,"XC"),
         (50,"L"),(40,"XL"),(10,"X"),(9,"IX"),(5,"V"),(4,"IV"),(1,"I")]
def to_roman(n):
    out = ""
    for value, sym in PAIRS:
        while n >= value:
            out += sym
            n -= value
    return out
```

**Lesson:** the `4 -> "IV"` test is the inflection point. The naive instinct is a special-case `if`. Triangulating with `4`, then `9`, then `58` *forces* the table abstraction instead — the tests discover the design. This is why test order is a design activity.
</details>

---

## Task 4: Prime Factors

**Goal:** Return the prime factors of n as a list (`12 -> [2,2,3]`). Robert Martin's signature kata: the algorithm *emerges* from triangulation without you ever "designing" it.

**Test list:**

```text
[ ] 1  -> []
[ ] 2  -> [2]
[ ] 3  -> [3]
[ ] 4  -> [2,2]      (forces a loop)
[ ] 6  -> [2,3]      (forces dividing by the next factor)
[ ] 8  -> [2,2,2]
[ ] 9  -> [3,3]
```

<details><summary>Walkthrough + Solution</summary>

### Python — watch the algorithm grow one test at a time

```python
# 1 -> []            : return []
# 2 -> [2]           : if n>1: return [n]; return []
# 4 -> [2,2]         : while n%2==0: append 2; n//=2  ... then if n>1 append n
# 6 -> [2,3], 9->[3,3]: generalize the divisor from 2 to a loop

def prime_factors(n):
    factors = []
    divisor = 2
    while n > 1:
        while n % divisor == 0:
            factors.append(divisor)
            n //= divisor
        divisor += 1
    return factors
```

### Go

```go
func PrimeFactors(n int) []int {
    var factors []int
    for d := 2; n > 1; d++ {
        for n%d == 0 {
            factors = append(factors, d)
            n /= d
        }
    }
    return factors
}
```

**Lesson:** at no point did you sit back and "design the algorithm." Each failing test forced one more line, and the complete factorization loop *fell out*. This is triangulation at its purest — the kata that converts skeptics.
</details>

---

## Task 5: String Calculator

**Goal:** `add("")` is 0, `add("1")` is 1, `add("1,2")` is 3, then support newlines and custom delimiters. Roy Osherove's kata — great for practicing incremental requirements.

**Test list:**

```text
[ ] ""      -> 0
[ ] "1"     -> 1
[ ] "1,2"   -> 3
[ ] "1,2,3,4" -> 10   (arbitrary count)
[ ] "1\n2,3" -> 6     (newline delimiter)
[ ] "//;\n1;2" -> 3   (custom delimiter)
```

<details><summary>Walkthrough + Solution</summary>

### Python

```python
import re
def add(numbers):
    if numbers == "":
        return 0
    delimiter = "[,\n]"
    if numbers.startswith("//"):
        header, numbers = numbers[2:].split("\n", 1)
        delimiter = re.escape(header)
    return sum(int(x) for x in re.split(delimiter, numbers))
```

**Step notes:** `""->0` is a guard you add first. `"1"->1` forces `int(...)`. `"1,2"->3` forces splitting + sum. The arbitrary-count test forces the comprehension over a split (not a hard-coded two-operand parse). Newline and custom delimiter each get driven in as a separate red, with a refactor pass to keep the parsing readable.

**Lesson:** TDD shines for *incrementally specified* requirements — each new rule is a new red, and the earlier tests guard you against breaking prior behavior as you extend the parser.
</details>

---

## Task 6: Fix a Bug Test-First

**Goal:** Practice the single most valuable everyday application of the laws: never fix a bug without a failing test that reproduces it first.

**Given bug report:** *"`average([])` crashes with a divide-by-zero in production."*

```python
def average(nums):
    return sum(nums) / len(nums)   # ZeroDivisionError on []
```

<details><summary>Walkthrough + Solution</summary>

### Step 1 — reproduce as a failing test (RED), before touching the code

```python
def test_average_of_empty_is_zero():
    assert average([]) == 0        # currently raises ZeroDivisionError → RED
```

### Step 2 — minimum fix (GREEN)

```python
def average(nums):
    if not nums:
        return 0
    return sum(nums) / len(nums)
```

### Step 3 — confirm the existing happy-path test still passes; refactor if needed (nothing here).

**Lesson:** the failing test proves you understand the bug, proves the fix works, and *stays in the suite forever* as a regression guard. A fix without a failing-first test proves nothing and invites the bug to return. This is the habit to adopt before any other TDD habit. (See [Professional](professional.md) — "reproduce every bug with a failing test.")
</details>

---

## Task 7: Triangulate an Average

**Goal:** Practice the *fake-it → triangulate → generalize* progression explicitly, narrating each law.

**Test list:**

```text
[ ] mean([4]) == 4       (fake it: return 4)
[ ] mean([2,4]) == 3     (triangulate: forces sum/len)
[ ] mean([]) raises      (degenerate guard)
```

<details><summary>Walkthrough + Solution</summary>

```python
# RED: mean([4]) == 4
def mean(xs): return 4              # GREEN — fake it (Law 3 minimum)

# RED: mean([2,4]) == 3
# return 4 fails → the second example forces the real formula
def mean(xs): return sum(xs) / len(xs)   # GREEN — triangulated

# RED: mean([]) should raise ValueError
def mean(xs):
    if not xs:
        raise ValueError("mean of empty sequence")
    return sum(xs) / len(xs)
```

### Java

```java
double mean(double[] xs) {
    if (xs.length == 0) throw new IllegalArgumentException("empty");
    double sum = 0;
    for (double x : xs) sum += x;
    return sum / xs.length;
}
```

**Lesson:** the deliberate `return 4` first step is not a waste — it makes the *second* test do real work (proving the suite can demand generality). Narrate the law at each step: "Law 3 minimum here is a constant; the next test triangulates the formula."
</details>

---

## Task 8: Bowling Score

**Goal:** A harder kata (spares and strikes) where the test list and small steps matter most. Compute a ten-pin bowling game's total.

**Test list:**

```text
[ ] gutter game (all 0) -> 0
[ ] all ones -> 20
[ ] one spare then a 3 then zeros -> 16
[ ] one strike then 3,4 then zeros -> 24
[ ] perfect game (12 strikes) -> 300
```

<details><summary>Walkthrough + Solution</summary>

### Python — score by frames, bonuses driven in one test at a time

```python
class Game:
    def __init__(self):
        self.rolls = []
    def roll(self, pins):
        self.rolls.append(pins)
    def score(self):
        total, i = 0, 0
        for _ in range(10):                      # ten frames
            if self.rolls[i] == 10:              # strike
                total += 10 + self.rolls[i+1] + self.rolls[i+2]
                i += 1
            elif self.rolls[i] + self.rolls[i+1] == 10:  # spare
                total += 10 + self.rolls[i+2]
                i += 2
            else:
                total += self.rolls[i] + self.rolls[i+1]
                i += 2
        return total
```

**Step notes:** the gutter and all-ones tests get you a naive `sum`. The *spare* test forces the frame loop and the one-roll bonus. The *strike* test forces the strike branch and the two-roll bonus. The perfect game is a final confidence check — it should pass with no new code if the bonuses are right.

**Lesson:** on a harder problem the discipline pays off most: each test is a small, debuggable jump. If you'd written the whole `score` method first and it returned the wrong total for the perfect game, you'd have no idea which branch was wrong. TDD localizes the next failure to the last increment.
</details>

---

## Task 9: Inject a Boundary

**Goal:** Experience the *design pressure* of TDD directly — make untestable code testable by injecting a boundary, then TDD the logic.

**Given — untestable: constructs its own clock, so "expired" can't be tested deterministically.**

```python
import datetime
class Token:
    def is_expired(self):
        return datetime.datetime.now() > self.expiry   # depends on wall-clock!
```

<details><summary>Walkthrough + Solution</summary>

### Step 1 — the test pressure: you can't test expiry without controlling "now". Inject a clock.

```python
class Token:
    def __init__(self, expiry, clock=datetime.datetime.now):
        self.expiry, self.clock = expiry, clock
    def is_expired(self):
        return self.clock() > self.expiry
```

### Step 2 — now TDD both branches deterministically

```python
def test_not_expired_before_expiry():
    t = Token(expiry=dt(2030,1,1), clock=lambda: dt(2020,1,1))
    assert not t.is_expired()

def test_expired_after_expiry():
    t = Token(expiry=dt(2020,1,1), clock=lambda: dt(2030,1,1))
    assert t.is_expired()
```

### Go — inject a `now func() time.Time`

```go
type Token struct {
    Expiry time.Time
    Now    func() time.Time     // injected boundary
}
func (t Token) IsExpired() bool { return t.Now().After(t.Expiry) }
```

**Lesson:** the requirement to write a *fast, deterministic* test forced the clock to become an injected dependency. The code got more testable **and** more flexible (you can now run it against any clock). This is "tests as the first client" and the design pressure described in [Senior](senior.md).
</details>

---

## Task 10: Characterize Then TDD Legacy

**Goal:** Practice the professional legacy on-ramp — you can't TDD untested code directly; you characterize, seam, then TDD.

**Given — legacy, no tests, hard to read:**

```python
def fee(amount, tier, weekend):
    f = amount * 0.02
    if tier == "gold": f *= 0.5
    if weekend: f += 1.0
    return round(f, 2)
```

<details><summary>Walkthrough + Solution</summary>

### Step 1 — characterize current behavior (test-AFTER, pin what it does today)

```python
def test_fee_characterization():
    assert fee(1000, "std", False) == 20.0
    assert fee(1000, "gold", False) == 10.0
    assert fee(1000, "gold", True) == 11.0   # whatever it currently produces
```

### Step 2 — with the net in place, NOW TDD a new requirement (red first)

```python
# New rule: platinum tier pays no fee.
def test_platinum_is_free():
    assert fee(1000, "platinum", False) == 0.0   # RED

# minimum change to pass:
def fee(amount, tier, weekend):
    if tier == "platinum":
        return 0.0
    f = amount * 0.02
    if tier == "gold": f *= 0.5
    if weekend: f += 1.0
    return round(f, 2)
```

### Step 3 — refactor on green, protected by both the characterization and the new tests.

**Lesson:** the three laws can't start until there's a seam and a safety net. Characterization tests (test-after) come *first* on legacy; only then do you TDD the change. Trying to skip straight to test-first on untestable legacy is how teams wrongly decide TDD "doesn't work." See [Professional](professional.md) and [Working with Legacy Code](../../working-with-legacy-code/README.md).
</details>

---

## Practice Tips

1. **One failing test at a time.** Keep a written test list; don't write the next test until the current one is green.
2. **Always see red before green.** If a new test passes immediately, break the code to confirm it can fail.
3. **Use the right path to green:** fake-it + triangulate when unsure, obvious-implementation when confident.
4. **Never skip the refactor beat** — that's where FizzBuzz and Roman numerals go from ladder to clean.
5. **Order tests for the smallest code jump** — degenerate case first, hardest case last. The order *is* design.
6. **Fix every bug test-first** (Task 6) — adopt this habit before any other.
7. **When code is hard to test, fix the design, not the test** (Task 9) — listen to the design pressure.
8. **On legacy, characterize first** (Task 10) — the laws come last, not first.

---

[← Interview](interview.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
