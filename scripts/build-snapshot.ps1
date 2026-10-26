#Requires -Version 7
# Gera dist/pulso-imobiliario.html: um único arquivo com CSS, JS e dados embutidos (snapshot estático
# para compartilhar ou publicar). O snapshot não se atualiza sozinho: reflete o último data/bundle.js.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$html = Get-Content (Join-Path $Root 'index.html') -Raw
$css  = Get-Content (Join-Path $Root 'assets/styles.css') -Raw
$js   = Get-Content (Join-Path $Root 'assets/app.js') -Raw
$data = Get-Content (Join-Path $Root 'data/bundle.js') -Raw

function Between([string]$s, [string]$a, [string]$b) { $i = $s.IndexOf($a) + $a.Length; $s.Substring($i, $s.IndexOf($b) - $i) }
$head = (Between $html '<!--HEAD-START-->' '<!--HEAD-END-->') -replace '<link rel="stylesheet" href="assets/styles.css">', ''
$body = Between $html '<!--BODY-START-->' '<!--BODY-END-->'
$safe = { param($t) $t -replace '</script', '<\/script' }

$out = @"
$head
<style>
$css
</style>
$body
<script>
window.PULSO_SNAPSHOT = true;
$(& $safe $data)
</script>
<script>
$(& $safe $js)
</script>
"@
$dist = Join-Path $Root 'dist'; New-Item -ItemType Directory -Force $dist | Out-Null
Set-Content -Path (Join-Path $dist 'pulso-imobiliario.html') -Value $out -Encoding utf8NoBOM
"Snapshot gerado: dist/pulso-imobiliario.html ($([math]::Round($out.Length/1KB)) KB)"
