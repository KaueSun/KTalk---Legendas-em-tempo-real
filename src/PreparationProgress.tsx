import { Check, LoaderCircle } from 'lucide-react';
import type { PreparationStage } from './types';

export function PreparationProgress({
  stage,
  translate,
  audioTest,
}: {
  stage: PreparationStage | null;
  translate: boolean;
  audioTest: boolean;
}) {
  const steps: { id: PreparationStage; label: string }[] = [
    { id: 'recognition', label: 'Reconhecimento' },
    ...(translate ? [{ id: 'translation' as const, label: 'Tradução PT-BR' }] : []),
    { id: 'audio', label: 'Dispositivos' },
  ];
  const visible = audioTest ? steps.filter((step) => step.id === 'audio') : steps;
  const current = visible.findIndex((step) => step.id === stage);
  return (
    <ol className="preparation-steps" aria-label="Etapas de preparação">
      {visible.map((step, index) => (
        <li
          key={step.id}
          className={index < current ? 'done' : index === current ? 'current' : ''}
          aria-current={index === current ? 'step' : undefined}
        >
          {index < current ? (
            <Check size={13} />
          ) : index === current ? (
            <LoaderCircle size={13} className="spin" />
          ) : (
            <span>{index + 1}</span>
          )}
          {step.label}
        </li>
      ))}
    </ol>
  );
}
