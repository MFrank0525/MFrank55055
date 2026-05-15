import { saveTitlesFromRaw } from "../doubao/save.js";

interface CliArgs {
  rawFile: string;
  outputDir: string;
  titleCount?: number;
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

  const rawFile = args.get("--rawFile");
  const outputDir = args.get("--outputDir");
  if (!rawFile || !outputDir) {
    throw new Error("Usage: --rawFile <txt> --outputDir <dir> [--titleCount <n>]");
  }

  const titleCountValue = args.get("--titleCount");
  return {
    rawFile,
    outputDir,
    titleCount: titleCountValue ? Number(titleCountValue) : undefined
  };
}

async function main(): Promise<void> {
  const result = saveTitlesFromRaw(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
