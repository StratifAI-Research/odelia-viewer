import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ModelSelectionStep } from './ModelSelectionStep';
import { AI_ENDPOINT } from '../../test-utils/harness';

// AIEndpointConfig is heavy (Tier D); stub it so this step tests its own logic.
// The stub captures the onEndpointChange prop (accessed only at render time, so
// no TDZ on the mock-prefixed holder) so the cache-clear/refetch path is testable.
const mockEndpointConfig: { onEndpointChange?: (ep: any) => void } = {};
jest.mock('../AIEndpointConfig', () => ({
  __esModule: true,
  default: ({ onEndpointChange }: any) => {
    mockEndpointConfig.onEndpointChange = onEndpointChange;
    return <div data-testid="endpoint-config" />;
  },
}));

const manifest = {
  model_id: 'm',
  model_name: 'BrainModel',
  version: '2.0',
  input_configurations: [{ id: 'c1', name: 'T1+T2', inputs: [] }],
};

const AVAILABLE = { status: 'available', manifest } as const;
const ABSENT = { status: 'absent' } as const;
const failed = (reason: string) => ({ status: 'failed', reason }) as const;

function makeService(over: Record<string, any> = {}) {
  return {
    getModelManifest: jest.fn().mockResolvedValue(AVAILABLE),
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

/**
 * Wait until the component has finished its manifest check and COMMITTED it.
 *
 * Necessary rather than fussy: `waitFor(onManifestLoaded called)` resolves on the
 * callback, which fires before React commits `manifestChecked`. A test that
 * re-rendered at that point re-ran the lookup because the step was still
 * unsettled, not because the endpoint changed — so it passed against a step that
 * ignores the endpoint entirely. Next going enabled is the observable proof that
 * `manifestChecked` is true and `isLoadingManifest` is false.
 */
const settled = () =>
  waitFor(() => expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false));

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('ModelSelectionStep', () => {
  it('fetches the manifest on mount and reports it upward', async () => {
    const props = base();
    render(<ModelSelectionStep {...props} />);
    await waitFor(() =>
      expect(props.orthancAIService.getModelManifest).toHaveBeenCalledWith(AI_ENDPOINT.url)
    );
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
    rerender(
      <ModelSelectionStep
        {...props}
        manifest={manifest}
      />
    );
    expect(screen.getByText('BrainModel')).toBeTruthy();
    expect(screen.getByText('Version: 2.0')).toBeTruthy();
  });

  it('shows a "no input specification" note when the model has no manifest', async () => {
    render(
      <ModelSelectionStep
        {...base()}
        orthancAIService={
          makeService({ getModelManifest: jest.fn().mockResolvedValue(ABSENT) }) as any
        }
      />
    );
    await waitFor(() => expect(screen.getByText(/No input specification/)).toBeTruthy());
  });

  it('still lets a genuinely manifest-free model proceed to flat series selection', async () => {
    render(
      <ModelSelectionStep
        {...base()}
        orthancAIService={
          makeService({ getModelManifest: jest.fn().mockResolvedValue(ABSENT) }) as any
        }
      />
    );
    await waitFor(() => expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false));
  });

  it('surfaces a manifest fetch failure', async () => {
    const props = base();
    render(
      <ModelSelectionStep
        {...props}
        orthancAIService={
          makeService({ getModelManifest: jest.fn().mockRejectedValue(new Error('x')) }) as any
        }
      />
    );
    await waitFor(() =>
      expect(screen.getByText('Failed to fetch model configuration')).toBeTruthy()
    );
    expect(props.onManifestLoaded).toHaveBeenCalledWith(null);
  });

  /**
   * The defect: `getModelManifest` answered `null` for a 502 and for a model
   * that genuinely has no specification, so the panel showed the same
   * "No input specification available" note either way and let the reader send.
   * `handleSendToAI` then posted a bare series list with no `input_mapping` and
   * no `input_configuration_id`, and MST assigned the roles itself — a
   * normal-looking result computed on the wrong inputs.
   */
  describe('a transport failure is not an absent manifest', () => {
    const failing = () =>
      makeService({
        getModelManifest: jest.fn().mockResolvedValue(failed('The AI router answered 502')),
      });

    it('shows the real reason instead of "No input specification"', async () => {
      render(
        <ModelSelectionStep
          {...base()}
          orthancAIService={failing() as any}
        />
      );

      await waitFor(() => expect(screen.getByText(/answered 502/)).toBeTruthy());
      expect(screen.queryByText(/No input specification/)).toBeNull();
    });

    it('blocks Next, so the study cannot be sent without its role mapping', async () => {
      render(
        <ModelSelectionStep
          {...base()}
          orthancAIService={failing() as any}
        />
      );

      await waitFor(() => expect(screen.getByText(/answered 502/)).toBeTruthy());
      expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(true);
    });

    it('does not retry in a loop while the endpoint stays broken', async () => {
      const service = failing();
      render(
        <ModelSelectionStep
          {...base()}
          orthancAIService={service as any}
        />
      );

      await waitFor(() => expect(screen.getByText(/answered 502/)).toBeTruthy());
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(service.getModelManifest).toHaveBeenCalledTimes(1);
    });

    it('recovers through Retry, which clears the cache and re-asks', async () => {
      const getModelManifest = jest
        .fn()
        .mockResolvedValueOnce(failed('The AI router answered 502'))
        .mockResolvedValue(AVAILABLE);
      const service = makeService({ getModelManifest });
      const props = { ...base(), orthancAIService: service as any };

      render(<ModelSelectionStep {...props} />);
      await waitFor(() => expect(screen.getByText(/answered 502/)).toBeTruthy());

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false));
      expect(service.clearManifestCache).toHaveBeenCalled();
      expect(props.onManifestLoaded).toHaveBeenCalledWith(manifest);
    });
  });

  it('reports an endpoint change upward rather than invalidating on its own', async () => {
    // Cache-clearing and downstream invalidation belong to the panel now — it is
    // the only place that sees BOTH entry points (this step and the header gear).
    // All this step owes is to forward the selection.
    const onEndpointChange = jest.fn();
    const props = { ...base(), onEndpointChange };
    render(<ModelSelectionStep {...props} />);
    await waitFor(() => expect(props.onManifestLoaded).toHaveBeenCalledWith(manifest));

    const newEndpoint = { id: 'ep-2', name: 'other', url: 'http://other:8042/dicom-web' };
    await act(async () => {
      mockEndpointConfig.onEndpointChange!(newEndpoint);
    });

    expect(onEndpointChange).toHaveBeenCalledWith(newEndpoint);
  });

  /**
   * The step re-reads the manifest because the SELECTED ENDPOINT changed, not
   * because a particular handler ran. That matters: the gear in the panel header
   * can change the endpoint on any step, including this one, without going
   * through this component's own dropdown. Keying the lookup on a change handler
   * left the step showing the previous model's answer for the new endpoint.
   */
  it('re-reads the manifest when the endpoint prop changes, whoever changed it', async () => {
    const props = base();
    const { rerender } = render(<ModelSelectionStep {...props} />);
    await settled();
    (props.orthancAIService.getModelManifest as jest.Mock).mockClear();

    const newEndpoint = { id: 'ep-2', name: 'other', url: 'http://other:8042/dicom-web' };
    rerender(
      <ModelSelectionStep
        {...props}
        currentEndpoint={newEndpoint}
      />
    );

    await waitFor(() =>
      expect(props.orthancAIService.getModelManifest).toHaveBeenCalledWith(newEndpoint.url)
    );
  });

  // Two endpoints can point at the same target_url under different names, and the
  // panel clears the manifest on any endpoint change. Keying the lookup on the
  // url alone left this step claiming "No input specification available" — with
  // Next enabled — for a model that has one.
  it('re-reads the manifest for a different endpoint at the SAME url', async () => {
    const props = base();
    const { rerender } = render(<ModelSelectionStep {...props} />);
    await settled();
    (props.orthancAIService.getModelManifest as jest.Mock).mockClear();

    const sameUrlOtherId = { id: 'ep-2', name: 'Same server, other label', url: AI_ENDPOINT.url };
    rerender(
      <ModelSelectionStep
        {...props}
        currentEndpoint={sameUrlOtherId}
      />
    );

    await waitFor(() =>
      expect(props.orthancAIService.getModelManifest).toHaveBeenCalledTimes(1)
    );
  });

  /**
   * Two lookups can be in flight at once — the endpoint changed mid-request, or
   * the gear's `settingsKey` bump remounted this step while its predecessor's
   * request was still open. Nothing serialises them, so the slower answer can
   * land last. If it is allowed to write state, a stale `absent` overwrites a
   * fresh `available`, and Next is enabled for the flat flow against a model
   * that requires a role mapping. That is the original defect, one step along.
   */
  describe('concurrent and out-of-order lookups', () => {
    /** A manual promise per endpoint url, so resolution order is the test's choice. */
    const deferredByUrl = () => {
      const pending = new Map<string, (v: any) => void>();
      const getModelManifest = jest.fn(
        (url: string) => new Promise(resolve => pending.set(url, resolve))
      );
      return { getModelManifest, resolve: (url: string, v: any) => pending.get(url)!(v) };
    };

    it('ignores a slow answer for the endpoint that is no longer selected', async () => {
      const { getModelManifest, resolve } = deferredByUrl();
      const props = { ...base(), orthancAIService: makeService({ getModelManifest }) as any };
      const other = { id: 'ep-2', name: 'B', url: 'http://model-b:8042' };

      const { rerender } = render(<ModelSelectionStep {...props} />);
      await waitFor(() => expect(getModelManifest).toHaveBeenCalledWith(AI_ENDPOINT.url));

      // Switch to B while A is still open, then let B answer first and A last.
      rerender(
        <ModelSelectionStep
          {...props}
          currentEndpoint={other}
        />
      );
      await waitFor(() => expect(getModelManifest).toHaveBeenCalledWith(other.url));

      await act(async () => {
        resolve(other.url, AVAILABLE);
      });
      await act(async () => {
        resolve(AI_ENDPOINT.url, ABSENT);
      });

      // A's late `absent` must not have overwritten B's manifest...
      expect(props.onManifestLoaded).toHaveBeenLastCalledWith(manifest);
      // ...nor left the step advertising a settled check it does not have.
      expect(screen.queryByText(/No input specification/)).toBeNull();
    });

    it('does not enable Next on a check that settled for a different endpoint', async () => {
      const { getModelManifest, resolve } = deferredByUrl();
      const props = { ...base(), orthancAIService: makeService({ getModelManifest }) as any };
      const other = { id: 'ep-2', name: 'B', url: 'http://model-b:8042' };

      const { rerender } = render(<ModelSelectionStep {...props} />);
      await act(async () => {
        resolve(AI_ENDPOINT.url, AVAILABLE);
      });
      await settled();

      // The panel switches the endpoint; B's answer has not arrived yet.
      rerender(
        <ModelSelectionStep
          {...props}
          currentEndpoint={other}
        />
      );

      expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(true);
    });

    it('does not report upward after unmount', async () => {
      const { getModelManifest, resolve } = deferredByUrl();
      const props = { ...base(), orthancAIService: makeService({ getModelManifest }) as any };

      const { unmount } = render(<ModelSelectionStep {...props} />);
      await waitFor(() => expect(getModelManifest).toHaveBeenCalledWith(AI_ENDPOINT.url));
      props.onManifestLoaded.mockClear();

      unmount();
      await act(async () => {
        resolve(AI_ENDPOINT.url, ABSENT);
      });

      expect(props.onManifestLoaded).not.toHaveBeenCalled();
    });
  });

  it('does not re-read the manifest when the endpoint is unchanged', async () => {
    const props = base();
    const { rerender } = render(<ModelSelectionStep {...props} />);
    await settled();

    rerender(<ModelSelectionStep {...props} />);
    await act(async () => {});

    expect(props.orthancAIService.getModelManifest).toHaveBeenCalledTimes(1);
  });

  it('renders an error banner from the error prop', () => {
    render(
      <ModelSelectionStep
        {...base()}
        error="upstream error"
      />
    );
    expect(screen.getByText('upstream error')).toBeTruthy();
  });

  it('fires onNext', async () => {
    const onNext = jest.fn();
    render(
      <ModelSelectionStep
        {...base()}
        onNext={onNext}
      />
    );
    await waitFor(() => expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false));
    fireEvent.click(screen.getByText(/Next/));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
