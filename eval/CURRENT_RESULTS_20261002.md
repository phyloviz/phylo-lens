# Resultados atuais — 2026-10-02

As campanhas usam o código local, sem publicação. Base Git:
`6bf39acd2d5daa7420d28855de55166344924214`; fingerprint do produto:
`476526b91cad9c916668415504bfa159a82944337709f5f5ff4da284a9472f15`.
O campo de pacote 0.2.2 não identifica sozinho estas alterações.

- **RQ2/RQ4:** 104 medições válidas e 18 warm-ups excluídos; auditoria independente passou.
- **RQ3:** os 15 níveis da árvore Full-MST de 100k passaram: partição exata,
  agregados conectados com uma fronteira, refinamento, coordenadas canónicas,
  arestas/pesos e nível final sem agregados multi-nó. Há 207.923 representações
  ao somar os níveis; os registos de membros continuam a cobrir 100k nós por nível.
- **Comparação externa atual:** 90 medições válidas e 30 warm-ups excluídos;
  12,5k–200k, três ferramentas. Ambas as partes passaram auditoria e têm os
  mesmos hashes de código de medição, produto, bundle, browser e Graphviz.
- **RQ1:** concluída e auditada: 50 medições válidas e 10 warm-ups excluídos,
  sem falhas, nas dez condições 12,5k–200k.
- **MSAGL:** baseline histórico fixado conservado, com total e diferença
  `total_ms - parse_ms` calculada por observação; não houve nova campanha MSAGL.

## RQ4: medianas em ms, sete medições por cenário

| Cenário | Membros | Expandir | Colapsar |
|---|---:|---:|---:|
| Pequeno | 2 | 106,8 | 16,6 |
| Intermédio | 88 | 156,2 | 23,9 |
| Grande | 3.796 | 399,1 | 446,6 |

Navegação: **859,9 ms**. O intervalo mediano input→pedido foi 380,6 ms;
a evidência de timers mostra ~250 ms de animação da câmara seguidos do último
debounce de 120 ms. O intervalo HTTP mediano foi 464,3 ms. São fases observadas,
não uma atribuição de toda a latência a constantes. As medianas de fases não
têm de somar a mediana do total.

RQ2 integrado recebeu **797, 2.901, 6.675 e 8.160 nós**, todos sem truncação;
as medianas load→duas oportunidades de frame foram **120,7 / 178,9 / 457,6 /
354,7 ms**. A composição, queries, payloads, memória e frames estão no relatório.

## Comparação externa: medianas aos 200k

| Ferramenta | Primeira saída visual, s |
|---|---:|
| PhyloLens local | 108,153 |
| Phylotree.js 2.6.0 | 5,569 |
| Taxonium 2.1.24 | 0,399 |

As ferramentas apresentam conteúdo diferente nas respetivas fronteiras:
viewport agregado, SVG nativo e tiles iniciais. Não é uma comparação de render
integral do mesmo número de nós. Critérios operacionais e estados de fidelidade
são explícitos no protocolo e nos raw.

PhyloLens aos 200k: mediana load→ready **107,855 s**, ready→visual **0,298 s**,
processo SFDP **60,706 s**, aproximadamente **1,00 CPU equivalente médio**.
Estes spans localizam os custos atuais. Não explicam causalmente a diferença
histórica de ~60 s entre versões/ambientes diferentes. A nova RQ1 usa o mesmo
percurso nativo para permitir uma comparação futura devidamente delimitada.

Ambiente atual: Apple M4 Pro, 12 CPUs lógicos disponíveis, 24 GiB RAM; macOS 27;
Chromium 140.0.7339.16/Playwright 1.55.0; Metal; Graphviz **15.1.0** nativo,
Homebrew bottle arm64, GTS **0.7.6_3** no recibo de dependências. O macOS regista
DELL P3425WE, 3440×1440, modo nominal **100 Hz**; a taxa física não foi controlada.
As versões históricas de Chromium/Graphviz/OCI conservam os seus identificadores.

## Relatórios e protocolo

- [RQ2/RQ3/RQ4 completos](results/local/current-evidence-final-20261002/REPORT.md)
- [Comparação externa consolidada](results/derived/current-external-combined-20261002/REPORT.md)
- [Fases atuais aos 200k](results/local/current-external-200k-final-20261002/REPORT.md)
- [Protocolo, comandos e limitações](CURRENT_EVALUATION.md)
- [Auditoria histórica/MSAGL e proveniência](EXTERNAL_COMPARISON_AUDIT_20261002.md)
- [Índice de artefactos](results/derived/current-evaluation-index-20261002.json)

O warm-up original de 200k esgotou o disco antes de qualquer medição desse
tamanho. Só essa célula foi repetida numa nova pasta; tudo até 150k foi preservado.
A interrupção e os hashes das duas fontes estão no audit consolidado. Foram
adicionadas guardas de espaço e propagação de falhas do sampler para RQ1.

Sete runners duplicados foram arquivados com hashes e substituídos por entradas
canónicas sem sufixos de versão. Layouts gerados foram comprimidos com validação
SHA-256 após descompressão; dados raw de medição não foram apagados. O master
100k está em `.gz`: restaurar antes de repetir a auditoria de base de dados.

Verificação final: 88 testes de avaliação passaram (7 skips), 16 testes focados
passaram, 11 testes browser passaram; lint, tipos e diff-check passaram. A
verificação anterior do produto passou 277 testes cliente e 104 testes servidor;
não houve alterações de comportamento do produto nesta etapa de avaliação.

Continuam explicitamente por estabelecer: esquema/versão EnteroBase, data de
download, número original de perfis e loci. O Newick retido não permite recuperar
esses dados. MSAGL não tem uma medição Newick→primeiro frame: o total histórico
começa na lista de arestas adaptada e termina em tile-ready, com construção
nativa incluída. Estas fronteiras não são renomeadas nem custos omitidos.

## RQ1 concluída: preparação e memória

Cinco medições por tamanho, com um warm-up excluído; serviço/store novos por
observação. Fronteira: POST público→primeiro ready observado por polling de
100 ms. Não inclui startup nem é uma medição de primeiro frame. RSS cobre o
ciclo de vida do processo e descendentes, amostrado a cada 20 ms.

| Nós canónicos | Mediana preparação, s | Mediana pico RSS, GiB |
|---:|---:|---:|
| 12,500 | 3.963 | 0.148 |
| 25,000 | 8.704 | 0.245 |
| 37,500 | 13.705 | 0.339 |
| 50,000 | 19.372 | 0.407 |
| 62,500 | 24.853 | 0.499 |
| 75,000 | 30.613 | 0.589 |
| 87,500 | 37.176 | 0.665 |
| 100,000 | 44.625 | 0.735 |
| 150,000 | 71.445 | 1.141 |
| 200,000 | 100.023 | 1.530 |

Aos 200k, SFDP teve mediana **64,425 s** na RQ1. O total da comparação externa
atual foi 108,153 s, contra 100,023 s da RQ1: diferença entre medianas de
**8,130 s**, em campanhas independentes com o mesmo fingerprint. Não são
observações emparelhadas nem uma decomposição causal; não atribuir o delta
inteiro ao browser. Isto não explica retrospetivamente o delta histórico de
60 s entre versões/ambientes diferentes.

- [RQ1: relatório auditado](results/local/current-rq1-final-USER/REPORT.md)
- [RQ1: valores auditados, fases e RSS](results/local/current-rq1-final-USER/audited-observations.json)
- [Figuras atuais, CSVs e captions](results/derived/chapter5-figures-current/README.md)
- [Gerador de figuras](tools/generate_chapter5_figures.py)
- [Índice de resultados](results/README.md)

Não houve commit, push, publicação ou edição do texto da tese.
