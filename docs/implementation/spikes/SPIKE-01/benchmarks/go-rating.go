package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"runtime"
	"strconv"
	"time"
)

var (
	zero        = big.NewInt(0)
	scale       = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	centDivisor = new(big.Int).Div(new(big.Int).Set(scale), big.NewInt(100))
	rate1, _    = new(big.Int).SetString("1234567890123456", 10)
	rate2, _    = new(big.Int).SetString("987654321098765", 10)
	rate3, _    = new(big.Int).SetString("543210987654321", 10)
	minimum     = new(big.Int).Mul(new(big.Int).Set(scale), big.NewInt(2))
	capAmount   = new(big.Int).Mul(new(big.Int).Set(scale), big.NewInt(200))
)

func clone(value *big.Int) *big.Int {
	return new(big.Int).Set(value)
}

func min(a, b *big.Int) *big.Int {
	if a.Cmp(b) < 0 {
		return clone(a)
	}
	return clone(b)
}

func max(a, b *big.Int) *big.Int {
	if a.Cmp(b) > 0 {
		return clone(a)
	}
	return clone(b)
}

func halfUpDivide(numerator, denominator *big.Int) *big.Int {
	if numerator.Sign() < 0 || denominator.Sign() <= 0 {
		panic("benchmark accepts only non-negative numerators and positive denominators")
	}
	half := new(big.Int).Div(clone(denominator), big.NewInt(2))
	return new(big.Int).Div(new(big.Int).Add(clone(numerator), half), denominator)
}

func rate(quantityValue int64) *big.Int {
	quantity := big.NewInt(quantityValue)
	chargeable := max(new(big.Int).Sub(quantity, big.NewInt(1_000)), zero)
	tier1 := min(chargeable, big.NewInt(10_000))
	tier2 := min(max(new(big.Int).Sub(clone(chargeable), big.NewInt(10_000)), zero), big.NewInt(90_000))
	tier3 := max(new(big.Int).Sub(clone(chargeable), big.NewInt(100_000)), zero)

	gross := new(big.Int).Add(
		new(big.Int).Add(new(big.Int).Mul(tier1, rate1), new(big.Int).Mul(tier2, rate2)),
		new(big.Int).Mul(tier3, rate3),
	)
	prorated := halfUpDivide(new(big.Int).Mul(gross, big.NewInt(17)), big.NewInt(31))
	discount := halfUpDivide(new(big.Int).Mul(clone(prorated), big.NewInt(725)), big.NewInt(10_000))
	guarded := min(max(new(big.Int).Sub(prorated, discount), minimum), capAmount)
	return halfUpDivide(guarded, centDivisor)
}

func execute(count int) *big.Int {
	checksum := big.NewInt(0)
	for i := 0; i < count; i++ {
		quantity := (int64(i) * 7_919) % 250_000
		checksum.Add(checksum, rate(quantity))
	}
	return checksum
}

func main() {
	iterations := 1_000_000
	if len(os.Args) > 1 {
		parsed, err := strconv.Atoi(os.Args[1])
		if err != nil {
			panic(err)
		}
		iterations = parsed
	}

	execute(minInt(iterations, 50_000))
	started := time.Now()
	checksum := execute(iterations)
	elapsed := time.Since(started).Seconds()

	result := map[string]any{
		"runtime":               fmt.Sprintf("go %s", runtime.Version()),
		"arithmetic":            "math/big.Int fixed-point scale=18",
		"iterations":            iterations,
		"checksum":              checksum.String(),
		"elapsed_seconds":       elapsed,
		"operations_per_second": int64(float64(iterations)/elapsed + 0.5),
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		panic(err)
	}
	fmt.Println(string(encoded))
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

