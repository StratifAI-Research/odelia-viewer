import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderCornerstoneViewport } from './cornerstoneViewportRenderer';

// Test double for the cornerstone viewport module component: it surfaces the
// props it receives into the DOM so assertions can read real values.
let received: any = null;
const StubViewport = (props: any) => {
  received = props;
  return (
    <div data-testid="viewport">
      <span data-testid="viewport-id">{props.viewportId}</span>
      <span data-testid="viewport-type">{props.viewportOptions.viewportType}</span>
      <span data-testid="tool-group">{props.viewportOptions.toolGroupId}</span>
      <button data-testid="enable" onClick={() => props.onElementEnabled({ ok: true })}>
        enable
      </button>
    </div>
  );
};

const makeProps = (over: any = {}) => ({
  viewportId: 'vp-1',
  displaySets: [{ displaySetInstanceUID: 'ds-1' }],
  viewportOptions: {},
  extensionManager: { getModuleEntry: jest.fn(() => ({ component: StubViewport })) },
  servicesManager: {},
  commandsManager: {},
  onElementEnabled: jest.fn(),
  onElementDisabled: jest.fn(),
  ...over,
});

beforeEach(() => {
  received = null;
});

describe('renderCornerstoneViewport', () => {
  it('resolves the cornerstone viewport module and renders it', () => {
    const props = makeProps();
    render(renderCornerstoneViewport(props as any));
    expect(props.extensionManager.getModuleEntry).toHaveBeenCalledWith(
      '@ohif/extension-cornerstone.viewportModule.cornerstone'
    );
    expect(screen.getByTestId('viewport')).toBeTruthy();
    expect(screen.getByTestId('viewport-id').textContent).toBe('vp-1');
  });

  it('applies default viewportType and toolGroupId when not supplied', () => {
    render(renderCornerstoneViewport(makeProps() as any));
    expect(screen.getByTestId('viewport-type').textContent).toBe('stack');
    expect(screen.getByTestId('tool-group').textContent).toBe('default');
  });

  it('honours caller-supplied viewportType and toolGroupId', () => {
    const props = makeProps({ viewportOptions: { viewportType: 'volume', toolGroupId: 'tg-9' } });
    render(renderCornerstoneViewport(props as any));
    expect(screen.getByTestId('viewport-type').textContent).toBe('volume');
    expect(screen.getByTestId('tool-group').textContent).toBe('tg-9');
  });

  it('forwards core managers and the viewportId into the merged options', () => {
    const servicesManager = { tag: 'svc' };
    const commandsManager = { tag: 'cmd' };
    const props = makeProps({ servicesManager, commandsManager });
    render(renderCornerstoneViewport(props as any));
    expect(received.servicesManager).toBe(servicesManager);
    expect(received.commandsManager).toBe(commandsManager);
    expect(received.viewportOptions.viewportId).toBe('vp-1');
  });

  it('invokes the provided onElementEnabled handler when the element is enabled', () => {
    const onElementEnabled = jest.fn();
    render(renderCornerstoneViewport(makeProps({ onElementEnabled }) as any));
    fireEvent.click(screen.getByTestId('enable'));
    expect(onElementEnabled).toHaveBeenCalledWith({ ok: true });
  });
});
