# Auditoria da comparação externa — 2026-10-02

Esta auditoria lê os registos históricos, não executa novas campanhas e não altera produto, raw, protocolo ou ficheiros em `~/Developer/Thesis`. Distingue medições, fronteiras efetivamente implementadas, interpretação estática e informação ausente. Os resultados recalculados estão em `eval/results/derived/external-comparison-audit-20261002/`; o script `scripts/audit_external_comparison_details.py` conserva hashes SHA-256 das fontes, verifica reconciliação das fases e exclui warmups/falhas das medianas.

## Fontes autoritativas

- Phylotree.js e Taxonium: `/Users/goncalofrutuoso/Developer/Thesis/results/raw/final/final-external-fullmst/thesis-final-fullmst-001/`. Harness `e3aa8ab151be016edeacf42e23a477279435f8e5`, checkout limpo.
- PhyloLens externo: `/Users/goncalofrutuoso/Developer/Thesis/results/raw/final/final-external-fullmst-phylolens-0.2.0/thesis-final-fullmst-phylolens-v020-004/`. Harness `5cfd264eee0bcb54f03ae27488ec9ddf4d5b2d75`, checkout limpo. A campanha substitui apenas as células PhyloLens originalmente inválidas por infraestrutura. Não misturar runs v020-001/002/003.
- Política confirmada por `/Users/goncalofrutuoso/Developer/Thesis/results/derived/final-external-fullmst-combined-v020/thesis-final-fullmst-combined-v020-004/combined-final-audit.json` (passed/report_congruent=true).
- RQ1 Full-MST: `eval/results/raw/rq1-final-fullmst-v022/thesis-final-rq1-fullmst-v022-002/`. Produto v0.2.2; harness local registado dirty=true. Não substituir a proveniência do harness pela do release.
- MSAGLJS Full-MST: `eval/results/raw/rq5-msagljs-fullmst-v001/thesis-msagljs-fullmst-v001-001/`. Manifesto final_campaign, development_evidence_only=false. Não confundir com a campanha sintética MDS: esta usa contagens de folhas e árvores de ~2n−1 nós.

## Versões e identificadores exatos

**Phylotree.js: npm `phylotree@2.6.0`.** Adaptador `native-newick-browser-1.0.0`.

- Tarball: `https://registry.npmjs.org/phylotree/-/phylotree-2.6.0.tgz`.
- Integridade npm: `sha512-rvCvD2gQnxfR0eA9hnQvOela6FtnPVtWFiP3qQloCsnqSrgZdykbB00jk3cAP6+qD28T8mWNSQqA6TZ5180QXA==`.
- SHA-256 package-lock: `9b29eb39bb773fb4076dbe472e01fccf16bd663e0e573b708917ae9a2a0533fe`.
- React/react-dom 19.2.7; Vite 7.3.6.

**Taxonium: npm `taxonium-component@2.1.24`** (string interna instalada `v2.1.24`). Adaptador `native-source-data-browser-1.1.0`.

- Tarball: `https://registry.npmjs.org/taxonium-component/-/taxonium-component-2.1.24.tgz`.
- Integridade npm: `sha512-c2OZKbW4MekZmPhpdHzIHFrKXzBit+Zk+88hZbRENMG0w+DF61K8LcTLuLE+Sw1Tf+o2KCaecqAwlrM9MOWeDA==`.
- SHA-256 package-lock: `c304f45f7839202515a16cabefb802a02a6b6311978288724b7108239c02d7c9`.
- React/react-dom 19.2.7; Vite 6.3.5; runtime deck.gl 9.1.14/luma.gl 9.1.9.

Os dois locks foram comparados byte a byte com os ficheiros no commit histórico `e3aa8ab…`: são iguais. Não foi registado um Git SHA upstream destas duas bibliotecas; os identificadores verificáveis são a versão npm e o SRI do artefacto. O SHA do harness não é o SHA upstream da biblioteca.

**MSAGLJS: commit `db1ecbba39f46ca83aa90a87bad2012757e51f42`.** SHA-256 yarn.lock `ac84ae8de6bcbbf407a8a85592c8f1bcfa1758f7f24c3a0d33428db72b71b06e`. Caminho nativo `MdsLayoutSettings + layoutGraphWithMds + Sleeve + TileMap.buildUpToLevel`. Não apresentar como execução de IPSep-CoLa descrito no artigo: o código público fixado usa MDS.

**PhyloLens externo:** npm/serviço 0.2.0, release `cbb78f5e74b37e4fb480c0416e614e27e6f67ed9`, OCI index `sha256:3031f36bbf661d03a9c8843279ab8342f7931770d1c631ca88e3127670d14525`.

**PhyloLens RQ1:** 0.2.2, release `81e95c5d0b895426e46e02947076e64a40e2b910`, OCI index `sha256:e32c644ed70a5ee83f30797b7f2d5cc188d543495478fb6732123b1c9cd9dfe3`, manifesto linux/arm64 `sha256:f43e3af3d1948c6689f4919367921b2c955104c759644c5624b5b6b8b1423ce7`.

## Protocolo completo e fronteiras

### Comparação visual Phylotree.js / Taxonium / PhyloLens

1. Série Newick Salmonella cgMLST Full-MST aninhada, rótulos internos retidos, 12 500, 25 000, 37 500, 50 000, 62 500, 75 000, 87 500, 100 000, 150 000 e 200 000 **nós**. Ficheiros exatos verificados por SHA-256 e cardinalidades; não árvores sintéticas com estes números de folhas.
2. Ordem determinística, tamanho crescente; por tamanho, ordem declarada PhyloLens, Phylotree.js, Taxonium. Por célula, um warmup seguido de três observações medidas. Sem randomização, sem retries ocultos. A substituição PhyloLens 0.2.0 foi uma campanha posterior isolada.
3. Cada observação cria Vite local, processo Chromium, contexto e página novos. PhyloLens cria adicionalmente um contentor OCI e estado preparado novos; startup/health fora da janela. Nenhuma reutilização de árvore preparada entre observações. Browser/context novos não provam cache de filesystem/OS frio; não alegar cold-cache de disco.
4. Browser real registado nas observações: Chromium **149.0.7827.55**, headed com aceleração hardware, Playwright 1.61.1, sem flags Chromium personalizadas. Viewport 1440×900 CSS, device scale factor 1, locale en-US, timezone UTC; pedidos externos bloqueados.
5. Newick é lido, verificado e transferido para a página antes de t0. Logo, o “end-to-end” observado começa no consumo público da string já disponível, e exclui download/upload para a página e startup. Clock `performance.now()` do browser.
6. Phylotree/Taxonium: deadline visual 120 s passado explicitamente pelo harness (`benchmark/browser_adapters.py`; o default 90 s dos drivers não é o valor efetivo), watchdog pai 165 s, incluindo startup/cleanup. PhyloLens 0.2.0: prepare→ready 360 s + janela visual após ready 120 s; watchdog pai 585 s (105 s headroom). Esses limites diferem e devem constar na comparação de escalabilidade.
7. Warmups são retidos raw e excluídos das estatísticas. Mediana/P25/P75 dos sucessos medidos, com número de sucessos, falhas e timeouts em separado. Dois tamanhos consecutivos com todas as três medidas falhadas suspendem tamanhos maiores dessa ferramenta; skips não são timeouts nem sucessos.
8. Screenshot, diagnóstico final e cleanup ocorrem após t_visual. As duas oportunidades rAF adicionais em Phylotree/PhyloLens ocorrem **depois** do timestamp, apesar de descrições genéricas poderem sugerir que pertencem à métrica.
9. Latência de execução, topologia e identidade são dimensões distintas. Phylotree regista topologia VERIFIED por auditoria de cardinalidades da hierarquia, mas identidade FAILED pela substituição do rótulo da raiz; esse witness não constitui sozinho prova de igualdade de todas as arestas. Taxonium não expõe enumeração pública estável e regista topologia/identidade UNVERIFIED. PhyloLens dispõe de auditoria adicional do serviço: a 200k regista topologia VERIFIED pelas contagens prepare (200 000/199 999) e identidade UNVERIFIED porque o viewport inicial não enumera todos os IDs. Também aqui as contagens não provam sozinhas igualdade de todas as arestas. Sucesso visual não implica por si só fidelidade.

### Definição operacional de first meaningful visualization

- **Phylotree.js:** t0 imediatamente antes de `new phylotree(newick)`; render radial SVG (`radial(true).update()`), font-size 12, zoom=false, largura/altura mínimas 800/600. t_visual é a primeira verificação rAF após o trigger que encontra SVG com dimensões positivas, pelo menos uma marca path/line/circle/text e assinatura `(width,height,marks)` diferente do baseline. As auditorias síncronas de cardinalidades/rótulos estão dentro da janela, antes de permitir o próximo rAF. Não há critério de estabilidade, legibilidade de todos os rótulos ou duração de interação.
- **Taxonium:** t0 imediatamente antes de `setSourceData({status:'loaded', filetype:'nwk', data:newick,…})`. Worker/parser e consulta inicial nativos. O detector tem de observar o overlay vazio do Deck e a sua remoção; t_visual é o rAF seguinte à remoção. No mesmo callback, **depois do timestamp**, começa validação `createImageBitmap` do maior canvas visível; snapshot 64×48, diferença material ≥32 face ao fundo dominante, ≥12 pixels distintos do fundo, ≥3 bins da grelha 8×6, extensão nos dois eixos. Falha na validação invalida o resultado. Não é um evento de idle ou carregamento de todos os tiles; validação e screenshot posteriores não entram no tempo.
- **PhyloLens:** t0 antes de `view.load` público da string Newick; inclui preparação no servidor, polling, primeira query e render. t_visual exige ready e a primeira mudança pós-trigger nas camadas canvas visíveis em ordem DOM, dimensões positivas e pixels legíveis não uniformes (amostra 16×16 por camada); screenshot composto dá evidência posterior. Não exige fim da animação da câmera nem render de 200k objetos. A 200k o viewport inicial tem 800 representações/799 arestas, max_nodes solicitado 6000, sem truncation.
- **MSAGLJS:** **não foi medido first meaningful visualization**. O fim é o retorno de `TileMap.buildUpToLevel`. Há layout e tiles preparados, mas não chamada ao renderer, frame validado ou screenshot do grafo. Deve ficar numa comparação de preparação, separado da tabela de primeira visualização. Não renomear tile-ready para visual-ready.

### Protocolo MSAGLJS Full-MST

Oito tamanhos, 12 500…100 000 em incrementos de 12 500, um warmup + cinco medidas cada, sem retry, processo Node/Chromium/contexto/página novos. Chromium **140.0.7339.16** headed (difere do 149 da comparação visual). Não há viewport explícito registado para alegar equivalência a 1440×900. GPU capturado: ANGLE Metal Apple M4 Pro. Watchdog externo 300 s para o grupo Node e descendentes, SIGKILL em timeout; inclui overhead de startup, embora startup esteja fora de `total_ms`.

Antes das observações o Python converte Newick para lista de arestas UTF-8 determinística, retendo SHA de entrada/adaptação e witnesses de contagens. Esse tempo de conversão não foi medido. Node lê a lista e transmite a string ao browser antes de t0. No browser, t0 precede split da lista e construção `Graph/Node/Edge`; segue geometria (retângulos arredondados 30×20, raio 3), MDS com routing Sleeve e TileMap. Tile capacity 500, upper bound 30 níveis, orçamento nativo 4 GiB; paragem real nativa por tamanho/capacidade ou descarte de nível parcial por memória. Não é prova de que foram construídos 30 níveis. Routing/CDT são subconjuntos de layout_ms e não devem ser somados novamente.

## Os ~60 s adicionais de PhyloLens a 200k

Entrada idêntica em ambas as campanhas: SHA-256 `eb3dbb2c66597cb311bc65fc5871d696753f92a90e6f275d29273b17e2b54e4d`.

| Observação externa | load→ready (s) | ready→visual (s) | load→visual (s) |
|---|---:|---:|---:|
| medida 0 | 244.1617 | 0.3625 | 244.5242 |
| medida 1 | 245.9186 | 0.3524 | 246.2710 |
| medida 2 | 244.5331 | 0.2387 | 244.7718 |

RQ1 v0.2.2, prepare→ready: 184.496804833, 189.675337750, 190.447157542, 183.386905917, 181.207770083 s. Mediana **184.4968 s**; mediana externa v0.2.0 **244.7718 s**; diferença **60.2750 s**. A mediana externa de preparação é 244.5331 s. Na observação mediana de total, só 0.2387 s ocorre após ready. Medianas de fases não são necessariamente aditivas.

Nos logs externos, a primeira leitura de viewport custa 237.3, 147.3 e 87.4 ms; serialização ~2 ms. O cliente v0.2.0 faz polling nominal de 1000 ms (mais RTT), RQ1 de 100 ms. A granularidade de polling e os <0.4 s posteriores não explicam uma diferença de ~60 s. Não atribuir essa diferença a SVG/WebGL, transferência do viewport ou layout exclusivo sem medições.

**Localização medida:** a diferença ocorre essencialmente antes de ready, na janela que inclui preparação. **Causa não medida:** versões de produto diferentes (0.2.0/0.2.2), versões OS diferentes (Darwin 25.5.0/27.0.0), três/cinco repetições e campanhas em momentos diferentes. Logs históricos não separam parsing, sfdp, clustering e persistência por tempo/CPU. O sfdp de 110 s citado na configuração foi um diagnóstico anterior usado para definir timeout; não é uma fase cronometrada destas três observações finais.

Uma explicação causal requer pares com mesmo release/OCI/entrada/ambiente e spans wall+CPU de parsing/normalização, Graphviz, hierarquia, persistência, queue/poll e viewport→frame. Os resultados existentes permitem a localização acima, não uma atribuição causal mais fina. Nenhuma campanha foi repetida nesta auditoria.

## Graphviz, servidor e utilização de cores

RQ1 regista diretamente `sfdp - graphviz version 12.2.1 (20241206.2353)`, capability smoke GTS=true, processo sfdp observado no process tree. O Dockerfile do release externo 0.2.0 também fixa **Graphviz 12.2.1**, source SHA-256 `242bc18942eebda6db4039f108f387ec97856fc91ba47f21e89341c34b554df8`, GTS 0.7.6; isto é proveniência de build, não uma captura `sfdp -V` nas três observações externas.

Ambiente externo: Mac arm64, 12 CPUs lógicos, 24 GiB RAM, macOS 26.5.2/Darwin 25.5.0, Node 24.12.0, Python 3.12.2 para a campanha original e 3.13.5 para a substituição PhyloLens. O diagnóstico GPU identifica Apple M4 Pro; o campo CPU do environment só diz 'arm'.

RQ1: host arm64/Darwin 27.0.0, 12 CPUs lógicos/24 GiB; servidor linux/arm64 em Docker Desktop 4.41.2 (191736), Engine 28.1.1, kernel 6.10.14-linuxkit, Java 21.0.12+8. Container CpuQuota=0, CpuPeriod=0, NanoCpus=0, CpusetCpus vazio e Memory=0: sem limite/pinning explícito por contentor. Isso não especifica a alocação de CPU/RAM à VM Docker.

**CPU/core usage real não foi recolhido.** O sidecar regista RSS por processo e presença de sfdp, não user/system CPU time, CPU %, threads em execução ou cores ativos. Não confundir 12 CPUs disponíveis no host com 12 cores utilizados, nem `make -j` do build com paralelismo em runtime. Para reportar utilização real faltam amostras/spans de CPU por processo e limites/CPUs efetivos da VM/cgroup. Medir agora a máquina não recuperaria esses valores históricos.

## Os 50.03 s do MSAGLJS e as duas métricas

`parse_ms` mede split da **lista de arestas já adaptada** e criação de Node/Edge/Graph. Não é parsing Newick nem apenas processamento de texto; inclui construção nativa. A conversão Newick→lista em Python e o I/O/transfer para o browser estão fora de `total_ms`.

Há evidência estática para custo quadrático na construção: no commit fixado, `Graph.addNode()` chama `Assert.assert(this.findNodeRecursive(n.id) == null)`; para um ID novo, `findNodeRecursive` falha no Map e itera sobre todos os `shallowNodes` em busca de subgrafos. Mesmo num grafo plano, percorre os nós anteriores por inserção: total Θ(n²) de visitas. O adaptador usa a API nativa addNode uma vez por nó. As medianas de input construction (1.0534 s a 12.5k, 4.2002 s a 25k, 16.4543 s a 50k, 50.0257 s a 87.5k) são consistentes com esse crescimento. Não foi feito perfil para quantificar a percentagem dos 50.0257 s nessa função; não atribuir todo o tempo medido a ela.

Proposta de apresentação que conserva o custo e esclarece o mecanismo:

1. **Adapted-input-to-tile-ready, incluindo input decoding e native graph construction:** `total_ms` histórico.
2. **Processing excluding input decoding/native graph construction:** `total_ms - parse_ms`, calculado **por observação**, seguido de mediana/P25/P75. Inclui geometria, layout/routing, tiling e overhead residual; não é apenas 'layout'.
3. **True Newick-to-first-visual end-to-end:** indisponível nesta campanha. Exigiria medir também a adaptação e o renderer/frame. Não chamar à coluna 1 end-to-end desde Newick; não adicionar tempos de adaptação medidos noutra execução aos históricos.

| Nós | Adapted-input→tile-ready (s), mediana | Input decoding/construction (s), mediana | Processing excluding input construction (s), mediana |
|---:|---:|---:|---:|
| 12500 | 6.9312 | 1.0534 | 5.8778 |
| 25000 | 22.3403 | 4.2002 | 18.1208 |
| 37500 | 47.1318 | 9.2270 | 37.9151 |
| 50000 | 104.5903 | 16.4543 | 88.1360 |
| 62500 | 151.7630 | 25.9157 | 125.4279 |
| 75000 | 206.1526 | 37.0394 | 168.7040 |
| 87500 | 266.1308 | 50.0257 | 216.4539 |
| 100000 | timeout ×5 (300 s watchdog) | — | — |

A 87.5k: **266.1308 s** total, **50.0257 s** input construction, **216.4539 s** processing excluindo essa fase. `median(total)-median(parse)` daria 216.1051 s, incorreto como mediana emparelhada. As medianas separadas de layout (195.6515 s), geometria (0.1010 s) e tiling (20.6460 s) também não precisam somar a mediana total.

A 100k, cinco medidas terminaram no watchdog de 300 s, sem timestamps finais completos. Não é possível calcular tempo ajustado, nem converter esses timeouts automaticamente em sucessos por remover parse. O CSV conserva estado, exclusão das estatísticas e campos vazios.

Recomendação para a tese: manter duas colunas explicitamente delimitadas para MSAGLJS e a comparação de tile-ready separada de first visual. Conservar total histórico; explicar construção quadrática como análise do código corroborada pela curva, sem alegar perfil causal. Para a diferença PhyloLens/RQ1, usar a decomposição medida e declarar o confundimento por versão. Não afirmar utilização multicore nem causa exata para os ~60 s onde a instrumentação histórica não a mediu.
