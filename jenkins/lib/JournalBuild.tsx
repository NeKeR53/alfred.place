import { useEffect } from "react";
import { Button, Code, FeedbackBanner, LoadingSkeleton, Row, Spinner, Stack, Text } from "@alfred/ui";
import { functions, useAsync } from "@alfred/sdk";

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

  if (log.error && !log.data)
    return (
      <FeedbackBanner tone="danger" action={<Button onClick={log.reload}>Réessayer</Button>}>
        Le log n’a pas pu être lu : {log.error.message}
      </FeedbackBanner>
    );
  if (!log.data) return <LoadingSkeleton variant="page" rows={8} label="Lecture du log…" />;

  return (
    <Stack gap="sm">
      {enCours ? (
        <Row gap="xs">
          <Spinner />
          <Text as="span" size="meta" tone="muted">
            Build en cours : le log se met à jour tout seul.
          </Text>
        </Row>
      ) : null}
      {log.data.tronque ? (
        <Text size="meta" tone="muted">
          Le log est très long : seule sa fin est affichée. Le log complet s’ouvre dans Jenkins.
        </Text>
      ) : null}
      <Code block label={`Log du build n° ${log.data.numero}`}>
        {log.data.texte || "Le log est vide."}
      </Code>
    </Stack>
  );
}
