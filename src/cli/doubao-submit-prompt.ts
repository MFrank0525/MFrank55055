import { submitPrompt } from "../doubao/submit.js";

interface CliArgs {
  imagePath: string;
  promptFile: string;
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

  const imagePath = args.get("--imagePath");
  const promptFile = args.get("--promptFile");
  if (!imagePath || !promptFile) {
    throw new Error("Usage: --imagePath <file> --promptFile <utf8 txt file>");
  }

  return { imagePath, promptFile };
}

async function main(): Promise<void> {
  const result = await submitPrompt(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
