/**
 * Analysis Step Coordinator Service
 * 
 * Manages individual analysis steps with dependency injection.
 * Provides a lightweight orchestration layer for the 6-step analysis process.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService 
} from './types';

export class AnalysisStepCoordinator {
    private context?: SyncAnalysisContext;
    private services: Map<string, ChainAnalysisService> = new Map();

    constructor() {
        // Services will be registered by the main runner
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        
        // Initialize all registered services
        Array.from(this.services.entries()).forEach(([name, service]) => {
            service.initialize(context);
        });
    }

    /**
     * Register an analysis service with a step name
     */
    registerService(stepName: string, service: ChainAnalysisService): void {
        this.services.set(stepName, service);
        
        // Initialize if context is already available
        if (this.context) {
            service.initialize(this.context);
        }
    }

    /**
     * Execute a specific analysis step by name
     */
    executeStep(stepName: string, sourceEntities: SourceEntities): void {
        const service = this.services.get(stepName);
        if (!service) {
            console.error(ansiColors.red(`Error: Unknown analysis step "${stepName}"`));
            return;
        }

        try {
            // Execute the step
            service.analyzeChains(sourceEntities);
        } catch (error) {
            console.error(ansiColors.red(`Error executing step "${stepName}": ${error}`));
            if (this.context?.debug) {
                console.error(error);
            }
        }
    }
} 