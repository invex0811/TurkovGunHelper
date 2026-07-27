import { useState } from 'react';
import { useI18n } from '../i18n/useI18n.js';

function AsyncImageContent({
  src,
  alt,
  className,
  style,
  containerClassName,
  containerStyle,
  imageClassName,
  unavailableLabel,
  unavailableStyle,
  shimmerBorderRadius = 'inherit',
}) {
  const { t } = useI18n();
  const [imageState, setImageState] = useState(src ? 'loading' : 'error');
  const isLoading = Boolean(src) && imageState === 'loading';
  const canDisplayImage = Boolean(src) && imageState !== 'error';

  return (
    <div
      className={containerClassName}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...containerStyle,
      }}
    >
      {isLoading && (
        <div
          className="shimmer"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: shimmerBorderRadius,
          }}
        />
      )}
      {canDisplayImage ? (
        <img
          src={src}
          alt={alt}
          className={[className, imageClassName].filter(Boolean).join(' ') || undefined}
          loading="lazy"
          decoding="async"
          onLoad={() => setImageState('loaded')}
          onError={() => setImageState('error')}
          style={{
            ...style,
            opacity: imageState === 'loaded' ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out',
          }}
        />
      ) : (
        <span
          style={{
            color: 'var(--color-text-muted)',
            fontSize: '0.75rem',
            ...unavailableStyle,
          }}
        >
          {unavailableLabel ?? t('image.unavailable')}
        </span>
      )}
    </div>
  );
}

export default function AsyncImage(props) {
  return <AsyncImageContent key={props.src || 'missing-image'} {...props} />;
}
