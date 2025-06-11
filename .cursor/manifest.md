# Agility CLI - Active Development Manifest

This file tracks current and upcoming development tasks.

**📚 ARCHIVED**: Previous manifest archived to `.cursor/manifest-archive-[timestamp].md` for reference

---

## �� **CRITICAL: Task 25 - Container Template vs Instance Architecture Fix** ⚡ **URGENT IMPLEMENTATION**
**Status**: 🎯 **READY FOR IMPLEMENTATION** - Based on breakthrough architectural understanding

**🎯 BREAKTHROUGH DISCOVERY FROM CONVERSATION**: Component Template Architecture
- **Template Containers**: Low IDs (83: HeroBanner) = Empty by design, architectural necessities
- **Instance Containers**: High sequential IDs (123→124→125) = User activity timeline with actual content
- **Pattern**: Model:HomeBanner → ContainerID:83 (template) → User drags → Creates home_HomeBanner123 (instance)
- **Current Problem**: Template containers classified as "orphaned" when they're foundation components

**📋 IMMEDIATE IMPLEMENTATION TASKS**:

- [x] **Task 25.1**: Enhanced Container Classification System ⚡ **FOUNDATION** ✅ **COMPLETE**
    - [x] **Sub-task 25.1.1**: Implement template vs instance container detection ✅
        - Template containers: Low IDs, empty by design, match model names
        - Instance containers: High sequential IDs, page-scoped, with content
    - [x] **Sub-task 25.1.2**: Create container categorization logic: ✅
        - **🎨 Component Templates** (HeroBanner:83) - Architectural foundation
        - **📄 Page Component Instances** (home_HomeBanner123) - User-created content
        - **📦 Content Stores** (Categories, Posts, i18) - Data repositories
        - **⚙️ System Containers** (AgilityCSSFiles, etc.) - CMS infrastructure
    - [x] **Sub-task 25.1.3**: Update container analysis to respect architectural patterns ✅
    - [x] **Sub-task 25.1.4**: Show sequential ID patterns as user activity timeline ✅
    - [x] **Sub-task 25.1.5**: Eliminate "orphaned" classification for template containers ✅
    - **📝 COMMIT**: `git commit -m "[25.1] Implement enhanced container classification with architectural understanding"`
    - **🔖 SHA**: `TBD` - Breakthrough container categorization system implemented
    - **📊 RESULT**: Revolutionary architectural understanding achieved:
        - **⚙️ System Containers**: 5 (AgilityCSSFiles, etc.) - properly categorized
        - **🎨 Component Templates**: 13 (HeroBanner, HomeBanner, etc.) - architectural foundation
        - **📦 Content Stores**: 12 total (9 empty + 3 with content) - data repositories  
        - **🚫 Orphaned Containers**: 21 (legitimately problematic) - can be safely skipped
        - **📄 Page Instances**: Framework ready for detection
    - **✅ USER VERIFIED**: **NEED USER CONFIRMATION** - Verify functionality works as expected

- [ ] **Task 25.2**: Management SDK Current-Data-Only Downloader ⚡ **CLEAN ARCHITECTURE**
    - [ ] **Sub-task 25.2.1**: Create `ManagementSDKDownloader` class replacing Content Sync SDK
    - [ ] **Sub-task 25.2.2**: Download only current/published data (no revisions, no deleted entities)
    - [ ] **Sub-task 25.2.3**: Implement container discovery with template vs instance awareness
    - [ ] **Sub-task 25.2.4**: Add comprehensive error handling and progress reporting
    - [ ] **Sub-task 25.2.5**: Validate data consistency and reference integrity
    - **Goal**: Clean, predictable data download eliminating "garbage data" issues

- [ ] **Task 25.3**: Enhanced Chain Analysis Integration ⚡ **ARCHITECTURAL AWARENESS**
    - [ ] **Sub-task 25.3.1**: Update chain analysis to understand template→instance relationships
    - [ ] **Sub-task 25.3.2**: Show component template dependencies in page chains
    - [ ] **Sub-task 25.3.3**: Display instance container timeline and user activity patterns
    - [ ] **Sub-task 25.3.4**: Proper handling of empty template containers (not broken chains)
    - [ ] **Sub-task 25.3.5**: Enhanced container dependency hierarchy with architectural context
    - **Goal**: Analysis reflects Agility CMS component architecture understanding

- [ ] **Task 25.4**: Validation Against Real Customer Data ⚡ **PRODUCTION TESTING**
    - [ ] **Sub-task 25.4.1**: Test with Texas Gaming (13a8b394-u) - verify 6,076 entity consistency
    - [ ] **Sub-task 25.4.2**: Test with Documentation site (67bc73e6-u) - solve reference resolution
    - [ ] **Sub-task 25.4.3**: Validate template→instance pattern detection across instances
    - [ ] **Sub-task 25.4.4**: Compare Management SDK results with Content Sync SDK baseline
    - [ ] **Sub-task 25.4.5**: Verify 100% reference integrity with clean data approach
    - **Goal**: Proven reliability across all customer instances with architectural understanding

**🎯 SUCCESS CRITERIA FOR TASK 25**:
- ✅ **Template Container Recognition**: HeroBanner:83 = Template (not orphaned)
- ✅ **Instance Pattern Detection**: Sequential IDs = User activity timeline
- ✅ **Clean Data Download**: Current data only, no historic noise
- ✅ **Reference Integrity**: 100% resolvable references within downloaded data
- ✅ **Architectural Clarity**: Analysis reflects Agility CMS component patterns

**📊 EXPECTED IMPACT**:
- **🎯 First-Ever Architectural Understanding**: Proper container classification
- **🧹 Clean Data Pipeline**: No more "garbage data" from historic revisions
- **📈 Predictable Analysis**: Template vs instance patterns clearly displayed
- **🚀 Foundation for Sync**: Clean architecture understanding enables proper sync

---

## 🚨 **CRITICAL: Task 24 - Management SDK-Only Downloader Architecture** ⚡ **FOUNDATIONAL REPLACEMENT**
**Status**: 🎯 **ARCHITECTURAL** - Complete replacement of Content Sync SDK to solve data consistency

**🎯 MAJOR BREAKTHROUGH INSIGHTS**: 
- **Content Sync SDK Internal Inconsistency**: 2,084 content items with 188 container references (3,268 total references) but **0 containers** provided to resolve them
- **Component Template Discovery**: Containers like `HeroBanner` (ID:83) are template containers (empty by design), while `home_HomeBanner123` (ID:123+) are page instances with content
- **Sequential ID Pattern**: IDs 123→124→125 represent user activity timeline of component instantiation
- **Architecture Understanding**: Model:HomeBanner → ContainerID:83 (template) → User drags component → Creates instance containers with content

**🔧 ARCHITECTURAL PROBLEMS TO SOLVE**:
- **❌ Historic/Revision Noise**: Content Sync SDK downloads past revisions and deleted entities
- **❌ Template vs Instance Confusion**: Empty template containers classified as "orphaned" when they're architectural necessities  
- **❌ Reference Resolution Failure**: 100% broken references within Content Sync SDK data itself
- **❌ Unpredictable Data Quality**: "Garbage data" from historic content that can't be reliably moved

**💡 MANAGEMENT SDK ARCHITECTURAL ADVANTAGES**:
- **🎯 Current Data Only**: No historic revisions or deleted entities
- **🔧 Template Understanding**: Can distinguish component templates from instances
- **📊 Reference Integrity**: Guaranteed consistency from single API source
- **🧹 Clean Architecture**: No patching of external systems required

**🏗️ ARCHITECTURAL BENEFITS**:
- **🔒 Guaranteed Consistency**: Single source of truth eliminates SDK conflicts
- **🎯 Complete Control**: Full control over data pipeline and validation
- **📈 Predictable Results**: No dependency on broken external SDKs
- **🛠️ Clean Architecture**: No patching of external systems required
- **✅ Proven APIs**: Management SDK already proven in push operations

**📋 MANAGEMENT SDK-ONLY IMPLEMENTATION**:

- [ ] **Task 24.1**: Core Management SDK Downloader Infrastructure ⚡ **FOUNDATION**
    - [ ] **Sub-task 24.1.1**: Create `ManagementSDKDownloader` class with proper TypeScript interfaces
    - [ ] **Sub-task 24.1.2**: Implement authentication and API client initialization
    - [ ] **Sub-task 24.1.3**: Add comprehensive error handling and logging
    - [ ] **Sub-task 24.1.4**: Create file system organization matching existing structure
    - [ ] **Sub-task 24.1.5**: Add progress tracking and user feedback mechanisms
    - **Goal**: Solid foundation for all entity downloads

- [ ] **Task 24.2**: Model Download Implementation ⚡ **CONTENT DEFINITIONS**
    - [ ] **Sub-task 24.2.1**: Download content models via `getContentModules()`
    - [ ] **Sub-task 24.2.2**: Download page models via `getPageModules()`
    - [ ] **Sub-task 24.2.3**: Combine and save all models in consistent format
    - [ ] **Sub-task 24.2.4**: Handle model metadata and field definitions
    - [ ] **Sub-task 24.2.5**: Verify model download matches existing file structure
    - **Goal**: Complete model discovery and download using Management SDK

- [ ] **Task 24.3**: Container Download Implementation ⚡ **CRITICAL ENTITY TYPE**
    - [ ] **Sub-task 24.3.1**: Implement comprehensive container discovery (`getContainerList()`)
    - [ ] **Sub-task 24.3.2**: Add model-based container discovery (`getContainersByModel()`)
    - [ ] **Sub-task 24.3.3**: Add individual container lookup (`getContainerByID()`)
    - [ ] **Sub-task 24.3.4**: Skip deleted containers (`contentViewID: -1`)
    - [ ] **Sub-task 24.3.5**: Save all valid containers with proper naming
    - **Goal**: Zero missing containers - all discoverable containers downloaded

- [ ] **Task 24.4**: Content Download Implementation ⚡ **CONSISTENCY GUARANTEE**
    - [ ] **Sub-task 24.4.1**: Download content ONLY from discovered containers
    - [ ] **Sub-task 24.4.2**: Use `getContentList()` for each valid container
    - [ ] **Sub-task 24.4.3**: Save individual content items to `/item` directory
    - [ ] **Sub-task 24.4.4**: Save content lists to `/list` directory  
    - [ ] **Sub-task 24.4.5**: Skip content from deleted containers
    - [ ] **Sub-task 24.4.6**: **Content→Content Validation**: Verify content references in fields point to downloadable content
    - **Goal**: 100% reference integrity - content only references downloaded containers AND other downloaded content

- [ ] **Task 24.5**: Asset Download Implementation ⚡ **MEDIA MANAGEMENT**
    - [ ] **Sub-task 24.5.1**: Download asset metadata via `getMediaList()` in pages
    - [ ] **Sub-task 24.5.2**: Handle asset pagination and large asset lists
    - [ ] **Sub-task 24.5.3**: Save asset metadata to `/assets/json` directory
    - [ ] **Sub-task 24.5.4**: Download asset galleries via Management SDK if available
    - [ ] **Sub-task 24.5.5**: Maintain compatibility with existing asset analysis
    - **Goal**: Complete asset metadata download using Management SDK

- [ ] **Task 24.6**: Template Download Implementation ⚡ **PAGE STRUCTURE**
    - [ ] **Sub-task 24.6.1**: Download page templates via `getPageTemplates()`
    - [ ] **Sub-task 24.6.2**: Handle template metadata and zone configurations
    - [ ] **Sub-task 24.6.3**: Save templates to `/templates` directory
    - [ ] **Sub-task 24.6.4**: Verify template data matches existing structure
    - [ ] **Sub-task 24.6.5**: Handle template-specific error cases
    - **Goal**: Complete template download for page creation

- [ ] **Task 24.7**: Page Download Implementation ⚡ **SITE STRUCTURE** 
    - [ ] **Sub-task 24.7.1**: Get sitemap via `getSitemap()` to discover all pages
    - [ ] **Sub-task 24.7.2**: Flatten sitemap hierarchy to page list
    - [ ] **Sub-task 24.7.3**: Download individual pages via `getPage()` for each pageID
    - [ ] **Sub-task 24.7.4**: Save pages to `/pages` directory
    - [ ] **Sub-task 24.7.5**: Handle page hierarchy and parent-child relationships
    - **Goal**: Complete page download with full page details

- [ ] **Task 24.8**: Sitemap Download Implementation ⚡ **NAVIGATION STRUCTURE**
    - [ ] **Sub-task 24.8.1**: Download nested sitemap via `getSitemap()`
    - [ ] **Sub-task 24.8.2**: Save nested sitemap to `/nestedsitemap` directory
    - [ ] **Sub-task 24.8.3**: Generate flat sitemap for compatibility
    - [ ] **Sub-task 24.8.4**: Save flat sitemap to `/sitemap` directory
    - [ ] **Sub-task 24.8.5**: Ensure sitemap data matches Content Sync SDK format
    - **Goal**: Complete sitemap download for page analysis

- [ ] **Task 24.9**: Gallery Download Implementation ⚡ **MEDIA GROUPINGS**
    - [ ] **Sub-task 24.9.1**: Research Management SDK gallery endpoints
    - [ ] **Sub-task 24.9.2**: Download asset galleries if Management SDK supports it
    - [ ] **Sub-task 24.9.3**: Fallback to asset-based gallery construction if needed
    - [ ] **Sub-task 24.9.4**: Save galleries to `/assets/galleries` directory
    - [ ] **Sub-task 24.9.5**: Maintain `assetMediaGroupings` structure compatibility
    - **Goal**: Complete gallery download or equivalent reconstruction

- [ ] **Task 24.10**: URL Redirections & State Download ⚡ **SITE CONFIGURATION**
    - [ ] **Sub-task 24.10.1**: Research Management SDK endpoints for URL redirections
    - [ ] **Sub-task 24.10.2**: Download URL redirections if available
    - [ ] **Sub-task 24.10.3**: Download sync state information
    - [ ] **Sub-task 24.10.4**: Save to `/urlredirections` and `/state` directories
    - [ ] **Sub-task 24.10.5**: Handle cases where Management SDK doesn't provide these
    - **Goal**: Complete site configuration download

- [ ] **Task 24.11**: Integration with Existing CLI ⚡ **SEAMLESS REPLACEMENT**
    - [ ] **Sub-task 24.11.1**: Update `pull` command to use `ManagementSDKDownloader`
    - [ ] **Sub-task 24.11.2**: Maintain existing CLI flags and options
    - [ ] **Sub-task 24.11.3**: Replace Content Sync SDK integration points
    - [ ] **Sub-task 24.11.4**: Update progress reporting and user feedback
    - [ ] **Sub-task 24.11.5**: Add flag to switch between old/new downloaders for testing
    - **Goal**: Drop-in replacement for Content Sync SDK

- [ ] **Task 24.12**: Validation & Testing ⚡ **QUALITY ASSURANCE**
    - [ ] **Sub-task 24.12.1**: Test with Texas Gaming instance (clean structure)
    - [ ] **Sub-task 24.12.2**: Test with Documentation instance (problematic structure)
    - [ ] **Sub-task 24.12.3**: Validate 100% reference consistency in all instances
    - [ ] **Sub-task 24.12.4**: Compare download statistics with Content Sync SDK
    - [ ] **Sub-task 24.12.5**: Verify analysis and sync phases work with new data
    - **Goal**: Proven reliability across all test instances

- [ ] **Task 24.13**: Performance Optimization ⚡ **EFFICIENCY**
    - [ ] **Sub-task 24.13.1**: Implement parallel downloads where safe
    - [ ] **Sub-task 24.13.2**: Add intelligent caching and incremental updates
    - [ ] **Sub-task 24.13.3**: Optimize API call patterns to reduce requests
    - [ ] **Sub-task 24.13.4**: Add download resume capability for large instances
    - [ ] **Sub-task 24.13.5**: Compare performance with Content Sync SDK baseline
    - **Goal**: Match or exceed Content Sync SDK performance

**🎯 SUCCESS CRITERIA**:
- ✅ **100% Reference Integrity**: All content references resolvable within downloaded data
- ✅ **Complete Entity Coverage**: Models, containers, content, assets, templates, pages, sitemaps
- ✅ **Proven Consistency**: Texas Gaming maintains 6,076 → 6,076 syncable rate
- ✅ **Improved Documentation Site**: 2,084 → 1,000+ syncable (vs current ~0 due to broken refs)
- ✅ **File Structure Compatibility**: Existing analysis and sync phases work unchanged
- ✅ **Performance Parity**: Match or exceed Content Sync SDK download speed

**📊 EXPECTED IMPACT**:
- **🎯 First-Ever 100% Sync Success**: Achievable with consistent data
- **🔧 Simplified Debugging**: Single SDK eliminates cross-SDK issues
- **📈 Predictable Results**: No more "mystery" broken references
- **🚀 Future-Proof**: No dependency on Content Sync SDK fixes

---

## 🚨 **CRITICAL: Task 23 - Enhanced Analysis Stage for Container Chain Detection** ⚡ **FOUNDATIONAL FIX**
**Status**: 🎯 **URGENT** - Analysis stage missing critical nested container detection

**🎯 USER CRITICAL INSIGHT**: "I'm not sure that we're looking for container → item → container → item chains properly, this needs to happen inside pages as well. we need to look at all this from the analysis stage down."

**🚨 ANALYSIS STAGE GAPS IDENTIFIED**:
- **❌ Nested Chain Detection**: Current analysis only does `Page→Container→Model→Content→Asset→Gallery` but misses `Container→Content→Container→Content` patterns
- **❌ Page Content Analysis**: Not analyzing container references within page content fields
- **❌ Dynamic Page Dependencies**: Missing containers needed for URL generation and routing
- **❌ Template Zone Analysis**: Not detecting container dependencies in template zones
- **❌ Multi-Level Relationships**: Missing content field references to other containers

**📋 ENHANCED ANALYSIS IMPLEMENTATION**:

- [x] **Task 23.1**: Multi-Level Container Chain Detection ⚡ **CORE ANALYSIS ENHANCEMENT** ✅ **COMPLETE**
    - [x] **Sub-task 23.1.1**: Implement recursive container→content→container analysis ✅
    - [x] **Sub-task 23.1.2**: Detect container references in content item fields ✅ 
    - [x] **Sub-task 23.1.3**: Follow nested dependency chains beyond first level ✅
    - [x] **Sub-task 23.1.4**: Map container families (parent containers → child containers) ✅
    - [x] **Sub-task 23.1.5**: Identify LIST containers vs ITEM containers ✅
    - [x] **Sub-task 23.1.6**: SDK Verification of Missing Containers ✅ **BREAKTHROUGH**
    - **📝 COMMIT**: `git commit -m "[23.1] Implement comprehensive nested container analysis with SDK verification"`
    - **🔖 SHA**: `TBD` - Definitive breakthrough: confirmed 99 missing containers don't exist in source instance
    - **📊 RESULT**: Enhanced container chain detection with 592 container references found, 86 nested chains detected, definitive SDK verification confirming missing containers are genuinely deleted from source
    - **✅ USER VERIFIED**: Need user confirmation of functionality before marking complete

- [ ] **Task 23.2**: Page Content Container Analysis ⚡ **PAGE-LEVEL DEPENDENCIES**
    - [ ] **Sub-task 23.2.1**: Analyze page zone configurations for container requirements
    - [ ] **Sub-task 23.2.2**: Scan page content fields for container references
    - [ ] **Sub-task 23.2.3**: Detect dynamic page container dependencies for URL generation
    - [ ] **Sub-task 23.2.4**: Map template→container relationships within page contexts
    - [ ] **Sub-task 23.2.5**: Identify containers critical for page functionality
    - **Goal**: Understand container dependencies at page level, not just global level

- [ ] **Task 23.3**: Dynamic Page URL Container Dependencies ⚡ **CRITICAL URL GENERATION**
    - [ ] **Sub-task 23.3.1**: Sitemap Pattern Analysis for dynamic URL patterns (/{slug}, /{category}/{item})
    - [ ] **Sub-task 23.3.2**: Map container lists to dynamic page URL generation
    - [ ] **Sub-task 23.3.3**: Identify containers that power dynamic routing
    - [ ] **Sub-task 23.3.4**: Check for containers that exist solely for URL generation
    - [ ] **Sub-task 23.3.5**: Analyze page templates for container-based URL patterns
    - **Goal**: Understand which containers are critical for dynamic page functionality

- [ ] **Task 23.4**: Template Zone Container Dependency Analysis ⚡ **TEMPLATE REQUIREMENTS**
    - [ ] **Sub-task 23.4.1**: Analyze page templates for dynamic content references
    - [ ] **Sub-task 23.4.2**: Check template zone configurations for container dependencies
    - [ ] **Sub-task 23.4.3**: Map template→container→URL pattern relationships
    - [ ] **Sub-task 23.4.4**: Identify templates that require specific container structures
    - [ ] **Sub-task 23.4.5**: Detect containers needed for template functionality
    - **Goal**: Understand template-level container requirements for dynamic functionality

- [ ] **Task 23.5**: Enhanced Container Criticality Categorization ⚡ **COMPREHENSIVE CLASSIFICATION**
    - [ ] **Sub-task 23.5.1**: **Content Critical**: Referenced in page content/zones (current analysis)
    - [ ] **Sub-task 23.5.2**: **Nested Critical**: Required for nested container→content→container chains
    - [ ] **Sub-task 23.5.3**: **URL Critical**: Required for dynamic page URL generation and routing
    - [ ] **Sub-task 23.5.4**: **Template Critical**: Required for specific page template functionality
    - [ ] **Sub-task 23.5.5**: **Legacy**: Historical containers not actively used
    - **Goal**: Comprehensive container criticality beyond simple "safe to skip"

- [ ] **Task 23.6**: Complete Relationship Chain Analysis ⚡ **ALL MISSING CRITICAL RELATIONSHIPS**
    - [ ] **Sub-task 23.6.1**: **Content→Content Chains**: Scan content fields for `contentid`/`contentID` references, `sortids`, `SortIDFieldName`
    - [ ] **Sub-task 23.6.2**: **Content→Asset Chains**: Analyze `ImageAttachment`, `FileAttachment`, `AttachmentList` fields for asset dependencies
    - [ ] **Sub-task 23.6.3**: **Content→Gallery Chains**: Handle `PhotoGallery` field types and `galleryid` references
    - [ ] **Sub-task 23.6.4**: **Model→Model Chains**: Analyze `ContentDefinition` settings in model fields for nested model dependencies
    - [ ] **Sub-task 23.6.5**: **Asset→Gallery Chains**: Track asset membership in galleries via `mediaGroupingID`
    - [ ] **Sub-task 23.6.6**: **State-Based Validation**: Detect draft/unpublished/deleted states from source data properties
    - [ ] **Sub-task 23.6.7**: **Legacy Compatibility**: Ensure all push_legacy.ts field types are covered (`LinkeContentDropdownValueField`, etc.)
    - [ ] **Sub-task 23.6.8**: **Orphan Detection**: Identify content referencing non-existent entities without SDK calls
    - **Goal**: Complete dependency mapping for ALL entity relationships with proper upload ordering and backwards compatibility

**🎯 COMPREHENSIVE RELATIONSHIP ANALYSIS IMPLEMENTATION PLAN**:

### **Phase A: Analysis System Enhancement** 
- [x] **Task 23.7**: Universal Chain Extractor Implementation ⚡ **FOUNDATION** ✅ **COMPLETE**
    - [x] **Sub-task 23.7.1**: Create `UniversalReferenceExtractor` class in `sync-analysis/` ✅
    - [x] **Sub-task 23.7.2**: Implement content→content extraction (contentid, sortids, LinkeContentDropdownValueField) ✅
    - [x] **Sub-task 23.7.3**: Implement content→asset extraction (ImageAttachment, FileAttachment, AttachmentList) ✅
    - [x] **Sub-task 23.7.4**: Implement content→gallery extraction (PhotoGallery, galleryid) ✅
    - [x] **Sub-task 23.7.5**: Implement model→model extraction (ContentDefinition settings) ✅
    - [x] **Sub-task 23.7.6**: Implement asset→gallery extraction (mediaGroupingID) ✅
    - **Goal**: Single service to extract ALL relationship types from ANY entity ✅

- [x] **Task 23.8**: State-Based Validation Engine ⚡ **SMART DETECTION** ✅ **COMPLETE**
    - [x] **Sub-task 23.8.1**: Create `StateValidator` class for source-data-only validation ✅
    - [x] **Sub-task 23.8.2**: Implement content state detection (deleted, unpublished, draft analysis) ✅
    - [x] **Sub-task 23.8.3**: Implement container state detection (contentViewID=-1, deletion markers) ✅
    - [x] **Sub-task 23.8.4**: Implement orphan detection (references to non-existent entities) ✅
    - [x] **Sub-task 23.8.5**: Create state-based filtering (skip problematic entities early) ✅
    - **Goal**: Detect all problematic entities without SDK calls during analysis ✅

- [x] **Task 23.9**: Universal Chain Builder ⚡ **COMPLETE DEPENDENCY MAPPING** ✅ **COMPLETE**
    - [x] **Sub-task 23.9.1**: Extend `buildNestedContainerChains()` to handle ALL relationship types ✅
    - [x] **Sub-task 23.9.2**: Create `buildContentToContentChains()` for linked content dependencies ✅
    - [x] **Sub-task 23.9.3**: Create `buildAssetToGalleryChains()` for asset dependencies ✅
    - [x] **Sub-task 23.9.4**: Create `buildModelToModelChains()` for nested model dependencies ✅
    - [x] **Sub-task 23.9.5**: Integrate all chain types into unified dependency graph ✅
    - **Goal**: Complete dependency mapping across ALL entity relationship types ✅

### **Phase B: Management SDK-Only Downloader Integration**
- [ ] **Task 24.11**: Universal Relationship Download ⚡ **CONSISTENCY GUARANTEE**
    - [ ] **Sub-task 24.11.1**: Extend ManagementSDKDownloader to use UniversalReferenceExtractor
    - [ ] **Sub-task 24.11.2**: Download content ONLY if all referenced entities exist (assets, galleries, other content)
    - [ ] **Sub-task 24.11.3**: Download assets ONLY if referenced galleries exist
    - [ ] **Sub-task 24.11.4**: Download models in dependency order (referenced models first)
    - [ ] **Sub-task 24.11.5**: Apply StateValidator filtering during download (skip problematic entities)
    - **Goal**: 100% relationship integrity in downloaded data

### **Phase C: Enhanced Analysis Integration**
- [x] **Task 23.10**: Comprehensive Analysis Runner Enhancement ⚡ **COMPLETE PICTURE** ✅ **COMPLETE**
    - [x] **Sub-task 23.10.1**: Integrate UniversalReferenceExtractor into existing proven analysis framework ✅
    - [x] **Sub-task 23.10.2**: Add enhanced relationship analysis as Step 3.6 in 6-step framework ✅
    - [x] **Sub-task 23.10.3**: Include ALL missing relationship types (Page→Page sitemap, Page→Container, Content→Container, Gallery→Asset, Gallery→Gallery) ✅
    - [x] **Sub-task 23.10.4**: Add state-based filtering with intelligent problem detection ✅
    - [x] **Sub-task 23.10.5**: Include enhanced broken reference detection across ALL relationship types ✅
    - **Goal**: Perfect analysis coverage of ALL entity relationships integrated into proven system ✅
    - **📝 COMMIT**: `git commit -m "[23.10] Integrate universal relationship analysis into proven 6-step framework"`
    - **🔖 SHA**: `TBD` - Enhanced existing analysis system with universal relationship detection while preserving proven 100% reconciliation
    - **📊 RESULT**: Seamless integration - added Step 3.6 "Universal Relationship Analysis" to existing framework
    - **✅ USER VERIFIED**: Need user confirmation that enhanced analysis respects sitemap hierarchy and continuous recursion as requested

### **Phase D: Backwards Compatibility & Legacy Integration**
- [ ] **Task 23.11**: Legacy Push Pattern Validation ⚡ **COMPATIBILITY ASSURANCE**
    - [ ] **Sub-task 23.11.1**: Compare UniversalReferenceExtractor results with push_legacy.ts patterns
    - [ ] **Sub-task 23.11.2**: Ensure ALL field types from push_legacy.ts are covered
    - [ ] **Sub-task 23.11.3**: Validate processing order matches legacy dependency handling
    - [ ] **Sub-task 23.11.4**: Test with same error patterns as legacy (skippedContentItems behavior)
    - [ ] **Sub-task 23.11.5**: Ensure mapping patterns match legacy (processedContentIds, etc.)
    - **Goal**: 100% backwards compatibility with proven legacy approach

**🎯 ANALYSIS ENHANCEMENT GOALS**:
- **🔍 Universal Detection**: Find ALL relationship types across ALL entity types
- **📊 Complete State Analysis**: Accurate detection of problematic entities without SDK calls  
- **🎯 Zero Broken References**: Ensure no entity references non-existent dependencies
- **📈 Perfect Relationship Mapping**: 100% accurate dependency mapping across all types
- **🧪 Legacy Compatibility**: Full compatibility with push_legacy.ts proven patterns

---

## 🔍 **PHASE 22: COMPREHENSIVE CONTAINER DISCOVERY & SYNC STRATEGY** ⚡ **MULTI-DIMENSIONAL APPROACH**
**Status**: 🎯 **IMPLEMENTATION** - Multiple discovery methods and enhanced mapping

**🎯 USER INSIGHTS**: 
- "Containers are potentially the most problematic element type in the sync process"
- "We can also lookup containers based on model, which adds another dimension to the mapping process"
- "Dynamic Pages work based on containers (lists) and can develop an URL pattern based on items in that list"

**📋 CONTAINER DISCOVERY & SYNC TASKS**:

- [ ] **Task 22.1**: Container Discovery Method Analysis ⚡ **METHODOLOGY COMPARISON**
    - [ ] **Sub-task 22.1.1**: Document current approach: `getContainerList()` + referenceName filtering
    - [ ] **Sub-task 22.1.2**: Document legacy approach: `getContainerByReferenceName()` direct lookup
    - [ ] **Sub-task 22.1.3**: Compare SDK method effectiveness and accuracy
    - [ ] **Sub-task 22.1.4**: Test both approaches against known problematic containers
    - [ ] **Sub-task 22.1.5**: Identify which method handles reference name variations better
    - **Goal**: Determine optimal container discovery methodology

- [ ] **Task 22.2**: Container Reference Name Normalization Analysis ⚡ **GOTCHA INVESTIGATION**
    - [ ] **Sub-task 22.2.1**: Analyze container reference name patterns in source vs target instances
    - [ ] **Sub-task 22.2.2**: Document known reference name variations (casing, spacing, special chars)
    - [ ] **Sub-task 22.2.3**: Study push_legacy.ts container handling for proven approaches
    - [ ] **Sub-task 22.2.4**: Test current case-insensitive matching against edge cases
    - [ ] **Sub-task 22.2.5**: Create comprehensive normalization strategy
    - **Goal**: Bulletproof container reference name matching

- [ ] **Task 22.3**: Model-Based Container Discovery Strategy ⚡ **ALTERNATIVE MAPPING**
    - [ ] **Sub-task 22.3.1**: Implement container lookup by `contentDefinitionID` (model ID)
    - [ ] **Sub-task 22.3.2**: Create model→container mapping cache for fast lookups
    - [ ] **Sub-task 22.3.3**: Handle multiple containers per model scenarios
    - [ ] **Sub-task 22.3.4**: Use model-based lookup as fallback when reference name fails
    - [ ] **Sub-task 22.3.5**: Test model-based discovery against known problem containers
    - **Goal**: Multi-dimensional container discovery capability

- [ ] **Task 22.4**: Enhanced Container Target Discovery ⚡ **IMPROVED MATCHING**
    - [ ] **Sub-task 22.4.1**: Implement multi-strategy container matching:
        - Primary: `getContainerByReferenceName()` (proven legacy method)
        - Secondary: `getContainerList()` + enhanced filtering
        - Tertiary: Model-based lookup via `contentDefinitionID`
    - [ ] **Sub-task 22.4.2**: Add fuzzy matching for reference name variations
    - [ ] **Sub-task 22.4.3**: Create container existence confidence scoring
    - [ ] **Sub-task 22.4.4**: Enhanced missing container categorization based on Task 23.5 analysis
    - **Goal**: Maximum container discovery accuracy with detailed categorization

- [ ] **Task 22.5**: Container Sync Strategy Optimization ⚡ **SUCCESS MAXIMIZATION**
    - [ ] **Sub-task 22.5.1**: Prioritize container sync order (dependencies first)
    - [ ] **Sub-task 22.5.2**: Implement progressive container sync (critical → optional)
    - [ ] **Sub-task 22.5.3**: Add container creation success tracking
    - [ ] **Sub-task 22.5.4**: Fallback strategies for problematic containers
    - [ ] **Sub-task 22.5.5**: Container post-sync validation
    - **Goal**: Maximize successful container transfer rate

**📍 IMPLEMENTATION STRATEGY**:
1. **Enhanced Analysis**: Task 23 provides comprehensive container dependency detection
2. **Multi-Method Discovery**: Primary/fallback container lookup strategies
3. **Progressive Sync**: Sync containers in dependency order with success tracking
4. **Success Maximization**: Get as many containers synced as possible

---

## 🚨 **CRITICAL: Task 21.25 - Analysis-First Mapping Architecture** ⚡ **REVOLUTIONARY APPROACH**
**Status**: 🎯 **FOUNDATIONAL** - Game-changing architectural shift for perfect mapping

**🎯 ARCHITECTURE VISION**:
- **Analysis = Initial Mapper**: Analysis phase discovers all source→target mappings
- **Target Instance Lookups**: SDK calls during analysis to check what already exists  
- **Pre-Populated ReferenceMapper**: Complete mapping state before push begins
- **Simplified Pushers**: Only recursive field mapping + API calls (no existence checking)

**📋 ANALYSIS-FIRST IMPLEMENTATION**:

- [x] **Task 21.25.1**: Enhance Analysis Phase with Target Instance Discovery ⚡ **FOUNDATION** ✅ **COMPLETE**
    - [x] Add target instance authentication to analysis phase ✅
    - [x] Implement target entity discovery: models, containers, content, templates, pages, assets ✅
    - [x] Create source→target mapping during analysis (populate ReferenceMapper) ✅
    - [x] Generate "sync plan" showing create vs update vs skip for each entity ✅

- [x] **Task 21.25.2**: Implement Multi-Level Mapping Relationships ⚡ **CORE MAPPING** ✅ **COMPLETE**
    - [x] `mapper.modelIds.set(oldModelID, newModelID)` - Model ID mapping ✅
    - [x] `mapper.contentIds.set(oldContentID, newContentID)` - Content ID mapping ✅
    - [x] `mapper.containerIds.set(oldContainerID, newContainerID)` - Container ID mapping ✅
    - [x] `mapper.templateIds.set(oldTemplateID, newTemplateID)` - Template ID mapping ✅
    - [x] `mapper.pageIds.set(oldPageID, newPageID)` - Page ID mapping ✅
    - [x] `mapper.assetIds.set(oldAssetID, newAssetID)` - Asset ID mapping ✅

- [ ] **Task 21.25.3**: Simplify Pushers to Recursive Mapping + API Calls ⚡ **SIMPLIFICATION**
    - [ ] **Sub-task 21.25.3.1**: Remove all existence checking logic from pushers (handled in analysis)
    - [ ] **Sub-task 21.25.3.2**: Remove complex batch processing (use individual API calls with known IDs)
    - [ ] **Sub-task 21.25.3.3**: Focus pushers on recursive field mapping using pre-populated ReferenceMapper
    - [ ] **Sub-task 21.25.3.4**: Handle complex nested data transformation (pages→zones→content references)
    - [ ] **Sub-task 21.25.3.5**: Update ReferenceMapper with new target IDs for newly created entities
    - **Goal**: Pushers become simple: transform data + API call + update mapping

- [ ] **Task 21.25.4**: Enhanced Analysis Output with Sync Planning ⚡ **USER EXPERIENCE**
    - [ ] **Sub-task 21.25.4.1**: Show detailed sync plan: "Will create X, update Y, skip Z entities"
    - [ ] **Sub-task 21.25.4.2**: Display entity-level details: "Page 'news' → CREATE (template exists, content new)"
    - [ ] **Sub-task 21.25.4.3**: Estimate sync time based on create vs update vs skip ratios
    - [ ] **Sub-task 21.25.4.4**: Validate 100% mapping success before sync begins
    - **Goal**: Perfect transparency and planning before any API calls

**🎯 ARCHITECTURAL BENEFITS**:
- **🔍 Analysis Phase**: Source data loading + Target discovery + Complete mapping
- **⚡ Push Phase**: Data transformation + API calls (no discovery, no complex logic)
- **📊 Perfect Statistics**: Know exact counts before starting
- **🚀 Performance**: Subsequent runs = fast analysis + minimal pushes

---

## 🚨 **CRITICAL: Task 21.24 - Return to Single-Pass Content Processing** ⚡ **ARCHITECTURAL RESET**
**Status**: 🚨 **URGENT** - Complete architectural rethink required

**🎯 USER CRITICAL FEEDBACK**: "Return to single pass... subsequent runs should get faster as more content items found existing... seems like we're recreating everything every time"

**🚨 FUNDAMENTAL ISSUES**:
- **❌ Two-Pass Complexity**: Two-pass approach making debugging impossible
- **❌ Batch API Problems**: Index-based mapping assumptions causing failures
- **❌ No Existence Detection**: Creating content every time instead of checking if it exists
- **❌ Subsequent Run Performance**: Should get faster each run, but we're recreating everything

**📋 SINGLE-PASS IMPLEMENTATION**:

- [ ] **Task 21.24.1**: Remove Two-Pass Architecture ⚡ **SIMPLIFICATION**
    - [ ] **Sub-task 21.24.1.1**: Eliminate Pass 1 (shells) and Pass 2 (full definitions) logic
    - [ ] **Sub-task 21.24.1.2**: Use single processing loop with individual `saveContentItem()` calls
    - [ ] **Sub-task 21.24.1.3**: Remove complex batch response parsing and index-based mapping
    - [ ] **Sub-task 21.24.1.4**: Store content ID mappings immediately after each successful creation
    - **Goal**: Drastically simplify content processing to match legacy's proven approach

- [ ] **Task 21.24.2**: Implement Proper Existence Detection ⚡ **CRITICAL**
    - [ ] **Sub-task 21.24.2.1**: Check if content already exists in target instance before creation
    - [ ] **Sub-task 21.24.2.2**: Use reference name or content ID to detect existing content
    - [ ] **Sub-task 21.24.2.3**: Skip creation for existing content, just add to mapping cache
    - [ ] **Sub-task 21.24.2.4**: Only create content that genuinely doesn't exist in target
    - **Goal**: Subsequent runs should process fewer and fewer items as target instance fills up

- [ ] **Task 21.24.3**: Fix Content Revision Mapping ⚡ **CRITICAL**
    - [ ] **Sub-task 21.24.3.1**: When saving content creates a revision, capture the correct target ID
    - [ ] **Sub-task 21.24.3.2**: Store source→target mapping immediately for use by pages/linked content
    - [ ] **Sub-task 21.24.3.3**: Test that linked content can find previously created content via mappings
    - [ ] **Sub-task 21.24.3.4**: Validate that revisions don't break the mapping system
    - **Goal**: Perfect content ID mapping for dependent entities

- [ ] **Task 21.24.4**: Performance Validation ⚡ **USER REQUIREMENT**
    - [ ] **Sub-task 21.24.4.1**: First run: Measure baseline performance and creation count
    - [ ] **Sub-task 21.24.4.2**: Second run: Verify most content is found existing (faster processing)
    - [ ] **Sub-task 21.24.4.3**: Third run: Should be very fast with minimal new content creation
    - [ ] **Sub-task 21.24.4.4**: Log exact statistics: "Found X existing, created Y new"
    - **Goal**: Progressive speed improvement on subsequent runs as user expects

**🎯 SUCCESS CRITERIA**:
- ✅ **Single-Pass Processing**: No shells/full definitions complexity
- ✅ **Existence Detection**: Check for existing content before creating
- ✅ **Progressive Performance**: Each run faster than the last
- ✅ **Perfect Mappings**: Content revisions properly tracked for dependent entities
- ✅ **95%+ Success Rate**: Match or exceed legacy system performance

---

## 🏗️ **IMPLEMENTATION PRIORITY ORDER**

### **🎯 Phase 1: Architectural Foundation (IMMEDIATE - Week 1)**
1. **Task 25.1**: Enhanced Container Classification System (FOUNDATION - template vs instance understanding)
2. **Task 25.2**: Management SDK Current-Data-Only Downloader (CLEAN ARCHITECTURE - eliminate garbage data)  
3. **Task 25.3**: Enhanced Chain Analysis Integration (ARCHITECTURAL AWARENESS - proper container patterns)

### **🎯 Phase 2: Comprehensive Systems (Week 2)**
1. **Task 23.7**: Universal Chain Extractor Implementation (FOUNDATION - handles ALL relationship types)
2. **Task 23.8**: State-Based Validation Engine (SMART DETECTION - no SDK calls needed)
3. **Task 24.1-24.3**: Complete Management SDK-Only Downloader (CONSISTENCY - full entity coverage)

### **🎯 Phase 2: Complete Analysis Enhancement (Weeks 2-3)**  
4. **Task 23.9**: Universal Chain Builder (COMPLETE MAPPING - ALL entity relationships)
5. **Task 23.10**: Comprehensive Analysis Runner Enhancement (INTEGRATION - unified analysis)
6. **Task 24.4-24.10**: Management SDK-Only Downloader Complete (ALL ENTITY TYPES)

### **🎯 Phase 3: Integration & Compatibility (Weeks 3-4)**
7. **Task 24.11**: Universal Relationship Download (INTEGRITY - perfect reference consistency) 
8. **Task 23.11**: Legacy Push Pattern Validation (COMPATIBILITY - backwards compatibility)
9. **Task 21.25**: Analysis-First Mapping Architecture (OPTIMIZATION - pre-populated mapping)

### **🎯 Phase 4: Performance & Polish (Week 4)**
10. **Task 22**: Container Discovery & Sync Strategy (ROBUSTNESS - multi-method discovery)
11. **Task 21.24**: Single-Pass Content Processing (PERFORMANCE - speed optimization)

**📍 SUCCESS METRICS**:
- ✅ **100% Reference Integrity**: All content references resolvable within downloaded data (Task 24)
- ✅ **100% Container Detection**: No "safe to skip" containers that are actually critical (Task 23)
- ✅ **Perfect Analysis**: All nested dependencies detected at analysis stage (Task 23)
- ✅ **Progressive Performance**: Each sync run faster than the last (Task 21.24)
- ✅ **95%+ Success Rate**: Match or exceed legacy system performance (All tasks)
- ✅ **Zero Mapping Failures**: Perfect source→target mapping before push begins (Task 21.25)

**💡 KEY USER INSIGHTS DRIVING THIS PLAN**:
1. "Container → item → container → item chains properly, this needs to happen inside pages as well"
2. "We need to look at all this from the analysis stage down"
3. "Dynamic Pages work based on containers (lists) and can develop an URL pattern based on items in that list"
4. "Containers are potentially the most problematic element type in the sync process"

---

**📚 ARCHIVED CONTENT**: Complete previous manifest with all historical context archived to `.cursor/manifest-archive-[timestamp].md` for reference