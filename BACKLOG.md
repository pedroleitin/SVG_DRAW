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

## 2. Grid

- [~] 🟡 **Layout do grid** — _parcial._ Feito: **gutter** (espaçamento entre células,
  toggle 4px), **cantos arredondados** (rounded cells) e **mostrar/ocultar** o grid de
  pontos — agrupados no menu de contexto **Grid** do modo Compose.
  Falta: grid retangular (largura ≠ altura de célula), offset de origem do grid,
  opacidade das linhas.
  - Arquivos: [src/scene/geom.ts](src/scene/geom.ts) (`cellBgRect`), [src/render/renderer.ts](src/render/renderer.ts), [src/ui/gridPanel.ts](src/ui/gridPanel.ts), [src/scene/types.ts](src/scene/types.ts)
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
  multi-célula ancorados fora dela).
  - Arquivos: [src/features/divider.ts](src/features/divider.ts), [src/ui/dividerPanel.ts](src/ui/dividerPanel.ts), [src/scene/geom.ts](src/scene/geom.ts), [src/render/renderer.ts](src/render/renderer.ts), [src/features/placement.ts](src/features/placement.ts).
  - Refino futuro: blocos retangulares opcionais, esticar SVG no bloco, preencher com
    cor (Mondrian), e ancorar a subdivisão a uma região fixa.
- [x] 🟡 **Bug Seamless + multi-célula** — _feito._ A `tileFill` virou block-aware: só
  replica blocos que cabem **inteiros** no tile (cópias espaçadas 1 tile, sem overlap);
  blocos que cruzam a borda são descartados (um retângulo único não tem como dar a volta
  no toro). Eliminou as sobreposições.
  - Arquivos: [src/features/placement.ts](src/features/placement.ts) (`tileFill`).

## 3. Ferramentas de desenho

- [~] 🔴 **Controles finos de desenhar e apagar** — _parcial._
  Feito: **Brush** 1–4 (footprint NxN, quadrado/círculo/cruz, centrado no cursor) +
  **Size** 1–6 (span: cada SVG ocupa N×N células). Brush e Size combinam: Brush =
  quantos blocos, Size = tamanho de cada (espaçados pelo Size, sem sobrepor). Placement
  **limpa o que cobre** (sem overlaps) e o arrasto estampa blocos; **Erase** remove
  qualquer SVG que cubra a célula (ciente de multi-célula); preview/ghost no tamanho do
  bloco. Respeita zonas bloqueadas.
  Falta: densidade do traço, modo "só preencher vazias" vs "sobrescrever", apagar por
  filtro (por asset / por cor).
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts), [src/scene/grid.ts](src/scene/grid.ts) (`brushCells`/`brushBlocks`), [src/ui/brushPanel.ts](src/ui/brushPanel.ts), [src/render/renderer.ts](src/render/renderer.ts)
- [ ] 🔴 **Modo stencil no Noise (pincel de máscara)** — em vez de só "Apply to view",
  um **brush** que pinta/apaga a máscara de noise na tela com um **brush size**
  (revela/oculta SVGs pintando, em vez de aplicar a tela inteira).
  - Liga com o overlay de preview do noise; pintar adiciona/remove células conforme
    o valor do campo sob o pincel.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts), [src/features/placement.ts](src/features/placement.ts) (applyMask), [src/ui/controls.ts](src/ui/controls.ts)
- [x] 🟡 **Modo Block (zona bloqueada)** — _feito._ Ferramenta **Block** (entre Erase
  e Noise) marca células onde **não se pode colocar SVG**: o draw pula essas células e
  o noise (`applyMask`) também. Menu de contexto com segmented **Drag** (retângulo
  clicar-arrastar) e **Brush** (pintar com o footprint atual); ambos removem SVGs já
  presentes nas células bloqueadas. Overlay **avermelhado + borda vermelha dashed**;
  hover do brush em vermelho. Tudo undoable (`blocked: Record<key,true>` no estado).
  - Arquivos: [src/scene/types.ts](src/scene/types.ts), [src/tools/tools.ts](src/tools/tools.ts), [src/commands/sceneCommands.ts](src/commands/sceneCommands.ts) (`BlockCells`),
    [src/features/placement.ts](src/features/placement.ts), [src/render/renderer.ts](src/render/renderer.ts), [src/ui/blockPanel.ts](src/ui/blockPanel.ts), [src/ui/shell.ts](src/ui/shell.ts).
  - Refinamento futuro: des-bloquear (apagar zona), e respeitar bloqueio na escala multi-célula.
- [x] ⚪ **Rotação randômica de 90°** — _feito._ Cada SVG colocado recebe uma rotação
  aleatória entre 0/90/180/270°.
- [x] 🟡 **Modo Edit (Compose)** — _feito._ Botão **Edit** no Compose abre um menu
  (ops + Brush à esquerda, Recolor à direita, com divisor) e edita os itens existentes
  como um pincel: **Rotate** (gira 90° por clique), **Swap** (troca o ícone pelos shapes
  selecionados), **Recolor → Gliph/Cell** (recolore o ícone ou o cell-bg com a cor ativa
  ou aleatória via dado). Slider **Brush** define o footprint; ciente de multi-célula
  (hover adapta ao tamanho do gliph); undoable.
  - Arquivos: [src/ui/editPanel.ts](src/ui/editPanel.ts), [src/tools/tools.ts](src/tools/tools.ts) (`paintEdit`/`editInstance`), [src/render/renderer.ts](src/render/renderer.ts) (hover), [src/scene/types.ts](src/scene/types.ts), [src/ui/shell.ts](src/ui/shell.ts).

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
- [ ] 🟡 **Manter o Play visível ao trocar de modo durante a reprodução** — quando uma
  animação está tocando e o usuário muda de modo pelo menu superior, exibir o botão
  **Play/Pause** (mesmo fora do modo Animate) para que dê para controlar a reprodução
  de qualquer modo.
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts) (`buildToolbox`/`sync`).
- [ ] 🟡 **Bug: ligar o Order não troca o combobox de Order** — ao ativar a ferramenta
  **Order**, o combobox de ordem (no painel Animation) deveria mudar para refletir a
  ordem livre/desenhada (`free`); hoje fica dessincronizado.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts), [src/ui/animPanel.ts](src/ui/animPanel.ts), [src/anim/order.ts](src/anim/order.ts).
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

- [~] ⚪ **Adicionar som** — _parcial._ Web Audio puro (osciladores + envelopes, sem lib,
  igual ao Grid-o-matic): nota afinada ao **colocar** SVG (pitch segue a célula), sweep no
  **apagar**, nota no **divider** e no **edit**, e chirp de 2 notas no **theme toggle**.
  Botão de **mute** ao lado do trocador de tema (preferência persistida).
  - Arquivos: [src/features/audio.ts](src/features/audio.ts), [src/tools/tools.ts](src/tools/tools.ts), [src/ui/shell.ts](src/ui/shell.ts).
  - Futuro: som generativo ligado à animação/playback, e volume.

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

- [ ] 🔴 **Upload de imagem/vídeo como fonte de distribuição dos SVGs** — usar uma
  mídia (imagem estática **ou** vídeo) como campo de entrada, igual a máscara de
  noise, mas amostrando a mídia por célula.
  - Por célula: amostrar luminância/cor da imagem → decide presença, escala,
    cor e/ou escolha do SVG (análogo ao `sampleMask`, trocando o noise pela mídia).
  - **Vídeo** = fonte animada: reamostrar por frame (liga com a animação/`t` e o
    export frame-a-frame do Phase 6).
  - Amostragem via `<canvas>`/`OffscreenCanvas` (`drawImage` + `getImageData`)
    mapeando célula → pixel.
  - Arquivos prováveis: `src/features/` (fonte de mídia), [src/features/placement.ts](src/features/placement.ts),
    [src/scene/types.ts](src/scene/types.ts).
- [ ] 🔴 **Dithering / halftone com os SVGs** — preencher a imagem usando os SVGs
  disponíveis como "pontos":
  - **Halftone**: escala/densidade do SVG segue a luminância (claro = pequeno/esparso,
    escuro = grande/denso); opção de ângulo de trama e por canal (CMYK).
  - **Dithering**: ordered (Bayer) ou error-diffusion (Floyd–Steinberg) decidindo
    on/off (ou qual SVG) por célula a partir da imagem.
  - Reaproveita a biblioteca de SVGs e a paleta (cor por região da imagem).
- [ ] 🟡 **Overlay de preview da fonte** — mostrar a imagem/vídeo por baixo/por cima
  do grid (com opacidade) como referência enquanto distribui; toggle on/off, igual
  ao preview da máscara.
  - Arquivos prováveis: [src/render/renderer.ts](src/render/renderer.ts), [src/ui/controls.ts](src/ui/controls.ts).

---

## Ideias soltas (parking lot)

- [ ] Salvar/carregar projetos (estado serializável → JSON / IndexedDB).
- [ ] Presets compartilháveis via URL (seed + parâmetros).
- [ ] Atalhos de teclado adicionais e painel de ajuda.
- [ ] Performance: virtualização e benchmark com muitos SVGs.
