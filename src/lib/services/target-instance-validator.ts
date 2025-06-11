import * as fs from 'fs';
import * as path from 'path';

export interface TargetInstanceConfig {
  targetInstances: {
    [key: string]: {
      guid: string;
      name: string;
      description: string;
      status: string;
    };
  };
}

export class TargetInstanceValidator {
  private allowedTargets: string[] = [];
  private targetNames: Map<string, string> = new Map();

  constructor() {
    this.loadAllowedTargets();
  }

  /**
   * Load allowed target instances from config file
   */
  private loadAllowedTargets(): void {
    try {
      const configPath = path.join(process.cwd(), 'config', 'test-instances.json');
      
      if (!fs.existsSync(configPath)) {
        console.warn('⚠️  Target instance config file not found. Allowing all targets (unsafe mode).');
        return;
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      const config: TargetInstanceConfig = JSON.parse(configData);

      // Extract allowed target GUIDs and names
      Object.values(config.targetInstances).forEach(target => {
        this.allowedTargets.push(target.guid);
        this.targetNames.set(target.guid, target.name);
      });

      // Also allow special test targets
      this.allowedTargets.push('test');  // For --test mode analysis
      this.targetNames.set('test', 'Test Mode (Analysis Only)');

      console.log(`🔒 Target instance validation enabled. ${this.allowedTargets.length} approved targets loaded.`);
      
    } catch (error) {
      console.warn('⚠️  Failed to load target instance config:', error.message);
      console.warn('⚠️  Allowing all targets (unsafe mode).');
    }
  }

  /**
   * Validate if a target GUID is approved for sync operations
   */
  public validateTargetInstance(targetGuid: string): { isValid: boolean; message: string } {
    // If no config loaded, allow everything (unsafe mode with warning)
    if (this.allowedTargets.length === 0) {
      return {
        isValid: true,
        message: '⚠️  No target validation - using unsafe mode'
      };
    }

    // Check if target is in approved list
    if (this.allowedTargets.includes(targetGuid)) {
      const targetName = this.targetNames.get(targetGuid) || 'Unknown';
      return {
        isValid: true,
        message: `✅ Target instance validated: ${targetName} (${targetGuid})`
      };
    }

    // Target not approved
    const approvedList = this.allowedTargets
      .map(guid => `  - ${this.targetNames.get(guid) || 'Unknown'} (${guid})`)
      .join('\n');

    return {
      isValid: false,
      message: `❌ SAFETY VIOLATION: Target instance '${targetGuid}' is not in the approved list.\n\n` +
               `🔒 Approved target instances:\n${approvedList}\n\n` +
               `🚨 This safety check prevents accidental uploads to customer/production instances.\n` +
               `   To add a new target, update 'config/test-instances.json'.`
    };
  }

  /**
   * Get list of all approved target instances
   */
  public getApprovedTargets(): Array<{ guid: string; name: string }> {
    return this.allowedTargets.map(guid => ({
      guid,
      name: this.targetNames.get(guid) || 'Unknown'
    }));
  }

  /**
   * Check if a GUID appears to be a customer instance (heuristic)
   */
  public looksLikeCustomerInstance(guid: string): boolean {
    // Customer instances typically follow patterns like:
    // - Short alphanumeric codes ending in -u (e.g., "13a8b394-u", "67bc73e6-u")
    // - Full UUIDs for enterprise customers
    
    const shortPatternRegex = /^[a-f0-9]{8}-u$/;
    const uuidPatternRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    
    return shortPatternRegex.test(guid) || uuidPatternRegex.test(guid);
  }

  /**
   * Provide helpful suggestions for common mistakes
   */
  public getSuggestions(invalidTargetGuid: string): string {
    if (this.looksLikeCustomerInstance(invalidTargetGuid)) {
      return `💡 The GUID '${invalidTargetGuid}' appears to be a customer/production instance.\n` +
             `   This safety check prevented a potentially dangerous upload.\n` +
             `   Use one of the approved test targets instead.`;
    }

    return `💡 If '${invalidTargetGuid}' is a legitimate test target,\n` +
           `   add it to 'config/test-instances.json' under 'targetInstances'.`;
  }
} 