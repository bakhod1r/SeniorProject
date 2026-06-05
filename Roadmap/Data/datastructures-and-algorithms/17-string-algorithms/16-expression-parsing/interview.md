# Expression Parsing & Evaluation — Interview Preparation

Expression evaluation is a perennial interview favorite ("Basic Calculator", "Evaluate Reverse Polish Notation", "Infix to Postfix") because it tests a crisp set of skills in a small space: do you understand **precedence and associativity**, can you wield a **stack** (or two), do you know the **Shunting-yard** algorithm and **RPN evaluation**, and can you write a clean **recursive-descent** parser? It also rewards the single best instinct — *handle precedence once, then evaluate trivially*. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|------------|
| Evaluate infix `+ - * / ( )` | Shunting-yard or two-stack | `O(n)` |
| Infix → postfix (RPN) | Shunting-yard | `O(n)` |
| Evaluate RPN | value stack | `O(n)` |
| Calculator with precedence | two-stack or recursive descent | `O(n)` |
| Right-associative `^` | strict `>` pop / right recursion | `O(n)` |
| Unary minus | detect by context (start/after op/after `(`) | `O(n)` |
| Build & evaluate an AST | recursive descent | `O(n)` |

Precedence (high → low): `^` (right-assoc) > `* /` (left) > `+ -` (left). Unary `-` binds tighter than `*`/`/`.

Shunting-yard pop rule:

```text
on operator o1:
    while top is operator o2 and
          (prec(o2) > prec(o1) or (prec(o2)==prec(o1) and o1 is left-assoc)):
        pop o2 to output
    push o1
```

RPN evaluation rule:

```text
number -> push
operator -> b=pop, a=pop, push(a OP b)   # second pop is the LEFT operand
```

Key facts:
- **Postfix needs no parentheses and no precedence** — order of operators is order of evaluation.
- For `-` and `/`, the **second pop is the left operand**; swapping them is the classic bug.
- A valid expression ends with **exactly one value** on the stack.
- Never run host `eval` on untrusted input.

---

## Junior Questions (10 Q&A)

### J1. What is a token, and what does the tokenizer do?
A token is the smallest meaningful unit: a number, an operator (`+ - * / ^`), or a parenthesis. The tokenizer (lexer) scans the raw string, skips whitespace, groups consecutive digits into one number token, and emits each operator/paren as its own token. It turns `"12 + 3"` into `[12, +, 3]`.

### J2. Why is `3 + 4 * 2` equal to 11 and not 14?
Because `*` has higher **precedence** than `+`, so multiplication applies first: `4 * 2 = 8`, then `3 + 8 = 11`. A left-to-right scan that applies operators as it meets them wrongly gives `(3+4)*2 = 14`.

### J3. What is postfix (RPN) and why is it useful?
Reverse Polish Notation places the operator after its operands: `3 4 +`. It needs **no parentheses and no precedence rules** — the order of operators is exactly the order of evaluation, so it can be evaluated with a single stack pass.

### J4. How do you evaluate RPN?
Scan left to right with a value stack: push numbers; on a binary operator pop two values (`b` then `a`) and push `a OP b`. The final remaining value is the result.

### J5. In RPN evaluation, which popped value is the left operand?
The **second** one popped. The first pop is the right operand `b`, the second is the left operand `a`, so you compute `a - b`, not `b - a`. This matters for `-`, `/`, `^`.

### J6. What is the Shunting-yard algorithm?
Dijkstra's algorithm to convert infix to postfix. It scans tokens, sends numbers to the output, and uses an operator stack: it pops higher-precedence operators to the output before pushing a new operator, and handles parentheses as barriers.

### J7. What is associativity?
It decides how equal-precedence operators group. Left-associative: `8 / 4 / 2 = (8/4)/2 = 1`. Right-associative: `2 ^ 3 ^ 2 = 2^(3^2) = 512`. Most operators are left-associative; exponent is right-associative.

### J8. How are parentheses handled in Shunting-yard?
Push `(` onto the operator stack (it acts as a barrier so nothing pops past it). On `)`, pop operators to the output until you reach the matching `(`, then discard the `(`.

### J9. What is the time complexity of the full pipeline?
`O(n)` in the number of tokens. Each token is pushed and popped a constant number of times across tokenize, shunt, and evaluate.

### J10. What does the operator stack contain at the very end of Shunting-yard?
After all input is consumed, any operators still on the stack are popped to the output. If a `(` is still there, the input had a missing `)` — a parenthesis-mismatch error.

---

## Middle Questions (8 Q&A)

### M1. Describe the direct two-stack infix evaluator.
Keep a values stack and an operators stack. Push numbers to values; push `(` to operators; on `)` apply operators until `(`; on an operator, apply higher-or-equal-precedence operators (left-assoc) before pushing it; at the end apply the rest. "Apply" = pop one operator and two values, push the result. It is Shunting-yard that evaluates as it goes — no RPN list.

### M2. How does recursive descent encode precedence?
Through the **nesting of grammar rules**: `expr` (low precedence) calls `term` calls `power` calls `unary` calls `primary`. Higher-precedence operators live in deeper rules, so they bind tighter automatically. No precedence numbers are needed.

### M3. Give a grammar for `+ - * /`, parentheses, unary minus, right-assoc `^`.
```
expr    = term { ("+"|"-") term }
term    = power { ("*"|"/") power }
power   = unary [ "^" power ]        # right recursion → right-assoc
unary   = ("+"|"-") unary | primary
primary = NUMBER | "(" expr ")"
```

### M4. How do you make `^` right-associative?
In recursive descent, recurse on the right: `power = unary [ "^" power ]`. In Shunting-yard, use a **strict `>`** pop condition for `^` so an equal-precedence `^` is *not* popped, leaving `a ^ (b ^ c)`.

### M5. How do you disambiguate unary minus from binary minus?
A `-` is **unary** when it appears at the start of input, immediately after another operator, or immediately after `(`; otherwise it is binary. In recursive descent the `unary` rule is reached exactly in those positions, so it is disambiguated structurally.

### M6. When would you build an AST instead of evaluating directly?
When you need to reuse the parse: evaluate repeatedly with different variable values, optimize (constant folding), pretty-print, or produce precise error positions. The AST is a reusable tree; postfix is a throwaway flat form.

### M7. What is the difference between the `>=` and `>` pop conditions?
`>=` (pop on equal precedence) gives **left-associativity**; `>` (do not pop on equal precedence) gives **right-associativity**. Using the wrong one turns `8/4/2` into `4` or `2^3^2` into `64`.

### M8. How do you detect a malformed expression?
Check parenthesis balance (no `)` without `(`, no leftover `(`), operand counts (each operator must find two operands; one value must remain at the end), and reject illegal characters during lexing. Recursive descent additionally errors when a rule expects an operand but finds an operator.

---

## Senior Questions (7 Q&A)

### S1. Compare Shunting-yard, recursive descent, and Pratt parsing.
All three compute the **same parse** for the same operator table. Shunting-yard is iterative and stack-only (great for pure arithmetic, no recursion limit). Recursive descent mirrors a grammar and gives natural error positions but adds a rule per precedence level. Pratt / precedence climbing keeps recursive-descent clarity while making precedence a **data-driven** binding-power table — best when there are many operators.

### S2. How does precedence climbing work?
A single `parseExpr(minPrec)` parses an atom, then loops while the next operator has precedence `>= minPrec`, recursing with `prec+1` for left-associative (so equal precedence stays in the loop → left grouping) or `prec` for right-associative (so equal precedence nests right). It replaces the whole `expr/term/factor` chain.

### S3. Why must you never `eval` untrusted input?
Host `eval` can execute arbitrary code (`__import__('os').system(...)`). A hand-written evaluator is a **capability sandbox**: it can only perform the arithmetic and whitelisted functions/variables you implemented — no filesystem, network, or reflection access.

### S4. How do you support variables and functions?
Resolve identifiers against an **environment** map at evaluation time, and look function names up in a **registry** of name → implementation, checking arity. Keeping resolution at eval time lets you parse once and evaluate many times with different bindings.

### S5. How do you produce good error messages?
Carry each token's **source offset** so errors can say "expected operand at column 5". Classify failures into lex / parse / eval. For editors, use panic-mode recovery (skip to a synchronizing token) to report multiple errors per parse.

### S6. What resource bounds protect an expression engine?
Cap expression length, token count, parenthesis nesting depth (prevents stack-overflow DoS), recursion depth, and numeric magnitude/exponent (`9^9^9` must be rejected or capped). Functions must be pure.

### S7. How do you make repeated evaluation fast?
Parse once to an AST or RPN, cache it keyed by the formula string, and re-evaluate against changing variables. Optionally flatten to bytecode/RPN or compile to closures, and constant-fold literal subtrees.

---

## Behavioral Prompts

- **"Tell me about a time you parsed or evaluated user input."** Emphasize the security boundary (no host eval), validation, and clear error messages.
- **"Describe a subtle correctness bug you fixed."** The operand-order bug in RPN (`a - b` vs `b - a`) or the associativity `>=`/`>` bug are great concrete examples.
- **"How do you decide between two valid approaches?"** Contrast Shunting-yard (iterative, compact) vs recursive descent (grammar clarity, AST, errors) and explain you pick by requirements, not habit.
- **"How do you test code with many edge cases?"** Describe a reference-evaluator oracle, associativity/unary pins, the error-class table, and fuzzing for crashes/hangs.

---

## Coding Challenge 1: Evaluate Reverse Polish Notation

**Problem.** Given an array of tokens in RPN (e.g. `["2","1","+","3","*"]`), evaluate it. Operators are `+ - * /`; division truncates toward zero. Return the integer result.

### Go
```go
package main

import (
	"fmt"
	"strconv"
)

func evalRPN(tokens []string) int {
	st := []int{}
	for _, t := range tokens {
		switch t {
		case "+", "-", "*", "/":
			b := st[len(st)-1]
			a := st[len(st)-2]
			st = st[:len(st)-2]
			var r int
			switch t {
			case "+":
				r = a + b
			case "-":
				r = a - b
			case "*":
				r = a * b
			case "/":
				r = a / b // Go truncates toward zero for ints
			}
			st = append(st, r)
		default:
			n, _ := strconv.Atoi(t)
			st = append(st, n)
		}
	}
	return st[0]
}

func main() {
	fmt.Println(evalRPN([]string{"2", "1", "+", "3", "*"})) // (2+1)*3 = 9
	fmt.Println(evalRPN([]string{"4", "13", "5", "/", "+"})) // 4 + 13/5 = 6
}
```

### Java
```java
import java.util.*;

public class EvalRPN {
    static int evalRPN(String[] tokens) {
        Deque<Integer> st = new ArrayDeque<>();
        for (String t : tokens) {
            switch (t) {
                case "+": case "-": case "*": case "/":
                    int b = st.pop(), a = st.pop();
                    switch (t) {
                        case "+": st.push(a + b); break;
                        case "-": st.push(a - b); break;
                        case "*": st.push(a * b); break;
                        case "/": st.push(a / b); break; // truncates toward zero
                    }
                    break;
                default:
                    st.push(Integer.parseInt(t));
            }
        }
        return st.pop();
    }

    public static void main(String[] args) {
        System.out.println(evalRPN(new String[]{"2", "1", "+", "3", "*"})); // 9
        System.out.println(evalRPN(new String[]{"4", "13", "5", "/", "+"})); // 6
    }
}
```

### Python
```python
def eval_rpn(tokens):
    st = []
    for t in tokens:
        if t in ("+", "-", "*", "/"):
            b = st.pop()
            a = st.pop()
            if t == "+":
                st.append(a + b)
            elif t == "-":
                st.append(a - b)
            elif t == "*":
                st.append(a * b)
            else:
                st.append(int(a / b))  # truncate toward zero
        else:
            st.append(int(t))
    return st[0]


if __name__ == "__main__":
    print(eval_rpn(["2", "1", "+", "3", "*"]))   # 9
    print(eval_rpn(["4", "13", "5", "/", "+"]))  # 6
```

---

## Coding Challenge 2: Basic Calculator (infix with `+ - * / ( )`)

**Problem.** Evaluate an infix expression string with non-negative integers, `+ - * /`, parentheses, and spaces. Integer division truncates toward zero. Use the **two-stack** method.

### Go
```go
package main

import "fmt"

func prec(op byte) int {
	if op == '+' || op == '-' {
		return 1
	}
	if op == '*' || op == '/' {
		return 2
	}
	return 0
}

func apply(vals []int, op byte) []int {
	b := vals[len(vals)-1]
	a := vals[len(vals)-2]
	vals = vals[:len(vals)-2]
	switch op {
	case '+':
		vals = append(vals, a+b)
	case '-':
		vals = append(vals, a-b)
	case '*':
		vals = append(vals, a*b)
	case '/':
		vals = append(vals, a/b)
	}
	return vals
}

func calculate(s string) int {
	var vals []int
	var ops []byte
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == ' ':
			i++
		case c >= '0' && c <= '9':
			n := 0
			for i < len(s) && s[i] >= '0' && s[i] <= '9' {
				n = n*10 + int(s[i]-'0')
				i++
			}
			vals = append(vals, n)
		case c == '(':
			ops = append(ops, c)
			i++
		case c == ')':
			for ops[len(ops)-1] != '(' {
				vals = apply(vals, ops[len(ops)-1])
				ops = ops[:len(ops)-1]
			}
			ops = ops[:len(ops)-1] // pop '('
			i++
		default: // operator
			for len(ops) > 0 && ops[len(ops)-1] != '(' &&
				prec(ops[len(ops)-1]) >= prec(c) {
				vals = apply(vals, ops[len(ops)-1])
				ops = ops[:len(ops)-1]
			}
			ops = append(ops, c)
			i++
		}
	}
	for len(ops) > 0 {
		vals = apply(vals, ops[len(ops)-1])
		ops = ops[:len(ops)-1]
	}
	return vals[0]
}

func main() {
	fmt.Println(calculate("2*(3+4)-5"))   // 9
	fmt.Println(calculate("10 + 2 * 6"))  // 22
	fmt.Println(calculate("100 * 2 + 12")) // 212
}
```

### Java
```java
import java.util.*;

public class BasicCalculator {
    static int prec(char op) {
        if (op == '+' || op == '-') return 1;
        if (op == '*' || op == '/') return 2;
        return 0;
    }

    static void apply(Deque<Integer> vals, char op) {
        int b = vals.pop(), a = vals.pop();
        switch (op) {
            case '+': vals.push(a + b); break;
            case '-': vals.push(a - b); break;
            case '*': vals.push(a * b); break;
            case '/': vals.push(a / b); break;
        }
    }

    static int calculate(String s) {
        Deque<Integer> vals = new ArrayDeque<>();
        Deque<Character> ops = new ArrayDeque<>();
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c == ' ') { i++; }
            else if (Character.isDigit(c)) {
                int n = 0;
                while (i < s.length() && Character.isDigit(s.charAt(i))) {
                    n = n * 10 + (s.charAt(i) - '0');
                    i++;
                }
                vals.push(n);
            } else if (c == '(') { ops.push(c); i++; }
            else if (c == ')') {
                while (ops.peek() != '(') apply(vals, ops.pop());
                ops.pop();
                i++;
            } else {
                while (!ops.isEmpty() && ops.peek() != '(' &&
                       prec(ops.peek()) >= prec(c))
                    apply(vals, ops.pop());
                ops.push(c);
                i++;
            }
        }
        while (!ops.isEmpty()) apply(vals, ops.pop());
        return vals.pop();
    }

    public static void main(String[] args) {
        System.out.println(calculate("2*(3+4)-5"));    // 9
        System.out.println(calculate("10 + 2 * 6"));   // 22
        System.out.println(calculate("100 * 2 + 12")); // 212
    }
}
```

### Python
```python
def calculate(s):
    def prec(op):
        return 1 if op in "+-" else 2 if op in "*/" else 0

    def apply(vals, op):
        b = vals.pop()
        a = vals.pop()
        if op == "+":
            vals.append(a + b)
        elif op == "-":
            vals.append(a - b)
        elif op == "*":
            vals.append(a * b)
        else:
            vals.append(int(a / b))   # truncate toward zero

    vals, ops, i = [], [], 0
    while i < len(s):
        c = s[i]
        if c == " ":
            i += 1
        elif c.isdigit():
            n = 0
            while i < len(s) and s[i].isdigit():
                n = n * 10 + int(s[i])
                i += 1
            vals.append(n)
        elif c == "(":
            ops.append(c)
            i += 1
        elif c == ")":
            while ops[-1] != "(":
                apply(vals, ops.pop())
            ops.pop()
            i += 1
        else:
            while ops and ops[-1] != "(" and prec(ops[-1]) >= prec(c):
                apply(vals, ops.pop())
            ops.append(c)
            i += 1
    while ops:
        apply(vals, ops.pop())
    return vals[0]


if __name__ == "__main__":
    print(calculate("2*(3+4)-5"))    # 9
    print(calculate("10 + 2 * 6"))   # 22
    print(calculate("100 * 2 + 12")) # 212
```

---

## Coding Challenge 3: Infix → Postfix (Shunting-yard)

**Problem.** Convert an infix expression (single-digit operands, `+ - * / ^`, parentheses) to a space-separated postfix string. `^` is right-associative.

### Go
```go
package main

import (
	"fmt"
	"strings"
)

func prec(c byte) int {
	switch c {
	case '+', '-':
		return 1
	case '*', '/':
		return 2
	case '^':
		return 3
	}
	return 0
}

func toPostfix(s string) string {
	var out []string
	var ops []byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == ' ':
		case c >= '0' && c <= '9':
			out = append(out, string(c))
		case c == '(':
			ops = append(ops, c)
		case c == ')':
			for ops[len(ops)-1] != '(' {
				out = append(out, string(ops[len(ops)-1]))
				ops = ops[:len(ops)-1]
			}
			ops = ops[:len(ops)-1]
		default:
			rightAssoc := c == '^'
			for len(ops) > 0 && ops[len(ops)-1] != '(' &&
				(prec(ops[len(ops)-1]) > prec(c) ||
					(prec(ops[len(ops)-1]) == prec(c) && !rightAssoc)) {
				out = append(out, string(ops[len(ops)-1]))
				ops = ops[:len(ops)-1]
			}
			ops = append(ops, c)
		}
	}
	for len(ops) > 0 {
		out = append(out, string(ops[len(ops)-1]))
		ops = ops[:len(ops)-1]
	}
	return strings.Join(out, " ")
}

func main() {
	fmt.Println(toPostfix("3+4*2"))    // 3 4 2 * +
	fmt.Println(toPostfix("2^3^2"))    // 2 3 2 ^ ^
	fmt.Println(toPostfix("(1+2)*3"))  // 1 2 + 3 *
}
```

### Java
```java
import java.util.*;

public class InfixToPostfix {
    static int prec(char c) {
        switch (c) {
            case '+': case '-': return 1;
            case '*': case '/': return 2;
            case '^': return 3;
        }
        return 0;
    }

    static String toPostfix(String s) {
        StringBuilder out = new StringBuilder();
        Deque<Character> ops = new ArrayDeque<>();
        for (char c : s.toCharArray()) {
            if (c == ' ') continue;
            if (Character.isDigit(c)) {
                out.append(c).append(' ');
            } else if (c == '(') {
                ops.push(c);
            } else if (c == ')') {
                while (ops.peek() != '(') out.append(ops.pop()).append(' ');
                ops.pop();
            } else {
                boolean rightAssoc = c == '^';
                while (!ops.isEmpty() && ops.peek() != '(' &&
                       (prec(ops.peek()) > prec(c) ||
                        (prec(ops.peek()) == prec(c) && !rightAssoc)))
                    out.append(ops.pop()).append(' ');
                ops.push(c);
            }
        }
        while (!ops.isEmpty()) out.append(ops.pop()).append(' ');
        return out.toString().trim();
    }

    public static void main(String[] args) {
        System.out.println(toPostfix("3+4*2"));   // 3 4 2 * +
        System.out.println(toPostfix("2^3^2"));   // 2 3 2 ^ ^
        System.out.println(toPostfix("(1+2)*3")); // 1 2 + 3 *
    }
}
```

### Python
```python
def to_postfix(s):
    def prec(c):
        return {"+": 1, "-": 1, "*": 2, "/": 2, "^": 3}.get(c, 0)

    out, ops = [], []
    for c in s:
        if c == " ":
            continue
        if c.isdigit():
            out.append(c)
        elif c == "(":
            ops.append(c)
        elif c == ")":
            while ops[-1] != "(":
                out.append(ops.pop())
            ops.pop()
        else:
            right_assoc = c == "^"
            while (ops and ops[-1] != "(" and
                   (prec(ops[-1]) > prec(c) or
                    (prec(ops[-1]) == prec(c) and not right_assoc))):
                out.append(ops.pop())
            ops.append(c)
    while ops:
        out.append(ops.pop())
    return " ".join(out)


if __name__ == "__main__":
    print(to_postfix("3+4*2"))    # 3 4 2 * +
    print(to_postfix("2^3^2"))    # 2 3 2 ^ ^
    print(to_postfix("(1+2)*3"))  # 1 2 + 3 *
```

---

## Coding Challenge 4: Recursive-Descent Calculator with Precedence

**Problem.** Parse and evaluate an expression with multi-digit numbers, `+ - * /`, parentheses, and unary minus, returning a double. Use **recursive descent** with the grammar `expr → term {(+|-) term}`, `term → factor {(*|/) factor}`, `factor → NUMBER | (expr) | -factor`.

### Go
```go
package main

import (
	"fmt"
	"strconv"
)

type P struct {
	s string
	i int
}

func (p *P) skip() {
	for p.i < len(p.s) && p.s[p.i] == ' ' {
		p.i++
	}
}
func (p *P) cur() byte {
	p.skip()
	if p.i < len(p.s) {
		return p.s[p.i]
	}
	return 0
}

func (p *P) expr() float64 {
	v := p.term()
	for p.cur() == '+' || p.cur() == '-' {
		op := p.cur()
		p.i++
		r := p.term()
		if op == '+' {
			v += r
		} else {
			v -= r
		}
	}
	return v
}

func (p *P) term() float64 {
	v := p.factor()
	for p.cur() == '*' || p.cur() == '/' {
		op := p.cur()
		p.i++
		r := p.factor()
		if op == '*' {
			v *= r
		} else {
			v /= r
		}
	}
	return v
}

func (p *P) factor() float64 {
	if p.cur() == '-' { // unary minus
		p.i++
		return -p.factor()
	}
	if p.cur() == '(' {
		p.i++
		v := p.expr()
		p.skip()
		p.i++ // ')'
		return v
	}
	start := p.i
	for p.i < len(p.s) && (p.s[p.i] >= '0' && p.s[p.i] <= '9' || p.s[p.i] == '.') {
		p.i++
	}
	n, _ := strconv.ParseFloat(p.s[start:p.i], 64)
	return n
}

func main() {
	for _, e := range []string{"-3 + 4 * 2", "(1 + 2) * 3 - 4", "10 / (2 + 3)"} {
		p := &P{s: e}
		fmt.Printf("%-18s = %g\n", e, p.expr())
	}
	// 5, 5, 2
}
```

### Java
```java
public class RecursiveCalc {
    private final String s;
    private int i = 0;
    RecursiveCalc(String s) { this.s = s; }

    private void skip() { while (i < s.length() && s.charAt(i) == ' ') i++; }
    private char cur() { skip(); return i < s.length() ? s.charAt(i) : '\0'; }

    double expr() {
        double v = term();
        while (cur() == '+' || cur() == '-') {
            char op = cur(); i++;
            double r = term();
            v = (op == '+') ? v + r : v - r;
        }
        return v;
    }

    double term() {
        double v = factor();
        while (cur() == '*' || cur() == '/') {
            char op = cur(); i++;
            double r = factor();
            v = (op == '*') ? v * r : v / r;
        }
        return v;
    }

    double factor() {
        if (cur() == '-') { i++; return -factor(); }
        if (cur() == '(') {
            i++;
            double v = expr();
            skip(); i++;            // ')'
            return v;
        }
        int start = i;
        while (i < s.length() &&
               (Character.isDigit(s.charAt(i)) || s.charAt(i) == '.')) i++;
        return Double.parseDouble(s.substring(start, i));
    }

    public static void main(String[] args) {
        for (String e : new String[]{"-3 + 4 * 2", "(1 + 2) * 3 - 4", "10 / (2 + 3)"})
            System.out.printf("%-18s = %s%n", e, new RecursiveCalc(e).expr());
        // 5, 5, 2
    }
}
```

### Python
```python
class P:
    def __init__(self, s):
        self.s, self.i = s, 0

    def skip(self):
        while self.i < len(self.s) and self.s[self.i] == " ":
            self.i += 1

    def cur(self):
        self.skip()
        return self.s[self.i] if self.i < len(self.s) else ""

    def expr(self):
        v = self.term()
        while self.cur() in ("+", "-"):
            op = self.cur(); self.i += 1
            r = self.term()
            v = v + r if op == "+" else v - r
        return v

    def term(self):
        v = self.factor()
        while self.cur() in ("*", "/"):
            op = self.cur(); self.i += 1
            r = self.factor()
            v = v * r if op == "*" else v / r
        return v

    def factor(self):
        if self.cur() == "-":           # unary minus
            self.i += 1
            return -self.factor()
        if self.cur() == "(":
            self.i += 1
            v = self.expr()
            self.skip(); self.i += 1     # ')'
            return v
        start = self.i
        while self.i < len(self.s) and (self.s[self.i].isdigit() or self.s[self.i] == "."):
            self.i += 1
        return float(self.s[start:self.i])


if __name__ == "__main__":
    for e in ["-3 + 4 * 2", "(1 + 2) * 3 - 4", "10 / (2 + 3)"]:
        print(f"{e:18} = {P(e).expr():g}")
    # 5, 5, 2
```

---

## Final Tips

- **State your plan first:** tokenize → handle precedence (shunt or recurse) → evaluate. Interviewers love hearing the spine before the code.
- **Pin the operand order** out loud for `-` and `/`: "second pop is the left operand."
- **Mention associativity** even on a `+ - * /`-only problem; it shows depth.
- **Validate inputs** (parens, operand counts) and mention you would never `eval` untrusted strings.
- **Test on `3+4*2`, `(1+2)*3-4`, `2^3^2`, `-5`, and `1/0`** — these five cover precedence, parens, right-assoc, unary, and error handling.
