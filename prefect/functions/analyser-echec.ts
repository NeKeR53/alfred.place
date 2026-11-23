import { analyserExecution } from "../lib/rapport";

export default async function (input: { instance?: string; execution?: string }) {
  return analyserExecution(input);
}
