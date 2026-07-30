import React from 'react';
import { FooterAction } from '@ohif/ui-next';

/**
 * Confirmation dialog shown before unlocking a previously-submitted feedback
 * for editing. Stateless — driven entirely by props — so it lives at module
 * scope instead of being re-created on every FeedbackPanel render.
 */
export const EditConfirmModal: React.FC<{ hide: () => void; onConfirm: () => void }> = ({
  hide,
  onConfirm,
}) => {
  return (
    <div className="text-foreground">
      <div className="mb-2 text-base font-medium">Edit feedback?</div>
      <div className="mb-4 text-sm">
        You can change your previously submitted feedback for this AI result.
      </div>
      <div className="flex justify-end space-x-2">
        <FooterAction.Secondary onClick={hide}>Cancel</FooterAction.Secondary>
        <FooterAction.Primary
          onClick={() => {
            onConfirm();
            hide();
          }}
          className="bg-primary-main"
        >
          Enable Editing
        </FooterAction.Primary>
      </div>
    </div>
  );
};
