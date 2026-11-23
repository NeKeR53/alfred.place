import { analyserBuild } from "../lib/rapport";

export default async function (input: { instance?: string; job: string; build?: number; finiLe?: string }) {
  return analyserBuild(input);
}
