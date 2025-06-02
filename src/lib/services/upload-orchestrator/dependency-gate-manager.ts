/**
 * Dependency Gate Manager - Thread Synchronization System
 * 
 * Manages thread dependencies and coordination gates for upload orchestrator
 * Based on validated parallel execution plan from Phase 19-20
 */

import {
    DependencyGate,
    GateCondition,
    GateStatus,
    ThreadStatus
} from './types';

export class DependencyGateManager {
    private gates: Map<string, DependencyGate> = new Map();
    private gateWaiters: Map<string, { threadId: string; resolve: Function; reject: Function }[]> = new Map();
    private gateListeners: Map<string, Function[]> = new Map();

    constructor() {
        this.initializeGates();
    }

    /**
     * Initialize all dependency gates with their conditions
     */
    private initializeGates(): void {
        const gateDefinitions: Array<{
            name: string;
            requiredBy: string[];
            conditions: Omit<GateCondition, 'currentValue' | 'isMet'>[];
        }> = [
            {
                name: 'models-complete',
                requiredBy: ['batched-content', 'complex-entities'],
                conditions: [
                    { type: 'task-complete', target: 'models', threshold: 100 }
                ]
            },
            {
                name: 'templates-complete',
                requiredBy: ['batched-content', 'complex-entities'],
                conditions: [
                    { type: 'task-complete', target: 'templates', threshold: 100 }
                ]
            },
            {
                name: 'containers-complete',
                requiredBy: ['batched-content'],
                conditions: [
                    { type: 'task-complete', target: 'containers', threshold: 100 }
                ]
            },
            {
                name: 'independent-assets-complete',
                requiredBy: ['complex-entities'],
                conditions: [
                    { type: 'task-complete', target: 'assets', threshold: 100 }
                ]
            },
            {
                name: 'content-complete',
                requiredBy: ['complex-entities'],
                conditions: [
                    { type: 'task-complete', target: 'content', threshold: 100 }
                ]
            },
            {
                name: 'all-entities-complete',
                requiredBy: [],
                conditions: [
                    { type: 'task-complete', target: 'pages', threshold: 100 },
                    { type: 'task-complete', target: 'galleries', threshold: 100 }
                ]
            }
        ];

        gateDefinitions.forEach(gateDef => {
            this.gates.set(gateDef.name, {
                gateName: gateDef.name,
                isOpen: false,
                waitingThreads: [],
                requiredBy: gateDef.requiredBy,
                conditions: gateDef.conditions.map(cond => ({
                    ...cond,
                    currentValue: 0,
                    isMet: false
                }))
            });
            
            this.gateWaiters.set(gateDef.name, []);
            this.gateListeners.set(gateDef.name, []);
        });
    }

    /**
     * Wait for a specific gate to open
     */
    async waitForGate(gateName: string, threadId: string): Promise<void> {
        const gate = this.gates.get(gateName);
        if (!gate) {
            throw new Error(`Unknown gate: ${gateName}`);
        }

        if (gate.isOpen) {
            console.log(`  ✅ Thread ${threadId}: Gate ${gateName} already open`);
            return; // Gate already open
        }

        console.log(`  ⏳ Thread ${threadId}: Waiting for gate ${gateName}`);
        gate.waitingThreads.push(threadId);

        return new Promise((resolve, reject) => {
            const waiters = this.gateWaiters.get(gateName)!;
            waiters.push({ threadId, resolve, reject });
        });
    }

    /**
     * Update gate conditions based on task progress
     */
    updateGateCondition(gateName: string, conditionTarget: string, currentValue: number): void {
        const gate = this.gates.get(gateName);
        if (!gate) return;

        // Find and update the condition
        const condition = gate.conditions.find(c => c.target === conditionTarget);
        if (condition) {
            condition.currentValue = currentValue;
            condition.isMet = currentValue >= condition.threshold;
        }

        // Check if gate should open
        this.checkAndOpenGate(gateName);
    }

    /**
     * Check if all conditions for a gate are met and open if ready
     */
    private checkAndOpenGate(gateName: string): void {
        const gate = this.gates.get(gateName);
        if (!gate || gate.isOpen) return;

        // Check if all conditions are met
        const allConditionsMet = gate.conditions.every(condition => condition.isMet);
        
        if (allConditionsMet) {
            this.openGate(gateName);
        }
    }

    /**
     * Manually signal that a gate should open
     */
    async signalGate(gateName: string, signallingThread: string): Promise<void> {
        const gate = this.gates.get(gateName);
        if (!gate) {
            throw new Error(`Unknown gate: ${gateName}`);
        }

        if (gate.isOpen) {
            return; // Already open
        }

        console.log(`  🚪 Gate opening: ${gateName} (signaled by ${signallingThread})`);
        this.openGate(gateName);
    }

    /**
     * Open a gate and notify all waiting threads
     */
    private openGate(gateName: string): void {
        const gate = this.gates.get(gateName);
        if (!gate || gate.isOpen) return;

        gate.isOpen = true;
        gate.openedAt = Date.now();

        console.log(`  ✅ Gate opened: ${gateName}`);

        // Notify all waiting threads
        const waiters = this.gateWaiters.get(gateName)!;
        waiters.forEach(waiter => {
            console.log(`    🔓 Releasing thread: ${waiter.threadId}`);
            waiter.resolve();
        });
        this.gateWaiters.set(gateName, []); // Clear waiters

        // Clear waiting threads list
        if (gate.waitingThreads.length > 0) {
            console.log(`    ✅ Released ${gate.waitingThreads.length} waiting thread(s)`);
            gate.waitingThreads = [];
        }

        // Notify gate listeners
        const listeners = this.gateListeners.get(gateName) || [];
        listeners.forEach(listener => listener(gateName));
    }

    /**
     * Add listener for gate opening events
     */
    addGateListener(gateName: string, listener: (gateName: string) => void): void {
        const listeners = this.gateListeners.get(gateName) || [];
        listeners.push(listener);
        this.gateListeners.set(gateName, listeners);
    }

    /**
     * Remove gate listener
     */
    removeGateListener(gateName: string, listener: Function): void {
        const listeners = this.gateListeners.get(gateName) || [];
        const index = listeners.indexOf(listener);
        if (index > -1) {
            listeners.splice(index, 1);
            this.gateListeners.set(gateName, listeners);
        }
    }

    /**
     * Get status of all gates
     */
    getGateStatus(): GateStatus[] {
        return Array.from(this.gates.values()).map(gate => ({
            name: gate.gateName,
            isOpen: gate.isOpen,
            waitingThreadCount: gate.waitingThreads.length,
            openedAt: gate.openedAt,
            requiredBy: gate.requiredBy,
            conditions: [...gate.conditions]
        }));
    }

    /**
     * Get status of a specific gate
     */
    getGateStatusByName(gateName: string): GateStatus | null {
        const gate = this.gates.get(gateName);
        if (!gate) return null;

        return {
            name: gate.gateName,
            isOpen: gate.isOpen,
            waitingThreadCount: gate.waitingThreads.length,
            openedAt: gate.openedAt,
            requiredBy: gate.requiredBy,
            conditions: [...gate.conditions]
        };
    }

    /**
     * Check if a gate is open
     */
    isGateOpen(gateName: string): boolean {
        const gate = this.gates.get(gateName);
        return gate ? gate.isOpen : false;
    }

    /**
     * Get all waiting threads for debugging
     */
    getWaitingThreads(): Map<string, string[]> {
        const result = new Map<string, string[]>();
        for (const [gateName, gate] of Array.from(this.gates.entries())) {
            if (gate.waitingThreads.length > 0) {
                result.set(gateName, [...gate.waitingThreads]);
            }
        }
        return result;
    }

    /**
     * Force open a gate (for testing or emergency use)
     */
    forceOpenGate(gateName: string, reason: string): void {
        console.log(`  🔨 Force opening gate: ${gateName} (reason: ${reason})`);
        this.openGate(gateName);
    }

    /**
     * Reset all gates (for testing)
     */
    resetAllGates(): void {
        for (const gate of Array.from(this.gates.values())) {
            gate.isOpen = false;
            gate.openedAt = undefined;
            gate.waitingThreads = [];
            gate.conditions.forEach(condition => {
                condition.currentValue = 0;
                condition.isMet = false;
            });
        }

        // Clear all waiters
        for (const gateName of Array.from(this.gateWaiters.keys())) {
            this.gateWaiters.set(gateName, []);
        }
    }

    /**
     * Get gates that are blocking a specific thread
     */
    getBlockingGates(threadId: string): string[] {
        const blockingGates: string[] = [];
        
        for (const [gateName, gate] of Array.from(this.gates.entries())) {
            if (!gate.isOpen && gate.requiredBy.includes(threadId)) {
                blockingGates.push(gateName);
            }
        }
        
        return blockingGates;
    }

    /**
     * Get dependency chain visualization
     */
    getDependencyVisualization(): string {
        let visualization = '\n🔗 DEPENDENCY GATE CHAIN:\n';
        visualization += '═══════════════════════════════════════\n';
        
        for (const [gateName, gate] of Array.from(this.gates.entries())) {
            const status = gate.isOpen ? '✅' : '🔒';
            const waitingCount = gate.waitingThreads.length;
            const conditionsSummary = gate.conditions.map(c => 
                `${c.target}(${c.currentValue}/${c.threshold})`
            ).join(', ');
            
            visualization += `${status} ${gateName}\n`;
            visualization += `   Conditions: ${conditionsSummary}\n`;
            visualization += `   Required by: [${gate.requiredBy.join(', ')}]\n`;
            if (waitingCount > 0) {
                visualization += `   Waiting: ${waitingCount} thread(s)\n`;
            }
            visualization += '\n';
        }
        
        return visualization;
    }

    /**
     * Clean up all gates and waiters
     */
    cleanup(): void {
        // Reject all pending waiters
        for (const waiters of Array.from(this.gateWaiters.values())) {
            waiters.forEach(waiter => {
                waiter.reject(new Error('Gate manager cleaned up'));
            });
        }

        this.gates.clear();
        this.gateWaiters.clear();
        this.gateListeners.clear();
    }
} 