import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");

try {
  const current = await readFile(envPath, "utf8");
  const value = current.match(/^LGM_ENCRYPTION_KEY=(.+)$/m)?.[1]?.trim();
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("LGM_ENCRYPTION_KEY in .env.local must be 64 hexadecimal characters.");
  }
  await chmod(envPath, 0o600);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const key = randomBytes(32).toString("hex");
  await writeFile(envPath, `LGM_ENCRYPTION_KEY=${key}\n`, { mode: 0o600, flag: "wx" });
  await mkdir(path.join(process.cwd(), "data"), { recursive: true, mode: 0o700 });
  console.log("Created a private local encryption key in .env.local.");
}
