import { useI18n } from '../i18n/useI18n.js';
import NotFoundPanel from '../ui/NotFoundPanel.jsx';

export default function NotFound() {
  const { t } = useI18n();
  return <NotFoundPanel title={t('ui.notFound.pageTitle')} message={t('ui.notFound.page')} />;
}
