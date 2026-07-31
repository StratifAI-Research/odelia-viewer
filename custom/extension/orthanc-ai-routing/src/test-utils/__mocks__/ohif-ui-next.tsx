// Jest stub for @ohif/ui-next (symlinked raw source; not transpiled by default).
// Exports the symbols the extension imports: Button, Input/Label, the Select and
// Dialog families, and the useViewportGrid / useImageViewer context hooks (3.13
// moved the hooks here from @ohif/ui).
import React from 'react';

const Pass = ({ children, ...rest }: any) => <div {...rest}>{children}</div>;

export const Button = ({ children, onClick, disabled, ...rest }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    {...rest}
  >
    {children}
  </button>
);

export const Input = (props: any) => <input {...props} />;

export const Label = ({ children, htmlFor, ...rest }: any) => (
  <label
    htmlFor={htmlFor}
    {...rest}
  >
    {children}
  </label>
);

// The real Select is a Radix listbox; collapsing it to a native <select> keeps
// the accessible role ("combobox") and the value semantics that tests drive,
// without pulling the popper/portal machinery into jsdom.
const SELECT_ITEM = 'ui-next-select-item';
const SELECT_VALUE = 'ui-next-select-value';

function collect(node: React.ReactNode, displayName: string, out: any[] = []): any[] {
  React.Children.forEach(node, (child: any) => {
    if (!React.isValidElement(child)) {
      return;
    }
    if ((child.type as any)?.displayName === displayName) {
      out.push(child);
    } else {
      collect((child.props as any)?.children, displayName, out);
    }
  });
  return out;
}

export const Select = ({ value, onValueChange, disabled, children }: any) => {
  const placeholder = collect(children, SELECT_VALUE)[0]?.props?.placeholder;
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onValueChange?.(e.target.value)}
    >
      {placeholder !== undefined && (
        <option
          value=""
          disabled
        >
          {placeholder}
        </option>
      )}
      {collect(children, SELECT_ITEM).map((item: any) => (
        <option
          key={item.props.value}
          value={item.props.value}
        >
          {item.props.children}
        </option>
      ))}
    </select>
  );
};

export const SelectTrigger = ({ children }: any) => <>{children}</>;
export const SelectContent = ({ children }: any) => <>{children}</>;
export const SelectItem = ({ children }: any) => <>{children}</>;
SelectItem.displayName = SELECT_ITEM;
export const SelectValue = () => null;
SelectValue.displayName = SELECT_VALUE;

// Faithful to the real (radix) Dialog: content only renders when `open`.
export const Dialog = ({ open, children }: any) => (open ? <div>{children}</div> : null);
export const DialogContent = Pass;
export const DialogHeader = Pass;
export const DialogFooter = Pass;
export const DialogTitle = Pass;
export const DialogDescription = Pass;

export const Icons = new Proxy({} as Record<string, any>, {
  get: (_target, name: string) => () => <span data-testid={`icon-${name}`} />,
});

export const useViewportGrid = () => [{ activeViewportId: 'v1', viewports: new Map() }, {}];

export const useImageViewer = () => ({ StudyInstanceUIDs: [] as string[] });
