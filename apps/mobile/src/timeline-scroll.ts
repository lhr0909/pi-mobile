export interface TimelineScrollMetrics {
  contentHeight: number;
  layoutHeight: number;
  offsetY: number;
}

export const BOTTOM_STICKINESS_THRESHOLD = 48;

export function distanceFromBottom(metrics: TimelineScrollMetrics): number {
  return Math.max(
    0,
    metrics.contentHeight - metrics.layoutHeight - metrics.offsetY,
  );
}

export function isNearBottom(
  metrics: TimelineScrollMetrics,
  threshold = BOTTOM_STICKINESS_THRESHOLD,
): boolean {
  return distanceFromBottom(metrics) <= threshold;
}

export function nextPinnedToBottom(
  pinnedToBottom: boolean,
  metrics: TimelineScrollMetrics,
  userScrollActive: boolean,
  threshold = BOTTOM_STICKINESS_THRESHOLD,
): boolean {
  if (isNearBottom(metrics, threshold)) {
    return true;
  }

  if (userScrollActive) {
    return false;
  }

  return pinnedToBottom;
}
