import { launchPersistentBrowser } from "../browser/launch.js";
import {
  collectDoubaoComposerState,
  doubaoSelectors,
  openDoubaoChat,
  waitForDoubaoWorkspace
} from "../browser/doubao.js";

async function main(): Promise<void> {
  const context = await launchPersistentBrowser();
  const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());

  await openDoubaoChat(page);
  await waitForDoubaoWorkspace(page);

  const state = await collectDoubaoComposerState(page);

  console.log(
    JSON.stringify(
      {
        selectors: doubaoSelectors,
        state
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
