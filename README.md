# Pulso Imobiliário

Observatório do ambiente econômico, imobiliário, urbano e regulatório para desenvolvimento imobiliário: do cenário global a Joinville e Itapoá, com fonte, período e data de coleta em cada número.

## Áreas do site (menu lateral)

| Grupo | Áreas |
|---|---|
| Painel | Visão geral · Alertas |
| Conteúdo | **Notícias** (cartões com imagem, detalhes e link para o site original) · **Vídeos** (cartões; clique abre em tela cheia sem sair do site) |
| Indicadores | **Indicadores Macroeconômicos** (Selic, IPCA, câmbio, IBC-Br, emprego, população, PIB) · **Indicadores Setoriais** (CUB/SC, INCC-M, SINAPI, crédito imobiliário) |
| Escalas geográficas | Mundo · Brasil · Santa Catarina · Joinville · Itapoá |
| Governança | Fontes e método (catálogo, situação de cada feed/canal, registro de execuções, método) |

## O que está pronto

| Item | Situação |
|---|---|
| 30 séries: 23 das APIs oficiais (BCB/SGS e IBGE/SIDRA) + 7 da planilha (CUB/SC residencial e comercial, INCC-M e derivadas) | Operacional |
| Notícias: 15 feeds RSS, filtro de relevância, deduplicação, imagem do feed ou og:image, **histórico acumulativo** | Operacional |
| Vídeos: 14 canais do YouTube por RSS (+ API oficial opcional), **histórico acumulativo** | Operacional; RSS do YouTube oscila sem a chave |
| Validação, respostas brutas, revisões, preservação do último dado válido, alertas R1–R8 | Operacional |
| Conferência do IPCA da planilha com o BCB | 248 meses comparados, 0 divergências |
| Agendamento diário às 07h15 (America/Sao_Paulo) | **Preparado, não ativado**: veja abaixo |

A rotina diária **não usa IA nem tokens do Claude**: é um script PowerShell que consulta APIs e feeds.

## Uso

Requer PowerShell 7 (`pwsh`).

```
pwsh -File collector/collect.ps1                       # coleta séries, notícias e vídeos
pwsh -File collector/collect.ps1 -SkipContent          # só séries (reaproveita notícias/vídeos já salvos)
pwsh -File scripts/importar-planilha.ps1 -Caminho "C:\...\Indices CUB INCC IPCA.xlsx"   # atualiza CUB/INCC
pwsh -File scripts/serve.ps1                           # abre em http://localhost:8765 (necessário para tocar vídeos)
pwsh -File scripts/build-snapshot.ps1                  # gera dist/pulso-imobiliario.html (arquivo único)
```

Os vídeos precisam do site servido por http (servidor local ou GitHub Pages): o YouTube não toca vídeos incorporados em arquivos abertos direto do disco.

## Chave da API do YouTube (opcional, recomendada)

Sem chave, os vídeos vêm do RSS dos canais, que às vezes falha. Com chave, a API cobre essas falhas e acrescenta uma busca por tema.

**Consumo de cota (limite gratuito: 10.000 unidades/dia):**
- RSS: 0 unidade (sempre tentado primeiro).
- Canal com RSS indisponível: `playlistItems.list` = 1 unidade por canal.
- Busca por tema: `search.list` = 100 unidades por consulta, no máximo `maxSearchPerRun` (padrão 2) por dia, em rodízio. Para gastar quase nada, defina `"maxSearchPerRun": 0` em `collector/content-sources.json`.
- Estimativa padrão: cerca de 200 a 215 unidades por dia (aproximadamente 2% da cota).

**Onde colocar a chave (nunca no código):**
- GitHub Actions: Settings → Secrets and variables → Actions → *New repository secret*, com o nome `YOUTUBE_API_KEY`.
- Windows (Agendador de Tarefas): em um terminal seu, rode `[Environment]::SetEnvironmentVariable('YOUTUBE_API_KEY', 'SUA_CHAVE', 'User')`.

No Google Cloud, restrinja a chave à *YouTube Data API v3* (APIs e serviços → Credenciais → Restrições de API).

## Ativar a atualização diária

**Opção A, recomendada: GitHub Actions** (roda nos servidores do GitHub, sem depender do seu computador).
1. Crie um repositório e envie esta pasta.
2. (Opcional) Crie o secret `YOUTUBE_API_KEY`.
3. O workflow `.github/workflows/coleta-diaria.yml` roda às 10h15 UTC (07h15 em Brasília) e grava os dados no repositório.
4. Ative o GitHub Pages (Settings → Pages → branch principal, pasta raiz) para publicar o site.

**Opção B: Agendador de Tarefas do Windows** (exige o computador ligado).
```
pwsh -File scripts/registrar-tarefa-windows.ps1
```

## Estrutura

```
index.html, assets/           site (menu lateral, sem frameworks)
collector/series.json         catálogo de séries (conector, unidade, natureza, validação, grupo)
collector/content-sources.json feeds de notícias, canais do YouTube, termos de relevância e temas
collector/collect.ps1         séries → validação → armazenamento → alertas → publicação
collector/content.ps1         notícias e vídeos (histórico acumulativo)
data/store/                   histórico por série + revisões
data/raw/AAAA-MM-DD/          respostas brutas (gravadas só quando mudam)
data/manual/                  planilha importada (CUB, INCC, IPCA)
data/news/news.json           histórico de notícias (nunca apagado)
data/videos/videos.json       histórico de vídeos (nunca apagado)
data/curated/                 sínteses, análises, catálogo de fontes, sementes de vídeo verificadas
data/runs.json                registro de execuções
data/bundle.js                o que o site lê
```

## Limitações conhecidas

- CUB/SC e INCC-M dependem de nova importação da planilha. A planilha não identifica o projeto-padrão do CUB (R8-N etc.), e o CUB comercial só existe a partir de out/2024.
- O INCC-M vem de fonte secundária (Dados de Mercado), não direto da FGV.
- O resumo das notícias é o trecho do feed (até cerca de 320 caracteres). A classificação de tema e geografia é feita por palavras-chave e pode errar.
- O `data/bundle.js` cresce com o histórico de notícias e vídeos (~1 KB por item). Com milhares de itens, vale paginar a partir de `data/news/news.json`.
- Os links do LinkedIn fornecidos não foram acessados (exigem login).
