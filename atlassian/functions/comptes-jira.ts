import { client } from "@alfred/sdk";

export default async function () {
  return { comptes: await client("jira").instances() };
}
