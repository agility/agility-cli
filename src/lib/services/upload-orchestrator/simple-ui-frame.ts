/**
 * Simple UI Frame - Basic 2-Column Multi-Thread Interface
 * 
 * Copies the proven blessed UI pattern from push functionality
 * Left column: Thread status, Right column: Console logs
 */

const blessed = require('blessed');
const contrib = require('blessed-contrib');
import ansiColors from 'ansi-colors';

export class SimpleUIFrame {
    private screen: any | null = null;
    private logContainer: any | null = null;
    private threadContainer: any | null = null;
    private originalConsoleLog: any;
    private originalConsoleError: any;

    constructor() {
        this.originalConsoleLog = console.log;
        this.originalConsoleError = console.error;
    }

    /**
     * Initialize the blessed screen with 2-column layout
     */
    initializeUI(): void {
        // Initialize Blessed screen (copied from push.ts)
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Agility CLI - Multi-Thread Upload Orchestrator'
        });

        // Initialize Grid layout - 13 rows, 12 cols (copied from push.ts)
        const grid = new contrib.grid({
            rows: 13,
            cols: 12,
            screen: this.screen
        });

        // Left Column - Thread Status (copied from push progress container)
        this.threadContainer = grid.set(1, 0, 12, 4, blessed.box, {
            label: ' Thread Status ',
            border: { type: 'line' },
            style: {
                border: { fg: 'cyan' },
            }
        });

        // Right Column - Console Logs (copied from push log container) 
        this.logContainer = grid.set(1, 4, 12, 8, blessed.log, {
            label: ' Console Logs ',
            border: { type: 'line' },
            style: { border: { fg: 'green' } },
            padding: { left: 2, right: 1, top: 1, bottom: 1 },
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: ' ',
                inverse: true
            },
            keys: true,
            vi: true
        });

        // Header (copied from push.ts)
        const headerLeft = blessed.box({
            parent: this.screen,
            width: '20%',
            height: 1,
            top: 0,
            left: 0,
            content: ' Multi-Thread Upload ',
            tags: true,
            style: { fg: 'cyan', bold: true }
        });

        const headerRight = blessed.box({
            parent: this.screen,
            width: '80%',
            height: 1,
            top: 0,
            left: '20%',
            content: 'Upload Orchestrator Framework ',
            tags: true,
            align: 'right',
            style: { fg: 'white' }
        });

        // Redirect console logging to blessed log widget (copied from push.ts)
        console.log = (...args: any[]) => {
            if (this.logContainer) {
                this.logContainer.log(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' '));
                this.screen?.render();
            }
        };

        console.error = (...args: any[]) => {
            if (this.logContainer) {
                const errorMsg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
                this.logContainer.log(ansiColors.red(`ERROR: ${errorMsg}`));
                this.screen?.render();
            }
        };

        // Exit handlers (copied from push.ts)
        this.screen.key(['escape', 'q', 'C-c'], () => {
            this.restoreConsole();
            this.screen?.destroy();
            process.exit(0);
        });

        // Initial render and focus
        this.screen.render();
        if (this.logContainer) {
            this.logContainer.focus();
        }
    }

    /**
     * Add thread status display to left column
     */
    addThreadStatus(threadId: string, status: string, color: string = 'white'): void {
        if (!this.threadContainer) return;

        // Simple thread status display
        const statusText = `Thread ${threadId}: [${status}]`;
        const coloredText = `{${color}-fg}${statusText}{/${color}-fg}`;
        
        // For now, just set content - later we can make this more dynamic
        const currentContent = this.threadContainer.content || '';
        const newContent = currentContent + '\n' + coloredText;
        
        this.threadContainer.setContent(newContent);
        this.screen?.render();
    }

    /**
     * Clear thread status display
     */
    clearThreadStatus(): void {
        if (this.threadContainer) {
            this.threadContainer.setContent('');
            this.screen?.render();
        }
    }

    /**
     * Log message to console (will appear in right column)
     */
    log(message: string): void {
        console.log(message);
    }

    /**
     * Log error message to console (will appear in right column)
     */
    logError(message: string): void {
        console.error(message);
    }

    /**
     * Restore original console functions
     */
    restoreConsole(): void {
        console.log = this.originalConsoleLog;
        console.error = this.originalConsoleError;
    }

    /**
     * Clean up and destroy screen
     */
    cleanup(): void {
        this.restoreConsole();
        if (this.screen && !this.screen.destroyed) {
            this.screen.destroy();
        }
    }

    /**
     * Test the UI frame with sample data
     */
    async testUIFrame(): Promise<void> {
        this.log('🚀 Starting UI frame test...');
        
        // Add some thread status
        this.addThreadStatus('1', 'WAITING', 'gray');
        this.addThreadStatus('2', 'WAITING', 'gray');
        this.addThreadStatus('3', 'WAITING', 'gray');
        this.addThreadStatus('4', 'WAITING', 'gray');
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        this.log('📊 Thread status initialized');
        
        // Simulate some activity
        for (let i = 1; i <= 4; i++) {
            this.clearThreadStatus();
            
            for (let j = 1; j <= 4; j++) {
                if (j < i) {
                    this.addThreadStatus(j.toString(), 'COMPLETE', 'green');
                } else if (j === i) {
                    this.addThreadStatus(j.toString(), 'RUNNING', 'yellow');
                } else {
                    this.addThreadStatus(j.toString(), 'WAITING', 'gray');
                }
            }
            
            this.log(`⏳ Thread ${i} is now running...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            this.log(`✅ Thread ${i} completed successfully`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        this.log('🎉 UI frame test completed! All threads finished.');
        this.log('Press ESC, q, or Ctrl+C to exit.');
    }
} 