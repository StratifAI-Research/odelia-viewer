import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSelectionStep } from './ModelSelectionStep';
import { AI_ENDPOINT } from '../../test-utils/harness';

// AIEndpointConfig is heavy (Tier D); stub it so this step tests its own logic.
jest.mock('../AIEndpointConfig', () => ({
  __esModule: true,
  default: () => <div data-testid="endpoint-config" />,
}));

const manifest = {
  model_id: 'm',
  model_name: 'BrainModel',
  version: '2.0',
  input_configurations: [{ id: 'c1', name: 'T1+T2', inputs: [] }],
};

function makeService(over: Record<string, any> = {}) {
  return {
    getModelManifest: jest.fn().mockResolvedValue(manifest),
    clearManifestCache: jest.fn(),
    ...over,
  };
}

const base = () => ({
  orthancAIService: makeService() as any,
  currentEndpoint: AI_ENDPOINT,
  onEndpointChange: () => {},
  manifest: null as any,
  onManifestLoaded: jest.fn(),
  onNext: () => {},
});

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('ModelSelectionStep', () => {
  it('fetches the manifest on mount and reports it upward', async () => {
    const props = base();
    render(<ModelSelectionStep {...props} />);
    await waitFor(() => expect(props.orthancAIService.getModelManifest).toHaveBeenCalledWith(AI_ENDPOINT.url));
    expect(props.onManifestLoaded).toHaveBeenCalledWith(manifest);
  });

  it('enables Next once the manifest check completes', async () => {
    render(<ModelSelectionStep {...base()} />);
    await waitFor(() => expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false));
  });

  it('renders the manifest summary when a manifest prop is present', async () => {
    const props = base();
    const { rerender } = render(<ModelSelectionStep {...props} />);
    await waitFor(() => expect(props.onManifestLoaded).toHaveBeenCalled());
    rerender(<ModelSelectionStep {...props} manifest={manifest} />);
    expect(screen.getByText('BrainModel')).toBeTruthy();
    expect(screen.getByText('Version: 2.0')).toBeTruthy();
  });

  it('shows a "no input specification" note when the model has no manifest', async () => {
    render(<ModelSelectionStep {...base()} orthancAIService={makeService({ getModelManifest: jest.fn().mockResolvedValue(null) }) as any} />);
    await waitFor(() => expect(screen.getByText(/No input specification/)).toBeTruthy());
  });

  it('surfaces a manifest fetch failure', async () => {
    const props = base();
    render(
      <ModelSelectionStep
        {...props}
        orthancAIService={makeService({ getModelManifest: jest.fn().mockRejectedValue(new Error('x')) }) as any}
      />
    );
    await waitFor(() => expect(screen.getByText('Failed to fetch model configuration')).toBeTruthy());
    expect(props.onManifestLoaded).toHaveBeenCalledWith(null);
  });

  it('renders an error banner from the error prop', () => {
    render(<ModelSelectionStep {...base()} error="upstream error" />);
    expect(screen.getByText('upstream error')).toBeTruthy();
  });

  it('fires onNext', async () => {
    const onNext = jest.fn();
    render(<ModelSelectionStep {...base()} onNext={onNext} />);
    await waitFor(() => expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false));
    fireEvent.click(screen.getByText(/Next/));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
