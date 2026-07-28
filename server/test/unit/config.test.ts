import '../env.js';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigForTests } from '../../src/config.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetConfigForTests();
});

describe('production config guards', () => {
  it('refuses to start in production with TEST_FIXED_OTP set', () => {
    process.env.NODE_ENV = 'production';
    process.env.TEST_FIXED_OTP = '123456';
    resetConfigForTests();
    expect(() => loadConfig()).toThrow('Refusing to start in production with TEST_FIXED_OTP set');
  });

  it('refuses to start in production with example or reused crypto keys', () => {
    process.env.NODE_ENV = 'production';
    process.env.PII_ENCRYPTION_KEY = '0'.repeat(64);
    resetConfigForTests();
    expect(() => loadConfig()).toThrow('Refusing to start in production with example or reused crypto keys');
  });

  it('refuses to start in production with EMAIL_PROVIDER=console', () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'console';
    resetConfigForTests();
    expect(() => loadConfig()).toThrow('Refusing to start in production with EMAIL_PROVIDER=console');
  });

  it('refuses to start in production with EMAIL_PROVIDER=resend but no RESEND_API_KEY/RESEND_FROM', () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    resetConfigForTests();
    expect(() => loadConfig()).toThrow(
      'Refusing to start in production with EMAIL_PROVIDER=resend but RESEND_API_KEY/RESEND_FROM unset',
    );
  });

  it('allows production with EMAIL_PROVIDER=resend when RESEND_API_KEY/RESEND_FROM are set', () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'live-key';
    process.env.RESEND_FROM = 'noreply@example.org';
    resetConfigForTests();
    expect(() => loadConfig()).not.toThrow();
  });
});
