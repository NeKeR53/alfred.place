import { client } from "@alfred/sdk";

export default async function () {
  const comptes = await client("bitbucket").instances();
  return { comptes: Array.isArray(comptes) ? comptes : [] };
}
