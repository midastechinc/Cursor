import fs from "node:fs";
import { execSync } from "node:child_process";

const run = (command, options = {}) => {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit", ...options });
};

const readPackageVersion = () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (!pkg.version) {
    throw new Error("package.json does not contain a version field.");
  }
  return String(pkg.version);
};

const updatePatchVersion = (version) => {
  const [majorRaw, minorRaw, patchRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  return `${major}.${minor}.${patch + 1}`;
};

const ensureCleanTree = () => {
  const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (status) {
    throw new Error("Git working tree is not clean. Commit/stash changes before releasing.");
  }
};

const main = () => {
  ensureCleanTree();
  run("gh auth status");
  run("git fetch origin cursor/code-analysis-0cdd");
  run("git pull origin cursor/code-analysis-0cdd");

  const currentVersion = readPackageVersion();
  const nextVersion = updatePatchVersion(currentVersion);

  run(`npm version ${nextVersion} --no-git-tag-version`);
  run("git add package.json package-lock.json");
  run(`git commit -m "Release v${nextVersion}"`);
  run("git push -u origin cursor/code-analysis-0cdd");

  run("npm run desktop:build");
  run(
    `gh release create v${nextVersion} release/*.exe release/*.yml release/*.blockmap --title "v${nextVersion}" --notes "Desktop release v${nextVersion}"`,
  );

  console.log(`\nRelease completed: v${nextVersion}`);
};

try {
  main();
} catch (error) {
  console.error(`\nRelease failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
