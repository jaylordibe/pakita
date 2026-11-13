/**
 * The message to show for a failed IPC call. Electron prefixes an error
 * thrown in the main process with "Error invoking remote method '…': Error:";
 * the operator needs only what follows.
 */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(
    /^Error invoking remote method '[^']+': (?:\w*Error: )?/,
    '',
  );
}
