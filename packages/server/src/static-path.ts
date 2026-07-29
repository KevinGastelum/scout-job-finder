import { resolve, sep } from "node:path";

const DRIVE_ABSOLUTE = /^[a-zA-Z]:/;

export function resolveStaticPath(distDir: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }

  const stripped = decoded.replace(/^[/\\]+/, "");
  if (DRIVE_ABSOLUTE.test(stripped)) return null;

  const relative = stripped === "" ? "index.html" : stripped;
  const resolvedDist = resolve(distDir);
  const resolvedPath = resolve(resolvedDist, relative);

  if (resolvedPath === resolvedDist || resolvedPath.startsWith(resolvedDist + sep)) {
    return resolvedPath;
  }
  return null;
}
