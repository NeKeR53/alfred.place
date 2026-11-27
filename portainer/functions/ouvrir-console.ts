import { docker, type Entree, environnementDuCompte, portainer, segment, verifier } from "../lib/portainer";

// Ouvre une console interactive (TTY) dans un conteneur, comme `docker exec -it`, et rend son canal (Terminal).
export default async function ({
  instance,
  conteneur,
  shell,
  utilisateur,
  colonnes,
  lignes,
}: Entree & { conteneur: string; shell?: "sh" | "bash"; utilisateur?: string; colonnes?: number; lignes?: number }) {
  const compte = portainer(instance);
  const commande =
    shell === "bash"
      ? ["/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash -l; fi; exec sh -l"]
      : ["/bin/sh", "-l"];
  const exec = verifier<{ Id?: string }>(
    await compte.post(docker(`/containers/${segment(conteneur)}/exec`), {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      ConsoleSize: [lignes ?? 30, colonnes ?? 120],
      Cmd: commande,
      Env: ["TERM=xterm-256color"],
      ...(utilisateur?.trim() ? { User: utilisateur.trim() } : {}),
    }),
    "l’ouverture de la console",
  );
  if (!exec.Id) throw new Error("Portainer n’a pas créé la console.");
  const environnement = await environnementDuCompte(instance);
  const socket = await compte.socket("/api/websocket/exec", { query: { id: exec.Id, endpointId: environnement } });
  if (!socket.ok || !socket.channel) throw new Error(`Portainer a refusé la console (HTTP ${socket.status}).`);
  return { canal: socket.channel, exec: exec.Id };
}
