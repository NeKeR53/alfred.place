. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$id = [string](Get-Valeur $entree "id" "")
$dossierId = [string](Get-Valeur $entree "dossier" "")

if ([string]::IsNullOrWhiteSpace($id)) { throw "Aucun message à déplacer." }
if ([string]::IsNullOrWhiteSpace($dossierId)) { throw "Aucun dossier de destination." }

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  $mail = Get-Mail $session $id
  if ($null -eq $mail) { throw "Ce message n’existe plus dans Outlook." }

  $destination = Get-DossierDepuisId $session $dossierId
  if ($null -eq $destination) { throw "Ce dossier n’existe plus dans Outlook." }

  if ((Get-DossierId $mail.Parent) -eq $dossierId) {
    Write-Sortie @{ ok = $true }
    exit 0
  }

  $mail.Move($destination) | Out-Null
  Write-Sortie @{ ok = $true }
} catch {
  throw "Outlook n’a pas pu déplacer le message : $($_.Exception.Message)"
}
