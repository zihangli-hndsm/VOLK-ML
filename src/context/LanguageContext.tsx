import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LanguageMode, LocalizedString } from '../types';

type LanguageContextValue = {
  mode: LanguageMode;
  setMode: (mode: LanguageMode) => void;
  t: (value: LocalizedString) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LanguageMode>('en');

  const value = useMemo<LanguageContextValue>(() => ({
    mode,
    setMode,
    t(value) {
      if (mode === 'zh') return value.zh;
      if (mode === 'parallel') return `${value.zh} (${value.en})`;
      return value.en;
    },
  }), [mode]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useVividTranslation() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useVividTranslation must be used inside LanguageProvider');
  return context;
}
