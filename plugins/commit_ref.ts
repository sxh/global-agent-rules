// Resolve the text that can carry a commit's `PCP-Task:` trailer.
//
// Inline `-m/--message` text lives in the command string itself. `-F/--file`
// instead puts the message in a file, so matching the raw command string alone
// misses the trailer (B024). These helpers let the caller feed both forms to the
// same trailer regex.

export function extractMessageFiles(cmd: string): string[] {
  const files: string[] = [];
  const re = /(?:^|\s)(?:-F|--file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    const file = m[1] ?? m[2] ?? m[3];
    if (file) files.push(file);
  }
  return files;
}

export function commitTrailerSource(
  cmd: string,
  readFile: (file: string) => string | null,
): string {
  const parts = [cmd];
  for (const file of extractMessageFiles(cmd)) {
    const content = readFile(file);
    if (content) parts.push(content);
  }
  return parts.join("\n");
}
