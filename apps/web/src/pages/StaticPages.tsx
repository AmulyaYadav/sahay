/** Static content pages: guidelines, privacy, terms, support. All content lives in the shared i18n catalog. */
import { useState } from 'react';
import { useT } from '../i18n/LocaleContext';
import { Banner, Button, Input, Textarea } from '../ui/components';

function Prose({ children }: { children: React.ReactNode }) {
  return <article style={{ maxWidth: '68ch', margin: '0 auto' }}>{children}</article>;
}

export function GuidelinesPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.guidelines.title')}</h1>
      <p className="text-soft">{t('pages.guidelines.intro')}</p>

      <h2>{t('pages.guidelines.purposeTitle')}</h2>
      <p>{t('pages.guidelines.purpose1')}</p>
      <p>{t('pages.guidelines.purpose2')}</p>

      <h2>{t('pages.guidelines.conductTitle')}</h2>
      <ul className="bullets">
        {(['conduct1', 'conduct2', 'conduct3', 'conduct4', 'conduct5'] as const).map((k) => (
          <li key={k}>{t(`pages.guidelines.${k}`)}</li>
        ))}
      </ul>

      <h2>{t('pages.guidelines.prohibitedTitle')}</h2>
      <p>{t('pages.guidelines.prohibitedIntro')}</p>
      <ul className="bullets">
        {(['prohibited1', 'prohibited2', 'prohibited3', 'prohibited4', 'prohibited5', 'prohibited6'] as const).map((k) => (
          <li key={k}>{t(`pages.guidelines.${k}`)}</li>
        ))}
      </ul>

      <h2>{t('pages.guidelines.enforcementTitle')}</h2>
      <p>{t('pages.guidelines.enforcement1')}</p>
      <p>{t('pages.guidelines.enforcement2')}</p>
    </Prose>
  );
}

export function PrivacyPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.privacy.title')}</h1>
      <p className="text-soft">{t('pages.privacy.intro')}</p>

      <h2>{t('pages.privacy.collectTitle')}</h2>
      <ul className="bullets">
        {(['collect1', 'collect2', 'collect3', 'collect4'] as const).map((k) => (
          <li key={k}>{t(`pages.privacy.${k}`)}</li>
        ))}
      </ul>

      <h2>{t('pages.privacy.locationTitle')}</h2>
      <p>{t('pages.privacy.location1')}</p>
      <p>{t('pages.privacy.location2')}</p>

      <h2>{t('pages.privacy.visibilityTitle')}</h2>
      <p>{t('pages.privacy.visibility1')}</p>
      <p>{t('pages.privacy.visibility2')}</p>

      <h2>{t('pages.privacy.retentionTitle')}</h2>
      <p>{t('pages.privacy.retention1')}</p>
      <p>{t('pages.privacy.retention2')}</p>
      <p>{t('pages.privacy.retention3')}</p>

      <h2>{t('pages.privacy.rightsTitle')}</h2>
      <p>{t('pages.privacy.rights1')}</p>
      <p>{t('pages.privacy.rights2')}</p>
      <p className="text-soft">{t('pages.privacy.contact')}</p>
    </Prose>
  );
}

export function TermsPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.terms.title')}</h1>
      <p className="text-soft">{t('pages.terms.intro')}</p>
      {(['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const).map((s) => (
        <section key={s}>
          <h2>{t(`pages.terms.${s}t`)}</h2>
          <p>{t(`pages.terms.${s}b`)}</p>
        </section>
      ))}
    </Prose>
  );
}

const ADMIN_REQUEST_EMAIL = 'sahay4230@gmail.com';

/**
 * Admin-account request form. There is no server endpoint for this, so rather
 * than pretend to submit, it composes a mailto: the visitor sends themselves —
 * the hint text says so explicitly, and the address is shown as a fallback for
 * anyone without a mail client configured.
 */
function AdminRequestForm() {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [event, setEvent] = useState('');

  const canSubmit = name.trim() !== '' && email.trim() !== '' && event.trim() !== '';

  const compose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const subject = `Sahay admin account request — ${name.trim()}`;
    const body = [
      `Name: ${name.trim()}`,
      `Email: ${email.trim()}`,
      `Organisation: ${org.trim() || '—'}`,
      '',
      'Event I want to run:',
      event.trim(),
    ].join('\n');
    window.location.href = `mailto:${ADMIN_REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <form className="stack" onSubmit={compose} style={{ marginTop: 'var(--sp-4)' }}>
      <Input label={t('pages.support.adminFormName')} value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label={t('pages.support.adminFormEmail')}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        label={t('pages.support.adminFormOrg')}
        hint={t('pages.support.adminFormOrgHint')}
        value={org}
        onChange={(e) => setOrg(e.target.value)}
      />
      <Textarea
        label={t('pages.support.adminFormEvent')}
        hint={t('pages.support.adminFormEventHint')}
        rows={3}
        value={event}
        onChange={(e) => setEvent(e.target.value)}
        required
      />
      <Button type="submit" disabled={!canSubmit}>
        {t('pages.support.adminFormSubmit')}
      </Button>
      <p className="text-xs text-soft" style={{ margin: 0 }}>
        {t('pages.support.adminFormMailHint')}
      </p>
      <p className="text-xs text-soft" style={{ margin: 0 }}>
        {t('pages.support.adminFormNoClientNote')}
      </p>
    </form>
  );
}

export function SupportPage() {
  const t = useT();
  return (
    <Prose>
      <h1>{t('pages.support.title')}</h1>
      <p className="text-soft">{t('pages.support.intro')}</p>

      <section>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('pages.support.adminRequestTitle')}</h2>
        <p>{t('pages.support.adminRequestBody')}</p>
        <AdminRequestForm />
      </section>

      {(['faq1', 'faq2', 'faq3', 'faq4'] as const).map((f) => (
        <section key={f}>
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t(`pages.support.${f}q`)}</h2>
          <p>{t(`pages.support.${f}a`)}</p>
        </section>
      ))}

      <Banner tone="danger" icon="warning">
        {t('pages.support.emergencyNote')}
      </Banner>
    </Prose>
  );
}
