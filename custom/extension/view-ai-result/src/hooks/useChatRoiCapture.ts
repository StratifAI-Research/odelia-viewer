import { useEffect } from 'react';
import { eventTarget, metaData, utilities as csUtils } from '@cornerstonejs/core';
import { Enums as ToolEnums } from '@cornerstonejs/tools';
import { RoiRect, toFractionalRect } from '../utils/chatRoi';
import { CHAT_ROI_TOOL_NAME } from '../utils/chatRoiTool';

/** A region the user just finished drawing, in terms the panel can resolve. */
export interface CapturedRoi {
  /** The instance the region was drawn on, if cornerstone could name it. */
  sopInstanceUID: string | null;
  rect: RoiRect;
  annotationUID: string;
}

interface ChatRoiCaptureConfig {
  /** Only listen while the panel is actually asking for a region. */
  enabled: boolean;
  onCaptured: (roi: CapturedRoi) => void;
  /** Called when a drag produced nothing usable, so the panel can say why. */
  onRejected?: (reason: string) => void;
}

/**
 * Turn a finished chat-ROI rectangle into a fractional crop.
 *
 * Subscribed on cornerstone's event target rather than polled: the rectangle only
 * exists once the drag ends, and that is exactly what ANNOTATION_COMPLETED
 * reports.
 *
 * The instance is identified from cornerstone's own metadata, not by parsing the
 * imageId — imageId formats belong to the image loader, and the panel addresses
 * slices by SOPInstanceUID everywhere else, so this keeps one scheme throughout.
 */
export function useChatRoiCapture({
  enabled,
  onCaptured,
  onRejected,
}: ChatRoiCaptureConfig): void {
  useEffect(() => {
    if (!enabled || !eventTarget?.addEventListener) {
      return;
    }
    const completedEvent = ToolEnums?.Events?.ANNOTATION_COMPLETED;
    if (!completedEvent) {
      return;
    }

    const onCompleted = (evt: any) => {
      const drawn = evt?.detail?.annotation;
      // Other tools finish their annotations on the same event; only ours is a
      // chat region, and touching another tool's annotation would be a bug with
      // clinical consequences.
      if (drawn?.metadata?.toolName !== CHAT_ROI_TOOL_NAME) {
        return;
      }

      const imageId = drawn?.metadata?.referencedImageId;
      const worldPoints = drawn?.data?.handles?.points;
      if (!imageId || !Array.isArray(worldPoints) || worldPoints.length === 0) {
        onRejected?.('The region could not be located on the image.');
        return;
      }

      const plane = metaData.get('imagePlaneModule', imageId) as any;
      const columns = Number(plane?.columns);
      const rows = Number(plane?.rows);

      let imagePoints: number[][];
      try {
        imagePoints = worldPoints.map((p: number[]) => csUtils.worldToImageCoords(imageId, p as never) as number[]);
      } catch (_) {
        onRejected?.('The region could not be mapped onto the image.');
        return;
      }

      const rect = toFractionalRect(imagePoints, columns, rows);
      if (!rect) {
        // Most often a click rather than a drag. Saying so beats a region that
        // silently crops to a few pixels of nothing.
        onRejected?.('Drag to draw a region — a click is too small to send.');
        return;
      }

      const general = metaData.get('generalImageModule', imageId) as any;
      onCaptured({
        sopInstanceUID: general?.sopInstanceUID ?? null,
        rect,
        annotationUID: drawn.annotationUID,
      });
    };

    eventTarget.addEventListener(completedEvent, onCompleted);
    return () => eventTarget.removeEventListener(completedEvent, onCompleted);
  }, [enabled, onCaptured, onRejected]);
}
