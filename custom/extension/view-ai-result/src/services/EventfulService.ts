/**
 * Minimal subscribe/publish base shared by AIResultsService and ChatService.
 *
 * Both services had their own byte-for-byte-equivalent copy of this. It is
 * deliberately *not* `@ohif/core`'s `PubSubService`, which every upstream
 * service extends, for two reasons specific to these two:
 *
 *   - `PubSubService._broadcastEvent` has no try/catch, so one throwing
 *     subscriber silently starves every later one. Both services are consumed
 *     by React panels where that would surface as a pane that stops updating,
 *     and ChatService has a regression test pinning the isolation.
 *   - `_broadcastEvent` also dispatches a `CustomEvent` on `document.body` for
 *     every publish. ChatService publishes once per streamed token, so that is
 *     a DOM event per token for a listener set nobody outside this extension
 *     subscribes to.
 *
 * Prefer `PubSubService` for anything that needs to interoperate with OHIF's
 * event plumbing; this exists for services that only talk to their own panels.
 */
export class EventfulService<TEvent extends string = string> {
  private eventListeners = new Map<TEvent, Array<(data: any) => void>>();

  /** Subscribe to an event. Returns the handle OHIF services conventionally return. */
  subscribe(eventName: TEvent, callback: (data: any) => void): { unsubscribe: () => void } {
    const listeners = this.eventListeners.get(eventName) ?? [];
    listeners.push(callback);
    this.eventListeners.set(eventName, listeners);

    return {
      unsubscribe: () => {
        const current = this.eventListeners.get(eventName);
        if (!current) {
          return;
        }
        const index = current.indexOf(callback);
        if (index > -1) {
          current.splice(index, 1);
        }
      },
    };
  }

  /**
   * Notify subscribers. A listener that throws is logged and skipped so the
   * rest still run — see the class comment.
   */
  protected publish(eventName: TEvent, data: any): void {
    // Iterate a copy: a listener may unsubscribe itself (or another) while the
    // notification is in flight, which would otherwise shift the live array.
    const listeners = this.eventListeners.get(eventName);
    if (!listeners) {
      return;
    }
    [...listeners].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for ${eventName}:`, error);
      }
    });
  }

  /** Drop every subscription. Call from the owning service's destroy/cleanup. */
  protected clearListeners(): void {
    this.eventListeners.clear();
  }
}
