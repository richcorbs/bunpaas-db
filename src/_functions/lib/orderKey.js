export function padOrderKey(value) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  // Check if it's a valid integer (all digits, optional minus prefix)
  if (/^-?\d+$/.test(str)) {
    const isNegative = str.startsWith('-');
    const digits = isNegative ? str.slice(1) : str;
    // Pad to 10 digits
    const padded = digits.padStart(10, '0');
    return isNegative ? `-${padded}` : padded;
  }
  return value; // Non-numeric, return as-is
}

export function unpadOrderKey(value) {
  if (!value) return value;
  // Check if it looks like a padded number (10 digits, optionally with - prefix)
  if (/^-?\d{10}$/.test(value)) {
    // Remove leading zeros but keep sign
    return value.replace(/^(-?)0+/, '$1') || '0';
  }
  return value; // Not a padded number, return as-is
}
