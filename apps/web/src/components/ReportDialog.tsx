import { LIMITS, REPORT_CATEGORIES } from '@sahay/shared';
import { useId, useState } from 'react';
import { useCreateReport } from '../api/hooks';
import { useT } from '../i18n/LocaleContext';
import { Button, Textarea } from '../ui/components';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';

export function ReportDialog({
  open,
  onClose,
  matchId,
  eventId,
}: {
  open: boolean;
  onClose: () => void;
  matchId?: string;
  eventId?: string;
}) {
  const t = useT();
  const { toast } = useToast();
  const create = useCreateReport();
  const [category, setCategory] = useState<string>('');
  const [note, setNote] = useState('');
  const [preserve, setPreserve] = useState(true);
  const groupId = useId();
  const preserveId = useId();

  const submit = () => {
    if (!category) return;
    create.mutate(
      { category, note: note || undefined, matchId, eventId, preserveConversation: matchId ? preserve : false },
      {
        onSuccess: () => {
          toast(t('reports.submitted'));
          setCategory('');
          setNote('');
          onClose();
        },
        onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('reports.title')} sheet>
      <div className="stack">
        <div role="radiogroup" aria-labelledby={groupId} className="stack-sm">
          <span id={groupId} className="field-label">
            {t('reports.reason')}
          </span>
          <div className="row-wrap">
            {REPORT_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                role="radio"
                aria-checked={category === cat}
                className="chip"
                onClick={() => setCategory(cat)}
              >
                {t(`reports.${cat}`)}
              </button>
            ))}
          </div>
        </div>

        <Textarea
          label={t('reports.detail')}
          value={note}
          maxLength={LIMITS.maxReportNoteLength}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
        />

        {matchId ? (
          <label className="row" style={{ alignItems: 'flex-start' }} htmlFor={preserveId}>
            <input
              id={preserveId}
              type="checkbox"
              checked={preserve}
              onChange={(e) => setPreserve(e.target.checked)}
              style={{ width: 22, height: 22, marginTop: 2 }}
            />
            <span className="text-sm">{t('reports.preserve')}</span>
          </label>
        ) : null}

        <Button block loading={create.isPending} disabled={!category} onClick={submit}>
          {t('common.report')}
        </Button>
      </div>
    </Dialog>
  );
}
