. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$id = [string](Get-Valeur $entree "id" "")
$destinataires = [string](Get-Valeur $entree "destinataires" "")
$texte = [string](Get-Valeur $entree "texte" "")
$signature = [string](Get-Valeur $entree "signature" "")

if ([string]::IsNullOrWhiteSpace($id)) { throw "Aucun message à transférer." }
$adresses = @(Adresses-Texte $destinataires)
if ($adresses.Count -eq 0) { throw "Indiquez au moins une adresse de destinataire." }

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  $mail = Get-Mail $session $id
  if ($null -eq $mail) { throw "Ce message n’existe plus dans Outlook." }

  $forward = $mail.Forward()
  if ($null -eq $forward) { throw "Outlook n’a pas préparé le transfert." }

  $forward.To = ($adresses -join "; ")
  $html = ""
  if (-not [string]::IsNullOrWhiteSpace($texte)) { $html += "<div>$(Html-Texte $texte)</div><br>" }
  if (-not [string]::IsNullOrWhiteSpace($signature)) { $html += "<div>$(Html-Texte $signature)</div><br>" }
  $existant = ""
  try { $existant = [string]$forward.HTMLBody } catch {}
  $forward.HTMLBody = $html + $existant
  $forward.Send()

  Write-Sortie @{ ok = $true }
} catch {
  throw "Outlook n’a pas pu transférer le message : $($_.Exception.Message)"
}
