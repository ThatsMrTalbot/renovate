import * as datasourceGithubTags from '../../datasource/github-tags';
import { logger } from '../../logger';
import { SkipReason } from '../../types';
import { regEx } from '../../util/regex';
import { isVersion } from '../../versioning/semver';
import type { PackageDependency, PackageFile } from '../types';

export function extractPackageFile(content: string): PackageFile | null {
  const deps: PackageDependency[] = [];
  try {
    const lines = content.split('\n');
    let isPluginsSection = false;
    let pluginsIndent = '';
    for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
      const lineIdx = lineNumber - 1;
      const line = lines[lineIdx];
      const pluginsSection = regEx(
        /^(?<pluginsIndent>\s*)(-?\s*)plugins:/
      ).exec(line); // TODO #12071
      if (pluginsSection) {
        logger.trace(`Matched plugins on line ${lineNumber}`);
        isPluginsSection = true;
        pluginsIndent = pluginsSection.groups.pluginsIndent;
      } else if (isPluginsSection) {
        logger.debug(`serviceImageLine: "${line}"`);
        const { currentIndent } = regEx(/^(?<currentIndent>\s*)/).exec(
          line
        ).groups; // TODO #12071
        const depLineMatch = regEx(
          /^\s+(?:-\s+)?(?<depName>[^#]+)#(?<currentValue>[^:]+)/
        ).exec(line); // TODO #12071
        if (currentIndent.length <= pluginsIndent.length) {
          isPluginsSection = false;
          pluginsIndent = '';
        } else if (depLineMatch) {
          const { depName, currentValue } = depLineMatch.groups;
          logger.trace('depLineMatch');
          let skipReason: SkipReason;
          let repo: string;
          const gitPluginMatch = regEx(
            /(ssh:\/\/git@|https:\/\/)(?<registry>[^/]+)\/(?<gitPluginName>.*)/
          ).exec(depName);
          if (gitPluginMatch) {
            logger.debug('Examining git plugin');
            const { registry, gitPluginName } = gitPluginMatch.groups;
            const dep: PackageDependency = {
              depName: gitPluginName,
              currentValue: currentValue,
              registryUrls: ['https://' + registry],
              datasource: datasourceGithubTags.id,
            };
            deps.push(dep);
            continue;
          } else if (isVersion(currentValue)) {
            const splitName = depName.split('/');
            if (splitName.length === 1) {
              repo = `buildkite-plugins/${depName}-buildkite-plugin`;
            } else if (splitName.length === 2) {
              repo = `${depName}-buildkite-plugin`;
            } else {
              logger.warn(
                { dependency: depName },
                'Something is wrong with buildkite plugin name'
              );
              skipReason = SkipReason.InvalidDependencySpecification;
            }
          } else {
            logger.debug(
              { currentValue },
              'Skipping non-pinned current version'
            );
            skipReason = SkipReason.InvalidVersion;
          }
          const dep: PackageDependency = {
            depName,
            currentValue,
            skipReason,
          };
          if (repo) {
            dep.datasource = datasourceGithubTags.id;
            dep.lookupName = repo;
          }
          deps.push(dep);
        }
      }
    }
  } catch (err) /* istanbul ignore next */ {
    logger.warn({ err }, 'Error extracting buildkite plugins');
  }

  if (!deps.length) {
    return null;
  }

  return { deps };
}
