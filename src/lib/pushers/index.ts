export * from './asset-pusher';
export * from './container-pusher';
export * from './content-item-pusher';
export * from './gallery-pusher';
export * from './model-pusher';
export * from './page-pusher';
export * from './template-pusher';

// Note: pushContainersTwoPass removed - use pushContainers class below instead
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
        // Use the regular ContainerPusher implementation
        const { ContainerPusher } = await import('./container-pusher');
        const containerPusher = new ContainerPusher({
            referenceMapper: this.referenceMapper,
            apiClient: this.apiClient,
            targetGuid: this.targetGuid
        });
        
        await containerPusher.process(containers);
        
        // Return compatible format for compatibility
        return {
            successfulContainers: containers.length,
            failedContainers: 0
        };
    }
} 