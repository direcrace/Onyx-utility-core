import { exec } from "child_process";

function runner(cwd) {
  return (cmd) =>
    new Promise((resolve) => {
      exec(cmd, { cwd, windowsHide: true }, (err, stdout, stderr) => {
        resolve({
          code: err ? 1 : 0,
          out: String(stdout || "").trim(),
          err: String(stderr || "").trim(),
        });
      });
    });
}

/**
 * Fast-forward pull that also works on clones without upstream tracking
 * (common on hosting panels). Returns a structured result for chat/web output.
 */
export async function gitPull({ cwd = global.__basedir || process.cwd() } = {}) {
  const run = runner(cwd);

  const branchResult = await run("git rev-parse --abbrev-ref HEAD");
  let branch = branchResult.code === 0 ? branchResult.out.trim() : "";
  if (!branch || branch === "HEAD") branch = "main";

  const remoteResult = await run("git remote");
  const remotes = remoteResult.code === 0 ? remoteResult.out.split(/\s+/).filter(Boolean) : [];
  const remote = remotes.includes("origin") ? "origin" : remotes[0] || "origin";

  let pulling = await run(`git pull --ff-only ${remote} ${branch}`);
  if (pulling.code !== 0) {
    const firstError = pulling.err || pulling.out || "?";
    const fallback = await run(`git pull --ff-only ${remote} HEAD`);
    if (fallback.code === 0) {
      pulling = fallback;
    } else {
      return {
        ok: false,
        branch,
        remote,
        error: `${firstError}\n${fallback.err || fallback.out || ""}`.trim(),
      };
    }
  }

  await run(`git branch --set-upstream-to=${remote}/${branch} ${branch}`);

  return { ok: true, branch, remote, output: pulling.out };
}

export async function npmInstall({ cwd = global.__basedir || process.cwd() } = {}) {
  return runner(cwd)("npm install --no-fund --no-audit --silent");
}
