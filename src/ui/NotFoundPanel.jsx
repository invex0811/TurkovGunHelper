import { Link } from 'react-router-dom';
import { InlineMessage } from '../features/configurator/components/ConfiguratorPrimitives.jsx';
import { useI18n } from '../i18n/useI18n.js';

// "Not found" for an unknown address or a weapon the catalog does not have:
// a way back to the catalog instead of a retry that cannot help.
export default function NotFoundPanel({ title, message }) {
  const { t } = useI18n();
  return (
    <div className="glass-panel not-found">
      <InlineMessage type="warning" title={title}>
        {message}
        <div className="inline-message__actions">
          <Link className="btn btn--outline" to="/">{t('ui.notFound.back')}</Link>
        </div>
      </InlineMessage>
    </div>
  );
}
