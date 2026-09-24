const iterations = Number.parseInt(process.argv[2] ?? "1000000", 10);

const SCALE = 10n ** 18n;
const CENT_DIVISOR = SCALE / 100n;
const RATE_1 = 1_234_567_890_123_456n;
const RATE_2 = 987_654_321_098_765n;
const RATE_3 = 543_210_987_654_321n;
const MINIMUM = 2n * SCALE;
const CAP = 200n * SCALE;

function min(a, b) {
  return a < b ? a : b;
}

function max(a, b) {
  return a > b ? a : b;
}

function halfUpDivide(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error("benchmark accepts only non-negative numerators and positive denominators");
  }
  return (numerator + denominator / 2n) / denominator;
}

function rate(quantity) {
  const chargeable = max(quantity - 1_000n, 0n);
  const tier1 = min(chargeable, 10_000n);
  const tier2 = min(max(chargeable - 10_000n, 0n), 90_000n);
  const tier3 = max(chargeable - 100_000n, 0n);

  const gross = tier1 * RATE_1 + tier2 * RATE_2 + tier3 * RATE_3;
  const prorated = halfUpDivide(gross * 17n, 31n);
  const discount = halfUpDivide(prorated * 725n, 10_000n);
  const guarded = min(max(prorated - discount, MINIMUM), CAP);
  return halfUpDivide(guarded, CENT_DIVISOR);
}

function execute(count) {
  let checksum = 0n;
  for (let i = 0; i < count; i += 1) {
    const quantity = BigInt((i * 7_919) % 250_000);
    checksum += rate(quantity);
  }
  return checksum;
}

execute(Math.min(iterations, 50_000));
const started = process.hrtime.bigint();
const checksum = execute(iterations);
const elapsedNs = process.hrtime.bigint() - started;
const elapsedSeconds = Number(elapsedNs) / 1_000_000_000;

process.stdout.write(JSON.stringify({
  runtime: `node ${process.version}`,
  arithmetic: "BigInt fixed-point scale=18",
  iterations,
  checksum: checksum.toString(),
  elapsed_seconds: Number(elapsedSeconds.toFixed(6)),
  operations_per_second: Math.round(iterations / elapsedSeconds),
}) + "\n");

