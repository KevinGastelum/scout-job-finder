export function sha256(input: string): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex");
}
