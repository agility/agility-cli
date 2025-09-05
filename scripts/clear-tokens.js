#!/usr/bin/env node

/**
 * Clear all cached Agility CLI authentication tokens
 * This script provides a clean way to reset authentication state
 */

async function clearTokens() {
  try {
    const keytar = require('keytar');
    const SERVICE_NAME = 'agility-cli';
    
    console.log('🔍 Looking for cached Agility CLI tokens...');
    
    const accounts = await keytar.findCredentials(SERVICE_NAME);
    
    if (accounts.length === 0) {
      console.log('✅ No cached tokens found - authentication state is already clean');
      return;
    }
    
    console.log(`🧹 Found ${accounts.length} cached token(s), clearing...`);
    
    for (const account of accounts) {
      await keytar.deletePassword(SERVICE_NAME, account.account);
      console.log(`   ✓ Cleared: ${account.account}`);
    }
    
    console.log(`✅ Successfully cleared ${accounts.length} authentication token(s)`);
    console.log('💡 You will need to re-authenticate on your next CLI command');
    
  } catch (error) {
    console.error('❌ Error clearing tokens:', error.message);
    console.log('💡 This might happen if keytar is not available on your system');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  clearTokens().catch(console.error);
}

module.exports = { clearTokens };
