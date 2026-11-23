import crypto from "node:crypto";
import fs from "node:fs";

/**
 * Menghitung hash SHA-256 secara streaming agar hemat RAM meskipun file berukuran besar.
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });

    stream.on("error", (error: Error) => {
      reject(error);
    });
  });
}
