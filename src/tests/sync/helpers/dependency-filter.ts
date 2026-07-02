import { fileOperations } from 'core';
import { getModelsFromFileSystem } from 'lib/getters/filesystem/get-models';
import { getContainersFromFileSystem } from 'lib/getters/filesystem/get-containers';
import { ModelDependencyTreeBuilder } from 'lib/models/model-dependency-tree-builder';

/**
 * Mirrors what GuidDataLoader.applyModelFiltering does for --models-with-deps:
 * load the supporting entities, build a dependency tree, return only the content
 * items the tree includes.
 *
 * Kept here (and not invoked through GuidDataLoader) so scenarios can run with
 * the same filesystem-only inputs the rest of the runner uses, without pulling
 * in incremental-change-detection plumbing that GuidDataLoader also does.
 */
export function applyModelsWithDepsFilter(opts: {
  sourceGuid: string;
  locale: string;
  modelsWithDeps: string[];
  contentItems: any[];
}): any[] {
  const guidOps = new fileOperations(opts.sourceGuid);
  const models = getModelsFromFileSystem(guidOps);
  const containers = getContainersFromFileSystem(guidOps);

  const sourceData: any = {
    models,
    containers,
    content: opts.contentItems,
    templates: [],
    pages: [],
    assets: [],
    galleries: [],
    lists: [],
  };

  const builder = new ModelDependencyTreeBuilder(sourceData, opts.sourceGuid, opts.sourceGuid);

  const validation = builder.validateModels(opts.modelsWithDeps, models);
  if (validation.invalid.length > 0) {
    throw new Error(
      `--models-with-deps validation failed; unknown model(s): ${validation.invalid.join(', ')}`
    );
  }

  const tree = builder.buildDependencyTree(validation.valid, opts.locale);

  return opts.contentItems.filter((item) => tree.content.has(item.contentID));
}
