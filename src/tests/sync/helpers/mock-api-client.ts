import * as mgmtApi from '@agility/management-sdk';

export interface CapturedSaveCall {
  payloads: any[];
  guid: string;
  locale: string;
}

export interface CapturedSaveModelCall {
  payload: any;
  guid: string;
}

export interface CapturedSaveContainerCall {
  payload: any;
  guid: string;
}

export interface BuiltSuccessItem {
  originalItem: any;
  newItem: { itemID: number; processedItemVersionID: number };
  newId: number;
}

/**
 * Test double for mgmtApi.ApiClient that captures content-method calls and
 * assigns deterministic new content IDs for create operations.
 *
 * Pair with module mocks of `lib/pushers/batch-polling` so processBatches
 * never reaches the real API or polling loop.
 */
export class MockApiClient {
  capturedSaveCalls: CapturedSaveCall[] = [];
  capturedSaveModelCalls: CapturedSaveModelCall[] = [];
  capturedSaveContainerCalls: CapturedSaveContainerCall[] = [];

  private nextNewId: number;
  private nextNewModelId: number;
  private nextNewContainerId: number;

  constructor(opts: { startingNewId?: number; startingNewModelId?: number; startingNewContainerId?: number } = {}) {
    this.nextNewId = opts.startingNewId ?? 9001;
    this.nextNewModelId = opts.startingNewModelId ?? 7001;
    this.nextNewContainerId = opts.startingNewContainerId ?? 8001;
  }

  contentMethods = {
    saveContentItems: jest.fn(async (payloads: any[], guid: string, locale: string, _returnBatchID: boolean) => {
      this.capturedSaveCalls.push({ payloads, guid, locale });
      return [1000 + this.capturedSaveCalls.length];
    }),
  };

  modelMethods = {
    saveModel: jest.fn(async (payload: any, guid: string) => {
      this.capturedSaveModelCalls.push({ payload, guid });
      // Create: payload.id is 0 (stub) → assign new ID
      // Update: payload.id > 0 → echo back same ID
      const id = !payload?.id ? this.nextNewModelId++ : payload.id;
      return { ...payload, id, lastModifiedDate: '2025-05-21T00:00:00.000' };
    }),
  };

  containerMethods = {
    saveContainer: jest.fn(async (payload: any, guid: string, _includeContentDefinition: boolean) => {
      this.capturedSaveContainerCalls.push({ payload, guid });
      // Create: payload.contentViewID === -1 → assign new ID
      // Update: payload.contentViewID > 0 → echo back same ID
      const contentViewID = !payload?.contentViewID || payload.contentViewID < 0 ? this.nextNewContainerId++ : payload.contentViewID;
      return { ...payload, contentViewID, lastModifiedDate: '05/21/2025 12:00AM' };
    }),
  };

  batchMethods = {
    getBatch: jest.fn(),
  };

  /**
   * Build the `successfulItems` array that `extractBatchResults` would
   * normally return. New IDs are assigned to items whose payload had
   * contentID === -1; updates echo back the payload's contentID.
   */
  buildSuccessfulItems(includedItems: any[], payloads: any[]): BuiltSuccessItem[] {
    return includedItems.map((item, idx) => {
      const payload = payloads[idx];
      const incomingId = payload?.contentID;
      const newId = !incomingId || incomingId <= 0 ? this.nextNewId++ : incomingId;
      return {
        originalItem: item,
        newItem: { itemID: newId, processedItemVersionID: 100 },
        newId,
      };
    });
  }

  asApiClient(): mgmtApi.ApiClient {
    return this as unknown as mgmtApi.ApiClient;
  }
}
