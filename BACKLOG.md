# Backlog — SVG Grid Generator

Controle de alterações e ideias futuras. Itens marcados `[ ]` estão pendentes,
`[x]` concluídos. Ver também o status das fases em [README.md](README.md).

> Convenção: cada item tem uma nota curta com a intenção e, quando útil, onde
> mexer no código. Prioridade sugerida: 🔴 alta · 🟡 média · ⚪ baixa.

---

## 1. Interface (UI/UX)

- [~] 🟡 **Revisão do layout da interface** — _grande parte feita._
  Feito: tema **creme + accent dourado** (igual grid.leit.in), **fundo de pontos**,
  **UI flutuante** (modos topo, toolbox por modo, context menus, status + zoom nos
  cantos), **glass/blur** nas caixas, widgets estilo GG2, e **tema claro/escuro**
  (toggle no canto sup. direito, GG2, persistido em localStorage).
  Falta: responsividade fina e refino visual.
  - Arquivos: [index.html](index.html), [src/ui/shell.ts](src/ui/shell.ts), [src/ui/](src/ui/), [src/ui/styles/app.css](src/ui/styles/app.css)
- [x] 🔴 **Agrupar as funções por tipo** — feito via os 4 modos + context menus
  compartilhados (Shapes/Colors). Refinamentos futuros: subgrupos dentro dos modos.
- [x] 🟡 **Blur nos menus** — feito: `--glass` translúcido + `backdrop-filter:
  blur(16px) saturate(1.4)` em `.float` (modos, toolbox, context, pílulas) e no
  `.dd-menu`. Borda branca sutil pra reforçar o vidro.
- [x] 🟡 **Todos os combobox iguais ao "Size cell"** — feito: componente `createDropdown`
  reutilizável (pílula + menu flutuante portado pro body), usado no Size, Aspect, Res,
  FPS e nos selects da Animation. Sliders e toggles também no estilo GG2.
- [x] ⚪ **Status (cell/placed) sem caixa** — _feito._
- [~] 🟡 **Transições suaves** — _grande parte feita._ Ao trocar de modo / menu, o
  **toolbox** e o **menu de contexto** fazem fade-out do conteúdo → **morph animado
  do tamanho** (largura/altura) → fade-in do novo conteúdo (util `morphResize`). Abrir
  o contexto a partir do fechado faz um **pop-in** (fade + translateY). Falta: animar o
  **fechar** do contexto (hoje é instantâneo, por causa do `display:none`).
  - Arquivos: [src/ui/morph.ts](src/ui/morph.ts), [src/ui/shell.ts](src/ui/shell.ts) (`applyContext` + `sync`), [src/ui/styles/app.css](src/ui/styles/app.css).
- [x] 🟡 **Micro-interações de hover** — _feito._ Transição suave de cor/sombra no
  **hover** e um leve **press** (scale) ao clicar, consistentes em todos os controles
  (modos, tool-btns, segments, swatches, dropdowns, theme toggle). Bônus: as células
  com **cell background** deslizam ao trocar **gutter** ou **rounded** (transição CSS
  nas geometrias do rect, ativada só na troca via classe `.animating`).
  - Arquivos: [src/ui/styles/app.css](src/ui/styles/app.css), [src/render/renderer.ts](src/render/renderer.ts) (`glideCellShape`).
- [ ] 🟡 **Cursor por estado/ferramenta** — o ponteiro do mouse muda conforme o modo
  e a função ativa (ex.: crosshair no Draw, borracha no Erase, grab/grabbing no Pan,
  cursor de caminho no Order, move/resize no frame, brush quando houver brush size).
  - Hoje o `#stage` é sempre `crosshair`. Aplicar via classe no stage conforme `tool`/`mode`.
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts) (classe no stage), [src/ui/styles/app.css](src/ui/styles/app.css).
- [ ] 🟡 **Ícone de Help no topo** — botão de ajuda ao lado do **mute** (canto sup. direito)
  que abre um painel/overlay explicando as **features** do projeto e listando os **atalhos**
  de teclado. Liga com o item de atalhos abaixo.
  - Arquivos prováveis: [src/ui/shell.ts](src/ui/shell.ts) (barra de topo), [src/ui/styles/app.css](src/ui/styles/app.css).
- [ ] 🟡 **Atalhos de teclado + como mostrá-los na interface** — consolidar os atalhos
  existentes (B/E/P, ⌘Z/⌘⇧Z, Space = pan, …) num só lugar e **expô-los na UI**: no painel de
  Help e/ou como dica (tooltip/legenda) nos próprios botões. Definir novos atalhos úteis
  (trocar de modo, toggles do Grid, Apply, etc.).
  - Arquivos prováveis: [src/tools/tools.ts](src/tools/tools.ts) (handlers de teclado), [src/ui/shell.ts](src/ui/shell.ts), [src/ui/](src/ui/).

## 2. Grid

- [~] 🟡 **Layout do grid** — _parcial._ Feito: **gutter** (espaçamento entre células,
  toggle 4px), **cantos arredondados** (rounded cells), **mostrar/ocultar** o grid de
  pontos e **Show blockers** (liga/desliga o overlay das zonas bloqueadas) — no menu
  **Grid**, agora um botão **global** na caixa de settings (junto de Size / Clear).
  Também um slider **Cell fill** (40–100%) que controla a fração da célula que cada SVG
  ocupa: multiplicador global de render (`cellFill / FILL_SCALE`) aplicado em `instanceGeom`,
  então reescala **todas** as instâncias ao vivo (100% = encosta na borda, sem espaço).
  Falta: grid retangular (largura ≠ altura de célula), offset de origem do grid,
  opacidade das linhas.
  - Arquivos: [src/scene/geom.ts](src/scene/geom.ts) (`cellBgRect`/`instanceGeom`), [src/render/renderer.ts](src/render/renderer.ts), [src/ui/gridPanel.ts](src/ui/gridPanel.ts), [src/scene/types.ts](src/scene/types.ts), [src/export/svgExport.ts](src/export/svgExport.ts)
- [x] 🟡 **Hover no grid** — feito: highlight da célula sob o cursor (contorno +
  leve fill; vermelho no Erase) + **ghost** esmaecido do asset do pincel na cor ativa.
  - Arquivos: [src/render/renderer.ts](src/render/renderer.ts) (`setHover`/`renderHover`), [src/tools/tools.ts](src/tools/tools.ts).

## 2b. Escala multi-célula — Divider

- [x] 🔴 **SVG ocupando vários quadrantes (Divider)** — _feito (v1)._ Botão **Divider**
  no Compose subdivide a tela em **quadrados** de tamanhos variados (packing guiado por
  noise; slider "Divisions" = densidade + Reseed), com **overlay ao vivo** das linhas e
  **Apply to view** que preenche cada bloco com um SVG escalado. Instâncias ganharam
  span `cw`/`ch`; o render itera por instância e culla pelo bloco. A limpeza do Apply é
  por **interseção** (apaga qualquer instância que cubra a região, inclusive blocos
  multi-célula ancorados fora dela). Além do Apply, há um **brush por bloco**: com o
  Divider aberto, o hover gruda no bloco sob o cursor e clicar preenche aquele bloco com
  um SVG ocupando-o inteiro (geometria centralizada em `divider.ts` — preview/apply/brush
  sempre concordam).
  - Arquivos: [src/features/divider.ts](src/features/divider.ts), [src/ui/dividerPanel.ts](src/ui/dividerPanel.ts), [src/scene/geom.ts](src/scene/geom.ts), [src/render/renderer.ts](src/render/renderer.ts), [src/tools/tools.ts](src/tools/tools.ts), [src/features/placement.ts](src/features/placement.ts).
  - Refino futuro: blocos retangulares opcionais, esticar SVG no bloco, preencher com
    cor (Mondrian), e ancorar a subdivisão a uma região fixa.
- [x] ⚪ **Divider ciente das zonas bloqueadas** — _feito._ O `subdivide` recebe `state.blocked`
  e **pré-marca as células bloqueadas como cobertas**, então o packing de quadrados flui **em
  volta** delas — nenhum bloco inclui célula bloqueada (preview/apply/brush concordam, pois
  todos vêm de `dividerBlocks`). Verificado: ao aplicar com uma zona bloqueada, 0 SVGs caem
  dentro dela.
  - Arquivos: [src/features/divider.ts](src/features/divider.ts) (`subdivide`/`dividerBlocks`).
- [x] 🟡 **Bug Seamless + multi-célula** — _feito._ A `tileFill` virou block-aware: só
  replica blocos que cabem **inteiros** no tile (cópias espaçadas 1 tile, sem overlap);
  blocos que cruzam a borda são descartados (um retângulo único não tem como dar a volta
  no toro). Eliminou as sobreposições.
  - Arquivos: [src/features/placement.ts](src/features/placement.ts) (`tileFill`).

## 3. Ferramentas de desenho

- [~] 🔴 **Controles finos de desenhar e apagar** — _parcial._
  Feito: **Brush** 1–4 (footprint NxN, centrado no cursor) + **Size** 1–6 (span: cada SVG
  ocupa N×N células). Brush e Size combinam: Brush = quantos blocos, Size = tamanho de
  cada (espaçados pelo Size, sem sobrepor). Placement **limpa o que cobre** (sem overlaps)
  e o arrasto estampa blocos; **Erase** remove qualquer SVG que cubra a célula (ciente de
  multi-célula); preview/ghost no tamanho do bloco. Respeita zonas bloqueadas.
  O seletor de **formato** (círculo/cruz) está oculto por enquanto — footprint fixo em
  **quadrado**.
  Falta: densidade do traço, modo "só preencher vazias" vs "sobrescrever", apagar por
  filtro (por asset / por cor).
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts), [src/scene/grid.ts](src/scene/grid.ts) (`brushCells`/`brushBlocks`), [src/ui/brushPanel.ts](src/ui/brushPanel.ts), [src/render/renderer.ts](src/render/renderer.ts)
- [~] 🟡 **Modo Path / Line (desenhar linhas a preencher)** — _v1 feito (mão livre, draw-then-fill)._
  Ferramenta **Line** no Draw, no estilo do **draw path do Animate**: arrasta à mão livre e vê
  o **traço** (polilinha tracejada, preview); **ao soltar** o caminho vira **glyphs** nas células
  que ele cruza, com os **shapes** + **cell background** atuais. **Brush** = espessura (footprint
  circular ao longo do caminho) e **Size** = span de cada glyph (N×N, tiles ao longo da linha);
  rasterização interpolada (segue a curva sem buracos), **um passo de undo** (`PlaceInstances`).
  Futuro: traçado por **pontos** (polilinha reta), **fechar/preencher área**, espessura própria
  (hoje compartilha o Brush), e editar/suavizar o caminho antes de baixar.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts) (`liningPath`/`commitLine`), [src/scene/types.ts](src/scene/types.ts) (`ToolId` `"line"`), [src/ui/shell.ts](src/ui/shell.ts) (botão + footer), [src/render/renderer.ts](src/render/renderer.ts) (`setLinePreview` + hover), [src/ui/styles/app.css](src/ui/styles/app.css) (`.line-preview`).
- [~] 🟡 **Brush/Size como rodapé compartilhado do context** — _parcial._ A barra
  **Brush / Size / Cell background** virou um **rodapé dentro da caixa do context**,
  aparecendo nos geradores (Noise/Divider/Seamless/Block/Edit) e no Draw/Erase, e some em
  Shapes/Colors. Só o corpo do menu muda ao trocar de context; o rodapé persiste. Caixas
  menores ajustam à largura do rodapé (`fit`) pra não encavalar.
  Falta: **Brush/Size controlarem a ferramenta ativa** (ex.: no Edit, aplicar-se ao
  Rotate/Swap/Recolor) e **mostrar só os controles relevantes por context** (ex.: esconder
  Size/Cell no Block, que é por célula).
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts) (`brushVisible`/`applyContext`), [src/ui/brushPanel.ts](src/ui/brushPanel.ts), [src/ui/styles/app.css](src/ui/styles/app.css) (`#ctx-brush`).
- [x] 🔴 **Modo Stencil (multi-fonte)** — _feito._ Botão **Stencil** no Draw: a zona acesa
  (silhueta **verde** arredondada + pontilhada, estilo Block) é a abertura; o **pincel** só
  pinta dentro dela e o **Apply to view** limpa a região e repinta só a abertura. Sistema de
  **fontes plugáveis** (`stencilLit` → `litFn` por célula), com seletor:
  - **Noise** (fBm), **Stripes** (zebra diagonal: ângulo/período/lit%), **Image** (upload
    lido em B/W, threshold/invert, drag-drop + preview), **Text** (string rasterizada B/W:
    texto/size/bold). Image/Text são posicionados com `fitBox`/`textBox` na view.
  - **Lock projection**: amostra relativo à origem da view (o stencil fica preso à tela ao
    panear, em vez de fixo ao canvas).
  - **Add mode** (rótulo na barra de título): Apply **aditivo** (só preenche vazias da
    abertura, mantém o resto) vs replace (limpa + repinta).
  - Trocar de fonte **anima** o corpo do menu (morph do `#ctx-body`).
  - Arquivos: [src/features/stencil.ts](src/features/stencil.ts), [src/features/stencilImage.ts](src/features/stencilImage.ts), [src/features/stencilText.ts](src/features/stencilText.ts), [src/features/placement.ts](src/features/placement.ts) (`applyMask`), [src/render/renderer.ts](src/render/renderer.ts) (`.stencil-shape`), [src/tools/tools.ts](src/tools/tools.ts), [src/ui/controls.ts](src/ui/controls.ts).
  - Futuro: inverter a máscara global; ancorar image/text mais acima (hoje centraliza, fica
    atrás do painel); mais formas geométricas como fonte.
- [x] 🟡 **Modo Block (zona bloqueada)** — _feito._ Ferramenta **Block** (entre Erase
  e Noise) marca células onde **não se pode colocar SVG**: o draw pula essas células e
  o noise (`applyMask`) também. Menu de contexto com segmented **Drag** (retângulo
  clicar-arrastar) e **Brush** (pintar com o footprint atual). Bloquear agora **preserva e
  protege** o que já está na célula: o SVG existente fica, e **Draw / Erase / Edit pulam
  células bloqueadas** (imutável até des-bloquear no modo Clean). Overlay **avermelhado +
  borda vermelha dashed**; hover do brush em vermelho. Tudo undoable (`blocked` no estado).
  - Arquivos: [src/scene/types.ts](src/scene/types.ts), [src/tools/tools.ts](src/tools/tools.ts), [src/commands/sceneCommands.ts](src/commands/sceneCommands.ts) (`BlockCells`),
    [src/features/placement.ts](src/features/placement.ts), [src/render/renderer.ts](src/render/renderer.ts), [src/ui/blockPanel.ts](src/ui/blockPanel.ts), [src/ui/shell.ts](src/ui/shell.ts).
  - Refinamento futuro: des-bloquear (apagar zona), e respeitar bloqueio na escala multi-célula.
- [x] ⚪ **Rotação randômica de 90°** — _feito._ Cada SVG colocado recebe uma rotação
  aleatória entre 0/90/180/270°.
- [x] 🟡 **Modo Edit (Compose)** — _feito._ Botão **Edit** no Compose abre um menu
  (ops + Brush à esquerda, Recolor à direita, com divisor) e edita os itens existentes
  como um pincel: **Rotate** (gira 90° por clique), **Swap** (troca o ícone pelos shapes
  selecionados), **Recolor → Gliph/Cell/Both** (recolore o ícone, o cell-bg, ou os dois
  juntos, com a cor ativa, aleatória via dado, ou **None** — swatch branco com barra
  diagonal vermelha que torna o gliph transparente / remove o fundo da célula). Slider
  **Brush** define o footprint; ciente de multi-célula (hover adapta ao tamanho do gliph);
  undoable. Caixa do Edit com largura fixa maior: os swatches do Recolor quebram em linhas
  conforme a paleta cresce, e Rotate/Swap dividem a largura da coluna.
  - Arquivos: [src/ui/editPanel.ts](src/ui/editPanel.ts), [src/tools/tools.ts](src/tools/tools.ts) (`paintEdit`/`editInstance`), [src/render/renderer.ts](src/render/renderer.ts) (hover), [src/features/palette.ts](src/features/palette.ts) (`colorAt` none), [src/scene/types.ts](src/scene/types.ts), [src/ui/shell.ts](src/ui/shell.ts), [src/ui/styles/app.css](src/ui/styles/app.css).

## 3b. Compose / Noise

- [x] 🟡 **Seamless (Compose)** — _feito, bem além do checkbox._
  Noise **tileable** (fBM com blend bilinear dos 4 cantos do toro → máscara repete sem
  emenda). Botão **Seamless** abre um menu de contexto com um **tile frame** ao vivo
  (borda tracejada, sem letterbox): o conteúdo de dentro é repetido em ghosts nos 8
  vizinhos (clipado ao tile) e as células na **emenda** ganham anel ciano. Frame
  arrastável/redimensionável (snap à célula), interior pintável. **Apply to view**
  assa o pattern como instâncias reais; **Apply + Crop** assa e pula pro Export com o
  crop travado no tile.
  - Arquivos: [src/features/noise.ts](src/features/noise.ts) (tileable), [src/ui/seamlessPanel.ts](src/ui/seamlessPanel.ts),
    [src/ui/tileFrameController.ts](src/ui/tileFrameController.ts), [src/render/renderer.ts](src/render/renderer.ts) (preview+emenda), [src/features/placement.ts](src/features/placement.ts) (`tileFill`).
  - Refinamento futuro: unificar o **período do noise** com o tamanho do tile frame.

## 4. Animação

> **Leva 1 concluída (Phase 5 + overhaul):** ciclo de vida enter→hold→exit
> (fade/scale/pop/rotate), ordem de revelação (linear/radial/sequencial/random),
> playback (loop/ping-pong/once), spread/durações e idle (spin/pulse/bob/sway/orbit).
> Arquivos: [src/anim/animations.ts](src/anim/animations.ts), [src/anim/order.ts](src/anim/order.ts), [src/ui/animPanel.ts](src/ui/animPanel.ts)

- [x] 🔴 **Ferramenta de desenhar a ordem (START → FINISH)** — _Leva 2 concluída._
  Ferramenta **🧭 Order** (tecla P): desenha um caminho na tela; os SVGs aparecem
  na ordem ao longo dele (projeção por comprimento de arco → `o` da instância).
  Linha tracejada com rótulos **START**/**FINISH**; desenhar troca a ordem p/ `free`.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts), [src/anim/order.ts](src/anim/order.ts), [src/render/renderer.ts](src/render/renderer.ts)
  - Refinamentos futuros: editar/limpar caminho, snap, suavização, e decidir o que
    fazer com células muito longe da linha (hoje pegam a projeção mais próxima).
- [x] 🟡 **Manter o Play visível ao trocar de modo durante a reprodução** — _feito._ Com
  uma animação tocando, ao sair do modo Animate aparece um botão **Pause** na caixa de
  settings (à esquerda do Grid) para parar a reprodução de qualquer modo; some quando
  pausa ou ao voltar ao Animate (que já tem o Play no toolbox).
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts) (`buildSettings`/`sync`).
- [x] 🟡 **Ligar o Order sincroniza o combobox de Order** — _feito._ Clicar no botão
  **Order** arma a ferramenta de caminho **e** seta a ordem para `free` ("draw path"),
  mantendo o combobox em sincronia (o caminho desenhado também já fixava `free`).
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts) (botão Order), [src/ui/animPanel.ts](src/ui/animPanel.ts).
- [ ] 🟡 **Estilo "draw" / wipe (desenho)** — enter/exit por traço (stroke-dashoffset)
  ou wipe/clip que "desenha" o SVG aparecendo. Hoje temos fade/scale/pop/rotate.
  - True line-draw é difícil com `<use>`/`<symbol>` (precisa de pathLength por path);
    avaliar clip-reveal como aproximação.
  - Arquivos: [src/anim/animations.ts](src/anim/animations.ts), [src/render/renderer.ts](src/render/renderer.ts)
- [ ] 🟡 **Gatilho / trigger** — "algo que se liga": disparar a animação por evento
  (hover, clique, ao entrar na viewport) além do Play global.
- [ ] ⚪ **Presets de animação salvos + combinar animações por instância.**
- [ ] 🟡 **Animar a máscara no tempo** — mover o offset do noise por `t` para uma
  máscara "viva" (revela/apaga células progressivamente).
  - Arquivos: [src/features/noise.ts](src/features/noise.ts), [src/ui/controls.ts](src/ui/controls.ts)

## 5. Cor

- [~] 🟡 **Cor de fundo + cor dos SVGs independentes** — _parcial._
  Feito: controle de **cor de fundo** do canvas (ao vivo) + **export transparente**
  (checkbox) no painel Export; **cor de fundo por célula** — quadrado colorido atrás
  do SVG, vindo da paleta, com opção **Random** (sorteia por célula, igual à cor do SVG)
  ou cor fixa; respeita rounded/gutter e vai junto no export.
  Falta: modos de cor dos SVGs (sempre da paleta / sempre cor fixa) independentes do fundo.
  - Arquivos: [src/ui/colorsPanel.ts](src/ui/colorsPanel.ts), [src/ui/brushPanel.ts](src/ui/brushPanel.ts), [src/features/placement.ts](src/features/placement.ts), [src/render/renderer.ts](src/render/renderer.ts), [src/export/svgExport.ts](src/export/svgExport.ts)
- [ ] 🟡 **Menu de apoio para o Cell fill** — um menu dedicado para o preenchimento de
  fundo da célula (cell background): escolher None / Random / cor fixa, e futuros
  controles (opacidade, modo de cor) num lugar próprio em vez do checkbox no Brush.
  - Arquivos: [src/ui/brushPanel.ts](src/ui/brushPanel.ts), [src/ui/colorsPanel.ts](src/ui/colorsPanel.ts), [src/scene/types.ts](src/scene/types.ts).

## 6. Áudio

- [x] ⚪ **Adicionar som** — _feito._ Web Audio puro (osciladores + envelopes, sem lib,
  igual ao Grid-o-matic): nota afinada ao **colocar** SVG (pitch segue a célula), sweep no
  **apagar**, nota no **divider** e no **edit**, e chirp de 2 notas no **theme toggle**.
  Botão de **mute** ao lado do trocador de tema (preferência persistida). (Som generativo na
  animação e controle de volume foram dispensados.)
  - Arquivos: [src/features/audio.ts](src/features/audio.ts), [src/tools/tools.ts](src/tools/tools.ts), [src/ui/shell.ts](src/ui/shell.ts).

## 7. Pesquisa / Direção

- [ ] ⚪ **Estudar mais ferramentas** — pesquisar referências e libs (Maxon Noise,
  ferramentas de generative art, editores de SVG/animação) para inspirar novos
  controles e fluxos. Registrar achados aqui.

## 8. Enquadramento / Export

> **Phase 6a concluída:** frame em world-space com presets 16:9/1:1/9:16/4:5/4:3/free,
> resolução de saída, overlay letterbox + "Fit to view", e export **SVG** e **PNG**.
> Arquivos: [src/export/frame.ts](src/export/frame.ts), [src/export/svgExport.ts](src/export/svgExport.ts), [src/export/raster.ts](src/export/raster.ts), [src/ui/exportPanel.ts](src/ui/exportPanel.ts)

- [x] 🔴 **Controle de proporção (frame) para export** — presets + resolução +
  letterbox + Fit to view (overlay). SVG/PNG já respeitam o frame.
- [x] 🔴 **Export animado (Phase 6b)** — sequência **PNG** (.zip via JSZip) e **MP4**
  (WebCodecs H.264 + mp4-muxer), amostrando a animação pura por frame; controles de
  fps/duração + "loop length" + progresso.
  - Arquivos: [src/export/sequence.ts](src/export/sequence.ts), [src/export/video.ts](src/export/video.ts), [src/ui/exportPanel.ts](src/ui/exportPanel.ts)
  - Pendente: WebM/GIF, encode em worker (hoje no main thread), e cancelar export.
- [x] 🟡 **Frame reposicionável/escalável** — arrastar a borda (move) + handles
  (cantos = scale; laterais = esticar H/V no Free Form; aspectos fixos travam a
  proporção) + **snap to grid** (Free Form nunca corta célula). Free → "Free Form".
  - Pendente: snap exato em aspectos fixos (hoje mantém a proporção, podendo não
    alinhar à célula) e opção de "limitar o grid ao frame" (recorte) além do letterbox.
- [ ] 🟡 **Cor de fundo no export** — hoje o fundo é transparente (formas claras
  somem em fundo branco). Liga com o item 5 (cor de fundo).

## 9. Imagem / vídeo como fonte (halftone & dithering)

- [x] 🔴 **Dithering / halftone com os SVGs (Compose → Halftone)** — _feito (imagem + vídeo/GIF)._
  Botão **Halftone** no Compose: upload de imagem (drag-drop + preview), lida em
  luminância por célula, preenchida com os **shapes selecionados** + paleta. Modos:
  **Halftone** (área do shape ∝ tinta), **Bayer** (ordenado on/off) e difusão de erro
  **Floyd–Steinberg**, **Atkinson** e **Jarvis**. **Target** do preenchimento: **Gliph**
  (só o ícone), **Cell** (só o fundo da célula) ou **Both**. Toggles **Invert** e **Shape by
  luminance** (escolhe o shape do conjunto pelo brilho: claro→primeiro, escuro→último).
  Sliders **Contrast** / **Size**. **Picker de Shapes embutido** no próprio painel (mesma
  seleção do brush). **Preview ao vivo** (glyphs + cell-bg fantasma) e **Apply to view**.
  Ajusta à view, então **cell size = resolução**; pan/zoom re-resolvem. Instâncias ganharam
  `color` literal pra esconder o glyph no target Cell (transparente).
  - Arquivos: [src/features/halftone.ts](src/features/halftone.ts), [src/ui/halftonePanel.ts](src/ui/halftonePanel.ts), [src/render/renderer.ts](src/render/renderer.ts) (`renderHalftonePreview`), [src/scene/types.ts](src/scene/types.ts), [src/features/placement.ts](src/features/placement.ts) (`FILL_SCALE`), [src/export/svgExport.ts](src/export/svgExport.ts).
  - Futuro: cor da imagem por célula; ângulo de trama / CMYK; threshold ajustável.
- [x] 🔴 **Vídeo / GIF como fonte (animado + export)** — _feito (3 incrementos)._
  - [x] **Inc. 1 — fonte de frames.** O dropzone aceita **vídeo** (`<video>` + canvas, seek por
    frame) e **GIF animado** (`ImageDecoder`/WebCodecs; fallback p/ 1º frame). Um **scrubber
    "Frame"** (só aparece em fontes animadas) varre os frames e re-amostra ao vivo. Pixels do
    frame atual vão pro buffer de luminância reaproveitado; `imgVersion` invalida o cache do
    preview. Já entrega "escolher um frame".
    - Arquivos: [src/features/halftone.ts](src/features/halftone.ts) (`setHalftoneSource`/`setHalftoneFrame`), [src/ui/halftonePanel.ts](src/ui/halftonePanel.ts).
  - [x] **Inc. 2 — preview animado ao vivo.** Botão **play/pause** no scrubber: o halftone
    acompanha a fonte tocando. Vídeo **toca o `<video>`** e desenha o frame atual por rAF (sem
    seek); GIF avança por tempo. O scrubber vira playhead. Blur dos painéis cai durante o
    playback (`body.ht-playing`). Ainda usa o preview SVG — o preview em `<canvas>` segue como
    item de perf.
    - Arquivos: [src/features/halftone.ts](src/features/halftone.ts) (`halftonePlayVideo`/`sampleHalftoneCurrentFrame`/`halftonePlayhead`), [src/ui/halftonePanel.ts](src/ui/halftonePanel.ts) (`tickPlay`).
  - [x] **Inc. 3 — export animado.** Toggle **"Halftone source"** no painel Export (só com
    fonte animada): os exports **PNG-seq** e **MP4** recebem um `renderFrame` opcional que, por
    frame, seta a fonte no tempo `t`, roda `halftoneInstances` (mesmo **encaixe na view** do
    preview, então os glyphs/cores por célula — semeados por `col,row` — batem exatamente) e
    emite o SVG do frame; o frame só **recorta**. O export **reusa o box exato** do último
    preview/apply (`halftoneLastBox`) em vez de re-encaixar pela câmera no momento do export —
    então o grid (formas/cores/posição) é idêntico ao que se viu, mesmo se você der zoom/pan no
    modo Export. Marcar o toggle ajusta a duração pra 1 passe. **Dica:** use **Free Form + Fit
    to view** (frame = view) pro recorte casar; em aspecto fixo o frame recorta um sub-trecho.
    _Obs.: num vídeo, frames diferentes acendem células diferentes — comparar dois instantes
    distintos mostra padrões diferentes (não é bug)._
    - Arquivos: [src/export/sequence.ts](src/export/sequence.ts), [src/export/video.ts](src/export/video.ts) (`renderFrame`), [src/ui/exportPanel.ts](src/ui/exportPanel.ts) (`halftoneFrameRenderer`).
- [~] 🟡 **Integração Halftone ↔ Export ↔ Animate** — em fases:
  - [x] **Fase A — Send to Export + área de união.** Botão **"Send to Export →"** no painel
    Halftone: pula pro modo Export já com **Halftone source** ligado e o frame (Free Form)
    cropado na **união de todas as células que acendem em qualquer frame** (`halftoneCoverage`
    amostra ~20 frames), pra nenhum glyph ser cortado por um frame não visto. Marcar o toggle
    "Halftone source" no painel Export também encaixa nessa cobertura. O toggle virou estado
    (`exportHalftone`) pra os dois painéis dirigirem.
    - Arquivos: [src/features/halftone.ts](src/features/halftone.ts) (`halftoneCoverage`), [src/ui/halftonePanel.ts](src/ui/halftonePanel.ts) (`sendToExport`), [src/ui/exportPanel.ts](src/ui/exportPanel.ts) (`fitToCoverage`), [src/scene/types.ts](src/scene/types.ts).
  - [x] **Fase B — Play global toca o halftone.** O **Play** (global) avança a fonte animada
    pelo clock do `engine` a cada paint (`advanceHalftone` no renderer: vídeo amostra o próprio
    clock, GIF mapeia tempo→frame). O preview destravou: aparece na tela quando se está no painel
    Halftone **ou** quando há fonte animada **tocando** (qualquer modo). O Play do painel virou o
    Play global (unificado). Halftone animado tem **prioridade**: durante o play a revelação de
    cena fica estática (`animate = playing && !halftoneIsAnimated()`). Pausar esconde o preview
    fora do painel.
    - Arquivos: [src/features/halftone.ts](src/features/halftone.ts) (`advanceHalftone`), [src/render/renderer.ts](src/render/renderer.ts) (gate + advance + prioridade), [src/main.ts](src/main.ts) (play/pause do vídeo), [src/ui/halftonePanel.ts](src/ui/halftonePanel.ts) (Play global + uiTick).
  - [x] **Fase C — Order "Halftone".** Novo preset no menu **Order** que revela as células pela
    **luminância** da fonte no cell (escuro/tinta primeiro, varrendo pro claro). Mapeia o cell →
    uv via `halftoneLastBox` e amostra `sampleHalftoneLum`; sem fonte, cai pra ordem de
    colocação. Útil pra halftone de **imagem estática** (com vídeo, a Fase B toca a fonte e tem
    prioridade na revelação).
    - Arquivos: [src/anim/animations.ts](src/anim/animations.ts) (`OrderMode`/`ORDER_MODES`), [src/anim/order.ts](src/anim/order.ts).
- [ ] 🟡 **Overlay de preview da fonte** — mostrar a imagem/vídeo por baixo/por cima
  do grid (com opacidade) como referência enquanto distribui; toggle on/off. (O Halftone já
  tem o preview do **resultado**; isto seria o preview da **fonte** crua.)
  - Arquivos prováveis: [src/render/renderer.ts](src/render/renderer.ts), [src/ui/controls.ts](src/ui/controls.ts).

---

## Ideias soltas (parking lot)

- [ ] Salvar/carregar projetos (estado serializável → JSON / IndexedDB).
- [ ] Presets compartilháveis via URL (seed + parâmetros).
- [ ] Atalhos de teclado adicionais e painel de ajuda.

## Performance

> _Feito (rápidos + médios):_ blur dos painéis desligado durante play/pan/zoom
> (`--glass-solid` + `body.perf-noblur`); **cache** do preview do halftone (pula o
> recompute quando nada muda); **dirty-check** em `applyInstance`/`applyCellBg` (pula
> `setAttribute` quando o nó não mudou); **reuso do `Box`** em `instanceGeom`.

- [x] 🔴 **Desenho “falhado” com muitos SVGs** — _feito (3 frentes)._ A linha saía com
  **buracos**, principalmente em **movimento rápido do mouse** (eventos `pointermove`
  espaçados). Três fixes:
  - **Interpolação**: `paint` pinta ao longo da **linha** do ponto anterior ao atual
    (`paintAt` por passo de ~½ célula, `lastPaintW`) → flick rápido preenche contíguo.
  - **Clone-once**: o mapa de instâncias é clonado **uma vez no `pointerdown`**
    (`strokeInstances`) e mutado em lugar (antes `{ ...state.instances }` O(N) por ponto);
    `commitStroke` reconstrói o pré-traço com clone fresco → undo/redo intactos.
  - **Render incremental**: `renderInstances` **varre a área visível** (+ margem `MAX_BLOCK_SPAN`
    pra blocos multi-célula ancorados fora da tela) em vez de iterar **todas** as instâncias,
    quando a vista é pequena (`visCells ≤ CELL_SCAN_CAP`); cai pra iteração por instância só em
    zoom-out extremo. Custo O(visível) no caso do desenho/zoom-in. Verificado: contagem estável
    entre os dois caminhos, multi-célula (Divider) persiste.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts) (`paint`/`paintAt`/`strokeInstances`/`lastPaintW`), [src/render/renderer.ts](src/render/renderer.ts) (`renderInstances`/`renderOneInstance`).
- [ ] ⚪ **Bug: `<rect>` com largura/altura negativa em zoom-out extremo** — em zoom muito
  afastado o console acusa `<rect> attribute width: A negative value` (algum overlay/grid).
  Pré-existente, cosmético (o rect só não renderiza). Achar a origem e clampar a ≥ 0.
  - Arquivos prováveis: [src/render/renderer.ts](src/render/renderer.ts) (grid/frame/overlays).
- [ ] 🟡 **Preview do Halftone em `<canvas>`** — desacoplar o preview ao vivo do DOM SVG
  (amostrar → desenhar no canvas; baking pra SVG só no Apply/export). Pré-requisito do
  halftone de **vídeo/GIF** (frames contínuos sem criar milhares de nós).
- [~] 🟡 **Virtualização/benchmark com muitos SVGs** — _medido; índice espacial dispensado._
  O **render incremental** (cell-scan da área visível com zoom-in) já evita iterar off-screen.
  Benchmark (5440 instâncias, idle spin, headless): zoom-in ~390 visíveis → **34ms/frame**;
  zoom-out 5440 visíveis → **622ms/frame**. O caso lento é dominado pelo **nº de SVGs visíveis
  animando** (5440 `setAttribute(transform)`/frame), **não** pela iteração — um índice espacial
  (cull de off-screen) não ajudaria, pois nada está off-screen aí. A alavanca real pra cenas
  densas **animadas** é o **render em `<canvas>`** (abaixo), não o índice. (Caso de cena enorme +
  zoom médio com muitos off-screen pode pedir só elevar/afinar o `CELL_SCAN_CAP`.)
  - Arquivos: [src/render/renderer.ts](src/render/renderer.ts) (`renderInstances` cell-scan).
