import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageDir,
      stdio: "inherit",
      env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

await run(process.execPath, ["./build.mjs"], {
  ...process.env,
  NODE_ENV: "development",
});

await run(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
  ...process.env,
  NODE_ENV: "development",
  PORT: process.env.PORT || "8080",
});
