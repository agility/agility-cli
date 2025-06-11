#!/usr/bin/env node

/**
 * Direct Container Existence Check
 * 
 * Verifies if containers actually exist in target instance
 * vs just being cached in reference mapper
 */

const mgmtApi = require('@agility/management-sdk');

const apiClient = new mgmtApi.ApiClient({
  baseUrl: 'https://mgmt.aglty.io',
  token: process.env.AGILITY_API_TOKEN
});

async function checkContainers() {
  console.log('🧪 Direct Container Existence Check\n');
  
  const testContainers = [
    'editors_ArticleListing',
    'changelog_BlockEditor',
    'angular_ArticleListing',
    'appsarticles',
    'sveltekitarticles',
    'doccategories'
  ];
  
  for (const containerName of testContainers) {
    try {
      const container = await apiClient.containerMethods.getContainerByReferenceName(containerName, '90c39c80-u');
      console.log(`✅ ${containerName}: EXISTS (ID: ${container.contentViewID})`);
    } catch (error) {
      console.log(`❌ ${containerName}: NOT FOUND (${error.message})`);
    }
  }
}

checkContainers().catch(console.error); 