import { functions, useAsync } from "@alfred/sdk";
import { RotateCw } from "lucide-react";
import { useEffect } from "react";
import { EmptyState, LogViewer } from "socle-ui";

interface Log {
  numero: number;
  enCours: boolean;
  resultat: string | null;
  texte: string;
  tronque: boolean;
  taille: number;
  url: string | null;
}

/** Log d’un build, relu toutes les trois secondes tant que le build tourne. */
export function JournalBuild({ instance, job, build }: { instance: string; job: string; build?: number }) {
  const log = useAsync(
    () => functions.call<Log>("lire-log", { ...(instance ? { instance } : {}), job, ...(build ? { build } : {}) }),
    [instance, job, build],
  );
  const enCours = log.data?.enCours ?? false;

  useEffect(() => {
    if (!enCours) return;
    const minuterie = setInterval(log.reload, 3000);
    return () => clearInterval(minuterie);
  }, [enCours, log.reload]);

  const texte = log.data?.texte ?? "";
  const lignes = [
    ...(log.data?.tronque ? ["Le log est très long : seule sa fin est affichée. Le log complet s’ouvre dans Jenkins."] : []),
    ...(texte ? texte.split("\n") : []),
  ];
  return (
    <LogViewer
      label={log.data ? `Log du build n° ${log.data.numero}` : "Log du build"}
      lines={lignes}
      live={enCours}
      loading={!log.data && !log.error}
      timestamps={false}
      empty={
        log.error ? (
          <EmptyState
            size="compact"
            title="Le log n’a pas pu être lu"
            description={log.error.message}
            action={undefined}
          />
        ) : (
          <EmptyState size="compact" title="Le log est vide" />
        )
      }
      actions={() => [{ id: "relire", label: "Relire le log", icon: <RotateCw size={16} />, onPress: log.reload }]}
    />
  );
}
