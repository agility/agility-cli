/**
 * Content state definitions from Agility CMS documentation
 * Official state values and their meanings
 */
export const CONTENT_STATES = {
    1: { label: 'Staging', description: 'Content saved but not published - can be previewed', syncable: true, icon: '📝' },
    2: { label: 'Published', description: 'Content live and viewable on website', syncable: true, icon: '✅' },
    3: { label: 'Deleted', description: 'Content marked for deletion', syncable: false, icon: '🗑️' },
    4: { label: 'Approved', description: 'Content reviewed and approved for publishing', syncable: true, icon: '👍' },
    5: { label: 'Awaiting Approval', description: 'Content submitted for review', syncable: true, icon: '⏳' },
    6: { label: 'Declined', description: 'Content review declined - needs changes', syncable: true, icon: '👎' },
    7: { label: 'Unpublished', description: 'Content removed from live site but not deleted', syncable: false, icon: '📴' }
} as const;

/**
 * Helper function to get formatted state information
 */
export function getContentStateInfo(state: number): { label: string; description: string; syncable: boolean; icon: string; formatted: string } {
    const stateInfo = CONTENT_STATES[state as keyof typeof CONTENT_STATES];
    
    if (!stateInfo) {
        return {
            label: 'Unknown',
            description: `Unknown state: ${state}`,
            syncable: false,
            icon: '❓',
            formatted: `${state} (Unknown State)`
        };
    }
    
    return {
        ...stateInfo,
        formatted: `${stateInfo.icon} ${stateInfo.label} (${state})`
    };
}

/**
 * Helper function to categorize state impact on sync
 */
export function getStateSyncImpact(state: number): 'normal' | 'problematic' | 'unsyncable' | 'pending' {
    const stateInfo = CONTENT_STATES[state as keyof typeof CONTENT_STATES];
    
    if (!stateInfo || !stateInfo.syncable) {
        return state === 3 || state === 7 ? 'unsyncable' : 'problematic';
    }
    
    if (state === 5 || state === 6) {
        return 'pending';
    }
    
    return 'normal';
}

/**
 * Entity Reference for relationship tracking
 */
export interface EntityReference {
    sourceType: string;
    sourceId: string | number;
    targetType: string;
    targetId: string | number;
    fieldPath: string;
    relationshipType: string;
}

/**
 * Source Entities structure
 */
export interface SourceEntities {
    content?: any[];
    containers?: any[];
    models?: any[];
    assets?: any[];
    galleries?: any[];
    templates?: any[];
    pages?: any[];
} 