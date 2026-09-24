const MAX_EVIDENCE_LENGTH = 2000;

const SENSITIVE_KEY = "password|passwd|pwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|client[_-]?secret|cvv|cvc";

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Best-effort redaction for internal trace evidence. It is a safety net, not a licence to log
 * sensitive values: callers must still avoid placing secrets in exception messages.
 */
export function redactSensitiveText(input: string): string {
  let text = input
    .replace(
      new RegExp(`\\b(${SENSITIVE_KEY})(["']?\\s*[=:]\\s*)(?:(?:Bearer|Basic)\\s+)?("[^"]*"|'[^']*'|[^\\s,;&]+)`, "gi"),
      (_match, key: string, separator: string, value: string) => {
        const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : "";
        return `${key}${separator}${quote}[REDACTED]${quote}`;
      },
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (match) => `${match.split(/\s+/)[0]} [REDACTED]`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[REDACTED_JWT]")
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+/g, "[REDACTED_KEY]")
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
      const digits = match.replace(/[ -]/g, "");
      return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? "[REDACTED_PAN]" : match;
    });
  if (text.length > MAX_EVIDENCE_LENGTH) text = `${text.slice(0, MAX_EVIDENCE_LENGTH)}...[truncated]`;
  return text;
}
