/**
 * Request-help flow: category → qty → urgency → note → location (or area hint) →
 * expiry → safety acknowledgement → submit (idempotent). Shows the medical-emergency
 * notice for 'urgent' and always carries the "not an emergency service" line.
 */
import { CATEGORY_GROUPS, LIMITS, REQUEST_URGENCIES, coarsen, type Category, type RequestUrgency } from '@sahay/shared';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCatalogue, useCreateRequest, useEvent } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, newIdempotencyKey, unitLabel } from '../lib/format';
import { Banner, Button, Card, Input, SkeletonCard, Stepper, Textarea } from '../ui/components';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/Toast';

const URGENCY_KEY: Record<RequestUrgency, string> = { standard: 'request.std', soon: 'request.soon', urgent: 'request.urgent' };

export function RequestFlowPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { toast } = useToast();
  const eventQuery = useEvent(id);
  const catalogue = useCatalogue();
  const create = useCreateRequest();

  const [categoryId, setCategoryId] = useState<string>();
  const [qty, setQty] = useState(1);
  const [urgency, setUrgency] = useState<RequestUrgency>('standard');
  const [note, setNote] = useState('');
  const [useLocation, setUseLocation] = useState(true);
  const [areaHint, setAreaHint] = useState('');
  const [expiry, setExpiry] = useState<number>(15);
  const [ack, setAck] = useState(false);
  const [locError, setLocError] = useState(false);

  const byGroup = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const g of CATEGORY_GROUPS) map.set(g, []);
    for (const cat of catalogue.data?.categories ?? []) {
      if (cat.active) map.get(cat.group)?.push(cat);
    }
    return map;
  }, [catalogue.data]);

  if (eventQuery.isLoading || catalogue.isLoading) return <SkeletonCard lines={5} />;
  const event = eventQuery.data;
  if (!event) return <p role="alert">{t('errors.not_found')}</p>;

  const selected = catalogue.data?.categories.find((c) => c.id === categoryId);

  const getCoords = (): Promise<{ lat: number; lng: number } | undefined> =>
    new Promise((resolve) => {
      if (!useLocation || !('geolocation' in navigator)) {
        resolve(undefined);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(coarsen(pos.coords.latitude, pos.coords.longitude)),
        () => {
          setLocError(true);
          resolve(undefined);
        },
        { timeout: 8000, maximumAge: 60_000 },
      );
    });

  const submit = async () => {
    if (!selected || !ack) return;
    const coords = await getCoords();
    create.mutate(
      {
        eventId: event.id,
        categoryId: selected.id,
        qty,
        unit: selected.unit,
        urgency,
        note: note.trim() || undefined,
        expiresInMinutes: expiry,
        coords,
        areaHint: !coords && areaHint.trim() ? areaHint.trim() : undefined,
        safetyAcknowledged: true,
        idempotencyKey: newIdempotencyKey(),
      },
      {
        onSuccess: () => {
          toast(t('sync.matching'));
          navigate('/home');
        },
        onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
      },
    );
  };

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>{t('request.title')}</h1>

      {urgency === 'urgent' ? (
        <Banner tone="danger" icon="warning" role="alert">
          <strong>{t('request.medicalTitle')}</strong>
          <p style={{ marginBottom: 0 }}>{t('request.medicalBody')}</p>
        </Banner>
      ) : null}

      <Card>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('request.what')}</h2>
        {!selected ? (
          <div className="stack">
            {CATEGORY_GROUPS.map((group) => {
              const cats = byGroup.get(group) ?? [];
              if (cats.length === 0) return null;
              return (
                <section key={group}>
                  <h3 style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-soft)' }}>{t(`groups.${group}`)}</h3>
                  <div className="row-wrap">
                    {cats.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        className="chip"
                        onClick={() => {
                          setCategoryId(cat.id);
                          setQty(1);
                        }}
                      >
                        <Icon name={cat.icon} size={16} /> {categoryName(cat, locale)}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="row">
            <Icon name={selected.icon} size={24} />
            <strong style={{ flex: 1 }}>{categoryName(selected, locale)}</strong>
            <Button variant="ghost" onClick={() => setCategoryId(undefined)}>
              {t('common.edit')}
            </Button>
          </div>
        )}
      </Card>

      {selected ? (
        <>
          <Card>
            <div className="stack">
              <div className="field">
                <span className="field-label">{t('request.howMany')}</span>
                <Stepper
                  value={qty}
                  min={1}
                  max={selected.maxRequestQty}
                  onChange={setQty}
                  unitLabel={unitLabel(t, selected.unit)}
                  decreaseLabel={t('misc.decrease')}
                  increaseLabel={t('misc.increase')}
                />
              </div>

              <div className="field" role="radiogroup" aria-label={t('request.urgency')}>
                <span className="field-label">{t('request.urgency')}</span>
                <div className="row-wrap">
                  {REQUEST_URGENCIES.map((u) => (
                    <button key={u} type="button" role="radio" aria-checked={urgency === u} className="chip" onClick={() => setUrgency(u)}>
                      {t(URGENCY_KEY[u])}
                    </button>
                  ))}
                </div>
              </div>

              <Textarea
                label={`${t('request.note')}`}
                placeholder={t('request.notePlaceholder')}
                maxLength={LIMITS.maxNoteLength}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </Card>

          <Card>
            <div className="stack">
              <div className="field" role="radiogroup" aria-label={t('settings.location')}>
                <span className="field-label">{t('settings.location')}</span>
                <span className="field-hint">{t('request.locationWhy')}</span>
                <div className="row-wrap">
                  <button type="button" role="radio" aria-checked={useLocation} className="chip" onClick={() => setUseLocation(true)}>
                    <Icon name="location" size={16} /> {t('request.useLocation')}
                  </button>
                  <button type="button" role="radio" aria-checked={!useLocation} className="chip" onClick={() => setUseLocation(false)}>
                    {t('request.useArea')}
                  </button>
                </div>
                {locError && useLocation ? (
                  <span className="field-hint text-danger" role="alert">
                    {t('request.useArea')}
                  </span>
                ) : null}
              </div>
              {!useLocation ? (
                <Input label={t('request.areaHint')} value={areaHint} maxLength={80} onChange={(e) => setAreaHint(e.target.value)} />
              ) : null}

              <div className="field" role="radiogroup" aria-label={t('request.expiresIn')}>
                <span className="field-label">{t('request.expiresIn')}</span>
                <div className="row-wrap">
                  {LIMITS.requestExpiryOptionsMin.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={expiry === m} className="chip" onClick={() => setExpiry(m)}>
                      {t('misc.minutes', { count: m })}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <label className="row" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                style={{ width: 24, height: 24, marginTop: 2, flexShrink: 0 }}
              />
              <span className="text-sm">{t('request.safetyAck')}</span>
            </label>
          </Card>

          <Button block large loading={create.isPending} disabled={!ack} onClick={() => void submit()}>
            {t('request.submit')}
          </Button>
          <p className="text-xs text-soft text-center">{t('safety.notEmergency')}</p>
        </>
      ) : null}
    </div>
  );
}
