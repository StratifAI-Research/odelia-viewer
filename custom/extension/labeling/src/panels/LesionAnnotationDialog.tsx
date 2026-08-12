import React, { useCallback } from 'react';
import { FooterAction } from '@ohif/ui-next';

type LesionAnnotationDialogProps = {
  /** Injected by ManagedDialog (uiDialogService.show) to close the dialog. */
  hide?: () => void;
  /** Remove the measurement being annotated. */
  onDelete: () => void;
  /** The label editor rendered as the dialog body. */
  children: React.ReactNode;
};

/**
 * Body + footer of the "Enter your annotation" dialog for a lesion.
 *
 * Label edits are persisted by the editor itself as the user changes them, so
 * "Save" only dismisses; Enter does the same, matching the pre-3.13 dialog whose
 * Enter handler called the submit handler with no action.
 */
export default function LesionAnnotationDialog({
  hide,
  onDelete,
  children,
}: LesionAnnotationDialogProps) {
  const close = useCallback(() => hide?.(), [hide]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        close();
      }
    },
    [close]
  );

  return (
    <div
      className="flex flex-col gap-4 p-4"
      onKeyDown={onKeyDown}
    >
      {children}
      <FooterAction>
        <FooterAction.Right>
          <FooterAction.Secondary
            onClick={() => {
              onDelete();
              close();
            }}
          >
            Delete
          </FooterAction.Secondary>
          <FooterAction.Primary onClick={close}>Save</FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </div>
  );
}
