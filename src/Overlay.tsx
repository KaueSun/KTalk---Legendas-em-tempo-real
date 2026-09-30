import { useEffect, useState } from 'react';
import { initial, sourceNames } from './state';
import type { Caption } from './types';

export function Overlay() {
  const [preferences, setPreferences] = useState(initial.preferences);
  const [caption, setCaption] = useState<(Pick<Caption, 'text' | 'source'> & Partial<Caption>) | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    window.ktalk?.snapshot().then(state => setPreferences(state.preferences));
    return window.ktalk?.onEvent(event => {
      if (event.type === 'preferences') setPreferences(event.preferences);
      if (event.type === 'overlay-caption') { setCaption(event.caption); setPreview(event.preview); }
      if (event.type === 'cleared') setCaption(null);
    });
  }, []);
  if (!caption) return null;
  return <div className={`overlay-root position-${preferences.position}`}>
    <div className="floating-caption" style={{ backgroundColor: `rgba(16, 24, 22, ${preferences.opacity / 100})` }}>
      <span className="floating-source">{preview ? 'KTalk · Prévia da legenda' : <>KTalk · {caption.target_language === 'pt-BR' ? 'EN → PT-BR' : sourceNames[caption.source]}{caption.final === false && <><i />Atualizando</>}</>}</span>
      <p style={{ fontSize: preferences.fontSize }}>{caption.text}</p>
    </div>
  </div>;
}
