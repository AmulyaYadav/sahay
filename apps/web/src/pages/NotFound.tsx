import { Link } from 'react-router-dom';
import { useT } from '../i18n/LocaleContext';

export function NotFoundPage() {
  const t = useT();
  return (
    <div className="empty-state" style={{ minHeight: '50dvh' }}>
      <h1>{t('misc.notFoundTitle')}</h1>
      <p>{t('misc.notFoundBody')}</p>
      <Link to="/" className="btn btn-primary">
        {t('misc.goHome')}
      </Link>
    </div>
  );
}
