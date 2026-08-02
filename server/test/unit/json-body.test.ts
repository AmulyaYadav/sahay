import { describe, expect, it } from 'vitest';
import { parseJsonBody } from '../../src/lib/json-body.js';

describe('parseJsonBody', () => {
  it('treats an absent body as absent rather than an error', () => {
    // The regression: a POST with no body but a JSON content type used to be
    // rejected before routing, so cancelling a request came back as a bare
    // "Something went wrong".
    expect(parseJsonBody('')).toBeUndefined();
    expect(parseJsonBody('   ')).toBeUndefined();
    expect(parseJsonBody('\n')).toBeUndefined();
  });

  it('parses a real body', () => {
    expect(parseJsonBody('{"reason":"changed_mind"}')).toEqual({ reason: 'changed_mind' });
    expect(parseJsonBody('{}')).toEqual({});
    expect(parseJsonBody('[1,2]')).toEqual([1, 2]);
  });

  it('still rejects malformed JSON as a client error', () => {
    // An omission is forgivable; a broken payload is not, and it must not
    // surface as a 500.
    expect(() => parseJsonBody('{"a":')).toThrow();
    try {
      parseJsonBody('not json');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });
});
