import { InlineMessage } from './ConfiguratorPrimitives.jsx';

export function ConfiguratorLoading({ label }) {
  return (
    <div id="loader-wrapper">
      <div className="loader">
        <div className="loader-ring" />
        <div className="loader-ring" />
        <div className="loader-ring" />
        <p className="loader-text">{label}</p>
      </div>
    </div>
  );
}

export function ConfiguratorUnavailable({
  error,
  errorTitle,
  notFoundLabel,
}) {
  return (
    <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
      {error ? (
        <InlineMessage type="error" title={errorTitle}>
          {error}
        </InlineMessage>
      ) : (
        notFoundLabel
      )}
    </div>
  );
}
