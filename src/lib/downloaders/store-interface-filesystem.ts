import ansiColors from "ansi-colors"

const fs = require('fs')
const os = require('os')
const path = require('path')
const { lockSync, unlockSync, checkSync, check }  = require("proper-lockfile")
import { sleep } from "../shared/sleep";

const { getState, getLoggerForGuid } = require('../../core/state');
import { Logs } from '../../core/logs';


// RACE CONDITION FIX: Convert global stats to instance-specific stats
// Use rootPath as unique identifier for each concurrent download
const _instanceStats = new Map();

// Type definitions for better TypeScript support
interface ProgressStats {
    totalItems: number;
    itemsByType: { [itemType: string]: number };
    elapsedTime: number;
    itemsPerSecond: number;
    recentActivity: Array<{ itemType: string, itemID: string | number, timestamp: number }>;
}

interface InstanceStatsData {
    itemsSavedStats: Array<{ itemType: string, itemID: string | number, languageCode: string, timestamp: number }>;
    progressByType: { [itemType: string]: number };
    progressCallback: ((stats: ProgressStats) => void) | null;
    syncStartTime: number;
}

require("dotenv").config({
	path: `.env.${process.env.NODE_ENV}`,
})

/**
 * Get the logger for the current operation
 */
function getLogger(options: any): Logs | null {
  // Extract GUID from options.rootPath or options.guid
  const guid = options?.guid || options?.sourceGuid || extractGuidFromPath(options?.rootPath);
  if (!guid) return null;
  
  return getLoggerForGuid(guid);
}

/**
 * Extract GUID from rootPath (e.g., "agility-files/13a8b394-u/en-us/preview")
 */
function extractGuidFromPath(rootPath: string): string | null {
  if (!rootPath) return null;
  
  // Look for GUID pattern in path segments
  const segments = rootPath.split('/');
  for (const segment of segments) {
    // Match GUID patterns like "13a8b394-u" or "af9a3c91-4ca0-42db-bdb9-cced53a818d6"
    if (/^[a-f0-9]{8}-[a-f0-9-]{1,36}$/i.test(segment)) {
      return segment;
    }
  }
  return null;
}

/**
 * Map Sync SDK itemType to ChangeDelta entity type
 */
function mapItemTypeToEntityType(itemType: string): string {
  const typeMap = {
    'item': 'content-item',
    'page': 'page'
  };
  return typeMap[itemType] || itemType;
}

/**
 * Extract entity name from item content
 */
function extractEntityName(item: any, itemType: string): string {
  if (itemType === 'page') {
    return item.name || item.title || `Page ${item.pageID}`;
  }
  if (itemType === 'item') {
    return item.properties?.referenceName || `Content ${item.contentID}`;
  }
  return `${itemType} ${item.id || 'Unknown'}`;
}

/**
 * Extract reference name from item content
 */
function extractReferenceName(item: any, itemType: string): string | undefined {
  if (itemType === 'page') {
    return item.name;
  }
  if (itemType === 'item') {
    return item.properties?.referenceName;
  }
  return undefined;
}

/**
 * Get or create instance-specific stats for the given rootPath
 */
const getInstanceStats = (rootPath: string): InstanceStatsData => {
    if (!_instanceStats.has(rootPath)) {
        _instanceStats.set(rootPath, {
            itemsSavedStats: [],
            progressByType: {},
            progressCallback: null,
            syncStartTime: 0
        });
    }
    return _instanceStats.get(rootPath);
};

/**
 * Set a progress callback function that will be called whenever items are saved
 * This allows the UI to get real-time updates during sync operations
 */
const setProgressCallback = (callback: ((stats: ProgressStats) => void) | null, rootPath?: string) => {
    if (rootPath) {
        const instanceStats = getInstanceStats(rootPath);
        instanceStats.progressCallback = callback;
    } else {
        // Fallback: set for all instances if rootPath not specified
        _instanceStats.forEach((stats) => {
            stats.progressCallback = callback;
        });
    }
};

/**
 * Initialize progress tracking for a new sync operation
 */
const initializeProgress = (rootPath?: string) => {
    if (rootPath) {
        const instanceStats = getInstanceStats(rootPath);
        instanceStats.itemsSavedStats = [];
        instanceStats.progressByType = {};
        instanceStats.syncStartTime = Date.now();
    } else {
        // Fallback: initialize all instances if rootPath not specified
        _instanceStats.forEach((stats) => {
            stats.itemsSavedStats = [];
            stats.progressByType = {};
            stats.syncStartTime = Date.now();
        });
    }
};

/**
 * Clean up old progress data to prevent memory bloat during long operations
 */
const cleanupProgressData = (rootPath: string) => {
    const instanceStats = getInstanceStats(rootPath);
    const MAX_STATS_HISTORY = 200; // Limit for memory management
    if (instanceStats.itemsSavedStats.length > MAX_STATS_HISTORY) {
        instanceStats.itemsSavedStats = instanceStats.itemsSavedStats.slice(-MAX_STATS_HISTORY);
    }
};

/**
 * Get current progress statistics without clearing the data
 */
const getProgressStats = (rootPath: string): ProgressStats => {
    const instanceStats = getInstanceStats(rootPath);
    const elapsedTime = Date.now() - instanceStats.syncStartTime;
    const totalItems = instanceStats.itemsSavedStats.length;
    
    return {
        totalItems,
        itemsByType: { ...instanceStats.progressByType },
        elapsedTime,
        itemsPerSecond: totalItems > 0 ? (totalItems / (elapsedTime / 1000)) : 0,
        recentActivity: instanceStats.itemsSavedStats.slice(-10).map(item => ({
            itemType: item.itemType,
            itemID: item.itemID,
            timestamp: item.timestamp
        }))
    };
};

/**
 * Update progress and trigger callback if set
 */
const updateProgress = (itemType: string, itemID: string | number, rootPath: string) => {
    const instanceStats = getInstanceStats(rootPath);
    
    // Add to stats
    instanceStats.itemsSavedStats.push({
        itemType,
        itemID,
        languageCode: 'unknown', // Language not available at this level
        timestamp: Date.now()
    });
    
    // Update type counts
    instanceStats.progressByType[itemType] = (instanceStats.progressByType[itemType] || 0) + 1;
    
    // Clean up old data periodically
    if (instanceStats.itemsSavedStats.length % 50 === 0) {
        cleanupProgressData(rootPath);
    }
    
    // Trigger callback if set
    if (instanceStats.progressCallback) {
        instanceStats.progressCallback(getProgressStats(rootPath));
    }
};

/**
 * The function to handle saving/updating an item to your storage. This could be a Content Item, Page, Url Redirections, Sync State (state), or Sitemap.
 * @param {Object} params - The parameters object
 * @param {Object} params.options - A flexible object that can contain any properties specifically related to this interface
 * @param {String} params.options.rootPath - The path to store/access the content as JSON 
 * @param {Object} params.item - The object representing the Content Item, Page, Url Redirections, Sync State (state), or Sitemap that needs to be saved/updated
 * @param {String} params.itemType - The type of item being saved/updated, expected values are `item`, `page`, `sitemap`, `nestedsitemap`, `state`, `urlredirections`
 * @param {String} params.languageCode - The locale code associated to the item being saved/updated
 * @param {(String|Number)} params.itemID - The ID of the item being saved/updated - this could be a string or number depending on the itemType
 * @returns {Void}
 */
const saveItem = async ({ options, item, itemType, languageCode, itemID }) => {

	// Null/undefined safety check - prevent crashes when SDK passes undefined items
	if (item === null || item === undefined) {
		console.warn(`⚠️  Skipping save for ${itemType} (ID: ${itemID}) - item is ${item}`);
		return;
	}

	const cwd = process.cwd();
	let filePath = getFilePath({ options, itemType, languageCode, itemID });
	const absoluteFilePath = path.resolve(cwd, filePath);
	let dirPath = path.dirname(absoluteFilePath);
	const forceOverwrite = options.forceOverwrite;

	// Get the logger for this operation
	const logger = options.logger;

	try {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
			
			if (!fs.existsSync(dirPath)) {
				throw new Error(`Failed to create directory: ${dirPath}`);
			}
		}

		let json = JSON.stringify(item);
     	fs.writeFileSync(absoluteFilePath, json);

		// Use structured logging instead of basic console.log
		if (logger) {

			// if(itemType !== 'item' && itemType !== 'sitemap' && itemType !== 'list') { console.log('item', item); }
			// Map itemType to appropriate logger method and include locale for content/pages
			if (itemType === 'item') {
				logger.content.downloaded(item, undefined, languageCode);
			} else if (itemType === 'page') {
				logger.page.downloaded(item, undefined, languageCode);
			} else if (itemType === 'sitemap') {
				logger.sitemap.downloaded({ name: 'sitemap.json' });
			} else {
				// Fallback for other item types
				// const entityName = extractEntityName(item, itemType);
				// logger.info(`✓ Downloaded ${itemType}: ${entityName} [${languageCode}]`);
			}
		} else {
			// Fallback to basic logging if no logger available
			// const state = getState();
			// if (state.verbose) {
			// 	console.log('✓ Downloaded',ansiColors.cyan(itemType), ansiColors.white(itemID));
			// }
		}

		if (!fs.existsSync(absoluteFilePath)) {
			throw new Error(`File was not created: ${absoluteFilePath}`);
		}

		// REMOVE direct log, PUSH to stats array
        // console.log(`✓ Downloaded ${ansiColors.cyan(itemType)} (ID: ${itemID})`);
        // updateProgress(itemType, itemID, options.rootPath);
		
	} catch (error) {
		// Use structured error logging if available
		if (logger) {
			if (itemType === 'item') {
				logger.contentitem.error(item, error, languageCode);
			} else if (itemType === 'page') {
				logger.page.error(item, error, languageCode);
			} else {
				logger.error(`Failed to save ${itemType} (ID: ${itemID}): ${error.message}`);
			}
		} else {
			console.error('Error in saveItem:', error);
		}
		
		console.error('Error details:', {
			filePath,
			absoluteFilePath,
			dirPath,
			cwd,
			error: error.message,
			stack: error.stack
		});
		throw error;
	}
}
/**
 * The function to handle deleting an item to your storage. This could be a Content Item, Page, Url Redirections, Sync State (state), or Sitemap.
 * @param {Object} params - The parameters object
 * @param {Object} params.options - A flexible object that can contain any properties specifically related to this interface
 * @param {String} params.options.rootPath - The path to store/access the content as JSON 
 * @param {String} params.itemType - The type of item being deleted, expected values are `item`, `page`, `sitemap`, `nestedsitemap`, `state`, `urlredirections`
 * @param {String} params.languageCode - The locale code associated to the item being saved/updated
 * @param {(String|Number)} params.itemID - The ID of the item being deleted - this could be a string or number depending on the itemType
 * @returns {Void}
 */
const deleteItem = async ({ options, itemType, languageCode, itemID }) => {

	let filePath = getFilePath({ options, itemType, languageCode, itemID });

	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}

}
/**
 * The function to handle updating and placing a Content Item into a "list" so that you can handle querying a collection of items.
 * @param {Object} params - The parameters object
 * @param {Object} params.options - A flexible object that can contain any properties specifically related to this interface
 * @param {String} params.options.rootPath - The path to store/access the content as JSON 
 * @param {Object} params.item - The object representing the Content Item
 * @param {String} params.languageCode - The locale code associated to the item being saved/updated 
 * @param {(String|Number)} params.itemID - The ID of the item being updated - this could be a string or number depending on the itemType
 * @param {String} params.referenceName - The reference name of the Content List that this Content Item should be added to
 * @param {String} params.definitionName - The Model name that the Content Item is based on
 * @returns {Void}
 */
const mergeItemToList = async ({ options, item, languageCode, itemID, referenceName, definitionName }) => {

	let contentList = await getItem({ options, itemType: "list", languageCode, itemID: referenceName });

	if (contentList == null) {
		//initialize the list
		contentList = [item];
	} else {
		//replace the item...
		const cIndex = contentList.findIndex((ci) => {
			return ci.contentID === itemID;
		});

		if (item.properties.state === 3) {
			//*** deleted item (remove from the list) ***
			if (cIndex >= 0) {
				//remove the item
				contentList.splice(cIndex, 1);
			}

		} else {
			//*** regular item (merge) ***
			if (cIndex >= 0) {
				//replace the existing item
				contentList[cIndex] = item;
			} else {
				//and it to the end of the
				contentList.push(item);
			}
		}
	}

	await saveItem({ options, item: contentList, itemType: "list", languageCode, itemID: referenceName });
}
/**
 * The function to handle retrieving a Content Item, Page, Url Redirections, Sync State (state), or Sitemap
 * @param {Object} params - The parameters object
 * @param {Object} params.options - A flexible object that can contain any properties specifically related to this interface
 * @param {String} params.options.rootPath - The path to store/access the content as JSON 
 * @param {String} params.itemType - The type of item being accessed, expected values are `item`, `list`, `page`, `sitemap`, `nestedsitemap`, `state`, `urlredirections`
 * @param {String} params.languageCode - The locale code associated to the item being accessed
 * @param {(String|Number)} params.itemID - The ID of the item being accessed - this could be a string or number depending on the itemType
 * @returns {Object}
 */
const getItem = async ({ options, itemType, languageCode, itemID }) => {
	let filePath = getFilePath({ options, itemType, languageCode, itemID });

	if (!fs.existsSync(filePath)) return null;

	let json = fs.readFileSync(filePath, 'utf8');
	return JSON.parse(json);
}

/**
 * The function to handle clearing the cache of synchronized data from the CMS
 * @param {Object} params - The parameters object
 * @param {Object} params.options - A flexible object that can contain any properties specifically related to this interface
 * @param {String} params.options.rootPath - The path to store/access the content as JSON 
 * @returns {Void}
 */
const clearItems = async ({ options }) => {
	fs.rmdirSync(options.rootPath, { recursive: true })
}



/**
 * The function to handle multi-threaded Syncs that may be happening at the same time. If you need to prevent a sync from happening and let it wait until another sync has finished use this.
 * @returns {Promise}
 */
const mutexLock = async () => {


	const dir = os.tmpdir();
	const lockFile = `${dir}/${"agility-sync"}.mutex`
	if (! fs.existsSync(lockFile)) {
		fs.writeFileSync(lockFile, "agility-sync");
	}

	//THE LOCK IS ALREADY HELD - WAIT UP!
	await waitOnLock(lockFile)

	try {
		return lockSync(lockFile)
	} catch (err) {
		if (`${err}`.indexOf("Lock file is already being held") !== -1) {

			//this error happens when 2 processes try to get a lock at the EXACT same time (very rare)
			await sleep(100)
			await waitOnLock(lockFile)

			try {
				return lockSync(lockFile)
			} catch (e2) {
				if (`${err}`.indexOf("Lock file is already being held") !== -1) {

					//this error happens when 2 processes try to get a lock at the EXACT same time (very rare)
					await sleep(100)
					await waitOnLock(lockFile)
					return lockSync(lockFile)
				}
			}
		}

		throw Error("The mutex lock could not be obtained.")
	}

}


//private function to get a wait on a lock file
const waitOnLock = async (lockFile) => {
	while (await check(lockFile)) {
		await sleep(100)
	}
}

//private function to get path of an item
const getFilePath = ({ options, itemType, languageCode, itemID }) => {
		if(typeof itemID === 'string' || itemID instanceof String){
			itemID = itemID.replace(/[`!@#$%^&*()+\=\[\]{};':"\\|,.<>\/?~]/g, "");
		}
		
		// Fix inconsistency: Convert "page" (singular) to "pages" (plural) 
		// to match where get-pages.ts expects to find them
		// if (itemType === 'page') {
		// 	itemType = 'pages';
		// }
		
		const fileName = `${itemID}.json`;
		return path.join(options.rootPath, itemType, fileName);
}

// Enhanced function to get and clear saved item stats with progress data
const getAndClearSavedItemStats = (rootPath: string) => {
    const instanceStats = getInstanceStats(rootPath);
    const stats = getProgressStats(rootPath);
    
    // Prepare detailed summary
    const summary = {
        totalItems: stats.totalItems,
        elapsedTime: stats.elapsedTime,
        itemsPerSecond: stats.itemsPerSecond
    };
    
    // Clear stats for this instance
    instanceStats.itemsSavedStats = [];
    instanceStats.progressByType = {};
    
    return {
        summary,
        itemsByType: stats.itemsByType,
        recentActivity: stats.recentActivity
    };
};

module.exports = {
	saveItem,
	deleteItem,
	mergeItemToList,
	getItem,
	clearItems,
	mutexLock,
    getAndClearSavedItemStats, // RE-ADD Export
    setProgressCallback,
    initializeProgress,
    getCurrentProgress: getProgressStats, // Alias for getProgressStats
    updateProgress,
    cleanupProgressData  // NEW: Memory cleanup function
}