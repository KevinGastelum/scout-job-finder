import { mergeGeneratedProfile, parseGeneratedProfile, parseProfileMarkdown } from "@scout/core";

const source = process.env.SCOUT_PROFILE_MD ?? "profile/profile.md";
const target = process.env.SCOUT_PROFILE ?? "profile/profile.json";
const generatedPath = process.env.SCOUT_PROFILE_GENERATED ?? "profile/generated.json";

const file = Bun.file(source);
if (!(await file.exists())) {
  console.error(`${source} not found. Copy profile/profile.template.md to ${source} and edit it.`);
  process.exit(1);
}

let profile = parseProfileMarkdown(await file.text());
const generatedFile = Bun.file(generatedPath);
if (await generatedFile.exists()) {
  const generated = parseGeneratedProfile(await generatedFile.json());
  profile = mergeGeneratedProfile(profile, generated);
  console.log(
    `Merged ${generatedPath} (${generated.skills.length} generated skills, ${generated.evidence.length} evidence entries)`,
  );
}
await Bun.write(target, `${JSON.stringify(profile, null, 2)}\n`);
console.log(
  `Compiled ${source} -> ${target} (version ${profile.version}, ${profile.skills.length} skills, ${profile.targetTitleFamilies.length} title families)`,
);
