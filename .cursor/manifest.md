# Agility CLI - Active Development Manifest

This file tracks current and upcoming development tasks.

**📚 ARCHIVED**: Previous manifest archived to `.cursor/manifest-archive-[timestamp].md` for reference

---

## 🧹 **CRITICAL: Task 27 - Topological Content Sync Refactor** ⚡ **ARCHITECTURE ENHANCEMENT**
**Status**: 🎯 **SOPHISTICATED REFACTOR** - Rename and enhance TwoPassSync to TopologicalContentSync with clearer architecture

### **🎯 CORRECTED ARCHITECTURE VISION**:

**The TwoPassSync system is actually a sophisticated topological dependency analysis engine** - this is a **feature**, not overcomplicated bloat. The goal is to refactor and rename it for clarity while preserving and enhancing these advanced capabilities.

**Current Strengths to Preserve (PERFECT - DON'T CHANGE)**:
- ✅ **Topological Chain Analysis**: Traverse content/page dependency chains from inside out ⭐ **PERFECT**
- ✅ **Dependency Leveling**: Group into batches based on dependency depth ⭐ **PERFECT**
- ✅ **Broken Chain Detection**: Identify and report broken chains, unresolved references ⭐ **PERFECT**
- ✅ **Comprehensive Analysis**: 6-step dependency analysis with perfect accuracy ⭐ **PERFECT**
- ✅ **Reference Remapping**: Replace contentID references using mapping files ⭐ **PERFECT**
- ✅ **Two-Phase Architecture**: Analysis + Execution with clear separation ⭐ **PERFECT**

**Issues to Address (ORGANIZATION ONLY)**:
- ❌ **Naming Confusion**: "TwoPassSync" doesn't describe sophisticated topological features
- ❌ **syncInstance Readability**: Method is cluttered and hard to read - needs organization
- ❌ **Code Structure**: Analysis logic mixed with execution logic - needs clear separation
- ❌ **Link Type Handling**: Need better support for nested/shared/dropdown/dynamic content
- ❌ **Reference Mapper Persistence**: Still need disk persistence for performance

---

### **📋 TOPOLOGICAL CONTENT SYNC REFACTOR PLAN**:

- [x] **Task 27.1**: Rename Core Classes ⚡ **CLARITY & BRANDING** ✅ **COMPLETE**
    - [x] **Sub-task 27.1.1**: Rename `TwoPassSync` → `TopologicalContentSync` (descriptive of sophisticated features) ✅
    - [x] **Sub-task 27.1.2**: Rename `two-pass-sync.ts` → `topological-content-sync.ts` ✅
    - [x] **Sub-task 27.1.3**: Update all imports and references to new class name ✅
    - [x] **Sub-task 27.1.4**: Update CLI integration to use `TopologicalContentSync` ✅
    - [x] **Sub-task 27.1.5**: Enhanced class documentation highlighting sophisticated features ✅
    - **Goal**: Clear naming that highlights sophisticated dependency analysis capabilities ✅
    - **📝 COMMIT**: `git commit -m "[27.1] Rename TwoPassSync to TopologicalContentSync - enhanced branding for sophisticated dependency analysis"`
    - **🔖 SHA**: `55c2ee4` - Renamed TwoPassSync to TopologicalContentSync with enhanced documentation
    - **📊 RESULT**: Successfully renamed with build verification and test validation - all sophisticated analysis features preserved
    - **✅ USER VERIFIED**: User confirmed functionality works as expected

- [x] **Task 27.2**: Clean Up syncInstance Console Output & Code Organization ⚡ **OUTPUT CLARITY** ✅ **COMPLETE**
    - [x] **Sub-task 27.2.1**: **PRESERVE** existing ComprehensiveAnalysisRunner integration (it's perfect) ✅
    - [x] **Sub-task 27.2.2**: **REMOVE** cluttered console logs: ✅
        - "Starting simplified pusher", "Loading source data and performing...", "field transformation bridge" messages ✅
        - "7-STEP COMPREHENSIVE SYNC ANALYSIS" title and step numbers (0., 1., 2., etc.) ✅
        - "Asset validation & compatibility" section ✅
        - "Enhanced analysis summary" section ✅
        - "Debug sync options" output ✅
    - [x] **Sub-task 27.2.3**: **KEEP** essential analysis output: ✅
        - Circular Model Chains (displays correctly) ✅
        - Page Chains (displays correctly) ✅
        - Container Chains (displays correctly with truncation for readability) ✅
        - "Found X broken references" (now displays as "brokenReferences") ✅
        - Items outside of chains ✅
        - Reconciliation summary ✅
    - [x] **Sub-task 27.2.4**: **ENHANCED** Container chains with truncation and categorization for better readability ✅
    - [x] **Sub-task 27.2.5**: Clean console output flow - removed all loading and clutter messages ✅
    - **📝 COMMIT**: `git commit -m "[27.2] Clean up syncInstance console output - removed clutter, preserved sophisticated analysis"`
    - **🔖 SHA**: `590f1b3` - Console output cleanup with sophisticated analysis preserved
    - **📊 RESULT**: Clean, focused console output showing 6-step dependency analysis without clutter - Model Chains, Page Chains, Container Chains, Universal Relationships, Items Outside Chains, Reconciliation Summary
    - **✅ USER VERIFIED**: User confirmed output cleanup works well and is much more readable
    - **Goal**: Clean, focused console output with essential analysis preserved and target discovery moved to pushers ✅

- [ ] **Task 27.3**: Enhance Broken Chain Diagnostics ⚡ **DIAGNOSTIC EXCELLENCE**
    - [ ] **Sub-task 27.3.1**: Create comprehensive broken chain diagnostics report
    - [ ] **Sub-task 27.3.2**: Detail each broken chain with contributing unresolved references
    - [ ] **Sub-task 27.3.3**: Provide corrective action suggestions for each broken chain
    - [ ] **Sub-task 27.3.4**: Add broken chain severity levels (critical, warning, info)
    - [ ] **Sub-task 27.3.5**: Export broken chain reports to JSON/CSV for analysis
    - **Goal**: Production-quality diagnostics that guide users to fix issues

- [ ] **Task 27.4**: Enhance Phase 2 - Reference Remapping ⚡ **EXECUTION IMPROVEMENT**
    - [ ] **Sub-task 27.4.1**: Preserve existing proven pushers (models, containers, content, pages)
    - [ ] **Sub-task 27.4.2**: Enhance reference remapping to handle nested/shared/dynamic content
    - [ ] **Sub-task 27.4.3**: Implement sophisticated contentID reference replacement in payloads
    - [ ] **Sub-task 27.4.4**: Add support for Base64-encoded images and asset uploads
    - [ ] **Sub-task 27.4.5**: Maintain mapping file compatibility for complex references
    - **Goal**: Robust reference remapping that handles all Agility CMS link types

- [x] **Task 27.5**: Implement Advanced Link Type Support ⚡ **CONTENT SOPHISTICATION** ✅ **DETECTION COMPLETE**
    - [x] **Sub-task 27.5.1**: **Link Type Detection System** - Created LinkTypeDetector service to identify dropdown, searchlistbox, grid, nested, and shared link patterns ✅
    - [x] **Sub-task 27.5.2**: **Field Configuration Filtering** - Distinguish field setting strings from actual content references ✅
    - [x] **Sub-task 27.5.3**: **Broken Chain Analysis Cleanup** - Eliminated false positive broken chains from field configuration misinterpretation ✅
    - [x] **Sub-task 27.5.4**: **Link Type Classification** - Detect dropdown, searchlistbox, grid, nested, shared patterns from model field settings ✅
    - [ ] **Sub-task 27.5.5**: **Sync Strategy Implementation** - Apply different sync behaviors based on detected link types (Future Enhancement)
    - [ ] **Sub-task 27.5.6**: **Base64-encoded Images** - Handle as needed during asset uploads (Future Enhancement)
    - [ ] **Sub-task 27.5.7**: **Reference Name Handling** - Treat all referenceName strings as opaque (Future Enhancement)
    - **Goal**: Handle all Agility CMS link types with appropriate behavior per CTO specifications ✅ **DETECTION FOUNDATION COMPLETE**
    - **📝 COMMIT**: `git commit -m "[27.5] Implement link type detection to clean up broken chain analysis"`
    - **🔖 SHA**: `9b6c1f4` - Created LinkTypeDetector service, eliminated 7 false positive broken chains (64% reduction)
    - **📊 RESULT**: Clean broken chain analysis showing only legitimate issues (4 asset references vs 11 mixed false positives)
    - **✅ USER VERIFIED**: Link type detection successfully resolved broken chain analysis issues

- [x] **Task 27.6**: Implement Reference Mapper Disk Persistence ⚡ **PERFORMANCE OPTIMIZATION** ✅ **COMPLETE**
    - [x] **Sub-task 27.6.1**: Add `saveMappingsToDisk()` and `loadMappingsFromDisk()` methods to `ReferenceMapper` ✅
    - [x] **Sub-task 27.6.2**: Save mappings to `agility-files/{sourceGuid}/mappings/{targetGuid}.json` using fileOperations service ✅
    - [x] **Sub-task 27.6.3**: Load existing mappings on ReferenceMapper construction for automatic performance improvement ✅
    - [x] **Sub-task 27.6.4**: Integrate persistence into TopologicalContentSync orchestrator and analysis runner ✅
    - [x] **Sub-task 27.6.5**: Replace fs usage with existing fileOperations service for consistency ✅
    - **Goal**: Subsequent sync runs should be progressively faster with persistent mappings ✅
    - **📝 COMMIT**: `git commit -m "[27.6] Implement Reference Mapper disk persistence - performance optimization for subsequent sync runs"`
    - **🔖 SHA**: `[TO BE ADDED]` - Disk persistence with automatic loading and saving
    - **📊 RESULT**: ReferenceMapper now automatically loads existing mappings on construction and saves after successful analysis/sync operations
    - **✅ USER VERIFIED**: Persistence functionality working correctly with fileOperations service integration

- [x] **Task 27.7**: Reorganize Target Discovery into Pushers ⚡ **ARCHITECTURE SIMPLIFICATION** ✅ **COMPLETE**
    - [x] **Sub-task 27.7.1**: Remove "Checking target instance for existing data" from `syncInstance` ✅
    - [x] **Sub-task 27.7.2**: Move target existence checking into individual pushers (models, containers, content, etc.) ✅
    - [x] **Sub-task 27.7.3**: Let each pusher handle "check if exists → skip or create/update" logic internally ✅
    - [x] **Sub-task 27.7.4**: Remove upfront target discovery from TargetInstanceMapper in sync flow ✅
    - [x] **Sub-task 27.7.5**: Keep ReferenceMapper for ID mapping but let pushers populate it during execution ✅
    - **Goal**: Simpler sync flow with target discovery happening lazily in pushers ✅
    - **📝 COMMIT**: `git commit -m "[27.7] Remove upfront target discovery - individual pushers now handle existence checking using proven mapper→SDK pattern"`
    - **🔖 SHA**: `f7063c4` - Removed TargetInstanceMapper from sync flow, simplified architecture
    - **📊 RESULT**: Clean separation of concerns - analysis phase focuses on dependency chains, pushers handle existence checking using established mapper→SDK pattern
    - **✅ USER VERIFIED**: Architecture simplified successfully, sophisticated analysis preserved

- [ ] **Task 27.8**: Enhance Reconciliation & Pre-Sync Preparation ⚡ **COMPLETENESS VALIDATION**
    - [ ] **Sub-task 27.8.1**: Confirm all content is either part of a chain or explicitly unchained
    - [ ] **Sub-task 27.8.2**: Allow unchained items to upload with deepest-level dependencies in first batch
    - [ ] **Sub-task 27.8.3**: Ensure reconciliation produces full map of all source items and their state
    - [ ] **Sub-task 27.8.4**: Add reconciliation confidence scoring (% of items that can be safely synced)
    - [ ] **Sub-task 27.8.5**: Generate pre-sync preparation report with sync strategy
    - **Goal**: Complete reconciliation that accounts for every source item with clear sync strategy

- [ ] **Task 27.9**: Improve Architecture Organization ⚡ **CODE CLARITY**
    - [ ] **Sub-task 27.9.1**: Preserve TopologicalSyncOrchestrator but improve method organization
    - [ ] **Sub-task 27.9.2**: Keep sophisticated orchestration but improve method organization
    - [ ] **Sub-task 27.9.3**: Add clear documentation for topological analysis phases
    - [ ] **Sub-task 27.9.4**: Improve logging to show topological dependency levels clearly
    - [ ] **Sub-task 27.9.5**: Add configuration options for different analysis depths
    - **Goal**: Well-organized sophisticated architecture with clear documentation

- [ ] **Task 27.10**: Validate Enhanced Topological Sync ⚡ **QUALITY ASSURANCE**
    - [ ] **Sub-task 27.10.1**: Test TopologicalContentSync with Texas Gaming instance (13a8b394-u)
    - [ ] **Sub-task 27.10.2**: Verify all sophisticated dependency analysis features work correctly
    - [ ] **Sub-task 27.10.3**: Test all link types (nested, shared, dropdown, dynamic) handle correctly
    - [ ] **Sub-task 27.10.4**: Confirm broken chain diagnostics provide actionable insights
    - [ ] **Sub-task 27.10.5**: Validate that sync success rate matches or exceeds current version
    - **Goal**: Enhanced topological sync works better than current version

## 🏗️ **CRITICAL: Task 28 - Path Resolution & FileServices Integration** ⚡ **ARCHITECTURE CLEANUP**
**Status**: 🔧 **PLANNING** - Consolidate path resolution with fileServices properly

### **🎯 PROBLEM ANALYSIS**:

**Current Issues**:
- ❌ **Inconsistent Path Handling**: Reference mapper bypassing fileServices with direct `fs` imports
- ❌ **Bloated Integration**: Working around fileServices instead of making it work properly  
- ❌ **Naming Inconsistencies**: Mix of "path" vs "paths" in function names
- ❌ **Service Fragmentation**: Path resolver vs fileServices doing overlapping work
- ❌ **Architecture Debt**: Patching symptoms instead of fixing root integration issues

**Root Cause**: The path-resolver.ts was created to solve path issues, but fileServices should be the single source of truth for all file operations and path management.

### **📋 PATH RESOLUTION INTEGRATION PLAN**:

- [x] **Task 28.1**: Analyze Current FileServices Usage ⚡ **UNDERSTANDING** ✅ **COMPLETE**
    - [x] **Sub-task 28.1.1**: Audit how push operations use fileServices ✅
    - [x] **Sub-task 28.1.2**: Audit how sync operations use fileServices ✅
    - [x] **Sub-task 28.1.3**: Identify where path-resolver.ts is being used vs fileServices ✅
    - [x] **Sub-task 28.1.4**: Document the intended vs actual file operation patterns ✅
    - [x] **Sub-task 28.1.5**: Identify overlapping responsibilities between services ✅
    - **Goal**: Complete understanding of current file operation patterns ✅
    - **📊 ANALYSIS**: Created `.cursor/task-28-analysis.md` - identified dual path systems causing bloat
    - **🚨 ROOT CAUSE**: path-resolver.ts created to solve legacyFolders, but fileOperations not enhanced = architecture debt

- [x] **Task 28.2**: Design Unified Path Resolution Strategy ⚡ **ARCHITECTURE** ✅ **COMPLETE**
    - [x] **Sub-task 28.2.1**: Define single source of truth for path management (enhanced fileOperations) ✅
    - [x] **Sub-task 28.2.2**: Design legacyFolders support within fileOperations directly ✅
    - [x] **Sub-task 28.2.3**: Plan instancePath as function of fileOperations ✅
    - [x] **Sub-task 28.2.4**: Standardize naming conventions (remove "paths" pluralization) ✅
    - [x] **Sub-task 28.2.5**: Define clean interfaces between services ✅
    - **Goal**: Clear architectural plan for unified file operations ✅
    - **📊 DESIGN**: Created `.cursor/task-28-design.md` - complete enhanced fileOperations interface design
    - **🎯 DECISION**: Make fileOperations single source of truth with legacyFolders + mapping operations

- [x] **Task 28.3**: Enhance FileServices with Path Resolution ⚡ **IMPLEMENTATION** ✅ **COMPLETE**
    - [x] **Sub-task 28.3.1**: Add legacyFolders support directly to fileOperations constructor ✅
    - [x] **Sub-task 28.3.2**: Add instancePath generation methods to fileOperations ✅
    - [x] **Sub-task 28.3.3**: Add mappings path support to fileOperations ✅
    - [x] **Sub-task 28.3.4**: Ensure fileOperations handles both absolute and relative paths consistently ✅
    - [x] **Sub-task 28.3.5**: Remove need for external path construction ✅
    - **Goal**: FileOperations becomes complete file operation solution ✅
    - **🔧 IMPLEMENTATION**: Enhanced fileOperations with legacyFolders + 8 new mapping/path methods
    - **⚠️ BUILD ERROR**: ReferenceMapper constructor interface mismatch needs Task 28.4 first

- [x] **Task 28.4**: Refactor Reference Mapper to Use FileServices ⚡ **INTEGRATION** ✅ **COMPLETE**
    - [x] **Sub-task 28.4.1**: Remove direct `fs` import from reference mapper ✅
    - [x] **Sub-task 28.4.2**: Remove path-resolver.ts dependency from reference mapper ✅
    - [x] **Sub-task 28.4.3**: Use enhanced fileOperations for all file operations ✅
    - [x] **Sub-task 28.4.4**: Ensure disk persistence works with both legacy and normal modes ✅
    - [x] **Sub-task 28.4.5**: Test reference mapper works cleanly with just fileOperations ✅
    - **Goal**: Reference mapper uses only fileOperations, no manual path construction ✅
    - **🔧 IMPLEMENTATION**: Added fileOperations integration to ReferenceMapper with 4-parameter constructor
    - **🧪 VERIFIED**: Integration test confirms disk persistence works correctly in both modes

- [ ] **Task 28.5**: Refactor Chain Data Loader Integration ⚡ **CONSISTENCY**
    - [ ] **Sub-task 28.5.1**: Update ChainDataLoader to use enhanced fileServices  
    - [ ] **Sub-task 28.5.2**: Remove path-resolver.ts dependencies where fileServices can handle
    - [ ] **Sub-task 28.5.3**: Ensure consistent path handling across all chain operations
    - [ ] **Sub-task 28.5.4**: Test both legacyFolders and normal modes work properly
    - [ ] **Sub-task 28.5.5**: Verify sync analysis continues to work correctly
    - **Goal**: Consistent file operations across all chain-related services

- [ ] **Task 28.6**: Clean Up Path Resolution Architecture ⚡ **SIMPLIFICATION**
    - [ ] **Sub-task 28.6.1**: Evaluate if path-resolver.ts is still needed
    - [ ] **Sub-task 28.6.2**: Remove redundant path construction utilities
    - [ ] **Sub-task 28.6.3**: Standardize naming (remove "paths" pluralization throughout)
    - [ ] **Sub-task 28.6.4**: Update all services to use consistent file operation patterns
    - [ ] **Sub-task 28.6.5**: Document final file operation architecture
    - **Goal**: Clean, unified architecture with single source of truth for file operations

- [ ] **Task 28.7**: Validate Unified File Operations ⚡ **TESTING**
    - [ ] **Sub-task 28.7.1**: Test reference mapper disk persistence works in both modes
    - [ ] **Sub-task 28.7.2**: Test sync analysis works with unified file operations
    - [ ] **Sub-task 28.7.3**: Test push operations work with enhanced fileServices
    - [ ] **Sub-task 28.7.4**: Verify no regression in existing functionality
    - [ ] **Sub-task 28.7.5**: Test performance is maintained or improved
    - **Goal**: All file operations work cleanly through unified architecture

**Status**: 📋 **READY TO START** - Need to begin with Task 28.1 analysis

---

**📍 CURRENT STATUS**: **Week 2 Enhanced Capabilities - 5/10 Tasks Complete**

**✅ Completed:**
- **Task 27.1**: Rename Core Classes (TopologicalContentSync) - SHA: `55c2ee4`
- **Task 27.2**: Clean Up Console Output & Code Organization - SHA: `590f1b3`
- **Task 27.7**: Reorganize Target Discovery into Pushers - SHA: `f7063c4`
- **Task 27.5**: Advanced Link Type Support (Detection System) - SHA: `9b6c1f4`
- **Task 27.6**: Reference Mapper Disk Persistence - SHA: `[TO BE ADDED]`

**📋 Next Priority Tasks:**
**Week 2 Enhanced Capabilities** continues with:
- **Task 27.4**: Enhanced Reference Remapping *(sophisticated contentID replacement)*
- **Task 27.8**: Enhanced Reconciliation & Pre-Sync Preparation *(completeness validation)*
- **Task 27.3**: Enhanced Broken Chain Diagnostics *(production-quality reports)*

**🏗️ IMPLEMENTATION PRIORITY BREAKDOWN:**

**📅 WEEK 1: Foundation Organization** 
1. ✅ **Task 27.1**: Rename to TopologicalContentSync (branding clarity)
2. ✅ **Task 27.2**: Clean up syncInstance console output & code organization (remove clutter)
3. **Task 27.7**: Reorganize target discovery into pushers (architecture simplification)

**📅 WEEK 2: Enhanced Capabilities**  
4. **Task 27.3**: Enhance broken chain diagnostics (production-quality reports)
5. **Task 27.5**: Implement advanced link type support (CTO specifications)
6. **Task 27.6**: Reference mapper disk persistence (performance)

**📅 WEEK 3: Advanced Features**
7. **Task 27.4**: Enhanced reference remapping (sophisticated contentID replacement)
8. **Task 27.8**: Enhanced reconciliation & pre-sync preparation (completeness validation)
9. **Task 27.9**: Improve architecture organization (better documentation)

**📅 WEEK 4: Validation & Polish**
10. **Task 27.10**: Validate enhanced topological sync (quality assurance) 