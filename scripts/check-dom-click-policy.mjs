import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function listTypeScriptFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory() ? listTypeScriptFiles(filePath) : entry.isFile() && entry.name.endsWith(".ts") ? [filePath] : [];
  });
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : "";
}

function objectHasCoordinateOption(node) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) =>
    ts.isPropertyAssignment(property) && ["x", "y", "position"].includes(propertyName(property.name))
  );
}

function lineAndColumn(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${position.line + 1}:${position.character + 1}`;
}

export function analyzeDomClickPolicy(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];
  const report = (node, rule) => violations.push({ filePath, location: lineAndColumn(sourceFile, node), rule });

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression)) {
        const method = expression.name.text;
        const owner = expression.expression;
        if (
          method === "click" &&
          ts.isPropertyAccessExpression(owner) &&
          owner.name.text === "mouse"
        ) {
          report(node, "mouse-coordinate-click");
        }
        if (
          method === "tap" &&
          ts.isPropertyAccessExpression(owner) &&
          owner.name.text === "touchscreen"
        ) {
          report(node, "touchscreen-coordinate-tap");
        }
        if (method === "elementFromPoint") {
          report(node, "element-from-point-click-targeting");
        }
        if (method === "boundingBox") {
          report(node, "bounding-box-coordinate-derivation");
        }
        if (method === "click" && node.arguments.some(objectHasCoordinateOption)) {
          report(node, "coordinate-click-options");
        }
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "MouseEvent" &&
      (node.arguments || []).some((argument) =>
        ts.isObjectLiteralExpression(argument) && argument.properties.some((property) =>
          ts.isPropertyAssignment(property) && ["clientX", "clientY", "screenX", "screenY"].includes(propertyName(property.name))
        )
      )
    ) {
      report(node, "synthetic-coordinate-mouse-event");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

const selfTest = process.argv.includes("--self-test");
if (selfTest) {
  const fixture = "scripts/fixtures/dom-click-policy/coordinate-click.ts";
  const violations = analyzeDomClickPolicy(fixture);
  if (!violations.some((item) => item.rule === "mouse-coordinate-click")) {
    throw new Error("DOM click policy self-test failed to detect the coordinate click fixture.");
  }
  console.log("DOM click policy self-test passed");
} else {
  const violations = listTypeScriptFiles("src").flatMap(analyzeDomClickPolicy);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.filePath}:${violation.location} ${violation.rule}`);
    }
    process.exitCode = 1;
  } else {
    console.log("DOM-only click policy passed");
  }
}
