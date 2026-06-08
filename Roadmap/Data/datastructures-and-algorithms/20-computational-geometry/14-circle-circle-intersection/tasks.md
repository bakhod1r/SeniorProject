# Circle–Circle Intersection — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a problem statement, constraints, hints, and a complete reference solution in all three languages. Reuse the core ideas from the rest of this topic: the **`d` vs `r1+r2`/`|r1-r2|`** classification, the **a/h construction**, the **scaled `EPS` tolerance**, the **factored radicand** for stability, and the **squared-distance** overlap test.
> Hard rule throughout: always handle the **concentric** (`d ≈ 0`) case before dividing by `d`, and **clamp** every radicand before `sqrt`.

---

## Beginner Tasks (5)

### Task 1 — Classify two circles

**Statement.** Given two circles `(c1, r1)` and `(c2, r2)`, return their relationship as one of: `Separate`, `ExternallyTangent`, `TwoPoints`, `InternallyTangent`, `OneContainsOther`, `Identical`.

**Constraints.**
- Coordinates and radii are real numbers; `r ≥ 0`.
- Use a tolerance `EPS = 1e-9` for all boundary comparisons.

**Hints.**
- Compute `d`, `sum = r1 + r2`, `diff = |r1 - r2|`.
- Test the concentric case (`d < EPS`) first.
- Order the comparisons: identical → separate → external tangent → contains → internal tangent → two points.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

func classify(x1, y1, r1, x2, y2, r2 float64) string {
	d := math.Hypot(x2-x1, y2-y1)
	sum, diff := r1+r2, math.Abs(r1-r2)
	switch {
	case d < EPS && diff < EPS:
		return "Identical"
	case d > sum+EPS:
		return "Separate"
	case math.Abs(d-sum) <= EPS:
		return "ExternallyTangent"
	case d < diff-EPS:
		return "OneContainsOther"
	case math.Abs(d-diff) <= EPS:
		return "InternallyTangent"
	default:
		return "TwoPoints"
	}
}

func main() {
	fmt.Println(classify(0, 0, 5, 8, 0, 5)) // TwoPoints
}
```

#### Java
```java
public class Task1 {
    static final double EPS = 1e-9;

    static String classify(double x1, double y1, double r1,
                           double x2, double y2, double r2) {
        double d = Math.hypot(x2 - x1, y2 - y1);
        double sum = r1 + r2, diff = Math.abs(r1 - r2);
        if (d < EPS && diff < EPS) return "Identical";
        if (d > sum + EPS) return "Separate";
        if (Math.abs(d - sum) <= EPS) return "ExternallyTangent";
        if (d < diff - EPS) return "OneContainsOther";
        if (Math.abs(d - diff) <= EPS) return "InternallyTangent";
        return "TwoPoints";
    }

    public static void main(String[] args) {
        System.out.println(classify(0, 0, 5, 8, 0, 5)); // TwoPoints
    }
}
```

#### Python
```python
import math

EPS = 1e-9


def classify(x1, y1, r1, x2, y2, r2):
    d = math.hypot(x2 - x1, y2 - y1)
    s, diff = r1 + r2, abs(r1 - r2)
    if d < EPS and diff < EPS:
        return "Identical"
    if d > s + EPS:
        return "Separate"
    if abs(d - s) <= EPS:
        return "ExternallyTangent"
    if d < diff - EPS:
        return "OneContainsOther"
    if abs(d - diff) <= EPS:
        return "InternallyTangent"
    return "TwoPoints"


if __name__ == "__main__":
    print(classify(0, 0, 5, 8, 0, 5))  # TwoPoints
```

---

### Task 2 — Fast overlap test (no `sqrt`)

**Statement.** Return `true` if two disks overlap or touch, using only integer-safe arithmetic (no square root).

**Constraints.**
- Coordinates and radii may be integers up to `10⁶`.
- Must not call `sqrt`; comparison must be exact for integers.

**Hints.**
- Compare squared distance to `(r1 + r2)²`.
- Use 64-bit integers to avoid overflow in the squares.

#### Go
```go
package main

import "fmt"

func overlap(x1, y1, r1, x2, y2, r2 int64) bool {
	dx, dy := x1-x2, y1-y2
	d2 := dx*dx + dy*dy
	rr := r1 + r2
	return d2 <= rr*rr
}

func main() {
	fmt.Println(overlap(0, 0, 5, 8, 0, 5)) // true
	fmt.Println(overlap(0, 0, 2, 100, 0, 2)) // false
}
```

#### Java
```java
public class Task2 {
    static boolean overlap(long x1, long y1, long r1,
                           long x2, long y2, long r2) {
        long dx = x1 - x2, dy = y1 - y2;
        long d2 = dx * dx + dy * dy;
        long rr = r1 + r2;
        return d2 <= rr * rr;
    }

    public static void main(String[] args) {
        System.out.println(overlap(0, 0, 5, 8, 0, 5));     // true
        System.out.println(overlap(0, 0, 2, 100, 0, 2));   // false
    }
}
```

#### Python
```python
def overlap(x1, y1, r1, x2, y2, r2):
    dx, dy = x1 - x2, y1 - y2
    return dx * dx + dy * dy <= (r1 + r2) ** 2


if __name__ == "__main__":
    print(overlap(0, 0, 5, 8, 0, 5))      # True
    print(overlap(0, 0, 2, 100, 0, 2))    # False
```

---

### Task 3 — Intersection points (a/h construction)

**Statement.** Return the list of 0, 1, or 2 intersection points of two circles. For two points, sort them lexicographically for a deterministic result.

**Constraints.**
- Use the a/h construction; clamp the radicand before `sqrt`.
- Handle concentric (`d ≈ 0`) and tangent (`h ≈ 0`) cases.

**Hints.**
- `a = (d² + r1² - r2²)/(2d)`, `h = sqrt(max(0, r1² - a²))`.
- Foot `F = c1 + a·û`; points `F ± h·n̂` with `n̂ = (-û.y, û.x)`.

#### Go
```go
package main

import (
	"fmt"
	"math"
	"sort"
)

const EPS = 1e-9

type Pt struct{ X, Y float64 }

func intersect(x1, y1, r1, x2, y2, r2 float64) []Pt {
	d := math.Hypot(x2-x1, y2-y1)
	if d > r1+r2+EPS || d < math.Abs(r1-r2)-EPS || (d < EPS && math.Abs(r1-r2) < EPS) {
		return nil
	}
	a := (d*d + r1*r1 - r2*r2) / (2 * d)
	h := math.Sqrt(math.Max(0, r1*r1-a*a))
	ux, uy := (x2-x1)/d, (y2-y1)/d
	fx, fy := x1+a*ux, y1+a*uy
	if h < EPS {
		return []Pt{{fx, fy}}
	}
	pts := []Pt{{fx - h*uy, fy + h*ux}, {fx + h*uy, fy - h*ux}}
	sort.Slice(pts, func(i, j int) bool {
		if pts[i].X != pts[j].X {
			return pts[i].X < pts[j].X
		}
		return pts[i].Y < pts[j].Y
	})
	return pts
}

func main() {
	fmt.Println(intersect(0, 0, 5, 8, 0, 5)) // [{4 -3} {4 3}]
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static final double EPS = 1e-9;
    record Pt(double x, double y) {}

    static List<Pt> intersect(double x1, double y1, double r1,
                              double x2, double y2, double r2) {
        double d = Math.hypot(x2 - x1, y2 - y1);
        if (d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS
                || (d < EPS && Math.abs(r1 - r2) < EPS))
            return List.of();
        double a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
        double h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
        double ux = (x2 - x1) / d, uy = (y2 - y1) / d;
        double fx = x1 + a * ux, fy = y1 + a * uy;
        if (h < EPS) return List.of(new Pt(fx, fy));
        List<Pt> p = new ArrayList<>(List.of(
            new Pt(fx - h * uy, fy + h * ux),
            new Pt(fx + h * uy, fy - h * ux)));
        p.sort(Comparator.comparingDouble(Pt::x).thenComparingDouble(Pt::y));
        return p;
    }

    public static void main(String[] args) {
        System.out.println(intersect(0, 0, 5, 8, 0, 5)); // [(4,-3),(4,3)]
    }
}
```

#### Python
```python
import math

EPS = 1e-9


def intersect(x1, y1, r1, x2, y2, r2):
    d = math.hypot(x2 - x1, y2 - y1)
    if d > r1 + r2 + EPS or d < abs(r1 - r2) - EPS or (d < EPS and abs(r1 - r2) < EPS):
        return []
    a = (d * d + r1 * r1 - r2 * r2) / (2 * d)
    h = math.sqrt(max(0.0, r1 * r1 - a * a))
    ux, uy = (x2 - x1) / d, (y2 - y1) / d
    fx, fy = x1 + a * ux, y1 + a * uy
    if h < EPS:
        return [(fx, fy)]
    return sorted([(fx - h * uy, fy + h * ux), (fx + h * uy, fy - h * ux)])


if __name__ == "__main__":
    print(intersect(0, 0, 5, 8, 0, 5))  # [(4.0, -3.0), (4.0, 3.0)]
```

---

### Task 4 — Count intersection points

**Statement.** Return just the *number* of intersection points: `0`, `1`, `2`, or `-1` to denote "infinitely many" (identical circles).

**Constraints.**
- Use the classification, not the full point construction.
- Tolerance `EPS = 1e-9`.

**Hints.**
- Map each relationship to its count: Separate/Nested → 0, tangents → 1, TwoPoints → 2, Identical → -1.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

func countPoints(x1, y1, r1, x2, y2, r2 float64) int {
	d := math.Hypot(x2-x1, y2-y1)
	sum, diff := r1+r2, math.Abs(r1-r2)
	switch {
	case d < EPS && diff < EPS:
		return -1
	case d > sum+EPS || d < diff-EPS:
		return 0
	case math.Abs(d-sum) <= EPS || math.Abs(d-diff) <= EPS:
		return 1
	default:
		return 2
	}
}

func main() {
	fmt.Println(countPoints(0, 0, 5, 8, 0, 5))  // 2
	fmt.Println(countPoints(0, 0, 5, 10, 0, 5)) // 1
	fmt.Println(countPoints(0, 0, 1, 5, 0, 1))  // 0
}
```

#### Java
```java
public class Task4 {
    static final double EPS = 1e-9;

    static int countPoints(double x1, double y1, double r1,
                           double x2, double y2, double r2) {
        double d = Math.hypot(x2 - x1, y2 - y1);
        double sum = r1 + r2, diff = Math.abs(r1 - r2);
        if (d < EPS && diff < EPS) return -1;
        if (d > sum + EPS || d < diff - EPS) return 0;
        if (Math.abs(d - sum) <= EPS || Math.abs(d - diff) <= EPS) return 1;
        return 2;
    }

    public static void main(String[] args) {
        System.out.println(countPoints(0, 0, 5, 8, 0, 5));   // 2
        System.out.println(countPoints(0, 0, 5, 10, 0, 5));  // 1
        System.out.println(countPoints(0, 0, 1, 5, 0, 1));   // 0
    }
}
```

#### Python
```python
import math

EPS = 1e-9


def count_points(x1, y1, r1, x2, y2, r2):
    d = math.hypot(x2 - x1, y2 - y1)
    s, diff = r1 + r2, abs(r1 - r2)
    if d < EPS and diff < EPS:
        return -1
    if d > s + EPS or d < diff - EPS:
        return 0
    if abs(d - s) <= EPS or abs(d - diff) <= EPS:
        return 1
    return 2


if __name__ == "__main__":
    print(count_points(0, 0, 5, 8, 0, 5))   # 2
    print(count_points(0, 0, 5, 10, 0, 5))  # 1
    print(count_points(0, 0, 1, 5, 0, 1))   # 0
```

---

### Task 5 — Verify a candidate point lies on both circles

**Statement.** Given a candidate point `(px, py)` and two circles, return `true` if the point lies on **both** circle boundaries within tolerance (i.e. it is a genuine intersection point).

**Constraints.**
- Tolerance `EPS = 1e-6` on the distance check.

**Hints.**
- Check `|dist((px,py), c1) - r1| < EPS` and the same for circle 2.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-6

func onBoth(px, py, x1, y1, r1, x2, y2, r2 float64) bool {
	d1 := math.Hypot(px-x1, py-y1)
	d2 := math.Hypot(px-x2, py-y2)
	return math.Abs(d1-r1) < EPS && math.Abs(d2-r2) < EPS
}

func main() {
	fmt.Println(onBoth(4, 3, 0, 0, 5, 8, 0, 5))  // true
	fmt.Println(onBoth(0, 0, 0, 0, 5, 8, 0, 5))  // false
}
```

#### Java
```java
public class Task5 {
    static final double EPS = 1e-6;

    static boolean onBoth(double px, double py, double x1, double y1, double r1,
                          double x2, double y2, double r2) {
        double d1 = Math.hypot(px - x1, py - y1);
        double d2 = Math.hypot(px - x2, py - y2);
        return Math.abs(d1 - r1) < EPS && Math.abs(d2 - r2) < EPS;
    }

    public static void main(String[] args) {
        System.out.println(onBoth(4, 3, 0, 0, 5, 8, 0, 5)); // true
        System.out.println(onBoth(0, 0, 0, 0, 5, 8, 0, 5)); // false
    }
}
```

#### Python
```python
import math

EPS = 1e-6


def on_both(px, py, x1, y1, r1, x2, y2, r2):
    d1 = math.hypot(px - x1, py - y1)
    d2 = math.hypot(px - x2, py - y2)
    return abs(d1 - r1) < EPS and abs(d2 - r2) < EPS


if __name__ == "__main__":
    print(on_both(4, 3, 0, 0, 5, 8, 0, 5))  # True
    print(on_both(0, 0, 0, 0, 5, 8, 0, 5))  # False
```

---

## Intermediate Tasks (5)

### Task 6 — Lens (overlap) area

**Statement.** Return the area of the overlapping region of two circles. Handle separation (`0`), containment (`π·min(r)²`), and the proper crossing case.

**Constraints.**
- Branch the no-overlap and containment cases before the `acos` formula.

**Hints.**
- `area = r1²·acos(...) + r2²·acos(...) - ½·sqrt(Heron product)`.
- Clamp the Heron product to `≥ 0` before `sqrt`.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

func lensArea(x1, y1, r1, x2, y2, r2 float64) float64 {
	d := math.Hypot(x2-x1, y2-y1)
	if d >= r1+r2-EPS {
		return 0
	}
	if d <= math.Abs(r1-r2)+EPS {
		rm := math.Min(r1, r2)
		return math.Pi * rm * rm
	}
	p1 := r1 * r1 * math.Acos((d*d+r1*r1-r2*r2)/(2*d*r1))
	p2 := r2 * r2 * math.Acos((d*d+r2*r2-r1*r1)/(2*d*r2))
	t := (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)
	return p1 + p2 - 0.5*math.Sqrt(math.Max(0, t))
}

func main() {
	fmt.Printf("%.4f\n", lensArea(0, 0, 5, 8, 0, 5)) // 8.1751
}
```

#### Java
```java
public class Task6 {
    static final double EPS = 1e-9;

    static double lensArea(double x1, double y1, double r1,
                           double x2, double y2, double r2) {
        double d = Math.hypot(x2 - x1, y2 - y1);
        if (d >= r1 + r2 - EPS) return 0;
        if (d <= Math.abs(r1 - r2) + EPS) {
            double rm = Math.min(r1, r2);
            return Math.PI * rm * rm;
        }
        double p1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
        double p2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
        double t = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2);
        return p1 + p2 - 0.5 * Math.sqrt(Math.max(0, t));
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", lensArea(0, 0, 5, 8, 0, 5)); // 8.1751
    }
}
```

#### Python
```python
import math

EPS = 1e-9


def lens_area(x1, y1, r1, x2, y2, r2):
    d = math.hypot(x2 - x1, y2 - y1)
    if d >= r1 + r2 - EPS:
        return 0.0
    if d <= abs(r1 - r2) + EPS:
        rm = min(r1, r2)
        return math.pi * rm * rm
    p1 = r1 * r1 * math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1))
    p2 = r2 * r2 * math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
    t = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)
    return p1 + p2 - 0.5 * math.sqrt(max(0.0, t))


if __name__ == "__main__":
    print("%.4f" % lens_area(0, 0, 5, 8, 0, 5))  # 8.1751
```

---

### Task 7 — Intersection-over-union of two disks

**Statement.** Return the IoU of two disks: `lens_area / (area1 + area2 - lens_area)`. Return `0` if the union has zero area.

**Constraints.**
- Reuse the lens-area routine from Task 6.

**Hints.**
- `union = π·r1² + π·r2² - lens`.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

func lensArea(x1, y1, r1, x2, y2, r2 float64) float64 {
	d := math.Hypot(x2-x1, y2-y1)
	if d >= r1+r2-EPS {
		return 0
	}
	if d <= math.Abs(r1-r2)+EPS {
		rm := math.Min(r1, r2)
		return math.Pi * rm * rm
	}
	p1 := r1 * r1 * math.Acos((d*d+r1*r1-r2*r2)/(2*d*r1))
	p2 := r2 * r2 * math.Acos((d*d+r2*r2-r1*r1)/(2*d*r2))
	t := (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)
	return p1 + p2 - 0.5*math.Sqrt(math.Max(0, t))
}

func iou(x1, y1, r1, x2, y2, r2 float64) float64 {
	inter := lensArea(x1, y1, r1, x2, y2, r2)
	union := math.Pi*r1*r1 + math.Pi*r2*r2 - inter
	if union <= 0 {
		return 0
	}
	return inter / union
}

func main() {
	fmt.Printf("%.4f\n", iou(0, 0, 5, 8, 0, 5)) // ~0.0549
}
```

#### Java
```java
public class Task7 {
    static final double EPS = 1e-9;

    static double lensArea(double x1, double y1, double r1,
                           double x2, double y2, double r2) {
        double d = Math.hypot(x2 - x1, y2 - y1);
        if (d >= r1 + r2 - EPS) return 0;
        if (d <= Math.abs(r1 - r2) + EPS) {
            double rm = Math.min(r1, r2);
            return Math.PI * rm * rm;
        }
        double p1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
        double p2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
        double t = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2);
        return p1 + p2 - 0.5 * Math.sqrt(Math.max(0, t));
    }

    static double iou(double x1, double y1, double r1,
                      double x2, double y2, double r2) {
        double inter = lensArea(x1, y1, r1, x2, y2, r2);
        double union = Math.PI * r1 * r1 + Math.PI * r2 * r2 - inter;
        return union <= 0 ? 0 : inter / union;
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", iou(0, 0, 5, 8, 0, 5)); // ~0.0549
    }
}
```

#### Python
```python
import math

EPS = 1e-9


def lens_area(x1, y1, r1, x2, y2, r2):
    d = math.hypot(x2 - x1, y2 - y1)
    if d >= r1 + r2 - EPS:
        return 0.0
    if d <= abs(r1 - r2) + EPS:
        rm = min(r1, r2)
        return math.pi * rm * rm
    p1 = r1 * r1 * math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1))
    p2 = r2 * r2 * math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
    t = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)
    return p1 + p2 - 0.5 * math.sqrt(max(0.0, t))


def iou(x1, y1, r1, x2, y2, r2):
    inter = lens_area(x1, y1, r1, x2, y2, r2)
    union = math.pi * r1 * r1 + math.pi * r2 * r2 - inter
    return inter / union if union > 0 else 0.0


if __name__ == "__main__":
    print("%.4f" % iou(0, 0, 5, 8, 0, 5))  # ~0.0549
```

---

### Task 8 — Two-circle trilateration

**Statement.** Given two anchors with measured ranges (two circles), return the candidate position(s): both intersection points. If the circles barely miss (within tolerance), return the single best estimate at the closest-approach point on the line of centers.

**Constraints.**
- Use the stable, factored a/h form.
- Concentric anchors return no candidates.

**Hints.**
- If `h² < 0` but within tolerance, return the foot `F` as the single estimate.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

type Pt struct{ X, Y float64 }

func locate(x1, y1, r1, x2, y2, r2 float64) []Pt {
	d := math.Hypot(x2-x1, y2-y1)
	if d < EPS {
		return nil // concentric: no direction
	}
	a := (d*d + (r1-r2)*(r1+r2)) / (2 * d)
	h2 := (r1 - a) * (r1 + a)
	ux, uy := (x2-x1)/d, (y2-y1)/d
	fx, fy := x1+a*ux, y1+a*uy
	if h2 < -EPS {
		return []Pt{{fx, fy}} // missed: closest-approach estimate
	}
	h := math.Sqrt(math.Max(0, h2))
	if h < EPS {
		return []Pt{{fx, fy}}
	}
	return []Pt{{fx - h*uy, fy + h*ux}, {fx + h*uy, fy - h*ux}}
}

func main() {
	fmt.Println(locate(0, 0, 5, 8, 0, 5)) // [{4 3} {4 -3}]
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    static final double EPS = 1e-9;
    record Pt(double x, double y) {}

    static List<Pt> locate(double x1, double y1, double r1,
                           double x2, double y2, double r2) {
        double d = Math.hypot(x2 - x1, y2 - y1);
        if (d < EPS) return List.of();
        double a = (d * d + (r1 - r2) * (r1 + r2)) / (2 * d);
        double h2 = (r1 - a) * (r1 + a);
        double ux = (x2 - x1) / d, uy = (y2 - y1) / d;
        double fx = x1 + a * ux, fy = y1 + a * uy;
        if (h2 < -EPS) return List.of(new Pt(fx, fy));
        double h = Math.sqrt(Math.max(0, h2));
        if (h < EPS) return List.of(new Pt(fx, fy));
        return List.of(new Pt(fx - h * uy, fy + h * ux),
                       new Pt(fx + h * uy, fy - h * ux));
    }

    public static void main(String[] args) {
        System.out.println(locate(0, 0, 5, 8, 0, 5)); // [(4,3),(4,-3)]
    }
}
```

#### Python
```python
import math

EPS = 1e-9


def locate(x1, y1, r1, x2, y2, r2):
    d = math.hypot(x2 - x1, y2 - y1)
    if d < EPS:
        return []  # concentric
    a = (d * d + (r1 - r2) * (r1 + r2)) / (2 * d)
    h2 = (r1 - a) * (r1 + a)
    ux, uy = (x2 - x1) / d, (y2 - y1) / d
    fx, fy = x1 + a * ux, y1 + a * uy
    if h2 < -EPS:
        return [(fx, fy)]  # missed: closest-approach estimate
    h = math.sqrt(max(0.0, h2))
    if h < EPS:
        return [(fx, fy)]
    return [(fx - h * uy, fy + h * ux), (fx + h * uy, fy - h * ux)]


if __name__ == "__main__":
    print(locate(0, 0, 5, 8, 0, 5))  # [(4.0, 3.0), (4.0, -3.0)]
```

---

### Task 9 — Common-chord line equation

**Statement.** For two intersecting circles, return the coefficients `(A, B, C)` of the radical-axis line `A·x + B·y + C = 0` (the common-chord line). It exists even when the circles don't intersect.

**Constraints.**
- Derive by subtracting the two circle equations.

**Hints.**
- `A = 2(x2 - x1)`, `B = 2(y2 - y1)`, `C = (x1² - x2²) + (y1² - y2²) - (r1² - r2²)`.

#### Go
```go
package main

import "fmt"

func radicalAxis(x1, y1, r1, x2, y2, r2 float64) (float64, float64, float64) {
	A := 2 * (x2 - x1)
	B := 2 * (y2 - y1)
	C := (x1*x1 - x2*x2) + (y1*y1 - y2*y2) - (r1*r1 - r2*r2)
	return A, B, C
}

func main() {
	fmt.Println(radicalAxis(0, 0, 5, 8, 0, 5)) // 16 0 -64  -> x = 4
}
```

#### Java
```java
public class Task9 {
    static double[] radicalAxis(double x1, double y1, double r1,
                                double x2, double y2, double r2) {
        double a = 2 * (x2 - x1);
        double b = 2 * (y2 - y1);
        double c = (x1 * x1 - x2 * x2) + (y1 * y1 - y2 * y2) - (r1 * r1 - r2 * r2);
        return new double[]{a, b, c};
    }

    public static void main(String[] args) {
        double[] l = radicalAxis(0, 0, 5, 8, 0, 5);
        System.out.println(l[0] + " " + l[1] + " " + l[2]); // 16.0 0.0 -64.0
    }
}
```

#### Python
```python
def radical_axis(x1, y1, r1, x2, y2, r2):
    a = 2 * (x2 - x1)
    b = 2 * (y2 - y1)
    c = (x1 * x1 - x2 * x2) + (y1 * y1 - y2 * y2) - (r1 * r1 - r2 * r2)
    return a, b, c


if __name__ == "__main__":
    print(radical_axis(0, 0, 5, 8, 0, 5))  # (16, 0, -64) -> x = 4
```

---

### Task 10 — Continuous collision time of two moving disks

**Statement.** Two disks move with constant velocities. Given start positions `p1, p2`, velocities `v1, v2`, and radii `r1, r2`, return the earliest time `t ∈ [0, 1]` at which they touch (`|p1(t) - p2(t)| = r1 + r2`), or `-1` if they don't within the interval.

**Constraints.**
- Solve the quadratic in `t` for the relative motion.

**Hints.**
- Let `Δp = p1 - p2`, `Δv = v1 - v2`. Solve `|Δp + t·Δv|² = (r1+r2)²`.
- Quadratic `a t² + b t + c = 0` with `a = Δv·Δv`, `b = 2 Δp·Δv`, `c = Δp·Δp - (r1+r2)²`.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func collisionTime(p1x, p1y, v1x, v1y, p2x, p2y, v2x, v2y, r1, r2 float64) float64 {
	dpx, dpy := p1x-p2x, p1y-p2y
	dvx, dvy := v1x-v2x, v1y-v2y
	a := dvx*dvx + dvy*dvy
	b := 2 * (dpx*dvx + dpy*dvy)
	rr := r1 + r2
	c := dpx*dpx + dpy*dpy - rr*rr
	if c <= 0 {
		return 0 // already overlapping at t=0
	}
	if a < 1e-12 {
		return -1 // no relative motion
	}
	disc := b*b - 4*a*c
	if disc < 0 {
		return -1
	}
	t := (-b - math.Sqrt(disc)) / (2 * a)
	if t < 0 || t > 1 {
		return -1
	}
	return t
}

func main() {
	fmt.Printf("%.3f\n", collisionTime(0, 0, 10, 0, 10, 0, 0, 0, 1, 1)) // 0.800
}
```

#### Java
```java
public class Task10 {
    static double collisionTime(double p1x, double p1y, double v1x, double v1y,
                                double p2x, double p2y, double v2x, double v2y,
                                double r1, double r2) {
        double dpx = p1x - p2x, dpy = p1y - p2y;
        double dvx = v1x - v2x, dvy = v1y - v2y;
        double a = dvx * dvx + dvy * dvy;
        double b = 2 * (dpx * dvx + dpy * dvy);
        double rr = r1 + r2;
        double c = dpx * dpx + dpy * dpy - rr * rr;
        if (c <= 0) return 0;
        if (a < 1e-12) return -1;
        double disc = b * b - 4 * a * c;
        if (disc < 0) return -1;
        double t = (-b - Math.sqrt(disc)) / (2 * a);
        return (t < 0 || t > 1) ? -1 : t;
    }

    public static void main(String[] args) {
        System.out.printf("%.3f%n",
            collisionTime(0, 0, 10, 0, 10, 0, 0, 0, 1, 1)); // 0.800
    }
}
```

#### Python
```python
import math


def collision_time(p1x, p1y, v1x, v1y, p2x, p2y, v2x, v2y, r1, r2):
    dpx, dpy = p1x - p2x, p1y - p2y
    dvx, dvy = v1x - v2x, v1y - v2y
    a = dvx * dvx + dvy * dvy
    b = 2 * (dpx * dvx + dpy * dvy)
    rr = r1 + r2
    c = dpx * dpx + dpy * dpy - rr * rr
    if c <= 0:
        return 0.0
    if a < 1e-12:
        return -1.0
    disc = b * b - 4 * a * c
    if disc < 0:
        return -1.0
    t = (-b - math.sqrt(disc)) / (2 * a)
    return t if 0 <= t <= 1 else -1.0


if __name__ == "__main__":
    print("%.3f" % collision_time(0, 0, 10, 0, 10, 0, 0, 0, 1, 1))  # 0.800
```

---

## Advanced Tasks (5)

### Task 11 — Linear-least-squares trilateration (≥3 anchors)

**Statement.** Given `n ≥ 3` anchors `(x, y, r)`, estimate the best-fit position by linear least squares (the radical-axis/normal-equations method). Raise an error for degenerate (near-collinear) geometry.

**Constraints.**
- `n ≥ 3`; solve a 2×2 normal system.

**Hints.**
- Subtract anchor[0]'s equation from each other; accumulate `AᵀA` and `Aᵀb`; solve.

#### Go
```go
package main

import (
	"errors"
	"fmt"
	"math"
)

func trilaterate(anchors [][3]float64) (float64, float64, error) {
	if len(anchors) < 3 {
		return 0, 0, errors.New("need >= 3 anchors")
	}
	x0, y0, r0 := anchors[0][0], anchors[0][1], anchors[0][2]
	var sxx, sxy, syy, bx, by float64
	for i := 1; i < len(anchors); i++ {
		xi, yi, ri := anchors[i][0], anchors[i][1], anchors[i][2]
		ax := 2 * (xi - x0)
		ay := 2 * (yi - y0)
		c := (r0*r0 - ri*ri) - (x0*x0 - xi*xi) - (y0*y0 - yi*yi)
		sxx += ax * ax
		sxy += ax * ay
		syy += ay * ay
		bx += ax * c
		by += ay * c
	}
	det := sxx*syy - sxy*sxy
	if math.Abs(det) < 1e-12 {
		return 0, 0, errors.New("degenerate geometry")
	}
	return (syy*bx - sxy*by) / det, (sxx*by - sxy*bx) / det, nil
}

func main() {
	a := [][3]float64{{0, 0, 5}, {8, 0, 5}, {4, 6, 3}}
	x, y, _ := trilaterate(a)
	fmt.Printf("%.3f %.3f\n", x, y) // 4.000 3.000
}
```

#### Java
```java
public class Task11 {
    static double[] trilaterate(double[][] a) {
        if (a.length < 3) throw new IllegalArgumentException("need >= 3 anchors");
        double x0 = a[0][0], y0 = a[0][1], r0 = a[0][2];
        double sxx = 0, sxy = 0, syy = 0, bx = 0, by = 0;
        for (int i = 1; i < a.length; i++) {
            double ax = 2 * (a[i][0] - x0), ay = 2 * (a[i][1] - y0);
            double c = (r0 * r0 - a[i][2] * a[i][2])
                     - (x0 * x0 - a[i][0] * a[i][0])
                     - (y0 * y0 - a[i][1] * a[i][1]);
            sxx += ax * ax; sxy += ax * ay; syy += ay * ay;
            bx += ax * c;   by += ay * c;
        }
        double det = sxx * syy - sxy * sxy;
        if (Math.abs(det) < 1e-12) throw new ArithmeticException("degenerate");
        return new double[]{(syy * bx - sxy * by) / det, (sxx * by - sxy * bx) / det};
    }

    public static void main(String[] args) {
        double[][] a = {{0, 0, 5}, {8, 0, 5}, {4, 6, 3}};
        double[] p = trilaterate(a);
        System.out.printf("%.3f %.3f%n", p[0], p[1]); // 4.000 3.000
    }
}
```

#### Python
```python
def trilaterate(anchors):
    if len(anchors) < 3:
        raise ValueError("need >= 3 anchors")
    x0, y0, r0 = anchors[0]
    sxx = sxy = syy = bx = by = 0.0
    for x, y, r in anchors[1:]:
        ax, ay = 2 * (x - x0), 2 * (y - y0)
        c = (r0 * r0 - r * r) - (x0 * x0 - x * x) - (y0 * y0 - y * y)
        sxx += ax * ax; sxy += ax * ay; syy += ay * ay
        bx += ax * c;   by += ay * c
    det = sxx * syy - sxy * sxy
    if abs(det) < 1e-12:
        raise ArithmeticError("degenerate geometry")
    return (syy * bx - sxy * by) / det, (sxx * by - sxy * bx) / det


if __name__ == "__main__":
    print(trilaterate([(0, 0, 5), (8, 0, 5), (4, 6, 3)]))  # ~ (4.0, 3.0)
```

---

### Task 12 — All overlapping pairs via a grid broad-phase

**Statement.** Given `n` circles, return all index pairs whose disks overlap, using a uniform-grid broad-phase to avoid the O(n²) all-pairs test.

**Constraints.**
- Cell size `≥ 2·max_radius` for correctness with similar radii.

**Hints.**
- Bucket each circle into the cells its bounding box touches; test only within-bucket pairs with the squared-distance test.

#### Go
```go
package main

import "fmt"

type Circle struct{ X, Y, R float64 }

func overlappingPairs(cs []Circle, cell float64) [][2]int {
	type key struct{ cx, cy int }
	grid := map[key][]int{}
	keyOf := func(x, y float64) key { return key{int(x / cell), int(y / cell)} }
	for i, c := range cs {
		seen := map[key]bool{}
		for _, dx := range []float64{-1, 0, 1} {
			for _, dy := range []float64{-1, 0, 1} {
				k := keyOf(c.X+dx*c.R, c.Y+dy*c.R)
				if !seen[k] {
					seen[k] = true
					grid[k] = append(grid[k], i)
				}
			}
		}
	}
	done := map[[2]int]bool{}
	var out [][2]int
	for _, bucket := range grid {
		for a := 0; a < len(bucket); a++ {
			for b := a + 1; b < len(bucket); b++ {
				i, j := bucket[a], bucket[b]
				if i > j {
					i, j = j, i
				}
				if done[[2]int{i, j}] {
					continue
				}
				done[[2]int{i, j}] = true
				dx, dy := cs[i].X-cs[j].X, cs[i].Y-cs[j].Y
				rr := cs[i].R + cs[j].R
				if dx*dx+dy*dy <= rr*rr {
					out = append(out, [2]int{i, j})
				}
			}
		}
	}
	return out
}

func main() {
	cs := []Circle{{0, 0, 5}, {8, 0, 5}, {100, 100, 2}, {101, 100, 2}}
	fmt.Println(overlappingPairs(cs, 10)) // [[0 1] [2 3]] (order may vary)
}
```

#### Java
```java
import java.util.*;

public class Task12 {
    record Circle(double x, double y, double r) {}

    static List<int[]> overlappingPairs(List<Circle> cs, double cell) {
        Map<Long, List<Integer>> grid = new HashMap<>();
        for (int i = 0; i < cs.size(); i++) {
            Circle c = cs.get(i);
            Set<Long> seen = new HashSet<>();
            for (int dx = -1; dx <= 1; dx++)
                for (int dy = -1; dy <= 1; dy++) {
                    long kx = (long) Math.floor((c.x() + dx * c.r()) / cell);
                    long ky = (long) Math.floor((c.y() + dy * c.r()) / cell);
                    long key = kx * 1_000_003L + ky;
                    if (seen.add(key))
                        grid.computeIfAbsent(key, k -> new ArrayList<>()).add(i);
                }
        }
        Set<Long> done = new HashSet<>();
        List<int[]> out = new ArrayList<>();
        for (List<Integer> bucket : grid.values())
            for (int a = 0; a < bucket.size(); a++)
                for (int b = a + 1; b < bucket.size(); b++) {
                    int i = bucket.get(a), j = bucket.get(b);
                    if (i > j) { int t = i; i = j; j = t; }
                    long e = (long) i * 1_000_003L + j;
                    if (!done.add(e)) continue;
                    Circle ci = cs.get(i), cj = cs.get(j);
                    double dx = ci.x() - cj.x(), dy = ci.y() - cj.y();
                    double rr = ci.r() + cj.r();
                    if (dx * dx + dy * dy <= rr * rr) out.add(new int[]{i, j});
                }
        return out;
    }

    public static void main(String[] args) {
        List<Circle> cs = List.of(new Circle(0, 0, 5), new Circle(8, 0, 5),
                new Circle(100, 100, 2), new Circle(101, 100, 2));
        for (int[] p : overlappingPairs(cs, 10))
            System.out.println(p[0] + "," + p[1]);
    }
}
```

#### Python
```python
from collections import defaultdict


def overlapping_pairs(circles, cell):
    grid = defaultdict(list)
    for i, (x, y, r) in enumerate(circles):
        cells = {(int((x + dx * r) // cell), int((y + dy * r) // cell))
                 for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
        for c in cells:
            grid[c].append(i)
    seen, out = set(), []
    for bucket in grid.values():
        for a in range(len(bucket)):
            for b in range(a + 1, len(bucket)):
                i, j = sorted((bucket[a], bucket[b]))
                if (i, j) in seen:
                    continue
                seen.add((i, j))
                xi, yi, ri = circles[i]
                xj, yj, rj = circles[j]
                if (xi - xj) ** 2 + (yi - yj) ** 2 <= (ri + rj) ** 2:
                    out.append((i, j))
    return out


if __name__ == "__main__":
    circles = [(0, 0, 5), (8, 0, 5), (100, 100, 2), (101, 100, 2)]
    print(sorted(overlapping_pairs(circles, 10)))  # [(0, 1), (2, 3)]
```

---

### Task 13 — Numerically robust intersection for near-equal radii

**Statement.** Implement the intersection so it stays accurate when `r1 ≈ r2` and radii are large (e.g. `10⁶`). Compare your factored implementation against a naive one on a stress case.

**Constraints.**
- Use the factored numerator `d² + (r1-r2)(r1+r2)` and radicand `(r1-a)(r1+a)`.

**Hints.**
- Shift the origin to `c1` before computing to reduce cancellation in `d²`.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func robustIntersect(x1, y1, r1, x2, y2, r2 float64) [][2]float64 {
	// Shift origin to c1 for precision.
	bx, by := x2-x1, y2-y1
	d := math.Hypot(bx, by)
	if d < 1e-12 {
		return nil
	}
	a := (d*d + (r1-r2)*(r1+r2)) / (2 * d)
	h := math.Sqrt(math.Max(0, (r1-a)*(r1+a)))
	ux, uy := bx/d, by/d
	fx, fy := a*ux, a*uy
	p1 := [2]float64{x1 + fx - h*uy, y1 + fy + h*ux}
	p2 := [2]float64{x1 + fx + h*uy, y1 + fy - h*ux}
	return [][2]float64{p1, p2}
}

func main() {
	// Two big near-equal circles crossing.
	fmt.Println(robustIntersect(0, 0, 1e6, 2, 0, 1e6)) // ~[{1 ~1e6} {1 ~-1e6}]
}
```

#### Java
```java
import java.util.*;

public class Task13 {
    static double[][] robustIntersect(double x1, double y1, double r1,
                                      double x2, double y2, double r2) {
        double bx = x2 - x1, by = y2 - y1;
        double d = Math.hypot(bx, by);
        if (d < 1e-12) return new double[0][];
        double a = (d * d + (r1 - r2) * (r1 + r2)) / (2 * d);
        double h = Math.sqrt(Math.max(0, (r1 - a) * (r1 + a)));
        double ux = bx / d, uy = by / d;
        double fx = a * ux, fy = a * uy;
        return new double[][]{
            {x1 + fx - h * uy, y1 + fy + h * ux},
            {x1 + fx + h * uy, y1 + fy - h * ux}
        };
    }

    public static void main(String[] args) {
        System.out.println(Arrays.deepToString(
            robustIntersect(0, 0, 1e6, 2, 0, 1e6)));
    }
}
```

#### Python
```python
import math


def robust_intersect(x1, y1, r1, x2, y2, r2):
    bx, by = x2 - x1, y2 - y1
    d = math.hypot(bx, by)
    if d < 1e-12:
        return []
    a = (d * d + (r1 - r2) * (r1 + r2)) / (2 * d)
    h = math.sqrt(max(0.0, (r1 - a) * (r1 + a)))
    ux, uy = bx / d, by / d
    fx, fy = a * ux, a * uy
    return [(x1 + fx - h * uy, y1 + fy + h * ux),
            (x1 + fx + h * uy, y1 + fy - h * ux)]


if __name__ == "__main__":
    print(robust_intersect(0, 0, 1e6, 2, 0, 1e6))  # x = 1, y = ±~1e6
```

---

### Task 14 — Exact integer classification (no `sqrt`)

**Statement.** Given integer circles, classify the relationship **exactly** using only integer arithmetic — no floating point, no `sqrt`. Return the same six labels as Task 1.

**Constraints.**
- Integer coordinates and radii up to `10⁶`; use 64-bit (or big-int).

**Hints.**
- Compare `d²` to `(r1+r2)²` and `(r1-r2)²` using the polynomial signs `S+ = (r1+r2)² - d²`, `S- = d² - (r1-r2)²`.

#### Go
```go
package main

import "fmt"

func classifyExact(x1, y1, r1, x2, y2, r2 int64) string {
	dx, dy := x2-x1, y2-y1
	d2 := dx*dx + dy*dy
	sum := r1 + r2
	diff := r1 - r2
	if diff < 0 {
		diff = -diff
	}
	sPlus := sum*sum - d2  // > 0 inside outer threshold
	sMinus := d2 - diff*diff
	switch {
	case d2 == 0 && diff == 0:
		return "Identical"
	case sPlus < 0:
		return "Separate"
	case sPlus == 0:
		return "ExternallyTangent"
	case sMinus < 0:
		return "OneContainsOther"
	case sMinus == 0:
		return "InternallyTangent"
	default:
		return "TwoPoints"
	}
}

func main() {
	fmt.Println(classifyExact(0, 0, 5, 8, 0, 5))  // TwoPoints
	fmt.Println(classifyExact(0, 0, 5, 10, 0, 5)) // ExternallyTangent
}
```

#### Java
```java
public class Task14 {
    static String classifyExact(long x1, long y1, long r1,
                                long x2, long y2, long r2) {
        long dx = x2 - x1, dy = y2 - y1;
        long d2 = dx * dx + dy * dy;
        long sum = r1 + r2;
        long diff = Math.abs(r1 - r2);
        long sPlus = sum * sum - d2;
        long sMinus = d2 - diff * diff;
        if (d2 == 0 && diff == 0) return "Identical";
        if (sPlus < 0) return "Separate";
        if (sPlus == 0) return "ExternallyTangent";
        if (sMinus < 0) return "OneContainsOther";
        if (sMinus == 0) return "InternallyTangent";
        return "TwoPoints";
    }

    public static void main(String[] args) {
        System.out.println(classifyExact(0, 0, 5, 8, 0, 5));   // TwoPoints
        System.out.println(classifyExact(0, 0, 5, 10, 0, 5));  // ExternallyTangent
    }
}
```

#### Python
```python
def classify_exact(x1, y1, r1, x2, y2, r2):
    dx, dy = x2 - x1, y2 - y1
    d2 = dx * dx + dy * dy
    s = r1 + r2
    diff = abs(r1 - r2)
    s_plus = s * s - d2
    s_minus = d2 - diff * diff
    if d2 == 0 and diff == 0:
        return "Identical"
    if s_plus < 0:
        return "Separate"
    if s_plus == 0:
        return "ExternallyTangent"
    if s_minus < 0:
        return "OneContainsOther"
    if s_minus == 0:
        return "InternallyTangent"
    return "TwoPoints"


if __name__ == "__main__":
    print(classify_exact(0, 0, 5, 8, 0, 5))    # TwoPoints
    print(classify_exact(0, 0, 5, 10, 0, 5))   # ExternallyTangent
```

---

### Task 15 — Sphere–sphere intersection (3-D)

**Statement.** Given two spheres in 3-D, when they intersect in a circle, return that circle's **center** `(cx, cy, cz)` and **radius** `h`. Return the tangent point for `h ≈ 0`, or `None`/nil for no intersection.

**Constraints.**
- Same `a/h` math; `a` locates the plane, `h` is the intersection-circle radius.

**Hints.**
- Center of the intersection circle is `c1 + a·û` where `û = (c2 - c1)/d` in 3-D; `h = sqrt(r1² - a²)`.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

func sphereIntersect(x1, y1, z1, r1, x2, y2, z2, r2 float64) (cx, cy, cz, rad float64, ok bool) {
	dx, dy, dz := x2-x1, y2-y1, z2-z1
	d := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if d > r1+r2+EPS || d < math.Abs(r1-r2)-EPS || d < EPS {
		return 0, 0, 0, 0, false
	}
	a := (d*d + r1*r1 - r2*r2) / (2 * d)
	h := math.Sqrt(math.Max(0, r1*r1-a*a))
	ux, uy, uz := dx/d, dy/d, dz/d
	return x1 + a*ux, y1 + a*uy, z1 + a*uz, h, true
}

func main() {
	cx, cy, cz, r, ok := sphereIntersect(0, 0, 0, 5, 8, 0, 0, 5)
	fmt.Println(cx, cy, cz, r, ok) // 4 0 0 3 true
}
```

#### Java
```java
public class Task15 {
    static final double EPS = 1e-9;

    static double[] sphereIntersect(double x1, double y1, double z1, double r1,
                                    double x2, double y2, double z2, double r2) {
        double dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
        double d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS || d < EPS)
            return null;
        double a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
        double h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
        double ux = dx / d, uy = dy / d, uz = dz / d;
        return new double[]{x1 + a * ux, y1 + a * uy, z1 + a * uz, h};
    }

    public static void main(String[] args) {
        double[] c = sphereIntersect(0, 0, 0, 5, 8, 0, 0, 5);
        System.out.println(java.util.Arrays.toString(c)); // [4.0, 0.0, 0.0, 3.0]
    }
}
```

#### Python
```python
import math

EPS = 1e-9


def sphere_intersect(x1, y1, z1, r1, x2, y2, z2, r2):
    dx, dy, dz = x2 - x1, y2 - y1, z2 - z1
    d = math.sqrt(dx * dx + dy * dy + dz * dz)
    if d > r1 + r2 + EPS or d < abs(r1 - r2) - EPS or d < EPS:
        return None
    a = (d * d + r1 * r1 - r2 * r2) / (2 * d)
    h = math.sqrt(max(0.0, r1 * r1 - a * a))
    ux, uy, uz = dx / d, dy / d, dz / d
    return (x1 + a * ux, y1 + a * uy, z1 + a * uz, h)  # center + circle radius


if __name__ == "__main__":
    print(sphere_intersect(0, 0, 0, 5, 8, 0, 0, 5))  # (4.0, 0.0, 0.0, 3.0)
```

---

## Benchmark Task

> Compare the cost of the full a/h intersection against the no-`sqrt` overlap test across many circle pairs in all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

func overlapSq(x1, y1, r1, x2, y2, r2 float64) bool {
	dx, dy := x1-x2, y1-y2
	rr := r1 + r2
	return dx*dx+dy*dy <= rr*rr
}

func ahIntersect(x1, y1, r1, x2, y2, r2 float64) int {
	d := math.Hypot(x2-x1, y2-y1)
	if d > r1+r2 || d < math.Abs(r1-r2) || d < 1e-12 {
		return 0
	}
	a := (d*d + r1*r1 - r2*r2) / (2 * d)
	h := math.Sqrt(math.Max(0, r1*r1-a*a))
	if h < 1e-12 {
		return 1
	}
	return 2
}

func main() {
	const N = 1_000_000
	xs := make([][6]float64, N)
	for i := range xs {
		xs[i] = [6]float64{rand.Float64() * 100, rand.Float64() * 100, 5,
			rand.Float64() * 100, rand.Float64() * 100, 5}
	}
	start := time.Now()
	cnt := 0
	for _, c := range xs {
		if overlapSq(c[0], c[1], c[2], c[3], c[4], c[5]) {
			cnt++
		}
	}
	fmt.Printf("overlapSq: %.3f ms (%d hits)\n", float64(time.Since(start).Microseconds())/1000, cnt)
	start = time.Now()
	tot := 0
	for _, c := range xs {
		tot += ahIntersect(c[0], c[1], c[2], c[3], c[4], c[5])
	}
	fmt.Printf("ahIntersect: %.3f ms\n", float64(time.Since(start).Microseconds())/1000)
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    static boolean overlapSq(double x1, double y1, double r1,
                             double x2, double y2, double r2) {
        double dx = x1 - x2, dy = y1 - y2, rr = r1 + r2;
        return dx * dx + dy * dy <= rr * rr;
    }

    static int ahIntersect(double x1, double y1, double r1,
                           double x2, double y2, double r2) {
        double d = Math.hypot(x2 - x1, y2 - y1);
        if (d > r1 + r2 || d < Math.abs(r1 - r2) || d < 1e-12) return 0;
        double a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
        double h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
        return h < 1e-12 ? 1 : 2;
    }

    public static void main(String[] args) {
        int N = 1_000_000;
        Random rnd = new Random(1);
        double[][] xs = new double[N][6];
        for (int i = 0; i < N; i++)
            xs[i] = new double[]{rnd.nextDouble() * 100, rnd.nextDouble() * 100, 5,
                rnd.nextDouble() * 100, rnd.nextDouble() * 100, 5};
        long s = System.nanoTime(); int cnt = 0;
        for (double[] c : xs) if (overlapSq(c[0], c[1], c[2], c[3], c[4], c[5])) cnt++;
        System.out.printf("overlapSq: %.3f ms (%d hits)%n", (System.nanoTime() - s) / 1e6, cnt);
        s = System.nanoTime(); int tot = 0;
        for (double[] c : xs) tot += ahIntersect(c[0], c[1], c[2], c[3], c[4], c[5]);
        System.out.printf("ahIntersect: %.3f ms%n", (System.nanoTime() - s) / 1e6);
    }
}
```

#### Python

```python
import math
import random
import timeit


def overlap_sq(c):
    x1, y1, r1, x2, y2, r2 = c
    dx, dy = x1 - x2, y1 - y2
    return dx * dx + dy * dy <= (r1 + r2) ** 2


def ah_intersect(c):
    x1, y1, r1, x2, y2, r2 = c
    d = math.hypot(x2 - x1, y2 - y1)
    if d > r1 + r2 or d < abs(r1 - r2) or d < 1e-12:
        return 0
    a = (d * d + r1 * r1 - r2 * r2) / (2 * d)
    h = math.sqrt(max(0.0, r1 * r1 - a * a))
    return 1 if h < 1e-12 else 2


if __name__ == "__main__":
    random.seed(1)
    data = [(random.random() * 100, random.random() * 100, 5,
             random.random() * 100, random.random() * 100, 5)
            for _ in range(200_000)]
    t1 = timeit.timeit(lambda: [overlap_sq(c) for c in data], number=1)
    t2 = timeit.timeit(lambda: [ah_intersect(c) for c in data], number=1)
    print(f"overlap_sq : {t1*1000:.3f} ms")
    print(f"ah_intersect: {t2*1000:.3f} ms")
```

Expected: the squared-distance overlap test runs several times faster than the full a/h solve, because it avoids `hypot`/`sqrt` and branches — the empirical justification for using it as the collision broad-phase.
