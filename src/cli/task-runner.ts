import { loadTaskFile, runTask } from "../legacy-task/runner.js";

function parseArgs(argv: string[]): { taskFile: string; legacyConfirmed: boolean } {
  const args = new Map<string, string>();
  let legacyConfirmed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--legacy") {
      legacyConfirmed = true;
      continue;
    }
    const value = argv[index + 1];
    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      args.set(key, value);
      index += 1;
    }
  }

  const taskFile = args.get("--taskFile");
  if (!taskFile) {
    throw new Error("Usage: --legacy --taskFile <task.json>");
  }

  return { taskFile, legacyConfirmed };
}

async function main(): Promise<void> {
  const { taskFile, legacyConfirmed } = parseArgs(process.argv.slice(2));
  if (!legacyConfirmed) {
    throw new Error(
      "Legacy task entrypoint requires explicit confirmation. Use --legacy --taskFile <task.json>, or prefer npm run business:doubao / npm run business:publish."
    );
  }

  console.warn("[legacy] npm run task is running in compatibility mode.");
  const task = loadTaskFile(taskFile);
  const result = await runTask(task);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
