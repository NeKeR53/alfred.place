import { type Entree, pile, portainer, segment, verifier } from "../lib/portainer";

// Une pile et son fichier compose.
export default async function ({ instance, pile: id }: Entree & { pile: number }) {
  const compte = portainer(instance);
  const brute = verifier<Parameters<typeof pile>[0]>(await compte.get(`/api/stacks/${segment(id)}`), "la pile");
  const fichier = verifier<{ StackFileContent?: string }>(await compte.get(`/api/stacks/${segment(id)}/file`), "le fichier de la pile");
  return { ...pile(brute), compose: fichier.StackFileContent ?? "" };
}
