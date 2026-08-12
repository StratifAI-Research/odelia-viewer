import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@ohif/ui-next';
import AIEndpointConfig, { AIEndpoint } from '../AIEndpointConfig';
import OrthancAIService from '../../services/OrthancAIService';
import type { ModelManifest } from '../../services/OrthancAIService';
import { ErrorMessage } from '../LoadingStates';

interface ModelSelectionStepProps {
  orthancAIService: OrthancAIService;
  currentEndpoint: AIEndpoint | null;
  onEndpointChange: (endpoint: AIEndpoint) => void;
  manifest: ModelManifest | null;
  onManifestLoaded: (manifest: ModelManifest | null) => void;
  onNext: () => void;
  error?: string | null;
}

export const ModelSelectionStep: React.FC<ModelSelectionStepProps> = ({
  orthancAIService,
  currentEndpoint,
  onEndpointChange,
  manifest,
  onManifestLoaded,
  onNext,
  error,
}) => {
  /**
   * The manifest lookup, as ONE state that always names the endpoint it
   * describes.
   *
   * This was three independent flags — `isLoadingManifest`, `manifestChecked`,
   * `manifestError` — and none of them recorded WHICH endpoint they were about.
   * That is representable-but-wrong state, and it was reachable: the panel can
   * change the endpoint from the gear on any step, and closing the gear bumps
   * `settingsKey`, which remounts this step. Between those, "checked for model
   * A" could be read as "checked for model B", leaving Next enabled with a null
   * manifest — the flat send with no `input_mapping` and no
   * `input_configuration_id`, which is exactly the defect this component exists
   * to prevent. Pairing the status with its endpoint makes that unrepresentable.
   */
  type Lookup =
    | { status: 'idle' }
    | { status: 'loading'; endpoint: AIEndpoint }
    | { status: 'available'; endpoint: AIEndpoint }
    | { status: 'absent'; endpoint: AIEndpoint }
    | { status: 'failed'; endpoint: AIEndpoint; reason: string };

  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });

  const sameEndpoint = (a: AIEndpoint | null, b: AIEndpoint | null) =>
    !!a && !!b && a.id === b.id && a.url === b.url;

  /** Describes the endpoint selected right now, rather than some earlier one. */
  const describesCurrent = lookup.status !== 'idle' && sameEndpoint(lookup.endpoint, currentEndpoint);

  // Every fetch is stamped; only the newest may write state. Two lookups can be
  // in flight at once (endpoint changed mid-request, or a remount raced the
  // instance it replaced), and without this an older, slower answer could land
  // last and overwrite a newer one — including overwriting the parent's manifest
  // with null after a good one had arrived.
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchManifest = useCallback(
    async (endpoint: AIEndpoint) => {
      const seq = ++requestSeq.current;
      const isCurrent = () => mounted.current && requestSeq.current === seq;

      setLookup({ status: 'loading', endpoint });
      try {
        const result = await orthancAIService.getModelManifest(endpoint.url);
        if (!isCurrent()) {
          return;
        }

        if (result.status === 'failed') {
          // NOT a settled check. A failure means we do not know what this model
          // wants, so the wizard must not advance: proceeding would send the
          // study with no `input_mapping` and no `input_configuration_id`, which
          // for MST means the backend picks the pre/post/subtraction roles itself
          // and returns a normal-looking result computed on the wrong inputs.
          // This used to be indistinguishable from a model that genuinely
          // publishes no specification, and was silently allowed.
          setLookup({ status: 'failed', endpoint, reason: result.reason });
          onManifestLoaded(null);
          return;
        }

        setLookup({ status: result.status, endpoint });
        onManifestLoaded(result.status === 'available' ? result.manifest : null);
      } catch (err) {
        if (!isCurrent()) {
          return;
        }
        // getModelManifest reports failures in its return value, so reaching
        // here means something unforeseen. Treated as a failure, not an absence.
        console.error('Error fetching manifest:', err);
        setLookup({ status: 'failed', endpoint, reason: 'Failed to fetch model configuration' });
        onManifestLoaded(null);
      }
    },
    [orthancAIService, onManifestLoaded]
  );

  const retryManifest = useCallback(() => {
    if (currentEndpoint) {
      orthancAIService.clearManifestCache();
      fetchManifest(currentEndpoint);
    }
  }, [currentEndpoint, orthancAIService, fetchManifest]);

  /**
   * Look the manifest up whenever what we hold does not describe the endpoint
   * selected now.
   *
   * Driven by the SELECTION rather than by a change handler, because this step
   * is not the only thing that can change the endpoint: the gear in the panel
   * header does it too, on any step. Reacting to the selection means the step is
   * correct no matter who moved it — and invalidating everything downstream
   * stays the panel's single responsibility (AIRoutingPanel.handleEndpointChange)
   * instead of being duplicated in two handlers that can drift apart, which is
   * what produced the stale-manifest defect in the first place.
   *
   * `failed` counts as describing the endpoint: it must NOT re-trigger, or the
   * fetch would fire again the moment `loading` clears — an unbounded retry loop
   * against an endpoint that is already failing. Recovery is the explicit Retry.
   *
   * Endpoints are compared on id AND url. Two may point at the same target_url
   * under different names, and the panel clears the manifest on ANY endpoint
   * change, so matching on the url alone would leave this step reporting a
   * settled check with a null manifest — "No input specification available for
   * this model" for a model that has one, with Next enabled. The service caches
   * by url, so the re-ask is a cache hit.
   */
  useEffect(() => {
    if (!currentEndpoint || describesCurrent) {
      return;
    }
    fetchManifest(currentEndpoint);
  }, [currentEndpoint, describesCurrent, fetchManifest]);

  const isLoadingManifest = lookup.status === 'loading';
  const manifestError = describesCurrent && lookup.status === 'failed' ? lookup.reason : null;
  // Settled for THIS endpoint. `describesCurrent` is the part that matters: a
  // check that settled for a different endpoint must never enable Next.
  const manifestChecked =
    describesCurrent && (lookup.status === 'available' || lookup.status === 'absent');

  const canProceed = !!currentEndpoint && manifestChecked;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        {(error || manifestError) && <ErrorMessage>{error || manifestError}</ErrorMessage>}

        {manifestError && (
          <div className="bg-muted space-y-2 rounded p-3 text-xs">
            <div className="text-muted-foreground">
              The model&apos;s input specification could not be read, so this study cannot be sent
              yet — sending now would let the server choose the input roles itself.
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={retryManifest}
              disabled={isLoadingManifest}
            >
              Retry
            </Button>
          </div>
        )}

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Select AI Model</h4>
          <AIEndpointConfig
            onEndpointChange={onEndpointChange}
            currentEndpoint={currentEndpoint}
            compact
          />
        </div>

        {isLoadingManifest && (
          <div className="bg-muted text-muted-foreground rounded p-3 text-xs">
            <div className="flex items-center space-x-2">
              <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
              <span>Fetching model configuration...</span>
            </div>
          </div>
        )}

        {describesCurrent && lookup.status === 'available' && manifest && (
          <div className="bg-muted space-y-2 rounded p-3 text-sm">
            <div className="text-foreground font-medium">{manifest.model_name}</div>
            <div className="text-muted-foreground space-y-1 text-xs">
              <div>Version: {manifest.version}</div>
              <div>Input modes: {manifest.input_configurations.map(c => c.name).join(', ')}</div>
            </div>
          </div>
        )}

        {/* Driven by THIS step's own answer for the endpoint on screen, not by
            `!manifest`. The prop is the parent's copy, so it reads as null both
            when the model has no specification and while a freshly-loaded one is
            still on its way back down — and the two must not look alike. It also
            only ever says "no specification" when we actually established that,
            never when the lookup failed. */}
        {describesCurrent && lookup.status === 'absent' && (
          <div className="bg-muted space-y-1 rounded p-3 text-sm">
            <div className="text-muted-foreground text-xs">
              No input specification available for this model.
            </div>
          </div>
        )}
      </div>

      <div className="border-input bg-background flex-shrink-0 border-t px-3 py-3">
        <Button
          onClick={onNext}
          disabled={!canProceed}
          className="w-full"
        >
          {manifest ? 'Next: Select Input Mode \u2192' : 'Next: Select Series \u2192'}
        </Button>
      </div>
    </div>
  );
};
