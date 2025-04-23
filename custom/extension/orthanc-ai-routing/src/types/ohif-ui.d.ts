import { DialogAction } from '@ohif/ui';

declare module '@ohif/ui' {
  export const Button: React.ComponentType<any>;
  export const LoadingIndicatorProgress: React.ComponentType<any>;

  export interface DialogProps {
    title?: string;
    text: string;
    onClose?: () => void;
    noCloseButton?: boolean;
    actions: DialogAction[];
    onSubmit: () => void;
    header?: React.ComponentType<any>;
    body?: React.ComponentType<any>;
    footer?: React.ComponentType<any>;
    value?: Record<string, any>;
    onShow?: () => void;
  }

  export const Dialog: React.FC<DialogProps>;
  // Add other components as needed
}

// Add types for ohif-ui-next
declare module '@ohif/ui-next' {
  export interface DialogProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: React.ReactNode;
    isDraggable?: boolean;
    shouldCloseOnEsc?: boolean;
    shouldCloseOnOverlayClick?: boolean;
    showOverlay?: boolean;
  }

  export interface DialogContentProps {
    children?: React.ReactNode;
    className?: string;
    unstyled?: boolean;
  }

  export interface DialogHeaderProps {
    children?: React.ReactNode;
    className?: string;
  }

  export interface DialogFooterProps {
    children?: React.ReactNode;
    className?: string;
  }

  export interface DialogTitleProps {
    children?: React.ReactNode;
    className?: string;
  }

  export interface DialogDescriptionProps {
    children?: React.ReactNode;
    className?: string;
  }

  export const Dialog: React.FC<DialogProps>;
  export const DialogContent: React.FC<DialogContentProps>;
  export const DialogHeader: React.FC<DialogHeaderProps>;
  export const DialogFooter: React.FC<DialogFooterProps>;
  export const DialogTitle: React.FC<DialogTitleProps>;
  export const DialogDescription: React.FC<DialogDescriptionProps>;
}
