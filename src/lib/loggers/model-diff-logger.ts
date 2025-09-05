import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import _ from 'lodash';

/**
 * Model Diff Logger - Extracted from model-pusher.ts
 * Provides detailed logging for model differences during sync operations
 */

// Function to log detailed differences between two model objects
export function logModelDifferences(source: any, target: any, modelName: string) {
  console.log(ansiColors.yellow(`[DIFF] Differences for ${modelName}:`));
  const allKeys = _.union(Object.keys(source), Object.keys(target)).sort();

  for (const key of allKeys) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (!_.has(target, key)) {
      console.log(
        ansiColors.green(`  + Source only: ${key} = ${JSON.stringify(sourceVal, null, 2)}`)
      );
    } else if (!_.has(source, key)) {
      console.log(
        ansiColors.red(`  - Target only: ${key} = ${JSON.stringify(targetVal, null, 2)}`)
      );
    } else if (!_.isEqual(sourceVal, targetVal)) {
      console.log(ansiColors.yellow(`  ~ Different: ${key}`));
      if (key === 'fields' && Array.isArray(sourceVal) && Array.isArray(targetVal)) {
        logFieldArrayDifferences(sourceVal, targetVal);
      } else if (
        typeof sourceVal === 'object' &&
        sourceVal !== null &&
        typeof targetVal === 'object' &&
        targetVal !== null
      ) {
        // For nested objects, show both values if they are not too large
        console.log(ansiColors.green(`    Source Value: ${JSON.stringify(sourceVal, null, 2)}`));
        console.log(ansiColors.red(`    Target Value: ${JSON.stringify(targetVal, null, 2)}`));
      } else {
        console.log(ansiColors.green(`    Source Value: ${sourceVal}`));
        console.log(ansiColors.red(`    Target Value: ${targetVal}`));
      }
    }
  }
}

export function logFieldArrayDifferences(
  sourceFields: mgmtApi.ModelField[],
  targetFields: mgmtApi.ModelField[]
) {
  const sourceFieldNames = sourceFields.map((f) => f.name);
  const targetFieldNames = targetFields.map((f) => f.name);

  // Fields only in source
  sourceFields
    .filter((sf) => !targetFieldNames.includes(sf.name))
    .forEach((sf) => {
      console.log(ansiColors.green(`    + Source Field only: ${sf.name} (Type: ${sf.type})`));
    });

  // Fields only in target
  targetFields
    .filter((tf) => !sourceFieldNames.includes(tf.name))
    .forEach((tf) => {
      console.log(ansiColors.red(`    - Target Field only: ${tf.name} (Type: ${tf.type})`));
    });

  // Fields in both - compare them
  sourceFields
    .filter((sf) => targetFieldNames.includes(sf.name))
    .forEach((sf) => {
      const tf = targetFields.find((f) => f.name === sf.name)!;
      let fieldDifferencesFound = false;
      const diffMessages: string[] = [];

      if (sf.label !== tf.label) {
        diffMessages.push(`      Label: Source='${sf.label}', Target='${tf.label}'`);
        fieldDifferencesFound = true;
      }
      if (sf.type !== tf.type) {
        diffMessages.push(`      Type: Source='${sf.type}', Target='${tf.type}'`);
        fieldDifferencesFound = true;
      }
      if (!_.isEqual(sf.settings, tf.settings)) {
        diffMessages.push(
          `      Settings: Source=${JSON.stringify(sf.settings)}, Target=${JSON.stringify(tf.settings)}`
        );
        fieldDifferencesFound = true;
      }

      if (fieldDifferencesFound) {
        console.log(ansiColors.yellow(`    ~ Field ${sf.name} (Type: ${sf.type}) differs:`));
        diffMessages.forEach((msg) => console.log(msg));
      }
    });
}
