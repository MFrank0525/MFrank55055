import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function setClipboardText(text: string, tempPrefix = "clipboard"): void {
  if (process.platform === "darwin") {
    execFileSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
    return;
  }

  const tempFile = path.join(os.tmpdir(), `${tempPrefix}-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, text, "utf8");
  try {
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Content -Raw -Encoding UTF8 '${tempFile}' | Set-Clipboard`
        ],
        { stdio: "ignore" }
      );
      return;
    }

    execFileSync("sh", ["-c", "command -v wl-copy >/dev/null && wl-copy || xclip -selection clipboard"], {
      input: text,
      stdio: ["pipe", "ignore", "ignore"]
    });
  } finally {
    fs.unlinkSync(tempFile);
  }
}
