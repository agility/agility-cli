import ansiColors from "ansi-colors"

const fs = require('fs')
const os = require('os')
const path = require('path')
const {sleep} = require("../util")
const { lockSync, unlockSync, checkSync, check }  = require("proper-lockfile")

// Enhanced progress tracking system
let _itemsSavedStats: Array<{ itemType: string, itemID: string | number, languageCode: string, timestamp: number }> = [];
let _progressByType: { [itemType: string]: number } = {};
let _progressCallback: ((stats: ProgressStats) => void) | null = null;
let _syncStartTime: number = 0;

// Type definitions for better TypeScript support
interface ProgressStats {
    totalItems: number;
    itemsByType: { [itemType: string]: number };
    elapsedTime: number;
    itemsPerSecond: number;
    recentActivity: Array<{ itemType: string, itemID: string | number, timestamp: number }>;
}

require("dotenv").config({
	path: `.env.${process.env.NODE_ENV}`,
})

/**
 * Set a progress callback function that will be called whenever items are saved
 * This allows the BlessedUI to get real-time updates during sync operations
 */
const setProgressCallback = (callback: ((stats: ProgressStats) => void) | null) => {
    _progressCallback = callback;
};

/**
 * Initialize progress tracking for a new sync operation
 */
const initializeProgress = () => {
    _itemsSavedStats = [];
    _progressByType = {};
    _syncStartTime = Date.now();
};

/**
 * Clean up old progress data to prevent memory bloat during long operations
 */
const cleanupProgressData = () => {
    const MAX_STATS_HISTORY = 200; // Reduced from 500 to match Blessed UI limit
    if (_itemsSavedStats.length > MAX_STATS_HISTORY) {
        _itemsSavedStats = _itemsSavedStats.slice(-MAX_STATS_HISTORY);
    }
};

/**
 * Get current progress statistics without clearing the data
 */
const getCurrentProgress = (): ProgressStats => {
    const now = Date.now();
    const elapsedTime = _syncStartTime > 0 ? now - _syncStartTime : 0;
    const totalItems = _itemsSavedStats.length;
    const itemsPerSecond = elapsedTime > 0 ? (totalItems / elapsedTime) * 1000 : 0;
    
    // Get recent activity (last 10 items)
    const recentActivity = _itemsSavedStats.slice(-10).map(item => ({
        itemType: item.itemType,
        itemID: item.itemID,
        timestamp: item.timestamp
    }));

    return {
        totalItems,
        itemsByType: { ..._progressByType },
        elapsedTime,
        itemsPerSecond,
        recentActivity
    };
};

/**
 * Update progress counters and trigger callback if set (optimized for memory)
 */
const updateProgress = (itemType: string, itemID: string | number) => {
    const timestamp = Date.now();
    
    // Limit stats array size to prevent memory bloat (keep only recent items)
    const MAX_STATS_HISTORY = 200; // Reduced from 1000 to 200
    if (_itemsSavedStats.length >= MAX_STATS_HISTORY) {
        _itemsSavedStats.shift(); // Remove oldest entry
    }
    _itemsSavedStats.push({ itemType, itemID, languageCode: 'current', timestamp });
    
    // Update type counters
    _progressByType[itemType] = (_progressByType[itemType] || 0) + 1;
    
    // More aggressive throttling to reduce UI pressure
    const totalItems = Object.values(_progressByType).reduce((sum, count) => sum + count, 0);
    if (_progressCallback && (totalItems % 10 === 0 || totalItems < 50)) { // Call every 10 items after 50, all items before 50
        const currentStats = getCurrentProgress();
        _progressCallback(currentStats);
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


	// console.log('saveItem-> ', itemType, languageCode, itemID);
	const cwd = process.cwd();
	let filePath = getFilePath({ options, itemType, languageCode, itemID });
	const absoluteFilePath = path.resolve(cwd, filePath);
	let dirPath = path.dirname(absoluteFilePath);
	const forceOverwrite = options.forceOverwrite;


	try {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
			
			if (!fs.existsSync(dirPath)) {
				throw new Error(`Failed to create directory: ${dirPath}`);
			}
		}

		let json = JSON.stringify(item);
        // Add specific debug logs around file write
        // console.log(`[Debug saveItem] About to write: ${itemType} (ID: ${itemID}) to ${absoluteFilePath}`);
		fs.writeFileSync(absoluteFilePath, json);
        // console.log(`[Debug saveItem] Write successful for: ${absoluteFilePath}`);
		
		// Only log when verbose is enabled or blessed UI is disabled
		// This prevents UI clutter when blessed UI is active on large instances
		const { getState } = require('./state');
		const state = getState();
		if (state.verbose || !state.blessed) {
			console.log('✓ Downloaded ', ansiColors.cyan(itemType), ansiColors.white(itemID));
		}

		if (!fs.existsSync(absoluteFilePath)) {
			throw new Error(`File was not created: ${absoluteFilePath}`);
		}

		// REMOVE direct log, PUSH to stats array
        // console.log(`✓ Downloaded ${ansiColors.cyan(itemType)} (ID: ${itemID})`);
        updateProgress(itemType, itemID);
       
		
	} catch (error) {
		console.error('Error in saveItem:', error);
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
const getAndClearSavedItemStats = () => {
    const stats = [..._itemsSavedStats];
    const progressByType = { ..._progressByType };
    const finalStats = getCurrentProgress();
    
    // Clear the buffers for the next operation
    _itemsSavedStats = [];
    _progressByType = {};
    _syncStartTime = 0;
    
    return {
        items: stats,
        summary: finalStats,
        itemsByType: progressByType
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
    getCurrentProgress,
    updateProgress,
    cleanupProgressData  // NEW: Memory cleanup function
}