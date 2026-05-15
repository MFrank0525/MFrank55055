import { captureConversation } from "../doubao/capture.js";

interface CliArgs {
  outputDir: string;
  rawFileOut?: string;
  screenshotOut?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--") && value) {
      args.set(key, value);
    }
  }

  const outputDir = args.get("--outputDir");
  if (!outputDir) {
    throw new Error("Usage: --outputDir <dir>");
  }

  return {
    outputDir,
    rawFileOut: args.get("--rawFileOut") || undefined,
    screenshotOut: args.get("--screenshotOut") || undefined
  };
}

async function main(): Promise<void> {
  const result = await captureConversation(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
