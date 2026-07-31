import { useEffect, useState, Dispatch, SetStateAction } from 'react';
import debounce from 'lodash.debounce';

/**
 * Subscribe to MeasurementService add/update/remove/clear events and keep a mapped,
 * debounced snapshot of the measurements to display. Shared by PanelLabeling and
 * PanelLesions — their subscription wiring was byte-identical; only the
 * `getMappedMeasurements` projection differs (labels pass-through vs lesion mapping),
 * so it is injected. Returns a `[measurements, setMeasurements]` tuple; the setter lets
 * callers (e.g. PanelLesions' active-row toggle) update the snapshot directly.
 */
export function useMeasurementSubscription<T = any>(
  measurementService: AppTypes.MeasurementService,
  getMappedMeasurements: (service: AppTypes.MeasurementService) => T[]
): [T[], Dispatch<SetStateAction<T[]>>] {
  const [displayMeasurements, setDisplayMeasurements] = useState<T[]>([]);

  useEffect(() => {
    const debouncedSetDisplayMeasurements = debounce(setDisplayMeasurements, 100);
    // ~~ Initial
    setDisplayMeasurements(getMappedMeasurements(measurementService));

    // ~~ Subscription
    const added = measurementService.EVENTS.MEASUREMENT_ADDED;
    const addedRaw = measurementService.EVENTS.RAW_MEASUREMENT_ADDED;
    const updated = measurementService.EVENTS.MEASUREMENT_UPDATED;
    const removed = measurementService.EVENTS.MEASUREMENT_REMOVED;
    const cleared = measurementService.EVENTS.MEASUREMENTS_CLEARED;
    const subscriptions: any[] = [];

    [added, addedRaw, updated, removed, cleared].forEach(evt => {
      subscriptions.push(
        measurementService.subscribe(evt, () => {
          debouncedSetDisplayMeasurements(getMappedMeasurements(measurementService));
        }).unsubscribe
      );
    });

    return () => {
      subscriptions.forEach(unsub => {
        unsub();
      });
      debouncedSetDisplayMeasurements.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [displayMeasurements, setDisplayMeasurements];
}
