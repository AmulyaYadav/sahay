/**
 * Create-event flow (/events/new): title, description, type, visibility, area label,
 * center coordinates (browser geolocation coarsened on-device, or manual lat/lng),
 * radius, schedule, timezone, optional safety/medical info. On success shows the event
 * code — and, for invite_only, the invite code exactly once with a copy button.
 * A 409 duplicate response (details.duplicateEventCode) links to the existing event.
 */
import { EVENT_TYPES, EVENT_VISIBILITIES, coarsen, type EventDetail, type EventType, type EventVisibility } from '@sahay/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../api/client';
import { useCreateEvent } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { Banner, Button, Card, Input, Select, Textarea } from '../ui/components';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/Toast';

const RADIUS_OPTIONS_M = [500, 1000, 2000, 5000] as const;

const VISIBILITY_KEY: Record<EventVisibility, string> = {
  public: 'createEvent.visPublic',
  unlisted: 'createEvent.visUnlisted',
  invite_only: 'createEvent.visInviteOnly',
};

function radiusLabel(m: number): string {
  return m < 1000 ? `${m} m` : `${m / 1000} km`;
}

/** datetime-local value → ISO 8601 with offset (as required by zIsoDate). */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

interface Created {
  event: EventDetail;
  inviteCode?: string;
}

export function CreateEventPage() {
  const { t } = useLocale();
  const { toast } = useToast();
  const create = useCreateEvent();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<EventType>('community_event');
  const [visibility, setVisibility] = useState<EventVisibility>('unlisted');
  const [areaLabel, setAreaLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [fromGeo, setFromGeo] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [radiusM, setRadiusM] = useState(2000);
  const [startsLocal, setStartsLocal] = useState('');
  const [endsLocal, setEndsLocal] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [safetyInfo, setSafetyInfo] = useState('');
  const [medicalInfo, setMedicalInfo] = useState('');

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateCode, setDuplicateCode] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoError(true);
      return;
    }
    setLocating(true);
    setGeoError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Coarsen on-device before the coordinates ever enter form state (~100 m).
        const coarse = coarsen(pos.coords.latitude, pos.coords.longitude);
        setLat(String(coarse.lat));
        setLng(String(coarse.lng));
        setFromGeo(true);
        setLocating(false);
      },
      () => {
        setGeoError(true);
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const latNum = Number.parseFloat(lat);
  const lngNum = Number.parseFloat(lng);
  const centerValid =
    Number.isFinite(latNum) && Number.isFinite(lngNum) && Math.abs(latNum) <= 90 && Math.abs(lngNum) <= 180;
  const startsAt = toIso(startsLocal);
  const endsAt = toIso(endsLocal);
  const endBeforeStart = !!startsAt && !!endsAt && new Date(endsAt) <= new Date(startsAt);
  const formValid =
    title.trim().length >= 3 &&
    areaLabel.trim().length >= 3 &&
    centerValid &&
    !!startsAt &&
    !!endsAt &&
    !endBeforeStart &&
    timezone.trim().length > 0;

  const submit = () => {
    if (!formValid || !startsAt || !endsAt) return;
    setSubmitError(null);
    setDuplicateCode(null);
    // Coarsen manual input too — the server only ever needs ~100 m precision.
    const center = coarsen(latNum, lngNum);
    create.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        type,
        visibility,
        areaLabel: areaLabel.trim(),
        center,
        radiusM,
        startsAt,
        endsAt,
        timezone: timezone.trim(),
        safetyInfo: safetyInfo.trim() || undefined,
        medicalInfo: medicalInfo.trim() || undefined,
      },
      {
        onSuccess: (data) => setCreated(data),
        onError: (e) => {
          if (e instanceof ApiClientError && e.status === 409 && typeof e.details?.duplicateEventCode === 'string') {
            setDuplicateCode(e.details.duplicateEventCode);
            return;
          }
          setSubmitError(e instanceof Error ? e.message : t('common.error'));
        },
      },
    );
  };

  const copyInviteCode = (code: string) => {
    void navigator.clipboard
      .writeText(code)
      .then(() => toast(t('createEvent.copied')))
      .catch(() => toast(t('common.error'), 'error'));
  };

  if (created) {
    const { event, inviteCode } = created;
    return (
      <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1>{t('createEvent.successTitle')}</h1>

        <Card>
          <div className="stack-sm">
            <span className="field-label">{t('createEvent.codeLabel')}</span>
            <strong style={{ fontSize: 'var(--fs-2xl)', letterSpacing: '0.08em' }}>{event.code}</strong>
            <p className="text-sm text-soft" style={{ margin: 0 }}>
              {t('createEvent.codeShare')}
            </p>
          </div>
        </Card>

        {inviteCode ? (
          <Card>
            <div className="stack-sm">
              <span className="field-label">{t('createEvent.inviteCodeLabel')}</span>
              <div className="row">
                <strong style={{ flex: 1, fontSize: 'var(--fs-lg)', letterSpacing: '0.08em' }}>{inviteCode}</strong>
                <Button variant="secondary" onClick={() => copyInviteCode(inviteCode)}>
                  {t('createEvent.copyCode')}
                </Button>
              </div>
              <Banner tone="warn" icon="warning" role="alert">
                {t('createEvent.inviteOnce')}
              </Banner>
            </div>
          </Card>
        ) : null}

        {event.visibility === 'public' ? (
          <Banner tone="info" icon="info">
            {t('createEvent.visPublicNote')}
          </Banner>
        ) : null}

        <Link className="btn btn-primary btn-block" to={`/events/${event.code}`}>
          {t('createEvent.goToEvent')}
        </Link>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>{t('createEvent.title')}</h1>

      {duplicateCode ? (
        <Banner tone="warn" icon="info" role="alert">
          <strong>{t('createEvent.duplicateTitle')}</strong>
          <p style={{ margin: 'var(--sp-1) 0' }}>{t('createEvent.duplicateBody')}</p>
          <Link to={`/events/${encodeURIComponent(duplicateCode)}`}>
            {t('createEvent.duplicateOpen')} ({duplicateCode})
          </Link>
        </Banner>
      ) : null}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Card>
          <div className="stack">
            <Input
              label={t('createEvent.eventTitle')}
              value={title}
              minLength={3}
              maxLength={120}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              label={t('createEvent.description')}
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Select label={t('events.typeFilter')} value={type} onChange={(e) => setType(e.target.value as EventType)}>
              {EVENT_TYPES.map((et) => (
                <option key={et} value={et}>
                  {t(`eventTypes.${et}`)}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card>
          <div className="field" role="radiogroup" aria-label={t('createEvent.visibility')}>
            <span className="field-label">{t('createEvent.visibility')}</span>
            <div className="row-wrap">
              {EVENT_VISIBILITIES.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={visibility === v}
                  className="chip"
                  onClick={() => setVisibility(v)}
                >
                  {t(VISIBILITY_KEY[v])}
                </button>
              ))}
            </div>
            {visibility === 'public' ? <span className="field-hint">{t('createEvent.visPublicNote')}</span> : null}
            <span className="field-hint">{t('events.unlistedNote')}</span>
          </div>
        </Card>

        <Card>
          <div className="stack">
            <Input
              label={t('createEvent.areaLabel')}
              hint={t('createEvent.areaLabelHint')}
              value={areaLabel}
              minLength={3}
              maxLength={120}
              required
              onChange={(e) => setAreaLabel(e.target.value)}
            />

            <div className="field">
              <span className="field-label">{t('createEvent.centerTitle')}</span>
              <span className="field-hint">{t('createEvent.centerWhy')}</span>
              <div className="row-wrap">
                <Button variant="secondary" loading={locating} onClick={useMyLocation}>
                  <Icon name="location" size={16} /> {locating ? t('createEvent.locating') : t('createEvent.useMyLocation')}
                </Button>
              </div>
              {geoError ? (
                <span className="field-hint text-danger" role="alert">
                  {t('createEvent.locationFailed')}
                </span>
              ) : null}
              {fromGeo && centerValid ? (
                <span className="field-hint" role="status">
                  {t('createEvent.coarseKept', { lat, lng })}
                </span>
              ) : null}
            </div>

            <div className="grid-2">
              <Input
                label={t('createEvent.lat')}
                type="number"
                inputMode="decimal"
                step="any"
                min={-90}
                max={90}
                value={lat}
                required
                onChange={(e) => {
                  setLat(e.target.value);
                  setFromGeo(false);
                }}
              />
              <Input
                label={t('createEvent.lng')}
                type="number"
                inputMode="decimal"
                step="any"
                min={-180}
                max={180}
                value={lng}
                required
                onChange={(e) => {
                  setLng(e.target.value);
                  setFromGeo(false);
                }}
              />
            </div>

            <Select label={t('createEvent.radius')} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))}>
              {RADIUS_OPTIONS_M.map((m) => (
                <option key={m} value={m}>
                  {radiusLabel(m)}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card>
          <div className="stack">
            <div className="grid-2">
              <Input
                label={t('createEvent.starts')}
                type="datetime-local"
                value={startsLocal}
                required
                onChange={(e) => setStartsLocal(e.target.value)}
              />
              <Input
                label={t('createEvent.ends')}
                type="datetime-local"
                value={endsLocal}
                required
                error={endBeforeStart ? t('createEvent.endAfterStart') : undefined}
                onChange={(e) => setEndsLocal(e.target.value)}
              />
            </div>
            <Input label={t('createEvent.timezone')} value={timezone} required onChange={(e) => setTimezone(e.target.value)} />
          </div>
        </Card>

        <Card>
          <div className="stack">
            <Textarea
              label={t('createEvent.safetyInfo')}
              rows={2}
              maxLength={2000}
              value={safetyInfo}
              onChange={(e) => setSafetyInfo(e.target.value)}
            />
            <Textarea
              label={t('createEvent.medicalInfo')}
              rows={2}
              maxLength={2000}
              value={medicalInfo}
              onChange={(e) => setMedicalInfo(e.target.value)}
            />
          </div>
        </Card>

        {submitError ? (
          <Banner tone="danger" icon="warning" role="alert">
            {submitError}
          </Banner>
        ) : null}

        <Button type="submit" block large loading={create.isPending} disabled={!formValid}>
          {t('createEvent.submit')}
        </Button>
      </form>
    </div>
  );
}
