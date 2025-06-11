#!/usr/bin/env node

/**
 * Test Runner for Agility CLI
 * 
 * Uses the test-instances.json configuration to run systematic tests
 * across different source and target instance combinations.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Load test configuration
const configPath = path.join(__dirname, '../config/test-instances.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * Print available test scenarios
 */
function showHelp() {
    console.log('🧪 Agility CLI Test Runner');
    console.log('========================\n');
    
    console.log('📋 Available Source Instances:');
    Object.entries(config.sourceInstances).forEach(([key, instance]) => {
        console.log(`  ${key.padEnd(8)} - ${instance.name} (${instance.entityCount.toLocaleString()} entities)`);
        console.log(`             ${instance.description}`);
    });
    
    console.log('\n🎯 Available Target Instances:');
    Object.entries(config.targetInstances).forEach(([key, instance]) => {
        console.log(`  ${key.padEnd(8)} - ${instance.name}`);
        console.log(`             ${instance.description}`);
    });
    
    console.log('\n🔬 Predefined Test Scenarios:');
    Object.entries(config.testScenarios).forEach(([key, scenario]) => {
        console.log(`  ${key.padEnd(8)} - ${scenario.description}`);
    });
    
    console.log('\n🚀 Usage Examples:');
    console.log('  node scripts/test-runner.js scenario basic');
    console.log('  node scripts/test-runner.js sync medium target1');
    console.log('  node scripts/test-runner.js analyze small');
    console.log('  node scripts/test-runner.js pull large');
}

/**
 * Get instance GUID from configuration
 */
function getInstanceGuid(type, key) {
    const instances = type === 'source' ? config.sourceInstances : config.targetInstances;
    if (!instances[key]) {
        console.error(`❌ Unknown ${type} instance: ${key}`);
        console.log(`Available ${type} instances: ${Object.keys(instances).join(', ')}`);
        process.exit(1);
    }
    return instances[key].guid;
}

/**
 * Run a CLI command with the given arguments
 */
function runCommand(command, args) {
    console.log(`🚀 Running: node dist/index.js ${command} ${args.join(' ')}`);
    
    const child = spawn('node', ['dist/index.js', command, ...args], {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
    
    child.on('close', (code) => {
        if (code === 0) {
            console.log(`✅ Command completed successfully`);
        } else {
            console.log(`❌ Command failed with exit code ${code}`);
        }
    });
}

/**
 * Run a predefined test scenario
 */
function runScenario(scenarioKey) {
    const scenario = config.testScenarios[scenarioKey];
    if (!scenario) {
        console.error(`❌ Unknown scenario: ${scenarioKey}`);
        console.log(`Available scenarios: ${Object.keys(config.testScenarios).join(', ')}`);
        process.exit(1);
    }
    
    console.log(`🔬 Running scenario: ${scenarioKey}`);
    console.log(`📝 Description: ${scenario.description}\n`);
    
    if (scenario.sources && scenario.targets) {
        // Parallel testing scenario
        console.log('⚠️  Parallel testing not yet implemented');
        console.log('🔄 Running first combination for now...');
        const sourceGuid = getInstanceGuid('source', scenario.sources[0]);
        const targetGuid = getInstanceGuid('target', scenario.targets[0]);
        runCommand('sync', ['--sourceGuid', sourceGuid, '--targetGuid', targetGuid, '--locale', 'en-us', '--channel', 'website', '--verbose', '--test']);
    } else {
        // Single scenario
        const sourceGuid = getInstanceGuid('source', scenario.source);
        const targetGuid = getInstanceGuid('target', scenario.target);
        runCommand('sync', ['--sourceGuid', sourceGuid, '--targetGuid', targetGuid, '--locale', 'en-us', '--channel', 'website', '--verbose', '--test']);
    }
}

/**
 * Main command processor
 */
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        showHelp();
        return;
    }
    
    const command = args[0];
    
    switch (command) {
        case 'help':
        case '--help':
        case '-h':
            showHelp();
            break;
            
        case 'scenario':
            if (args.length < 2) {
                console.error('❌ Please specify a scenario name');
                showHelp();
                process.exit(1);
            }
            runScenario(args[1]);
            break;
            
        case 'sync':
            if (args.length < 3) {
                console.error('❌ Please specify source and target instances');
                console.log('Usage: node scripts/test-runner.js sync <source> <target>');
                process.exit(1);
            }
            const sourceGuid = getInstanceGuid('source', args[1]);
            const targetGuid = getInstanceGuid('target', args[2]);
            runCommand('sync', ['--sourceGuid', sourceGuid, '--targetGuid', targetGuid, '--locale', 'en-us', '--channel', 'website', '--verbose', '--test']);
            break;
            
        case 'analyze':
        case 'pull':
            if (args.length < 2) {
                console.error(`❌ Please specify a source instance`);
                console.log(`Usage: node scripts/test-runner.js ${command} <source>`);
                process.exit(1);
            }
            const guid = getInstanceGuid('source', args[1]);
            const cliArgs = ['--guid', guid, '--locale', 'en-us', '--channel', 'website', '--verbose'];
            if (command === 'analyze') {
                // For analyze, use sync command with test flag
                runCommand('sync', ['--sourceGuid', guid, '--targetGuid', 'test', ...cliArgs.slice(1), '--test']);
            } else {
                runCommand('pull', cliArgs);
            }
            break;
            
        case 'list':
            console.log('📋 Instance Configuration Summary:');
            console.log(`Total Source Instances: ${Object.keys(config.sourceInstances).length}`);
            console.log(`Total Target Instances: ${Object.keys(config.targetInstances).length}`);
            console.log(`Total Validated Entities: ${config.metadata.totalValidatedEntities.toLocaleString()}`);
            console.log(`Validation Status: ${config.metadata.validationStatus}`);
            break;
            
        default:
            console.error(`❌ Unknown command: ${command}`);
            showHelp();
            process.exit(1);
    }
}

// Run the main function
main(); 