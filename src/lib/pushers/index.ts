export * from './asset-pusher';
export * from './container-pusher';
export * from './content-item-pusher';
export * from './gallery-pusher';
export * from './model-pusher';
export * from './page-pusher';
export * from './template-pusher';

// Backward compatibility exports
export { pushContainersTwoPass } from './container-pusher-two-pass';

// Wrapper class for backward compatibility with 'new pushContainers()' usage
import { pushContainersTwoPass } from './container-pusher-two-pass';
import { ReferenceMapper } from '../reference-mapper';
import * as mgmtApi from '@agility/management-sdk';

export class pushContainers {
    private apiClient: mgmtApi.ApiClient;
    private referenceMapper: ReferenceMapper;
    private targetGuid: string;
    private apiOptions: mgmtApi.Options;

    constructor(apiClient: mgmtApi.ApiClient, referenceMapper: ReferenceMapper, targetGuid: string, apiOptions?: mgmtApi.Options) {
        this.apiClient = apiClient;
        this.referenceMapper = referenceMapper;
        this.targetGuid = targetGuid;
        // Use provided options or create basic options from apiClient configuration
        this.apiOptions = apiOptions || {
            token: (apiClient as any)._options?.token || '',
            baseUrl: (apiClient as any)._options?.baseUrl || 'https://mgmt.aglty.io',
            refresh_token: (apiClient as any)._options?.refresh_token || '',
            duration: (apiClient as any)._options?.duration || 300000,
            retryCount: (apiClient as any)._options?.retryCount || 3
        };
    }

    async pushContainers(containers: any[], progressCallback?: (processed: number, total: number, status?: 'success' | 'error') => void) {
        // Use the actual implementation with proper API options
        return await pushContainersTwoPass(containers, this.apiOptions, this.targetGuid, this.referenceMapper, progressCallback);
    }
} 