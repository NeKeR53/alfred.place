. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$id = [string](Get-Valeur $entree "id" "")
$mode = [string](Get-Valeur $entree "mode" "repondre")
$texte = [string](Get-Valeur $entree "texte" "")
$signature = [string](Get-Valeur $entree "signature" "")

if ([string]::IsNullOrWhiteSpace($id)) { throw "Aucun message auquel répondre." }
if ([string]::IsNullOrWhiteSpace($texte)) { throw "Écrivez votre réponse." }

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  $mail = Get-Mail $session $id
  if ($null -eq $mail) { throw "Ce message n’existe plus dans Outlook." }

  if ($mode -eq "tous") { $reponse = $mail.ReplyAll() } else { $reponse = $mail.Reply() }
  if ($null -eq $reponse) { throw "Outlook n’a pas préparé la réponse." }

  $html = "<div>$(Html-Texte $texte)</div>"
  if (-not [string]::IsNullOrWhiteSpace($signature)) {
    $html += "<br><div>$(Html-Texte $signature)</div>"
  }
  $existant = ""
  try { $existant = [string]$reponse.HTMLBody } catch {}
  $reponse.HTMLBody = $html + "<br>" + $existant
  $reponse.Send()

  Write-Sortie @{ ok = $true }
} catch {
  throw "Outlook n’a pas pu envoyer la réponse : $($_.Exception.Message)"
}
