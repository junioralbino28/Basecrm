export function resolveNpxInvocation(
  args,
  {
    platform = process.platform,
    comSpec = process.env.ComSpec,
  } = {},
) {
  if (platform === 'win32') {
    return {
      file: comSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npx.cmd', ...args],
    };
  }
  return { file: 'npx', args };
}
