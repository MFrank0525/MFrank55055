import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveExistingPath(candidates: string[]): string | undefined {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

export function getPathEnvKey(): "Path" | "PATH" {
  return process.platform === "win32" ? "Path" : "PATH";
}

export function extendPathEnv(paths: string[]): NodeJS.ProcessEnv {
  const key = getPathEnvKey();
  const existing = process.env[key] || process.env.PATH || process.env.Path || "";
  const extra = paths.filter(Boolean);
  return {
    ...process.env,
    [key]: [...extra, existing].filter(Boolean).join(path.delimiter)
  };
}

export function getPythonCommand(): string {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }
  if (process.platform === "win32") {
    return "python";
  }
  // Hermes/agent shells may prepend their own venv to PATH. On macOS this can
  // shadow the system Python that has the image-processing dependencies used by
  // this project, so prefer the stable system interpreter when it exists.
  if (process.platform === "darwin" && fs.existsSync("/usr/bin/python3")) {
    return "/usr/bin/python3";
  }
  return "python3";
}

export function getPasteShortcut(): string {
  return process.platform === "darwin" ? "Meta+V" : "Control+V";
}

export function getSelectAllShortcut(): string {
  return process.platform === "darwin" ? "Meta+A" : "Control+A";
}

export function getDefaultDreaminaBin(): string {
  const configured = process.env.DREAMINA_BIN;
  if (configured) {
    return configured;
  }

  const candidates =
    process.platform === "win32"
      ? [
          path.join(os.homedir(), "bin", "dreamina.exe"),
          path.join(process.env.LOCALAPPDATA || "", "Programs", "dreamina", "dreamina.exe")
        ]
      : [
          "/opt/homebrew/bin/dreamina",
          "/usr/local/bin/dreamina",
          path.join(os.homedir(), "bin", "dreamina"),
          path.join(os.homedir(), ".local", "bin", "dreamina")
        ];

  return resolveExistingPath(candidates) || candidates[0];
}

export function getDreaminaWrapperPath(scriptName: string): string {
  const configuredDir = process.env.DREAMINA_SKILL_DIR;
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const candidates = [
    configuredDir ? path.join(configuredDir, "scripts", scriptName) : "",
    path.join(process.cwd(), "scripts", "dreamina-cli", scriptName),
    path.join(codexHome, "skills", "dreamina-cli", "scripts", scriptName),
    path.join(codexHome, "skills", ".system", "dreamina-cli", "scripts", scriptName),
    path.join(os.homedir(), ".codex", "skills", "dreamina-cli", "scripts", scriptName)
  ];

  return resolveExistingPath(candidates) || candidates.find(Boolean) || scriptName;
}
