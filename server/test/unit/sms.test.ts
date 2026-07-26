import '../env.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '../../src/config.js';
import {
  ConsoleSmsProvider,
  getSmsProvider,
  maskPhone,
  Msg91SmsProvider,
  TwilioSmsProvider,
} from '../../src/lib/sms.js';

afterEach(() => {
  vi.restoreAllMocks();
  process.env.SMS_PROVIDER = 'console';
  resetConfigForTests();
});

describe('maskPhone', () => {
  it('keeps only the country code prefix and last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91…3210');
    expect(maskPhone('+12025550123')).toBe('+12…0123');
  });
});

describe('ConsoleSmsProvider', () => {
  it('never logs the full phone number', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleSmsProvider().send('+919876543210', 'Sahay code: 123456', 'en');
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]!.join(' ');
    expect(logged).not.toContain('+919876543210');
    expect(logged).toContain('+91…3210');
    expect(logged).toContain('Sahay code: 123456');
  });
});

describe('getSmsProvider', () => {
  it('selects the provider from config', () => {
    process.env.SMS_PROVIDER = 'console';
    resetConfigForTests();
    expect(getSmsProvider()).toBeInstanceOf(ConsoleSmsProvider);
    process.env.SMS_PROVIDER = 'twilio';
    resetConfigForTests();
    expect(getSmsProvider()).toBeInstanceOf(TwilioSmsProvider);
    process.env.SMS_PROVIDER = 'msg91';
    resetConfigForTests();
    expect(getSmsProvider()).toBeInstanceOf(Msg91SmsProvider);
  });
});
