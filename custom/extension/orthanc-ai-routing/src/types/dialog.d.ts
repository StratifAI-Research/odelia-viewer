declare module '@ohif/ui' {
  export interface DialogAction {
    id: string;
    text: string;
    type: 'primary' | 'secondary';
    onClick: () => void;
  }

  export interface DialogProps {
    header?: string;
    content: string;
    type?: 'warning' | 'error' | 'info';
    actions: DialogAction[];
  }

  export const Dialog: React.ComponentType<DialogProps>;
}
