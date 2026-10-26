# Pulso Imobiliário — coleta de notícias (RSS) e vídeos (YouTube).
# Carregado por collect.ps1 (usa Read-Json, Write-Json, Iso-SP, Get-Hash e $inv definidos lá).
# Histórico ACUMULATIVO: itens nunca são removidos; novos itens são acrescentados com a data em que foram vistos.

$ContentCfg = Get-Content (Join-Path $PSScriptRoot 'content-sources.json') -Raw | ConvertFrom-Json

function Norm-Text([string]$t) {
  if (-not $t) { return '' }
  $n = $t.Normalize([Text.NormalizationForm]::FormD)
  $sb = [Text.StringBuilder]::new()
  foreach ($ch in $n.ToCharArray()) { if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne 'NonSpacingMark') { [void]$sb.Append($ch) } }
  ' ' + $sb.ToString().ToLowerInvariant() + ' '
}
function Clean-Html([string]$html, [int]$max = 320) {
  if (-not $html) { return '' }
  $t = [regex]::Replace($html, '<(script|style)[^>]*>.*?</\1>', ' ', 'Singleline')
  $t = [regex]::Replace($t, '<[^>]+>', ' ')
  $t = [Net.WebUtility]::HtmlDecode($t)
  $t = [regex]::Replace($t, '\s+', ' ').Trim()
  $t = [regex]::Replace($t, '\s*(The post|O post) .* (appeared first on|apareceu primeiro em) .*$', '')
  if ($t.Length -gt $max) { $cut = $t.Substring(0, $max); $sp = $cut.LastIndexOf(' '); if ($sp -gt 200) { $cut = $cut.Substring(0, $sp) }; $t = $cut.TrimEnd(',', ';', ':', ' ') + '…' }
  $t
}
# Termos casam no início de palavra (radicais como "imobiliari" pegam "imobiliária"/"imobiliário");
# termos curtos (até 4 letras, como "aco", "cub", "fii") precisam ser a palavra inteira.
$script:RxCache = @{}
function Term-Rx([string]$t) {
  if (-not $script:RxCache.ContainsKey($t)) {
    $core = [regex]::Escape($t.Trim())
    $end = if ($t.Trim().Length -le 4) { '(?![\p{L}\d])' } else { '' }
    $script:RxCache[$t] = [regex]::new('(?<![\p{L}\d])' + $core + $end, 'Compiled')
  }
  $script:RxCache[$t]
}
function Has-Term([string]$normText, [string]$t) { (Term-Rx $t).IsMatch($normText) }
function Get-Relevance([string]$text, [string]$title = '') {
  $n = Norm-Text $text; $nt = Norm-Text $title; $score = 0; $hits = @(); $strongInTitle = $false
  foreach ($k in $ContentCfg.keywords.strong) { if (Has-Term $n $k) { $score += 2; $hits += $k; if ($nt -and (Has-Term $nt $k)) { $strongInTitle = $true } } }
  foreach ($k in $ContentCfg.keywords.weak) { if (Has-Term $n $k) { $score += 1; $hits += $k } }
  [pscustomobject]@{ score = $score; hits = $hits; strongInTitle = $strongInTitle }
}
function Test-Relevant($rel, [string]$kind) {
  # Fonte do setor: basta 1 ponto. Veículo geral: termo forte no título ou pontuação ≥ 4.
  if ($kind -eq 'setorial') { return $true }
  return ($rel.strongInTitle -or $rel.score -ge 4)
}
function Get-Classes([string]$text) {
  $n = Norm-Text $text
  $themes = @(); foreach ($p in $ContentCfg.themes.PSObject.Properties) { foreach ($k in $p.Value) { if (Has-Term $n $k) { $themes += $p.Name; break } } }
  $geo = 'Brasil'; foreach ($g in 'Itapoá', 'Joinville', 'Santa Catarina', 'Mundo') { foreach ($k in $ContentCfg.geo.$g) { if (Has-Term $n $k) { $geo = $g; break } }; if ($geo -ne 'Brasil') { break } }
  [pscustomobject]@{ themes = @($themes | Select-Object -First 3); geo = $geo }
}
function Normalize-Url([string]$u) {
  try {
    $uri = [Uri]$u.Trim()
    $q = @($uri.Query.TrimStart('?').Split('&') | Where-Object { $_ -and $_ -notmatch '^(utm_|fbclid|gclid|amp)' })
    $b = $uri.GetLeftPart([UriPartial]::Path).TrimEnd('/')
    if ($q.Count) { $b += '?' + ($q -join '&') }
    $b
  } catch { $u }
}
function Get-Text([string]$url, [int]$timeout = 25) {
  $r = Invoke-WebRequest -Uri $url -TimeoutSec $timeout -Headers @{ 'User-Agent' = 'Mozilla/5.0 (compatible; PulsoImobiliario/1.0; leitor RSS)'; 'Accept-Language' = 'pt-BR' }
  $bytes = $r.RawContentStream.ToArray()
  [Text.Encoding]::UTF8.GetString($bytes)
}
function Parse-Date([string]$s) {
  $d = [DateTimeOffset]::MinValue
  if ($s -and [DateTimeOffset]::TryParse(($s -replace ' -0000$', ' +0000'), $inv, [Globalization.DateTimeStyles]::None, [ref]$d)) { return $d.ToString("yyyy-MM-dd'T'HH:mm:sszzz", $inv) }
  $null
}
function Node-Text($node, [string]$name) { $n = $node.SelectSingleNode("*[local-name()='$name']"); if ($n) { $n.InnerText } else { $null } }

# ------------------------------------------------------------------ NOTÍCIAS
function Update-News {
  $path = Join-Path $DataDir 'news/news.json'
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $store = Read-Json $path ([pscustomobject]@{ items = @(); sources = [pscustomobject]@{} })
  $items = [Collections.Generic.List[object]]::new(); foreach ($i in @($store.items)) { $items.Add($i) }
  $byId = @{}; $byTitle = @{}
  foreach ($i in $items) { $byId[$i.id] = $true; $byTitle[(Norm-Text $i.title).Trim()] = $true }
  $srcState = if ($store.sources) { $store.sources } else { [pscustomobject]@{} }
  $added = 0; $needImage = [Collections.Generic.List[object]]::new()
  foreach ($f in $ContentCfg.news) {
    $st = [ordered]@{ lastAttempt = (Iso-SP); lastSuccess = $srcState.($f.name).lastSuccess; lastError = $null; read = 0; accepted = 0; added = 0 }
    try {
      [xml]$x = Get-Text $f.url
      $nodes = @($x.SelectNodes("//*[local-name()='item']")); if (-not $nodes.Count) { $nodes = @($x.SelectNodes("//*[local-name()='entry']")) }
      foreach ($it in $nodes) {
        $st.read++
        $title = Clean-Html (Node-Text $it 'title') 300
        $link = Node-Text $it 'link'; if (-not $link) { $ln = $it.SelectSingleNode("*[local-name()='link']"); if ($ln) { $link = $ln.GetAttribute('href') } }
        if (-not $title -or -not $link) { continue }
        $descRaw = Node-Text $it 'description'; if (-not $descRaw) { $descRaw = Node-Text $it 'summary' }
        $cats = (@($it.SelectNodes("*[local-name()='category']")) | ForEach-Object { $_.InnerText }) -join ' '
        $summary = Clean-Html $descRaw 320
        $rel = Get-Relevance "$title $summary $cats" $title
        if (-not (Test-Relevant $rel $f.kind)) { continue }
        if ($rel.score -eq 0) { $rel.score = 1 }  # fonte do setor sem termo-chave: relevância mínima
        $st.accepted++
        $url = Normalize-Url $link
        $id = (Get-Hash $url).Substring(0, 16)
        $tkey = (Norm-Text $title).Trim()
        if ($byId[$id] -or $byTitle[$tkey]) { continue }
        # imagem: media:content / enclosure / imagem-destaque / primeira <img> do conteúdo
        $img = $null
        foreach ($xp in "*[local-name()='content' and @url]", "*[local-name()='thumbnail' and @url]", "*[local-name()='enclosure' and @url]") { $n = $it.SelectSingleNode($xp); if ($n -and $n.GetAttribute('url') -match '\.(jpe?g|png|webp)|glbimg|imagens\.ebc') { $img = $n.GetAttribute('url'); break } }
        if (-not $img) { $m = [regex]::Match($it.OuterXml, '(https?://[^"''\s<>]+?\.(?:jpe?g|png|webp))'); if ($m.Success) { $img = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value) } }
        $cls = Get-Classes "$title $summary $cats"
        $obj = [pscustomobject]@{
          id = $id; url = $url; title = $title; summary = $summary; source = $f.name; site = $f.site; kind = $f.kind
          published = (Parse-Date (Node-Text $it 'pubDate')) ?? (Parse-Date (Node-Text $it 'published')) ?? (Parse-Date (Node-Text $it 'updated'))
          firstSeen = (Iso-SP); image = $img; imageFrom = if ($img) { 'feed' } else { $null }
          themes = $cls.themes; geo = $cls.geo; relevance = $rel.score; matched = @($rel.hits | Select-Object -First 6)
        }
        $items.Add($obj); $byId[$id] = $true; $byTitle[$tkey] = $true; $added++; $st.added++
        if (-not $img) { $needImage.Add($obj) }
      }
      $st.lastSuccess = (Iso-SP)
    } catch { $st.lastError = $_.Exception.Message }
    $srcState | Add-Member -Force $f.name ([pscustomobject]$st)
    Write-Host ("  notícias  {0,-34} lidos={1,-3} relevantes={2,-3} novos={3} {4}" -f $f.name, $st.read, $st.accepted, $st.added, $st.lastError)
  }
  # og:image das páginas originais (no máximo 40 por execução, para ser educado com os sites).
  # Inclui itens antigos sem imagem que ainda não foram tentados.
  foreach ($i in $items) { if (-not $i.image -and -not $i.imageTried -and -not $needImage.Contains($i)) { $needImage.Add($i) } }
  foreach ($o in ($needImage | Select-Object -First 40)) {
    $o | Add-Member -Force imageTried $true
    try {
      $h = Get-Text $o.url 15
      $m = [regex]::Match($h, '<meta[^>]+(?:property|name)=["''](?:og:image|twitter:image)["''][^>]+content=["'']([^"'']+)["'']')
      if (-not $m.Success) { $m = [regex]::Match($h, '<meta[^>]+content=["'']([^"'']+)["''][^>]+(?:property|name)=["'']og:image["'']') }
      if ($m.Success) { $o.image = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value); $o.imageFrom = 'og:image' }
    } catch { }
  }
  $sorted = @($items | Sort-Object { $_.published ?? $_.firstSeen } -Descending)
  Write-Json $path ([pscustomobject]@{ updatedAt = (Iso-SP); items = $sorted; sources = $srcState })
  [pscustomobject]@{ added = $added; total = $sorted.Count; sources = $srcState }
}

# ------------------------------------------------------------------ VÍDEOS
function Update-Videos {
  $path = Join-Path $DataDir 'videos/videos.json'
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $store = Read-Json $path ([pscustomobject]@{ items = @(); channels = [pscustomobject]@{}; api = $null })
  $items = [Collections.Generic.List[object]]::new(); foreach ($i in @($store.items)) { $items.Add($i) }
  $seen = @{}; foreach ($i in $items) { $seen[$i.id] = $true; $seen['t|' + $i.channel + '|' + (Norm-Text $i.title).Trim()] = $true }
  $chState = if ($store.channels) { $store.channels } else { [pscustomobject]@{} }
  $added = 0; $units = 0
  $yt = $ContentCfg.youtube
  $key = $env:YOUTUBE_API_KEY

  function Add-Video($id, $title, $channel, $channelId, $published, $desc, $via, [bool]$requireRel) {
    $tk = 't|' + $channel + '|' + (Norm-Text $title).Trim()
    if (-not $id -or $seen[$id] -or $seen[$tk]) { return $false }
    $rel = Get-Relevance "$title $desc" $title
    if ($requireRel -and -not (Test-Relevant $rel 'geral')) { return $false }
    $seen[$tk] = $true
    $cls = Get-Classes "$title $desc"
    $items.Add([pscustomobject]@{ id = $id; title = $title; channel = $channel; channelId = $channelId; published = $published; firstSeen = (Iso-SP); via = $via; description = (Clean-Html $desc 240); themes = $cls.themes; geo = $cls.geo; relevance = $rel.score })
    $seen[$id] = $true; $script:videoAdded++; return $true
  }
  $script:videoAdded = 0

  # 1) sementes verificadas (só entram uma vez)
  $seedPath = Join-Path $DataDir 'curated/videos-seed.json'
  if (Test-Path $seedPath) { foreach ($v in (Get-Content $seedPath -Raw | ConvertFrom-Json).items) { [void](Add-Video $v.id $v.title $v.channel $v.channelId $v.published '' 'descoberta inicial verificada' $false) } }

  # 2) canais monitorados: RSS (sem cota) e, se houver chave, playlistItems (1 unidade por canal)
  foreach ($c in $yt.channels) {
    $st = [ordered]@{ lastAttempt = (Iso-SP); lastSuccess = $chState.($c.name).lastSuccess; lastError = $null; via = $null; added = 0 }
    $req = $c.kind -ne 'setorial'
    $before = $script:videoAdded
    $ok = $false
    try {
      [xml]$x = Get-Text "https://www.youtube.com/feeds/videos.xml?channel_id=$($c.id)" 20
      foreach ($e in @($x.feed.entry)) {
        $vid = Node-Text $e 'videoId'
        $desc = ($e.SelectSingleNode("*[local-name()='group']/*[local-name()='description']")).InnerText
        [void](Add-Video $vid $e.title $c.name $c.id (Parse-Date $e.published) $desc 'RSS do canal' $req)
      }
      $ok = $true; $st.via = 'RSS'
    } catch { $st.lastError = "RSS: $($_.Exception.Message)" }
    if (-not $ok -and $key) {
      try {
        $pl = 'UU' + $c.id.Substring(2)
        $r = Invoke-RestMethod "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=15&playlistId=$pl&key=$key" -TimeoutSec 30
        $units += 1
        foreach ($i in $r.items) { $s = $i.snippet; [void](Add-Video $s.resourceId.videoId $s.title $c.name $c.id $s.publishedAt $s.description 'API do YouTube (canal)' $req) }
        $ok = $true; $st.via = 'API'; $st.lastError = $null
      } catch { $st.lastError += " | API: $($_.Exception.Message)" }
    }
    if ($ok) { $st.lastSuccess = (Iso-SP) }
    $st.added = $script:videoAdded - $before
    $chState | Add-Member -Force $c.name ([pscustomobject]$st)
    Write-Host ("  vídeos    {0,-30} via={1,-4} novos={2} {3}" -f $c.name, $st.via, $st.added, $st.lastError)
  }

  # 3) busca por tema (somente com chave; 100 unidades por consulta; rodízio das consultas por dia)
  $apiInfo = [ordered]@{ keyConfigured = [bool]$key; searchRuns = 0; unitsEstimated = 0; lastError = $null }
  if ($key -and $yt.maxSearchPerRun -gt 0) {
    $q = @($yt.searchQueries); $start = ((Now-SP).DayOfYear * $yt.maxSearchPerRun) % $q.Count
    $after = (Now-SP).AddDays(-7).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", $inv)
    for ($k = 0; $k -lt [Math]::Min($yt.maxSearchPerRun, $q.Count); $k++) {
      $term = $q[($start + $k) % $q.Count]
      try {
        $r = Invoke-RestMethod ("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&relevanceLanguage=pt&regionCode=BR&order=date&publishedAfter=$after&q=" + [uri]::EscapeDataString($term) + "&key=$key") -TimeoutSec 30
        $units += 100; $apiInfo.searchRuns++
        foreach ($i in $r.items) { $s = $i.snippet; [void](Add-Video $i.id.videoId ([Net.WebUtility]::HtmlDecode($s.title)) $s.channelTitle $s.channelId $s.publishedAt $s.description "API do YouTube (busca: $term)" $true) }
      } catch { $apiInfo.lastError = $_.Exception.Message }
    }
  }
  $apiInfo.unitsEstimated = $units
  $sorted = @($items | Sort-Object { $_.published ?? $_.firstSeen } -Descending)
  Write-Json $path ([pscustomobject]@{ updatedAt = (Iso-SP); items = $sorted; channels = $chState; api = [pscustomobject]$apiInfo })
  Write-Host "  vídeos: $($script:videoAdded) novos, $($sorted.Count) no histórico, cota estimada nesta execução: $units unidades"
  [pscustomobject]@{ added = $script:videoAdded; total = $sorted.Count; channels = $chState; api = [pscustomobject]$apiInfo }
}
