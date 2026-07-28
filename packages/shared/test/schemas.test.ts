import { describe, expect, it } from 'vitest';
import { zOtpStart, zOtpVerify, zMe } from '../src/schemas.js';

describe('email auth schemas', () => {
  it('zOtpStart requires a valid email, rejects phone-shaped strings', () => {
    expect(zOtpStart.safeParse({ email: 'person@example.com', locale: 'en' }).success).toBe(true);
    expect(zOtpStart.safeParse({ email: '+919876543210', locale: 'en' }).success).toBe(false);
  });

  it('zOtpVerify requires email + 6-digit code', () => {
    const result = zOtpVerify.safeParse({
      email: 'person@example.com',
      code: '123456',
      device: { platform: 'web' },
    });
    expect(result.success).toBe(true);
  });

  it('zMe exposes emailVerified, not phoneVerified', () => {
    expect(zMe.shape).toHaveProperty('emailVerified');
    expect(zMe.shape).not.toHaveProperty('phoneVerified');
  });
});
