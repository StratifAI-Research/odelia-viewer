import React from 'react';
const Pass =
  (tid: string) =>
  ({ children }: any) => <div data-testid={tid}>{children}</div>;
export const FooterAction = Object.assign(Pass('footer-action'), {
  Right: Pass('footer-action-right'),
  Left: Pass('footer-action-left'),
});
export const Separator = () => <hr data-testid="separator" />;

export const Button = ({ children, ...rest }: any) => <button {...rest}>{children}</button>;
export const Input = (props: any) => <input {...props} />;
export const Label = ({ children, ...rest }: any) => <label {...rest}>{children}</label>;

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
// StudyBrowser stub: surfaces tab names + thumbnail UIDs as clickable elements so
// tests can drive onClickTab / onClickThumbnail / onDoubleClickThumbnail handlers.
export const StudyBrowser = (props: any) => {
  const tabs = props?.tabs || [];
  // Render thumbnails for the active tab only (as the real browser does),
  // keeping testids unique across tabs that share display sets (e.g. "all").
  const activeTab = tabs.find((t: any) => t.name === props?.activeTabName) || tabs[0];
  const thumbs: any[] = [];
  (activeTab?.studies || []).forEach((study: any) =>
    (study.displaySets || []).forEach((ds: any) => thumbs.push(ds))
  );
  return (
    <div
      data-testid="study-browser"
      data-count={tabs.length}
      data-active-tab={props?.activeTabName}
    >
      {tabs.map((tab: any) => (
        <button
          key={tab.name}
          data-testid={`sb-tab-${tab.name}`}
          onClick={() => props?.onClickTab?.(tab.name)}
        >
          {tab.label || tab.name}
        </button>
      ))}
      {thumbs.map((ds: any) => (
        <div
          key={ds.displaySetInstanceUID}
          data-testid={`sb-thumb-${ds.displaySetInstanceUID}`}
        >
          <button
            data-testid={`sb-thumb-click-${ds.displaySetInstanceUID}`}
            onClick={() => props?.onClickThumbnail?.(ds.displaySetInstanceUID)}
          />
          <button
            data-testid={`sb-thumb-dblclick-${ds.displaySetInstanceUID}`}
            onClick={() => props?.onDoubleClickThumbnail?.(ds.displaySetInstanceUID)}
          />
        </div>
      ))}
    </div>
  );
};
export const StudyBrowserViewOptions = Pass('study-browser-view-options');
export const StudyBrowserSort = Pass('study-browser-sort');
export const ThumbnailList = (props: any) => (
  <div
    data-testid="thumbnail-list"
    data-count={props?.thumbnails?.length}
  />
);
export const Accordion = Pass('accordion');
export const AccordionItem = Pass('accordion-item');
export const AccordionTrigger = Pass('accordion-trigger');
export const AccordionContent = Pass('accordion-content');
export const Icons = new Proxy({}, { get: () => () => <span data-testid="icon" /> });
// Mirrors the real ToolButton's DOM contract: the tool state lives on the
// tooltip-trigger span (data-cy/data-tool/data-active/data-toggled) and the
// click target is a plain <button> that is inert while disabled.
export const ToolButton = ({
  id,
  label,
  isActive = false,
  isToggled = false,
  disabled = false,
  onInteraction,
  children,
}: any) => (
  <span
    data-testid={id}
    data-cy={id}
    data-tool={id}
    data-active={String(isActive)}
    data-toggled={String(isToggled)}
  >
    <button
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onInteraction?.({ itemId: id })}
    >
      {children}
    </button>
  </span>
);
// 3.13 moved these context hooks out of @ohif/ui into @ohif/ui-next.
export const useImageViewer = () => ({ StudyInstanceUIDs: [] as string[] });
export const useUserAuthentication = () => [{ user: null }, { getAuthorizationHeader: () => ({}) }];
// Grid state a test can steer. Some panels read the active viewport's display
// sets (e.g. to tell which series is on screen), so the map has to be settable
// rather than permanently empty.
export const __viewportGridState: { activeViewportId: string | null; viewports: Map<string, any> } =
  { activeViewportId: 'v1', viewports: new Map() };

export const setMockViewportGrid = (
  state: Partial<{ activeViewportId: string | null; viewports: Map<string, any> }>
) => Object.assign(__viewportGridState, state);

export const resetMockViewportGrid = () => {
  __viewportGridState.activeViewportId = 'v1';
  __viewportGridState.viewports = new Map();
};

export const useViewportGrid = () => [__viewportGridState, { setActiveViewportId: jest.fn() }];

// Toolbar evaluators style toggled buttons with this, so it has to exist here too. Kept
// behaviourally faithful (the real one returns '!text-primary' when on) rather than a stub, so a
// test can assert the on/off distinction.
export const utils = {
  getToggledClassName: (isToggled: boolean) =>
    isToggled ? '!text-primary' : '!text-foreground/80 hover:!bg-muted hover:text-highlight',
};
