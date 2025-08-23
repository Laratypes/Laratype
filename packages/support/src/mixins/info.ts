import { readFileSync } from "fs";
import { getProjectPath, resolvePathSync } from "../path-resolver/pathResolver"

export const getLaratypeVersion = async (): Promise<string> => {
  const path = resolvePathSync("laratype/package.json");
  const data = await JSON.parse(
    readFileSync(path, "utf-8").toString()
  )

  return data.version;
}

export const getRootPackageInfo = async (): Promise<Record<string, unknown>> => {
  const path = getProjectPath("package.json", false);
  const data = await JSON.parse(
    readFileSync(path, "utf-8").toString()
  );

  return data;
}
