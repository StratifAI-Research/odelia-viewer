// Jest stub for @ohif/ui (symlinked raw source; not transpiled by default).
// Exports only the symbols the extension imports: Button, DialogAction, useImageViewer.
import React from 'react';

export const Button = ({ children, onClick, disabled, ...rest }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    {...rest}
  >
    {children}
  </button>
);

export const DialogAction = ({ children, onClick, ...rest }: any) => (
  <button
    onClick={onClick}
    {...rest}
  >
    {children}
  </button>
);

export const useImageViewer = () => ({ StudyInstanceUIDs: ['1.2.3'] });
