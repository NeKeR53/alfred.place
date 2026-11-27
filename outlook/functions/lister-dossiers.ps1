. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  # « compte » : le compte choisi dans la page (paramètre de l’état partagé) ; « instance » reste accepté.
  $instance = [string](Get-Valeur $entree "compte" "")
  if ([string]::IsNullOrWhiteSpace($instance)) { $instance = [string](Get-Valeur $entree "instance" "") }

  $boite = Get-Boite $session $instance
  $store = Get-Store $session $instance
  $racine = $store.GetRootFolder()

  $exclus = @(
    "Sync Issues",
    "Conversation Action Settings",
    "Quick Step Settings",
    "Freebusy Data",
    "Recoverable Items",
    "Conversation History",
    "Yammer Root",
    "RSS Feeds",
    "Search Folders",
    "Files",
    "TeamsMessagesData"
  )

  $dossiers = @()
  foreach ($dossier in @($racine.Folders)) {
    try {
      if ([int]$dossier.DefaultItemType -ne 0) { continue }
      if ($exclus -contains [string]$dossier.Name) { continue }
      $dossiers += Get-Dossiers $dossier 0
    } catch {}
  }

  if ($dossiers.Count -eq 0) {
    $dossiers += Get-Dossiers $boite 0
  }

  $boiteId = Get-DossierId $boite
  $dossiers = @($dossiers | Sort-Object -Property @{ Expression = { if ($_.id -eq $boiteId) { 0 } else { 1 } } }, profondeur, nom)

  Write-Sortie @{ boite = $boiteId; dossiers = @($dossiers) }
} catch {
  Write-Sortie @{ boite = ""; dossiers = @() }
}
