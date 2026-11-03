export type Stage = 'thinking' | 'reading' | 'searching' | 'saving';

export type Progress = (stage: Stage) => void;
