import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../utilities/reference-mapper";

export async function findAssetInTargetInstance(
    asset: mgmtApi.Media,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Media | null> {
    try {
        // Check mapper cache first (fast)
        const mapping = referenceMapper.getMapping<mgmtApi.Media>('asset', asset.mediaID);
        if (mapping) {
            return mapping;
        }

        // Check by originUrl as well (alternative identifier)
        const urlMapping = referenceMapper.getMapping<mgmtApi.Media>('asset', asset.originUrl);
        if (urlMapping) {
            return urlMapping;
        }

        // Not in cache - check target instance via API
        try {
            const mediaList = await apiClient.assetMethods.getMediaList(1000, 0, targetGuid);
            const existingAsset = mediaList.assetMedias?.find((a: any) => 
                a.fileName === asset.fileName ||
                a.originUrl === asset.originUrl ||
                a.edgeUrl === asset.originUrl ||
                a.url === asset.originUrl
            );

            if (existingAsset) {
                // Add to mapper for future reference and return
                referenceMapper.addRecord('asset', asset, existingAsset);
                return existingAsset;
            }

            return null;

        } catch (apiError) {
            // If API call fails, assume asset doesn't exist
            return null;
        }

    } catch (error: any) {
        if (error.response && error.response.status === 404) {
            return null;
        }
        throw error;
    }
}
