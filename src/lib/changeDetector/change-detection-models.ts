/**
 * Simple change detection
 */
export interface ChangeDetection {
  entity: any | null;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  reason: string;
}

