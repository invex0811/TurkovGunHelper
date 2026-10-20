import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FEEDBACK_URL } from '../features/feedback/feedbackLink.js';
import { applyPageMeta } from '../features/seo/documentMeta.js';
import { NOT_FOUND_META } from '../features/seo/pageMeta.js';
import { useI18n } from '../i18n/useI18n.js';
import { MaterialSymbol } from './MaterialSymbol.js';

// An address the app has nothing for: an unknown page or a weapon the catalog
// does not know. Leads back to the weapon list or to a bug report.
export default function NotFoundState({ title, description }) {
  const { t } = useI18n();

  useEffect(() => {
    applyPageMeta(NOT_FOUND_META);
  }, []);

  return (
    <section className="not-found">
      <p className="not-found__code" aria-hidden="true">404</p>
      <h1 className="not-found__title">{title}</h1>
      <p className="not-found__description">{description}</p>
      <div className="not-found__actions">
        <Link className="btn btn--primary" to="/">{t('notFound.toWeapons')}</Link>
        <a className="btn btn--ghost" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          <MaterialSymbol name="bug_report" />
          {t('feedback.report')}
        </a>
      </div>
    </section>
  );
}
