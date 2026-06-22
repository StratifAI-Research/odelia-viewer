// Jest stub for @ohif/ui-next (symlinked raw source; not transpiled by default).
// Exports the symbols the extension imports: Button, Dialog family, useViewportGrid.
import React from 'react';

const Pass = ({ children, ...rest }: any) => <div {...rest}>{children}</div>;

export const Button = ({ children, onClick, disabled, ...rest }: any) => (
  <button onClick={onClick} disabled={disabled} {...rest}>
    {children}
  </button>
);

// Faithful to the real (radix) Dialog: content only renders when `open`.
export const Dialog = ({ open, children }: any) => (open ? <div>{children}</div> : null);
export const DialogContent = Pass;
export const DialogHeader = Pass;
export const DialogFooter = Pass;
export const DialogTitle = Pass;
export const DialogDescription = Pass;

export const useViewportGrid = () => [
  { activeViewportId: 'v1', viewports: new Map() },
  {},
];
