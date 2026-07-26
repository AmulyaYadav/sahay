import { describe, expect, it } from 'vitest';
import { REDACTED, redactContactDetails } from '../../src/lib/redact.js';

describe('redactContactDetails', () => {
  it('redacts a contiguous run of 8+ digits', () => {
    expect(redactContactDetails('call me at 9876543210 ok?')).toBe(`call me at ${REDACTED} ok?`);
    expect(redactContactDetails('12345678')).toBe(REDACTED);
  });

  it('redacts digit runs split by spaces and dashes', () => {
    expect(redactContactDetails('98765 43210')).toBe(REDACTED);
    expect(redactContactDetails('12-34-56-78')).toBe(REDACTED);
    expect(redactContactDetails('my number is 98 76 54 32 10, call!')).toBe(
      `my number is ${REDACTED}, call!`,
    );
  });

  it('leaves short digit runs alone', () => {
    expect(redactContactDetails('gate 7, row 12')).toBe('gate 7, row 12');
    expect(redactContactDetails('1234567')).toBe('1234567'); // 7 digits — kept
    expect(redactContactDetails('need 2 bottles by 18:30')).toBe('need 2 bottles by 18:30');
  });

  it('redacts international formats and multiple occurrences', () => {
    // "91 9876543210" is one spaced digit run — the country code goes too.
    expect(redactContactDetails('+91 9876543210 or 022-2345-6789')).toBe(
      `+${REDACTED} or ${REDACTED}`,
    );
  });

  it('keeps surrounding text intact', () => {
    expect(redactContactDetails('a 1122334455 b')).toBe(`a ${REDACTED} b`);
  });
});
