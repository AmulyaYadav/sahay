/** Shared moderation-action dialog: every action requires a typed written reason (audited). */
import { useState } from 'react';
import { useAdminModerate, type AdminModerateBody } from '../../api/hooks';
import { useT } from '../../i18n/LocaleContext';
import { Banner, Button, Input, Textarea } from '../../ui/components';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';

export interface ModerateTarget {
  action: string;
  label: string;
  targetUserId?: string;
  targetEventId?: string;
  targetMatchId?: string;
  reportId?: string;
  withDuration?: boolean;
}

export function ModerateDialog({ target, onClose }: { target: ModerateTarget | null; onClose: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const moderate = useAdminModerate();
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('');

  if (!target) return null;

  const submit = () => {
    const body: AdminModerateBody = {
      action: target.action,
      reason: reason.trim(),
    };
    if (target.targetUserId) body.targetUserId = target.targetUserId;
    if (target.targetEventId) body.targetEventId = target.targetEventId;
    if (target.targetMatchId) body.targetMatchId = target.targetMatchId;
    if (target.reportId) body.reportId = target.reportId;
    const hours = Number(duration);
    if (target.withDuration && Number.isFinite(hours) && hours > 0) body.durationHours = Math.round(hours);
    moderate.mutate(body, {
      onSuccess: () => {
        toast(t('sync.submitted'));
        setReason('');
        setDuration('');
        onClose();
      },
      onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
    });
  };

  return (
    <Dialog open onClose={onClose} title={target.label}>
      <div className="stack">
        <Banner tone="warn" icon="warning">
          {t('admin.reauthNote')}
        </Banner>
        <Textarea
          label={t('admin.reason')}
          value={reason}
          rows={3}
          minLength={5}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        {target.withDuration ? (
          <Input
            label={t('admin.durationHours')}
            type="number"
            min={1}
            max={24 * 90}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        ) : null}
        <Button variant="destructive" block loading={moderate.isPending} disabled={reason.trim().length < 5} onClick={submit}>
          {t('common.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
