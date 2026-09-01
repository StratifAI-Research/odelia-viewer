import { useEffect } from 'react';
import { eventTarget, metaData, utilities as csUtils } from '@cornerstonejs/core';
import { Enums as ToolEnums } from '@cornerstonejs/tools';
import { RoiRect, toFractionalRect } from '../utils/chatRoi';
import { CHAT_ROI_TOOL_NAME } from '../utils/chatRoiTool';

/** A region the user just drew or reshaped, in terms the panel can resolve. */
export interface CapturedRoi {
  /** The instance the region was drawn on, if cornerstone could name it. */
  sopInstanceUID: string | null;
  rect: RoiRect;
  annotationUID: string;
}

interface ChatRoiCaptureConfig {
  /** Accept NEW rectangles only while the panel is asking for one. */
  isDrawing: boolean;
  /** The region the panel currently holds, watched for edits and deletion. */
  trackedAnnotationUID: string | null;
  onCaptured: (roi: CapturedRoi) => void;
  /** The tracked region was reshaped or moved on the image. */
  onUpdated: (roi: CapturedRoi) => void;
  /** The tracked region disappeared from the image (someone else removed it). */
  onRemoved: () => void;
  /** A drag produced nothing usable; the UID is passed so it can be cleaned up. */
  onRejected: (reason: string, annotationUID: string | null) => void;
}

/**
 * Keep the panel's region in step with the rectangle on the image.
 *
 * Three events matter, and leaving any of them out breaks the panel's central
 * promise that what it says is what gets sent:
 *
 *   - COMPLETED: a new rectangle. Accepted only while the panel asked for one.
 *   - MODIFIED: the rectangle was moved or resized. A cornerstone tool left
 *     passive stays editable, so without this the overlay would show one
 *     rectangle while the message carried another.
 *   - REMOVED: the rectangle is gone. It need not be the panel that removed it —
 *     "clear measurements" reaches it too (see `chatRoiTool.ts`) — and cropping
 *     the next message to a region no longer on screen is exactly the silent
 *     disagreement to avoid.
 *
 * The instance is identified from cornerstone's own metadata rather than by
 * parsing the imageId: imageId formats belong to the image loader, and the panel
 * addresses slices by SOPInstanceUID everywhere else.
 */
export function useChatRoiCapture({
  isDrawing,
  trackedAnnotationUID,
  onCaptured,
  onUpdated,
  onRemoved,
  onRejected,
}: ChatRoiCaptureConfig): void {
  useEffect(() => {
    if (!eventTarget?.addEventListener) {
      return;
    }
    const events = ToolEnums?.Events;
    if (!events?.ANNOTATION_COMPLETED) {
      return;
    }

    /** Fractional rectangle for a chat-ROI annotation, or a reason it is not one. */
    const measure = (drawn: any): CapturedRoi | string => {
      const imageId = drawn?.metadata?.referencedImageId;
      const worldPoints = drawn?.data?.handles?.points;
      if (!imageId || !Array.isArray(worldPoints) || worldPoints.length === 0) {
        return 'The region could not be located on the image.';
      }

      const plane = metaData.get('imagePlaneModule', imageId) as any;
      const columns = Number(plane?.columns);
      const rows = Number(plane?.rows);

      let imagePoints: number[][];
      try {
        imagePoints = worldPoints.map(
          (p: number[]) => csUtils.worldToImageCoords(imageId, p as never) as number[]
        );
      } catch (_) {
        return 'The region could not be mapped onto the image.';
      }

      const rect = toFractionalRect(imagePoints, columns, rows);
      if (!rect) {
        // Most often a click rather than a drag. Saying so beats a region that
        // silently crops to a few pixels of nothing.
        return 'Drag to draw a region — a click is too small to send.';
      }

      const general = metaData.get('generalImageModule', imageId) as any;
      return {
        sopInstanceUID: general?.sopInstanceUID ?? null,
        rect,
        annotationUID: drawn.annotationUID,
      };
    };

    /** Only ever act on our own tool: another tool's annotation is not ours to read. */
    const isChatRoi = (drawn: any) => drawn?.metadata?.toolName === CHAT_ROI_TOOL_NAME;

    const onCompleted = (evt: any) => {
      const drawn = evt?.detail?.annotation;
      if (!isChatRoi(drawn) || !isDrawing) {
        return;
      }
      const result = measure(drawn);
      if (typeof result === 'string') {
        onRejected(result, drawn?.annotationUID ?? null);
        return;
      }
      onCaptured(result);
    };

    const onModified = (evt: any) => {
      const drawn = evt?.detail?.annotation;
      if (!isChatRoi(drawn) || drawn?.annotationUID !== trackedAnnotationUID) {
        return;
      }
      const result = measure(drawn);
      // A mid-edit rectangle can momentarily be too small to be usable. Keeping
      // the last good one beats dropping the region under the user's cursor.
      if (typeof result !== 'string') {
        onUpdated(result);
      }
    };

    const onAnnotationRemoved = (evt: any) => {
      const drawn = evt?.detail?.annotation;
      const removedUID = drawn?.annotationUID ?? evt?.detail?.annotationUID;
      if (!trackedAnnotationUID || removedUID !== trackedAnnotationUID) {
        return;
      }
      onRemoved();
    };

    eventTarget.addEventListener(events.ANNOTATION_COMPLETED, onCompleted);
    if (events.ANNOTATION_MODIFIED) {
      eventTarget.addEventListener(events.ANNOTATION_MODIFIED, onModified);
    }
    if (events.ANNOTATION_REMOVED) {
      eventTarget.addEventListener(events.ANNOTATION_REMOVED, onAnnotationRemoved);
    }
    return () => {
      eventTarget.removeEventListener(events.ANNOTATION_COMPLETED, onCompleted);
      if (events.ANNOTATION_MODIFIED) {
        eventTarget.removeEventListener(events.ANNOTATION_MODIFIED, onModified);
      }
      if (events.ANNOTATION_REMOVED) {
        eventTarget.removeEventListener(events.ANNOTATION_REMOVED, onAnnotationRemoved);
      }
    };
  }, [isDrawing, trackedAnnotationUID, onCaptured, onUpdated, onRemoved, onRejected]);
}
