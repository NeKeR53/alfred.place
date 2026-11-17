. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$id = [string](Get-Valeur $entree "id" "")
$lu = [bool](Get-Valeur $entree "lu" $true)

if ([string]::IsNullOrWhiteSpace($id)) { throw "Aucun message à marquer." }

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  $mail = Get-Mail $session $id
  if ($null -eq $mail) { throw "Ce message n’existe plus dans Outlook." }

  $mail.UnRead = (-not $lu)
  $mail.Save()
  Write-Sortie @{ ok = $true }
} catch {
  throw "Outlook n’a pas pu marquer le message : $($_.Exception.Message)"
}
