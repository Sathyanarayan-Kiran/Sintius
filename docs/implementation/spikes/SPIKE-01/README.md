# SPIKE-01 benchmark harness

This directory contains a dependency-free, reproducible runtime comparison for the backend-runtime proposal. It is spike evidence, not application scaffolding or production pricing code.

The three programs execute the same exact workload:

- integer quantity and allowance;
- three graduated tiers;
- 18-decimal fixed-point rates;
- `17/31` proration using half-up division;
- `7.25%` discount;
- component minimum and cap;
- half-up rounding to cents;
- a checksum that must match across runtimes.

The benchmark intentionally excludes I/O, frameworks, JSON parsing, database access, and third-party decimal libraries. Results are directional and must not be read as production capacity.

## Run

From this directory on Windows PowerShell:

```powershell
node .\benchmarks\node-rating.mjs 1000000

javac -d .\benchmarks .\benchmarks\JavaRating.java
java -cp .\benchmarks JavaRating 1000000

go run .\benchmarks\go-rating.go 1000000
```

Run each candidate multiple times after warm-up. The checksum must be identical before comparing throughput.
