import * as cliProgress from 'cli-progress';
import colors from 'ansi-colors';

interface MultibarOptions {
  name: string;
}

export function createMultibar(options: MultibarOptions): cliProgress.MultiBar {
  const multibar = new cliProgress.MultiBar({
    format: colors.yellow('{bar}') + '| {percentage}% | {value}/{total} | {name}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  return multibar;
}
