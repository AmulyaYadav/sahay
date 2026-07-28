import '../env.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '../../src/config.js';
import { ConsoleEmailProvider, getOtpProvider, maskEmail, ResendEmailProvider } from '../../src/lib/email.js';

afterEach(() => {
  vi.restoreAllMocks();
  process.env.EMAIL_PROVIDER = 'console';
  resetConfigForTests();
});

describe('maskEmail', () => {
  it('keeps only the first character and the domain', () => {
    expect(maskEmail('person@example.com')).toBe('p***@example.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
  });
});

describe('ConsoleEmailProvider', () => {
  it('never logs the full email address', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleEmailProvider().send('person@example.com', '123456', 'en');
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]!.join(' ');
    expect(logged).not.toContain('person@example.com');
    expect(logged).toContain('p***@example.com');
    expect(logged).toContain('123456');
  });
});

describe('getOtpProvider', () => {
  it('selects the provider from config', () => {
    process.env.EMAIL_PROVIDER = 'console';
    resetConfigForTests();
    expect(getOtpProvider()).toBeInstanceOf(ConsoleEmailProvider);
    process.env.EMAIL_PROVIDER = 'resend';
    resetConfigForTests();
    expect(getOtpProvider()).toBeInstanceOf(ResendEmailProvider);
  });
});

describe('ResendEmailProvider', () => {
  it('posts to the Resend API with the code in the body and throws on non-2xx', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM = 'noreply@example.org';
    resetConfigForTests();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );
    await new ResendEmailProvider().send('person@example.com', '123456', 'en');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.to).toBe('person@example.com');
    expect(body.html).toContain('123456');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(new ResendEmailProvider().send('person@example.com', '123456', 'en')).rejects.toThrow(
      'resend send failed',
    );
  });
});
