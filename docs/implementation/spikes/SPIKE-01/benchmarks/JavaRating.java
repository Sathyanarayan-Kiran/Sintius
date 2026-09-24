import java.math.BigInteger;
import java.util.Locale;

public final class JavaRating {
    private static final BigInteger ZERO = BigInteger.ZERO;
    private static final BigInteger SCALE = BigInteger.TEN.pow(18);
    private static final BigInteger CENT_DIVISOR = SCALE.divide(BigInteger.valueOf(100));
    private static final BigInteger RATE_1 = new BigInteger("1234567890123456");
    private static final BigInteger RATE_2 = new BigInteger("987654321098765");
    private static final BigInteger RATE_3 = new BigInteger("543210987654321");
    private static final BigInteger MINIMUM = SCALE.multiply(BigInteger.valueOf(2));
    private static final BigInteger CAP = SCALE.multiply(BigInteger.valueOf(200));

    private static BigInteger min(BigInteger a, BigInteger b) {
        return a.min(b);
    }

    private static BigInteger max(BigInteger a, BigInteger b) {
        return a.max(b);
    }

    private static BigInteger halfUpDivide(BigInteger numerator, BigInteger denominator) {
        if (numerator.signum() < 0 || denominator.signum() <= 0) {
            throw new IllegalArgumentException("benchmark accepts only non-negative numerators and positive denominators");
        }
        return numerator.add(denominator.divide(BigInteger.TWO)).divide(denominator);
    }

    private static BigInteger rate(long quantityValue) {
        BigInteger quantity = BigInteger.valueOf(quantityValue);
        BigInteger chargeable = max(quantity.subtract(BigInteger.valueOf(1_000)), ZERO);
        BigInteger tier1 = min(chargeable, BigInteger.valueOf(10_000));
        BigInteger tier2 = min(max(chargeable.subtract(BigInteger.valueOf(10_000)), ZERO), BigInteger.valueOf(90_000));
        BigInteger tier3 = max(chargeable.subtract(BigInteger.valueOf(100_000)), ZERO);

        BigInteger gross = tier1.multiply(RATE_1)
                .add(tier2.multiply(RATE_2))
                .add(tier3.multiply(RATE_3));
        BigInteger prorated = halfUpDivide(gross.multiply(BigInteger.valueOf(17)), BigInteger.valueOf(31));
        BigInteger discount = halfUpDivide(prorated.multiply(BigInteger.valueOf(725)), BigInteger.valueOf(10_000));
        BigInteger guarded = min(max(prorated.subtract(discount), MINIMUM), CAP);
        return halfUpDivide(guarded, CENT_DIVISOR);
    }

    private static BigInteger execute(int count) {
        BigInteger checksum = ZERO;
        for (int i = 0; i < count; i++) {
            long quantity = ((long) i * 7_919L) % 250_000L;
            checksum = checksum.add(rate(quantity));
        }
        return checksum;
    }

    public static void main(String[] args) {
        Locale.setDefault(Locale.ROOT);
        int iterations = args.length == 0 ? 1_000_000 : Integer.parseInt(args[0]);
        execute(Math.min(iterations, 50_000));
        long started = System.nanoTime();
        BigInteger checksum = execute(iterations);
        long elapsedNs = System.nanoTime() - started;
        double elapsedSeconds = elapsedNs / 1_000_000_000.0;
        long operationsPerSecond = Math.round(iterations / elapsedSeconds);

        System.out.printf(Locale.ROOT,
                "{\"runtime\":\"java %s\",\"arithmetic\":\"BigInteger fixed-point scale=18\",\"iterations\":%d,\"checksum\":\"%s\",\"elapsed_seconds\":%.6f,\"operations_per_second\":%d}%n",
                System.getProperty("java.version"), iterations, checksum, elapsedSeconds, operationsPerSecond);
    }
}

